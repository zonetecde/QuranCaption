import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import Settings from '$lib/classes/Settings.svelte';
import { DEFAULT_PROJECT_EDITOR_LAYOUT } from '$lib/constants/projectEditor';
import { globalState } from '$lib/runes/main.svelte';
import { VersionService } from '$lib/services/VersionService.svelte';

vi.mock('@tauri-apps/plugin-fs', () => ({
	exists: vi.fn(async () => true),
	readTextFile: vi.fn(),
	writeTextFile: vi.fn(async () => undefined)
}));
vi.mock('@tauri-apps/api/path', () => ({
	appDataDir: vi.fn(async () => '/test-settings'),
	join: vi.fn(async (...parts: string[]) => parts.join('/'))
}));

describe('loading legacy editor layout settings', () => {
	const originalSettings = globalState.settings;

	beforeEach(() => {
		globalState.settings = undefined;
		vi.spyOn(VersionService, 'getAppVersion').mockResolvedValue('3.7.80');
	});

	afterEach(() => {
		globalState.settings = originalSettings;
		vi.restoreAllMocks();
		vi.clearAllMocks();
	});

	it.each([
		['legacy', 'advanced'],
		['advanced', 'advanced'],
		['manual', 'manual']
	])('loads AI translation tab %s as %s', async (savedTab, expectedTab) => {
		const defaults = new Settings();
		vi.mocked(readTextFile).mockResolvedValue(
			JSON.stringify({
				...defaults.toJSON(),
				appVersion: '3.7.80',
				aiTranslationSettings: { ...defaults.aiTranslationSettings, activeModalTab: savedTab }
			})
		);
		await Settings.load();
		expect(globalState.settings!.aiTranslationSettings.activeModalTab).toBe(expectedTab);
	});

	it.each([undefined, null, false, [], 'invalid'])(
		'restores missing UI defaults when the saved UI state is %j',
		async (persistentUiState) => {
			const saved = { ...new Settings().toJSON(), appVersion: '3.7.80', persistentUiState };
			vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(saved));

			await Settings.load();

			expect(globalState.settings!.persistentUiState.projectEditorLayout).toEqual(
				DEFAULT_PROJECT_EDITOR_LAYOUT
			);
			if (persistentUiState !== undefined) {
				expect(
					JSON.parse(vi.mocked(writeTextFile).mock.calls.at(-1)![1]).persistentUiState
				).toMatchObject({ projectEditorLayout: DEFAULT_PROJECT_EDITOR_LAYOUT });
			}
		}
	);

	it.each([undefined, null, [], 'invalid'])(
		'restores a missing or invalid layout (%j) while keeping UI preferences',
		async (projectEditorLayout) => {
			const saved = {
				...new Settings().toJSON(),
				appVersion: '3.7.80',
				persistentUiState: { language: 'fr', theme: 'oled-stealth', projectEditorLayout }
			};
			vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(saved));

			await Settings.load();

			expect(globalState.settings!.persistentUiState).toMatchObject({
				language: 'fr',
				theme: 'oled-stealth',
				projectEditorLayout: DEFAULT_PROJECT_EDITOR_LAYOUT
			});
		}
	);

	it('publishes a repaired layout before reading other legacy settings', async () => {
		const legacy = Settings.fromJSON({ persistentUiState: { language: 'fr' } }) as Settings;
		legacy.appVersion = '3.7.80';
		let shortcuts = legacy.shortcuts;
		Object.defineProperty(legacy, 'shortcuts', {
			enumerable: true,
			/**
			 * Vérifie la mise en page visible lors des migrations de raccourcis.
			 * @returns {Settings['shortcuts']} Raccourcis existants.
			 */
			get() {
				expect(globalState.settings!.persistentUiState.projectEditorLayout).toEqual(
					DEFAULT_PROJECT_EDITOR_LAYOUT
				);
				return shortcuts;
			},
			/**
			 * Conserve les raccourcis mis à jour par les migrations.
			 * @param {Settings['shortcuts']} value Nouveaux raccourcis.
			 * @returns {void}
			 */
			set(value: Settings['shortcuts']) {
				shortcuts = value;
			}
		});
		vi.mocked(readTextFile).mockResolvedValue('{}');
		vi.spyOn(Settings, 'fromJSON').mockReturnValueOnce(legacy);

		await Settings.load();
	});

	it('keeps complete custom settings without rewriting the file', async () => {
		const settings = new Settings();
		settings.appVersion = '3.7.80';
		settings.persistentUiState.projectEditorLayout.videoEditorPanelWidth = 510;
		vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(settings.toJSON()));

		await Settings.load();

		expect(globalState.settings!.persistentUiState.projectEditorLayout.videoEditorPanelWidth).toBe(
			510
		);
		expect(writeTextFile).not.toHaveBeenCalled();
	});

	it('keeps legacy shortcuts hidden while awaiting the app version, then migrates them', async () => {
		const settings = new Settings();
		settings.appVersion = '3.7.80';
		settings.shortcuts.SUBTITLES_EDITOR.EDIT_LAST_SUBTITLE.keys = ['q'];
		const legacyShortcuts: Partial<Settings['shortcuts']['SUBTITLES_EDITOR']> = {
			...settings.shortcuts.SUBTITLES_EDITOR
		};
		const actions = [
			'EDIT_SUBTITLE_AT_CURSOR',
			'EDIT_TRANSLATION_AT_CURSOR',
			'EDIT_WBW_TIMESTAMP_AT_CURSOR',
			'EDIT_WBW_STYLE_AT_CURSOR'
		] as const;
		for (const action of actions) delete legacyShortcuts[action];
		vi.mocked(readTextFile).mockResolvedValue(
			JSON.stringify({
				...settings.toJSON(),
				shortcuts: { ...settings.shortcuts, SUBTITLES_EDITOR: legacyShortcuts }
			})
		);
		vi.mocked(VersionService.getAppVersion).mockImplementationOnce(async () => {
			expect(globalState.settings).toBeUndefined();
			return '3.7.80';
		});

		await Settings.load();

		for (const action of actions) {
			expect(globalState.settings!.shortcuts.SUBTITLES_EDITOR[action]).toEqual(
				settings.shortcuts.SUBTITLES_EDITOR[action]
			);
		}
		expect(globalState.settings!.shortcuts.SUBTITLES_EDITOR.EDIT_LAST_SUBTITLE.keys).toEqual(['q']);
	});

	it.each([undefined, {}])(
		'loads legacy settings with timeline shortcuts %j and persists their migration',
		async (timeline) => {
			const settings = new Settings();
			settings.appVersion = '3.7.80';
			settings.persistentUiState.language = 'ar';
			settings.shortcuts.SUBTITLES_EDITOR.EDIT_LAST_SUBTITLE.keys = ['q'];
			const categories: Partial<Settings['shortcutCategories']> = {
				...settings.shortcutCategories
			};
			delete categories.TIMELINE;
			vi.mocked(readTextFile).mockResolvedValue(
				JSON.stringify({
					...settings.toJSON(),
					shortcutCategories: categories,
					shortcuts: { ...settings.shortcuts, TIMELINE: timeline }
				})
			);

			await Settings.load();

			expect(globalState.settings!.shortcuts.TIMELINE).toEqual(settings.shortcuts.TIMELINE);
			expect(globalState.settings!.shortcutCategories.TIMELINE).toEqual(
				settings.shortcutCategories.TIMELINE
			);
			expect(globalState.settings!.persistentUiState.language).toBe('ar');
			expect(globalState.settings!.shortcuts.SUBTITLES_EDITOR.EDIT_LAST_SUBTITLE.keys).toEqual([
				'q'
			]);
			await vi.waitFor(() => expect(writeTextFile).toHaveBeenCalled());
			expect(JSON.parse(vi.mocked(writeTextFile).mock.calls.at(-1)![1]).shortcuts.TIMELINE).toEqual(
				settings.shortcuts.TIMELINE
			);
		}
	);

	it('adds missing marked-segment shortcuts without changing custom timeline bindings', async () => {
		const settings = new Settings();
		settings.appVersion = '3.7.80';
		settings.shortcuts.TIMELINE.ZOOM.keys = ['shift'];
		const timeline: Partial<Settings['shortcuts']['TIMELINE']> = { ...settings.shortcuts.TIMELINE };
		delete timeline.NEXT_MARKED_SEGMENT;
		delete timeline.PREVIOUS_MARKED_SEGMENT;
		vi.mocked(readTextFile).mockResolvedValue(
			JSON.stringify({
				...settings.toJSON(),
				shortcuts: { ...settings.shortcuts, TIMELINE: timeline }
			})
		);

		await Settings.load();

		expect(globalState.settings!.shortcuts.TIMELINE).toEqual(settings.shortcuts.TIMELINE);
		await vi.waitFor(() => expect(writeTextFile).toHaveBeenCalled());
		expect(JSON.parse(vi.mocked(writeTextFile).mock.calls.at(-1)![1]).shortcuts.TIMELINE).toEqual(
			settings.shortcuts.TIMELINE
		);
	});

	it('repairs individual dimensions while preserving custom widths and other settings', async () => {
		const saved = {
			...new Settings().toJSON(),
			appVersion: '3.7.80',
			persistentUiState: {
				language: 'fr',
				projectEditorLayout: { videoEditorPanelWidth: null, stylePanelWidth: 510 }
			}
		};
		vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(saved));

		await Settings.load();

		expect(globalState.settings!.persistentUiState.projectEditorLayout).toEqual({
			...DEFAULT_PROJECT_EDITOR_LAYOUT,
			stylePanelWidth: 510
		});
		expect(globalState.settings!.persistentUiState.language).toBe('fr');
	});
});
