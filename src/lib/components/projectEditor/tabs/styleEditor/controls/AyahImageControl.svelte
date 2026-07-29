<script lang="ts">
	import LL from '$lib/i18n/i18n-svelte';
	import type { ApplyStyleControlValue, StyleControlValue } from './types';
	import { pickImageFile } from './utils';

	let {
		value,
		disabled,
		onChange
	}: { value: StyleControlValue; disabled: boolean; onChange: ApplyStyleControlValue } = $props();

	const images = [
		...Array.from({ length: 20 }, (_, index) => `banniere_${index + 20}.png`),
		...Array.from({ length: 10 }, (_, index) => `banniere_${index + 10}.png`)
	];

	/**
	 * Sélectionne puis applique une bannière personnalisée.
	 * @returns {Promise<void>}
	 */
	async function selectFile(): Promise<void> {
		const path = await pickImageFile();
		if (path) onChange(path);
	}
</script>

<div class="flex flex-col gap-3">
	<p class="flex items-center gap-1 text-xs text-secondary">
		<span class="material-icons-outlined text-[12px]">info</span>
		New banners made by @isaglace on Discord.
	</p>

	<div class="grid grid-cols-2 gap-2">
		<button
			type="button"
			onclick={selectFile}
			class="btn-accent flex w-full cursor-pointer items-center justify-center rounded-md px-3 py-1.5 text-sm transition-colors duration-200"
			{disabled}
		>
			<span class="material-icons mr-2 text-base">folder_open</span>
			{#if value && !images.includes(String(value))}
				{String(value).split('\\').pop()}
			{:else}
				{$LL.common.import()}
			{/if}
		</button>

		<button
			type="button"
			onclick={() => onChange('')}
			class={'flex w-full cursor-pointer items-center justify-center rounded-md px-3 py-1.5 text-sm transition-colors duration-200 ' +
				(value === ''
					? 'bg-[var(--bg-accent)]/60 ring-1 ring-color'
					: 'bg-gray-100 dark:bg-gray-800')}
		>
			<span class="material-icons mr-2 text-base">hide_image</span>
			{$LL.common.none()}
		</button>
	</div>

	<div class="grid grid-cols-4 gap-2">
		{#each images as image (image)}
			{@const selected = String(value) === image}
			<button
				type="button"
				onclick={() => onChange(image)}
				class={'relative aspect-video cursor-pointer overflow-hidden rounded-md border-2 transition-all duration-150 ' +
					(selected
						? 'scale-105 border-accent ring-2 ring-[var(--accent-primary)]'
						: 'border-color hover:border-accent/50')}
			>
				<img
					src={'/ayah-container/' + image}
					alt={image}
					class="h-full w-full object-cover"
					loading="lazy"
				/>
				{#if selected}
					<span
						class="material-icons absolute top-1 right-1 text-[16px]! text-white drop-shadow-md"
					>
						check_circle
					</span>
				{/if}
			</button>
		{/each}
	</div>
</div>
