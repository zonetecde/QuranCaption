<script lang="ts">
	import type { Track } from '$lib/classes';
	import { globalState } from '$lib/runes/main.svelte';
	import ContextMenu, { Item } from 'svelte-contextmenu';
	import { currentMenu } from 'svelte-contextmenu/stores';
	import { showContextMenuInViewport } from '$lib/services/ContextMenuService';
	import { onDestroy } from 'svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import {
		getSnappedTimelineCustomClipTime,
		getTimelineCustomClipLabel,
		GlobalTimedOverlayTimelineClip,
		type TimelineCustomClipLike
	} from './timelineCustomClip';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';

	let {
		clip = $bindable(),
		track = $bindable()
	}: {
		clip: TimelineCustomClipLike;
		track: Track;
	} = $props();

	onDestroy(() => {
		currentMenu.set(null);
		if (resizePointerId !== null) stopResize();
		if (clipGesturePointerId !== null) stopClipDragging();
	});

	let positionLeft = $derived(() => {
		// Si le custom text est visible sur toute la vidéo, on force le début à 0.
		return clip.getAlwaysShow() ? 0 : (clip.startTime / 1000) * track.getPixelPerSecond();
	});

	let contextMenu: ContextMenu | null = null;

	let resizePointerId: number | null = null;
	let resizeEdge: 'left' | 'right' | null = null;
	let resizeStartX = 0;
	let resizeOriginalStartTime = 0;
	let resizeOriginalEndTime = 0;
	const clipDragHoldDelayMs = 300;
	const clipGestureMoveThresholdPx = 8;
	let clipDragHoldTimer: ReturnType<typeof setTimeout> | null = null;
	let clipGesturePointerId: number | null = null;
	let clipGestureStartX = 0;
	let clipGestureStartY = 0;
	let clipGestureScrollElement: HTMLElement | null = null;
	let clipGestureScrollLeft = 0;
	let clipGestureScrollTop = 0;
	let clipGestureDidScroll = false;
	let clipDragStartX: number | null = null;
	let originalStartTime = 0;
	let originalDuration = 0;

	function removeClip(_e: MouseEvent): void {
		if (clip instanceof GlobalTimedOverlayTimelineClip) {
			const sourceClipId = clip.getSourceClipId();
			if (sourceClipId === null) return;
			setTimeout(() => {
				track.removeClip(sourceClipId);
			});
			return;
		}
		setTimeout(() => {
			track.removeClip(Number(clip.id));
		});
	}

	/**
	 * Démarre le redimensionnement tactile depuis un bord du clip.
	 * @param {'left' | 'right'} edge Bord manipulé.
	 * @param {PointerEvent} event Événement initial du pointeur.
	 * @returns {void}
	 */
	function startResize(edge: 'left' | 'right', event: PointerEvent): void {
		if (!event.isPrimary || event.button !== 0 || clip.getAlwaysShow()) return;
		event.preventDefault();
		event.stopPropagation();
		ProjectHistoryManager.begin('resize custom clip');
		resizePointerId = event.pointerId;
		resizeEdge = edge;
		resizeStartX = event.clientX;
		resizeOriginalStartTime = clip.startTime;
		resizeOriginalEndTime = clip.endTime;
		globalState.getTimelineState.showCursor = false;
		document.addEventListener('pointermove', resizeClip);
		document.addEventListener('pointerup', stopResize);
		document.addEventListener('pointercancel', stopResize);
	}

	/**
	 * Redimensionne le clip selon le déplacement horizontal du pointeur.
	 * @param {PointerEvent} event Événement courant du pointeur.
	 * @returns {void}
	 */
	function resizeClip(event: PointerEvent): void {
		if (event.pointerId !== resizePointerId || !resizeEdge) return;
		event.preventDefault();
		const deltaMs = Math.round(((event.clientX - resizeStartX) / track.getPixelPerSecond()) * 1000);
		if (resizeEdge === 'left') {
			const newStart = getSnappedTimelineCustomClipTime(
				Math.max(0, resizeOriginalStartTime + deltaMs),
				String(clip.id)
			);
			if (resizeOriginalEndTime - newStart >= 100) clip.setStartTime(newStart);
			return;
		}

		const newEnd = getSnappedTimelineCustomClipTime(
			resizeOriginalEndTime + deltaMs,
			String(clip.id)
		);
		if (newEnd - resizeOriginalStartTime >= 100) clip.setEndTime(newEnd);
	}

	/**
	 * Termine le redimensionnement et crée une seule entrée undo/redo.
	 * @returns {void}
	 */
	function stopResize(): void {
		if (resizePointerId === null) return;
		resizePointerId = null;
		resizeEdge = null;
		document.removeEventListener('pointermove', resizeClip);
		document.removeEventListener('pointerup', stopResize);
		document.removeEventListener('pointercancel', stopResize);
		globalState.getTimelineState.showCursor = true;
		ProjectHistoryManager.commit();
	}

	/**
	 * Attend un appui long avant de déplacer le clip, comme les clips vidéo mobiles.
	 * @param {PointerEvent} event Événement initial du pointeur.
	 * @returns {void}
	 */
	function startClipDragging(event: PointerEvent): void {
		if (
			!event.isPrimary ||
			event.button !== 0 ||
			clip.getAlwaysShow() ||
			clipGesturePointerId !== null ||
			(event.target instanceof Element && event.target.closest('.custom-clip-resize-handle'))
		)
			return;

		event.preventDefault();
		clipGesturePointerId = event.pointerId;
		clipGestureStartX = event.clientX;
		clipGestureStartY = event.clientY;
		clipGestureScrollElement = (event.currentTarget as HTMLElement).closest<HTMLElement>(
			'.timeline-tracks'
		);
		clipGestureScrollLeft = clipGestureScrollElement?.scrollLeft ?? 0;
		clipGestureScrollTop = clipGestureScrollElement?.scrollTop ?? 0;
		clipGestureDidScroll = false;
		clipDragHoldTimer = setTimeout(activateClipDragging, clipDragHoldDelayMs);
		document.addEventListener('pointermove', handlePendingClipGesture);
		document.addEventListener('pointerup', stopClipDragging);
		document.addEventListener('pointercancel', stopClipDragging);
	}

	/**
	 * Active le déplacement après le délai d'appui long.
	 * @returns {void}
	 */
	function activateClipDragging(): void {
		if (clipGesturePointerId === null) return;
		clipDragHoldTimer = null;
		document.removeEventListener('pointermove', handlePendingClipGesture);
		ProjectHistoryManager.begin('move custom clip');
		clipDragStartX = clipGestureStartX;
		originalStartTime = clip.startTime;
		originalDuration = clip.duration;
		globalState.getTimelineState.showCursor = false;
		document.addEventListener('pointermove', onClipDragging);
	}

	/**
	 * Fait défiler la timeline si le doigt bouge avant la fin de l'appui long.
	 * @param {PointerEvent} event Événement courant du pointeur.
	 * @returns {void}
	 */
	function handlePendingClipGesture(event: PointerEvent): void {
		if (event.pointerId !== clipGesturePointerId) return;
		const deltaX = event.clientX - clipGestureStartX;
		const deltaY = event.clientY - clipGestureStartY;
		if (!clipGestureDidScroll && Math.hypot(deltaX, deltaY) < clipGestureMoveThresholdPx) return;
		if (clipDragHoldTimer !== null) clearTimeout(clipDragHoldTimer);
		clipDragHoldTimer = null;
		clipGestureDidScroll = true;
		if (clipGestureScrollElement) {
			clipGestureScrollElement.scrollLeft = clipGestureScrollLeft - deltaX;
			clipGestureScrollElement.scrollTop = clipGestureScrollTop - deltaY;
		}
		event.preventDefault();
	}

	function onClipDragging(event: PointerEvent): void {
		if (clipDragStartX === null || event.pointerId !== clipGesturePointerId) return;
		event.preventDefault();
		const deltaPixels = event.clientX - clipDragStartX;
		const deltaSeconds = deltaPixels / track.getPixelPerSecond();
		const deltaMs = deltaSeconds * 1000;
		const rawStart = Math.max(0, Math.round(originalStartTime + deltaMs));
		const newStart = getSnappedTimelineCustomClipTime(rawStart, String(clip.id), originalDuration);
		const newEnd = newStart + originalDuration;
		clip.setStartTime(newStart);
		clip.setEndTime(newEnd);
	}

	function stopClipDragging(event?: PointerEvent): void {
		if (event && event.pointerId !== clipGesturePointerId) return;
		const didActivateDragging = clipDragStartX !== null;
		if (clipDragHoldTimer !== null) clearTimeout(clipDragHoldTimer);
		clipDragHoldTimer = null;
		clipGesturePointerId = null;
		clipGestureScrollElement = null;
		clipGestureDidScroll = false;
		clipDragStartX = null;
		document.removeEventListener('pointermove', handlePendingClipGesture);
		document.removeEventListener('pointermove', onClipDragging);
		document.removeEventListener('pointerup', stopClipDragging);
		document.removeEventListener('pointercancel', stopClipDragging);
		if (!didActivateDragging) return;
		globalState.getTimelineState.showCursor = true;
		ProjectHistoryManager.commit();
	}

	function toggleAlwaysShow(_e: MouseEvent): void {
		clip.setStyle('always-show', !clip.getAlwaysShow());
	}
