import {
	SubtitleClip,
	TrackType,
	type Edition,
	type Project,
	type ProjectDetail,
	type PredefinedSubtitleClip,
	ProjectTranslation
} from '$lib/classes';
import { currentMenu } from 'svelte-contextmenu/stores';
import type Exportation from '$lib/classes/Exportation.svelte';
import type Settings from '$lib/classes/Settings.svelte';
import { Status } from '$lib/classes/Status';
import type { TranslationLanguageData } from '$lib/services/QdcTranslationService';
import type { AssetTrack, CustomTextTrack, SubtitleTrack } from '$lib/classes/Track.svelte';
import type { Style, StyleName } from '$lib/classes/VideoStyle.svelte';

class GlobalState {
	// Liste des détails des projets de l'utilisateur
	userProjectsDetails: ProjectDetail[] = $state([]);

	// Projet actuellement sélectionné
	currentProject: Project | null = $state(null);

	// Contient tout les exports (en cours ou accomplis)
	exportations: Exportation[] = $state([]);

	// Contient tout les traductions disponibles
	availableTranslations: Record<string, TranslationLanguageData> = $state({});

	// Contient les traductions QDC disponibles groupees par langue
	qdcAvailableTranslations: Record<string, TranslationLanguageData> = $state({});

	// Cache pour le téléchargement des traductions
	caches = $state(new Map<string, string>());

	settings: Settings | undefined = $state(undefined);

	uiState = $state({
		// Indique si on affiche le moniteur d'exportation
		showExportMonitor: false,
		showAiTranslationTelemetryPrompt: false,
		aiTranslationTelemetryPendingCount: 0,
		aiTranslationTelemetrySubmitting: false,
		isSettingsOpen: false,
		selectedStatuses: Status.getAllStatuses(),
		filteredProjects: [] as ProjectDetail[],
		searchQuery: '',
		settingsTab: 'shortcuts' as
			| 'shortcuts'
			| 'theme'
			| 'ai-key'
			| 'quran-integration'
			| 'backup'
			| 'support'
			| 'contact'
			| 'about',
		isTourActive: false
	});

	shared = $state({
		autoSegmentationWizard: null as unknown
	});

	get getSubtitleTrack() {
		return this.currentProject!.content.timeline.getFirstTrack(
			TrackType.Subtitle
		)! as SubtitleTrack;
	}

	get getAudioTrack() {
		return this.currentProject!.content.timeline.getFirstTrack(TrackType.Audio)! as AssetTrack;
	}

	get getVideoTrack() {
		return this.currentProject!.content.timeline.getFirstTrack(TrackType.Video)! as AssetTrack;
	}

	get getCustomClipTrack() {
		return this.currentProject!.content.timeline.getFirstTrack(
			TrackType.CustomClip
		)! as CustomTextTrack;
	}

	get getSubtitleClips(): SubtitleClip[] {
		const clips = this.getSubtitleTrack.clips;
		return clips.filter((clip) => clip.type === 'Subtitle') as SubtitleClip[];
	}

	get getPredefinedSubtitleClips(): PredefinedSubtitleClip[] {
		const clips = this.getSubtitleTrack.clips;
		return clips.filter((clip) => clip.type === 'Pre-defined Subtitle') as PredefinedSubtitleClip[];
	}

	get getProjectTranslation(): ProjectTranslation {
		return this.currentProject!.content.projectTranslation;
	}

	get getTranslationsState() {
		return this.currentProject!.projectEditorState.translationsEditor;
	}

	get getExportState() {
		return this.currentProject!.projectEditorState.export;
	}

	get getVideoStyle() {
		return this.currentProject!.content.videoStyle;
	}

	get getSectionsState() {
		if (this.currentProject) return this.currentProject!.projectEditorState.sections;
		return {}; // Sections des paramètres par exemple alors qu'aucun projet n'est ouvert
	}

	get getStylesState() {
		return this.currentProject!.projectEditorState.stylesEditor;
	}

	get getSubtitlesEditorState() {
		return this.currentProject!.projectEditorState.subtitlesEditor;
	}

	get getVideoPreviewState() {
		return this.currentProject!.projectEditorState.videoPreview;
	}

	get getTimelineState() {
		return this.currentProject!.projectEditorState.timeline;
	}

	getStyle(t: 'arabic' | 'translation' | string, s: StyleName): Style {
		if (this.currentProject) {
			const style = this.getVideoStyle.getStylesOfTarget(t).findStyle(s);
			if (style) return style;
			return { value: '' } as unknown as Style;
		}
		return { value: '' } as unknown as Style;
	}

	updateVideoPreviewUI() {
		globalState.getTimelineState.cursorPosition =
			globalState.getTimelineState.cursorPosition + 0.01;
	}

	getEditionFromAuthor(author: string): Edition | null {
		for (const translationsMap of [this.availableTranslations, this.qdcAvailableTranslations]) {
			for (const lang of Object.keys(translationsMap)) {
				const edition = translationsMap[lang].translations.find((e) => e.author === author);
				if (edition) return edition;
			}
		}
		return null;
	}

	/**
	 * Récupère les métadonnées de traduction pour une langue donnée.
	 * @param language La langue pour laquelle récupérer les métadonnées de traduction.
	 * @returns Les métadonnées de traduction pour la langue spécifiée.
	 */
	getTranslationMetadata(language: string): TranslationLanguageData | null {
		const exactMatch =
			this.availableTranslations[language] ?? this.qdcAvailableTranslations[language];
		if (exactMatch) return exactMatch;

		const normalizedLanguage = language.trim().toLowerCase();
		for (const translationsMap of [this.availableTranslations, this.qdcAvailableTranslations]) {
			for (const [key, value] of Object.entries(translationsMap)) {
				if (key.trim().toLowerCase() === normalizedLanguage) {
					return value;
				}
			}
		}

		// Utilise les métadonnées de traduction en anglais comme solution de repli
		const englishFallback =
			this.availableTranslations['English'] ?? this.qdcAvailableTranslations['English'];
		if (englishFallback) return englishFallback;

		for (const translationsMap of [this.availableTranslations, this.qdcAvailableTranslations]) {
			const firstValue = Object.values(translationsMap)[0];
			if (firstValue) return firstValue;
		}

		return null;
	}

	closeAllMenus() {
		currentMenu.set(null);
	}
}

export const globalState = new GlobalState();
