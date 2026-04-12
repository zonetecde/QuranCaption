<script lang="ts">
	import AiMetricsGrid from './AiMetricsGrid.svelte';

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

<div class="rounded-xl border border-color bg-accent p-4">
	<div class="mb-4 flex items-center gap-2">
		<span class="material-icons text-accent-primary">{icon}</span>
		<h3 class="text-lg font-semibold text-primary">{title}</h3>
	</div>

	<AiMetricsGrid items={metrics} {columnsClass} />

	<div class="mt-4 rounded-lg border border-[var(--accent-primary)]/30 bg-secondary p-4">
		<div class="mb-1 text-sm font-medium text-primary">Estimated cost: {estimatedCostLabel}</div>
		<div class="text-xs text-thirdly">{tokenSummary}</div>
		<div class="mt-2 text-xs text-thirdly">{reasoningNote}</div>
	</div>
</div>
