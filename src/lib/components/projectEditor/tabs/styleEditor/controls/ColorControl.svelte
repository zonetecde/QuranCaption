<script lang="ts">
	import { onDestroy } from 'svelte';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
	import type { ApplyStyleControlValue, StyleControlValue } from './types';

	let { value, onChange }: { value: StyleControlValue; onChange: ApplyStyleControlValue } =
		$props();
	let historyTransactionOpen = false;

	/**
	 * Démarre une transaction unique pendant le glissement dans le sélecteur.
	 * @returns {void}
	 */
	function beginHistoryTransaction(): void {
		if (historyTransactionOpen) return;
		ProjectHistoryManager.begin('set color style');
		historyTransactionOpen = true;
	}

	/**
	 * Termine la transaction du sélecteur de couleur.
	 * @returns {void}
	 */
	function commitHistoryTransaction(): void {
		if (!historyTransactionOpen) return;
		ProjectHistoryManager.commit();
		historyTransactionOpen = false;
	}

	/**
	 * Applique la couleur en direct pendant l'interaction.
	 * @param {string} nextValue Couleur sélectionnée.
	 * @returns {void}
	 */
	function applyPickerValue(nextValue: string): void {
		beginHistoryTransaction();
		onChange(nextValue);
	}

	onDestroy(commitHistoryTransaction);
</script>

<div class="flex items-center gap-x-2">
	<input
		type="color"
		value={String(value)}
		class="style-color-picker"
		oninput={(event) => applyPickerValue((event.target as HTMLInputElement).value)}
		onblur={commitHistoryTransaction}
		onchange={commitHistoryTransaction}
	/>
	<div class="relative w-24 shrink-0">
		<input
			type="text"
			value={String(value)}
			class="w-full mono"
			oninput={(event) => onChange((event.target as HTMLInputElement).value)}
		/>
	</div>
</div>

<style>
	.style-color-picker {
		width: auto;
		min-width: 0;
		height: 2.1rem;
		flex: 1;
		cursor: pointer;
		border: 1px solid var(--border-color);
		border-radius: 0.5rem;
		background: var(--bg-accent);
		padding: 0.15rem;
	}
</style>
