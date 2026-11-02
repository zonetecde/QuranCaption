import { describe, expect, it, vi } from 'vitest';
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
