import {
	Asset,
	Duration,
	PredefinedSubtitleClip,
	Project,
	ProjectContent,
	ProjectDetail,
	SourceType,
	SubtitleClip,
	Timeline,
	TrackType,
	Translation
} from '$lib/classes';
import {
	AssetClip,
	SilenceClip,
	getPredefinedArabicText,
	type PredefinedSubtitleType
} from '$lib/classes/Clip.svelte';
import { Quran } from '$lib/classes/Quran';
import Settings from '$lib/classes/Settings.svelte';
import type { AssetTrack, SubtitleTrack } from '$lib/classes/Track.svelte';
import { VerseTranslation } from '$lib/classes/Translation.svelte';
import ModalManager from '$lib/components/modals/ModalManager';
import { globalState } from '$lib/runes/main.svelte';
import { ProjectService } from '$lib/services/ProjectService';
import type { ProjectType } from '$lib/types/projectType';
import { join, localDataDir } from '@tauri-apps/api/path';
import { exists, readDir, readTextFile } from '@tauri-apps/plugin-fs';
import toast from 'svelte-5-french-toast';

type ShortcutAction = { keys: string[]; name: string; description: string };
type ShortcutBucket = Record<string, ShortcutAction>;
type MutableSettingsForMigration = {
	shortcutCategories: Record<string, unknown>;
	shortcuts: Record<string, ShortcutBucket>;
	persistentUiState: {
		lastClosedDonationPromptModal?: string | Date;
		donationPromptImpressions?: number;
	};
	aiTranslationSettings?: unknown;
	exportSettings?: {
		batchSize?: number;
	};
};
type LegacyAssetFields = {
	fromMp3Quran?: boolean;
	fromYoutube?: boolean;
	youtubeUrl?: string;
	mp3QuranUrl?: string;
};
type V2TrackClip = {
	start: number;
	end: number;
	assetId: string;
	isMuted?: boolean;
	isSilence?: boolean;
	isCustomText?: boolean;
	surah: number;
	verse: number;
	firstWordIndexInVerse: number;
	lastWordIndexInVerse: number;
	text: string;
	translations: Record<string, string>;
};
type V2ProjectData = {
	name: string;
	createdAt: string;
	updatedAt: string;
	reciter: string;
	assets: Array<{ id: string; filePath: string }>;
	projectSettings: { addedTranslations: string[] };
	timeline: {
		audiosTracks: Array<{ clips: V2TrackClip[] }>;
		videosTracks: Array<{ clips: V2TrackClip[] }>;
		subtitlesTracks: Array<{ clips: V2TrackClip[] }>;
	};
};

const PROJECT_TYPE_MIGRATION_RULES: Array<{ projectType: ProjectType; keywords: string[] }> = [
	{
		projectType: 'Taraweeh',
		keywords: [
			'taraweeh',
			'tarawih',
			'taraweh',
			'taraweh',
			'taraouih',
			'tarawihh',
			'traweeh',
			'تراويح',
			'التراويح'
		]
	},
	{
		projectType: 'Prayer',
		keywords: [
			'prayer',
			'salat',
			'salah',
			'salatul',
			'qiyam',
			'qiyam al layl',
			'qiyamul layl',
			'qiyaam',
			'tahajjud',
			'maghreb',
			'isha',
			'fajr',
			'sobh',
			'witr',
			'قيام',
			'قيام الليل',
			'صلاة',
			'صلات',
			'تهجد',
			'وتر'
		]
	},
	{
		projectType: 'Studio',
		keywords: [
			'studio',
			'recording',
			'recorded',
			'record',
			'recitation',
			'juzz',
			'juz',
			'hizb',
			'surah',
			'sura',
			'studio session',
			'تسجيل',
			'استوديو',
			'تلاوة'
		]
	},
	{
		projectType: 'Rare recitation',
		keywords: ['rare', 'unknown', 'rare recitation', 'unknown recitation', 'نادر', 'مجهول']
	},
	{
		projectType: 'Old recordings',
		keywords: [
			'old',
			'young',
			'90s',
			'90 s',
			'mythic',
			'archive',
			'archival',
			'vintage',
			'ancien',
			'old recording',
			'old rec',
			'shabb',
			'شاب',
			'صغير',
			'قديم',
			'تسعينات'
		]
	}
];

