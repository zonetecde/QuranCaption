import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PredefinedSubtitleClip, SilenceClip, SubtitleClip } from '$lib/classes/Clip.svelte';
import { SubtitleTrack } from '$lib/classes/Track.svelte';
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
