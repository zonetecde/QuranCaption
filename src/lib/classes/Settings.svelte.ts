import { SerializableBase } from './misc/SerializableBase';
import { writeTextFile, readTextFile, exists } from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';
import { globalState } from '$lib/runes/main.svelte';
import { AnalyticsService } from '$lib/services/AnalyticsService';
import { VersionService } from '$lib/services/VersionService.svelte';
import MigrationService from '$lib/services/MigrationService';

export type AutoSegmentationSettings = {
	mode: 'api' | 'local';
	minSilenceMs: number;
	minSpeechMs: number;
	padMs: number;
	whisperModel: 'tiny' | 'base' | 'medium' | 'large';
	fillBySilence: boolean; // Si true, insère des SilenceClip. Sinon, étend les sous-titres.
	includeWordByWord: boolean; // If true, request word-by-word timestamps.
};

export default class Settings extends SerializableBase {
	private static settingsFile: string = 'settings.json';

	// État UI persistant
	persistentUiState = $state({
		// Indique si on affiche le moniteur d'exportation
		projectCardView: 'grid' as 'grid' | 'list',
		showWaveforms: true,
		lastClosedUpdateModal: new Date(0).toISOString(),
		videoExportFolder: '',
		theme: 'default' as
			| 'default'
			| 'blue-ocean'
			| 'orange-mechanic'
			| 'blue-light-ocean'
			| 'cyber-violet'
			| 'emerald-forest'
			| 'polar-ice'
			| 'desert-gold'
			| 'crimson-ember'
			| 'vintage-paper'
			| 'oled-stealth'
			| 'ethereal-glass'
			| 'matrix-terminal'
			| 'midnight-aurora'
			| 'minimal-zen'
			| 'industrial-steel'
			| 'royal-velvet'
	});

	autoSegmentationSettings = $state<AutoSegmentationSettings>({
		mode: 'local',
		minSilenceMs: 200,
		minSpeechMs: 1000,
		padMs: 50,
		whisperModel: 'base',
		fillBySilence: true,
		includeWordByWord: false
	});

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

		globalState.settings = Settings.fromJSON(settingsData);

		// Regarde la version des settings. Si c'est pas la même, ça veut dire
		// que l'utilisateur vient de mettre à jour
		const latestVersion = await VersionService.getAppVersion();
		if (globalState.settings.appVersion !== latestVersion) {
			// Telemetry
			AnalyticsService.trackAppUpdated(
				globalState.settings.appVersion || 'unknown',
				latestVersion || '0.0.0'
			);

			// Met à jour la version
			globalState.settings.appVersion = latestVersion || '0.0.0';

			// Sauvegarde les paramètres mis à jour
			await this.save();
		}

		// Migration des paramètres si besoin
		MigrationService.FromQC310ToQC311();
		MigrationService.FromQC315ToQC316();
		MigrationService.FromQC327ToQC328();
	}
}

export enum SettingsTab {
	SHORTCUTS = 'shortcuts',
	THEME = 'theme',
	ABOUT = 'about'
}
