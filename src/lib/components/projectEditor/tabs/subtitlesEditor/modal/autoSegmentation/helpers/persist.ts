import Settings, { type AutoSegmentationSettings } from '$lib/classes/Settings.svelte';
import { globalState } from '$lib/runes/main.svelte';
import type { AiVersion, WizardSelectionState } from '../types';

/** Builds the wizard AI version from persisted settings. */
export function deriveAiVersion(settings?: AutoSegmentationSettings): AiVersion {
	if (!settings) return 'multi_v2';
	if (settings.mode === 'local') {
		if (settings.localAsrMode === 'legacy_whisper') return 'quran_word_timing';
		if (settings.localAsrMode === 'quran_word_timing_old') return 'quran_word_timing_old';
		if (settings.localAsrMode === 'quran_word_timing') return 'quran_word_timing';
		return 'multi_v2_local';
	}
	return 'multi_v2';
}

/** Creates a full wizard selection state from persisted settings. */
export function deriveSelectionState(settings?: AutoSegmentationSettings): WizardSelectionState {
	const aiVersion = deriveAiVersion(settings);
	return {
		aiVersion,
		mode:
			aiVersion === 'multi_v2_local' ||
			aiVersion === 'quran_word_timing_old' ||
			aiVersion === 'quran_word_timing'
				? 'local'
				: (settings?.mode ?? 'api'),
		runtime:
			aiVersion === 'multi_v2_local' ||
			aiVersion === 'quran_word_timing_old' ||
			aiVersion === 'quran_word_timing'
				? 'local'
				: settings?.mode === 'local'
					? 'cloud'
					: 'cloud',
		localAsrMode:
			aiVersion === 'quran_word_timing_old'
				? 'quran_word_timing_old'
				: aiVersion === 'quran_word_timing'
					? 'quran_word_timing'
					: 'multi_aligner',
		legacyModel: settings?.legacyWhisperModel ?? 'base',
		multiModel: settings?.multiAlignerModel ?? 'Base',
		cloudModel: settings?.cloudModel ?? 'Base',
		device: settings?.device ?? 'GPU',
		riwayah: settings?.riwayah ?? 'hafs',
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
