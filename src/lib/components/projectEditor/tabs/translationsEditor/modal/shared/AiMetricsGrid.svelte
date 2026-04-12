<script lang="ts">
	type MetricItem = {
		label: string;
		value: string | number;
		valueClass?: string;
	};

	let {
		items,
		columnsClass = 'md:grid-cols-3',
		containerClass = 'grid gap-3',
		cardClass = 'rounded-lg border border-color bg-secondary p-3',
		labelClass = 'text-xs uppercase tracking-wide text-thirdly',
		valueClass = 'mt-1 text-xl font-semibold text-primary'
	}: {
		items: MetricItem[];
		columnsClass?: string;
		containerClass?: string;
		cardClass?: string;
		labelClass?: string;
		valueClass?: string;
	} = $props();
</script>

<div class={`${containerClass} ${columnsClass}`}>
	{#each items as item (`${item.label}-${item.value}`)}
		<div class={cardClass}>
			<div class={labelClass}>{item.label}</div>
			<div class={item.valueClass ?? valueClass}>{item.value}</div>
		</div>
	{/each}
</div>
