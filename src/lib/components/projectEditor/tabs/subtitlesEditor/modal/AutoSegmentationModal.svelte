<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import ResultPanel from './autoSegmentation/ResultPanel.svelte';
	import { setSharedWizard } from './autoSegmentation/sharedWizard';
	import { useAutoSegmentationWizard } from './autoSegmentation/useAutoSegmentationWizard.svelte';
	import WizardFooter from './autoSegmentation/WizardFooter.svelte';
	import WizardHeader from './autoSegmentation/WizardHeader.svelte';
	import WizardSidebar from './autoSegmentation/WizardSidebar.svelte';
	import StepModels from './autoSegmentation/steps/StepModels.svelte';
	import StepImportJson from './autoSegmentation/steps/StepImportJson.svelte';
	import StepReview from './autoSegmentation/steps/StepReview.svelte';
	import StepRuntime from './autoSegmentation/steps/StepRuntime.svelte';
	import StepSettings from './autoSegmentation/steps/StepSettings.svelte';
	import StepVersion from './autoSegmentation/steps/StepVersion.svelte';

	let { close } = $props<{ close: () => void }>();
	const wizard = useAutoSegmentationWizard();
	let activeView = $state<'wizard' | 'import'>('wizard');
	let importResultVisible = $state(false);
	setSharedWizard(wizard);

	/** Runs the separate JSON import flow and keeps its feedback visible in the import view. */
	async function startImportedJsonFlow(): Promise<void> {
		importResultVisible = true;
		await wizard.startImportedJsonSegmentation();
	}

	/** Returns to the main wizard from the JSON import view. */
	function returnToWizard(): void {
		activeView = 'wizard';
	}

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
		{#if activeView === 'wizard'}
			<WizardSidebar />
			<section class="flex min-w-0 flex-1 flex-col">
				<div class="flex-1 overflow-y-auto p-6">
					<div class="mx-auto flex h-full min-h-0 max-w-4xl flex-col gap-6">
						{#if wizard.currentStepKey === 'version'}
							<StepVersion bind:activeView />
						{:else if wizard.currentStepKey === 'setup'}
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
		{:else}
			<section class="flex min-w-0 flex-1 flex-col">
				<div class="flex-1 overflow-y-auto p-6">
					<div class="mx-auto max-w-4xl space-y-6">
						<StepImportJson />
						{#if importResultVisible || wizard.isRunning || wizard.importedJsonParseError}
							<ResultPanel isImportMode />
						{/if}
					</div>
				</div>
				<footer class="border-t border-color bg-primary px-6 py-4">
					<div class="flex items-center justify-between gap-4">
						<p class="text-xs text-thirdly">
							{$LL.editor.importJsonDescription()}
						</p>
						<div class="flex items-center gap-2">
							{#if wizard.result?.status === 'completed'}
								<button class="btn px-4 py-2 text-sm" onclick={returnToWizard}>{$LL.common.back()}</button>
								<button class="btn-accent px-4 py-2 text-sm" onclick={close}>{$LL.common.finish()}</button>
							{:else}
								<button class="btn px-4 py-2 text-sm" onclick={close}>{$LL.common.close()}</button>
								<button class="btn px-4 py-2 text-sm" onclick={returnToWizard}>{$LL.common.back()}</button>
								<button
									type="button"
									class="btn-accent inline-flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-50"
									onclick={() => void startImportedJsonFlow()}
									disabled={!wizard.hasAudio() ||
										!wizard.importedJsonRaw.trim() ||
										wizard.isRunning}
								>
									<span class="material-icons text-base leading-none">note_add</span>
									{$LL.editor.applySegments()}
								</button>
							{/if}
						</div>
					</div>
				</footer>
			</section>
		{/if}
	</div>
</div>
