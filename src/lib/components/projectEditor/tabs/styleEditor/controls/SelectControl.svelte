<script lang="ts">
	import type { Style } from '$lib/classes/VideoStyle.svelte';
	import LL from '$lib/i18n/i18n-svelte';
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
		<option value={option}>{option === 'Minimal Quran' ? $LL.editor.minimalQuran() : option}</option
		>
	{/each}
</select>
