import { SerializableBase } from './misc/SerializableBase';
import { writeTextFile, readTextFile, exists } from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';
import { globalState } from '$lib/runes/main.svelte';
import { AnalyticsService } from '$lib/services/AnalyticsService';
import { VersionService } from '$lib/services/VersionService.svelte';
import MigrationService from '$lib/services/MigrationService';
import type { VideoStyleFileData } from './VideoStyle.svelte';
import type { ProjectDetail } from './ProjectDetail.svelte';
import type { ExplorerSelection } from '$lib/components/home/homeExplorer';

export type AutoSegmentationSettings = {
	mode: 'api' | 'local';
	localAsrMode: 'legacy_whisper' | 'multi_aligner';
	minSilenceMs: number;
	minSpeechMs: number;
	padMs: number;
	legacyWhisperModel: 'tiny' | 'base' | 'medium' | 'large';
	multiAlignerModel: 'Base' | 'Large';
	cloudModel: 'Base' | 'Large';
	device: 'GPU' | 'CPU';
	hfToken: string;
	includeWbwTimestamps: boolean;
	fillBySilence: boolean; // Si true, insère des SilenceClip. Sinon, étend les sous-titres.
	extendBeforeSilence: boolean; // If true, extend subtitles before silence clips.
	extendBeforeSilenceMs: number; // Extra ms added before silence when enabled.
};

export type AITranslationSettings = {
	omitPromptPrefix: boolean; // If true, only include JSON input in the prompt.
	openAiApiKey: string;
	textAiApiEndpoint: string;
	advancedTrimModel: string;
	advancedTrimReasoningEffort: 'none' | 'low' | 'medium' | 'high';
	advancedAlsoAskReviewed: boolean;
	aiBoldCustomNote: string;
	activeModalTab: 'legacy' | 'advanced';
	telemetryConsent: 'unknown' | 'granted' | 'denied';
};

export type ExportSettings = {
	batchSize: number;
};

export type SavedVideoStylePreset = {
	id: number;
	name: string;
	createdAt: string;
	updatedAt: string;
	resolution: { width: number; height: number };
	data: VideoStyleFileData;
};

const DEFAULT_TEXT_AI_ENDPOINT = 'https://api.openai.com/v1/responses';
const DEFAULT_HOME_EXPLORER_SELECTION: ExplorerSelection = { kind: 'all' };

export default class Settings extends SerializableBase {
	private static settingsFile: string = 'settings.json';
	private static readonly DEFAULT_EXPORT_SETTINGS: ExportSettings = {
		batchSize: 12
	};

	// État UI persistant
	persistentUiState = $state({
		// Indique si on affiche le moniteur d'exportation
		projectCardView: 'grid' as 'grid' | 'list',
		homeSortProperty: 'updatedAt' as keyof ProjectDetail,
		homeSortAscending: false,
		homeExplorerSelection: DEFAULT_HOME_EXPLORER_SELECTION as ExplorerSelection,
		showWaveforms: true,
		lastClosedUpdateModal: new Date(0).toISOString(),
		lastClosedDonationPromptModal: new Date(0).toISOString(),
		donationPromptImpressions: 0,
		videoExportFolder: '',
		themeIntensity: 100,
		hasSeenTour: false,
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
		mode: 'api',
		localAsrMode: 'legacy_whisper',
		minSilenceMs: 200,
		minSpeechMs: 1000,
		padMs: 100,
		legacyWhisperModel: 'base',
		multiAlignerModel: 'Base',
		cloudModel: 'Base',
		device: 'GPU',
		hfToken: '',
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
		activeModalTab: 'legacy',
		telemetryConsent: 'unknown'
	});

	exportSettings = $state<ExportSettings>({ ...Settings.DEFAULT_EXPORT_SETTINGS });

	savedVideoStylePresets = $state<SavedVideoStylePreset[]>([]);

	// Shortcut categories metadata
	shortcutCategories = {
		VIDEO_PREVIEW: {
			name: 'Video Preview',
			icon: 'play_circle',
			description: 'Controls for video playback and preview'
		},
		SUBTITLES_EDITOR: {
			name: 'Subtitles Editor',
			icon: 'subtitles',
			description: 'Controls for editing and managing subtitles'
		},
		PREDEFINED_SUBTITLES: {
			name: 'Pre-defined Subtitles',
			icon: 'auto_awesome',
			description: 'Shortcuts to insert pre-defined subtitle clips'
		}
	};

