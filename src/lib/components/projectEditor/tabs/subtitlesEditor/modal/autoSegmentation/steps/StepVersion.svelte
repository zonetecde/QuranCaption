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
			<p class="mt-3 text-xs text-thirdly">
				Older pipeline with lower alignment quality and more practical limits.
			</p>
		</button>

		<button
			type="button"
			class="rounded-xl border bg-gradient-to-br from-accent/80 to-bg-accent p-4 text-left shadow-sm transition-colors"
			class:border-accent-primary={wizard.selection.aiVersion === 'multi_v2'}
			class:border-color={wizard.selection.aiVersion !== 'multi_v2'}
			class:bg-accent={wizard.selection.aiVersion === 'multi_v2'}
			onclick={() => wizard.onVersionChange('multi_v2')}
		>
			<div class="mb-3 flex items-start justify-between gap-3">
				<div class="flex items-center gap-2 text-primary">
					<span class="material-icons">auto_awesome</span>Multi-Aligner V2
				</div>
				<span
					class="inline-flex items-center rounded-full border border-accent-primary bg-accent-primary px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--bg-primary)]"
				>
					Recommended
				</span>
			</div>
			<p class="text-sm font-medium text-primary">
				Very clearly better than Legacy V1. This is the version we recommend.
			</p>
			<p class="mt-2 text-sm text-thirdly">
				Cloud or local flow with much stronger alignment quality, a cleaner workflow, and
				near-unlimited usage in practice.
			</p>
		</button>
	</div>
</section>
