<script lang="ts">
	import { getSharedWizard } from './sharedWizard';

	let { onClose } = $props<{ onClose: () => void }>();
	const wizard = getSharedWizard();
	const isLastStep = $derived(() => wizard.currentStep >= wizard.maxStep);
	const startLabel = $derived(() =>
		wizard.selection.runtime === 'hf_json' ? 'Add subtitles' : 'Start segmentation'
	);
	const startIcon = $derived(() =>
		wizard.selection.runtime === 'hf_json' ? 'note_add' : 'play_arrow'
	);
</script>

<footer class="border-t border-color bg-primary px-6 py-4">
	<div class="flex items-center justify-between gap-4">
		<p class="text-xs text-thirdly">{wizard.helperText()}</p>
		<div class="flex items-center gap-2">
			{#if wizard.result?.status === 'completed'}
				<button class="btn-accent px-4 py-2 text-sm" onclick={onClose}>Finish</button>
			{:else}
				<button class="btn px-4 py-2 text-sm" onclick={onClose}>Close</button>
				<button
					type="button"
					class="btn inline-flex items-center px-4 py-2 text-sm"
					onclick={wizard.goBack}
					disabled={wizard.currentStep === 0 || wizard.isRunning}
				>
					<span class="material-icons text-base leading-none">arrow_back</span>
				</button>
				{#if isLastStep()}
					<button
						type="button"
						class="btn-accent inline-flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-50"
						onclick={() => void wizard.startSegmentation()}
						disabled={!wizard.canStart() || wizard.isRunning}
					>
						<span class="material-icons text-base leading-none">{startIcon()}</span>
						{startLabel()}
					</button>
				{:else}
					<button
						type="button"
						class="btn-accent inline-flex items-center gap-1.5 px-4 py-2 text-sm"
						onclick={wizard.goNext}
						disabled={!wizard.canGoNext() || wizard.isRunning}
					>
						Next
						<span class="material-icons text-base leading-none">arrow_forward</span>
					</button>
				{/if}
			{/if}
		</div>
	</div>
</footer>
