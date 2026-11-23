import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
	Category,
	SilenceClip,
	Style,
	StylesData,
	SubtitleClip,
	VerseRange,
	VideoStyle
} from '$lib/classes';
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

	test.each([
		{
			name: 'Qaloon merge before the cut',
			cursor: 999,
			silence: false,
			sameVerse: false,
			qaloon: true,
			visible: true
		},
		{
			name: 'Qaloon merge after the cut',
			cursor: 1000,
			silence: false,
			sameVerse: false,
			qaloon: true,
			visible: true
		},
		...[999, 1000, 1250, 1499, 1500].map((cursor) => ({
			name: `same verse with silence at ${cursor} ms`,
			cursor,
			silence: true,
			sameVerse: true,
			qaloon: false,
			visible: true
		})),
		...[999, 1000, 1250, 1499, 1500].map((cursor) => ({
			name: `different verses with silence at ${cursor} ms`,
			cursor,
			silence: true,
			sameVerse: false,
			qaloon: false,
			visible: false
		})),
		{
			name: 'different verses at a direct cut',
			cursor: 1000,
			silence: false,
			sameVerse: false,
			qaloon: false,
			visible: false
		}
	])('$name', ({ cursor, silence, sameVerse, qaloon, visible }) => {
		const track = new SubtitleTrack();
		track.clips = [
			new SubtitleClip(0, 999, 2, 1, 0, 0, 'First part', [], true, true),
			...(silence ? [new SilenceClip(1000, 1499)] : []),
			new SubtitleClip(
				silence ? 1500 : 1000,
				2499,
				2,
				sameVerse ? 1 : 2,
				0,
				6,
				'Second part',
				[],
				true,
				true
			)
		];
		const videoStyle = new VideoStyle();
		videoStyle.styles = [
			new StylesData('arabic', [
				new Category({
					id: 'text',
					styles: [new Style({ id: 'riwayah', value: qaloon ? 'Qaloon' : 'Hafs' })]
				})
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
			content: {
				timeline: new Timeline([track]),
				videoStyle,
				projectTranslation: { addedTranslationEditions: [] }
			}
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
		const component = render(VerseNumber);
		const overlay = component.container.querySelector<HTMLDivElement>(
			'[data-overlay-layer="verse-number"]'
		);
		if (visible) {
			expect(overlay?.textContent).toContain('2:1');
			expect(overlay?.style.opacity).toBe('0.8');
		} else {
			expect(overlay).toBeNull();
		}
	});
});
