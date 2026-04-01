<script lang="ts">
	import { getSharedWizard } from '../sharedWizard';

	const wizard = getSharedWizard();
	const cloudDisabled = $derived(() => wizard.selection.aiVersion === 'legacy_v1');
</script>

<section class="space-y-4">
	<div>
		<h3 class="text-lg font-semibold text-primary">2. Choose runtime</h3>
		<p class="text-sm text-thirdly">
			V1 runs locally only. V2 supports cloud, local, and JSON import from Hugging Face.
		</p>
	</div>

	<div class="grid grid-cols-1 gap-3 xl:grid-cols-2">
		<button
			type="button"
			class="rounded-xl border bg-gradient-to-br from-accent/80 to-bg-accent p-4 text-left shadow-sm transition-colors"
			class:opacity-50={cloudDisabled()}
			class:border-accent-primary={wizard.selection.runtime === 'cloud' && !cloudDisabled()}
			class:border-color={wizard.selection.runtime !== 'cloud' || cloudDisabled()}
			disabled={cloudDisabled()}
			onclick={() => wizard.setRuntime('cloud')}
		>
			{#if cloudDisabled()}
				<div class="mb-1 flex items-center gap-2 text-primary">
					<span class="material-icons">cloud</span>Cloud runtime
				</div>
				<p class="text-sm text-thirdly">Cloud is disabled for Legacy V1.</p>
			{:else}
				<div class="mb-3 flex items-start justify-between gap-3">
					<div class="flex items-center gap-2 text-primary">
						<span class="material-icons">cloud</span>Cloud runtime
					</div>
					<span
						class="inline-flex items-center rounded-full border border-accent-primary bg-accent-primary px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--bg-primary)]"
					>
						Recommended
					</span>
				</div>
				<p class="text-sm font-medium text-primary">
					Near-unlimited usage in practice, and usually faster than local.
				</p>
				<p class="mt-2 text-sm text-thirdly">
					Uses Quran Multi-Aligner V2 remotely. For most machines, cloud is the fastest and simplest
					option.
				</p>
			{/if}
		</button>

		<button
			type="button"
			class="rounded-xl border p-4 text-left transition-colors"
			class:border-accent-primary={wizard.selection.runtime === 'local'}
			class:bg-accent={wizard.selection.runtime === 'local'}
			class:border-color={wizard.selection.runtime !== 'local'}
			onclick={() => wizard.setRuntime('local')}
		>
			<div class="mb-1 flex items-center gap-2 text-primary">
				<span class="material-icons">computer</span>Local runtime
			</div>
			<p class="text-sm text-thirdly">Runs on your machine with installable Python dependencies.</p>

			<p class="mt-2 text-xs text-thirdly">
				Local only becomes faster if you have a very powerful GPU and a fully ready setup.
			</p>
		</button>

		<button
			type="button"
			class="rounded-xl border p-4 text-left transition-colors xl:col-span-2"
			class:opacity-50={cloudDisabled()}
			class:border-accent-primary={wizard.selection.runtime === 'hf_json' && !cloudDisabled()}
			class:bg-accent={wizard.selection.runtime === 'hf_json' && !cloudDisabled()}
			class:border-color={wizard.selection.runtime !== 'hf_json' || cloudDisabled()}
			disabled={cloudDisabled()}
			onclick={() => wizard.setRuntime('hf_json')}
		>
			<div class="mb-1 flex items-center gap-2 text-primary">
				<span class="material-icons">upload_file</span>Paste from Hugging Face
			</div>
			<p class="text-sm text-thirdly">
				Import the downloaded JSON from Quran Multi-Aligner and add subtitles directly.
			</p>
		</button>
	</div>
</section>
