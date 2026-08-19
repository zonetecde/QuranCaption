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
	import { WaveformService } from '$lib/services/WaveformService.svelte.js';
	import ModalManager from '$lib/components/modals/ModalManager';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
	import {
		getVisibleTimelineVideoThumbnailSlots,
		loadTimelineVideoThumbnailPaths,
		type TimelineVideoThumbnailSlot
	} from './timelineVideoThumbnails';

	let {
		clip = $bindable(),
		track = $bindable(),
		clipIndex,
		thumbnailRangeStartMs = 0,
		thumbnailRangeEndMs = Number.POSITIVE_INFINITY
	}: {
		clip: Clip;
		track: Track;
		clipIndex: number;
		thumbnailRangeStartMs: number;
		thumbnailRangeEndMs: number;
	} = $props();

	onDestroy(() => {
		currentMenu.set(null);
		if (trimDragStartX !== null) stopTrim();
		if (clipDragStartX !== null) stopClipDragging();
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
	let trimDragStartX: number | null = $state(null);
	let trimOriginalStartTime = 0;
	let trimOriginalEndTime = 0;
	let trimOriginalSourceStartTime = 0;
	let clipDragStartX: number | null = null;
	let clipDragOriginalStartTime = 0;
	let clipDragVisualStarts: number[] | null = null;
	let timelineVideoThumbnails = $state<Array<TimelineVideoThumbnailSlot & { src: string }>>([]);
	let thumbnailRequestId = 0;
	const VIDEO_CLIP_SNAP_DISTANCE_PX = 8;

	let canTrim = $derived(
		clip instanceof AssetClip && asset.type !== AssetType.Image && !clip.loopUntilAudioEnd
	);
	let canMove = $derived(clip instanceof AssetClip && asset.type !== AssetType.Image);

	$effect(() => {
		if (globalState.settings?.defaultValuesSettings.showTimelineVideoThumbnails === false) {
			timelineVideoThumbnails = [];
			return;
		}
		// Le relâchement du trim déclenche une seule extraction avec l'offset source final.
		if (trimDragStartX !== null) return;
		if (
			!(clip instanceof AssetClip) ||
			track.type !== TrackType.Video ||
			asset.type !== AssetType.Video
		) {
			timelineVideoThumbnails = [];
			return;
		}
		const visualClipStartMs = track.getVisualClipStartTime(clipIndex);
		const slots = getVisibleTimelineVideoThumbnailSlots({
			clipStartMs: visualClipStartMs,
			clipEndMs: visualClipStartMs + clip.duration,
			sourceStartMs: clip.sourceStartTime ?? 0,
			sourceDurationMs: asset.duration.ms,
			viewportStartMs: thumbnailRangeStartMs,
			viewportEndMs: thumbnailRangeEndMs,
			zoom: track.getPixelPerSecond(),
			loop: clip.loopUntilAudioEnd
		});
		const filePath = asset.filePath;
		const mediaReloadToken = asset.mediaReloadToken;
		const requestId = ++thumbnailRequestId;
		if (slots.length === 0) {
			timelineVideoThumbnails = [];
			return;
		}

		const timeout = setTimeout(() => {
			untrack(async () => {
				try {
					const paths = await loadTimelineVideoThumbnailPaths(
						filePath,
						slots.map((slot) => slot.timestampMs),
						mediaReloadToken
					);
					if (requestId !== thumbnailRequestId) return;
					timelineVideoThumbnails = slots.flatMap((slot) => {
						const path = paths.get(slot.timestampMs);
						return path ? [{ ...slot, src: convertFileSrc(path) }] : [];
					});
				} catch (error) {
					if (requestId === thumbnailRequestId) timelineVideoThumbnails = [];
					console.error('Failed to load timeline video thumbnails:', error);
				}
			});
		}, 80);

		return () => {
			clearTimeout(timeout);
			if (requestId === thumbnailRequestId) thumbnailRequestId++;
		};
	});

	/**
	 * Accroche les bords d'un clip vidéo aux sous-titres et au clip vidéo précédent.
	 * @param {number} time Position brute du bord gauche en millisecondes.
	 * @param {number[]} edgeOffsets Décalages des bords à comparer depuis la position brute.
	 * @param {Clip | null} previousClip Clip vidéo précédent éventuel.
	 * @param {Clip | null} nextClip Clip vidéo suivant éventuel.
	 * @returns {number} Position du bord gauche, accrochée si un repère est assez proche.
	 */
	function getSnappedVideoClipTime(
		time: number,
		edgeOffsets: number[],
		previousClip: Clip | null = null,
		nextClip: Clip | null = null
	): number {
		if (track.type !== TrackType.Video) return time;
		const thresholdMs =
			(VIDEO_CLIP_SNAP_DISTANCE_PX / Math.max(track.getPixelPerSecond(), 0.0001)) * 1000;
		let snappedTime = time;
		let closestDistance = thresholdMs + 1;
		const snapPoints = (globalState.getSubtitleTrack?.clips ?? []).flatMap((subtitleClip) => [
			subtitleClip.startTime,
			subtitleClip.endTime
		]);

		for (const snapPoint of snapPoints) {
			for (const edgeOffset of edgeOffsets) {
				const candidateTime = snapPoint - edgeOffset;
				const distance = Math.abs(candidateTime - time);
				if (distance <= thresholdMs && distance < closestDistance) {
					snappedTime = candidateTime;
					closestDistance = distance;
				}
			}
		}
		if (previousClip) {
			const candidateTime = previousClip.endTime + 1;
			const distance = Math.abs(candidateTime - time);
			if (distance <= thresholdMs && distance < closestDistance) {
				snappedTime = candidateTime;
				closestDistance = distance;
			}
		}
		if (nextClip) {
			const candidateTime = nextClip.startTime - Math.max(...edgeOffsets) - 1;
			const distance = Math.abs(candidateTime - time);
			if (distance <= thresholdMs && distance < closestDistance) snappedTime = candidateTime;
		}

		return snappedTime;
	}

	/**
	 * Démarre le déplacement horizontal du clip dans sa piste.
	 * @param {MouseEvent} event Événement de souris initial.
	 * @returns {void}
	 */
	function startClipDragging(event: MouseEvent): void {
		if (
			event.button !== 0 ||
			!canMove ||
			(event.target instanceof Element && event.target.closest('button, .asset-trim-handle'))
		) {
			return;
		}
		ProjectHistoryManager.begin('move asset clip');
		clipDragVisualStarts =
			track.type === TrackType.Video &&
			track.shouldUseVideoCrossfadeVisualTiming() &&
			!track.hasExplicitVideoClipTiming()
				? track.clips.map((_, index) => track.getVisualClipStartTime(index))
				: null;
		clipDragStartX = event.clientX;
		clipDragOriginalStartTime = clipDragVisualStarts?.[clipIndex] ?? clip.startTime;
		globalState.getTimelineState.showCursor = false;
		document.addEventListener('mousemove', moveClip);
		document.addEventListener('mouseup', stopClipDragging);
	}

	/**
	 * Déplace le clip sans inverser l'ordre des clips voisins.
	 * @param {MouseEvent} event Événement de déplacement.
	 * @returns {void}
	 */
	function moveClip(event: MouseEvent): void {
		if (clipDragStartX === null) return;
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
		const rawStart = clipDragOriginalStartTime + deltaMs;
		const snappedStart = getSnappedVideoClipTime(
			rawStart,
			[0, clip.duration],
			previousClip,
			nextClip
		);
		const newStart = Math.max(minimumStart, Math.min(maximumStart, snappedStart));

		clip.startTime = newStart;
		clip.endTime = newStart + clip.duration;
	}

	/**
	 * Termine le déplacement et crée une seule entrée undo/redo.
	 * @returns {void}
	 */
	function stopClipDragging(): void {
		clipDragStartX = null;
		clipDragVisualStarts = null;
		document.removeEventListener('mousemove', moveClip);
		document.removeEventListener('mouseup', stopClipDragging);
		globalState.getTimelineState.showCursor = true;
		globalState.getTimelineState.movePreviewTo = globalState.getTimelineState.cursorPosition;
		ProjectHistoryManager.commit();
	}

	/**
	 * Démarre le trim non destructif d'un bord du clip.
	 * @param {'left' | 'right'} edge Bord manipulé.
	 * @param {MouseEvent} event Événement de souris initial.
	 * @returns {void}
	 */
	function startTrim(edge: 'left' | 'right', event: MouseEvent): void {
		if (event.button !== 0 || !canTrim) return;
		event.stopPropagation();
		ProjectHistoryManager.begin('trim asset clip');
		trimDragStartX = event.clientX;
		trimOriginalStartTime = clip.startTime;
		trimOriginalEndTime = clip.endTime;
		trimOriginalSourceStartTime = (clip as AssetClip).sourceStartTime ?? 0;
		globalState.getTimelineState.showCursor = false;
		document.addEventListener('mousemove', edge === 'left' ? trimLeft : trimRight);
		document.addEventListener('mouseup', stopTrim);
	}

	/**
	 * Applique le trim du bord gauche en conservant l'offset dans le média source.
	 * @param {MouseEvent} event Événement de déplacement.
	 * @returns {void}
	 */
	function trimLeft(event: MouseEvent): void {
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
		const rawStart = getSnappedVideoClipTime(trimOriginalStartTime + deltaMs, [0], previousClip);
		const newStart = Math.min(trimOriginalEndTime - 100, Math.max(minimumStart, rawStart));

		clip.startTime = newStart;
		clip.duration = clip.endTime - newStart;
		clip.sourceStartTime = trimOriginalSourceStartTime + (newStart - trimOriginalStartTime);
	}

	/**
	 * Applique le trim du bord droit dans les limites du média source et du clip suivant.
	 * @param {MouseEvent} event Événement de déplacement.
	 * @returns {void}
	 */
	function trimRight(event: MouseEvent): void {
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
		const rawEnd = getSnappedVideoClipTime(trimOriginalEndTime + deltaMs, [0], null, nextClip);
		const newEnd = Math.max(trimOriginalStartTime + 100, Math.min(maximumEnd, rawEnd));

		clip.endTime = newEnd;
		clip.duration = newEnd - clip.startTime;
	}

	/**
	 * Termine le trim courant et crée une seule entrée undo/redo.
	 * @returns {void}
	 */
	function stopTrim(): void {
		trimDragStartX = null;
		document.removeEventListener('mousemove', trimLeft);
		document.removeEventListener('mousemove', trimRight);
		document.removeEventListener('mouseup', stopTrim);
		globalState.getTimelineState.showCursor = true;
		globalState.getTimelineState.movePreviewTo = globalState.getTimelineState.cursorPosition;
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

	onMount(() => {
		window.addEventListener('qurancaption-release-asset-media', releaseWaveformForAsset);
		return () => {
			window.removeEventListener('qurancaption-release-asset-media', releaseWaveformForAsset);
		};
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
			const sourceStartTime = clip instanceof AssetClip ? (clip.sourceStartTime ?? 0) : 0;
			const clipDuration = clip.duration;

			untrack(async () => {
				if (wavesurfer) {
					wavesurfer.destroy();
					wavesurfer = undefined;
				}

				try {
					const peaks = await WaveformService.getPeaks(asset.filePath);
					const sourceDuration = Math.max(1, asset.duration.ms);
					const startIndex = Math.floor((sourceStartTime / sourceDuration) * peaks.length);
					const endIndex = Math.ceil(
						((sourceStartTime + clipDuration) / sourceDuration) * peaks.length
					);
					const visiblePeaks = peaks.slice(startIndex, endIndex);

					wavesurfer = WaveSurfer.create({
						container: '#clip-' + clip.id,
						waveColor: '#9d99cc',
						progressColor: '#9d99cc',
						url: file,
						peaks: [visiblePeaks], // Pass peaks to avoid decoding
						duration: clipDuration / 1000,
						height: 'auto'
					});
				} catch (e) {
					console.error('Failed to load waveform:', e);
					// Fallback to normal loading if backend fails
					wavesurfer = WaveSurfer.create({
						container: '#clip-' + clip.id,
						waveColor: '#9d99cc',
						progressColor: '#9d99cc',
						url: file,
						height: 'auto'
					});
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
	style="width: {clip.getWidth()}px; left: {positionLeft()}px;"
	onclick={handleClipClick}
	onmousedown={startClipDragging}
	oncontextmenu={(e) => {
		e.preventDefault();
		contextMenu!.show(e);
	}}
>
	{#if timelineVideoThumbnails.length > 0}
		<div class="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-[inherit]">
			{#each timelineVideoThumbnails as thumbnail (thumbnail.key)}
				<div
					class="absolute inset-y-0"
					aria-hidden="true"
					style={`left: ${thumbnail.leftPx}px; width: ${thumbnail.widthPx}px; background-image: url('${thumbnail.src}'); background-position: left center; background-repeat: repeat-x; background-size: contain;`}
				></div>
			{/each}
		</div>
	{/if}

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
		<div class="h-full w-full" id={'clip-' + clip.id}></div>
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
			class="asset-trim-handle absolute inset-y-0 left-0 z-30 w-2 cursor-ew-resize"
			onmousedown={(event) => startTrim('left', event)}
		></div>
		<div
			class="asset-trim-handle absolute inset-y-0 right-0 z-30 w-2 cursor-ew-resize"
			onmousedown={(event) => startTrim('right', event)}
		></div>
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
