<script lang="ts">
	import AiMetricsGrid from './AiMetricsGrid.svelte';
	import LL from '$lib/i18n/i18n-svelte';

	type MetricItem = {
		label: string;
		value: string | number;
		valueClass?: string;
	};

	let {
		title,
		icon,
		metrics,
		estimatedCostLabel,
		tokenSummary,
		reasoningNote,
		columnsClass = 'md:grid-cols-3'
	}: {
		title: string;
		icon: string;
		metrics: MetricItem[];
		estimatedCostLabel: string;
		tokenSummary: string;
		reasoningNote: string;
		columnsClass?: string;
	} = $props();
</script>

<div class="rounded-xl border border-color bg-accent p-3">
	<div class="mb-3 flex items-center gap-2">
		<span class="material-icons text-lg text-accent-primary">{icon}</span>
		<h3 class="text-base font-semibold text-primary">{title}</h3>
	</div>

	<AiMetricsGrid
		items={metrics}
		{columnsClass}
		containerClass="grid gap-2"
		cardClass="rounded-lg border border-color bg-secondary p-2"
		labelClass="text-[10px] uppercase leading-tight tracking-wide text-thirdly"
		valueClass="mt-1 text-base font-semibold text-primary"
	/>

	<div class="mt-3 rounded-lg border border-[var(--accent-primary)]/30 bg-secondary p-3">
		<div class="mb-1 text-xs font-medium text-primary">
			{$LL.editor.estimatedCost()}
			{estimatedCostLabel}
		</div>
		<div class="text-xs text-thirdly">{tokenSummary}</div>
		<div class="mt-2 text-xs text-thirdly">{reasoningNote}</div>
	</div>
</div>
