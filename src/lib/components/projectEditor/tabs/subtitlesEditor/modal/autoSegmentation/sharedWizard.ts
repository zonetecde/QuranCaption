import { globalState } from '$lib/runes/main.svelte';
import type { AutoSegmentationWizard } from './useAutoSegmentationWizard.svelte';

/** Returns the shared auto-segmentation wizard instance. */
export function getSharedWizard(): AutoSegmentationWizard {
	const wizard = globalState.shared.autoSegmentationWizard as AutoSegmentationWizard | null;
	if (!wizard) {
		throw new Error('Auto-segmentation wizard is not initialized.');
	}
	return wizard;
}

/** Stores or clears the shared wizard instance in global state. */
export function setSharedWizard(wizard: AutoSegmentationWizard | null): void {
	globalState.shared.autoSegmentationWizard = wizard;
}
