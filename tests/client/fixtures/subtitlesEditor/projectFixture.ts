import { vi, type MockInstance } from 'vitest';

import { globalState } from '$lib/runes/main.svelte';
import { ProjectEditorState, Timeline } from '$lib/classes';
import Settings from '$lib/classes/Settings.svelte';
import {
	PredefinedSubtitleClip,
	SubtitleClip,
	type ClipWithTranslation
} from '$lib/classes/Clip.svelte';
import type { Project } from '$lib/classes/Project';
import { Quran, Surah, Verse, Word } from '$lib/classes/Quran';
import { SubtitleTrack } from '$lib/classes/Track.svelte';
import type { Style } from '$lib/classes/VideoStyle.svelte';

export type TestWordDefinition =
	| string
	| {
			arabic: string;
			transliteration?: string;
			translation?: string;
	  };

export type TestVerseDefinition = {
	id: number;
	words: TestWordDefinition[];
};

export type TestSurahDefinition = {
	id: number;
	name: string;
	arabic?: string;
	translation?: string;
	arabicLong?: string;
	revelationPlace?: string;
	verses: TestVerseDefinition[];
};

export type SubtitlesEditorProjectFixture = {
	clips: SubtitleClip[];
	subtitleTrack: SubtitleTrack;
	spies: {
		addCustomClip: MockInstance;
		addPredefinedSubtitle: MockInstance;
		addSilence: MockInstance;
		addSubtitle: MockInstance;
		editSubtitle: MockInstance;
		getStyle: MockInstance;
		removeClip: MockInstance;
		removeLastClip: MockInstance;
		updateVideoDetailAttributes: MockInstance;
		updateVideoPreviewUI: MockInstance;
	};
};

type SubtitlesEditorProjectOptions = {
	initialSurah?: number;
	initialVerse?: number;
	startWordIndex?: number;
	endWordIndex?: number;
	showWordTranslation?: boolean;
	showWordTransliteration?: boolean;
	timelineCursorPosition?: number;
	quranSurahs?: TestSurahDefinition[];
	clips?: SubtitleClip[];
	editSubtitle?: SubtitleClip | PredefinedSubtitleClip | ClipWithTranslation | null;
	pendingSplitEditNextId?: number | null;
};

const defaultQuranFixture: TestSurahDefinition[] = [
	{
		id: 1,
		name: 'Al-Fatihah',
		arabic: 'الفاتحة',
		translation: 'The Opening',
		arabicLong: 'الفاتحة الطويلة',
		revelationPlace: 'Meccan',
		verses: [
			{
				id: 1,
				words: ['W1V1-1', 'W1V1-2', 'W1V1-3']
			},
			{
				id: 2,
				words: ['W1V2-1', 'W1V2-2']
			}
		]
	},
	{
		id: 2,
		name: 'Al-Baqarah',
		arabic: 'البقرة',
		translation: 'The Cow',
		arabicLong: 'البقرة الطويلة',
		revelationPlace: 'Medinan',
		verses: [
			{
				id: 1,
				words: ['W2V1-1', 'W2V1-2']
			},
			{
				id: 2,
				words: ['W2V2-1', 'W2V2-2', 'W2V2-3']
			}
		]
	}
];

function createDefaultWordLabel(surahId: number, verseId: number, wordIndex: number): string {
	return `W${surahId}V${verseId}-${wordIndex + 1}`;
}

function createWord(
	surahId: number,
	verseId: number,
	wordIndex: number,
	definition: TestWordDefinition
): Word {
	if (typeof definition === 'string') {
		return new Word(definition, `T${definition}`, definition);
	}

	const fallback = createDefaultWordLabel(surahId, verseId, wordIndex);

	return new Word(
		definition.arabic,
		definition.transliteration ?? `T${fallback}`,
		definition.translation ?? fallback
	);
}

function createVerse(surahId: number, verseDefinition: TestVerseDefinition): Verse {
	return new Verse(
		verseDefinition.id,
		verseDefinition.words.map((word, wordIndex) =>
			createWord(surahId, verseDefinition.id, wordIndex, word)
		)
	);
}

function createSurah(surahDefinition: TestSurahDefinition): Surah {
	return new Surah(
		surahDefinition.id,
		surahDefinition.arabic ?? `S${surahDefinition.id}`,
		surahDefinition.name,
		surahDefinition.translation ?? surahDefinition.name,
		surahDefinition.verses.length,
		surahDefinition.arabicLong ?? `${surahDefinition.name} Long`,
		surahDefinition.revelationPlace ?? 'Meccan',
		surahDefinition.verses.map((verseDefinition) =>
			createVerse(surahDefinition.id, verseDefinition)
		)
	);
}

export function seedSubtitlesEditorQuranFixture(
	quranSurahs: TestSurahDefinition[] = defaultQuranFixture
): void {
	Quran.surahs = quranSurahs.map((surahDefinition) => createSurah(surahDefinition));
}

