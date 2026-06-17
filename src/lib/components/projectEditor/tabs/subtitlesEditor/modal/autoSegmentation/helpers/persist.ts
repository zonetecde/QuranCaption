import Settings, { type AutoSegmentationSettings } from '$lib/classes/Settings.svelte';
import { globalState } from '$lib/runes/main.svelte';
import type { AiVersion, WizardSelectionState } from '../types';
import {
	MUAALEM_ADVANCED_MODEL_OPTIONS,
	MUAALEM_MODEL_OPTIONS,
	SURAH_SPLITTER_MODEL_OPTIONS
} from '../constants';

/** Builds the wizard AI version from persisted settings. */
export function deriveAiVersion(settings?: AutoSegmentationSettings): AiVersion {
	if (!settings) return 'multi_v2';
	if (settings.mode === 'local') {
		if (settings.localAsrMode === 'legacy_whisper') return 'muaalem_local';
		if (settings.localAsrMode === 'muaalem_local') return 'muaalem_local';
		if (settings.localAsrMode === 'surah_splitter') return 'surah_splitter';
		if ((settings.localAsrMode as string) === 'open_multi_aligner') return 'muaalem_local';
		return 'multi_v2_local';
	}
	return 'multi_v2';
}

/** Creates a full wizard selection state from persisted settings. */
export function deriveSelectionState(settings?: AutoSegmentationSettings): WizardSelectionState {
	const aiVersion = deriveAiVersion(settings);
	const validMuaalemModels = new Set<string>([
		...MUAALEM_MODEL_OPTIONS.map((option) => option.value),
		...MUAALEM_ADVANCED_MODEL_OPTIONS.map((option) => option.value)
	]);
	const muaalemModel =
		settings?.multiAlignerModel && validMuaalemModels.has(settings.multiAlignerModel)
			? settings.multiAlignerModel
			: 'Muaalem-v3.2';
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
			aiVersion === 'muaalem_local' ||
			aiVersion === 'surah_splitter'
				? 'local'
				: (settings?.mode ?? 'api'),
		runtime:
			aiVersion === 'multi_v2_local' ||
			aiVersion === 'muaalem_local' ||
			aiVersion === 'surah_splitter'
				? 'local'
				: settings?.mode === 'local'
					? 'cloud'
					: 'cloud',
		localAsrMode:
			aiVersion === 'muaalem_local'
				? 'muaalem_local'
				: aiVersion === 'surah_splitter'
					? 'surah_splitter'
					: 'multi_aligner',
		legacyModel: settings?.legacyWhisperModel ?? 'base',
		multiModel:
			aiVersion === 'muaalem_local'
				? muaalemModel
				: aiVersion === 'surah_splitter'
					? surahSplitterModel
					: (settings?.multiAlignerModel ?? 'Base'),
		cloudModel: settings?.cloudModel ?? 'Base',
		surahSplitterSurah: settings?.surahSplitterSurah ?? null,
		muaalemMultipleSurahs: settings?.muaalemMultipleSurahs ?? false,
		device: aiVersion === 'muaalem_local' ? 'CPU' : (settings?.device ?? 'GPU'),
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
