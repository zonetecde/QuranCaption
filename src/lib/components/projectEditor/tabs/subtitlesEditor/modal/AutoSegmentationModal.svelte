<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import ResultPanel from './autoSegmentation/ResultPanel.svelte';
	import { setSharedWizard } from './autoSegmentation/sharedWizard';
	import { useAutoSegmentationWizard } from './autoSegmentation/useAutoSegmentationWizard.svelte';
	import WizardFooter from './autoSegmentation/WizardFooter.svelte';
	import WizardHeader from './autoSegmentation/WizardHeader.svelte';
	import WizardSidebar from './autoSegmentation/WizardSidebar.svelte';
	import StepModels from './autoSegmentation/steps/StepModels.svelte';
	import StepReview from './autoSegmentation/steps/StepReview.svelte';
	import StepRuntime from './autoSegmentation/steps/StepRuntime.svelte';
	import StepSettings from './autoSegmentation/steps/StepSettings.svelte';
	import StepVersion from './autoSegmentation/steps/StepVersion.svelte';

	let { close } = $props<{ close: () => void }>();
	const wizard = useAutoSegmentationWizard();
	setSharedWizard(wizard);

	/** Initializes non-blocking local status checks when opening the wizard. */
	function initializeModal(): void {
		void wizard.refreshLocalStatus();
	}

	/** Clears shared wizard state when the modal is destroyed. */
	function disposeModal(): void {
		setSharedWizard(null);
	}

	onMount(initializeModal);
	onDestroy(disposeModal);
</script>

<div
	class="flex h-[92vh] xl:h-[80vh] w-[clamp(1200px,96vw,1700px)] max-w-[90vw] xl:max-w-[66vw] flex-col overflow-hidden rounded-2xl border border-color bg-secondary shadow-2xl shadow-black"
>
	<WizardHeader onClose={close} />
	<div class="flex min-h-0 flex-1">
		<WizardSidebar />
		<section class="flex min-w-0 flex-1 flex-col">
			<div class="flex-1 overflow-y-auto p-6">
				<div class="mx-auto max-w-4xl space-y-6">
					{#if wizard.currentStepKey === 'version'}
						<StepVersion />
					{:else if wizard.currentStepKey === 'runtime'}
						<StepRuntime />
					{:else if wizard.currentStepKey === 'models'}
						<StepModels />
					{:else if wizard.currentStepKey === 'settings'}
						<StepSettings />
					{:else}
						<StepReview />
					{/if}
					<ResultPanel />
				</div>
			</div>
			<WizardFooter onClose={close} />
		</section>
	</div>
</div>