function normalizeProjectTitleForMigration(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[_-]+/g, ' ')
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function inferProjectTypeFromTitle(title: string): ProjectType {
	const normalizedTitle = normalizeProjectTitleForMigration(title);

	for (const rule of PROJECT_TYPE_MIGRATION_RULES) {
		if (
			rule.keywords.some((keyword) =>
				normalizedTitle.includes(normalizeProjectTitleForMigration(keyword))
			)
		) {
			return rule.projectType;
		}
	}

	return 'Others';
}

export default class MigrationService {
	/**
	 * Migre les donnees de Quran Caption 3.1.0 a Quran Caption 3.1.1
	 * > Ajout d'un shortcut pour ajouter un custom text clip facilement.
	 */
	static FromQC310ToQC311() {
		if (
			globalState.settings &&
			!globalState.settings.shortcuts.SUBTITLES_EDITOR.ADD_CUSTOM_TEXT_CLIP
		) {
			globalState.settings.shortcuts.SUBTITLES_EDITOR.ADD_CUSTOM_TEXT_CLIP =
				new Settings().shortcuts.SUBTITLES_EDITOR.ADD_CUSTOM_TEXT_CLIP;
			Settings.save();
		}
	}

	/**
	 * Migre les donnees de Quran Caption 3.1.5 a Quran Caption 3.1.6
	 * > Modification du shortcut "Set Start to Previous Punctuation" en "Set End to Previous Punctuation"
	 */
	static FromQC315ToQC316() {
		const subtitlesEditorShortcuts = globalState.settings?.shortcuts
			.SUBTITLES_EDITOR as ShortcutBucket & { SET_START_TO_PREVIOUS?: ShortcutAction };
		if (globalState.settings && subtitlesEditorShortcuts?.SET_START_TO_PREVIOUS) {
			globalState.settings.shortcuts.SUBTITLES_EDITOR.SET_END_TO_PREVIOUS =
				subtitlesEditorShortcuts.SET_START_TO_PREVIOUS;
			delete subtitlesEditorShortcuts.SET_START_TO_PREVIOUS;

			const { name: newName, description: newDescription } = new Settings().shortcuts
				.SUBTITLES_EDITOR.SET_END_TO_PREVIOUS;

			globalState.settings.shortcuts.SUBTITLES_EDITOR.SET_END_TO_PREVIOUS.description =
				newDescription;
			globalState.settings.shortcuts.SUBTITLES_EDITOR.SET_END_TO_PREVIOUS.name = newName;

			Settings.save();
		}
	}

	/**
	 * Assure que les nouveaux shortcuts (Split, Go to Start) existent dans les settings.
	 */
	static FromQC327ToQC328() {
		if (!globalState.settings) return;

		let hasChanges = false;
		const defaultShortcuts = new Settings().shortcuts;

		// Check Split Subtitle
		if (!globalState.settings.shortcuts.SUBTITLES_EDITOR.SPLIT_SUBTITLE) {
			globalState.settings.shortcuts.SUBTITLES_EDITOR.SPLIT_SUBTITLE =
				defaultShortcuts.SUBTITLES_EDITOR.SPLIT_SUBTITLE;
			hasChanges = true;
		}

		// Check Go To Start
		if (!globalState.settings.shortcuts.VIDEO_PREVIEW.GO_TO_START) {
			globalState.settings.shortcuts.VIDEO_PREVIEW.GO_TO_START =
				defaultShortcuts.VIDEO_PREVIEW.GO_TO_START;
			hasChanges = true;
		}

		if (hasChanges) {
			Settings.save();
		}
	}

