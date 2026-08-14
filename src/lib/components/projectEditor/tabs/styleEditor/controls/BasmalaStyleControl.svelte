<script lang="ts">
	import type { Style } from '$lib/classes/VideoStyle.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { getStyleName } from '$lib/i18n/styleMapper';
	import type { StyleControlValue } from './types';

	let {
		style,
		value,
		onChange
	}: { style: Style; value: StyleControlValue; onChange: (value: string) => void } = $props();

	let isOpen = $state(false);
	let triggerButton: HTMLButtonElement | undefined = $state();

	/**
	 * Ferme la liste des basmalas.
	 * @returns {void}
	 */
	function closePanel(): void {
		isOpen = false;
	}

	/**
	 * Ferme la liste avec Échap et restitue le focus au déclencheur.
	 * @param {KeyboardEvent} event Événement clavier global.
	 * @returns {void}
	 */
	function handleWindowKeydown(event: KeyboardEvent): void {
		if (!isOpen || event.key !== 'Escape') return;
		closePanel();
		triggerButton?.focus();
	}

	/**
	 * Applique le style de basmala sélectionné.
	 * @param {string} option Police actuelle ou numéro de basmala.
	 * @returns {void}
	 */
	function selectBasmala(option: string): void {
		onChange(option);
		closePanel();
		triggerButton?.focus();
	}
</script>

<svelte:window onclick={closePanel} onkeydown={handleWindowKeydown} />

<div class="relative" onclick={(event) => event.stopPropagation()}>
	<button
		bind:this={triggerButton}
		type="button"
		class="flex w-full items-center justify-between gap-3 rounded-lg border border-color bg-[var(--bg-secondary)] px-3 py-2 text-left text-sm text-primary transition-colors hover:border-[var(--accent-primary)]"
		aria-haspopup="listbox"
		aria-expanded={isOpen}
		onclick={() => (isOpen = !isOpen)}
	>
		<span>{String(value) === 'current-font' ? getStyleName('current-font', $LL) : `#${value}`}</span
		>
		{#if String(value) !== 'current-font'}
			<span class="truncate text-2xl leading-none" style="font-family: Basmalah;">{value}</span>
		{/if}
		<span class="material-icons-outlined ml-auto shrink-0 text-[18px]! text-secondary">
			{isOpen ? 'expand_less' : 'expand_more'}
		</span>
	</button>

	{#if isOpen}
		<div
			class="absolute inset-x-0 top-full z-100 mt-1 max-h-80 overflow-y-auto rounded-xl border border-color bg-[var(--bg-primary)] p-1 shadow-xl"
			role="listbox"
		>
			{#each style.options || [] as option (option)}
				<button
					type="button"
					role="option"
					aria-selected={option === String(value)}
					class="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm text-primary transition-colors hover:bg-[var(--bg-accent)] aria-selected:bg-[color-mix(in_srgb,var(--accent-primary)_18%,var(--bg-secondary))]"
					onclick={() => selectBasmala(option)}
				>
					<span>{option === 'current-font' ? getStyleName('current-font', $LL) : `#${option}`}</span
					>
					{#if option !== 'current-font'}
						<span class="truncate text-3xl leading-none" style="font-family: Basmalah;"
							>{option}</span
						>
					{/if}
					{#if option === String(value)}
						<span class="material-icons-outlined shrink-0 text-[16px]! text-accent">check</span>
					{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>
