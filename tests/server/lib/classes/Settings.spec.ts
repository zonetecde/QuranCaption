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

	it('restores transcription defaults for projects created before speech to text', async () => {
		const saved: Record<string, unknown> = { ...new Settings().toJSON(), appVersion: '3.7.80' };
		delete saved.speechToTextSettings;
		vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(saved));
		await Settings.load();
		expect(globalState.settings!.speechToTextSettings).toMatchObject({
			provider: 'groq',
			groqApiKey: '',
			elevenLabsApiKey: '',
			maxWords: 8,
			maxDuration: 6,
			paddingBeforeMs: 500,
			paddingAfterMs: 500
		});
	});

	it('adds default silence padding to older transcription settings without changing saved keys', async () => {
		const settings = new Settings();
		settings.speechToTextSettings.groqApiKey = 'existing-groq-key';
		const saved: Record<string, unknown> = { ...settings.toJSON(), appVersion: '3.7.80' };
		const speech = saved.speechToTextSettings as Record<string, unknown>;
		delete speech.paddingBeforeMs;
		delete speech.paddingAfterMs;
		vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(saved));
		await Settings.load();
		expect(globalState.settings!.speechToTextSettings).toMatchObject({
			groqApiKey: 'existing-groq-key',
			paddingBeforeMs: 500,
			paddingAfterMs: 500
		});
	});

	it('persists personal transcription keys and the selected models separately', async () => {
		const settings = new Settings();
		settings.appVersion = '3.7.80';
		Object.assign(settings.speechToTextSettings, {
			provider: 'elevenlabs',
			groqApiKey: 'groq-test',
			elevenLabsApiKey: 'eleven-test',
			groqModel: 'whisper-large-v3-turbo',
			elevenLabsModel: 'scribe_v1',
			maxWords: 12,
			paddingBeforeMs: 0,
			paddingAfterMs: 750
		});
		vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(settings.toJSON()));
		await Settings.load();
		expect(globalState.settings!.speechToTextSettings).toEqual(settings.speechToTextSettings);
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

	it('migrates the previously unused translation batch default and adds the shared analysis size', async () => {
		const saved: Record<string, unknown> = { ...new Settings().toJSON(), appVersion: '3.7.80' };
		const ai = saved.aiTranslationSettings as Record<string, unknown>;
		delete ai.analysisBatchSize;
		ai.projectTranslationBatchWords = 450;
		vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(saved));
		await Settings.load();
		expect(globalState.settings!.aiTranslationSettings).toMatchObject({
			analysisBatchSize: 100,
			projectTranslationBatchWords: 650
		});
	});

	it.each([
		{ analysis: 2000, translation: 8000, expected: [2000, 8000] },
		{ analysis: 25, translation: 150, expected: [25, 150] },
		{ analysis: -1, translation: null, expected: [100, 650] },
		{ analysis: 9000, translation: 100000, expected: [2000, 8000] }
	])(
		'loads saved AI batch sizes with safety bounds: $expected',
		async ({ analysis, translation, expected }) => {
			const saved: Record<string, unknown> = { ...new Settings().toJSON(), appVersion: '3.7.80' };
			Object.assign(saved.aiTranslationSettings as object, {
				analysisBatchSize: analysis,
				projectTranslationBatchWords: translation
			});
			vi.mocked(readTextFile).mockResolvedValue(JSON.stringify(saved));
			await Settings.load();
			const ai = globalState.settings!.aiTranslationSettings;
			expect([ai.analysisBatchSize, ai.projectTranslationBatchWords]).toEqual(expected);
			await Settings.save();
			const persisted = JSON.parse(vi.mocked(writeTextFile).mock.calls.at(-1)![1]);
			expect(persisted.aiTranslationSettings).toMatchObject({
				analysisBatchSize: expected[0],
				projectTranslationBatchWords: expected[1]
			});
		}
	);

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
