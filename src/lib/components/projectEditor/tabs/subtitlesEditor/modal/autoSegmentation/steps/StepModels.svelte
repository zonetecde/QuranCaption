<script lang="ts">
	import { MULTI_MODEL_OPTIONS } from '../constants';
	import { getSharedWizard } from '../sharedWizard';
	import LL from '$lib/i18n/i18n-svelte';
	import type { SegmentationRiwayah } from '$lib/services/AutoSegmentation';
	import HuggingFaceAccountSettings from '$lib/components/settings/HuggingFaceAccountSettings.svelte';

	const wizard = getSharedWizard();
	const isCloud = $derived(() => wizard.selection.aiVersion === 'multi_v2');
	const riwayat: Array<{ value: SegmentationRiwayah; label: string }> = [
		{ value: 'hafs', label: 'Hafs' },
		{ value: 'warsh', label: 'Warsh' },
		{ value: 'qalun', label: 'Qalun' },
		{ value: 'shuba', label: "Shu'bah" }
	];
</script>

<section class="space-y-4">
	<div class="flex items-start justify-between gap-4">
		<div>
			<h3 class="text-lg font-semibold text-primary">
				{isCloud() ? $LL.editor.alignmentSettings() : $LL.editor.chooseModelAndPerformance()}
			</h3>
			<p class="text-sm text-thirdly">
				{isCloud()
					? $LL.editor.alignmentSettingsDesc()
					: $LL.editor.chooseModelAndPerformanceDesc()}
			</p>
		</div>
		{#if isCloud()}
			<HuggingFaceAccountSettings badge />
		{/if}
	</div>

	<div class="space-y-2">
		<div class="text-xs uppercase text-thirdly">{$LL.editor.modelLabel()}</div>
		{#if isCloud()}
			<div class="grid grid-cols-1 gap-2 xl:grid-cols-2">
				{#each MULTI_MODEL_OPTIONS as option (option.value)}
					<button
						type="button"
						class="rounded-lg border p-3 text-start"
						class:border-accent-primary={wizard.selection.cloudModel === option.value}
						class:border-color={wizard.selection.cloudModel !== option.value}
						onclick={() => wizard.setCloudModel(option.value as 'Base' | 'Large')}
					>
						<div class="text-sm font-medium text-primary">{option.label}</div>
						<div class="text-xs text-thirdly">{option.description}</div>
					</button>
				{/each}
			</div>
		{:else}
			<div class="grid grid-cols-1 gap-2 xl:grid-cols-2">
				{#each MULTI_MODEL_OPTIONS as option (option.value)}
					<button
						type="button"
						class="rounded-lg border p-3 text-start"
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

	{#if isCloud()}
		<div class="space-y-2 rounded-xl border border-color p-3">
			<div class="text-xs uppercase text-thirdly">{$LL.editor.styleName.riwayah()}</div>
			<div class="grid grid-cols-2 gap-2 xl:grid-cols-4">
				{#each riwayat as option (option.value)}
					<button
						type="button"
						class="rounded-lg border p-2 text-sm"
						class:border-accent-primary={wizard.selection.riwayah === option.value}
						class:border-color={wizard.selection.riwayah !== option.value}
						onclick={() => wizard.setRiwayah(option.value)}>{option.label}</button
					>
				{/each}
			</div>
		</div>
	{/if}

	<div class="space-y-2 rounded-xl border border-color p-3">
		<div class="text-xs uppercase text-thirdly">{$LL.editor.deviceLabel()}</div>
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
</section>
