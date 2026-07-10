<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import type { Style } from '$lib/classes/VideoStyle.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import type { StyleControlValue } from './types';

	let systemFontsPromise: Promise<string[]> | null = null;
	let {
		style,
		value,
		onChange
	}: { style: Style; value: StyleControlValue; onChange: (value: string) => void } = $props();

	/**
	 * Charge une seule fois la liste des polices système.
	 * @returns {Promise<string[]>} Polices disponibles sur la machine.
	 */
	function getSystemFonts(): Promise<string[]> {
		systemFontsPromise ??= invoke<string[]>('get_system_fonts');
		return systemFontsPromise;
	}
</script>

<select
	class="w-full"
	value={String(value)}
	onchange={(event) => onChange((event.target as HTMLSelectElement).value)}
>
	{#if style.id === 'font-family'}
		{#await getSystemFonts()}
			<option value="" disabled selected>{$LL.editor.loadingFonts()}</option>
		{:then fonts}
			<option value="QPC2">Uthamic Mushaf QPC2</option>
			<option value="QPC1">Uthamic Mushaf QPC1</option>
			<option value="Hafs">Hafs</option>
			<option value="IndoPak">IndoPak</option>
			<option value="Soosi">Soosi (Abu Amr)</option>
			{#each fonts as font (`${font}`)}
				<option value={font}>{font}</option>
			{/each}
		{:catch error}
			<option value="" disabled>{$LL.editor.errorLoadingFonts({ error: error.message })}</option>
		{/await}
	{:else}
		{#each style.options || [] as option (`${option}`)}
			<option value={option}
				>{option === 'Minimal Quran' ? $LL.editor.minimalQuran() : option}</option
			>
		{/each}
	{/if}
</select>
