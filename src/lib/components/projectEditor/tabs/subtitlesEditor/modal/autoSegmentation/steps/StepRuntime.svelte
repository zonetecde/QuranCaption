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
			class="rounded-xl border p-4 text-left transition-colors"
			class:opacity-50={cloudDisabled()}
			class:border-accent-primary={wizard.selection.runtime === 'cloud' && !cloudDisabled()}
			class:bg-accent={wizard.selection.runtime === 'cloud' && !cloudDisabled()}
			class:border-color={wizard.selection.runtime !== 'cloud' || cloudDisabled()}
			disabled={cloudDisabled()}
			onclick={() => wizard.setRuntime('cloud')}
		>
			<div class="mb-1 flex items-center gap-2 text-primary">
				<span class="material-icons">cloud</span>Cloud runtime
			</div>
			<p class="text-sm text-thirdly">
				{cloudDisabled()
					? 'Cloud is disabled for Legacy V1.'
					: 'Uses Quran Multi-Aligner v2 remotely.'}
			</p>
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
