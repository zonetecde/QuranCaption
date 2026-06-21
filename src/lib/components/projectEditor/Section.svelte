<!-- Représente une section fermable en cliquant sur le bout de flèche -->
<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { onMount, type Snippet } from 'svelte';
	import { slide } from 'svelte/transition';

	let {
		name,
		icon,
		classes,
		contentClasses,
		children,
		dataCategory,
		saveState = true,
		defaultExtended = true,
		hideHeader = false,
		forceOpen = false
	}: {
		name: string;
		icon: string;
		classes?: string;
		contentClasses?: string;
		children: Snippet;
		dataCategory?: string;
		saveState?: boolean;
		defaultExtended?: boolean;
		hideHeader?: boolean;
		forceOpen?: boolean;
	} = $props();

	let extended = $state(defaultExtended);

	onMount(() => {
		if (forceOpen) {
			extended = true;
			return;
		}
		if (!saveState) return;

		// Init la section dans l'éditeur
		if (!globalState.getSectionsState[name]) {
			globalState.getSectionsState[name] = {
				extended: extended
			};
		} else {
			// Si la section existe déjà, on récupère son état
			extended = globalState.getSectionsState[name].extended;
		}
	});

	$effect(() => {
		if (forceOpen) {
			extended = true;
			return;
		}
		if (!saveState) return;

		globalState.getSectionsState[name] = {
			extended: extended
		};
	});
</script>

<div class="flex flex-col gap-2" data-category={dataCategory}>
	{#if !hideHeader}
		<div class={'flex ' + classes} onclick={() => !forceOpen && (extended = !extended)}>
			<h3 class="text-sm font-semibold text-primary flex items-center truncate">
				{#if icon && (icon.includes('png') || icon.includes('svg'))}
					<img src={icon} alt={name} class="w-6 h-6 mr-2" /><span class="truncate">{name}</span>
				{:else if !icon}
					<span class="w-6 h-6 mr-2 rounded-sm bg-black border border-color shrink-0"></span><span
						class="truncate">{name}</span
					>
				{:else}
					<span class="material-icons mr-2 text-lg text-accent-primary">{icon}</span><span
						class="truncate">{name}</span
					>
				{/if}
			</h3>
			{#if !forceOpen}
				<button
					class={'flex items-center ml-auto cursor-pointer transition-all duration-100 ' +
						(extended ? 'rotate-180' : '')}
				>
					<span class="material-icons text-4xl! text-accent-primary">arrow_drop_down</span>
				</button>
			{/if}
		</div>
	{/if}

	{#if forceOpen || extended}
		<div transition:slide class={contentClasses}>
			{@render children()}
		</div>
	{/if}
</div>
