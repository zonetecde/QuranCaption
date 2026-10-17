import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('$lib/services/autoSegmentation/audio', () => ({
	getAutoSegmentationAudioClips: () => [
		{ filePath: 'C:/audio/sample.wav', startMs: 0, endMs: 1500 }
	]
}));

import { Project } from '$lib/classes/Project';
import { ProjectDetail } from '$lib/classes/ProjectDetail.svelte';
import type { AITranscriptionSettings } from '$lib/classes/Settings.svelte';
import type { AITranscriptionResult } from '$lib/types/transcription';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';
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

		await expect(
			runAITranscription(new Project(new ProjectDetail('Lecture', 'Speaker')), settings, 'gsk_user')
		).resolves.toEqual(response);
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

/**
 * Simule les mots reconnus avec un décalage sur la timeline.
 * @param {string} text Texte reconnu.
 * @returns {AITranscriptionResult} Transcription de test.
 */
function referenceSource(text = 'يا قلب يا قلب'): AITranscriptionResult {
	const words = text.split(' ').map((word, index) => ({
		word,
		start: 10 + index * 0.5,
		end: 10.4 + index * 0.5
	}));
	return {
		language: 'ar',
		device: 'cpu',
		model: 'small',
		speakers: ['SPEAKER_00'],
		wordTimestampsAvailable: true,
		segments: [{ text, start: 10, end: words.at(-1)!.end, speaker: 'SPEAKER_00', words }]
	};
}

