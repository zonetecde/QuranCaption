import type SubtitlesEditor from '$lib/components/projectEditor/tabs/subtitlesEditor/SubtitlesEditor.svelte';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
	ClipWithTranslation,
	PredefinedSubtitleClip,
	SilenceClip,
	SubtitleClip
} from './Clip.svelte';
import { ProjectEditorTabs } from './enums';
import { SerializableBase } from './misc/SerializableBase';
import { globalState } from '$lib/runes/main.svelte';
import ModalManager from '$lib/components/modals/ModalManager';

/**
 * État de l'éditeur de projet, utilisé pour gérer l'interface utilisateur et les interactions
 * dans l'éditeur de projet.
 */
export class ProjectEditorState extends SerializableBase {
	// L'onglet actuellement sélectionné dans l'éditeur de projet
	currentTab: ProjectEditorTabs = $state(ProjectEditorTabs.VideoEditor);

	// Indique si on montre ou non l'indication "Drop your files here"
	showDropScreen: boolean = $state(false);

	// Indique quelle(s) section(s) de l'éditeur sont étendues
	sections: {
		[name: string]: {
			extended: boolean;
		};
	} = $state({});

	// Timeline
	timeline: TimelineState = $state(new TimelineState());

	// Video preview
	videoPreview: VideoPreviewState = $state(new VideoPreviewState());

	// Subtitles editor
	subtitlesEditor: SubtitlesEditorState = $state(new SubtitlesEditorState());

	// Translations editor
	translationsEditor: TranslationsEditorState = $state(new TranslationsEditorState());

	// Styles editor
	stylesEditor: StylesEditorState = $state(new StylesEditorState());

	// Export
	export: ExportState = $state(new ExportState());

	// Hauteur de la section supérieure dans chaque onglet
	upperSectionHeight: number = $state(68);
}

export class StylesEditorState extends SerializableBase {
	// Indique la position du scroll dans l'éditeur de styles
	scrollPosition: number = $state(0);

	// Indique quel est la sélection actuelle dans l'éditeur de styles (global/arabic/translation)
	currentSelection: 'global' | 'arabic' | 'translation' = $state('global');

	// Indique quelle traduction est actuellement sélectionnée dans l'éditeur de styles
	currentSelectionTranslation: string = $state('');

	// Indique la requête de recherche actuelle dans l'éditeur de styles
	searchQuery: string = $state('');

	// Indique les sous-titres actuellement sélectionnés dans l'éditeur de styles
	selectedSubtitles: SubtitleClip[] = $state([]);

	// Indique la catégorie sur laquelle on doit scroll et highlight quelque seconde
	scrollAndHighlight: string | null = $state(null);

	getCurrentSelection(): 'global' | 'arabic' | string {
		if (this.currentSelection === 'global' || this.currentSelection === 'arabic') {
			return this.currentSelection;
		}
		return this.currentSelectionTranslation;
	}

	isSelected(id: number) {
		return this.selectedSubtitles.some((subtitle) => subtitle.id === id);
	}

	toggleSelection(clip: SubtitleClip) {
		if (clip instanceof SubtitleClip === false) return;

		if (this.isSelected(clip.id)) {
			this.selectedSubtitles = this.selectedSubtitles.filter((subtitle) => subtitle.id !== clip.id);
		} else {
			this.selectedSubtitles.push(clip);
		}
	}

	removeSelection(id: number) {
		this.selectedSubtitles = this.selectedSubtitles.filter((subtitle) => subtitle.id !== id);
	}

	clearSelection() {
		globalState.getSubtitlesEditorState.editSubtitle = null;
		this.selectedSubtitles = [];
	}
}

/**
 * État de la timeline dans l'éditeur de projet.
 */
export class TimelineState extends SerializableBase {
	// Niveau de zoom de la timeline
	zoom: number = $state(29.25);

	// Position du curseur dans la timeline
	cursorPosition: number = $state(1);

	// Indique si on doit afficher ou non le curseur de la timeline
	showCursor: boolean = $state(true);

	// State permettant de trigger le changement du temps de la vidéo et de l'audio dans la preview
	movePreviewTo: number = $state(0);

	// Position du scroll
	scrollX: number = $state(0);
}

/**
 * État de la prévisualisation vidéo dans l'éditeur de projet.
 */
export class VideoPreviewState extends SerializableBase {
	// Indique si la prévisualisation vidéo est en pause
	isPlaying: boolean = $state(false);

	// Indique si la prévisualisation vidéo est en plein écran
	isFullscreen: boolean = $state(false);

	// Indique si on doit mute la vidéo
	showVideosAndAudios: boolean = $state(false);

