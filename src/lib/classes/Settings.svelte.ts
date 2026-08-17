import { SerializableBase } from './misc/SerializableBase';
import { writeTextFile, readTextFile, exists } from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';
import { globalState } from '$lib/runes/main.svelte';
import { AnalyticsService } from '$lib/services/AnalyticsService';
import { VersionService } from '$lib/services/VersionService.svelte';
import type { VideoStyleFileData } from './VideoStyle.svelte';
import type { ProjectDetail } from './ProjectDetail.svelte';
import { DEFAULT_EXPORT_FILE_NAME_FORMAT } from '$lib/constants/export';
import {
	WBW_TRANSLATION_LANGUAGES,
	type WbwTranslationLanguageCode
} from '$lib/services/WbwTranslationService';
import { TrackType } from './enums';
import {
	DEFAULT_PROJECT_EDITOR_LAYOUT,
	type ProjectEditorLayout
} from '$lib/constants/projectEditor';
import { PROJECT_TYPE_OPTIONS } from '$lib/types/projectType';

export type AutoSegmentationSettings = {
	minSilenceMs: number;
	minSpeechMs: number;
	padMs: number;
	cloudModel: 'Base' | 'Large';
	device: 'GPU' | 'CPU';
	includeWbwTimestamps: boolean;
	fillBySilence: boolean; // Si true, insère des SilenceClip. Sinon, étend les sous-titres.
	extendBeforeSilence: boolean; // If true, extend subtitles before silence clips.
	extendBeforeSilenceMs: number; // Extra ms added before silence when enabled.
};

export type StockMediaSettings = {
	pexelsApiKey: string;
	pixabayApiKey: string;
};

export type PerformanceProfile = 'fastest' | 'balanced' | 'low_cpu';

export type AITranslationSettings = {
	omitPromptPrefix: boolean; // If true, only include JSON input in the prompt.
	openAiApiKey: string;
	textAiApiEndpoint: string;
	advancedTrimModel: string;
	advancedTrimReasoningEffort: 'none' | 'low' | 'medium' | 'high';
	advancedAlsoAskReviewed: boolean;
	aiBoldCustomNote: string;
	aiWbwTranslationCustomNote: string;
	activeModalTab: 'legacy' | 'advanced';
};

export type ExportSettings = {
	batchSizeMode: 'auto' | 'fixed';
	batchSize: number;
	parallelCaptureWorkers: number;
	videoCodec: 'h264' | 'h265';
	performanceProfile: PerformanceProfile;
	randomBackgroundFolder: string;
};

export type DefaultValuesSettings = {
	exportFileNameFormat: string;
	youtubeVideoTitle: string;
	youtubeVideoDescription: string;
	projectCategories: string[];
	showTimelineVideoThumbnails: boolean;
};

export type SubtitleExportSettings = {
	subtitleFormat: 'SRT' | 'VTT';
	includedTarget: Record<string, boolean>;
	exportVerseNumbers: Record<string, boolean>;
	arabicTextFormat: 'Plain' | 'V1' | 'V2';
	customFileName: string;
};

export type SavedVideoStylePreset = {
	id: number;
	communityPresetId?: string;
	name: string;
	createdAt: string;
	updatedAt: string;
	resolution: { width: number; height: number };
	data: VideoStyleFileData;
};

const DEFAULT_TEXT_AI_ENDPOINT = 'https://api.openai.com/v1/responses';
export default class Settings extends SerializableBase {
	private static settingsFile: string = 'settings.json';
	private static readonly DEFAULT_EXPORT_SETTINGS: ExportSettings = {
		batchSizeMode: 'auto',
		batchSize: 64,
		parallelCaptureWorkers: 1,
		videoCodec: 'h264',
		performanceProfile: 'balanced',
		randomBackgroundFolder: ''
	};

