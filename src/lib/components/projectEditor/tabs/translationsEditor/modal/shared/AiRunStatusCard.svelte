<script lang="ts">
	import AiMetricsGrid from './AiMetricsGrid.svelte';

	type MetricItem = {
		label: string;
		value: string | number;
		valueClass?: string;
	};

	let {
		title,
		subtitle,
		progressPercent,
		metrics,
		columnsClass = 'md:grid-cols-2',
		containerClass = 'rounded-xl border border-color bg-secondary p-4 space-y-3',
		metricCardClass = 'rounded-lg border border-color bg-accent px-3 py-2',
		progressTrackClass = 'bg-accent',
		progressBarClass = 'bg-[var(--accent-primary)]',
		detailLabel,
		detailText
	}: {
		title: string;
		subtitle: string;
		progressPercent: number;
		metrics: MetricItem[];
		columnsClass?: string;
		containerClass?: string;
		metricCardClass?: string;
		progressTrackClass?: string;
		progressBarClass?: string;
		detailLabel?: string;
		detailText?: string;
	} = $props();
</script>

<div class={containerClass}>
	<div class="flex items-center justify-between gap-3">
		<div>
			<div class="text-sm font-semibold text-primary">{title}</div>
			<div class="text-xs text-thirdly">{subtitle}</div>
		</div>
		<div class="text-right">
			<div class="text-lg font-semibold text-primary">{progressPercent}%</div>
			<div class="text-[11px] uppercase tracking-[0.18em] text-thirdly">Progress</div>
		</div>
	</div>

	<div class={`h-2 overflow-hidden rounded-full ${progressTrackClass}`}>
		<div
			class={`h-full rounded-full transition-all duration-300 ${progressBarClass}`}
			style={`width: ${progressPercent}%;`}
		></div>
	</div>

	<AiMetricsGrid
		items={metrics}
		{columnsClass}
		containerClass="grid gap-3 text-xs"
		cardClass={metricCardClass}
		labelClass="text-thirdly"
		valueClass="mt-1 font-semibold text-primary"
	/>

	{#if detailText}
		<div class="rounded-lg border border-color bg-accent px-3 py-3 text-xs text-secondary">
			{#if detailLabel}
				<span class="font-semibold text-primary">{detailLabel}</span>
			{/if}
			{detailText}
		</div>
	{/if}
</div>
