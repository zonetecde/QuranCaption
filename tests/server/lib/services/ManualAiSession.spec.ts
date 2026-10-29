import { afterEach, beforeEach, expect, test, vi } from 'vitest';
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
	loadLocale('en');
	setLocale('en');
	session = new ManualAiSession();
	session.start();
	vi.mocked(invoke).mockResolvedValue('Original instructions');
});

afterEach(() => {
	session.cancel();
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