	/**
	 * Assure que le nouveau shortcut "Set Subtitle Start Time" existe dans les settings.
	 */
	static FromQC331ToQC332() {
		if (!globalState.settings) return;

		let hasChanges = false;
		const defaultShortcuts = new Settings().shortcuts;

		if (!globalState.settings.shortcuts.SUBTITLES_EDITOR.SET_LAST_SUBTITLE_START) {
			globalState.settings.shortcuts.SUBTITLES_EDITOR.SET_LAST_SUBTITLE_START =
				defaultShortcuts.SUBTITLES_EDITOR.SET_LAST_SUBTITLE_START;
			hasChanges = true;
		}

		if (hasChanges) {
			Settings.save();
		}
	}

	/**
	 * Nettoie l'ancien flag auto-segmentation includeWordByWord retiré.
	 */
	static FromQC332ToQC333() {
		if (!globalState.settings) return;

		const autoSegmentationSettings = globalState.settings.autoSegmentationSettings as {
			includeWordByWord?: boolean;
		};

		if ('includeWordByWord' in autoSegmentationSettings) {
			delete autoSegmentationSettings.includeWordByWord;
			Settings.save();
		}
	}

	/**
	 * Migre les settings auto-segmentation vers le schéma cloud-v2 + moteurs locaux.
	 */
	static FromQC333ToQC334() {
		if (!globalState.settings) return;

		const autoSegmentationSettings = globalState.settings.autoSegmentationSettings as {
			mode?: 'api' | 'local';
			minSilenceMs?: number;
			minSpeechMs?: number;
			padMs?: number;
			whisperModel?: 'tiny' | 'base' | 'medium' | 'large';
			legacyWhisperModel?: 'tiny' | 'base' | 'medium' | 'large';
			localAsrMode?: 'legacy_whisper' | 'multi_aligner';
			multiAlignerModel?: 'Base' | 'Large';
			cloudModel?: 'Base' | 'Large';
			device?: 'GPU' | 'CPU';
			hfToken?: string;
			includeWbwTimestamps?: boolean;
			fillBySilence?: boolean;
			extendBeforeSilence?: boolean;
			extendBeforeSilenceMs?: number;
		};

		let hasChanges = false;

		if (!autoSegmentationSettings.mode) {
			autoSegmentationSettings.mode = 'api';
			hasChanges = true;
		}
		if (!autoSegmentationSettings.localAsrMode) {
			autoSegmentationSettings.localAsrMode = 'legacy_whisper';
			hasChanges = true;
		}
		if (!autoSegmentationSettings.legacyWhisperModel) {
			autoSegmentationSettings.legacyWhisperModel = autoSegmentationSettings.whisperModel || 'base';
			hasChanges = true;
		}
		if (!autoSegmentationSettings.multiAlignerModel) {
			autoSegmentationSettings.multiAlignerModel = 'Base';
			hasChanges = true;
		}
		if (!autoSegmentationSettings.cloudModel) {
			autoSegmentationSettings.cloudModel = 'Base';
			hasChanges = true;
		}
		if (!autoSegmentationSettings.device) {
			autoSegmentationSettings.device = 'GPU';
			hasChanges = true;
		}
		if (typeof autoSegmentationSettings.hfToken !== 'string') {
			autoSegmentationSettings.hfToken = '';
			hasChanges = true;
		}
		if (typeof autoSegmentationSettings.includeWbwTimestamps !== 'boolean') {
			autoSegmentationSettings.includeWbwTimestamps = false;
			hasChanges = true;
		}
		if (typeof autoSegmentationSettings.minSilenceMs !== 'number') {
			autoSegmentationSettings.minSilenceMs = 200;
			hasChanges = true;
		}
		if (typeof autoSegmentationSettings.minSpeechMs !== 'number') {
			autoSegmentationSettings.minSpeechMs = 1000;
			hasChanges = true;
		}
		if (typeof autoSegmentationSettings.padMs !== 'number') {
			autoSegmentationSettings.padMs = 100;
			hasChanges = true;
		}
		if (typeof autoSegmentationSettings.fillBySilence !== 'boolean') {
			autoSegmentationSettings.fillBySilence = true;
			hasChanges = true;
		}
		if (typeof autoSegmentationSettings.extendBeforeSilence !== 'boolean') {
			autoSegmentationSettings.extendBeforeSilence = false;
			hasChanges = true;
		}
		if (typeof autoSegmentationSettings.extendBeforeSilenceMs !== 'number') {
			autoSegmentationSettings.extendBeforeSilenceMs = 50;
			hasChanges = true;
		}
		if ('whisperModel' in autoSegmentationSettings) {
			delete autoSegmentationSettings.whisperModel;
			hasChanges = true;
		}

		if (hasChanges) {
			Settings.save();
		}
	}

