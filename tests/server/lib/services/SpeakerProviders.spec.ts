import { afterEach, describe, expect, test, vi } from 'vitest';
import { Mp3QuranService } from '$lib/services/Mp3QuranService';
import { QdcRecitationService } from '$lib/services/QdcRecitationService';

afterEach(() => vi.unstubAllGlobals());

describe('speaker provider boundaries', () => {
	test('keeps the MP3Quran endpoint and response contract while exposing speaker methods', async () => {
		const speakers = [{ id: 92, name: 'Known speaker', letter: 'K', moshaf: [] }];
		const fetch = vi
			.fn()
			.mockResolvedValue({ ok: true, json: async () => ({ reciters: speakers }) });
		vi.stubGlobal('fetch', fetch);
		expect(await Mp3QuranService.getSpeakers()).toEqual(speakers);
		expect(fetch).toHaveBeenCalledWith('https://mp3quran.net/api/v3/reciters?language=eng');
	});

	test('normalizes Quran.com speaker names at the API boundary', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					recitations: [{ id: 7, reciter_name: 'Known speaker', style: 'Murattal' }]
				})
			})
		);
		expect(await QdcRecitationService.getRecitations()).toEqual([
			{ id: 7, speaker_name: 'Known speaker', style: 'Murattal' }
		]);
	});
});
