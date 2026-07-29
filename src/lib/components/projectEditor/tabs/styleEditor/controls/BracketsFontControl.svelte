<script lang="ts">
	import type { Style } from '$lib/classes/VideoStyle.svelte';
	import type { ApplyStyleControlValue, StyleControlValue } from './types';

	let {
		style,
		value,
		onChange
	}: { style: Style; value: StyleControlValue; onChange: ApplyStyleControlValue } = $props();
</script>

<select
	class="w-full"
	style="font-family: 'QPC2BSML', serif;"
	value={String(value)}
	onchange={(event) => onChange((event.target as HTMLSelectElement).value)}
>
	{#each style.options || [] as option (`${option}`)}
		<option value={option} style="font-family: 'QPC2BSML', serif;">{option}</option>
	{/each}
</select>