</script>

<div
	class="absolute inset-0 z-10 touch-none border border-[var(--timeline-customtext-clip-border)] bg-[var(--timeline-customtext-clip-color)] rounded-md group overflow-hidden {clip.getAlwaysShow()
		? ''
		: 'cursor-move'}"
	style="width: {clip.getWidth()}px; left: {positionLeft()}px;"
	oncontextmenu={(e) => {
		if (clipDragStartX !== null || resizePointerId !== null) {
			e.preventDefault();
			return;
		}
		void showContextMenuInViewport(contextMenu, e);
	}}
	onpointerdown={startClipDragging}
>
	<div class="absolute inset-0 z-5 flex overflow-hidden px-2 py-2">
		<div class="flex items-center w-full">
			<span class="text-xs text-[var(--text-secondary)] font-medium">
				{getTimelineCustomClipLabel(clip)}
			</span>
		</div>
	</div>

	{#if !clip.getAlwaysShow()}
		<!-- Poignée gauche -->
		<div
			class="custom-clip-resize-handle absolute inset-y-0 left-0 z-30 w-11 max-w-[40%] cursor-ew-resize touch-none"
			onpointerdown={(event) => startResize('left', event)}
		>
			<div class="absolute inset-y-1 left-1 w-1 rounded-full bg-white/70"></div>
		</div>
		<!-- Poignée droite -->
		<div
			class="custom-clip-resize-handle absolute inset-y-0 right-0 z-30 w-11 max-w-[40%] cursor-ew-resize touch-none"
			onpointerdown={(event) => startResize('right', event)}
		>
			<div class="absolute inset-y-1 right-1 w-1 rounded-full bg-white/70"></div>
		</div>
	{/if}
</div>

<ContextMenu bind:this={contextMenu}>
	{#if !(clip instanceof GlobalTimedOverlayTimelineClip) || clip.canRemove}
		<Item on:click={removeClip}
			><div class="btn-icon">
				<span class="material-icons-outlined text-sm mr-1">remove</span>{clip.type ===
				'Custom Image'
					? ((
							$LL.editor as typeof $LL.editor & { removeCustomImage?: () => string }
						).removeCustomImage?.() ?? `${$LL.common.remove()} ${$LL.editor.customImage()}`)
					: $LL.editor.removeCustomText()}
			</div></Item
		>
	{/if}
	<Item on:click={toggleAlwaysShow}
		><div class="btn-icon">
			<span class="material-icons-outlined text-sm mr-1">
				{clip.getAlwaysShow() ? 'visibility' : 'visibility_off'}
			</span>{$LL.editor.toggleAlwaysShow()}
		</div></Item
	>
</ContextMenu>
