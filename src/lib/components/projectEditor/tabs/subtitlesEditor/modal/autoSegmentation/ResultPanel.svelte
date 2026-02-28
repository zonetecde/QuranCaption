<script lang="ts">
	import { getSharedWizard } from './sharedWizard';

	const wizard = getSharedWizard();
</script>

{#if wizard.isRunning}
	<div class="rounded-xl border border-color bg-accent px-4 py-3">
		<div class="flex items-center gap-3 text-sm text-secondary">
			<div
				class="h-5 w-5 animate-spin rounded-full border-2 border-accent-primary border-t-transparent"
			></div>
			{wizard.currentStatus ||
				(wizard.selection.runtime === 'hf_json'
					? 'Applying imported JSON segments...'
					: wizard.selection.mode === 'api'
					? 'Sending audio to cloud...'
					: 'Running local segmentation...')}
		</div>
		{#if wizard.currentStatusProgress !== null}
			<div class="mt-3">
				<div class="mb-1 flex items-center justify-between text-[11px] text-thirdly">
					<span>Upload progress</span>
					<span>{Math.round(wizard.currentStatusProgress)}%</span>
				</div>
				<div class="h-2 overflow-hidden rounded-full bg-thirdly/25">
					<div
						class="h-full rounded-full bg-accent-primary transition-all duration-200"
						style={`width: ${wizard.currentStatusProgress}%`}
					></div>
				</div>
			</div>
		{:else if wizard.estimatedProgress !== null}
			<div class="mt-3">
				<div class="mb-1 flex items-center justify-between text-[11px] text-thirdly">
					<span>Estimated progress</span>
					<span>{Math.round(wizard.estimatedProgress)}%</span>
				</div>
				<div class="h-2 overflow-hidden rounded-full bg-thirdly/25">
					<div
						class="h-full rounded-full bg-accent-primary transition-all duration-300"
						style={`width: ${wizard.estimatedProgress}%`}
					></div>
				</div>
				{#if wizard.estimatedRemainingS !== null}
					<div class="mt-1 text-[11px] text-thirdly">
						Estimated time left: ~{wizard.estimatedRemainingS}s
					</div>
				{/if}
			</div>
		{/if}
	</div>
{:else if wizard.result && wizard.result.status === 'completed'}
	<div class="rounded-xl border border-color bg-accent px-4 py-3 space-y-2">
		<div class="flex items-center gap-2 text-sm font-semibold text-primary">
			<span class="material-icons text-accent-primary leading-none">check_circle</span>
			Segmentation complete
		</div>
		{#if wizard.fallbackMessage}<div
				class="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-300"
			>
				{wizard.fallbackMessage}
			</div>{/if}
		{#if wizard.warningMessage}<div
				class="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-300"
			>
				{wizard.warningMessage}
			</div>{/if}
		{#if wizard.selection.runtime !== 'hf_json'}
			<div class="flex flex-wrap items-center gap-2 text-sm text-secondary">
				<div>
					Model: <span class="font-semibold text-primary">{wizard.selectedModel()}</span>
					({wizard.effectiveDeviceLabel()})
				</div>
				{#if wizard.cloudCpuFallbackMessage}
					<span
						class="inline-flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[11px] text-blue-300"
					>
						<span class="material-icons text-[14px] leading-none">sync</span>
						Retried on CPU
					</span>
				{/if}
			</div>
		{:else}
			<div class="text-sm text-secondary">
				Import source: <span class="font-semibold text-primary"
					>{wizard.importedJsonFileName || 'Pasted JSON content'}</span
				>
			</div>
		{/if}
		{#if wizard.cloudCpuFallbackMessage}<div class="text-xs text-thirdly">
				{wizard.cloudCpuFallbackMessage}
			</div>{/if}
		<div class="text-sm text-secondary">
			Segments: <span class="font-semibold text-primary">{wizard.result.segmentsApplied}</span>
		</div>
		<div class="text-sm text-secondary">
			Low-confidence segments: <span class="font-semibold text-primary"
				>{wizard.result.lowConfidenceSegments}</span
			>
		</div>
		<div class="text-sm text-secondary">
			Possible missing-words segments: <span class="font-semibold text-primary"
				>{wizard.result.coverageGapSegments}</span
			>
		</div>
		<div class="text-sm text-secondary">
			Verse range: <span class="font-semibold text-primary">{wizard.verseRange()}</span>
		</div>
	</div>
{:else if wizard.errorMessage}
	<div class="rounded-xl border border-danger-color bg-danger-color/10 px-4 py-3">
		<div class="text-sm font-semibold text-danger-color">Segmentation failed</div>
		<div class="max-h-36 overflow-y-auto text-sm text-secondary">{wizard.errorMessage}</div>
	</div>
{/if}
