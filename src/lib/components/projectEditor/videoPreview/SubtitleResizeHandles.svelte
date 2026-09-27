<script lang="ts">
	import type { Style, StyleName } from '$lib/classes/VideoStyle.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { applyStyleMutation } from '$lib/services/StyleMutationService';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
	import { onDestroy } from 'svelte';

	type ResizeDirection = { x: -1 | 0 | 1; y: -1 | 0 | 1 };

	const resizeEdges: Array<{ className: string; direction: ResizeDirection }> = [
		{ className: 'subtitle-resize-edge-top', direction: { x: 0, y: -1 } },
		{ className: 'subtitle-resize-edge-right', direction: { x: 1, y: 0 } },
		{ className: 'subtitle-resize-edge-bottom', direction: { x: 0, y: 1 } },
		{ className: 'subtitle-resize-edge-left', direction: { x: -1, y: 0 } }
	];
	const resizeHandles: Array<{ className: string; direction: ResizeDirection }> = [
		{ className: 'subtitle-resize-top-left', direction: { x: -1, y: -1 } },
		{ className: 'subtitle-resize-top', direction: { x: 0, y: -1 } },
		{ className: 'subtitle-resize-top-right', direction: { x: 1, y: -1 } },
		{ className: 'subtitle-resize-right', direction: { x: 1, y: 0 } },
		{ className: 'subtitle-resize-bottom-right', direction: { x: 1, y: 1 } },
		{ className: 'subtitle-resize-bottom', direction: { x: 0, y: 1 } },
		{ className: 'subtitle-resize-bottom-left', direction: { x: -1, y: 1 } },
		{ className: 'subtitle-resize-left', direction: { x: -1, y: 0 } }
	];

	let { target }: { target: string } = $props();

	let resizeDirection: ResizeDirection | null = $state(null);
	let resizingContainer: HTMLElement | null = null;
	let startX = 0;
	let startY = 0;
	let initialWidth = 0;
	let initialHeight = 0;
	let previewScaleX = 1;
	let previewScaleY = 1;
	let previewWidth = 1;

	/**
	 * Applique une dimension avec la même portée et les mêmes images clés que l'éditeur de styles.
	 * @param {StyleName} styleId Identifiant de la dimension à modifier.
	 * @param {number} value Nouvelle valeur de la dimension.
	 * @returns {void}
	 */
	function applyResizeValue(styleId: StyleName, value: number): void {
		const styles = globalState.getVideoStyle.getStylesOfTarget(target);
		const style = styles.findStyle(styleId);
		if (!style) return;
		const clipIds = globalState.getStylesState.selectedSubtitles.map((subtitle) => subtitle.id);
		const constrainedValue = Math.round(
			Math.min(style.valueMax ?? Infinity, Math.max(style.valueMin ?? -Infinity, value))
		);
		applyStyleMutation({
			videoStyle: globalState.getVideoStyle,
			style,
			target,
			clipIds,
			time: Math.max(0, Math.floor(globalState.getTimelineState.cursorPosition)),
			value: constrainedValue,
			applyBaseValue: (nextValue: Style['value']) => (style.value = nextValue)
		});
	}

	/**
	 * Démarre le redimensionnement depuis la poignée choisie.
	 * @param {PointerEvent} event Événement de départ du pointeur.
	 * @param {ResizeDirection} direction Direction du redimensionnement.
	 * @returns {void}
	 */
	function startResize(event: PointerEvent, direction: ResizeDirection): void {
		if (event.button !== 0) return;
		const handle = event.currentTarget as HTMLElement;
		const subtitle = handle.closest<HTMLElement>('.subtitle');
		const overlay = handle.closest<HTMLElement>('#overlay');
		const subtitlesContainer = handle.closest<HTMLElement>('#subtitles-container');
		if (!subtitle || !overlay || !subtitlesContainer) return;

		event.preventDefault();
		event.stopPropagation();
		handle.setPointerCapture(event.pointerId);
		ProjectHistoryManager.begin('resize subtitle');

		const styles = globalState.getVideoStyle.getStylesOfTarget(target);
		const clipId = globalState.getStylesState.selectedSubtitles[0]?.id;
		const maxHeight = Number(styles.getEffectiveValue('max-height', clipId));
		const overlayRect = overlay.getBoundingClientRect();
		resizeDirection = direction;
		resizingContainer = subtitlesContainer;
		resizingContainer.dataset.resizingTarget = target;
		startX = event.clientX;
		startY = event.clientY;
		initialWidth = Number(styles.getEffectiveValue('width', clipId));
		initialHeight = maxHeight > 0 ? maxHeight : subtitle.offsetHeight;
		previewScaleX = overlay.offsetWidth ? overlayRect.width / overlay.offsetWidth : 1;
		previewScaleY = overlay.offsetHeight ? overlayRect.height / overlay.offsetHeight : 1;
		previewWidth = overlay.offsetWidth || 1;
	}

	/**
	 * Met à jour les dimensions pendant le déplacement du pointeur.
	 * @param {PointerEvent} event Événement courant du pointeur.
	 * @returns {void}
	 */
	function resize(event: PointerEvent): void {
		if (!resizeDirection) return;
		if (resizeDirection.x !== 0) {
			const width =
				initialWidth +
				(((event.clientX - startX) * 200) / previewScaleX / previewWidth) * resizeDirection.x;
			applyResizeValue('width', width);
		}
		if (resizeDirection.y !== 0) {
			const height =
				initialHeight + ((event.clientY - startY) * 2 * resizeDirection.y) / previewScaleY;
			applyResizeValue('max-height', Math.max(1, height));
		}
		globalState.updateVideoPreviewUI();
	}

	/**
	 * Termine le redimensionnement et crée une seule entrée dans l'historique.
	 * @param {PointerEvent} event Événement final du pointeur.
	 * @returns {void}
	 */
	function finishResize(event: PointerEvent): void {
		if (!resizeDirection) return;
		const handle = event.currentTarget as HTMLElement;
		if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
		if (resizingContainer) delete resizingContainer.dataset.resizingTarget;
		resizeDirection = null;
		resizingContainer = null;
		ProjectHistoryManager.commit();
		globalState.updateVideoPreviewUI();
	}

	onDestroy(() => {
		if (!resizeDirection) return;
		if (resizingContainer) delete resizingContainer.dataset.resizingTarget;
		ProjectHistoryManager.cancel();
	});
