<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { onDestroy } from 'svelte';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
	import { get } from 'svelte/store';
	import toast from 'svelte-5-french-toast';
	import LL from '$lib/i18n/i18n-svelte';
	import type { ApplyStyleControlValue, StyleControlValue } from './types';

	let { value, onChange }: { value: StyleControlValue; onChange: ApplyStyleControlValue } =
		$props();
	let historyTransactionOpen = false;
	let isCapturingScreen = $state(false);
	let screenCaptureUrl = $state<string>();
	let screenCaptureImage = $state<HTMLImageElement>();
	let colorSampleCanvas: HTMLCanvasElement;
	let magnifier = $state<{
		x: number;
		y: number;
		backgroundSize: string;
		backgroundPosition: string;
		color: string;
	}>();

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
		magnifier = undefined;
	}

	/**
	 * Lit la couleur située sous le curseur dans la capture.
	 * @param {MouseEvent} event Événement de souris sur la capture affichée.
	 * @returns {string | undefined} Couleur du pixel au format hexadécimal.
	 */
	function readCapturedColor(event: MouseEvent): string | undefined {
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
		const canvas = colorSampleCanvas ?? document.createElement('canvas');
		if (!colorSampleCanvas) {
			canvas.width = 1;
			canvas.height = 1;
			colorSampleCanvas = canvas;
		}
		const context = canvas.getContext('2d');
		if (!context) return;
		context.drawImage(screenCaptureImage, x, y, 1, 1, 0, 0, 1, 1);
		const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
		return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
	}

	/**
	 * Positionne la loupe et actualise son aperçu agrandi.
	 * @param {MouseEvent} event Mouvement sur la capture affichée.
	 * @returns {void}
	 */
	function updateMagnifier(event: MouseEvent): void {
		const color = readCapturedColor(event);
		if (!color || !screenCaptureImage) {
			magnifier = undefined;
			return;
		}

		const rect = screenCaptureImage.getBoundingClientRect();
		const zoom = 8;
		magnifier = {
			x: event.clientX,
			y: event.clientY < 144 ? event.clientY + 80 : event.clientY - 80,
			backgroundSize: `${rect.width * zoom}px ${rect.height * zoom}px`,
			backgroundPosition: `${56 - (event.clientX - rect.left) * zoom}px ${56 - (event.clientY - rect.top) * zoom}px`,
			color
		};
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
		const color = readCapturedColor(event);
		if (!color) return;
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
		onmousemove={updateMagnifier}
		onmouseleave={() => (magnifier = undefined)}
	>
		<img
			bind:this={screenCaptureImage}
			src={screenCaptureUrl}
			alt=""
			class="max-h-full max-w-full object-contain"
		/>
		{#if magnifier}
			<div
				class="screen-color-magnifier pointer-events-none fixed size-28 overflow-hidden rounded-full border-2 border-white shadow-lg"
				style:left="clamp(3.5rem, {magnifier.x}px, calc(100vw - 3.5rem))"
				style:top="{magnifier.y}px"
				style:background-image="url({screenCaptureUrl})"
				style:background-size={magnifier.backgroundSize}
				style:background-position={magnifier.backgroundPosition}
				aria-hidden="true"
			>
				<span class="magnifier-target absolute left-1/2 top-1/2 size-2 -translate-1/2"></span>
				<span
					class="absolute bottom-0 left-0 w-full border-t border-white bg-black/80 py-1 text-xs text-white"
				>
					{magnifier.color}
				</span>
			</div>
		{/if}
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

	.screen-color-magnifier {
		transform: translate(-50%, -50%);
		background-repeat: no-repeat;
		image-rendering: pixelated;
	}

	.magnifier-target {
		border: 1px solid white;
		box-shadow: 0 0 0 1px black;
	}
</style>
