<script lang="ts">
	import { Status } from '$lib/classes/Status';
	import { slide } from 'svelte/transition';
	import { getStatusLabel } from '$lib/i18n/statusMapper';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';

	interface Props {
		isVisible: boolean;
		selectedStatuses: Status[];
		showProjects: boolean;
		showBatches: boolean;
		onFilter: (statuses: Status[]) => void;
	}

	let {
		isVisible = $bindable(),
		selectedStatuses = $bindable(),
		showProjects = $bindable(),
		showBatches = $bindable(),
		onFilter
	}: Props = $props();

	// Récupérer tous les statuts disponibles
	const allStatuses: Status[] = Status.getAllStatuses();

	/**
	 * Bascule la sélection d'un statut
	 */
	function toggleStatus(status: Status) {
		const index = selectedStatuses.findIndex((s) => s.status === status.status);
		if (index > -1) {
			selectedStatuses.splice(index, 1);
		} else {
			selectedStatuses.push(status);
		}
		selectedStatuses = [...selectedStatuses]; // Trigger reactivity
		onFilter(selectedStatuses);
	}

	/**
	 * Sélectionne tous les statuts
	 */
	function checkAll() {
		selectedStatuses = [...allStatuses];
		onFilter(selectedStatuses);
	}

	/**
	 * Désélectionne tous les statuts
	 */
	function uncheckAll() {
		selectedStatuses = [];
		onFilter(selectedStatuses);
	}

	/**
	 * Vérifie si un statut est sélectionné
	 */
	function isStatusSelected(status: Status): boolean {
		return selectedStatuses.some((s) => s.status === status.status);
	}

	// Fermer le menu en cliquant à l'extérieur
	function handleClickOutside(event: MouseEvent) {
		const target = event.target as Element;
		if (!target.closest('.filter-menu') && !target.closest('.filter-button')) {
			isVisible = false;
		}
	}
</script>

<svelte:window on:click={handleClickOutside} />

{#if isVisible}
	<div
		class="filter-menu absolute top-full right-0 mt-2 w-[330px] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-xl z-50 py-2"
		transition:slide={{ duration: 200 }}
	>
		<div
			class="mx-3 mb-2 grid grid-cols-2 gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)]/40 p-1"
		>
			<button
				class={`flex items-center justify-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium transition-all ${showProjects ? 'bg-[var(--bg-accent)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-thirdly)] hover:bg-white/5 hover:text-[var(--text-secondary)]'}`}
				type="button"
				data-filter-projects
				aria-pressed={showProjects}
				onclick={() => (showProjects = !showProjects)}
			>
				<span
					class={`h-1.5 w-1.5 rounded-full ${showProjects ? 'bg-[var(--accent-primary)]' : 'border border-[var(--text-thirdly)]'}`}
				></span>
				{$LL.batch.project()}
			</button>
			<button
				class={`flex items-center justify-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium transition-all ${showBatches ? 'bg-[var(--bg-accent)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-thirdly)] hover:bg-white/5 hover:text-[var(--text-secondary)]'}`}
				type="button"
				data-filter-batches
				aria-pressed={showBatches}
				onclick={() => (showBatches = !showBatches)}
			>
				<span
					class={`h-1.5 w-1.5 rounded-full ${showBatches ? 'bg-[var(--accent-primary)]' : 'border border-[var(--text-thirdly)]'}`}
				></span>
				{$LL.batch.batch()}
			</button>
		</div>

		<!-- En-tête avec boutons Check All / Uncheck All -->
		<div class="px-3 py-2 border-b border-[var(--border-color)] flex justify-between">
			<span class="text-sm font-medium text-[var(--text-primary)]">{$LL.home.filterByStatus()}</span
			>
			<div class="flex gap-2 pb-1">
				<button
					class="btn px-2 text-xs text-[var(--accent-primary)] hover:text-[var(--accent-secondary)] transition-colors"
					onclick={checkAll}
				>
					{$LL.home.checkAll()}
				</button>
				<span class="text-[var(--text-secondary)]">|</span>
				<button
					class="btn px-2 text-xs text-[var(--accent-primary)] hover:text-[var(--accent-secondary)] transition-colors"
					onclick={uncheckAll}
				>
					{$LL.home.uncheckAll()}
				</button>
			</div>
		</div>

		<!-- Liste des statuts -->
		<div class="max-h-64 overflow-y-auto">
			{#each allStatuses as status (status.status)}
				<label
					class="flex items-center gap-3 px-3 py-2 hover:bg-white/5 cursor-pointer transition-colors"
				>
					<input
						type="checkbox"
						checked={isStatusSelected(status)}
						onchange={() => toggleStatus(status)}
						class="w-4 h-4 text-[var(--accent-primary)] bg-transparent border-[var(--border-color)] rounded focus:ring-[var(--accent-primary)] focus:ring-2"
					/>
					<div class="flex items-center gap-2">
						<span class="w-3 h-3 rounded-full" style={`background-color: ${status.color}`}></span>
						<span class="text-sm text-[var(--text-primary)]">{getStatusLabel(status, get(LL))}</span
						>
					</div>
				</label>
			{/each}
		</div>

		<!-- Résumé de la sélection -->
		<div
			class="px-3 py-2 border-t border-[var(--border-color)] text-xs text-[var(--text-secondary)]"
		>
			{$LL.home.statusesSelected({ count: selectedStatuses.length, total: allStatuses.length })}
		</div>
	</div>
{/if}
