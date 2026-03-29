<script lang="ts">
	import { Status } from '$lib/classes/Status';
	import { slide } from 'svelte/transition';

	interface Props {
		isVisible: boolean;
		selectedStatuses: Status[];
		onFilter: (statuses: Status[]) => void;
	}

	let { isVisible = $bindable(), selectedStatuses = $bindable(), onFilter }: Props = $props();

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
		<!-- En-tête avec boutons Check All / Uncheck All -->
		<div class="px-3 py-2 border-b border-[var(--border-color)] flex justify-between">
			<span class="text-sm font-medium text-[var(--text-primary)]">Filter by Status</span>
			<div class="flex gap-2 pb-1">
				<button
					class="btn px-2 text-xs text-[var(--accent-primary)] hover:text-[var(--accent-secondary)] transition-colors"
					onclick={checkAll}
				>
					Check All
				</button>
				<span class="text-[var(--text-secondary)]">|</span>
				<button
					class="btn px-2 text-xs text-[var(--accent-primary)] hover:text-[var(--accent-secondary)] transition-colors"
					onclick={uncheckAll}
				>
					Uncheck All
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
						<span class="text-sm text-[var(--text-primary)]">{status.status}</span>
					</div>
				</label>
			{/each}
		</div>

		<!-- Résumé de la sélection -->
		<div
			class="px-3 py-2 border-t border-[var(--border-color)] text-xs text-[var(--text-secondary)]"
		>
			{selectedStatuses.length} of {allStatuses.length} statuses selected
		</div>
	</div>
{/if}
