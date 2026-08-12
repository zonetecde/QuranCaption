<script lang="ts">
	import { AssetType, TrackType, AssetClip, type Clip, type Track } from '$lib/classes';
	import { globalState } from '$lib/runes/main.svelte';
	import { convertFileSrc } from '@tauri-apps/api/core';
	import { onDestroy, onMount, untrack } from 'svelte';
	import WaveSurfer from 'wavesurfer.js';
	import ContextMenu, { Item, Divider } from 'svelte-contextmenu';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
	import { currentMenu } from 'svelte-contextmenu/stores';
	import { showContextMenuInViewport } from '$lib/services/ContextMenuService';
	import { WaveformService } from '$lib/services/WaveformService.svelte.js';
	import ModalManager from '$lib/components/modals/ModalManager';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';

	let {
		clip = $bindable(),
		track = $bindable(),
		clipIndex
	}: {
		clip: Clip;
		track: Track;
		clipIndex: number;
	} = $props();

	onDestroy(() => {
		currentMenu.set(null);
		if (trimDragStartX !== null) stopTrim();
		if (clipGesturePointerId !== null) stopClipDragging();
	});

	let contextMenu: ContextMenu | undefined = $state(undefined); // Initialize context menu state

	let positionLeft = $derived(() => {
		return (track.getVisualClipStartTime(clipIndex) / 1000) * track.getPixelPerSecond();
	});

	const clipAssetId = (clip as AssetClip).assetId;
	const clipAsset = globalState.currentProject?.content.getAssetById(clipAssetId);
	if (!clipAsset) {
		throw new Error(`Missing asset ${clipAssetId} for clip ${clip.id}`);
	}
	const asset = clipAsset;
	let file = $derived(`${convertFileSrc(asset.filePath)}?v=${asset.mediaReloadToken}`);

	const isSelectedVideo = $derived(() => {
		return (
			track.type === TrackType.Video &&
			globalState.currentProject!.projectEditorState.currentTab === 'Style' &&
			globalState.getStylesState.isSelectedVideo(clip.id)
		);
	});

	const hasOverlayOverride = $derived(() => {
		if (track.type !== TrackType.Video) return false;
		return globalState.getVideoStyle.getStylesOfTarget('global').hasAnyOverrideForClip(clip.id);
	});

	let wavesurfer: WaveSurfer | undefined;
	let waveformElement: HTMLDivElement | undefined = $state(undefined);
	let trimDragStartX: number | null = null;
	let trimOriginalStartTime = 0;
	let trimOriginalEndTime = 0;
	let trimOriginalSourceStartTime = 0;
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
	let suppressClipClickUntil = 0;
	let clipDragStartX: number | null = null;
	let clipDragOriginalStartTime = 0;
	let clipDragVisualStarts: number[] | null = null;

	let canTrim = $derived(
		clip instanceof AssetClip && asset.type !== AssetType.Image && !clip.loopUntilAudioEnd
	);
	let canMove = $derived(clip instanceof AssetClip && asset.type !== AssetType.Image);
	let waveformWidth = $derived((asset.duration.ms / 1000) * track.getPixelPerSecond());
	let waveformOffset = $derived(
		(((clip instanceof AssetClip ? clip.sourceStartTime : 0) ?? 0) / 1000) *
			track.getPixelPerSecond()
	);

	/**
	 * Waits for a long press before starting horizontal clip movement.
	 * @param {PointerEvent} event Initial pointer event.
	 * @returns {void}
	 */
	function startClipDragging(event: PointerEvent): void {
		if (
			!event.isPrimary ||
			event.button !== 0 ||
			!canMove ||
			clipGesturePointerId !== null ||
			(event.target instanceof Element && event.target.closest('button, .asset-trim-handle'))
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
	 * Activates clip movement once the hold delay has elapsed.
	 * @returns {void}
	 */
	function activateClipDragging(): void {
		if (clipGesturePointerId === null) return;

		clipDragHoldTimer = null;
		document.removeEventListener('pointermove', handlePendingClipGesture);
		ProjectHistoryManager.begin('move asset clip');
		clipDragVisualStarts =
			track.type === TrackType.Video &&
			track.shouldUseVideoCrossfadeVisualTiming() &&
			!track.hasExplicitVideoClipTiming()
				? track.clips.map((_, index) => track.getVisualClipStartTime(index))
				: null;
		clipDragStartX = clipGestureStartX;
		clipDragOriginalStartTime = clipDragVisualStarts?.[clipIndex] ?? clip.startTime;
		globalState.getTimelineState.showCursor = false;
		document.addEventListener('pointermove', moveClip);
	}

	/**
	 * Scrolls the timeline when movement starts before the long press delay.
	 * @param {PointerEvent} event Pointer movement event.
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

	/**
	 * Moves the clip without crossing neighboring clips.
	 * @param {PointerEvent} event Pointer movement event.
	 * @returns {void}
	 */
	function moveClip(event: PointerEvent): void {
		if (clipDragStartX === null || event.pointerId !== clipGesturePointerId) return;
		event.preventDefault();
		const deltaMs = Math.round(
			((event.clientX - clipDragStartX) / track.getPixelPerSecond()) * 1000
		);
		const visualStarts = clipDragVisualStarts;
		if (visualStarts) {
			if (deltaMs === 0) return;
			track.clips.forEach((trackClip, index) => {
				trackClip.startTime = visualStarts[index];
				trackClip.endTime = visualStarts[index] + trackClip.duration;
			});
			clipDragVisualStarts = null;
		}
		const previousClip = track.getClipBefore(clip.id);
		const nextClip = track.getClipAfter(clip.id);
		const allowCrossfadeOverlap =
			track.type === TrackType.Video &&
			String(globalState.getStyle('global', 'video-clip-transition')?.value ?? 'none') ===
				'crossfade';
		const minimumStart = previousClip
			? allowCrossfadeOverlap
				? Math.max(previousClip.startTime + 1, previousClip.endTime - clip.duration + 1)
				: previousClip.endTime + 1
			: 0;
		const maximumStart = nextClip
			? allowCrossfadeOverlap
				? Math.min(nextClip.startTime - 1, nextClip.endTime - clip.duration - 1)
				: nextClip.startTime - clip.duration - 1
			: Number.POSITIVE_INFINITY;
		const newStart = Math.max(
			minimumStart,
			Math.min(maximumStart, clipDragOriginalStartTime + deltaMs)
		);

		clip.startTime = newStart;
		clip.endTime = newStart + clip.duration;
	}

	/**
	 * Ends clip movement and creates one undo/redo entry.
	 * @param {PointerEvent} [event] Pointer release event.
	 * @returns {void}
	 */
	function stopClipDragging(event?: PointerEvent): void {
		if (event && event.pointerId !== clipGesturePointerId) return;

		const didActivateDragging = clipDragStartX !== null;
		if (clipDragHoldTimer !== null) clearTimeout(clipDragHoldTimer);
		if (clipGestureDidScroll || didActivateDragging)
			suppressClipClickUntil = performance.now() + 500;
		clipDragHoldTimer = null;
		clipGesturePointerId = null;
		clipGestureScrollElement = null;
		clipGestureDidScroll = false;
		clipDragStartX = null;
		clipDragVisualStarts = null;
		document.removeEventListener('pointermove', handlePendingClipGesture);
		document.removeEventListener('pointermove', moveClip);
		document.removeEventListener('pointerup', stopClipDragging);
		document.removeEventListener('pointercancel', stopClipDragging);
		if (!didActivateDragging) return;

		globalState.getTimelineState.showCursor = true;
		globalState.getTimelineState.movePreviewTo = globalState.getTimelineState.cursorPosition + 1;
		ProjectHistoryManager.commit();
	}

	/**
	 * Starts non-destructive trimming on one clip edge.
	 * @param {'left' | 'right'} edge Edge being manipulated.
	 * @param {PointerEvent} event Initial pointer event.
	 * @returns {void}
	 */
	function startTrim(edge: 'left' | 'right', event: PointerEvent): void {
		if (!event.isPrimary || event.button !== 0 || !canTrim) return;
		event.preventDefault();
		event.stopPropagation();
		ProjectHistoryManager.begin('trim asset clip');
		trimDragStartX = event.clientX;
		trimOriginalStartTime = clip.startTime;
		trimOriginalEndTime = clip.endTime;
		trimOriginalSourceStartTime = (clip as AssetClip).sourceStartTime ?? 0;
		globalState.getTimelineState.showCursor = false;
		document.addEventListener('pointermove', edge === 'left' ? trimLeft : trimRight);
		document.addEventListener('pointerup', stopTrim);
		document.addEventListener('pointercancel', stopTrim);
	}

	/**
	 * Trims the left edge while preserving the source offset.
	 * @param {PointerEvent} event Pointer movement event.
	 * @returns {void}
	 */
	function trimLeft(event: PointerEvent): void {
		if (trimDragStartX === null || !(clip instanceof AssetClip)) return;
		const deltaMs = Math.round(
			((event.clientX - trimDragStartX) / track.getPixelPerSecond()) * 1000
		);
		const previousClip = track.getClipBefore(clip.id);
		const minimumStart = Math.max(
			0,
			trimOriginalStartTime - trimOriginalSourceStartTime,
			previousClip ? previousClip.endTime + 1 : 0
		);
		const newStart = Math.min(
			trimOriginalEndTime - 100,
			Math.max(minimumStart, trimOriginalStartTime + deltaMs)
		);

		clip.startTime = newStart;
		clip.duration = clip.endTime - newStart;
		clip.sourceStartTime = trimOriginalSourceStartTime + (newStart - trimOriginalStartTime);
	}

	/**
	 * Trims the right edge within the source and neighboring clip limits.
	 * @param {PointerEvent} event Pointer movement event.
	 * @returns {void}
	 */
	function trimRight(event: PointerEvent): void {
		if (trimDragStartX === null || !(clip instanceof AssetClip)) return;
		const deltaMs = Math.round(
			((event.clientX - trimDragStartX) / track.getPixelPerSecond()) * 1000
		);
		const nextClip = track.getClipAfter(clip.id);
		const sourceEndTime =
			trimOriginalSourceStartTime + (trimOriginalEndTime - trimOriginalStartTime);
		const maximumEnd = Math.min(
			trimOriginalEndTime + Math.max(0, asset.duration.ms - sourceEndTime),
			nextClip ? nextClip.startTime - 1 : Number.POSITIVE_INFINITY
		);
		const newEnd = Math.max(
			trimOriginalStartTime + 100,
			Math.min(maximumEnd, trimOriginalEndTime + deltaMs)
		);

		clip.endTime = newEnd;
		clip.duration = newEnd - clip.startTime;
	}

	/**
	 * Ends trimming and creates one undo/redo entry.
	 * @returns {void}
	 */
	function stopTrim(): void {
		trimDragStartX = null;
		document.removeEventListener('pointermove', trimLeft);
		document.removeEventListener('pointermove', trimRight);
		document.removeEventListener('pointerup', stopTrim);
		document.removeEventListener('pointercancel', stopTrim);
		globalState.getTimelineState.showCursor = true;
		globalState.getTimelineState.movePreviewTo = globalState.getTimelineState.cursorPosition + 1;
		ProjectHistoryManager.commit();
	}

	/**
	 * Libère la waveform si son fichier doit être remplacé.
	 *
	 * @param {Event} event Événement global contenant le chemin du fichier.
	 * @returns {void}
	 */
	function releaseWaveformForAsset(event: Event): void {
		const filePath = (event as CustomEvent<{ filePath?: string }>).detail?.filePath;
		if (filePath !== asset.filePath || !wavesurfer) return;

		wavesurfer.destroy();
		wavesurfer = undefined;
	}

	/**
	 * Retourne la hauteur actuelle du conteneur de waveform.
	 * @returns {number | 'auto'} Hauteur à appliquer à WaveSurfer.
	 */
	function getWaveformHeight(): number | 'auto' {
		const height = waveformElement?.clientHeight ?? 0;
		return height > 0 ? height : 'auto';
	}

	/**
	 * Ajuste la waveform à la hauteur visible du clip audio.
	 * @returns {void}
	 */
	function resizeWaveformToContainer(): void {
		if (!wavesurfer || !waveformElement) return;

		const height = getWaveformHeight();
		if (height === 'auto') return;

		wavesurfer.setOptions({ height });
	}

	onMount(() => {
		window.addEventListener('qurancaption-release-asset-media', releaseWaveformForAsset);
		return () => {
			window.removeEventListener('qurancaption-release-asset-media', releaseWaveformForAsset);
		};
	});

	$effect(() => {
		if (!waveformElement) return;

		const resizeObserver = new ResizeObserver(resizeWaveformToContainer);
		resizeObserver.observe(waveformElement);

		return () => resizeObserver.disconnect();
	});

	$effect(() => {
		if (
			(asset.duration.ms < 45 * 60 * 1000 || clip.showWaveform) &&
			globalState.settings?.persistentUiState.showWaveforms &&
			track.type === TrackType.Audio
		) {
			// On dépend de refreshVersion pour forcer le recalcul si besoin
			const _v = WaveformService.refreshVersion;
			const _mediaReloadToken = asset.mediaReloadToken;

			untrack(async () => {
				if (wavesurfer) {
					wavesurfer.destroy();
					wavesurfer = undefined;
				}

				try {
					const peaks = await WaveformService.getPeaks(asset.filePath);
					wavesurfer = WaveSurfer.create({
						container: waveformElement ?? '#clip-' + clip.id,
						waveColor: '#9d99cc',
						progressColor: '#9d99cc',
						url: file,
						peaks: [peaks], // Pass peaks to avoid decoding
						duration: asset.duration.ms / 1000,
						height: getWaveformHeight()
					});
					resizeWaveformToContainer();
				} catch (e) {
					console.error('Failed to load waveform:', e);
					// Fallback to normal loading if backend fails
					wavesurfer = WaveSurfer.create({
						container: waveformElement ?? '#clip-' + clip.id,
						waveColor: '#9d99cc',
						progressColor: '#9d99cc',
						url: file,
						height: getWaveformHeight()
					});
					resizeWaveformToContainer();
				}
			});
		}

		return () => {
			if (wavesurfer) {
				wavesurfer.destroy();
				wavesurfer = undefined;
			}
		};
	});

	function removeClip() {
		setTimeout(() => {
			if (track.type === TrackType.Video && globalState.getStylesState.isSelectedVideo(clip.id)) {
				globalState.getStylesState.removeVideoSelection(clip.id);
			}
			track.removeClip(clip.id);
		});
	}

	function handleClipClick(event: MouseEvent) {
		if (performance.now() < suppressClipClickUntil) {
			event.stopPropagation();
			return;
		}

		if (globalState.getTimelineState.wasCursorDragged) {
			globalState.getTimelineState.wasCursorDragged = false;
			return;
		}

		if (
			track.type !== TrackType.Video ||
			globalState.currentProject!.projectEditorState.currentTab !== 'Style' ||
			!(clip instanceof AssetClip)
		) {
			return;
		}

		// click simple = sélection unique, Ctrl/Cmd+click = multi.
		const isMultiSelect = Boolean(event.ctrlKey || event.metaKey);
		if (isMultiSelect) {
			globalState.getStylesState.toggleVideoSelection(clip);
		} else {
			const alreadyOnlySelected =
				globalState.getStylesState.selectedVideos.length === 1 &&
				globalState.getStylesState.isSelectedVideo(clip.id);
			if (alreadyOnlySelected) {
				globalState.getStylesState.clearSelection();
			} else {
				globalState.getStylesState.selectOnlyVideo(clip);
			}
		}
	}
	function loopUntilTheEndClicked(): void {
		ProjectHistoryManager.begin('toggle looped video');
		try {
			const assetClip = clip as AssetClip;
			const willEnable = !assetClip.loopUntilAudioEnd;
			assetClip.loopUntilAudioEnd = willEnable;

			if (assetClip.loopUntilAudioEnd) {
				// If there are other clips in the track, the loop cannot be activated.
				if (track.clips.length > 1) {
					assetClip.loopUntilAudioEnd = false;
					ModalManager.errorModal(
						get(LL).editor.loopingError(),
						get(LL).editor.canOnlyEnableLoopIfOnlyClip()
					);
					return;
				}

				if (globalState.currentProject) {
					assetClip.setEndTime(
						globalState.currentProject.content.timeline.getLongestTrackDurationIgnoringLoopedVideo()
							.ms
					);
				}
			} else {
				const asset = globalState.currentProject?.content.getAssetById(assetClip.assetId);
				if (asset) {
					assetClip.setEndTime(assetClip.startTime + asset.duration.ms);
				}
			}
		} finally {
			ProjectHistoryManager.commit();
		}
	}
</script>

<div
	class={'absolute inset-0 z-10 border rounded-md group ' +
		(track.type === TrackType.Audio
			? 'border-[var(--timeline-audio-clip-border)] bg-[var(--timeline-audio-clip-color)]'
			: 'border-[var(--timeline-video-clip-border)] bg-[var(--timeline-video-clip-color)]') +
		(isSelectedVideo()
			? ' bg-[var(--video-clip-selection)]! ring-1 ring-[var(--video-clip-selection)]/60'
			: '') +
		(canMove ? ' cursor-move' : '')}
	style="width: {clip.getWidth()}px; left: {positionLeft()}px; touch-action: {canMove
		? 'none'
		: 'auto'};"
	onclick={handleClipClick}
	onpointerdown={startClipDragging}
	oncontextmenu={(e) => {
		if (clipDragStartX !== null) {
			e.preventDefault();
			return;
		}
		void showContextMenuInViewport(contextMenu, e);
	}}
>
	{#if track.type === TrackType.Video && hasOverlayOverride()}
		<div class="absolute top-0.5 left-0.5 z-20 flex items-center gap-1">
			<span
				class="material-icons-outlined text-[10px] opacity-80"
				title={get(LL).editor.overlayIndividualApplied()}
			>
				auto_fix_high
			</span>
		</div>
	{/if}

	{#if (asset.duration.ms < 45 * 60 * 1000 || clip.showWaveform) && globalState.settings?.persistentUiState.showWaveforms && track.type === TrackType.Audio}
		<div class="absolute inset-0 overflow-hidden">
			<div
				class="h-full will-change-transform"
				style="width: {waveformWidth}px; transform: translateX(-{waveformOffset}px);"
				id={'clip-' + clip.id}
				bind:this={waveformElement}
			></div>
		</div>
	{:else if asset.duration.ms >= 45 * 60 * 1000 && globalState.settings?.persistentUiState.showWaveforms && track.type === TrackType.Audio}
		<div class="h-full w-full" onclick={() => (clip.showWaveform = true)}>
			{get(LL).editor.clickToGenerateWaveform()}
		</div>
	{:else}
		<div class="absolute inset-0 z-5 flex overflow-hidden px-2 py-2">
			<span class="text-xs text-[var(--text-secondary)] font-medium">{asset.fileName}</span>
		</div>
	{/if}

	<section class="absolute bottom-0.5 left-0.5 z-5">
		<!-- delete clip -->
		<button
			class="text-[var(--text-secondary)] text-sm cursor-pointer opacity-0 group-hover:opacity-100"
			onclick={(e) => {
				e.stopPropagation();
				removeClip();
			}}
		>
			<span class="material-icons">delete</span>
		</button>
	</section>

	{#if canTrim}
		<div
			class="asset-trim-handle absolute inset-y-0 left-0 z-30 w-11 max-w-[40%] cursor-ew-resize touch-none"
			onpointerdown={(event) => startTrim('left', event)}
		>
			<div class="absolute inset-y-1 left-1 w-1 rounded-full bg-white/70"></div>
		</div>
		<div
			class="asset-trim-handle absolute inset-y-0 right-0 z-30 w-11 max-w-[40%] cursor-ew-resize touch-none"
			onpointerdown={(event) => startTrim('right', event)}
		>
			<div class="absolute inset-y-1 right-1 w-1 rounded-full bg-white/70"></div>
		</div>
	{/if}
</div>

<ContextMenu bind:this={contextMenu}>
	{#if track.type === TrackType.Video && clip instanceof AssetClip}
		<Item on:click={loopUntilTheEndClicked}>
			<div class="btn-icon">
				<span class="material-icons-outlined text-sm mr-1">
					{(clip as AssetClip).loopUntilAudioEnd ? 'check_box' : 'check_box_outline_blank'}
				</span>
				{get(LL).editor.loopUntilTheEnd()}
			</div>
		</Item>
		<Divider />
	{/if}
	<Item on:click={removeClip}
		><div class="btn-icon">
			<span class="material-icons-outlined text-sm mr-1">remove</span>{get(LL).editor.removeClip()}
		</div></Item
	>
</ContextMenu>
