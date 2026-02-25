import type { AutoSegmentationSettings } from '$lib/classes/Settings.svelte';
import Settings from '$lib/classes/Settings.svelte';
import { globalState } from '$lib/runes/main.svelte';
import type { AiVersion, WizardSelectionState } from '../types';

/** Builds the wizard AI version from persisted settings. */
export function deriveAiVersion(settings?: AutoSegmentationSettings): AiVersion {
	if (!settings) return 'multi_v2';
	return settings.mode === 'local' && settings.localAsrMode === 'legacy_whisper'
		? 'legacy_v1'
		: 'multi_v2';
}

/** Creates a full wizard selection state from persisted settings. */
export function deriveSelectionState(settings?: AutoSegmentationSettings): WizardSelectionState {
	const aiVersion = deriveAiVersion(settings);
	return {
		aiVersion,
		mode: aiVersion === 'legacy_v1' ? 'local' : (settings?.mode ?? 'api'),
		runtime:
			aiVersion === 'legacy_v1' ? 'local' : (settings?.mode === 'local' ? 'local' : 'cloud'),
		localAsrMode:
			aiVersion === 'legacy_v1' ? 'legacy_whisper' : (settings?.localAsrMode ?? 'multi_aligner'),
		legacyModel: settings?.legacyWhisperModel ?? 'base',
		multiModel: settings?.multiAlignerModel ?? 'Base',
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
