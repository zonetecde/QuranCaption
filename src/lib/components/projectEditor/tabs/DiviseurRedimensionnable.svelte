<script lang="ts">
	import { onDestroy } from 'svelte';
	import Settings from '$lib/classes/Settings.svelte';
	import { WaveformService } from '$lib/services/WaveformService.svelte.js';

	type DividerOrientation = 'horizontal' | 'vertical';
	type DividerUnit = 'percent' | 'pixels';

	type Props = {
		orientation: DividerOrientation;
		value: number;
		min: number;
		max: number;
		unit?: DividerUnit;
		reverse?: boolean;
		displayedValue?: number;
		class?: string;
		dataTestId?: string;
	};

	let {
		orientation,
		value = $bindable(),
		min,
		max,
		unit = 'pixels',
		reverse = false,
		displayedValue,
		class: className = '',
		dataTestId
	}: Props = $props();

	let isDragging = $state(false);
	let resizeStartPosition = 0;
	let resizeStartValue = 0;
	let resizeContainerSize = 1;
	let previousBodyCursor = '';
	let previousBodyUserSelect = '';
	let currentValue = $derived(displayedValue ?? value);

	/**
	 * Maintient la taille demandée entre les bornes du diviseur.
	 * @param {number} nextValue Taille demandée.
	 * @returns {number} Taille utilisable.
	 */
	function clampValue(nextValue: number): number {
		return Math.max(min, Math.min(max, nextValue));
	}

	/**
	 * Retourne la position du pointeur sur l’axe de redimensionnement.
	 * @param {PointerEvent} event Événement du pointeur.
	 * @returns {number} Position en pixels.
	 */
	function getPointerPosition(event: PointerEvent): number {
		return orientation === 'vertical' ? event.clientX : event.clientY;
	}

	/**
	 * Retourne la taille du conteneur utile aux valeurs en pourcentage.
	 * @param {HTMLElement} divider Élément séparateur.
	 * @returns {number} Taille du conteneur en pixels.
	 */
	function getContainerSize(divider: HTMLElement): number {
		const rect = divider.parentElement?.getBoundingClientRect();
		return Math.max(1, orientation === 'vertical' ? (rect?.width ?? 1) : (rect?.height ?? 1));
	}

	/**
	 * Démarre le redimensionnement du séparateur.
	 * @param {PointerEvent} event Événement initial du pointeur.
	 * @returns {void}
	 */
	function startResize(event: PointerEvent): void {
		if (event.button !== 0 || isDragging) return;

		isDragging = true;
		resizeStartPosition = getPointerPosition(event);
		resizeStartValue = currentValue;
		resizeContainerSize = getContainerSize(event.currentTarget as HTMLElement);
		previousBodyCursor = document.body.style.cursor;
		previousBodyUserSelect = document.body.style.userSelect;
		document.body.style.cursor = orientation === 'vertical' ? 'col-resize' : 'row-resize';
		document.body.style.userSelect = 'none';
		document.addEventListener('pointermove', resize);
		document.addEventListener('pointerup', stopResize);
		document.addEventListener('pointercancel', stopResize);
		event.preventDefault();
	}

	/**
	 * Met à jour la taille pendant le glissement.
	 * @param {PointerEvent} event Événement de déplacement du pointeur.
	 * @returns {void}
	 */
	function resize(event: PointerEvent): void {
		if (!isDragging) return;

		const direction = reverse ? -1 : 1;
		const pixelDelta = (getPointerPosition(event) - resizeStartPosition) * direction;
		const delta = unit === 'percent' ? (pixelDelta / resizeContainerSize) * 100 : pixelDelta;
		value = clampValue(resizeStartValue + delta);
	}

	/**
	 * Termine le redimensionnement et restaure les styles globaux.
	 * @returns {void}
	 */
	function stopResize(): void {
		if (!isDragging) return;

		isDragging = false;
		document.body.style.cursor = previousBodyCursor;
		document.body.style.userSelect = previousBodyUserSelect;
		document.removeEventListener('pointermove', resize);
		document.removeEventListener('pointerup', stopResize);
		document.removeEventListener('pointercancel', stopResize);
		void Settings.save();
		if (orientation === 'horizontal') WaveformService.clearAllCache();
	}

	onDestroy(stopResize);
</script>

<div
	class="resizable-divider {orientation} {className}"
	class:active={isDragging}
	role="separator"
	aria-orientation={orientation}
	aria-valuemin={min}
	aria-valuemax={max}
	aria-valuenow={Math.round(currentValue)}
	data-testid={dataTestId}
	onpointerdown={startResize}
></div>

<style>
	.resizable-divider {
		position: relative;
		z-index: 10;
		flex-shrink: 0;
		touch-action: none;
	}

	.resizable-divider.vertical {
		width: 8px;
		cursor: col-resize;
	}

	.resizable-divider.horizontal {
		height: 8px;
		cursor: row-resize;
	}

	.resizable-divider::after {
		position: absolute;
		border-radius: 999px;
		background: var(--border-color);
		content: '';
		transition:
			background-color 150ms ease,
			box-shadow 150ms ease;
	}

	.resizable-divider.vertical::after {
		top: 0.75rem;
		bottom: 0.75rem;
		left: 50%;
		width: 2px;
		transform: translateX(-50%);
	}

	.resizable-divider.horizontal::after {
		top: 50%;
		left: 0.75rem;
		right: 0.75rem;
		height: 2px;
		transform: translateY(-50%);
	}

	.resizable-divider:hover::after,
	.resizable-divider:focus-visible::after,
	.resizable-divider.active::after {
		background: var(--accent-primary);
		box-shadow: 0 0 8px color-mix(in srgb, var(--accent-primary) 70%, transparent);
	}
</style>
