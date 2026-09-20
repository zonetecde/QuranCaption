import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('$lib/services/autoSegmentation/audio', () => ({
	getAutoSegmentationAudioClips: () => [
		{ filePath: 'C:/audio/sample.wav', startMs: 0, endMs: 1500 }
	]
}));

import type { AITranscriptionSettings } from '$lib/classes/Settings.svelte';
import {
	loadGroqApiKey,
	normalizeAITranscriptionSegments,
	padAITranscriptionSilences,
	runAITranscription,
	saveGroqApiKey
} from '$lib/services/AITranscription';

const settings: AITranscriptionSettings = {
	provider: 'groq',
	model: 'qwen3-asr-1.7b',
	language: 'ar',
	device: 'AUTO',
	hfToken: '',
	minSpeakers: null,
	maxSpeakers: null,
	batchSize: 8,
	subtitleLengthPreset: 'balanced',
	maxWordsPerSegment: 12,
	maxCharsPerSegment: 84,
	subtitleEndPaddingMs: 250,
	subtitleStartLeadMs: 150,
	replaceExisting: true,
	cleanupBatchWords: 160
};

describe('AITranscription Groq provider', () => {
	beforeEach(() => invokeMock.mockReset());

	it('stores and loads the Groq key through the secure OS vault', async () => {
		invokeMock.mockResolvedValueOnce(undefined).mockResolvedValueOnce('gsk_saved');

		await saveGroqApiKey('  gsk_saved  ');
		const stored = await loadGroqApiKey();

		expect(invokeMock).toHaveBeenNthCalledWith(1, 'quran_auth_secure_set', {
			key: 'groq_api_key',
			value: 'gsk_saved'
		});
		expect(stored).toBe('gsk_saved');
	});

	it('routes Groq transcription with the user key and timeline audio', async () => {
		const response = {
			language: 'ar',
			device: 'groq',
			model: 'whisper-large-v3',
			segments: [{ start: 0, end: 1, text: 'السلام', speaker: 'SPEAKER_00', words: [] }],
			speakers: ['SPEAKER_00'],
			wordTimestampsAvailable: true
		};
		invokeMock.mockResolvedValue(response);

		await expect(runAITranscription(settings, 'gsk_user')).resolves.toEqual(response);
		expect(invokeMock).toHaveBeenCalledWith('transcribe_audio_groq', {
			audioPath: 'C:/audio/sample.wav',
			audioClips: [{ path: 'C:/audio/sample.wav', startMs: 0, endMs: 1500 }],
			apiKey: 'gsk_user'
		});
	});

	it('deletes the secure Groq key when the field is cleared', async () => {
		invokeMock.mockResolvedValue(undefined);

		await saveGroqApiKey('');

		expect(invokeMock).toHaveBeenCalledWith('quran_auth_secure_delete', {
			key: 'groq_api_key'
		});
	});

	it('moves an overlapping segment one millisecond after the previous segment', () => {
		const segments = normalizeAITranscriptionSegments([
			{
				start: 21.04,
				end: 25.56,
				text: 'فتبقى مكانك تشعر بالبعد والضيعة',
				speaker: 'SPEAKER_00',
				words: []
			},
			{
				start: 25.1,
				end: 29.12,
				text: 'لكن نسيت شيئا',
				speaker: 'SPEAKER_00',
				words: []
			}
		]);

		expect(segments[0]).toMatchObject({ start: 21.04, end: 25.56 });
		expect(segments[1]).toMatchObject({ start: 25.561, end: 29.12 });
	});

	it('adds display margins without consuming the complete silence', () => {
		const segments = padAITranscriptionSilences(
			[
				{
					start: 45.3,
					end: 46.26,
					text: 'فعلت',
					speaker: 'SPEAKER_00',
					words: []
				},
				{
					start: 46.98,
					end: 48.08,
					text: 'ومهما',
					speaker: 'SPEAKER_00',
					words: []
				}
			],
			250,
			150
		);

		expect(segments[0].end).toBe(46.51);
		expect(segments[1].start).toBe(46.83);
	});
});
