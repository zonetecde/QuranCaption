<script lang="ts">
	import type { Style } from '$lib/classes/VideoStyle.svelte';
	import { beginStyleMutation, commitStyleMutation } from '$lib/services/StyleMutationService';
	import type { ApplyStyleControlValue, StyleControlValue } from './types';

	let {
		style,
		value,
		onChange
	}: { style: Style; value: StyleControlValue; onChange: ApplyStyleControlValue } = $props();

	type RangePointerIntent = 'idle' | 'pending' | 'horizontal' | 'vertical';

	const RANGE_DIRECTION_THRESHOLD = 8;
	const RANGE_TAP_TOLERANCE = 4;
	let rangeInput: HTMLInputElement | undefined = $state();
	let activePointerId: number | null = null;
	let pointerStartX = 0;
	let pointerStartY = 0;
	let pointerIntent: RangePointerIntent = 'idle';
	let rangeMutationActive = false;

	/**
	 * Démarre l'historique uniquement après confirmation d'une interaction avec le slider.
	 * @returns {void}
	 */
	function beginRangeMutation(): void {
		if (rangeMutationActive) return;
		rangeMutationActive = true;
		beginStyleMutation('adjust style slider');
	}

	/**
	 * Restaure visuellement la valeur lorsque le geste correspond à un scroll vertical.
	 * @returns {void}
	 */
	function restoreRangeValue(): void {
		if (rangeInput) rangeInput.value = String(value);
	}

	/**
	 * Prépare la détection de direction sans appliquer immédiatement la valeur tactile.
	 * @param {PointerEvent} event Événement initial du pointeur.
	 * @returns {void}
	 */
	function handleRangePointerDown(event: PointerEvent): void {
		activePointerId = event.pointerId;
		pointerStartX = event.clientX;
		pointerStartY = event.clientY;
		pointerIntent = event.pointerType === 'mouse' ? 'horizontal' : 'pending';
		if (pointerIntent === 'horizontal') beginRangeMutation();
	}

	/**
	 * Active le slider seulement lorsque le mouvement est principalement horizontal.
	 * @param {PointerEvent} event Événement de déplacement du pointeur.
	 * @returns {void}
	 */
	function handleRangePointerMove(event: PointerEvent): void {
		if (event.pointerId !== activePointerId || pointerIntent !== 'pending') return;

		const deltaX = Math.abs(event.clientX - pointerStartX);
		const deltaY = Math.abs(event.clientY - pointerStartY);
		if (Math.max(deltaX, deltaY) < RANGE_DIRECTION_THRESHOLD) return;

		if (deltaY >= deltaX) {
			pointerIntent = 'vertical';
			restoreRangeValue();
			return;
		}

		pointerIntent = 'horizontal';
		beginRangeMutation();
		if (rangeInput) onChange(rangeInput.value);
	}

	/**
	 * Applique uniquement les valeurs provenant d'un geste horizontal ou du clavier.
	 * @param {Event} event Événement natif de l'input.
	 * @returns {void}
	 */
	function handleRangeInput(event: Event): void {
		if (activePointerId !== null && pointerIntent !== 'horizontal') return;
		onChange((event.target as HTMLInputElement).value);
	}

	/**
	 * Termine le geste et conserve un tap immobile comme interaction volontaire.
	 * @param {PointerEvent} event Événement final du pointeur.
	 * @param {boolean} cancelled Indique si le navigateur a annulé le geste pour scroller.
	 * @returns {void}
	 */
	function finishRangePointer(event: PointerEvent, cancelled: boolean): void {
		if (event.pointerId !== activePointerId) return;

		const movement = Math.max(
			Math.abs(event.clientX - pointerStartX),
			Math.abs(event.clientY - pointerStartY)
		);
		if (!cancelled && pointerIntent === 'pending' && movement <= RANGE_TAP_TOLERANCE) {
			beginRangeMutation();
			if (rangeInput) onChange(rangeInput.value);
		} else if (pointerIntent !== 'horizontal') {
			restoreRangeValue();
		}

		if (rangeMutationActive) commitStyleMutation();
		activePointerId = null;
		pointerIntent = 'idle';
		rangeMutationActive = false;
	}
</script>

<div class="flex items-center gap-x-2">
	<input
		bind:this={rangeInput}
		class="w-full touch-pan-y accent-accent"
		type="range"
		min={style.valueMin}
		max={style.valueMax}
		step={style.step || 1}
		{value}
		onpointerdown={handleRangePointerDown}
		onpointermove={handleRangePointerMove}
		onpointerup={(event) => finishRangePointer(event, false)}
		onpointercancel={(event) => finishRangePointer(event, true)}
		onblur={commitStyleMutation}
		oninput={handleRangeInput}
	/>
	<input
		type="number"
		min={style.valueMin}
		max={style.valueMax}
		step={style.step || 1}
		{value}
		oninput={(event) => onChange((event.target as HTMLInputElement).value)}
		class="w-20"
	/>
</div>
