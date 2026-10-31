<script lang="ts">
	import type { Style } from '$lib/classes/VideoStyle.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { getStyleName } from '$lib/i18n/styleMapper';
	import { get } from 'svelte/store';
	import type { StyleControlValue } from './types';

	let {
		style,
		value,
		onChange
	}: { style: Style; value: StyleControlValue; onChange: (value: string) => void } = $props();
</script>

<select
	class="w-full"
	value={String(value)}
	onchange={(event) => onChange((event.target as HTMLSelectElement).value)}
>
	{#each style.options || [] as option (`${option}`)}
		<option value={option}>
			{['background-overlay-mode', 'background-overlay-fade-curve', 'text-orientation'].includes(
				style.id
			)
				? getStyleName(String(option), get(LL))
				: option === 'Minimal Quran'
					? $LL.editor.minimalQuran()
					: option}
		</option>
	{/each}
</select>