	// Shortcuts
	shortcuts = {
		VIDEO_PREVIEW: {
			MOVE_FORWARD: {
				keys: ['arrowright'],
				name: 'Move Forward',
				description: 'Move preview forward by 2 seconds'
			},
			MOVE_BACKWARD: {
				keys: ['arrowleft'],
				name: 'Move Backward',
				description: 'Move preview backward by 2 seconds'
			},
			PLAY_PAUSE: {
				keys: [' '],
				name: 'Play/Pause',
				description: 'Play or pause the video preview'
			},
			INCREASE_SPEED: {
				keys: ['pageup', 'pagedown'],
				name: 'Toggle Speed',
				description: 'Toggle video speed between 1x and 2x'
			},
			TOGGLE_FULLSCREEN: {
				keys: ['f11'],
				name: 'Toggle Fullscreen',
				description: 'Enter or exit fullscreen mode'
			},
			GO_TO_START: {
				keys: ['i'],
				name: 'Go to Start',
				description: 'Stop playback and jump to the beginning of the video'
			}
		},
		SUBTITLES_EDITOR: {
			SELECT_NEXT_WORD: {
				keys: ['arrowup'],
				name: 'Select Next Word',
				description: 'Move selection to the next word'
			},
			SELECT_PREVIOUS_WORD: {
				keys: ['arrowdown'],
				name: 'Select Previous Word',
				description: 'Move selection to the previous word'
			},
			RESET_START_CURSOR: {
				keys: ['r'],
				name: 'Reset Start Cursor',
				description: 'Put the start cursor on the end cursor position'
			},
			SELECT_ALL_WORDS: {
				keys: ['v'],
				name: 'Select All Words',
				description: 'Select all words in the current verse'
			},
			SET_END_TO_LAST: {
				keys: ['c'],
				name: 'Set End to Next Punctuation',
				description: 'Move end cursor to the next punctuation mark'
			},
			SET_END_TO_PREVIOUS: {
				keys: ['x'],
				name: 'Set End to Previous Punctuation',
				description: 'Move end cursor to the previous punctuation mark'
			},
			ADD_SUBTITLE: {
				keys: ['enter'],
				name: 'Add Subtitle',
				description: 'Create a subtitle with selected words'
			},
			REMOVE_LAST_SUBTITLE: {
				keys: ['backspace'],
				name: 'Remove Last Subtitle',
				description: 'Delete the most recent subtitle'
			},
			EDIT_LAST_SUBTITLE: {
				keys: ['e'],
				name: 'Edit Subtitle at Cursor',
				description: 'Edit the subtitle under the cursor, or the last one if none'
			},
			ADD_SILENCE: {
				keys: ['s'],
				name: 'Add Silence',
				description: 'Insert a silent period in the timeline'
			},
			SET_LAST_SUBTITLE_END: {
				keys: ['m'],
				name: 'Set Subtitle End Time',
				description: 'Set end time of subtitle at cursor position and adjust next subtitle start'
			},
			SET_LAST_SUBTITLE_START: {
				keys: ['n'],
				name: 'Set Subtitle Start Time',
				description:
					'Set start time of subtitle at cursor position and adjust previous subtitle end'
			},
			ADD_CUSTOM_TEXT_CLIP: {
				keys: ['t'],
				description: 'Add a custom text clip between the last subtitle and the current position',
				name: 'Add Custom Text Clip'
			},
			SPLIT_SUBTITLE: {
				keys: ['d'],
				description: 'Split the subtitle at the cursor position',
				name: 'Split Subtitle'
			}
		},
		PREDEFINED_SUBTITLES: {
			ADD_BASMALA: {
				keys: ['b'],
				description: 'Add a subtitle with the basmala ("بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ")',
				name: 'Add Basmala'
			},
			ADD_ISTIADHAH: {
				keys: ['a'],
				description: `Add a subtitle with the isti'adhah ("أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ")`,
				name: "Add Isti'adhah"
			},
			ADD_AMIN: {
				keys: [],
				description: 'Add a subtitle with amin ("آمِين")',
				name: 'Add Amin'
			},
			ADD_TAKBIR: {
				keys: [],
				description: 'Add a subtitle with takbir ("اللَّهُ أَكْبَر")',
				name: 'Add Takbir'
			},
			ADD_TAHMEED: {
				keys: [],
				description: 'Add a subtitle with tahmeed ("سَمِعَ اللَّهُ لِمَنْ حَمِدَه")',
				name: 'Add Tahmeed'
			},
			ADD_TASLEEM: {
				keys: [],
				description: 'Add a subtitle with tasleem ("ٱلسَّلَامُ عَلَيْكُمْ وَرَحْمَةُ ٱللَّه")',
				name: 'Add Tasleem'
			},
			ADD_SADAQA: {
				keys: [],
				description: 'Add a subtitle with sadaqa ("صَدَقَ ٱللَّهُ ٱلْعَظِيم")',
				name: 'Add Sadaqa'
			}
		}
	};

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

		if (!settings.exportSettings || typeof settings.exportSettings !== 'object') {
			settings.exportSettings = {} as ExportSettings;
			shouldSave = true;
		}

		if (!settings.aiTranslationSettings.textAiApiEndpoint?.trim()) {
			settings.aiTranslationSettings.textAiApiEndpoint = DEFAULT_TEXT_AI_ENDPOINT;
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

		// Migration des paramètres si besoin
		MigrationService.FromQC310ToQC311();
		MigrationService.FromQC315ToQC316();
		MigrationService.FromQC327ToQC328();
		MigrationService.FromQC331ToQC332();
		MigrationService.FromQC332ToQC333();
		MigrationService.FromQC333ToQC334();
		MigrationService.FromQC334ToQC335();
		MigrationService.FromQC339ToQC340();
		MigrationService.FromQC343ToQC344();

		if (
			typeof settings.exportSettings.batchSize !== 'number' ||
			Number.isNaN(settings.exportSettings.batchSize)
		) {
			settings.exportSettings.batchSize = Settings.DEFAULT_EXPORT_SETTINGS.batchSize;
			shouldSave = true;
		}

		if ('chunkSize' in (settings.exportSettings as Record<string, unknown>)) {
			delete (settings.exportSettings as Record<string, unknown>).chunkSize;
			shouldSave = true;
		}

		if (shouldSave) {
			await this.save();
		}
	}
}

export enum SettingsTab {
	SHORTCUTS = 'shortcuts',
	THEME = 'theme',
	AI_KEY = 'ai-key',
	QURAN_INTEGRATION = 'quran-integration',
	BACKUP = 'backup',
	SUPPORT = 'support',
	CONTACT = 'contact',
	ABOUT = 'about'
}
