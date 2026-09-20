import { describe, expect, it } from 'vitest';

import { SubtitleClip } from '$lib/classes/Clip.svelte';
import {
	buildTranscriptBandWords,
	createTranscriptBandSelection,
	getTranscriptBandClipRange,
	serializeTranscriptBandSelection
} from '$lib/services/TranscriptBandService';

/**
 * Creates a subtitle clip with deterministic aligned words for service tests.
 *
 * @param {number} id Clip identifier.
 * @param {number} startTime Clip start in milliseconds.
 * @param {string} text Stored subtitle text.
 * @param {Array<{word: string; start: number; end: number}>} words Relative timings.
 * @param {boolean} legacyQuran Whether to use the legacy Quran constructor.
 * @returns {SubtitleClip} Test subtitle clip.
 */
function createClip(
	id: number,
	startTime: number,
	text: string,
	words: Array<{ word: string; start: number; end: number }>,
	legacyQuran = false
): SubtitleClip {
	const clip = legacyQuran
		? new SubtitleClip(
				startTime,
				startTime + 4000,
				2,
				255,
				0,
				words.length - 1,
				text,
				[],
				false,
				false
			)
		: new SubtitleClip(startTime, startTime + 4000, text, 'Speaker', {}, true, null, {
				source: 'local',
				timeFrom: startTime / 1000,
				timeTo: (startTime + 4000) / 1000,
				words
			});
	if (legacyQuran) {
		clip.alignmentMetadata = {
			source: 'local',
			timeFrom: startTime / 1000,
			timeTo: (startTime + 4000) / 1000,
			words
		};
	}
	clip.id = id;
	return clip;
}

describe('TranscriptBandService', () => {
	it('flattens aligned words and preserves Quran and citation portions', async () => {
		const words = await buildTranscriptBandWords([
			createClip(10, 1000, 'before {{2:255:1-2}} {{a quote}}', [
				{ word: 'before', start: 0, end: 0.4 },
				{ word: 'quran-1', start: 0.5, end: 0.9 },
				{ word: 'quran-2', start: 1, end: 1.4 },
				{ word: 'quote', start: 1.5, end: 1.9 }
			]),
			createClip(20, 6000, 'after', [{ word: 'after', start: 0, end: 0.4 }])
		]);

		expect(words.map((word) => word.kind)).toEqual([
			'plain',
			'quran',
			'quran',
			'citation',
			'plain'
		]);
		expect(words.map((word) => word.startMs)).toEqual([1000, 1500, 2000, 2500, 6000]);
		expect(getTranscriptBandClipRange(words, 10)).toEqual({ startIndex: 0, endIndex: 3 });
		expect(words[1].quranReference).toEqual({
			surah: 2,
			verse: 255,
			startWord: 1,
			endWord: 2
		});
	});

	it('recognizes Quran metadata on legacy clips without explicit markers', async () => {
		const words = await buildTranscriptBandWords([
			createClip(
				30,
				1000,
				'legacy Quran text',
				[
					{ word: 'quran-1', start: 0, end: 0.4 },
					{ word: 'quran-2', start: 0.5, end: 0.9 }
				],
				true
			)
		]);

		expect(words.every((word) => word.kind === 'quran')).toBe(true);
		expect(serializeTranscriptBandSelection(words, 0, 1)).toBe('{{2:255:1-2}}');
	});

	it('serializes selected ranges without losing structural markers', async () => {
		const words = await buildTranscriptBandWords([
			createClip(10, 1000, 'before {{2:255:1-2}} {{a quote}}', [
				{ word: 'before', start: 0, end: 0.4 },
				{ word: 'quran-1', start: 0.5, end: 0.9 },
				{ word: 'quran-2', start: 1, end: 1.4 },
				{ word: 'quote', start: 1.5, end: 1.9 }
			])
		]);

		expect(serializeTranscriptBandSelection(words, 0, 3)).toBe('before {{2:255:1-2}} {{quote}}');
		expect(serializeTranscriptBandSelection(words, 1, 1)).toBe('{{2:255:1-1}}');
		expect(createTranscriptBandSelection(words, 2, 3).text).toBe('{{2:255:2-2}} {{quote}}');
	});

	it('merges contiguous Quran ranges that come from adjacent clips', async () => {
		const words = await buildTranscriptBandWords([
			createClip(10, 1000, '{{2:255:1-2}}', [
				{ word: 'quran-1', start: 0, end: 0.4 },
				{ word: 'quran-2', start: 0.5, end: 0.9 }
			]),
			createClip(20, 2000, '{{2:255:3-4}}', [
				{ word: 'quran-3', start: 0, end: 0.4 },
				{ word: 'quran-4', start: 0.5, end: 0.9 }
			])
		]);

		expect(serializeTranscriptBandSelection(words, 0, 3)).toBe('{{2:255:1-4}}');
	});

	it('keeps raw words visible when they are absent from the current subtitles', async () => {
		const words = await buildTranscriptBandWords(
			[
				createClip(10, 1000, 'kept', [{ word: 'kept', start: 0, end: 0.4 }]),
				createClip(20, 3000, 'later', [{ word: 'later', start: 0, end: 0.4 }])
			],
			{
				language: 'ar',
				device: 'groq',
				model: 'whisper-large-v3',
				segments: [
					{
						start: 1,
						end: 4,
						text: 'kept missing later',
						speaker: 'SPEAKER_00',
						words: [
							{ word: 'kept', start: 1, end: 1.4 },
							{ word: 'missing', start: 2, end: 2.4 },
							{ word: 'later', start: 3, end: 3.4 }
						]
					}
				],
				speakers: ['SPEAKER_00'],
				wordTimestampsAvailable: true
			}
		);

		expect(words.map((word) => word.text)).toEqual(['kept', 'missing', 'later']);
		expect(words.map((word) => word.clipId)).toEqual([10, null, 20]);
	});

	it('does not assign a removed raw word to a nearby different word', async () => {
		const words = await buildTranscriptBandWords(
			[createClip(10, 1400, 'kept', [{ word: 'kept', start: 0, end: 0.4 }])],
			{
				language: 'ar',
				device: 'groq',
				model: 'whisper-large-v3',
				segments: [
					{
						start: 1,
						end: 1.8,
						text: 'missing kept',
						speaker: 'SPEAKER_00',
						words: [
							{ word: 'missing', start: 1, end: 1.4 },
							{ word: 'kept', start: 1.4, end: 1.8 }
						]
					}
				],
				speakers: ['SPEAKER_00'],
				wordTimestampsAvailable: true
			}
		);

		expect(words.map((word) => word.clipId)).toEqual([null, 10]);
	});
});
