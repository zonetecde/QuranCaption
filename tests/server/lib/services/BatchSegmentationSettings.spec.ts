import { describe, expect, it } from 'vitest';
import type { AutoSegmentationSettings } from '$lib/classes/Settings.svelte';
import {
	buildBatchSegmentationRunConfiguration,
	validateBatchSegmentationRuntime
} from '$lib/services/BatchSegmentationSettings';

/**
 * Construit des réglages persistés complets pour les tests.
 * @returns {AutoSegmentationSettings} Réglages locaux Surah Splitter.
 */
function createSettings(): AutoSegmentationSettings {
	return {
		mode: 'local',
		localAsrMode: 'surah_splitter',
		minSilenceMs: 200,
		minSpeechMs: 1000,
		padMs: 100,
		legacyWhisperModel: 'base',
		multiAlignerModel: 'SurahSplitter-Base-Quran',
		cloudModel: 'Base',
		surahSplitterSurah: 2,
		device: 'GPU',
		hfToken: 'hf_secret',
		includeWbwTimestamps: true,
		fillBySilence: true,
		extendBeforeSilence: false,
		extendBeforeSilenceMs: 0
	};
}

describe('Batch segmentation settings', () => {
	it('freezes one secret-free snapshot without silently changing the fixed surah', () => {
		const settings = createSettings();
		const configuration = buildBatchSegmentationRunConfiguration(settings);
		settings.minSilenceMs = 999;
		settings.surahSplitterSurah = 114;

		expect(configuration.snapshot.minSilenceMs).toBe(200);
		expect(configuration.snapshot.surahSplitterSurah).toBe(2);
		expect(JSON.stringify(configuration.snapshot)).not.toContain('hf_secret');
		expect(JSON.stringify(configuration.snapshot)).not.toContain('Token');
		expect(configuration.options.hfToken).toBe('hf_secret');
		expect(
			buildBatchSegmentationRunConfiguration(createSettings(), 'auto').snapshot.surahSplitterSurah
		).toBeNull();
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
					muaalem: {
						ready: false,
						venvExists: false,
						packagesInstalled: false,
						usable: false,
						message: ''
					},
					surahSplitter: {
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