describe('AITranscription reference text provider', () => {
	beforeEach(() => {
		invokeMock.mockReset();
		loadLocale('en');
		setLocale('en');
	});

	it('recognizes locally, aligns each repetition and restores absolute word times', async () => {
		invokeMock.mockResolvedValueOnce(referenceSource()).mockResolvedValueOnce({
			segments: [0, 1].map((segment) => ({
				segment,
				words: [
					{ word: 'يَا', start: 0, end: 0.3 },
					{ word: 'قَلْبُ', start: 0.5, end: 0.9 }
				]
			}))
		});
		const result = await runAITranscription(
			new Project(new ProjectDetail('Poem', 'Speaker')),
			{ ...settings, provider: 'alignment' },
			'',
			'يَا قَلْبُ'
		);
		expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
			'transcribe_audio_local_whisperx',
			'align_transcript_words_local_whisperx'
		]);
		expect(invokeMock.mock.calls[1][1].segments).toEqual([
			{ segment: 0, time_from: 10, time_to: 10.9, matched_text: 'يَا قَلْبُ' },
			{ segment: 1, time_from: 11, time_to: 11.9, matched_text: 'يَا قَلْبُ' }
		]);
		expect(result.segments.map((segment) => segment.text)).toEqual(['يَا قَلْبُ', 'يَا قَلْبُ']);
		expect(result.segments[1].words[1]).toMatchObject({ word: 'قَلْبُ', start: 11.5, end: 11.9 });
		expect(result.alignmentWarning).toBeNull();
	});

	it('keeps every supplied poem line intact despite slow singing, pauses and short subtitle limits', async () => {
		const lines = [
			'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ',
			'مُحَمَّدٌ أَشْرَفُ الْأَعْرَابِ وَالْعَجَمِ',
			'مُحَمَّدٌ خَيْرُ مَنْ يَمْشِي عَلَى قَدَمِ',
			'مُحَمَّدٌ بَاسِطُ الْمَعْرُوفِ جَامِعُهُ',
			'مُحَمَّدٌ صَاحِبُ الْإِحْسَانِ وَالْكَرَمِ',
			'مُحَمَّدٌ تَاجُ رُسُلِ اللَّهِ قَاطِبَةً',
			'مُحَمَّدٌ صَادِقُ الْأَقْوَالِ وَالْكَلِمِ',
			'مُحَمَّدٌ ثَابِتُ الْمِيثَاقِ حَافِظُهُ',
			'مُحَمَّدٌ طَيِّبُ الْأَخْلَاقِ وَالشِّيَمِ',
			'مُحَمَّدٌ رُوِيَتْ بِالنُّورِ طِينَتُهُ',
			'مُحَمَّدٌ لَمْ يَزَلْ نُورًا مِنَ الْقِدَمِ',
			'مُحَمَّدٌ حَاكِمٌ بِالْعَدْلِ ذُو شَرَفٍ',
			'مُحَمَّدٌ مَعْدِنُ الْإِنْعَامِ وَالْحِكَمِ'
		];
		const source = referenceSource(lines.join(' '));
		source.segments[0].words = source.segments[0].words.map((word, index) => ({
			...word,
			start: 10 + index * 3,
			end: 10.4 + index * 3
		}));
		source.segments[0].end = source.segments[0].words.at(-1)!.end;
		invokeMock.mockResolvedValueOnce(source).mockImplementationOnce(async (_command, payload) => ({
			segments: payload.segments.map((segment: { segment: number; matched_text: string }) => ({
				segment: segment.segment,
				words: segment.matched_text
					.split(' ')
					.map((word, index) => ({ word, start: index * 3, end: index * 3 + 0.4 }))
			}))
		}));
		const result = await runAITranscription(
			new Project(new ProjectDetail('Poem', 'Speaker')),
			{ ...settings, provider: 'alignment', maxWordsPerSegment: 2, maxCharsPerSegment: 20 },
			'',
			lines.join('\n\n')
		);
		expect(result.segments.map((segment) => segment.text)).toEqual(lines);
		expect(result.segments[2].end - result.segments[2].start).toBeGreaterThan(8);
		expect(result.alignmentWarning).toBeNull();
	});

	it('rejects missing reference text before invoking the local engine', async () => {
		await expect(
			runAITranscription(
				new Project(new ProjectDetail('Poem', 'Speaker')),
				{ ...settings, provider: 'alignment' },
				'',
				'   '
			)
		).rejects.toThrow('Enter the Arabic text');
		expect(invokeMock).not.toHaveBeenCalled();
	});

	it('rejects an unrelated reference before attempting forced alignment', async () => {
		invokeMock.mockResolvedValueOnce(referenceSource('سيارة مدرسة حاسوب'));
		await expect(
			runAITranscription(
				new Project(new ProjectDetail('Poem', 'Speaker')),
				{ ...settings, provider: 'alignment' },
				'',
				'يا قلب لا تحزن'
			)
		).rejects.toThrow('No reliable match');
		expect(invokeMock).toHaveBeenCalledOnce();
	});

	it.each(
		[
			[],
			[{ word: 'يا', start: 0, end: 0.3 }],
			[
				{ word: 'يا', start: 0, end: 0.7 },
				{ word: 'قلب', start: 0.5, end: 0.9 }
			],
			[
				{ word: 'يا', start: 0, end: 0.3 },
				{ word: 'قلب', start: 0.5, end: 8 }
			]
		].map((words) => ({ words }))
	)(
		'keeps original text and timings if forced alignment is incomplete or invalid (%j)',
		async ({ words }) => {
			invokeMock
				.mockResolvedValueOnce(referenceSource('يا قلب'))
				.mockResolvedValueOnce({ segments: [{ segment: 0, words }] });
			const result = await runAITranscription(
				new Project(new ProjectDetail('Poem', 'Speaker')),
				{ ...settings, provider: 'alignment' },
				'',
				'يَا قَلْبُ'
			);
			expect(result.segments[0].text).toBe('يا قلب');
			expect(result.segments[0].words[1]).toMatchObject({ word: 'قلب', start: 10.5, end: 10.9 });
			expect(result.alignmentWarning).toContain('could not be fully aligned');
		}
	);

	it('keeps unmatched speech and warns without losing later matches', async () => {
		invokeMock.mockResolvedValueOnce(referenceSource('سيارة يا قلب')).mockResolvedValueOnce({
			segments: [
				{
					segment: 1,
					words: [
						{ word: 'يا', start: 0, end: 0.4 },
						{ word: 'قلب', start: 0.5, end: 0.9 }
					]
				}
			]
		});
		const result = await runAITranscription(
			new Project(new ProjectDetail('Poem', 'Speaker')),
			{ ...settings, provider: 'alignment' },
			'',
			'يا قلب'
		);
		expect(result.segments.map((segment) => segment.text)).toEqual(['سيارة', 'يا قلب']);
		expect(result.alignmentWarning).toContain('could not be matched reliably');
	});
});
