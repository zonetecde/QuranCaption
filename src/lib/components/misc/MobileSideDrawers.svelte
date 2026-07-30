<script lang="ts">
	import LL from '$lib/i18n/i18n-svelte';
	import type { Snippet } from 'svelte';

	let {
		leftOpen = $bindable(false),
		rightOpen = $bindable(false),
		leftContent,
		rightContent
	}: {
		leftOpen?: boolean;
		rightOpen?: boolean;
		leftContent: Snippet;
		rightContent: Snippet;
	} = $props();

	let leftDrawerElement: HTMLElement | null = $state(null);
	let rightDrawerElement: HTMLElement | null = $state(null);
	let gestureSide: 'left' | 'right' | null = $state(null);
	let gestureStartedOpen = false;
	let gestureDragging = $state(false);
	let gestureStartX = 0;
	let gestureStartY = 0;
	let gestureProgress = $state(0);

	const EDGE_SWIPE_WIDTH_PX = 28;
	const GESTURE_DIRECTION_THRESHOLD_PX = 6;
	const GESTURE_COMMIT_DISTANCE_PX = 48;

	let leftDrawerProgress = $derived(gestureSide === 'left' ? gestureProgress : leftOpen ? 1 : 0);
	let rightDrawerProgress = $derived(gestureSide === 'right' ? gestureProgress : rightOpen ? 1 : 0);

	/**
	 * Démarre le suivi d'un geste horizontal sur un tiroir.
	 *
	 * @param {'left' | 'right'} side Côté du tiroir manipulé.
	 * @param {PointerEvent} event Événement pointeur initial.
	 * @param {boolean} startedOpen Indique si le tiroir était ouvert au début du geste.
	 * @returns {void}
	 */
	function startDrawerGesture(
		side: 'left' | 'right',
		event: PointerEvent,
		startedOpen: boolean
	): void {
		if (!event.isPrimary || gestureSide) return;
		if (
			startedOpen &&
			event.target instanceof Element &&
			event.target.closest('button, input, select, textarea, a, label, [contenteditable="true"]')
		) {
			return;
		}

		gestureSide = side;
		gestureStartedOpen = startedOpen;
		gestureDragging = false;
		gestureStartX = event.clientX;
		gestureStartY = event.clientY;
		gestureProgress = startedOpen ? 1 : 0;
	}

	/**
	 * Met à jour progressivement la position du tiroir pendant le swipe.
	 *
	 * @param {PointerEvent} event Événement de déplacement du pointeur.
	 * @returns {void}
	 */
	function updateDrawerGesture(event: PointerEvent): void {
		if (!gestureSide) return;

		const deltaX = event.clientX - gestureStartX;
		const deltaY = event.clientY - gestureStartY;
		if (!gestureDragging) {
			if (
				Math.abs(deltaX) < GESTURE_DIRECTION_THRESHOLD_PX &&
				Math.abs(deltaY) < GESTURE_DIRECTION_THRESHOLD_PX
			) {
				return;
			}
			if (Math.abs(deltaY) > Math.abs(deltaX)) {
				cancelDrawerGesture();
				return;
			}
			gestureDragging = true;
		}

		event.preventDefault();
		const drawer = gestureSide === 'left' ? leftDrawerElement : rightDrawerElement;
		const drawerWidth = drawer?.getBoundingClientRect().width || 1;
		const direction = gestureSide === 'left' ? 1 : -1;
		const initialProgress = gestureStartedOpen ? 1 : 0;
		gestureProgress = Math.min(
			1,
			Math.max(0, initialProgress + (deltaX * direction) / drawerWidth)
		);
	}

	/**
	 * Termine le swipe et ouvre ou ferme le tiroir selon la distance parcourue.
	 *
	 * @param {PointerEvent} event Événement de fin du pointeur.
	 * @returns {void}
	 */
	function finishDrawerGesture(event: PointerEvent): void {
		if (!gestureSide) return;

		const side = gestureSide;
		const direction = side === 'left' ? 1 : -1;
		const directedDistance = (event.clientX - gestureStartX) * direction;
		const passedDistance = gestureStartedOpen
			? directedDistance <= -GESTURE_COMMIT_DISTANCE_PX
			: directedDistance >= GESTURE_COMMIT_DISTANCE_PX;
		const shouldOpen = gestureDragging
			? gestureStartedOpen
				? !passedDistance && gestureProgress >= 0.5
				: passedDistance || gestureProgress >= 0.5
			: gestureStartedOpen;

		if (side === 'left') {
			leftOpen = shouldOpen;
			if (shouldOpen) rightOpen = false;
		} else {
			rightOpen = shouldOpen;
			if (shouldOpen) leftOpen = false;
		}
		resetDrawerGesture();
	}

	/**
	 * Annule le geste courant sans modifier l'état du tiroir.
	 * @returns {void}
	 */
	function cancelDrawerGesture(): void {
		resetDrawerGesture();
	}

	/**
	 * Réinitialise les données temporaires du geste.
	 * @returns {void}
	 */
	function resetDrawerGesture(): void {
		gestureSide = null;
		gestureDragging = false;
		gestureProgress = 0;
	}