	/**
	 * Assure que les nouveaux shortcuts de pre-defined subtitles existent (non bindés par défaut).
	 */
	static FromQC334ToQC335() {
		if (!globalState.settings) return;

		let hasChanges = false;
		const defaults = new Settings();
		const settingsAny = globalState.settings as unknown as MutableSettingsForMigration;
		const keyNames = [
			'ADD_BASMALA',
			'ADD_ISTIADHAH',
			'ADD_AMIN',
			'ADD_TAKBIR',
			'ADD_TAHMEED',
			'ADD_TASLEEM',
			'ADD_SADAQA'
		];

		settingsAny.shortcutCategories = settingsAny.shortcutCategories || {};
		settingsAny.shortcuts = settingsAny.shortcuts || {};
		settingsAny.shortcuts.SUBTITLES_EDITOR = settingsAny.shortcuts.SUBTITLES_EDITOR || {};

		if (!settingsAny.shortcutCategories.PREDEFINED_SUBTITLES) {
			settingsAny.shortcutCategories.PREDEFINED_SUBTITLES =
				defaults.shortcutCategories.PREDEFINED_SUBTITLES;
			hasChanges = true;
		}

		if (!settingsAny.shortcuts.PREDEFINED_SUBTITLES) {
			settingsAny.shortcuts.PREDEFINED_SUBTITLES = { ...defaults.shortcuts.PREDEFINED_SUBTITLES };
			hasChanges = true;
		}

		for (const key of Object.keys(defaults.shortcuts.PREDEFINED_SUBTITLES)) {
			if (!settingsAny.shortcuts.PREDEFINED_SUBTITLES[key]) {
				settingsAny.shortcuts.PREDEFINED_SUBTITLES[key] =
					defaults.shortcuts.PREDEFINED_SUBTITLES[
						key as keyof typeof defaults.shortcuts.PREDEFINED_SUBTITLES
					];
				hasChanges = true;
			}
		}

		for (const keyName of keyNames) {
			if (!settingsAny.shortcuts.PREDEFINED_SUBTITLES[keyName]) {
				settingsAny.shortcuts.PREDEFINED_SUBTITLES[keyName] =
					defaults.shortcuts.PREDEFINED_SUBTITLES[
						keyName as keyof typeof defaults.shortcuts.PREDEFINED_SUBTITLES
					];
				hasChanges = true;
			}

			const oldAction = settingsAny.shortcuts.SUBTITLES_EDITOR[keyName];
			const newAction = settingsAny.shortcuts.PREDEFINED_SUBTITLES[keyName];

			if (oldAction) {
				const oldKeys = Array.isArray(oldAction.keys) ? oldAction.keys : [];
				const currentNewKeys = Array.isArray(newAction?.keys) ? newAction.keys : [];
				if (oldKeys.length > 0 && currentNewKeys.length === 0) {
					settingsAny.shortcuts.PREDEFINED_SUBTITLES[keyName].keys = [...oldKeys];
					hasChanges = true;
				}

				delete settingsAny.shortcuts.SUBTITLES_EDITOR[keyName];
				hasChanges = true;
			}
		}

		// Nettoie l'ancien shortcut retiré (Isti'adha+Basmala)
		if (settingsAny.shortcuts.SUBTITLES_EDITOR?.ADD_ISTIADHA_BASMALA) {
			delete settingsAny.shortcuts.SUBTITLES_EDITOR.ADD_ISTIADHA_BASMALA;
			hasChanges = true;
		}
		if (settingsAny.shortcuts.PREDEFINED_SUBTITLES?.ADD_ISTIADHA_BASMALA) {
			delete settingsAny.shortcuts.PREDEFINED_SUBTITLES.ADD_ISTIADHA_BASMALA;
			hasChanges = true;
		}

		if (hasChanges) {
			Settings.save();
		}
	}

