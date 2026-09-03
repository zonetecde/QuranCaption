<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { onDestroy } from 'svelte';
	import { get } from 'svelte/store';
	import toast from 'svelte-5-french-toast';
	import LL from '$lib/i18n/i18n-svelte';
	import { beginStyleMutation, commitStyleMutation } from '$lib/services/StyleMutationService';
	import type { ApplyStyleControlValue, StyleControlValue } from './types';

	let { value, onChange }: { value: StyleControlValue; onChange: ApplyStyleControlValue } =
		$props();
	let historyTransactionOpen = false;
	let isCapturingScreen = $state(false);
	let screenCaptureUrl = $state<string>();
	let screenCaptureImage = $state<HTMLImageElement>();

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

	/**
	 * Place l'overlay dans le body pour échapper aux conteneurs de l'éditeur.
	 * @param {HTMLElement} node Overlay à placer au niveau global.
	 * @returns {{destroy: () => void}} Nettoyage de l'overlay.
	 */
	function portal(node: HTMLElement): { destroy: () => void } {
		document.body.appendChild(node);
		return { destroy: () => node.remove() };
	}

	/**
	 * Ferme le sélecteur sur capture et libère son URL temporaire.
	 * @returns {void}
	 */
	function closeScreenColorPicker(): void {
		if (!screenCaptureUrl) return;
		URL.revokeObjectURL(screenCaptureUrl);
		screenCaptureUrl = undefined;
	}

	/**
	 * Capture l'écran visible sans masquer Quran Caption.
	 * @returns {Promise<void>}
	 */
	async function openScreenColorPicker(): Promise<void> {
		if (isCapturingScreen) return;
		isCapturingScreen = true;
		const loadingToast = toast.loading(get(LL).common.loading(), { position: 'bottom-left' });
		try {
			const bytes = new Uint8Array(await invoke<number[]>('capture_screen_for_color_picker'));
			screenCaptureUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
		} catch (error) {
			console.error('Could not capture the screen for color selection.', error);
		} finally {
			toast.dismiss(loadingToast);
			isCapturingScreen = false;
		}
	}

	/**
	 * Lit la couleur du pixel cliqué dans la capture.
	 * @param {MouseEvent} event Clic sur la capture affichée.
	 * @returns {void}
	 */
	function applyCapturedColor(event: MouseEvent): void {
		if (!screenCaptureImage) return;
		const rect = screenCaptureImage.getBoundingClientRect();
		if (
			event.clientX < rect.left ||
			event.clientX >= rect.right ||
			event.clientY < rect.top ||
			event.clientY >= rect.bottom
		)
			return;

		const x = ((event.clientX - rect.left) / rect.width) * screenCaptureImage.naturalWidth;
		const y = ((event.clientY - rect.top) / rect.height) * screenCaptureImage.naturalHeight;
		const canvas = document.createElement('canvas');
		const context = canvas.getContext('2d');
		if (!context) return;
		canvas.width = 1;
		canvas.height = 1;
		context.drawImage(screenCaptureImage, x, y, 1, 1, 0, 0, 1, 1);
		const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
		const color = `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
		applyPickerValue(color);
		commitHistoryTransaction();
		closeScreenColorPicker();
	}

	onDestroy(commitHistoryTransaction);
	onDestroy(closeScreenColorPicker);
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && closeScreenColorPicker()} />

<div class="flex items-center gap-x-2">
	<input
		type="color"
		value={String(value)}
		class="style-color-picker"
		oninput={(event) => applyPickerValue((event.target as HTMLInputElement).value)}
		onblur={commitHistoryTransaction}
		onchange={commitHistoryTransaction}
	/>
	<button
		type="button"
		class="style-eyedropper flex size-8 shrink-0 items-center justify-center rounded-md border border-(--border-color) bg-(--bg-accent)"
		title={$LL.style.groupColors()}
		aria-label={$LL.style.groupColors()}
		disabled={isCapturingScreen}
		onclick={() => void openScreenColorPicker()}
	>
		<span class="material-icons text-base">colorize</span>
	</button>
	<div class="relative w-24 shrink-0">
		<input
			type="text"
			value={String(value)}
			class="w-full mono"
			oninput={(event) => onChange((event.target as HTMLInputElement).value)}
		/>
	</div>
</div>

{#if screenCaptureUrl}
	<button
		use:portal
		type="button"
		class="screen-color-picker fixed inset-0 z-1000 flex cursor-crosshair items-center justify-center bg-black"
		title={$LL.style.groupColors()}
		aria-label={$LL.style.groupColors()}
		onclick={applyCapturedColor}
	>
		<img
			bind:this={screenCaptureImage}
			src={screenCaptureUrl}
			alt=""
			class="max-h-full max-w-full object-contain"
		/>
	</button>
{/if}

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
