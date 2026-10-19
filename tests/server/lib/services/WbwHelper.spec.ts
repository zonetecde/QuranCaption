import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { PredefinedSubtitleClip, SubtitleClip } from '$lib/classes/Clip.svelte';
import { Quran, Surah, Verse, Word } from '$lib/classes/Quran';
import { getTimelineWbwWordLabel } from '$lib/services/WbwHelper';
import { enrichSegmentationResponseWithWordTimestamps } from '$lib/services/autoSegmentation/enrichment';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('$lib/services/autoSegmentation/audio', () => ({
	getAutoSegmentationAudioInfo: () => ({ filePath: 'audio.wav' }),
	getAutoSegmentationAudioClips: () => [
		{ filePath: 'audio.wav', startMs: 0, endMs: 1000, sourceStartMs: 0 }
	]
}));

const verse = new Verse(
	1,
	['قُلْ', 'هُوَ', 'ٱللَّهُ', 'أَحَدٌ'].map((text) => new Word(text, '', ''))
);

describe('WBW Arabic labels', () => {
	beforeEach(() => {
		vi.spyOn(Quran, 'getSurahs').mockReturnValue([new Surah(112, '', '', '', 4, '', '', [verse])]);
		vi.spyOn(Quran, 'getVerse').mockResolvedValue(verse);
	});
	afterEach(() => vi.restoreAllMocks());

	it.each([undefined, '', '112:1:3', ' 112:1:3 '])(
		'resolves the Arabic word when the label is %s',
		(word) => {
			const clip = new SubtitleClip(0, 1000, 112, 1, 1, 2, 'هُوَ', [], false, true);
			expect(getTimelineWbwWordLabel(clip, { location: '112:1:3', word }, 1)).toBe('ٱللَّهُ');
		}
	);

	it('preserves provided Arabic labels and strips display markers', () => {
		const clip = new SubtitleClip(0, 1000, 112, 1, 0, 0, 'قُلْ', [], false, true);
		expect(getTimelineWbwWordLabel(clip, { location: '112:1:1', word: 'قُلْ۟' })).toBe('قُلْ');
	});

	it('uses subtitle text when Quran data is not loaded and never shows a reference', () => {
		vi.mocked(Quran.getSurahs).mockReturnValue([]);
		const clip = new SubtitleClip(0, 1000, 112, 1, 1, 2, 'هُوَ ٱللَّهُ', [], false, true);
		expect(getTimelineWbwWordLabel(clip, { location: '112:1:3' }, 1)).toBe('ٱللَّهُ');
		clip.text = '';
		expect(getTimelineWbwWordLabel(clip, { location: '112:1:3', word: '112:1:3' }, 1)).toBe('');
	});

	it('resolves predefined subtitle words by their position', () => {
		const clip = new PredefinedSubtitleClip(0, 1000, 'Other', 'بِسْمِ ٱللَّهِ');
		expect(getTimelineWbwWordLabel(clip, { location: 'basmala:2' }, 1)).toBe('ٱللَّهِ');
	});

	it('fills missing and reference-only MFA labels before storing the timestamps', async () => {
		vi.mocked(invoke).mockResolvedValueOnce({
			segments: [
				{
					words: [
						{ location: '112:1:1', word: '112:1:1', start: 0, end: 0.2 },
						{ location: '112:1:2', start: 0.2, end: 0.4 },
						{ location: '112:1:3', word: 'ٱللَّهُ', start: 0.4, end: 1 }
					]
				}
			]
		});
		const result = await enrichSegmentationResponseWithWordTimestamps({
			segments: [
				{ segment: 1, ref_from: '112:1:1', ref_to: '112:1:3', time_from: 0, time_to: 1, words: [] }
			]
		});
		expect(result.segments?.[0].words).toEqual([
			{ location: '112:1:1', word: 'قُلْ', start: 0, end: 0.2 },
			{ location: '112:1:2', word: 'هُوَ', start: 0.2, end: 0.4 },
			{ location: '112:1:3', word: 'ٱللَّهُ', start: 0.4, end: 1 }
		]);
		expect(Quran.getVerse).toHaveBeenCalledOnce();
	});
});
