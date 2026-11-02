import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubtitleClip } from '$lib/classes/Clip.svelte';
import { SubtitleTrack } from '$lib/classes/Track.svelte';
import { Quran, Verse, Word } from '$lib/classes/Quran';
import { COMPLETE_TRANSLATION_STATUSES, VerseTranslation } from '$lib/classes/Translation.svelte';
import { globalState } from '$lib/runes/main.svelte';
import { splitSubtitleClipLocally } from '$lib/services/autoSegmentation/split';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';

describe('translations inherited when splitting subtitles', () => {
	afterEach(() => vi.restoreAllMocks());

	it.each(['word boundary', 'exact cursor', 'unaligned', 'automatic'])(
		'preserves each parent range and requests review on both sides: %s',
		async (mode) => {
			const verse = new Verse(1, [
				new Word('a', 'a', 'one'),
				new Word('b', 'b', 'two'),
				new Word('c', 'c', 'three'),
				new Word('d', 'd', 'four')
			]);
			const translations = Object.fromEntries(
				[...COMPLETE_TRANSLATION_STATUSES, 'to review' as const].map((status, index) => {
					const translation = new VerseTranslation('zero one two three four five', status);
					translation.startWordIndex = (index % 2) + 1;
					translation.endWordIndex = 3;
					return [status, translation];
				})
			);
			const clip = new SubtitleClip(0, 4000, 1, 1, 0, 3, 'a b c d', [], true, true, translations);
			const parentTranslations = Object.entries(translations);
			if (mode !== 'unaligned') {
				clip.alignmentMetadata = {
					source: 'api',
					segment: 0,
					refFrom: '1:1:1',
					refTo: '1:1:4',
					matchedText: clip.text,
					timeFrom: 0,
					timeTo: 4,
					words: verse.words.map((_, index) => ({
						location: `1:1:${index + 1}`,
						start: index,
						end: index + 1
					}))
				};
			}
			const track = new SubtitleTrack();
			track.clips = [clip];
			vi.spyOn(Quran, 'getVerse').mockResolvedValue(verse);
			vi.spyOn(globalState, 'getTimelineState', 'get').mockReturnValue({
				cursorPosition: 2000
			} as never);
			vi.spyOn(globalState, 'getSubtitleTrack', 'get').mockReturnValue(track);
			vi.spyOn(globalState, 'updateVideoPreviewUI').mockImplementation(() => undefined);
			vi.spyOn(track, 'getSubtitlesProperties').mockImplementation(async () => ({
				isFullVerse: false,
				isLastWordsOfVerse: false,
				translations: Object.fromEntries(
					Object.keys(translations).map((key) => [
						key,
						new VerseTranslation('zero one two three four five', 'to review')
					])
				)
			}));

			if (mode === 'automatic') {
				expect(await splitSubtitleClipLocally(clip, 1)).not.toBeNull();
			} else {
				let historyDepth = 0;
				vi.spyOn(ProjectHistoryManager, 'begin').mockImplementation(() => {
					historyDepth++;
				});
				vi.spyOn(ProjectHistoryManager, 'commit').mockImplementation(() => {
					if (--historyDepth === 0) expect(track.clips).toHaveLength(2);
				});
				expect(
					await track.splitSubtitle(clip.id, { forceExactCursor: mode === 'exact cursor' })
				).toBe(true);
			}

			expect(track.clips).toHaveLength(2);
			const right = track.clips[1] as SubtitleClip;
			for (const [edition, parent] of parentTranslations) {
				for (const child of [clip, right]) {
					expect(child.translations[edition]).toMatchObject({
						text: parent.text,
						startWordIndex: parent.startWordIndex,
						endWordIndex: parent.endWordIndex,
						status: 'to review'
					});
					expect(child.translations[edition]).not.toBe(parent);
				}
				expect(clip.translations[edition]).not.toBe(right.translations[edition]);
			}
		}
	);
});
