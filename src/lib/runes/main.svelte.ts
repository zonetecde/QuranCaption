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
import type { ManualWordByWordDraftWord } from '$lib/services/WbwHelper';
import type { AiVideoState } from '$lib/components/aiVideo/types';
import type { PresetLibraryState } from '$lib/components/projectEditor/tabs/styleEditor/presets/types';

export type QuickTimelineEditorMode = 'translation' | 'wbw' | 'subtitle' | 'wbwTimestamp';

export type AppPage = 'home' | 'ai-video';

class GlobalState {
	// Liste des détails des projets de l'utilisateur
	userProjectsDetails: ProjectDetail[] = $state([]);

	// Projet actuellement sélectionné
	currentProject: Project | null = $state(null);

	// Current app page (when no project is open)
	currentPage: AppPage = $state('home');

	// Etat complet de la feature AI Video
	aiVideo: AiVideoState = $state({
		step: 'input',
		video: {
			sourceMode: 'youtube',
			prompt: '',
			youtubeUrl: '',
			model: 'Pika Labs / High Quality',
			resolution: 'portrait'
		},
		ai: {
			letAiChoose: true,
			isGeneratingPlan: false
		},
		audio: {
			useLocal: false,
			localPath: '',
			reciterName: '',
			reciter: null
		},
		selectedVerseRange: {
			surah: 1,
			startVerse: 1,
			endVerse: 7
		},
		selectedTranslation: null,
		review: {
			title: '',
			videoPrompt: '',
			reciterName: '',
			verseRange: {
				surah: 1,
				startVerse: 1,
				endVerse: 7
			}
		},
		isCreatingProject: false,
		generationStatus: '',
		reciterOptions: [],
		isLoadingReciters: true
	});

	// Etat complet de la librairie de presets communautaires
	presetLibrary: PresetLibraryState = $state({
		libraryOpen: false,
		publishMode: false,

		communitySearchQuery: '',
		selectedTag: '',
		selectedOrientation: 'all',
		selectedSort: 'most_liked',
		communityPresets: [],
		popularTags: [],
		isLoadingCommunity: false,
		communityError: null,
		downloadingPresetId: null,
		likingPresetId: null,
		likedPresetIds: new Set<string>(),

		publishName: '',
		publishAuthorName: '',
		publishDescription: '',
		publishTags: '',
		publishPreviewBlob: null,
		publishPreviewUrl: '',
		publishError: null,
		isGeneratingPreview: false,
		isPublishing: false,
		lastPreviewClipId: null,
		includedCustomClipIds: new Set<number>(),
		lastCapturedInclusion: null,

		localSearchQuery: '',
		modalMode: null
	});

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
		settingsTab: 'support' as
			| 'shortcuts'
			| 'theme'
			| 'notifications'
			| 'ai-key'
			| 'quran-integration'
			| 'backup'
			| 'support'
			| 'contact'
			| 'about',
		isTourActive: false
	});

	shared = $state({
		autoSegmentationWizard: null as unknown,
		projectSearch: {
			openRequest: 0
		},
		quickTimelineEditor: {
			active: false,
			clipId: null as number | null,
			mode: null as QuickTimelineEditorMode | null,
			previousInlineStyleMode: null as boolean | null,
			previousEditSubtitleId: null as number | null,
			previousPendingSplitEditNextId: null as number | null
		},
		translationScrollTargetClipId: null as number | null,
		wbwEdit: {
			active: false,
			clipId: null as number | null,
			currentWordIndex: 0,
			draftWords: [] as ManualWordByWordDraftWord[],
			dragBoundaryIndex: null as number | null,
			previousTimelineZoom: null as number | null
		}
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
		globalState.getTimelineState.previewRefreshToken++;
	}

	/**
	 * Ouvre l'éditeur rapide superposé à la timeline pour un clip donné.
	 * @param {number} clipId ID du clip à éditer.
	 * @param {QuickTimelineEditorMode} mode Mode de l'éditeur rapide.
	 * @returns {void}
	 */
	openQuickTimelineEditor(clipId: number, mode: QuickTimelineEditorMode): void {
		if (!this.currentProject) return;

		const translationsState = this.getTranslationsState;
		const subtitlesEditorState = this.getSubtitlesEditorState;
		if (!this.shared.quickTimelineEditor.active) {
			this.shared.quickTimelineEditor.previousInlineStyleMode = translationsState.isInlineStyleMode;
			this.shared.quickTimelineEditor.previousEditSubtitleId =
				subtitlesEditorState.editSubtitle?.id ?? null;
			this.shared.quickTimelineEditor.previousPendingSplitEditNextId =
				subtitlesEditorState.pendingSplitEditNextId;
		}

		this.shared.quickTimelineEditor.active = true;
		this.shared.quickTimelineEditor.clipId = clipId;
		this.shared.quickTimelineEditor.mode = mode;
		translationsState.isInlineStyleMode = mode === 'wbw';

		if (mode === 'subtitle' || mode === 'wbwTimestamp') {
			subtitlesEditorState.editSubtitle = this.getSubtitleTrack.getClipById(clipId) as
				| SubtitleClip
				| PredefinedSubtitleClip
				| null;
			subtitlesEditorState.pendingSplitEditNextId = null;
		}
	}

	/**
	 * Ferme l'éditeur rapide de la timeline et restaure le mode inline précédent.
	 * @returns {void}
	 */
	closeQuickTimelineEditor(): void {
		const previousInlineStyleMode = this.shared.quickTimelineEditor.previousInlineStyleMode;
		if (this.currentProject && previousInlineStyleMode !== null) {
			this.getTranslationsState.isInlineStyleMode = previousInlineStyleMode;
			this.getSubtitlesEditorState.editSubtitle = (
				this.shared.quickTimelineEditor.previousEditSubtitleId !== null
					? (this.getSubtitleTrack.getClipById(
							this.shared.quickTimelineEditor.previousEditSubtitleId
						) ?? null)
					: null
			) as SubtitleClip | PredefinedSubtitleClip | null;
			this.getSubtitlesEditorState.pendingSplitEditNextId =
				this.shared.quickTimelineEditor.previousPendingSplitEditNextId;
		}

		this.shared.quickTimelineEditor.active = false;
		this.shared.quickTimelineEditor.clipId = null;
		this.shared.quickTimelineEditor.mode = null;
		this.shared.quickTimelineEditor.previousInlineStyleMode = null;
		this.shared.quickTimelineEditor.previousEditSubtitleId = null;
		this.shared.quickTimelineEditor.previousPendingSplitEditNextId = null;
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
