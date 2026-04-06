import { vi } from 'vitest';

import { globalState } from '$lib/runes/main.svelte';
import { ProjectEditorState, Timeline } from '$lib/classes';
import Settings from '$lib/classes/Settings.svelte';
import { SubtitleClip } from '$lib/classes/Clip.svelte';
import type { Project } from '$lib/classes/Project';
import { Quran, Surah, Verse, Word } from '$lib/classes/Quran';
import { SubtitleTrack } from '$lib/classes/Track.svelte';
import type { Style } from '$lib/classes/VideoStyle.svelte';

export type SubtitlesEditorProjectFixture = {
	clips: SubtitleClip[];
	subtitleTrack: SubtitleTrack;
};

type SubtitlesEditorProjectOptions = {
	initialSurah?: number;
	initialVerse?: number;
};

function createVerseLabel(surahId: number, verseId: number, wordIndex: number): string {
	return `W${surahId}V${verseId}-${wordIndex + 1}`;
}

function createVerse(surahId: number, verseId: number, wordCount: number): Verse {
	return new Verse(
		verseId,
		Array.from({ length: wordCount }, (_unused, wordIndex) => {
			const label = createVerseLabel(surahId, verseId, wordIndex);
			return new Word(`A${label}`, `T${label}`, label);
		})
	);
}

export function seedSubtitlesEditorQuranFixture(): void {
	Quran.surahs = [
		new Surah(1, 'الفاتحة', 'Al-Fatihah', 'The Opening', 2, 'الفاتحة الطويلة', 'Meccan', [
			createVerse(1, 1, 3),
			createVerse(1, 2, 2)
		]),
		new Surah(2, 'البقرة', 'Al-Baqarah', 'The Cow', 2, 'البقرة الطويلة', 'Medinan', [
			createVerse(2, 1, 2),
			createVerse(2, 2, 3)
		])
	];
}

export function setupSubtitlesEditorProjectFixture(
	options: SubtitlesEditorProjectOptions = {}
): SubtitlesEditorProjectFixture {
	const { initialSurah = 2, initialVerse = 1 } = options;

	const projectEditorState = new ProjectEditorState();
	projectEditorState.subtitlesEditor.selectedSurah = initialSurah;
	projectEditorState.subtitlesEditor.selectedVerse = initialVerse;
	projectEditorState.subtitlesEditor.startWordIndex = 0;
	projectEditorState.subtitlesEditor.endWordIndex = 0;
	projectEditorState.videoPreview.isPlaying = false;
	projectEditorState.videoPreview.scrollTimelineToCursor = vi.fn();
	projectEditorState.timeline.cursorPosition = 0;
	projectEditorState.timeline.movePreviewTo = 0;

	const subtitleTrack = new SubtitleTrack();
	const clips = [
		new SubtitleClip(0, 999, 1, 1, 0, 1, 'First subtitle', [], true, false),
		new SubtitleClip(1000, 1999, 1, 2, 0, 0, 'Second subtitle', [], true, false),
		new SubtitleClip(2000, 2999, 2, 2, 1, 2, 'Third subtitle', [], false, false)
	];

	subtitleTrack.clips = clips;

	globalState.currentProject = {
		projectEditorState,
		content: {
			timeline: new Timeline([subtitleTrack])
		},
		detail: {
			updateVideoDetailAttributes: vi.fn(),
			percentageCaptioned: 0,
			translations: {}
		}
	} as unknown as Project;

	vi.spyOn(globalState, 'getStyle').mockReturnValue({ value: 0 } as Style);

	const settings = new Settings();
	settings.shortcuts.SUBTITLES_EDITOR.SELECT_NEXT_WORD.keys = ['ArrowRight'];
	settings.shortcuts.SUBTITLES_EDITOR.SELECT_PREVIOUS_WORD.keys = ['ArrowLeft'];
	settings.shortcuts.SUBTITLES_EDITOR.RESET_START_CURSOR.keys = ['Home'];
	settings.shortcuts.SUBTITLES_EDITOR.SELECT_ALL_WORDS.keys = ['A'];
	settings.shortcuts.SUBTITLES_EDITOR.SET_END_TO_LAST.keys = ['End'];
	settings.shortcuts.SUBTITLES_EDITOR.SET_END_TO_PREVIOUS.keys = ['PageUp'];
	settings.shortcuts.SUBTITLES_EDITOR.ADD_SUBTITLE.keys = ['Enter'];
	settings.shortcuts.SUBTITLES_EDITOR.REMOVE_LAST_SUBTITLE.keys = ['Backspace'];
	settings.shortcuts.SUBTITLES_EDITOR.EDIT_LAST_SUBTITLE.keys = ['E'];
	settings.shortcuts.SUBTITLES_EDITOR.ADD_SILENCE.keys = ['S'];
	settings.shortcuts.SUBTITLES_EDITOR.ADD_CUSTOM_TEXT_CLIP.keys = ['C'];
	settings.shortcuts.PREDEFINED_SUBTITLES.ADD_BASMALA.keys = ['B'];
	settings.shortcuts.PREDEFINED_SUBTITLES.ADD_ISTIADHAH.keys = ['I'];
	globalState.settings = settings;

	return { clips, subtitleTrack };
}

export function resetSubtitlesEditorProjectFixture(): void {
	Quran.surahs = [];
	globalState.currentProject = null;
	globalState.settings = undefined;
}
