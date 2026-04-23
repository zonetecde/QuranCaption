<script lang="ts">
	import { slide } from 'svelte/transition';
	import type { ProjectDetail } from '$lib/classes/ProjectDetail.svelte';

	interface Props {
		isVisible: boolean;
		currentProperty: keyof ProjectDetail;
		ascending: boolean;
		onSort: (property: keyof ProjectDetail, ascending: boolean) => void;
	}

	let { isVisible = $bindable(), currentProperty, ascending, onSort }: Props = $props();

	// Options de tri disponibles
	const sortOptions = [
		{ key: 'updatedAt' as keyof ProjectDetail, label: 'Last Updated' },
		{ key: 'createdAt' as keyof ProjectDetail, label: 'Created At' },
		{ key: 'name' as keyof ProjectDetail, label: 'Name' },
		{ key: 'reciter' as keyof ProjectDetail, label: 'Reciter' },
		{ key: 'duration' as keyof ProjectDetail, label: 'Duration' }
	];

	let currentSortProperty: keyof ProjectDetail = $state(currentProperty);
	let isAscending = $state(ascending);

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
			<span class="text-sm font-medium text-[var(--text-primary)]">Sort by</span>
		</div>

		<!-- Sélection de l'attribut -->
		<div class="mb-4">
			<label for="sort-property" class="block text-xs text-[var(--text-secondary)] mb-2"
				>Property</label
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
			<span class="block text-xs text-[var(--text-secondary)] mb-2">Order</span>
			<div class="flex gap-2">
				<button
					class="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded transition-colors {isAscending
						? 'bg-[var(--accent-primary)] text-white'
						: 'bg-[#21262d] text-[var(--text-secondary)] hover:bg-[#30363d]'}"
					onclick={() => setOrder(true)}
				>
					<span class="material-icons-outlined text-sm">arrow_upward</span>
					Ascending
				</button>
				<button
					class="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded transition-colors {!isAscending
						? 'bg-[var(--accent-primary)] text-white'
						: 'bg-[#21262d] text-[var(--text-secondary)] hover:bg-[#30363d]'}"
					onclick={() => setOrder(false)}
				>
					<span class="material-icons-outlined text-sm">arrow_downward</span>
					Descending
				</button>
			</div>
		</div>
	</div>
{/if}