	/**
	 * Migre les donnees de Quran Caption 3.1.3 a Quran Caption 3.1.4
	 * > Renommage des tracks "CustomText" a "CustomClip"
	 */
	static FromQC313ToQC314() {
		if (globalState.currentProject) {
			const timeline: Timeline = globalState.currentProject.content.timeline;

			let hasChanges = false;

			timeline.tracks.forEach((track) => {
				if (track.type.toString() === 'CustomText') {
					track.type = TrackType.CustomClip;
					hasChanges = true;
				}
			});

			if (hasChanges) {
				globalState.currentProject.save();
			}
		}
	}

	/**
	 * Migre les donnees de Quran Caption 3.2.6 a Quran Caption 3.2.7
	 * > Conversion des anciens champs fromYoutube/youtubeUrl/fromMp3Quran/mp3QuranUrl
	 *   vers le nouveau format sourceUrl/sourceType
	 */
	static FromQC326ToQC327() {
		if (globalState.currentProject) {
			const assets = globalState.currentProject.content.assets;
			let hasChanges = false;

			for (const asset of assets) {
				const assetAny = asset as Asset & LegacyAssetFields;

				// Vérifie si l'asset a les anciens champs
				if (
					assetAny.fromMp3Quran !== undefined ||
					assetAny.fromYoutube !== undefined ||
					assetAny.youtubeUrl !== undefined ||
					assetAny.mp3QuranUrl !== undefined
				) {
					// Migre vers le nouveau format
					if (assetAny.fromMp3Quran) {
						asset.sourceType = SourceType.Mp3Quran;
						asset.sourceUrl = assetAny.mp3QuranUrl;
					} else if (assetAny.fromYoutube) {
						asset.sourceType = SourceType.YouTube;
						asset.sourceUrl = assetAny.youtubeUrl;
					} else {
						asset.sourceType = SourceType.Local;
					}

					// Supprime les anciens champs
					delete assetAny.fromMp3Quran;
					delete assetAny.fromYoutube;
					delete assetAny.youtubeUrl;
					delete assetAny.mp3QuranUrl;

					hasChanges = true;
				}
			}

			if (hasChanges) {
				globalState.currentProject.save();
			}
		}
	}

	/**
	 * Migre les anciens noms de pre-defined subtitles vers les noms canoniques.
	 * - Istiadhah -> Isti'adha
	 * - Sadaqallahul Azim -> Sadaqa
	 */
	static FromQC334ToQC335_2() {
		if (!globalState.currentProject) return;

		let hasChanges = false;
		const legacyTypeMap: Record<string, PredefinedSubtitleType> = {
			Istiadhah: "Isti'adha",
			"Isti'adha+Basmala": "Isti'adha",
			'Sadaqallahul Azim': 'Sadaqa'
		};

		for (const track of globalState.currentProject.content.timeline.tracks) {
			for (const clip of track.clips) {
				if (!(clip instanceof PredefinedSubtitleClip)) continue;

				const rawType = clip.predefinedSubtitleType as string;
				const migratedType = legacyTypeMap[rawType];
				if (!migratedType) continue;

				clip.predefinedSubtitleType = migratedType;
				clip.text = getPredefinedArabicText(migratedType);
				hasChanges = true;
			}
		}

		if (hasChanges) {
			globalState.currentProject.save();
		}
	}

