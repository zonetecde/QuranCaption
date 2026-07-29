<script lang="ts">
	import type { Style } from '$lib/classes/VideoStyle.svelte';
	import type { ApplyStyleControlValue, StyleControlValue } from './types';

	let {
		style,
		value,
		onChange
	}: { style: Style; value: StyleControlValue; onChange: ApplyStyleControlValue } = $props();
</script>

{#if style.id.includes('css')}
	<textarea
		value={String(value)}
		class="w-full mono"
		rows="5"
		oninput={(event) => onChange((event.target as HTMLTextAreaElement).value)}
	></textarea>
{:else}
	<input
		type="text"
		value={String(value)}
		class="w-full mono"
		oninput={(event) => onChange((event.target as HTMLInputElement).value)}
	/>
{/if}