	// État UI persistant
	persistentUiState = $state({
		// Indique si on affiche le moniteur d'exportation
		projectCardView: 'grid' as 'grid' | 'list',
		homeSortProperty: 'updatedAt' as keyof ProjectDetail,
		homeSortAscending: false,
		showWaveforms: true,
		lastClosedUpdateModal: new Date(0).toISOString(),
		lastClosedDonationPromptModal: new Date(0).toISOString(),
		lastClosedDonationBanner: new Date(0).toISOString(),
		dismissedHomepageMessageFingerprint: '',
		donationPromptImpressions: 0,
		videoExportFolder: '',
		wbwTranslationLanguage: 'en' as WbwTranslationLanguageCode,
		styleLibraryDeviceId: '',
		showTimelineWheelHints: true,
		showAntiCollisionNotice: true,
		projectEditorLayout: { ...DEFAULT_PROJECT_EDITOR_LAYOUT } as ProjectEditorLayout,
		timelineTrackOrder: [
			TrackType.CustomClip,
			TrackType.Subtitle,
			TrackType.Video,
			TrackType.Audio
		] as TrackType[],
		desktopNotificationsEnabled: true,
		hideReflectionPromptAfterExport: false,
		themeIntensity: 100,
		editorPanelScalePercent: -15,
		hasSeenTour: false,
		hasSelectedLanguage: false,
		language: 'en' as 'en' | 'fr' | 'de' | 'es' | 'zh' | 'id',
		theme: 'default' as
			| 'default'
			| 'emerald-forest'
			| 'polar-ice'
			| 'desert-gold'
			| 'vintage-paper'
			| 'oled-stealth'
			| 'ethereal-glass'
			| 'minimal-zen'
			| 'inverted-minimal-zen'
	});

	autoSegmentationSettings = $state<AutoSegmentationSettings>({
		minSilenceMs: 200,
		minSpeechMs: 1000,
		padMs: 100,
		cloudModel: 'Base',
		device: 'GPU',
		includeWbwTimestamps: false,
		fillBySilence: true,
		extendBeforeSilence: false,
		extendBeforeSilenceMs: 50
	});

	aiTranslationSettings = $state<AITranslationSettings>({
		omitPromptPrefix: false,
		openAiApiKey: '',
		textAiApiEndpoint: DEFAULT_TEXT_AI_ENDPOINT,
		advancedTrimModel: 'gpt-5.4',
		advancedTrimReasoningEffort: 'none',
		advancedAlsoAskReviewed: false,
		aiBoldCustomNote: '',
		aiWbwTranslationCustomNote: '',
		activeModalTab: 'advanced'
	});

	stockMediaSettings = $state<StockMediaSettings>({
		pexelsApiKey: '',
		pixabayApiKey: ''
	});

	exportSettings = $state<ExportSettings>({ ...Settings.DEFAULT_EXPORT_SETTINGS });
	defaultValuesSettings = $state<DefaultValuesSettings>({
		exportFileNameFormat: DEFAULT_EXPORT_FILE_NAME_FORMAT,
		youtubeVideoTitle: '',
		youtubeVideoDescription: '',
		projectCategories: [...PROJECT_TYPE_OPTIONS],
		showTimelineVideoThumbnails: true
	});

	subtitleExportSettings = $state<SubtitleExportSettings>({
		subtitleFormat: 'SRT',
		includedTarget: { arabic: true },
		exportVerseNumbers: { arabic: true },
		arabicTextFormat: 'Plain',
		customFileName: ''
	});

	savedVideoStylePresets = $state<SavedVideoStylePreset[]>([]);

	// Version du logiciel
	appVersion: string = $state('0.0.0');

	constructor() {
		super();
	}

	/**
	 * Sauvegarde les paramètres de l'application.
	 */
	static async save() {
		// Construis le chemin d'accès vers le fichier de paramètres
		const filePath = await join(await appDataDir(), this.settingsFile);

		await writeTextFile(
			filePath,
			JSON.stringify((globalState.settings || new Settings()).toJSON(), null, 2)
		);
	}

