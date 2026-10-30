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
