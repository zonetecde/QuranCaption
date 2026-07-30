import Settings, { type AutoSegmentationSettings } from '$lib/classes/Settings.svelte';
import { globalState } from '$lib/runes/main.svelte';

/** Persists an auto-segmentation settings patch safely. */
export async function persistSettingsPatch(
	patch: Partial<AutoSegmentationSettings>
): Promise<void> {
	if (!globalState.settings) return;
	Object.assign(globalState.settings.autoSegmentationSettings, patch);
	await Settings.save();
}
