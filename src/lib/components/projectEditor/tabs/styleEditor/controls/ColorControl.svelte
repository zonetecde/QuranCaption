<script lang="ts">
	import { onDestroy } from 'svelte';
	import { beginStyleMutation, commitStyleMutation } from '$lib/services/StyleMutationService';
	import MobileColorPicker from '$lib/components/misc/MobileColorPicker.svelte';
	import LL from '$lib/i18n/i18n-svelte';
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
		beginStyleMutation('set color style');
		historyTransactionOpen = true;
	}

	/**
	 * Termine la transaction du sélecteur de couleur.
	 * @returns {void}
	 */
	function commitHistoryTransaction(): void {
		if (!historyTransactionOpen) return;
		commitStyleMutation();
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
	<MobileColorPicker
		value={String(value)}
		label={$LL.editor.color()}
		onChange={applyPickerValue}
		onInteractionStart={beginHistoryTransaction}
		onInteractionEnd={commitHistoryTransaction}
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