	/**
	 * Ajoute les nouveaux paramètres pour la nouvelle pipeline
	 * de trimmage de traduction assistée par IA
	 */
	static FromQC339ToQC340() {
		if (!globalState.settings) return;

		const settingsAny = globalState.settings as unknown as MutableSettingsForMigration;
		if (settingsAny.aiTranslationSettings === undefined) {
			settingsAny.aiTranslationSettings = { ...new Settings().aiTranslationSettings };
			Settings.save();
		}
	}

	/*
	 * Si la version actuelle est 3.4.4 et "batch size" est undefined (pas encore fait cette migration),
	 * initialise batch size et supprime l'ancien chunk size s'il est encore présent.
	 */
	static async FromQC343ToQC344() {
		if (!globalState.settings) return;

		const settingsAny = globalState.settings as unknown as MutableSettingsForMigration;
		const defaultExportSettings = new Settings().exportSettings;
		let hasChanges = false;

		settingsAny.exportSettings = settingsAny.exportSettings || {};

		// Si on a pas encore le paramètre batchSize
		if (typeof settingsAny.exportSettings.batchSize !== 'number') {
			settingsAny.exportSettings.batchSize = defaultExportSettings.batchSize;
			hasChanges = true;
		}

		const exportSettingsRecord = settingsAny.exportSettings as Record<string, unknown>;
		if ('chunkSize' in exportSettingsRecord) {
			delete exportSettingsRecord.chunkSize;
			hasChanges = true;
		}

		if (hasChanges) {
			Settings.save();

			// Deuxième migration : on a désormais une arborescence de projets
			// Du coup on demande si on veut pas avoir un premier tri intelligent sur ces projets
			const confirmed = await ModalManager.confirmModal(
				'This update introduce a new project folder structure. Would you like the software to try to organize your projects into the correct sub-categories for you?'
			);
			if (confirmed) {
				this.organizeExistingProjectsIntoSubCategories();
			}
		}
	}

	/**
	 * Applies a first-pass classification to existing projects from their title only.
	 * Priority order:
	 * Taraweeh > Prayer > Studio > Rare recitation > Old recordings > Others
	 */
	static async organizeExistingProjectsIntoSubCategories() {
		const projectsToUpdate = globalState.userProjectsDetails.filter((project) => {
			const inferredProjectType = inferProjectTypeFromTitle(project.name);
			return project.projectType !== inferredProjectType;
		});

		for (const project of projectsToUpdate) {
			project.projectType = inferProjectTypeFromTitle(project.name);
			await ProjectService.saveDetail(project, false); // On ne met pas à jour le updatedAt pour pas remonter tous les projets dans "Recently Updated"
		}

		toast.success('The projects have been organized into sub-categories.');
	}

	/**
	 * Vérifie si des données de Quran Caption 2 sont présentes
	 * @returns true si des données sont trouvées, sinon false
	 */
	static async hasQCV2Data(): Promise<boolean> {
		// Obtenir le chemin vers le dossier AppData\Local de l'utilisateur
		return (await this.getQCV2NumberOfFiles()) > 1; // Au moins 2 fichiers sont nécessaires (1 = juste le fichier projects.json)
	}

	static async getQCV2NumberOfFiles(): Promise<number> {
		const qc2LocalStoragePath = await MigrationService.getQCV2Dir();
		if (!qc2LocalStoragePath) return 0;

		const qc2FolderExists = await exists(qc2LocalStoragePath);

		if (qc2FolderExists) {
			const files = await readDir(qc2LocalStoragePath);
			return files.length;
		}

		return 0;
	}

	static async getQCV2Dir(): Promise<string | null> {
		const userLocalDataDir = await localDataDir();
		return await join(userLocalDataDir, 'Quran Caption', 'localStorage');
	}