export function setupSubtitlesEditorProjectFixture(
	options: SubtitlesEditorProjectOptions = {}
): SubtitlesEditorProjectFixture {
	const {
		initialSurah = 2,
		initialVerse = 1,
		startWordIndex = 0,
		endWordIndex = 0,
		showWordTranslation = true,
		showWordTransliteration = false,
		timelineCursorPosition = 0,
		quranSurahs,
		clips = [
			new SubtitleClip(0, 999, 1, 1, 0, 1, 'First subtitle', [], true, false),
			new SubtitleClip(1000, 1999, 1, 2, 0, 0, 'Second subtitle', [], true, false),
			new SubtitleClip(2000, 2999, 2, 2, 1, 2, 'Third subtitle', [], false, false)
		],
		editSubtitle = null,
		pendingSplitEditNextId = null
	} = options;

	if (quranSurahs) {
		seedSubtitlesEditorQuranFixture(quranSurahs);
	}

	const projectEditorState = new ProjectEditorState();
	projectEditorState.subtitlesEditor.selectedSurah = initialSurah;
	projectEditorState.subtitlesEditor.selectedVerse = initialVerse;
	projectEditorState.subtitlesEditor.startWordIndex = startWordIndex;
	projectEditorState.subtitlesEditor.endWordIndex = endWordIndex;
	projectEditorState.subtitlesEditor.showWordTranslation = showWordTranslation;
	projectEditorState.subtitlesEditor.showWordTransliteration = showWordTransliteration;
	projectEditorState.subtitlesEditor.editSubtitle = editSubtitle;
	projectEditorState.subtitlesEditor.pendingSplitEditNextId = pendingSplitEditNextId;
	projectEditorState.videoPreview.isPlaying = false;
	projectEditorState.videoPreview.scrollTimelineToCursor = vi.fn();
	projectEditorState.timeline.cursorPosition = timelineCursorPosition;
	projectEditorState.timeline.movePreviewTo = 0;

	const subtitleTrack = new SubtitleTrack();
	subtitleTrack.clips = clips;

	const updateVideoDetailAttributes = vi.fn();
	const addCustomClip = vi.fn();

	globalState.currentProject = {
		projectEditorState,
		content: {
			timeline: new Timeline([subtitleTrack]),
			projectTranslation: {
				addedTranslationEditions: [],
				getPredefinedSubtitleTranslation: vi.fn(),
				getTranslations: vi.fn().mockResolvedValue({})
			},
			videoStyle: {
				addCustomClip
			}
		},
		detail: {
			updateVideoDetailAttributes,
			percentageCaptioned: 0,
			translations: {}
		}
	} as unknown as Project;

	const getStyle = vi.spyOn(globalState, 'getStyle').mockReturnValue({ value: 0 } as Style);
	const updateVideoPreviewUI = vi
		.spyOn(globalState, 'updateVideoPreviewUI')
		.mockImplementation(() => undefined);

	const addSubtitle = vi.spyOn(subtitleTrack, 'addSubtitle').mockResolvedValue(true);
	const editSubtitleSpy = vi.spyOn(subtitleTrack, 'editSubtitle').mockResolvedValue(undefined);
	const addSilence = vi.spyOn(subtitleTrack, 'addSilence').mockReturnValue(true);
	const addPredefinedSubtitle = vi
		.spyOn(subtitleTrack, 'addPredefinedSubtitle')
		.mockReturnValue(true);
	const removeClip = vi.spyOn(subtitleTrack, 'removeClip');
	const removeLastClip = vi.spyOn(subtitleTrack, 'removeLastClip');

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
	(settings.shortcuts.PREDEFINED_SUBTITLES.ADD_AMIN.keys as string[]) = ['M'];
	(settings.shortcuts.PREDEFINED_SUBTITLES.ADD_TAKBIR.keys as string[]) = ['T'];
	(settings.shortcuts.PREDEFINED_SUBTITLES.ADD_TAHMEED.keys as string[]) = ['H'];
	(settings.shortcuts.PREDEFINED_SUBTITLES.ADD_TASLEEM.keys as string[]) = ['L'];
	(settings.shortcuts.PREDEFINED_SUBTITLES.ADD_SADAQA.keys as string[]) = ['D'];
	globalState.settings = settings;

	return {
		clips,
		subtitleTrack,
		spies: {
			addCustomClip,
			addPredefinedSubtitle,
			addSilence,
			addSubtitle,
			editSubtitle: editSubtitleSpy,
			getStyle,
			removeClip,
			removeLastClip,
			updateVideoDetailAttributes,
			updateVideoPreviewUI
		}
	};
}

export function resetSubtitlesEditorProjectFixture(): void {
	Quran.surahs = [];
	globalState.currentProject = null;
	globalState.settings = undefined;
}
