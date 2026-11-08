import { webcrypto } from 'node:crypto';
import { invoke } from '@tauri-apps/api/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ManualAiSession } from '$lib/services/ManualAiSession.svelte';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => 'Instructions') }));
vi.mock('$lib/i18n/i18n-svelte', () => ({
	default: {
		subscribe: (run: (value: unknown) => void) => {
			run({
				editor: {
					manualAi: {
						invalidJson: () => 'Invalid JSON',
						wrongPrompt: () => 'Wrong prompt'
					}
				}
			});
			return () => {};
		}
	}
}));

describe('manual AI response validation', () => {
	beforeAll(() => vi.stubGlobal('crypto', webcrypto));
	afterAll(() => vi.unstubAllGlobals());

	it('reuses the request ID across sessions only when the prompt is identical', async () => {
		const prompts: string[] = [];
		for (const instructions of ['Instructions', 'Instructions', 'Instructions modifiées العربية']) {
			vi.mocked(invoke).mockResolvedValueOnce(instructions);
			const session = new ManualAiSession();
			session.start();
			const pending = session.request('translation_trim', {}, vi.fn());
			await vi.waitFor(() => expect(session.steps).toHaveLength(1));
			prompts.push(session.steps[0].prompt);
			const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
			session.cancel();
			await rejection;
		}
		expect(prompts[0]).toBe(prompts[1]);
		expect(prompts[0].match(/"requestId":"([^"]+)"/)![1]).not.toBe(
			prompts[2].match(/"requestId":"([^"]+)"/)![1]
		);
	});

	it.each([
		['plain JSON', '{"requestId":"REQUEST_ID","result":{"text":"[yourselves]"}}', '[yourselves]'],
		[
			'Markdown wrapper',
			'Here is the result:\n```json\n{"requestId":"REQUEST_ID","result":{"text":"ok"}}\n```',
			'ok'
		],
		[
			'Markdown-escaped arrays and text',
			String.raw`{"requestId":"REQUEST_ID","result":{"verses":\[\],"text":"\[yourselves\]"}}`,
			'[yourselves]'
		],
		[
			'valid JSON escapes',
			String.raw`{"requestId":"REQUEST_ID","result":{"text":"\"quoted\"\n\\[literal] \u0041"}}`,
			'"quoted"\n\\[literal] A'
		],
		[
			'mixed JSON and Markdown escapes',
			String.raw`{"requestId":"REQUEST_ID","result":{"verses":\[\],"text":"\"quoted\"\n\\[literal] \[yourselves\]"}}`,
			'"quoted"\n\\[literal] [yourselves]'
		],
		[
			'HTML indentation and Markdown line breaks with overescaped quotes',
			String.raw`{\
&#x20; "requestId": "REQUEST_ID",\
&#x20; "result": {\
&#x20;   "text": "et ils dirent : \\"Vraiment, nous sommes envoyés à vous.\\""\
&#x20; }\
}`,
			'et ils dirent : "Vraiment, nous sommes envoyés à vous."'
		],
		[
			'formatted JSON with valid quotes and a trailing literal backslash',
			String.raw`{\
&#x20; "requestId": "REQUEST_ID",\
&#x20; "result": {"text":"\"quoted\" \\"}\
}`.replaceAll('\n', '\r\n'),
			'"quoted" \\'
		],
		[
			'valid JSON containing literal HTML entities and escaped quotes',
			String.raw`{"requestId":"REQUEST_ID","result":{"text":"&#x20; \\\"quoted\\\""}}`,
			'&#x20; \\"quoted\\"'
		],
		[
			'formatted JSON containing a literal HTML entity in the text',
			String.raw`{\
&#x20; "requestId": "REQUEST_ID",\
&#x20; "result": {"text":"literal &#x20;"}\
}`,
			'literal &#x20;'
		],
		[
			'unescaped opening quote from the Gemini reply',
			'{"requestId":"REQUEST_ID","result":{"text":"0:[Through 1:a 2:messenger, 3:saying], 4:"Do 5:not 6:worship 7:except 8:Allāh."}}',
			'0:[Through 1:a 2:messenger, 3:saying], 4:"Do 5:not 6:worship 7:except 8:Allāh.'
		],
		[
			'unescaped closing quote from the Gemini reply',
			'{"requestId":"REQUEST_ID","result":{"text":"9:Indeed, 10:I 11:am 12:to 13:you 14:from 15:Him 16:a 17:warner 18:and 19:a 20:bringer 21:of 22:good 23:tidings,""}}',
			'9:Indeed, 10:I 11:am 12:to 13:you 14:from 15:Him 16:a 17:warner 18:and 19:a 20:bringer 21:of 22:good 23:tidings,"'
		],
		[
			'unescaped quotes inside the Gemini question',
			'{"requestId":"REQUEST_ID","result":{"text":"0:Or 1:do 2:they 3:say, 4:"He 5:invented 6:it"?"}}',
			'0:Or 1:do 2:they 3:say, 4:"He 5:invented 6:it"?'
		],
		[
			'quoted phrase followed by a comma',
			'{"requestId":"REQUEST_ID","result":{"text":"He said "Hello", then left."}}',
			'He said "Hello", then left.'
		],
		[
			'mixed valid escapes and unescaped quotes',
			String.raw`{"requestId":"REQUEST_ID","result":{"text":"\"valid\"\n\\path and "unescaped""}}`,
			'"valid"\n\\path and "unescaped"'
		]
	])('accepts %s only when submitted', async (_, response, expected) => {
		const session = new ManualAiSession();
		const validate = vi.fn((result: unknown) => result);
		session.start();
		const pending = session.request('translation_trim', {}, validate);
		await vi.waitFor(() => expect(session.steps).toHaveLength(1));
		const step = session.steps[0];
		const requestId = step.prompt.match(/"requestId":"([^"]+)"/)![1];
		step.response = response.replace('REQUEST_ID', requestId);
		expect(validate).not.toHaveBeenCalled();
		session.submit();
		expect(step.error).toBe('');
		expect(step.status).toBe('valid');
		await expect(pending).resolves.toMatchObject({ text: expected });
	});

	it.each([
		['{"requestId":"REQUEST_ID","result":{broken}}', 'Invalid JSON'],
		[String.raw`{"requestId":"REQUEST_ID","result":{"text":"\q"}}`, 'Invalid JSON'],
		['{"requestId":"REQUEST_ID","result":{"text":"unfinished', 'Invalid JSON'],
		[
			'{"requestId":"REQUEST_ID","result":{"segments":[{"i":0,"text":"unfinished},{"i":1,"text":"ok"}]}}',
			'Invalid JSON'
		],
		['{"requestId":"REQUEST_ID","result":{"verseKey":"11:"2","text":"ok"}}', 'Invalid JSON'],
		['{"requestId":"REQUEST_ID","result":{"text":"unfinished,"other":"ok"}}', 'Invalid JSON'],
		[String.raw`{"requestId":"REQUEST_ID","result":{"text":"bad \q and "quote""}}`, 'Invalid JSON'],
		['{"requestId":"other","result":{"text":"He said "Hello"."}}', 'Wrong prompt'],
		[
			String.raw`{\
&#x20; "requestId": "other",\
&#x20; "result": {"text":"ok"}\
}`,
			'Wrong prompt'
		],
		[String.raw`{"requestId":"other","result":{"verses":\[\]}}`, 'Wrong prompt']
	])('rejects invalid or mismatched responses: %s', async (response, error) => {
		const session = new ManualAiSession();
		const validate = vi.fn();
		session.start();
		const pending = session.request('translation_trim', {}, validate);
		await vi.waitFor(() => expect(session.steps).toHaveLength(1));
		const step = session.steps[0];
		const requestId = step.prompt.match(/"requestId":"([^"]+)"/)![1];
		step.response = response.replace('REQUEST_ID', requestId);
		session.submit();
		expect(step.error).toBe(error);
		expect(step.status).toBe('waiting');
		expect(validate).not.toHaveBeenCalled();
		const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
		session.cancel();
		await rejection;
	});
});
