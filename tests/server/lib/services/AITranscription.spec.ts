import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('$lib/services/autoSegmentation/audio', () => ({
	getAutoSegmentationAudioClips: () => [
		{ filePath: 'C:/audio/sample.wav', startMs: 0, endMs: 1500 }
	]
}));

import type { AITranscriptionSettings } from '$lib/classes/Settings.svelte';
import { loadGroqApiKey, runAITranscription, saveGroqApiKey } from '$lib/services/AITranscription';

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
	minSilenceDuration: 1,
	maxWordsPerSegment: 12,
	maxCharsPerSegment: 84,
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
});
