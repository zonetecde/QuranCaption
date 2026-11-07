import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';
import { ManualAiSession } from '$lib/services/ManualAiSession.svelte';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
let session: ManualAiSession;

/**
 * Enveloppe une réponse avec l'identifiant du prompt attendu.
 * @param {unknown} result Réponse métier.
 * @returns {string} Réponse complète du chat.
 */
function reply(result: unknown): string {
	const requestId = session.steps.at(-1)!.prompt.match(/"requestId":"([^"]+)"/)![1];
	return JSON.stringify({ requestId, result });
}

beforeEach(() => {
	vi.stubGlobal('crypto', webcrypto);
	loadLocale('en');
	setLocale('en');
	session = new ManualAiSession();
	session.start();
	vi.mocked(invoke).mockResolvedValue('Original instructions');
});

afterEach(() => {
	session.cancel();
	vi.unstubAllGlobals();
	vi.mocked(invoke).mockReset();
});

test('keeps only the failed step pending, accepts fenced JSON and preserves validated replies', async () => {
	const first = session.request('first', { batch: { text: 'Hello' } }, String);
	await vi.waitFor(() => expect(session.steps).toHaveLength(1));
	session.steps[0].response = `\`\`\`json\n${reply('One')}\n\`\`\``;
	session.submit();
	expect(await first).toBe('One');

	const validate = vi.fn((value) => {
		if (value !== 'Two') throw new Error('Wrong result');
		return value;
	});
	const second = session.request('second', { batch: {} }, validate);
	await vi.waitFor(() => expect(session.steps).toHaveLength(2));
	session.steps[1].response = '{truncated';
	session.submit();
	expect(session.steps[1].error).toContain('incomplete');
	expect(validate).not.toHaveBeenCalled();
	session.steps[1].response = session.steps[0].response;
	session.submit();
	expect(session.steps[1].error).toContain('does not match');
	expect(validate).not.toHaveBeenCalled();
	session.steps[1].response = reply('Invalid');
	session.submit();
	expect(session.steps[1].error).toBe('Wrong result');
	session.steps[1].response = reply('Two');
	session.submit();
	expect(await second).toBe('Two');
	expect(session.steps.map(({ status }) => status)).toEqual(['valid', 'valid']);
	expect(session.steps[0].response).toContain('One');
	expect(session.ready).toBe(false);
	session.finish();
	expect(session.ready).toBe(true);
	expect(invoke).toHaveBeenCalledTimes(2);
	expect(invoke).toHaveBeenCalledWith('prepare_manual_ai_prompt', {
		kind: 'first',
		request: { batch: { text: 'Hello' } }
	});
});

test('cancels a pending reply and rejects late prompt preparation', async () => {
	const pending = session.request('first', { batch: {} }, String);
	const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
	await vi.waitFor(() => expect(session.steps).toHaveLength(1));
	session.cancel();
	await rejected;
	expect(session.ready).toBe(false);

	session.start();
	let release!: (value: string) => void;
	vi.mocked(invoke).mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				release = resolve;
			})
	);
	const preparing = session.request('second', { batch: {} }, String);
	const late = expect(preparing).rejects.toMatchObject({ name: 'AbortError' });
	session.cancel();
	release('Late prompt');
	await late;
	expect(session.steps).toHaveLength(0);
});

describe('manual AI response validation', () => {
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
		],
		[
			'project translation free text and citation fields',
			'{"requestId":"REQUEST_ID","result":{"f":["He said "Hello", then left.",""Quoted" text"],"c":[{"i":"1","t":"A "citation"."}],"text":"ok"}}',
			'ok'
		],
		[
			'correction and reference text fields',
			'{"requestId":"REQUEST_ID","result":{"before":"Say "Hello".","after":"Say "Hi".","reason":"Use "Hi".","suggestion":"Try "Hi".","text":"ok"}}',
			'ok'
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
		if (response.includes('"f":'))
			expect(validate).toHaveBeenCalledWith({
				f: ['He said "Hello", then left.', '"Quoted" text'],
				c: [{ i: '1', t: 'A "citation".' }],
				text: 'ok'
			});
		if (response.includes('"before":'))
			expect(validate).toHaveBeenCalledWith({
				before: 'Say "Hello".',
				after: 'Say "Hi".',
				reason: 'Use "Hi".',
				suggestion: 'Try "Hi".',
				text: 'ok'
			});
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
		expect(step.error).toContain(error === 'Wrong prompt' ? 'does not match' : 'incomplete');
		expect(step.status).toBe('waiting');
		expect(validate).not.toHaveBeenCalled();
		const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
		session.cancel();
		await rejection;
	});
});
