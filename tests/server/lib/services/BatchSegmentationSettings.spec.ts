import { describe, expect, it, vi } from 'vitest';
import Settings, { type AutoSegmentationSettings } from '$lib/classes/Settings.svelte';
import { globalState } from '$lib/runes/main.svelte';
import MigrationService from '$lib/services/MigrationService';
import {
	buildBatchSegmentationRunConfiguration,
	validateBatchSegmentationRuntime
} from '$lib/services/BatchSegmentationSettings';

/**
 * Construit des réglages persistés complets pour les tests.
 * @returns {AutoSegmentationSettings} Réglages locaux Old Quran Karim words alignment.
 */
function createSettings(): AutoSegmentationSettings {
	return {
		mode: 'local',
		localAsrMode: 'quran_word_timing_old',
		minSilenceMs: 200,
		minSpeechMs: 1000,
		padMs: 100,
		padLeftMs: 30,
		padRightMs: 200,
		riwayah: 'warsh',
		legacyWhisperModel: 'base',
		multiAlignerModel: 'Base',
		cloudModel: 'Base',
		device: 'GPU',
		hfToken: 'hf_secret',
		includeWbwTimestamps: true,
		fillBySilence: true,
		extendBeforeSilence: false,
		extendBeforeSilenceMs: 0
	};
}

describe('Batch segmentation settings', () => {
	it('freezes one secret-free snapshot for the old offline aligner', () => {
		const settings = createSettings();
		const configuration = buildBatchSegmentationRunConfiguration(settings);
		settings.minSilenceMs = 999;

		expect(configuration.snapshot.minSilenceMs).toBe(200);
		expect(configuration.snapshot.mode).toBe('quran_word_timing_old');
		expect(configuration.options.localAsrMode).toBe('quran_word_timing_old');
		expect(configuration.snapshot.padLeftMs).toBe(30);
		expect(configuration.snapshot.padRightMs).toBe(200);
		expect(configuration.snapshot.riwayah).toBe('warsh');
		expect(JSON.stringify(configuration.snapshot)).not.toContain('hf_secret');
		expect(JSON.stringify(configuration.snapshot)).not.toContain('Token');
		expect(configuration.options.hfToken).toBe('hf_secret');
	});

	it('migrates removed engine settings while preserving the old word aligner choice', () => {
		const previousSettings = globalState.settings;
		const save = vi.spyOn(Settings, 'save').mockResolvedValue(undefined);
		try {
			globalState.settings = new Settings();
			Object.assign(globalState.settings.autoSegmentationSettings, {
				mode: 'local',
				localAsrMode: 'surah_splitter',
				multiAlignerModel: 'SurahSplitter-Base-Quran',
				surahSplitterSurah: 2
			});
			MigrationService.FromQC348ToQC349();
			expect(globalState.settings.autoSegmentationSettings).toMatchObject({
				mode: 'local',
				localAsrMode: 'quran_word_timing',
				multiAlignerModel: 'Base',
				includeWbwTimestamps: true
			});
			expect(globalState.settings.autoSegmentationSettings).not.toHaveProperty(
				'surahSplitterSurah'
			);
			globalState.settings.autoSegmentationSettings.localAsrMode = 'quran_word_timing_old';
			MigrationService.FromQC348ToQC349();
			expect(globalState.settings.autoSegmentationSettings.localAsrMode).toBe(
				'quran_word_timing_old'
			);
			expect(save).toHaveBeenCalledOnce();
		} finally {
			globalState.settings = previousSettings;
			save.mockRestore();
		}
	});

	it('rejects HF JSON and unavailable local engines', async () => {
		const settings = createSettings();
		expect(await validateBatchSegmentationRuntime(settings, 'hf_json')).toBe('HF_JSON_UNSUPPORTED');
		expect(
			await validateBatchSegmentationRuntime(settings, 'local', {
				ready: false,
				pythonInstalled: true,
				packagesInstalled: false,
				message: 'Unavailable',
				engines: {
					legacy: {
						ready: false,
						venvExists: false,
						packagesInstalled: false,
						usable: false,
						message: ''
					},
					multi: {
						ready: false,
						venvExists: false,
						packagesInstalled: false,
						usable: false,
						message: ''
					},
					quranwordtimingOld: {
						ready: false,
						venvExists: false,
						packagesInstalled: false,
						usable: false,
						message: ''
					}
				}
			})
		).toBe('LOCAL_ENGINE_UNAVAILABLE');
	});
});
