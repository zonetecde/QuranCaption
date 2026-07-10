<script lang="ts">
	import type { ApplyStyleControlValue, StyleControlValue } from './types';
	import { pickImageFile } from './utils';

	let {
		value,
		disabled,
		onChange
	}: { value: StyleControlValue; disabled: boolean; onChange: ApplyStyleControlValue } = $props();

	/**
	 * Sélectionne puis applique un fichier image.
	 * @returns {Promise<void>}
	 */
	async function selectFile(): Promise<void> {
		const path = await pickImageFile();
		if (path) onChange(path);
	}
</script>

<div class="flex flex-col gap-4">
	<button
		type="button"
		onclick={selectFile}
		class="btn-accent flex w-full cursor-pointer items-center justify-center rounded-md px-3 py-2 text-sm transition-colors duration-200"
		{disabled}
	>
		<span class="material-icons mr-2 text-base">folder_open</span>
		Pick an image
	</button>
	{#if value}
		<div class="rounded-md bg-gray-100 p-3 dark:bg-gray-800">
			<p class="break-all font-mono text-sm text-gray-700 dark:text-gray-300">{String(value)}</p>
		</div>
	{/if}
</div>
