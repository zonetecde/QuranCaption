<script lang="ts">
	import { MULTI_MODEL_OPTIONS, MUAALEM_MODEL_OPTIONS } from '../constants';
	import { getSharedWizard } from '../sharedWizard';

	const wizard = getSharedWizard();
	const isMuaalemLocal = $derived(() => wizard.selection.aiVersion === 'muaalem_local');
	const isCloud = $derived(() => wizard.selection.aiVersion === 'multi_v2');
</script>

<section class="space-y-4">
	<div>
		<h3 class="text-lg font-semibold text-primary">3. Choose model and performance</h3>
		<p class="text-sm text-thirdly">Pick the balance between speed and quality for this method.</p>
	</div>

	<div class="space-y-2">
		<div class="text-xs uppercase text-thirdly">Model</div>
		{#if isCloud()}
			<div class="grid grid-cols-1 gap-2 xl:grid-cols-2">
				{#each MULTI_MODEL_OPTIONS as option (option.value)}
					<button
						type="button"
						class="rounded-lg border p-3 text-left"
						class:border-accent-primary={wizard.selection.cloudModel === option.value}
						class:border-color={wizard.selection.cloudModel !== option.value}
						onclick={() => wizard.setCloudModel(option.value as 'Base' | 'Large')}
					>
						<div class="text-sm font-medium text-primary">{option.label}</div>
						<div class="text-xs text-thirdly">{option.description}</div>
						<div class="mt-1 text-[11px] font-mono text-thirdly/80">{option.source}</div>
					</button>
				{/each}
			</div>
		{:else if isMuaalemLocal()}
			<div class="space-y-4">
				<div class="rounded-xl border border-color bg-accent/40 p-3 text-sm text-thirdly">
					Muaalem Local combines Quran-specific segmentation, phonetic speech recognition,
					monotonic Quran passage retrieval, and local forced alignment for real word-by-word
					timings.
				</div>

				<div class="space-y-2">
					<div class="text-xs uppercase text-thirdly">Speech recognition model</div>
					<div class="grid grid-cols-1 gap-2">
						{#each MUAALEM_MODEL_OPTIONS as option (option.value)}
							<button
								type="button"
								class="rounded-lg border p-3 text-left"
								class:border-accent-primary={wizard.selection.multiModel === option.value}
								class:border-color={wizard.selection.multiModel !== option.value}
								onclick={() => wizard.setMultiModel(option.value)}
							>
								<div class="flex items-center justify-between gap-3">
									<div class="text-sm font-medium text-primary">{option.label}</div>
									<span
										class="inline-flex items-center rounded-full border border-accent-primary bg-accent-primary px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--bg-primary)]"
									>
										Recommended
									</span>
								</div>
								<div class="text-xs text-thirdly">{option.description}</div>
								<div class="mt-1 text-[11px] font-mono text-thirdly/80">{option.source}</div>
							</button>
						{/each}
					</div>
				</div>
			</div>
		{:else}
			<div class="grid grid-cols-1 gap-2 xl:grid-cols-2">
				{#each MULTI_MODEL_OPTIONS as option (option.value)}
					<button
						type="button"
						class="rounded-lg border p-3 text-left"
						class:border-accent-primary={wizard.selection.multiModel === option.value}
						class:border-color={wizard.selection.multiModel !== option.value}
						onclick={() => wizard.setMultiModel(option.value)}
					>
						<div class="text-sm font-medium text-primary">{option.label}</div>
						<div class="text-xs text-thirdly">{option.description}</div>
						<div class="mt-1 text-[11px] font-mono text-thirdly/80">{option.source}</div>
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<div class="space-y-2 rounded-xl border border-color p-3">
		<div class="text-xs uppercase text-thirdly">Device</div>
		<div class="grid grid-cols-2 gap-2">
			<button
				type="button"
				class="rounded-lg border p-2 text-sm"
				class:border-accent-primary={wizard.selection.device === 'GPU'}
				class:border-color={wizard.selection.device !== 'GPU'}
				onclick={() => wizard.setDevice('GPU')}>GPU</button
			>
			<button
				type="button"
				class="rounded-lg border p-2 text-sm"
				class:border-accent-primary={wizard.selection.device === 'CPU'}
				class:border-color={wizard.selection.device !== 'CPU'}
				onclick={() => wizard.setDevice('CPU')}>CPU</button
			>
		</div>
	</div>

	{#if isMuaalemLocal()}
		<div class="rounded-xl border border-color bg-accent/40 p-3 text-xs text-thirdly">
			This method is fully local, but it is generally less effective than the official Quranic
			Universal Aligner.
		</div>
	{/if}
</section>
