<script lang="ts">
	import { CustomTextClip, TrackType, type AssetClip, type Clip, type Track } from '$lib/classes';
	import { globalState } from '$lib/runes/main.svelte';
	import { fade, slide } from 'svelte/transition';
	import ContextMenu, { Item, Divider, Settings } from 'svelte-contextmenu';
	import { currentMenu } from 'svelte-contextmenu/stores';
	import type { CustomClip, CustomImageClip } from '$lib/classes/Clip.svelte';
	import { onDestroy } from 'svelte';

	let {
		clip = $bindable(),
		track = $bindable()
	}: {
		clip: CustomClip;
		track: Track;
	} = $props();

	onDestroy(() => {
		currentMenu.set(null);
	});

	let positionLeft = $derived(() => {
		// Si le custom text est visible sur toute la vidéo, on force le début à 0.
		return clip.getAlwaysShow() ? 0 : (clip.startTime / 1000) * track.getPixelPerSecond();
	});

	let contextMenu: ContextMenu | null = null;

	/** Drag resizing state */
	let dragStartX: number | null = null;
	/** Drag whole clip state */
	let clipDragStartX: number | null = null;
	let originalStartTime = 0;
	let originalDuration = 0;

	function removeClip(e: MouseEvent): void {
		setTimeout(() => {
			track.removeClip(clip.id);
		});
	}

	// --- Redimensionnement gauche ---
	function startLeftDragging(e: MouseEvent) {
		if (e.button !== 0 || clip.getAlwaysShow()) return; // pas de drag si always-show
		dragStartX = e.clientX;
		globalState.getTimelineState.showCursor = false;
		document.addEventListener('mousemove', onLeftDragging);
		document.addEventListener('mouseup', stopLeftDragging);
	}

	function onLeftDragging(e: MouseEvent) {
		if (dragStartX === null) return;
		const newStart = globalState.currentProject?.projectEditorState.timeline.cursorPosition!;
		// Durée minimale 100ms
		if (clip.endTime - newStart < 100) return;
		clip.setStartTime(newStart);
		// Miroir dans les styles
		if (clip.category) {
			const style = clip.category.styles.find((s) => s.id === 'time-appearance');
			if (style) style.value = newStart;
		}
	}

	function stopLeftDragging() {
		dragStartX = null;
		document.removeEventListener('mousemove', onLeftDragging);
		document.removeEventListener('mouseup', stopLeftDragging);
		globalState.getTimelineState.showCursor = true;
	}

	// --- Redimensionnement droite ---
	function startRightDragging(e: MouseEvent) {
		if (e.button !== 0 || clip.getAlwaysShow()) return;
		dragStartX = e.clientX;
		globalState.getTimelineState.showCursor = false;
		document.addEventListener('mousemove', onRightDragging);
		document.addEventListener('mouseup', stopRightDragging);
	}

	function onRightDragging(e: MouseEvent) {
		if (dragStartX === null) return;
		const newEnd = globalState.currentProject?.projectEditorState.timeline.cursorPosition!;
		if (newEnd - clip.startTime < 100) return;
		clip.setEndTime(newEnd);
		if (clip.category) {
			const style = clip.category.styles.find((s) => s.id === 'time-disappearance');
			if (style) style.value = newEnd;
		}
	}

	function stopRightDragging() {
		dragStartX = null;
		document.removeEventListener('mousemove', onRightDragging);
		document.removeEventListener('mouseup', stopRightDragging);
		globalState.getTimelineState.showCursor = true;
	}

	// --- Déplacement complet du clip ---
	function startClipDragging(e: MouseEvent) {
		// Empêche le drag si on clique sur les poignées (géré séparément) ou si always-show
		if (e.button !== 0 || clip.getAlwaysShow()) return;
		// Ignore si on a commencé sur une poignée (largeur 1px) - déjà capturé par leurs handlers.
		clipDragStartX = e.clientX;
		originalStartTime = clip.startTime;
		originalDuration = clip.duration; // conserver la durée
		globalState.getTimelineState.showCursor = false;
		document.addEventListener('mousemove', onClipDragging);
		document.addEventListener('mouseup', stopClipDragging);
	}

	function onClipDragging(e: MouseEvent) {
		if (clipDragStartX === null) return;
		const deltaPixels = e.clientX - clipDragStartX;
		const deltaSeconds = deltaPixels / track.getPixelPerSecond();
		const deltaMs = deltaSeconds * 1000;
		let newStart = Math.max(0, Math.round(originalStartTime + deltaMs));
		let newEnd = newStart + originalDuration;
		clip.setStartTime(newStart);
		clip.setEndTime(newEnd);
		// Sync styles
		if (clip.category) {
			const startStyle = clip.category.styles.find((s) => s.id === 'time-appearance');
			if (startStyle) startStyle.value = newStart;
			const endStyle = clip.category.styles.find((s) => s.id === 'time-disappearance');
			if (endStyle) endStyle.value = newEnd;
		}
	}

	function stopClipDragging() {
		clipDragStartX = null;
		document.removeEventListener('mousemove', onClipDragging);
		document.removeEventListener('mouseup', stopClipDragging);
		globalState.getTimelineState.showCursor = true;
	}

	function toggleAlwaysShow(e: MouseEvent): void {
		clip.setStyle('always-show', !clip.getAlwaysShow());
	}
</script>

<div
	class="absolute inset-0 z-10 border border-[var(--timeline-customtext-clip-border)] bg-[var(--timeline-customtext-clip-color)] rounded-md group overflow-hidden {clip.getAlwaysShow()
		? ''
		: 'cursor-move'}"
	style="width: {clip.getWidth()}px; left: {positionLeft()}px;"
	transition:slide={{ duration: 500, axis: 'x' }}
	oncontextmenu={(e) => {
		e.preventDefault();
		contextMenu!.show(e);
	}}
	onmousedown={startClipDragging}
>
	<div class="absolute inset-0 z-5 flex overflow-hidden px-2 py-2">
		<div class="flex items-center w-full">
			<span class="text-xs text-[var(--text-secondary)] font-medium"
				>{clip.type === 'Custom Text'
					? (clip as CustomTextClip).getText()
					: (clip as CustomImageClip).getFilePath().split('\\').pop() || 'No Image'}</span
			>
		</div>
	</div>

	{#if !clip.getAlwaysShow()}
		<!-- Poignée gauche -->
		<div
			class="h-full w-1 left-0 cursor-w-resize absolute top-0 bottom-0 z-10"
			onmousedown={(e) => {
				e.stopPropagation();
				startLeftDragging(e);
			}}
		></div>
		<!-- Poignée droite -->
		<div
			class="h-full w-1 right-0 cursor-w-resize absolute top-0 bottom-0 z-10"
			onmousedown={(e) => {
				e.stopPropagation();
				startRightDragging(e);
			}}
		></div>
	{/if}
</div>

<ContextMenu bind:this={contextMenu}>
	<Item on:click={removeClip}
		><div class="btn-icon">
			<span class="material-icons-outlined text-sm mr-1">remove</span>Remove Custom Text
		</div></Item
	>
	<Item on:click={toggleAlwaysShow}
		><div class="btn-icon">
			<span class="material-icons-outlined text-sm mr-1">
				{clip.getAlwaysShow() ? 'visibility' : 'visibility_off'}
			</span>Toggle "Always Show" style
		</div></Item
	>
</ContextMenu>