</script>

<svelte:window
	onpointermove={updateDrawerGesture}
	onpointerup={finishDrawerGesture}
	onpointercancel={cancelDrawerGesture}
/>

{#if !leftOpen && !rightOpen}
	<div
		class="edge-swipe-zone edge-swipe-zone-left"
		style={`width: ${EDGE_SWIPE_WIDTH_PX}px;`}
		onpointerdown={(event) => startDrawerGesture('left', event, false)}
	></div>
	<div
		class="edge-swipe-zone edge-swipe-zone-right"
		style={`width: ${EDGE_SWIPE_WIDTH_PX}px;`}
		onpointerdown={(event) => startDrawerGesture('right', event, false)}
	></div>
{/if}

{#if leftDrawerProgress > 0 || rightDrawerProgress > 0}
	<button
		class="drawer-backdrop"
		type="button"
		aria-label={$LL.common.close()}
		style:opacity={Math.max(leftDrawerProgress, rightDrawerProgress) * 0.45}
		onclick={() => {
			leftOpen = false;
			rightOpen = false;
		}}
	></button>
{/if}

<aside
	class="mobile-drawer mobile-drawer-left"
	class:open={leftOpen}
	class:dragging={gestureSide === 'left' && gestureDragging}
	style:transform={`translateX(${(leftDrawerProgress - 1) * 100}%)`}
	bind:this={leftDrawerElement}
	onpointerdown={(event) => startDrawerGesture('left', event, true)}
>
	{@render leftContent()}
</aside>

<aside
	class="mobile-drawer mobile-drawer-right"
	class:open={rightOpen}
	class:dragging={gestureSide === 'right' && gestureDragging}
	style:transform={`translateX(${(1 - rightDrawerProgress) * 100}%)`}
	bind:this={rightDrawerElement}
	onpointerdown={(event) => startDrawerGesture('right', event, true)}
>
	{@render rightContent()}
</aside>

<style>
	.drawer-backdrop {
		position: absolute;
		inset: 0;
		z-index: 145;
		background: rgb(0 0 0);
	}

	.edge-swipe-zone {
		position: absolute;
		top: 0;
		bottom: 0;
		z-index: 35;
		touch-action: none;
	}

	.edge-swipe-zone-left {
		left: 0;
	}

	.edge-swipe-zone-right {
		right: 0;
	}

	.mobile-drawer {
		position: absolute;
		top: 0;
		bottom: 0;
		z-index: 150;
		width: min(88vw, 360px);
		overflow: hidden;
		pointer-events: none;
		touch-action: pan-y;
		background: var(--bg-secondary);
		box-shadow: 0 0 24px rgb(0 0 0 / 45%);
		transition: transform 0.2s ease;
	}

	.mobile-drawer-left {
		left: 0;
	}

	.mobile-drawer-right {
		right: 0;
	}

	.mobile-drawer.open {
		pointer-events: auto;
	}

	.mobile-drawer.dragging {
		pointer-events: auto;
		transition: none;
	}

	.mobile-drawer :global(*) {
		touch-action: pan-y;
	}
</style>