	/**
	 * Charge les paramètres de l'application.
	 */
	static async load() {
		if (globalState.settings) {
			// Déjà chargé
			return;
		}

		// Construis le chemin d'accès vers le projet
		const filePath = await join(await appDataDir(), this.settingsFile);

		// Vérifie que le fichier existe
		if (!(await exists(filePath))) {
			// Créer des paramètres par défaut
			globalState.settings = new Settings();

			// Signifie que c'est la première ouverture
			globalState.settings.appVersion = await VersionService.getAppVersion();

			// Telemetry
			AnalyticsService.trackAppInstalled(globalState.settings.appVersion || '0.0.0');

			await this.save();
			return;
		}

		// Lit le fichier JSON
		const fileContent = await readTextFile(filePath);
		const settingsData = JSON.parse(fileContent);

		globalState.settings = Settings.fromJSON(settingsData) as Settings;
		const settings = globalState.settings;
		let shouldSave = false;

		// Migrations ================
		if (!settings.exportSettings || typeof settings.exportSettings !== 'object') {
			settings.exportSettings = {} as ExportSettings;
			shouldSave = true;
		}
		if (!settings.defaultValuesSettings || typeof settings.defaultValuesSettings !== 'object') {
			settings.defaultValuesSettings = {
				exportFileNameFormat: DEFAULT_EXPORT_FILE_NAME_FORMAT,
				youtubeVideoTitle: '',
				youtubeVideoDescription: '',
				projectCategories: [...PROJECT_TYPE_OPTIONS],
				showTimelineVideoThumbnails: true
			};
			shouldSave = true;
		} else {
			if (!settings.defaultValuesSettings.exportFileNameFormat?.trim()) {
				settings.defaultValuesSettings.exportFileNameFormat = DEFAULT_EXPORT_FILE_NAME_FORMAT;
				shouldSave = true;
			}
			if (typeof settings.defaultValuesSettings.youtubeVideoTitle !== 'string') {
				settings.defaultValuesSettings.youtubeVideoTitle = '';
				shouldSave = true;
			}
			if (typeof settings.defaultValuesSettings.youtubeVideoDescription !== 'string') {
				settings.defaultValuesSettings.youtubeVideoDescription = '';
				shouldSave = true;
			}
			if (
				!Array.isArray(settings.defaultValuesSettings.projectCategories) ||
				settings.defaultValuesSettings.projectCategories.length === 0 ||
				settings.defaultValuesSettings.projectCategories.some(
					(category) => typeof category !== 'string' || !category.trim()
				)
			) {
				settings.defaultValuesSettings.projectCategories = [...PROJECT_TYPE_OPTIONS];
				shouldSave = true;
			}
			if (typeof settings.defaultValuesSettings.showTimelineVideoThumbnails !== 'boolean') {
				settings.defaultValuesSettings.showTimelineVideoThumbnails = true;
				shouldSave = true;
			}
		}
		if (!settings.subtitleExportSettings || typeof settings.subtitleExportSettings !== 'object') {
			settings.subtitleExportSettings = {
				subtitleFormat: 'SRT',
				includedTarget: { arabic: true },
				exportVerseNumbers: { arabic: true },
				arabicTextFormat: 'Plain',
				customFileName: ''
			};
			shouldSave = true;
		}
		if (typeof settingsData.persistentUiState?.hasSelectedLanguage !== 'boolean') {
			settings.persistentUiState.hasSelectedLanguage = true;
			shouldSave = true;
		}

		const projectEditorLayout = settings.persistentUiState.projectEditorLayout as
			| Partial<ProjectEditorLayout>
			| undefined;
		if (!projectEditorLayout || typeof projectEditorLayout !== 'object') {
			settings.persistentUiState.projectEditorLayout = { ...DEFAULT_PROJECT_EDITOR_LAYOUT };
			shouldSave = true;
		} else {
			// Migre les proportions du premier layout mobile vers la zone de styles agrandie.
			if (
				projectEditorLayout.stylePreviewHeight === 34 &&
				projectEditorLayout.styleTimelineHeight === 18
			) {
				projectEditorLayout.stylePreviewHeight = DEFAULT_PROJECT_EDITOR_LAYOUT.stylePreviewHeight;
				projectEditorLayout.styleTimelineHeight = DEFAULT_PROJECT_EDITOR_LAYOUT.styleTimelineHeight;
				shouldSave = true;
			} else if (
				projectEditorLayout.stylePreviewHeight === 28 &&
				projectEditorLayout.styleTimelineHeight === 11
			) {
				projectEditorLayout.styleTimelineHeight = DEFAULT_PROJECT_EDITOR_LAYOUT.styleTimelineHeight;
				shouldSave = true;
			}

			const usesPreviousDefaults =
				projectEditorLayout.upperSectionHeight === 68 &&
				projectEditorLayout.videoEditorPanelWidth === 300 &&
				projectEditorLayout.stylePanelWidth === 438 &&
				projectEditorLayout.subtitlesEditorLeftPanelWidth === 225 &&
				projectEditorLayout.subtitlesEditorRightPanelWidth === 200 &&
				projectEditorLayout.translationsEditorLeftPanelWidth === 230 &&
				projectEditorLayout.translationsEditorRightPanelWidth === 330 &&
				projectEditorLayout.exportPanelWidth === 350;

			if (usesPreviousDefaults) {
				settings.persistentUiState.projectEditorLayout = { ...DEFAULT_PROJECT_EDITOR_LAYOUT };
				shouldSave = true;
			} else {
				for (const key of Object.keys(DEFAULT_PROJECT_EDITOR_LAYOUT) as Array<
					keyof ProjectEditorLayout
				>) {
					if (typeof projectEditorLayout[key] !== 'number') {
						projectEditorLayout[key] = DEFAULT_PROJECT_EDITOR_LAYOUT[key];
						shouldSave = true;
					}
				}
			}
		}

		if (typeof settings.persistentUiState.hideReflectionPromptAfterExport !== 'boolean') {
			settings.persistentUiState.hideReflectionPromptAfterExport = false;
			shouldSave = true;
		}

		// Migration : validation du paramètre editorPanelScalePercent
		const editorPanelScalePercent = settings.persistentUiState.editorPanelScalePercent;
		if (
			!Number.isInteger(editorPanelScalePercent) ||
			editorPanelScalePercent < -60 ||
			editorPanelScalePercent > 0 ||
			editorPanelScalePercent % 5 !== 0
		) {
			settings.persistentUiState.editorPanelScalePercent = -15;
			shouldSave = true;
		}
		if (typeof settings.persistentUiState.dismissedHomepageMessageFingerprint !== 'string') {
			settings.persistentUiState.dismissedHomepageMessageFingerprint = '';
			shouldSave = true;
		}

		// Regarde la version des settings. Si c'est pas la même, ça veut dire
		// que l'utilisateur vient de mettre à jour
		const latestVersion = await VersionService.getAppVersion();
		if (settings.appVersion !== latestVersion) {
			// Telemetry
			AnalyticsService.trackAppUpdated(settings.appVersion || 'unknown', latestVersion || '0.0.0');

			// Met à jour la version
			settings.appVersion = latestVersion || '0.0.0';

			shouldSave = true;
		}

		// Migration si nécessaire ici
		if (typeof settings.exportSettings.randomBackgroundFolder !== 'string') {
			settings.exportSettings.randomBackgroundFolder =
				Settings.DEFAULT_EXPORT_SETTINGS.randomBackgroundFolder;
			shouldSave = true;
		}

		if (shouldSave) {
			await this.save();
		}
	}
}

export enum SettingsTab {
	USER_INTERFACE = 'user-interface',
	THEME = 'theme',
	NOTIFICATIONS = 'notifications',
	AI_KEY = 'ai-key',
	QURAN_FOUNDATION = 'quran-foundation',
	DEFAULT_VALUES = 'default-values',
	BACKUP = 'backup',
	SUPPORT = 'support',
	CONTACT = 'contact',
	ABOUT = 'about'
}
