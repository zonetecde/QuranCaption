import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PredefinedSubtitleClip, SilenceClip, SubtitleClip } from '$lib/classes/Clip.svelte';
import { SubtitleTrack } from '$lib/classes/Track.svelte';
import { VerseTranslation } from '$lib/classes/Translation.svelte';
import { getMergedClipsWithoutWordOverlap } from '$lib/components/projectEditor/videoPreview/visualMergeOverlayUtils';
import { globalState } from '$lib/runes/main.svelte';

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
	function createSubtitle(startTime: number, endTime: number, verse: number): SubtitleClip {
		return new SubtitleClip(startTime, endTime, 1, verse, 0, 0, `Verse ${verse}`, [], true, true);
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

	it.each(['translation', 'arabic', 'both'] as const)(
		'applies %s to each same-verse run and can extend it across verse boundaries',
		(mode) => {
			const first = createSubtitle(0, 999, 1);
			const second = createSubtitle(1000, 1999, 1);
			const third = createSubtitle(2000, 2999, 2);
			const fourth = createSubtitle(3000, 3999, 2);
			const fifth = createSubtitle(4000, 4999, 3);
			const track = new SubtitleTrack();
			const clips = [first, second, third, fourth, fifth];
			track.clips = clips;

			track.applyVisualMergeToAll(mode, true);
			expect(first.visualMergeGroupId).toBeTruthy();
			expect(clips.map((clip) => clip.visualMergeGroupId)).toEqual(
				Array(5).fill(first.visualMergeGroupId)
			);

			track.applyVisualMergeToAll(mode, false);
			expect(first.visualMergeMode).toBe(mode);
			expect(third.visualMergeMode).toBe(mode);
			expect(first.visualMergeGroupId).toBe(second.visualMergeGroupId);
			expect(third.visualMergeGroupId).toBe(fourth.visualMergeGroupId);
			expect(third.visualMergeGroupId).not.toBe(first.visualMergeGroupId);
			expect(fifth.visualMergeGroupId).toBeNull();
		}
	);

	it('only merges across boundaries eligible for quick merge', () => {
		const first = createSubtitle(0, 999, 1);
		const second = createSubtitle(1000, 1999, 1);
		const third = createSubtitle(2000, 2999, 1);
		const fourth = createSubtitle(4000, 4999, 2);
		const fifth = createSubtitle(6000, 6999, 3);
		third.startWordIndex = 3;
		third.endWordIndex = 3;
		const silence = new SilenceClip(3000, 3999);
		const predefined = new PredefinedSubtitleClip(5000, 5999, 'Basmala');
		const track = new SubtitleTrack();
		track.clips = [first, second, third, silence, fourth, predefined, fifth];

		track.applyVisualMergeToAll('translation', true);

		expect(first.visualMergeGroupId).toBeTruthy();
		expect(second.visualMergeGroupId).toBe(first.visualMergeGroupId);
		expect([third, fourth, fifth].map((clip) => clip.visualMergeGroupId)).toEqual([
			null,
			null,
			null
		]);
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
