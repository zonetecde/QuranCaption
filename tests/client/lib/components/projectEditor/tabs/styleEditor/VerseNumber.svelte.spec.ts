import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Category, Style, StylesData, SubtitleClip, VerseRange, VideoStyle } from '$lib/classes';
import { ProjectEditorState } from '$lib/classes/ProjectEditorState.svelte';
import { SubtitleTrack } from '$lib/classes/Track.svelte';
import { Timeline } from '$lib/classes/Timeline.svelte';
import { globalState } from '$lib/runes/main.svelte';
import { RiwayahProvider } from '$lib/services/RiwayahProvider';
import VerseNumber from '$lib/components/projectEditor/tabs/styleEditor/VerseNumber.svelte';

vi.mock('$lib/services/verticalDrag', () => ({ mouseDrag: () => ({}) }));

describe('verse number fades', () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		globalState.currentProject = null;
	});

	test.each([999, 1000])(
		'keeps opacity across contiguous clips of the same Qaloon verse at %s ms',
		(cursor) => {
			const track = new SubtitleTrack();
			track.clips = [
				new SubtitleClip(0, 999, 2, 1, 0, 0, 'First part', [], true, true),
				new SubtitleClip(1000, 1999, 2, 2, 0, 6, 'Second part', [], true, true)
			];
			const videoStyle = new VideoStyle();
			videoStyle.styles = [
				new StylesData('arabic', [
					new Category({ id: 'text', styles: [new Style({ id: 'riwayah', value: 'Qaloon' })] })
				]),
				new StylesData('global', [
					new Category({
						id: 'general',
						styles: [
							new Style({ id: 'fade-duration', value: 500 }),
							new Style({ id: 'show-verse-number', value: true }),
							new Style({ id: 'verse-number-format', value: '<surah>:<verse>' }),
							new Style({ id: 'verse-number-vertical-position', value: 0 }),
							new Style({ id: 'verse-number-horizontal-position', value: 0 }),
							new Style({
								id: 'verse-number-text-style',
								valueType: 'composite',
								value: [new Style({ id: 'opacity', value: 0.8 })]
							})
						]
					})
				])
			];
			const projectEditorState = new ProjectEditorState();
			projectEditorState.timeline.cursorPosition = cursor;
			globalState.currentProject = {
				projectEditorState,
				content: { timeline: new Timeline([track]), videoStyle }
			} as never;
			vi.spyOn(VerseRange, 'getExportVerseRange').mockReturnValue(
				new VerseRange([{ surah: 2, verseStart: 1, verseEnd: 2 }])
			);
			vi.spyOn(RiwayahProvider, 'getVerseSlice').mockReturnValue({
				text: '',
				words: [],
				sourceWordIndexes: [],
				suffix: '',
				targetAyahs: [1],
				relation: 'merged'
			});
			const component = render(VerseNumber, {
				currentSurah: 2,
				currentVerse: cursor < 1000 ? 1 : 2
			});
			expect(component.container.textContent).toContain('2:1');
			expect(component.container.querySelector<HTMLDivElement>('div')?.style.opacity).toBe('0.8');
		}
	);
});
