import { afterEach, describe, expect, test, vi } from 'vitest';
import { Mp3QuranService } from '$lib/services/Mp3QuranService';
import { QdcRecitationService } from '$lib/services/QdcRecitationService';
import { normalizeQuaSpeaker } from '$lib/services/QuranicUniversalAudioService';

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

	test('normalizes QUA responses and older cache entries without altering the wire data', () => {
		const wire = {
			slug: 'speaker-hafs',
			label: 'Known speaker',
			reciter: { reciter_id: 'known', name_en: 'Known speaker', name_ar: 'اسم' },
			riwayah: 'Hafs',
			style: '',
			channel: '',
			source: 'mp3quran',
			chapters: [1]
		};
		const normalized = normalizeQuaSpeaker(wire);
		expect(normalized.speaker).toEqual({
			speaker_id: 'known',
			name_en: 'Known speaker',
			name_ar: 'اسم'
		});
		expect(normalized).not.toHaveProperty('reciter');
		expect(wire.reciter.reciter_id).toBe('known');
		expect(normalizeQuaSpeaker(normalized)).toEqual(normalized);
	});
});