	/**
	 * Import a single project from V2 with error handling
	 * @param qc2Dir The V2 data directory path
	 * @param fileName The project file name to import
	 */
	static async importSingleProjectFromV2(qc2Dir: string, fileName: string): Promise<void> {
		const fileContent = await readTextFile(await join(qc2Dir, fileName));
		const project = JSON.parse(JSON.parse(fileContent)) as V2ProjectData; // Double parse as V2 projects are stringified twice

		// Project Detail
		const projectName = project.name;
		const projectCreatedAt: Date = new Date(project.createdAt);
		const projectUpdatedAt: Date = new Date(project.updatedAt);
		const projectReciter = project.reciter;

		const projectDetail = new ProjectDetail(
			projectName,
			projectReciter,
			projectCreatedAt,
			projectUpdatedAt
		);

		const newIds: { [oldId: string]: number } = {};

		const projectContent = await ProjectContent.getDefaultProjectContent();

		// Assets
		const projectAssets: Asset[] = [];

		for (const asset of project.assets) {
			const newAsset = new Asset(asset.filePath);
			newIds[asset.id] = newAsset.id;
			projectAssets.push(newAsset);
		}

		projectContent.assets = projectAssets;

		// Timeline

		// Audio Track
		if (project.timeline.audiosTracks[0].clips.length > 0) {
			for (const clip of project.timeline.audiosTracks[0].clips) {
				if (clip.isMuted) continue; // Skip muted clips

				const assetClip = new AssetClip(clip.start, clip.end, newIds[clip.assetId]);

				(projectContent.timeline.getFirstTrack(TrackType.Audio) as AssetTrack)!.clips.push(
					assetClip
				);
			}
		}

		// Video Track
		if (project.timeline.videosTracks[0].clips.length > 0) {
			for (const clip of project.timeline.videosTracks[0].clips) {
				const asset = projectAssets.find((asset) => asset.id === newIds[clip.assetId]);

				if (!asset) continue;

				if (asset && asset.duration === undefined) {
					asset!.duration = new Duration(clip.end - clip.start);
				}

				const assetClip = new AssetClip(clip.start, clip.end, newIds[clip.assetId]);

				if (!clip.isMuted) {
					// Video track but not muted, add to audio track instead
					(projectContent.timeline.getFirstTrack(TrackType.Audio) as AssetTrack)!.clips.push(
						assetClip
					);
				} else {
					(projectContent.timeline.getFirstTrack(TrackType.Video) as AssetTrack)!.clips.push(
						assetClip
					);
				}
			}
		}

		// Translations
		const migratedEditions = await Promise.all(
			project.projectSettings.addedTranslations.map(async (s: string) => {
				for (const [_key, value] of Object.entries(globalState.availableTranslations)) {
					for (const tr of value.translations) {
						if (
							tr.name ===
							s
								.replace('-la', '')
								.replace('fra-muhammadhamidul', 'fra-muhammadhameedu')
								.replace('deu-asfbubenheimand', 'deu-frankbubenheima')
						) {
							// Add styles for translations
							await projectContent.videoStyle.addStylesForEdition(tr.name);
							tr.showInTranslationsEditor = true;
							return tr;
						}
					}
				}

				return null;
			})
		);
		projectContent.projectTranslation.addedTranslationEditions = migratedEditions.filter(
			(edition): edition is NonNullable<typeof edition> => edition !== null
		);

		// Subtitles
		if (project.timeline.subtitlesTracks[0].clips.length > 0) {
			for (const clip of project.timeline.subtitlesTracks[0].clips) {
				if ((clip.surah === -1 || clip.verse === -1) && !clip.isSilence && !clip.isCustomText) {
					const translations: { [key: string]: Translation } = {};

					// predefined subtitle clip
					const sub = new PredefinedSubtitleClip(
						clip.start,
						clip.end,
						clip.text.includes('بِسْمِ') ? 'Basmala' : "Isti'adha"
					);

					for (const [key, value] of Object.entries(clip.translations)) {
						translations[
							key
								.replace('-la', '')
								.replace('fra-muhammadhamidul', 'fra-muhammadhameedu')
								.replace('deu-asfbubenheimand', 'deu-frankbubenheima')
						] = new Translation(value as string, 'reviewed');
					}

					sub.translations = translations;

					projectContent.timeline.getFirstTrack(TrackType.Subtitle)!.clips.push(sub);
				} else if (!clip.isSilence && !clip.isCustomText) {
					const verse = (await Quran.getSurah(clip.surah)).verses[clip.verse - 1];

					const subtitlesProperties = await (
						projectContent.timeline.getFirstTrack(TrackType.Subtitle) as SubtitleTrack
					).getSubtitlesProperties(
						verse,
						clip.firstWordIndexInVerse,
						clip.lastWordIndexInVerse,
						clip.surah
					);

					// subtitle clip
					const sub = new SubtitleClip(
						clip.start,
						clip.end,
						clip.surah,
						clip.verse,
						clip.firstWordIndexInVerse,
						clip.lastWordIndexInVerse,
						verse.getArabicTextBetweenTwoIndexes(
							clip.firstWordIndexInVerse,
							clip.lastWordIndexInVerse
						),
						verse.getWordByWordTranslationBetweenTwoIndexes(
							clip.firstWordIndexInVerse,
							clip.lastWordIndexInVerse
						),
						subtitlesProperties.isFullVerse,
						subtitlesProperties.isLastWordsOfVerse,
						subtitlesProperties.translations,
						verse.getArabicTextBetweenTwoIndexes(
							clip.firstWordIndexInVerse,
							clip.lastWordIndexInVerse,
							'indopak'
						)
					);

					const translations: { [key: string]: Translation } = {};

					for (const [key, value] of Object.entries(clip.translations)) {
						const tr = new VerseTranslation(value as string, 'reviewed');
						translations[formatTranslationName(key)] = tr;
						(translations[formatTranslationName(key)] as VerseTranslation).isBruteForce = true;

						// Télécharge la traduction en ligne
						const edition = projectContent.projectTranslation.addedTranslationEditions.find(
							(edition) => edition.name === formatTranslationName(key)
						);

						// si !edition, c'est que c'est une traduction ajouté par l'utilisateur, puis supprimer
						if (edition) {
							const translation = await projectContent.projectTranslation.downloadVerseTranslation(
								edition,
								clip.surah,
								clip.verse
							);

							// Ajoute la traduction a l'objet translations
							if (
								!projectContent.projectTranslation.versesTranslations[formatTranslationName(key)]
							) {
								projectContent.projectTranslation.versesTranslations[formatTranslationName(key)] =
									{};
							}

							projectContent.projectTranslation.versesTranslations[formatTranslationName(key)][
								clip.surah + ':' + clip.verse
							] = translation;
						}
					}

					sub.translations = translations;

					projectContent.timeline.getFirstTrack(TrackType.Subtitle)!.clips.push(sub);
				} else if (clip.isSilence || clip.isCustomText) {
					// SilenceClip
					const silence = new SilenceClip(clip.start, clip.end);
					projectContent.timeline.getFirstTrack(TrackType.Subtitle)!.clips.push(silence);
				}
			}
		}

		const newProject = new Project(projectDetail, projectContent);

		globalState.currentProject = newProject;

		projectDetail.updateVideoDetailAttributes();
		for (const edition of projectContent.projectTranslation.addedTranslationEditions) {
			projectDetail.updatePercentageTranslated(edition);
		}

		globalState.currentProject.save(false);
		globalState.userProjectsDetails.push(newProject.detail);

		globalState.currentProject = null;

		await newProject.save(false);
	}
}
function formatTranslationName(key: string) {
	return key
		.replace('-la', '')
		.replace('fra-muhammadhamidul', 'fra-muhammadhameedu')
		.replace('deu-asfbubenheimand', 'deu-frankbubenheima');
}
