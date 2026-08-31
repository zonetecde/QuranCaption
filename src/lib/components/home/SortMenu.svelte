<script lang="ts">
	import { slide } from 'svelte/transition';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
	import { untrack } from 'svelte';
	import type { HomeSortProperty } from './homeExplorer';

	interface Props {
		isVisible: boolean;
		currentProperty: HomeSortProperty;
		ascending: boolean;
		onSort: (property: HomeSortProperty, ascending: boolean) => void;
	}

	let { isVisible = $bindable(), currentProperty, ascending, onSort }: Props = $props();

	// Options de tri disponibles
	const sortOptions = $derived([
		{ key: 'updatedAt' as HomeSortProperty, label: get(LL).home.lastUpdated() },
		{ key: 'createdAt' as HomeSortProperty, label: get(LL).home.createdAt() },
		{ key: 'name' as HomeSortProperty, label: get(LL).common.name() },
		{ key: 'reciter' as HomeSortProperty, label: get(LL).home.reciter() },
		{ key: 'duration' as HomeSortProperty, label: get(LL).home.duration() },
		{ key: 'surah' as HomeSortProperty, label: get(LL).editor.surah() }
	]);

	let currentSortProperty: HomeSortProperty = $state(untrack(() => currentProperty));
	let isAscending = $state(untrack(() => ascending));

	$effect(() => {
		currentSortProperty = currentProperty;
		isAscending = ascending;
	});

	/**
	 * Change l'ordre de tri et applique immédiatement
	 */
	function setOrder(ascending: boolean) {
		isAscending = ascending;
		onSort(currentSortProperty, isAscending);
	}

	/**
	 * Applique le tri quand la propriété change
	 */
	function handlePropertyChange() {
		onSort(currentSortProperty, isAscending);
	}

	// Fermer le menu en cliquant à l'extérieur
	function handleClickOutside(event: MouseEvent) {
		const target = event.target as Element;
		if (!target.closest('.sort-menu') && !target.closest('.sort-button')) {
			isVisible = false;
		}
	}
</script>

<svelte:window on:click={handleClickOutside} />

{#if isVisible}
	<div
		class="sort-menu absolute top-full right-0 mt-2 w-[370px] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-xl z-50 p-4"
		transition:slide={{ duration: 200 }}
	>
		<!-- En-tête -->
		<div class="mb-4">
			<span class="text-sm font-medium text-[var(--text-primary)]">{$LL.home.sortBy()}</span>
		</div>

		<!-- Sélection de l'attribut -->
		<div class="mb-4">
			<label for="sort-property" class="block text-xs text-[var(--text-secondary)] mb-2"
				>{$LL.home.property()}</label
			>
			<select
				id="sort-property"
				bind:value={currentSortProperty}
				onchange={handlePropertyChange}
				class="w-full bg-[#0d1117] border border-[var(--border-color)] rounded px-3 py-2 text-sm text-[var(--text-primary)] focus:ring-2 focus:ring-[var(--accent-primary)] focus:border-transparent"
			>
				{#each sortOptions as option (option.key)}
					<option value={option.key}>{option.label}</option>
				{/each}
			</select>
		</div>

		<!-- Boutons d'ordre de tri -->
		<div class="mb-4">
			<span class="block text-xs text-[var(--text-secondary)] mb-2">{$LL.home.order()}</span>
			<div class="flex gap-2">
				<button
					class="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded transition-colors {isAscending
						? 'bg-[var(--accent-primary)] text-white'
						: 'bg-[#21262d] text-[var(--text-secondary)] hover:bg-[#30363d]'}"
					onclick={() => setOrder(true)}
				>
					<span class="material-icons-outlined text-sm">arrow_upward</span>
					{$LL.home.ascending()}
				</button>
				<button
					class="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded transition-colors {!isAscending
						? 'bg-[var(--accent-primary)] text-white'
						: 'bg-[#21262d] text-[var(--text-secondary)] hover:bg-[#30363d]'}"
					onclick={() => setOrder(false)}
				>
					<span class="material-icons-outlined text-sm">arrow_downward</span>
					{$LL.home.descending()}
				</button>
			</div>
		</div>
	</div>
{/if}
