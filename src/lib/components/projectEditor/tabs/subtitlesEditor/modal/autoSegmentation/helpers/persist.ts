import Settings, { type AutoSegmentationSettings } from '$lib/classes/Settings.svelte';
import { globalState } from '$lib/runes/main.svelte';
import type { AiVersion, WizardSelectionState } from '../types';

/** Builds the wizard AI version from persisted settings. */
export function deriveAiVersion(settings?: AutoSegmentationSettings): AiVersion {
	if (!settings) return 'multi_v2';
	if (settings.mode === 'local') {
		if (settings.localAsrMode === 'legacy_whisper') return 'muaalem_local';
		if (settings.localAsrMode === 'muaalem_local') return 'muaalem_local';
		if ((settings.localAsrMode as string) === 'open_multi_aligner') return 'muaalem_local';
		return 'multi_v2_local';
	}
	return 'multi_v2';
}

/** Creates a full wizard selection state from persisted settings. */
export function deriveSelectionState(settings?: AutoSegmentationSettings): WizardSelectionState {
	const aiVersion = deriveAiVersion(settings);
	return {
		aiVersion,
		mode: aiVersion === 'multi_v2_local' || aiVersion === 'muaalem_local' ? 'local' : (settings?.mode ?? 'api'),
		runtime:
			aiVersion === 'multi_v2_local' || aiVersion === 'muaalem_local'
				? 'local'
				: settings?.mode === 'local'
					? 'cloud'
					: 'cloud',
		localAsrMode: aiVersion === 'muaalem_local' ? 'muaalem_local' : 'multi_aligner',
		legacyModel: settings?.legacyWhisperModel ?? 'base',
		multiModel: aiVersion === 'muaalem_local' ? 'Muaalem-v3.2' : (settings?.multiAlignerModel ?? 'Base'),
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
