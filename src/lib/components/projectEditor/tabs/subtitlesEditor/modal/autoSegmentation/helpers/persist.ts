import Settings, { type AutoSegmentationSettings } from '$lib/classes/Settings.svelte';
import { globalState } from '$lib/runes/main.svelte';
import type { AiVersion, WizardSelectionState } from '../types';

const LEGACY_TO_OPEN_MODEL = {
	tiny: 'Open-Legacy-Tiny',
	base: 'Open-Legacy-Base',
	medium: 'Open-Legacy-Medium',
	large: 'Open-Legacy-Large'
} as const;

/** Builds the wizard AI version from persisted settings. */
export function deriveAiVersion(settings?: AutoSegmentationSettings): AiVersion {
	if (!settings) return 'multi_v2';
	if (settings.mode === 'local') {
		if (settings.localAsrMode === 'legacy_whisper') return 'open_multi_v2';
		if (settings.localAsrMode === 'open_multi_aligner') return 'open_multi_v2';
		return 'multi_v2_local';
	}
	return 'multi_v2';
}

/** Creates a full wizard selection state from persisted settings. */
export function deriveSelectionState(settings?: AutoSegmentationSettings): WizardSelectionState {
	const aiVersion = deriveAiVersion(settings);
	return {
		aiVersion,
		mode: aiVersion === 'multi_v2_local' || aiVersion === 'open_multi_v2' ? 'local' : (settings?.mode ?? 'api'),
		runtime:
			aiVersion === 'multi_v2_local' || aiVersion === 'open_multi_v2'
				? 'local'
				: settings?.mode === 'local'
					? 'cloud'
					: 'cloud',
		localAsrMode:
			aiVersion === 'open_multi_v2' ? 'open_multi_aligner' : 'multi_aligner',
		legacyModel: settings?.legacyWhisperModel ?? 'base',
		multiModel:
			settings?.localAsrMode === 'legacy_whisper'
				? LEGACY_TO_OPEN_MODEL[settings.legacyWhisperModel ?? 'base']
				: (settings?.multiAlignerModel ?? 'Base'),
		cloudModel: settings?.cloudModel ?? 'Base',
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
