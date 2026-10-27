import { QuranSubtitleClip } from '$lib/compatibility/QuranSubtitleClip.svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PredefinedSubtitleClip, SilenceClip, SubtitleClip } from '$lib/classes/Clip.svelte';
import { SubtitleTrack } from '$lib/classes/Track.svelte';
import { VerseTranslation } from '$lib/classes/Translation.svelte';
import { globalState } from '$lib/runes/main.svelte';
import {
	createPlainOverlaySegment,
	getMergedClipsWithoutWordOverlap,
	getVisibleArabicSegments
} from '$lib/components/projectEditor/videoPreview/visualMergeOverlayUtils';

describe('subtitle visual merge helpers', () => {
	beforeEach(() => {
		vi.spyOn(globalState, 'updateVideoPreviewUI').mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	/**
	 * Cree un clip Quran minimal pour les tests de merge.
	 * @param {number} startTime Debut du clip.
	 * @param {number} endTime Fin du clip.
	 * @param {number} verse Numero de verset.
	 * @returns {SubtitleClip} Clip Quran cree.
	 */
	function createSubtitle(startTime: number, endTime: number, verse: number): QuranSubtitleClip {
		return new QuranSubtitleClip(
			startTime,
			endTime,
			1,
			verse,
			0,
			0,
			`Verse ${verse}`,
			[],
			true,
			true
		);
	}

	it('accepts a consecutive Quran-only selection', () => {
		const first = createSubtitle(0, 999, 1);
		const second = createSubtitle(1000, 1999, 2);
		const track = new SubtitleTrack();
		track.clips = [first, second];

		expect(track.getVisualMergeSelection([second, first])).toEqual({
			clips: [first, second],
			startIndex: 0,
			endIndex: 1
		});
	});

	it('rejects a selection containing predefined subtitles', () => {
		const first = createSubtitle(0, 999, 1);
		const predefined = new PredefinedSubtitleClip(1000, 1999, 'Basmala');
		const track = new SubtitleTrack();
		track.clips = [first, predefined];

		expect(track.getVisualMergeSelection([first, predefined])).toBeNull();
	});

	it('keeps generic and Quran marker clips in the merged Arabic preview', () => {
		const first = new SubtitleClip(0, 999, 'Texte ordinaire', {}, true, null);
		const second = new SubtitleClip(1000, 1999, '{{2:153:2-4}}', {}, true, null);
		first.setVisualMerge('group-a', 'arabic');
		second.setVisualMerge('group-a', 'arabic');

		const segments = getVisibleArabicSegments(
			first,
			{
				groupId: 'group-a',
				mode: 'arabic',
				clips: [first, second],
				firstClip: first,
				lastClip: second,
				startTime: first.startTime,
				endTime: second.endTime
			},
			(clip, keyPrefix) => [createPlainOverlaySegment(`${keyPrefix}-${clip.id}`, clip.text)]
		);

		expect(segments.map((segment) => segment.text).join('')).toBe('Texte ordinaire {{2:153:2-4}}');
	});

	it('rejects a selection separated by a silence clip', () => {
		const first = createSubtitle(0, 999, 1);
		const silence = new SilenceClip(1000, 1499);
		const second = createSubtitle(1500, 2499, 2);
		const track = new SubtitleTrack();
		track.clips = [first, silence, second];

		expect(track.getVisualMergeSelection([first, second])).toBeNull();
	});

	it('applies the selected visual merge mode to the whole group', () => {
		const first = createSubtitle(0, 999, 1);
		const second = createSubtitle(1000, 1999, 2);
		const track = new SubtitleTrack();
		track.clips = [first, second];

		expect(track.applyVisualMerge([first, second], 'translation')).toBe(true);
		expect(first.visualMergeMode).toBe('translation');
		expect(second.visualMergeMode).toBe('translation');
		expect(first.visualMergeGroupId).toBeTruthy();
		expect(second.visualMergeGroupId).toBe(first.visualMergeGroupId);
	});

	it('cleans previous groups before re-merging a touched selection', () => {
		const first = createSubtitle(0, 999, 1);
		const second = createSubtitle(1000, 1999, 2);
		const third = createSubtitle(2000, 2999, 3);
		const track = new SubtitleTrack();
		track.clips = [first, second, third];

		track.applyVisualMerge([first, second], 'arabic');
		const originalGroupId = first.visualMergeGroupId;

		expect(track.applyVisualMerge([second, third], 'both')).toBe(true);
		expect(first.visualMergeGroupId).toBeNull();
		expect(first.visualMergeMode).toBeNull();
		expect(second.visualMergeMode).toBe('both');
		expect(third.visualMergeMode).toBe('both');
		expect(second.visualMergeGroupId).toBeTruthy();
		expect(second.visualMergeGroupId).not.toBe(originalGroupId);
		expect(third.visualMergeGroupId).toBe(second.visualMergeGroupId);
	});

	it('unmerges every clip from a visual merge group', () => {
		const first = createSubtitle(0, 999, 1);
		const second = createSubtitle(1000, 1999, 2);
		const track = new SubtitleTrack();
		track.clips = [first, second];

		track.applyVisualMerge([first, second], 'both');
		track.unmergeVisualGroup(first.visualMergeGroupId!);

		expect(first.visualMergeGroupId).toBeNull();
		expect(first.visualMergeMode).toBeNull();
		expect(second.visualMergeGroupId).toBeNull();
		expect(second.visualMergeMode).toBeNull();
	});

	it('permanently merges text, structured translations and absolute word timings', () => {
		const first = new SubtitleClip(1000, 2000, 'Before {{1:1:1-2}}', {
			english: new VerseTranslation('Before {{1:1:1-2}}', 'reviewed')
		});
		const second = new SubtitleClip(2500, 3500, '{{quote}} {{1:2}} after', {
			english: new VerseTranslation('{{quotation}} {{1:2}} after', 'reviewed')
		});
		const firstTranslation = first.translations.english as VerseTranslation;
		const secondTranslation = second.translations.english as VerseTranslation;
		firstTranslation.isStructuredTranslation = true;
		secondTranslation.isStructuredTranslation = true;
		firstTranslation.getOrCreateQuranSegment('quran-0', '1:1:1-2', 4).endUnitIndex = 2;
		const manual = secondTranslation.getOrCreateQuranSegment('quran-1', '1:2', 4);
		manual.isBruteForce = true;
		manual.manualText = 'Manual translation';
		first.alignmentMetadata = {
			source: 'local',
			timeFrom: 1,
			timeTo: 2,
			words: [{ word: 'first', start: 0, end: 1 }]
		};
		second.alignmentMetadata = {
			source: 'local',
			timeFrom: 2.5,
			timeTo: 3.5,
			words: [{ word: 'second', start: 0, end: 1 }]
		};
		const track = new SubtitleTrack();
		track.clips = [first, second];
		track.applyVisualMerge([first, second], 'both');

		expect(track.mergeSubtitlesPermanently([second, first])).toBe(true);
		expect(track.clips).toHaveLength(1);
		const merged = track.clips[0] as SubtitleClip;
		expect(merged).toMatchObject({
			startTime: 1000,
			endTime: 3500,
			duration: 2500,
			text: 'Before {{1:1:1-2}} {{quote}} {{1:2}} after',
			visualMergeGroupId: null,
			visualMergeMode: null
		});
		expect(merged.alignmentMetadata?.words).toEqual([
			{ word: 'first', start: 0, end: 1.5 },
			{ word: 'second', start: 1.5, end: 2.5 }
		]);
		const translation = merged.translations.english as VerseTranslation;
		expect(translation.text).toBe('Before {{1:1:1-2}} {{quotation}} {{1:2}} after');
		expect(translation.isStructuredTranslation).toBe(true);
		expect(translation.quranSegments['quran-0'].endUnitIndex).toBe(2);
		expect(translation.quranSegments['quran-2']).toEqual(manual);
		expect(translation.quranSegments['quran-2']).not.toBe(manual);
		expect(secondTranslation.quranSegments['quran-1']).toBe(manual);
	});

	it('keeps legacy Quran references and translations when permanently merging', () => {
		const first = createSubtitle(0, 999, 1);
		const second = createSubtitle(1000, 1999, 2);
		first.translations.english = new VerseTranslation('First translation', 'reviewed');
		second.translations.english = new VerseTranslation('Second translation', 'reviewed');
		const track = new SubtitleTrack();
		track.clips = [first, second];

		expect(track.mergeSubtitlesPermanently([first, second])).toBe(true);
		const merged = track.clips[0] as SubtitleClip;
		expect(merged).not.toBeInstanceOf(QuranSubtitleClip);
		expect(merged.text).toBe('{{1:1}} {{1:2}}');
		const translation = merged.translations.english as VerseTranslation;
		expect(translation.text).toBe('{{1:1}} {{1:2}}');
		expect(translation.quranSegments['quran-0'].manualText).toBe('First translation');
		expect(translation.quranSegments['quran-1'].manualText).toBe('Second translation');
	});

	it('rejects nonadjacent permanent merges without changing the track', () => {
		const first = new SubtitleClip(0, 1000, 'First');
		const gap = new SilenceClip(1000, 2000);
		const second = new SubtitleClip(2000, 3000, 'Second');
		const track = new SubtitleTrack();
		track.clips = [first, gap, second];

		expect(track.mergeSubtitlesPermanently([first, second])).toBe(false);
		expect(track.clips).toEqual([first, gap, second]);
	});

	it('splits a four-clip visual merge into two groups at the selected boundary', () => {
		const first = createSubtitle(0, 999, 1);
		const second = createSubtitle(1000, 1999, 2);
		const third = createSubtitle(2000, 2999, 3);
		const fourth = createSubtitle(3000, 3999, 4);
		const track = new SubtitleTrack();
		track.clips = [first, second, third, fourth];

		track.applyVisualMerge([first, second, third, fourth], 'both');

		expect(track.splitVisualMergeBetween(second, third)).toBe(true);
		expect(first.visualMergeMode).toBe('both');
		expect(second.visualMergeMode).toBe('both');
		expect(third.visualMergeMode).toBe('both');
		expect(fourth.visualMergeMode).toBe('both');
		expect(first.visualMergeGroupId).toBe(second.visualMergeGroupId);
		expect(third.visualMergeGroupId).toBe(fourth.visualMergeGroupId);
		expect(second.visualMergeGroupId).not.toBe(third.visualMergeGroupId);
	});

	it('keeps only the remaining side merged when splitting at a group edge', () => {
		const first = createSubtitle(0, 999, 1);
		const second = createSubtitle(1000, 1999, 2);
		const third = createSubtitle(2000, 2999, 3);
		const track = new SubtitleTrack();
		track.clips = [first, second, third];

		track.applyVisualMerge([first, second, third], 'arabic');

		expect(track.splitVisualMergeBetween(first, second)).toBe(true);
		expect(first.visualMergeGroupId).toBeNull();
		expect(first.visualMergeMode).toBeNull();
		expect(second.visualMergeMode).toBe('arabic');
		expect(third.visualMergeMode).toBe('arabic');
		expect(second.visualMergeGroupId).toBe(third.visualMergeGroupId);
	});

	it('does not split when the subtitles are not an adjacent boundary of the same group', () => {
		const first = createSubtitle(0, 999, 1);
		const second = createSubtitle(1000, 1999, 2);
		const third = createSubtitle(2000, 2999, 3);
		const track = new SubtitleTrack();
		track.clips = [first, second, third];

		track.applyVisualMerge([first, second, third], 'translation');
		const groupId = first.visualMergeGroupId;

		expect(track.splitVisualMergeBetween(first, third)).toBe(false);
		expect(first.visualMergeGroupId).toBe(groupId);
		expect(second.visualMergeGroupId).toBe(groupId);
		expect(third.visualMergeGroupId).toBe(groupId);
	});

	it('rejects arabic continuity when a word gap exists inside the same verse', () => {
		const first = createSubtitle(0, 999, 255);
		const second = createSubtitle(1000, 1999, 255);
		first.startWordIndex = 0;
		first.endWordIndex = 4;
		second.startWordIndex = 6;
		second.endWordIndex = 9;
		const track = new SubtitleTrack();
		track.clips = [first, second];

		const selection = track.getVisualMergeSelection([first, second]);
		expect(selection).not.toBeNull();
		expect(track.canUseArabicVisualMerge(selection!.clips)).toBe(false);
		expect(track.applyVisualMerge([first, second], 'arabic')).toBe(false);
		expect(track.applyVisualMerge([first, second], 'both')).toBe(false);
		expect(track.applyVisualMerge([first, second], 'translation')).toBe(false);
	});

	it('does not mutate a source translation with an empty range while rendering a merge', () => {
		const first = createSubtitle(0, 999, 1);
		const second = createSubtitle(1000, 1999, 1);
		second.startWordIndex = 1;
		second.endWordIndex = 1;
		first.translations.english = new VerseTranslation('comes', 'reviewed');
		const emptyRange = new VerseTranslation('grateful.', 'to review');
		emptyRange.startWordIndex = 1;
		emptyRange.endWordIndex = 0;
		second.translations.english = emptyRange;

		const rendered = getMergedClipsWithoutWordOverlap([first, second]);

		expect(rendered[1]).not.toBe(second);
		expect(rendered[1].translations.english.text).toBe('');
		expect(emptyRange.text).toBe('grateful.');
	});

	it('unmerges the whole group when editing one merged subtitle', async () => {
		const first = createSubtitle(0, 999, 1);
		const second = createSubtitle(1000, 1999, 2);
		const track = new SubtitleTrack();
		track.clips = [first, second];
		track.applyVisualMerge([first, second], 'arabic');

		vi.spyOn(track, 'getSubtitlesProperties').mockResolvedValue({
			isFullVerse: false,
			isLastWordsOfVerse: false,
			translations: {}
		});

		const verseMock = {
			id: 1,
			getArabicTextBetweenTwoIndexes: () => 'A',
			getWordByWordTranslationBetweenTwoIndexes: () => []
		} as unknown as Parameters<SubtitleTrack['editSubtitle']>[1];

		await track.editSubtitle(first, verseMock, 0, 0, 1);

		expect(first.visualMergeGroupId).toBeNull();
		expect(first.visualMergeMode).toBeNull();
		expect(second.visualMergeGroupId).toBeNull();
		expect(second.visualMergeMode).toBeNull();
	});
});
