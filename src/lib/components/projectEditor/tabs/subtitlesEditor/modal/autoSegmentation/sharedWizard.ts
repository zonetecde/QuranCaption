import { globalState } from '$lib/runes/main.svelte';
import { getContext, setContext } from 'svelte';
import type { AutoSegmentationWizard } from './useAutoSegmentationWizard.svelte';

const SHARED_WIZARD_CONTEXT = Symbol('auto-segmentation-wizard');

/** Returns the shared auto-segmentation wizard instance. */
export function getSharedWizard(): AutoSegmentationWizard {
	const wizard = getContext<AutoSegmentationWizard | null>(SHARED_WIZARD_CONTEXT);
	if (!wizard) {
		throw new Error('Auto-segmentation wizard is not initialized.');
	}
	return wizard;
}

/** Provides the shared wizard to child components and marks the modal as open. */
export function setSharedWizard(wizard: AutoSegmentationWizard): void {
	setContext(SHARED_WIZARD_CONTEXT, wizard);
	globalState.shared.autoSegmentationWizard = wizard;
}

/** Clears the global marker only if it still belongs to this modal instance. */
export function clearSharedWizard(wizard: AutoSegmentationWizard): void {
	if (globalState.shared.autoSegmentationWizard === wizard) {
		globalState.shared.autoSegmentationWizard = null;
	}
}
