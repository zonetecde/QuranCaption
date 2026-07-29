<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import ResultPanel from './autoSegmentation/ResultPanel.svelte';
	import { mobileModalSheet } from '$lib/services/mobileModalSheet';
	import { clearSharedWizard, setSharedWizard } from './autoSegmentation/sharedWizard';
	import { useAutoSegmentationWizard } from './autoSegmentation/useAutoSegmentationWizard.svelte';
	import WizardHeader from './autoSegmentation/WizardHeader.svelte';
	import StepSettings from './autoSegmentation/steps/StepSettings.svelte';

	let { close } = $props<{ close: () => void }>();
	const wizard = useAutoSegmentationWizard();
	let panel: HTMLElement;
	let closeTimer: ReturnType<typeof setTimeout> | undefined;
	setSharedWizard(wizard);

	/** Force le seul workflow pris en charge sur la version mobile. */
	function initializeModal(): void {
		if (wizard.selection.aiVersion !== 'multi_v2' || wizard.selection.mode !== 'api') {
			wizard.onVersionChange('multi_v2');
		}
		if (wizard.selection.cloudModel !== 'Base') wizard.setCloudModel('Base');
		if (wizard.selection.device !== 'GPU') wizard.setDevice('GPU');
	}

	/** Fait glisser le modal vers le bas avant de le fermer. */
	function closeModal(): void {
		if (closeTimer) return;
		panel.style.transform = 'translateY(100%)';
		closeTimer = setTimeout(close, 180);
	}

	/** Nettoie l'état partagé à la destruction du modal. */
	function disposeModal(): void {
		if (closeTimer) clearTimeout(closeTimer);
		clearSharedWizard(wizard);
	}

	onMount(initializeModal);
	onDestroy(disposeModal);
</script>

<div
	bind:this={panel}
	class="flex w-full flex-col overflow-hidden border border-color bg-secondary shadow-2xl shadow-black"
	use:mobileModalSheet={closeModal}
>
	<WizardHeader onClose={closeModal} />

	<section class="flex min-h-0 min-w-0 flex-1 flex-col">
		<div class="flex-1 overflow-y-auto p-4">
			<div class="mx-auto flex max-w-4xl flex-col gap-5">
				<StepSettings />
				<ResultPanel />
			</div>
		</div>

		<footer class="mobile-sheet-footer border-t border-color bg-primary px-4 py-3">
			<div class="flex items-center justify-end gap-2">
				{#if wizard.result?.status === 'completed'}
					<button class="btn-accent px-4 py-2 text-sm" onclick={closeModal}
						>{$LL.common.finish()}</button
					>
				{:else}
					<button class="btn px-4 py-2 text-sm" onclick={closeModal}>{$LL.common.close()}</button>
					<button
						type="button"
						class="btn-accent inline-flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-50"
						onclick={() => void wizard.startSegmentation()}
						disabled={!wizard.canStart() || wizard.isRunning}
					>
						<span class="material-icons text-base leading-none">play_arrow</span>
						{$LL.editor.startSegmentation()}
					</button>
				{/if}
			</div>
		</footer>
	</section>
</div>

<style>
	.mobile-sheet-footer {
		padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
	}
</style>
