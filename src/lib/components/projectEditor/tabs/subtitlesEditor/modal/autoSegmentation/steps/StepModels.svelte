<script lang="ts">
	import { LEGACY_MODEL_OPTIONS, MULTI_MODEL_OPTIONS } from '../constants';
	import LocalEngineCard from '../LocalEngineCard.svelte';
	import { maskToken } from '../helpers/format';
	import { getSharedWizard } from '../sharedWizard';

	const wizard = getSharedWizard();
	const isLegacyLocal = $derived(
		() => wizard.selection.aiVersion === 'legacy_v1' && wizard.selection.mode === 'local'
	);
	const isMultiLocal = $derived(
		() => wizard.selection.aiVersion === 'multi_v2' && wizard.selection.mode === 'local'
	);
	const asrLabel = $derived(() =>
		wizard.selection.aiVersion === 'legacy_v1' ? 'Legacy Whisper' : 'Multi-Aligner'
	);
</script>

<section class="space-y-4">
	<div>
		<h3 class="text-lg font-semibold text-primary">Model selection</h3>
		<p class="text-sm text-thirdly">
			Available models and local packages adapt to your selected version.
		</p>
	</div>

	{#if wizard.selection.mode === 'local'}
		<div
			class="inline-flex items-center gap-2 rounded-full border border-color bg-accent/70 px-3 py-1 text-xs text-secondary"
		>
			<span class="material-icons text-[16px] text-accent-primary">memory</span>
			ASR Mode: <span class="font-semibold text-primary">{asrLabel()}</span>
		</div>
	{/if}

	{#if wizard.selection.mode === 'api'}
		<div class="grid grid-cols-1 gap-2 xl:grid-cols-2">
			{#each MULTI_MODEL_OPTIONS as option}
				<button
					type="button"
					class="rounded-lg border p-3 text-left"
					class:border-accent-primary={wizard.selection.cloudModel === option.value}
					class:border-color={wizard.selection.cloudModel !== option.value}
					onclick={() => wizard.setCloudModel(option.value)}
				>
					<div class="text-sm font-medium text-primary">{option.label}</div>
					<div class="text-xs text-thirdly">{option.description}</div>
				</button>
			{/each}
		</div>
	{:else if isLegacyLocal()}
		<div class="space-y-2">
			{#each LEGACY_MODEL_OPTIONS as option}
				<button
					type="button"
					class="w-full rounded-lg border p-3 text-left"
					class:border-accent-primary={wizard.selection.legacyModel === option.value}
					class:border-color={wizard.selection.legacyModel !== option.value}
					onclick={() => wizard.setLegacyModel(option.value)}
				>
					<div class="text-sm font-medium text-primary">{option.label}</div>
					<div class="text-xs text-thirdly">{option.description}</div>
				</button>
			{/each}
		</div>
	{:else if isMultiLocal()}
		<div class="grid grid-cols-1 gap-2 xl:grid-cols-2">
			{#each MULTI_MODEL_OPTIONS as option}
				<button
					type="button"
					class="rounded-lg border p-3 text-left"
					class:border-accent-primary={wizard.selection.multiModel === option.value}
					class:border-color={wizard.selection.multiModel !== option.value}
					onclick={() => wizard.setMultiModel(option.value)}
				>
					<div class="text-sm font-medium text-primary">{option.label}</div>
					<div class="text-xs text-thirdly">{option.description}</div>
				</button>
			{/each}
		</div>
	{/if}

	{#if !isLegacyLocal()}
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
	{/if}

	{#if isMultiLocal()}
		<div class="rounded-xl border border-color bg-accent/70 p-3">
			<div class="mb-2 text-xs uppercase text-thirdly">Hugging Face token (required)</div>
			<p class="mb-2 text-xs text-thirdly">
				Required for Local V2 private models (`hetchyy/r15_95m`, `hetchyy/r7`).
			</p>
			<div class="mb-2 text-sm font-mono text-primary">{maskToken(wizard.selection.hfToken)}</div>
			<div class="flex gap-2">
				<button class="btn-accent px-3 py-1.5 text-xs" onclick={() => void wizard.promptHFToken()}
					>{wizard.selection.hfToken ? 'Update token' : 'Set token'}</button
				>
				<button
					class="btn px-3 py-1.5 text-xs"
					onclick={() => void wizard.clearHFToken()}
					disabled={!wizard.selection.hfToken}>Clear token</button
				>
			</div>
		</div>
	{/if}

	{#if wizard.selection.mode === 'local'}
		<div class="space-y-2 rounded-xl border border-color p-3">
			<div class="text-xs uppercase text-thirdly">Required local packages</div>
			<p class="text-xs text-thirdly">
				Install the Python packages required for the selected local engine.
			</p>
			{#if wizard.isCheckingStatus}
				<div class="text-sm text-secondary">Checking local engines in background...</div>
			{:else if wizard.selection.aiVersion === 'legacy_v1'}
				<LocalEngineCard
					title="Legacy Whisper"
					status={wizard.localStatus?.engines?.legacy ?? null}
					isInstalling={wizard.isInstallingDeps && wizard.installingEngine === 'legacy'}
					isInstalled={!!wizard.localStatus?.engines?.legacy?.ready}
					onInstall={() => void wizard.installEngine('legacy')}
				/>
			{:else}
				<LocalEngineCard
					title="Multi-Aligner"
					status={wizard.localStatus?.engines?.multi ?? null}
					isInstalling={wizard.isInstallingDeps && wizard.installingEngine === 'multi'}
					isInstalled={!!wizard.localStatus?.engines?.multi?.ready}
					onInstall={() => void wizard.installEngine('multi')}
				/>
			{/if}
			{#if wizard.installStatus}<div class="text-xs text-thirdly">{wizard.installStatus}</div>{/if}
		</div>
	{/if}
</section>