</script>

<span class:resizing={resizeDirection !== null} class="subtitle-resize-frame" aria-hidden="true">
	{#each resizeEdges as edge (edge.className)}
		<span
			class="subtitle-resize-edge {edge.className}"
			onmousedown={(event) => event.stopPropagation()}
			onpointerdown={(event) => startResize(event, edge.direction)}
			onpointermove={resize}
			onpointerup={finishResize}
			onpointercancel={finishResize}
		></span>
	{/each}
	{#each resizeHandles as handle (handle.className)}
		<span
			class="subtitle-resize-handle {handle.className}"
			onmousedown={(event) => event.stopPropagation()}
			onpointerdown={(event) => startResize(event, handle.direction)}
			onpointermove={resize}
			onpointerup={finishResize}
			onpointercancel={finishResize}
		></span>
	{/each}
	<span class="subtitle-move-handle"></span>
</span>

<style>
	.subtitle-resize-frame {
		position: absolute;
		z-index: 20;
		inset: 0;
		visibility: hidden;
		border: 4px solid var(--accent-primary);
		box-sizing: border-box;
		pointer-events: none;
	}

	:global(.subtitle:hover) .subtitle-resize-frame,
	.subtitle-resize-frame.resizing {
		visibility: visible;
	}

	:global(.subtitle.subtitle-layout-measurement) .subtitle-resize-frame {
		display: none;
	}

	.subtitle-resize-handle {
		position: absolute;
		width: 28px;
		height: 28px;
		z-index: 1;
		border: 4px solid var(--accent-primary);
		border-radius: 999px;
		background: white;
		box-shadow: 0 0 8px rgb(0 0 0 / 35%);
		pointer-events: auto;
		touch-action: none;
	}

	.subtitle-resize-edge {
		position: absolute;
		pointer-events: auto;
		touch-action: none;
	}

	.subtitle-move-handle {
		position: absolute;
		z-index: 2;
		top: 50%;
		left: 50%;
		width: 32px;
		height: 32px;
		transform: translate(-50%, -50%);
		border: 4px solid white;
		border-radius: 999px;
		background: var(--accent-primary);
		box-shadow:
			0 0 0 2px var(--accent-primary),
			0 0 8px rgb(0 0 0 / 35%);
		pointer-events: auto;
		cursor: move;
		touch-action: none;
	}

	.subtitle-resize-edge-top,
	.subtitle-resize-edge-bottom {
		right: 28px;
		left: 28px;
		height: 28px;
		cursor: ns-resize;
	}

	.subtitle-resize-edge-right,
	.subtitle-resize-edge-left {
		top: 28px;
		bottom: 28px;
		width: 28px;
		cursor: ew-resize;
	}

	.subtitle-resize-edge-top {
		top: 0;
	}

	.subtitle-resize-edge-right {
		right: 0;
	}

	.subtitle-resize-edge-bottom {
		bottom: 0;
	}

	.subtitle-resize-edge-left {
		left: 0;
	}

	.subtitle-resize-top,
	.subtitle-resize-bottom {
		left: 50%;
		cursor: ns-resize;
	}

	.subtitle-resize-right,
	.subtitle-resize-left {
		top: 50%;
		cursor: ew-resize;
	}

	.subtitle-resize-top,
	.subtitle-resize-top-left,
	.subtitle-resize-top-right {
		top: 0;
	}

	.subtitle-resize-right,
	.subtitle-resize-top-right,
	.subtitle-resize-bottom-right {
		right: 0;
	}

	.subtitle-resize-bottom,
	.subtitle-resize-bottom-left,
	.subtitle-resize-bottom-right {
		bottom: 0;
	}

	.subtitle-resize-left,
	.subtitle-resize-top-left,
	.subtitle-resize-bottom-left {
		left: 0;
	}

	.subtitle-resize-top {
		transform: translate(-50%, -50%);
	}

	.subtitle-resize-right {
		transform: translate(50%, -50%);
	}

	.subtitle-resize-bottom {
		transform: translate(-50%, 50%);
	}

	.subtitle-resize-left {
		transform: translate(-50%, -50%);
	}

	.subtitle-resize-top-left,
	.subtitle-resize-bottom-right {
		cursor: nwse-resize;
	}

	.subtitle-resize-top-left {
		transform: translate(-50%, -50%);
	}

	.subtitle-resize-bottom-right {
		transform: translate(50%, 50%);
	}

	.subtitle-resize-top-right,
	.subtitle-resize-bottom-left {
		cursor: nesw-resize;
	}

	.subtitle-resize-top-right {
		transform: translate(50%, -50%);
	}

	.subtitle-resize-bottom-left {
		transform: translate(-50%, 50%);
	}
</style>