	// Fonction pour toggle play/pause, sera définie par le composant VideoPreview
	togglePlayPause: () => void = () => {};

	// Fonction pour scroll la timeline à la position du curseur, sera définie par le composant Timeline
	scrollTimelineToCursor: () => void = () => {};

	async toggleFullScreen() {
		const appWindow = getCurrentWindow();

		try {
			globalState.currentProject!.projectEditorState.videoPreview.isFullscreen =
				!globalState.currentProject!.projectEditorState.videoPreview.isFullscreen;
			await appWindow.setFullscreen(
				globalState.currentProject!.projectEditorState.videoPreview.isFullscreen
			);
		} catch (err: any) {
			ModalManager.errorModal(
				'Error',
				'There was an error toggling fullscreen!',
				JSON.stringify(err)
			);
		}
	}
}

export class SubtitlesEditorState extends SerializableBase {
	// Indique la sourate actuellement sélectionnée dans l'éditeur de sous-titres
	selectedSurah: number = $state(1);

	// Indique le numéro du verset actuellement sélectionné dans l'éditeur de sous-titres
	selectedVerse: number = $state(1);

	// Indique l'index du premier mot actuellement sélectionné dans l'éditeur de sous-titres
	startWordIndex: number = $state(0);

	// Indique l'index du dernier mot actuellement sélectionné dans l'éditeur de sous-titres
	endWordIndex: number = $state(0);

	// Playback speed
	playbackSpeed: number = $state(1.0);

	// Affiche la traduction des mots
	showWordTranslation: boolean = $state(true);

	// Affiche la translittération des mots
	showWordTransliteration: boolean = $state(false);

	// Indique le sous-titre à éditer dans l'éditeur de sous-titres (null si aucun)
	editSubtitle: SubtitleClip | PredefinedSubtitleClip | ClipWithTranslation | SilenceClip | null =
		$state(null);

	// Nombre initial de segments à review (set lors de l'auto-segmentation)
	// Utilisé pour afficher la barre de progression des segments à review
	initialLowConfidenceCount: number = $state(0);

	// Filtre par nombre de mots minimum dans la liste des sous-titres
	minWordCount: number = $state(0);
}

export class TranslationsEditorState extends SerializableBase {
	// Indique si l'utilisateur montre les instructions pour utiliser l'IA
	showAIInstructions: boolean = $state(false);

	// Indique le filtre actuellement appliqué dans l'éditeur de traductions
	filters: { [statut: string]: boolean } = $state({
		'to review': true,
		'ai error': true,
		'ai trimmed': true,
		'automatically trimmed': true,
		reviewed: true,
		'completed by default': false
	});

	searchQuery: string = $state('');

	checkOnlyFilters(list: string[]) {
		for (const key in this.filters) {
			if (list.includes(key)) {
				this.filters[key] = true;
			} else {
				this.filters[key] = false;
			}
		}
	}
}

export class ExportState extends SerializableBase {
	// Indique le type d'export choisie
	selectedChoice: 'video' | 'subtitles' | 'chapters' | 'project' = $state('video');

	/*
	 * ============================================
	 * SUBTITLES EXPORT STATES
	 * ============================================
	 */

	// Le format de sous-titre choisi
	subtitleFormat: 'SRT' | 'VTT' = $state('SRT');

	// Indique les cibles incluses dans l'export
	includedTarget: { [target: string]: boolean } = $state({});

	// Indique si on exporte les numéros de verset ou pas
	exportVerseNumbers: { [target: string]: boolean } = $state({});

	// Indique le format du texte arabe
	arabicTextFormat: 'Plain' | 'V1' | 'V2' = $state('Plain');

	// Indique la sélection d'exportation des chapitres YouTube
	ytbChaptersChoice: 'Each Surah' | 'Each Verse' = $state('Each Surah');

	// Indique la partie de la vidéo à exporter
	videoStartTime: number = $state(0);
	videoEndTime: number = $state(0);
	fps: number = $state(30);
	chunkSize: number = $state(50);
	customFileName: string = $state('');
}

SerializableBase.registerChildClass(ProjectEditorState, 'timeline', TimelineState);
SerializableBase.registerChildClass(
	ProjectEditorState,
	'translationsEditor',
	TranslationsEditorState
);
SerializableBase.registerChildClass(ProjectEditorState, 'videoPreview', VideoPreviewState);
SerializableBase.registerChildClass(ProjectEditorState, 'subtitlesEditor', SubtitlesEditorState);
SerializableBase.registerChildClass(ProjectEditorState, 'stylesEditor', StylesEditorState);
SerializableBase.registerChildClass(ProjectEditorState, 'export', ExportState);
