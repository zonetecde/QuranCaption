<script lang="ts">
	import { getSharedWizard } from '../sharedWizard';

	const wizard = getSharedWizard();
</script>

<section class="space-y-4">
	<div>
		<h3 class="text-lg font-semibold text-primary">1. Select AI version</h3>
		<p class="text-sm text-thirdly">Choose the segmentation family before runtime configuration.</p>
	</div>

	<div class="grid grid-cols-1 gap-3 xl:grid-cols-2">
		<button
			type="button"
			class="rounded-xl border p-4 text-left transition-colors"
			class:border-accent-primary={wizard.selection.aiVersion === 'legacy_v1'}
			class:bg-accent={wizard.selection.aiVersion === 'legacy_v1'}
			class:border-color={wizard.selection.aiVersion !== 'legacy_v1'}
			onclick={() => wizard.onVersionChange('legacy_v1')}
		>
			<div class="mb-1 flex items-center gap-2 text-primary">
				<span class="material-icons">memory</span>Legacy V1
			</div>
			<p class="text-sm text-thirdly">Local-only Whisper workflow with 4 legacy model sizes.</p>
		</button>

		<button
			type="button"
			class="rounded-xl border p-4 text-left transition-colors"
			class:border-accent-primary={wizard.selection.aiVersion === 'multi_v2'}
			class:bg-accent={wizard.selection.aiVersion === 'multi_v2'}
			class:border-color={wizard.selection.aiVersion !== 'multi_v2'}
			onclick={() => wizard.onVersionChange('multi_v2')}
		>
			<div class="mb-1 flex items-center gap-2 text-primary">
				<span class="material-icons">auto_awesome</span>Multi-Aligner V2
			</div>
			<p class="text-sm text-thirdly">Cloud or local flow with alignment-focused transcription.</p>
		</button>
	</div>
</section>
