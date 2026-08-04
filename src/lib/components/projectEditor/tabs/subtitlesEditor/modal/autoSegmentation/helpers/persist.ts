import Settings, { type AutoSegmentationSettings } from '$lib/classes/Settings.svelte';
import { globalState } from '$lib/runes/main.svelte';
import type { AiVersion, WizardSelectionState } from '../types';
import { SURAH_SPLITTER_MODEL_OPTIONS } from '../constants';

/** Builds the wizard AI version from persisted settings. */
export function deriveAiVersion(settings?: AutoSegmentationSettings): AiVersion {
	if (!settings) return 'multi_v2';
	if (settings.mode === 'local') {
		if (settings.localAsrMode === 'legacy_whisper') return 'quran_word_timing';
		if (settings.localAsrMode === 'surah_splitter') return 'surah_splitter';
		if (settings.localAsrMode === 'quran_word_timing') return 'quran_word_timing';
		return 'multi_v2_local';
	}
	return 'multi_v2';
}

/** Creates a full wizard selection state from persisted settings. */
export function deriveSelectionState(settings?: AutoSegmentationSettings): WizardSelectionState {
	const aiVersion = deriveAiVersion(settings);
	const validSurahSplitterModels = new Set<string>(
		SURAH_SPLITTER_MODEL_OPTIONS.map((option) => option.value)
	);
	const surahSplitterModel =
		settings?.multiAlignerModel && validSurahSplitterModels.has(settings.multiAlignerModel)
			? settings.multiAlignerModel
			: 'SurahSplitter-Base-Quran';
	return {
		aiVersion,
		mode:
			aiVersion === 'multi_v2_local' ||
			aiVersion === 'surah_splitter' ||
			aiVersion === 'quran_word_timing'
				? 'local'
				: (settings?.mode ?? 'api'),
		runtime:
			aiVersion === 'multi_v2_local' ||
			aiVersion === 'surah_splitter' ||
			aiVersion === 'quran_word_timing'
				? 'local'
				: settings?.mode === 'local'
					? 'cloud'
					: 'cloud',
		localAsrMode:
			aiVersion === 'surah_splitter'
				? 'surah_splitter'
				: aiVersion === 'quran_word_timing'
					? 'quran_word_timing'
					: 'multi_aligner',
		legacyModel: settings?.legacyWhisperModel ?? 'base',
		multiModel:
			aiVersion === 'surah_splitter' ? surahSplitterModel : (settings?.multiAlignerModel ?? 'Base'),
		cloudModel: settings?.cloudModel ?? 'Base',
		surahSplitterSurah: settings?.surahSplitterSurah ?? null,
		device: settings?.device ?? 'GPU',
		hfToken: settings?.hfToken ?? ''
	};
}

/** Persists an AutoSegmentation settings patch safely. */
export async function persistSettingsPatch(
	patch: Partial<AutoSegmentationSettings>
): Promise<void> {
	if (!globalState.settings) return;
	Object.assign(globalState.settings.autoSegmentationSettings, patch);
	await Settings.save();
}
