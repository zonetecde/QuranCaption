<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { onDestroy, onMount, tick } from 'svelte';
	import TrackComponent from './track/Track.svelte';
	import {
		Duration,
		TrackType,
		ProjectEditorTabs,
		AssetClip,
		SubtitleClip,
		PredefinedSubtitleClip,
		type Track
	} from '$lib/classes';
	import { markClipAsVerified } from '$lib/classes/Clip.svelte';
	import { getTimelineCustomClips } from './track/timelineCustomClip';
	import Settings from '$lib/classes/Settings.svelte';
	import TimelineKeyframeMarkers from './TimelineKeyframeMarkers.svelte';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
	import LL from '$lib/i18n/i18n-svelte';

	let {
		useSplitHeight = true,
		visibleTrackTypes = null,
		fitTracksToHeight = false
	}: {
		useSplitHeight?: boolean;
		visibleTrackTypes?: TrackType[] | null;
		fitTracksToHeight?: boolean;
	} = $props();

	let totalDuration = $derived(() => {
		// Récupère la fin du clip le plus loin dans la timeline
		const project = globalState.currentProject;
		const longestClipEnd = project?.content.timeline.getLongestTrackDuration() ?? new Duration(0);

		// Pas de projet ouvert (fermeture/rechargement HMR) : ne pas déréférencer null.
		if (project) project.detail.duration = longestClipEnd;

		if (!longestClipEnd.isNull())
			return new Duration(
				// Ajoute 2 minutes pour pas que la timeline soit au ras bord
				longestClipEnd.ms + 120000
			);
		else return new Duration(120000); // 2 minutes par défaut
	});

	let timelineState = $derived(
		() =>
			globalState.currentProject?.projectEditorState.timeline ?? {
				cursorPosition: 0,
				movePreviewTo: 0,
				previewRefreshToken: 0,
				zoom: 1,
				scrollX: 0,
				showCursor: true,
				wasCursorDragged: false
			}
	);

	let timelineLeftHeaderWidthPx = $derived(globalState.isAndroidPortrait ? 88 : 180);
	const OVERSCAN_MS = 120000;

	let timelineDiv: HTMLDivElement | null = null;
	let timelineTracksDiv: HTMLDivElement | null = null;
	let timelineContainerDiv: HTMLDivElement | null = null;
	let primaryTouchPointerId: number | null = null;
	let pinch: { distance: number; zoom: number; time: number } | null = null;
	let suppressTimelineClickUntil = 0;
	let tracksResizeObserver: ResizeObserver | null = null;
	let tracksViewportWidth = $state(0);
	let visibleRangeStartMs = $state(0);
	let visibleRangeEndMs = $state(0);
	let thumbnailRangeStartMs = $state(0);
	let thumbnailRangeEndMs = $state(0);
	let visibleSeconds = $derived(() => {
		const startSecond = Math.max(0, Math.floor(visibleRangeStartMs / 1000));
		const endSecond = Math.min(totalDuration().toSeconds(), Math.ceil(visibleRangeEndMs / 1000));
		const count = Math.max(0, endSecond - startSecond + 1);
		return Array.from({ length: count }, (_, index) => startSecond + index);
	});
	let orderedTrackItems = $derived(() => {
		const order = globalState.settings?.persistentUiState.timelineTrackOrder ?? [];
		return globalState
			.currentProject!.content.timeline.tracks.map((track, index) => ({ track, index }))
			.filter(
				({ track }) =>
					(!visibleTrackTypes || visibleTrackTypes.includes(track.type)) &&
					!(track.type === TrackType.CustomClip && getTimelineCustomClips().length === 0)
			)
			.sort((a, b) => {
				const aIndex = order.indexOf(a.track.type);
				const bIndex = order.indexOf(b.track.type);
				return (aIndex === -1 ? order.length : aIndex) - (bIndex === -1 ? order.length : bIndex);
			});
	});

	let lastVerifiedClipId: number | null = null;

	/**
	 * Ajuste le zoom de la timeline avec la même logique que la molette.
	 * @param {number} direction `1` pour zoom in, `-1` pour zoom out.
	 * @returns {void}
	 */
	function adjustTimelineZoom(direction: number): void {
		const currentZoom = timelineState().zoom;

		if (direction < 0 && currentZoom > 0.2) {
			timelineState().zoom = Math.max(0.2, currentZoom - 0.75);
		} else if (direction > 0 && currentZoom < 100) {
			timelineState().zoom = Math.min(100, currentZoom + 0.75);
		}

		if (timelineState().zoom === 10) {
			// Valeur interdite qui fait beuguer le rendu
			timelineState().zoom = 10.01;
		}
	}

	/**
	 * Initialise le zoom à deux doigts et annule le déplacement éventuel d'un clip.
	 * @param {TouchEvent} event Début du geste tactile.
	 * @returns {void}
	 */
	function startTimelinePinch(event: TouchEvent): void {
		if (event.touches.length !== 2 || !timelineDiv) return;
		event.preventDefault();
		if (primaryTouchPointerId !== null) {
			document.dispatchEvent(
				new PointerEvent('pointercancel', { pointerId: primaryTouchPointerId })
			);
			primaryTouchPointerId = null;
		}
		const [first, second] = event.touches;
		const distance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
		if (distance === 0) return;
		const center = (first.clientX + second.clientX) / 2 - timelineDiv.getBoundingClientRect().left;
		pinch = {
			distance,
			zoom: timelineState().zoom,
			time: (timelineDiv.scrollLeft + center - timelineLeftHeaderWidthPx) / timelineState().zoom
		};
	}

	/**
	 * Ajuste le zoom en conservant le temps situé au centre des deux doigts.
	 * @param {TouchEvent} event Mouvement des deux doigts.
	 * @returns {Promise<void>}
	 */
	async function moveTimelinePinch(event: TouchEvent): Promise<void> {
		if (!pinch || event.touches.length !== 2 || !timelineDiv || !timelineTracksDiv) return;
		event.preventDefault();
		const currentPinch = pinch;
		const [first, second] = event.touches;
		const distance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
		const zoom = Math.min(
			100,
			Math.max(0.2, (currentPinch.zoom * distance) / currentPinch.distance)
		);
		timelineState().zoom = zoom === 10 ? 10.01 : zoom;
		const center = (first.clientX + second.clientX) / 2 - timelineDiv.getBoundingClientRect().left;
		await tick();
		if (pinch !== currentPinch) return;
		timelineDiv.scrollLeft = Math.max(
			0,
			timelineLeftHeaderWidthPx + currentPinch.time * timelineState().zoom - center
		);
		timelineTracksDiv.scrollLeft = timelineDiv.scrollLeft;
		timelineState().scrollX = timelineDiv.scrollLeft;
	}

	/**
	 * Termine le pincement sans déclencher de clic sur un clip ou sur la règle.
	 * @param {TouchEvent} event Fin ou annulation du geste tactile.
	 * @returns {void}
	 */
	function endTimelinePinch(event: TouchEvent): void {
		if (event.touches.length === 2) return;
		if (pinch) suppressTimelineClickUntil = performance.now() + 500;
		pinch = null;
	}

	$effect(() => {
		if (!globalState.currentProject) return;

		const timeline = globalState.currentProject.content.timeline;
		const longestMs = timeline.getLongestTrackDurationIgnoringLoopedVideo().ms;
		const videoTrack = timeline.tracks.find((track) => track.type === TrackType.Video);
		const loopedClip = videoTrack?.clips.find(
			(clip) => clip instanceof AssetClip && clip.loopUntilAudioEnd
		);

		if (loopedClip && loopedClip.endTime !== longestMs) {
			ProjectHistoryManager.ignore(() => loopedClip.setEndTime(longestMs));
		}
	});

	onMount(() => {
		const container = timelineContainerDiv;
		container?.addEventListener('touchstart', startTimelinePinch, {
			passive: false,
			capture: true
		});
		container?.addEventListener('touchmove', moveTimelinePinch, { passive: false, capture: true });
		// Restitue le scroll
		if (timelineDiv) {
			timelineDiv.scrollLeft = timelineState().scrollX;
		}
		if (timelineTracksDiv) {
			timelineTracksDiv.scrollLeft = timelineState().scrollX;
			tracksViewportWidth = timelineTracksDiv.clientWidth;

			tracksResizeObserver = new ResizeObserver((entries) => {
				const [entry] = entries;
				if (!entry) return;
				tracksViewportWidth = entry.contentRect.width;
			});
			tracksResizeObserver.observe(timelineTracksDiv);
		}

		// Au cas où il serait en false après un changement de taille de sous-titre
		globalState.getTimelineState.showCursor = true;

		globalState.getVideoPreviewState.scrollTimelineToCursor = scrollTimelineToCursor;

		return () => {
			container?.removeEventListener('touchstart', startTimelinePinch, true);
			container?.removeEventListener('touchmove', moveTimelinePinch, true);
			tracksResizeObserver?.disconnect();
			tracksResizeObserver = null;
		};
	});

	$effect(() => {
		const scrollX = timelineState().scrollX;
		const safeZoom = Math.max(timelineState().zoom, 0.0001);
		const viewportWidthPx = tracksViewportWidth;
		const totalDurationMs = totalDuration().ms;

		const viewportStartMs = Math.max(0, ((scrollX - timelineLeftHeaderWidthPx) / safeZoom) * 1000);
		const viewportEndMs = Math.max(
			viewportStartMs,
			((scrollX + viewportWidthPx - timelineLeftHeaderWidthPx) / safeZoom) * 1000
		);

		thumbnailRangeStartMs = viewportStartMs;
		thumbnailRangeEndMs = Math.min(totalDurationMs, viewportEndMs);
		visibleRangeStartMs = Math.max(0, viewportStartMs - OVERSCAN_MS);
		visibleRangeEndMs = Math.min(totalDurationMs, viewportEndMs + OVERSCAN_MS);
	});

	$effect(() => {
		const cursorPosition = timelineState().cursorPosition;
		const clipUnderCursor = globalState.getSubtitleTrack?.getCurrentClip(cursorPosition);

		if (
			!(
				clipUnderCursor instanceof SubtitleClip || clipUnderCursor instanceof PredefinedSubtitleClip
			)
		) {
			lastVerifiedClipId = null;
			return;
		}

		lastVerifiedClipId = clipUnderCursor.id;
		markClipAsVerified(clipUnderCursor);
	});

	/**
	 * Scroll la timeline a la position du curseur
	 */
	function scrollTimelineToCursor() {
		if (!timelineDiv) return;
		// Calcule la position du curseur en pixels (même formule que le playhead)
		const cursorPixelPosition =
			(globalState.getTimelineState.cursorPosition / 1000) * timelineState().zoom +
			timelineLeftHeaderWidthPx;
		// Place le curseur légèrement à droite du centre de la zone visible des pistes.
		const viewportWidth = timelineDiv.clientWidth;
		const visiblePlayheadPosition =
			timelineLeftHeaderWidthPx + (viewportWidth - timelineLeftHeaderWidthPx) * 0.35;
		timelineDiv.scrollLeft = Math.max(0, cursorPixelPosition - visiblePlayheadPosition);
	}

	// Fonction pour déterminer l'intervalle d'affichage des timestamps selon le zoom
	function getTimestampInterval(zoom: number): number {
		if (zoom >= 50) return 1; // Chaque seconde
		if (zoom >= 30) return 2; // Toutes les 2 secondes
		if (zoom >= 20) return 5; // Toutes les 5 secondes
		if (zoom >= 10) return 10; // Toutes les 10 secondes
		if (zoom >= 5) return 15; // Toutes les 15 secondes
		if (zoom >= 2) return 30; // Toutes les 30 secondes
		return 60; // Chaque minute
	}

	// Fonction pour determiner si on doit afficher un timestamp a cette position
	function shouldShowTimestamp(secondIndex: number, zoom: number): boolean {
		const interval = getTimestampInterval(zoom);
		return secondIndex % interval === 0;
	}

	function handleTimelineClick(event: MouseEvent) {
		const target = event.currentTarget as HTMLElement;
		if (!target) return;

		// Si l'élément est un bouton ou un élément interactif ou son parent direct, on ne fait rien
		const eventTarget = event.target;
		if (!(eventTarget instanceof Element)) return;
		if (
			eventTarget.closest('.track-left-part') ||
			(eventTarget instanceof HTMLElement && eventTarget.classList.contains('material-icons'))
		)
			return;

		const rect = target.getBoundingClientRect();
		const clickX = event.clientX - rect.left - timelineLeftHeaderWidthPx; // Soustrait la largeur du header
		const newPosition = Math.max(1, (clickX / timelineState().zoom) * 1000);

		timelineState().cursorPosition = newPosition;
		timelineState().movePreviewTo = newPosition;

		globalState.getTimelineState.wasCursorDragged = false;
	}

	function handleTimelineDrag(event: MouseEvent) {
		if (event.buttons !== 1) return; // Seulement si le bouton gauche est maintenu
		globalState.getTimelineState.wasCursorDragged = true;

		const target = event.currentTarget as HTMLElement;
		if (!target) return;

		const eventTarget = event.target;
		if (eventTarget instanceof Element && eventTarget.closest('.track-left-part')) return;

		const rect = target.getBoundingClientRect();
		const clickX = event.clientX - rect.left - timelineLeftHeaderWidthPx; // Soustrait la largeur du header
		const newPosition = Math.max(1, (clickX / timelineState().zoom) * 1000);

		timelineState().cursorPosition = newPosition;
		timelineState().movePreviewTo = newPosition;
	}

	function handleRulerClick(event: MouseEvent) {
		const target = event.currentTarget as HTMLElement;
		if (!target) return;

		const rect = target.getBoundingClientRect();
		const clickX = event.clientX - rect.left - timelineLeftHeaderWidthPx; // Soustrait la largeur du header
		const newPosition = Math.max(1, (clickX / timelineState().zoom) * 1000);

		timelineState().cursorPosition = newPosition;
		timelineState().movePreviewTo = newPosition;

		globalState.getTimelineState.wasCursorDragged = false;
	}

	function handleRulerDrag(event: MouseEvent) {
		if (event.buttons !== 1) return; // Seulement si le bouton gauche est maintenu
		globalState.getTimelineState.wasCursorDragged = true;

		const target = event.currentTarget as HTMLElement;
		if (!target) return;

		const rect = target.getBoundingClientRect();
		const clickX = event.clientX - rect.left - timelineLeftHeaderWidthPx; // Soustrait la largeur du header
		const newPosition = Math.max(1, (clickX / timelineState().zoom) * 1000);

		timelineState().cursorPosition = newPosition;
		timelineState().movePreviewTo = newPosition;
	}

	// Synchronise le scroll entre la règle et les pistes
	function syncScroll(event: Event) {
		const source = event.target as HTMLElement;
		const isRuler = source.classList.contains('timeline-ruler');
		const isTrack = source.classList.contains('timeline-tracks');

		if (isRuler) {
			const tracks = source.parentElement?.querySelector('.timeline-tracks') as HTMLElement;
			if (tracks) tracks.scrollLeft = source.scrollLeft;
		} else if (isTrack) {
			const ruler = source.parentElement?.querySelector('.timeline-ruler') as HTMLElement;
			if (ruler) ruler.scrollLeft = source.scrollLeft;
		}

		// Sauvegarde le scroll dans les paramètres de la timeline
		timelineState().scrollX = source.scrollLeft;
	}

	/**
	 * Déplace une piste dans l'ordre d'affichage global de la timeline.
	 * @param {Track} track Piste à déplacer.
	 * @param {number} direction Direction du déplacement (`-1` vers le haut, `1` vers le bas).
	 * @returns {Promise<void>}
	 */
	async function moveTimelineTrack(track: Track, direction: number): Promise<void> {
		const settings = globalState.settings;
		if (!settings) return;

		const visibleTracks = orderedTrackItems();
		const displayIndex = visibleTracks.findIndex((item) => item.track === track);
		const swapTarget = visibleTracks[displayIndex + direction]?.track;
		if (!swapTarget) return;

		const allTypes = globalState.currentProject!.content.timeline.tracks.map((item) => item.type);
		const savedOrder = settings.persistentUiState.timelineTrackOrder.filter((type) =>
			allTypes.includes(type)
		);
		const order = [...savedOrder, ...allTypes.filter((type) => !savedOrder.includes(type))];
		const trackIndex = order.indexOf(track.type);
		const targetIndex = order.indexOf(swapTarget.type);
		if (trackIndex === -1 || targetIndex === -1) return;

		[order[trackIndex], order[targetIndex]] = [order[targetIndex], order[trackIndex]];
		settings.persistentUiState.timelineTrackOrder = order;
		await Settings.save();
	}

	onDestroy(() => {
		tracksResizeObserver?.disconnect();
		tracksResizeObserver = null;
	});
</script>

<section
	dir="ltr"
	class="overflow-hidden min-w-0 timeline-section flex-1 min-h-0"
	style={useSplitHeight
		? `height: ${
				100 - globalState.settings!.persistentUiState.projectEditorLayout.upperSectionHeight
			}%;`
		: ''}
>
	<div
		class="timeline-container select-none"
		bind:this={timelineContainerDiv}
		onpointerdowncapture={(event) => {
			if (event.pointerType === 'touch' && event.isPrimary) primaryTouchPointerId = event.pointerId;
		}}
		ontouchend={endTimelinePinch}
		ontouchcancel={endTimelinePinch}
		onclickcapture={(event) => {
			if (pinch || performance.now() < suppressTimelineClickUntil) {
				event.preventDefault();
				event.stopPropagation();
			}
		}}
	>
		<!-- Timeline Header -->
		<div class="timeline-ruler" onscroll={syncScroll} bind:this={timelineDiv}>
			<div
				class="ruler-content"
				style="width: {totalDuration().toSeconds() * timelineState().zoom +
					timelineLeftHeaderWidthPx}px;"
				onclick={handleRulerClick}
				onmousemove={handleRulerDrag}
				role="button"
				tabindex="0"
			>
				<!-- Header spacer for alignment -->
				<div class="ruler-header-spacer" style="width: {timelineLeftHeaderWidthPx}px;">
					<div class="ruler-zoom-controls">
						<button
							class="ruler-zoom-button"
							type="button"
							title={$LL.editor.zoomOut()}
							aria-label={$LL.editor.zoomOut()}
							onclick={(event) => {
								event.stopPropagation();
								adjustTimelineZoom(-1);
							}}
						>
							<span class="material-icons-outlined text-[18px]!">zoom_out</span>
						</button>
						<button
							class="ruler-zoom-button"
							type="button"
							title={$LL.editor.zoomIn()}
							aria-label={$LL.editor.zoomIn()}
							onclick={(event) => {
								event.stopPropagation();
								adjustTimelineZoom(1);
							}}
						>
							<span class="material-icons-outlined text-[18px]!">zoom_in</span>
						</button>
					</div>
				</div>

				<!-- Time markers -->
				{#each visibleSeconds() as i (i)}
					{#if shouldShowTimestamp(i, timelineState().zoom)}
						<div
							class="time-marker"
							class:major={getTimestampInterval(timelineState().zoom) >= 10 &&
								i % (getTimestampInterval(timelineState().zoom) * 2) === 0}
							style="left: {i * timelineState().zoom + timelineLeftHeaderWidthPx}px;"
						>
							<div class="time-label z-5">
								{new Duration(i * 1000).getFormattedTime(true)}
							</div>
							<div class="time-tick"></div>
						</div>
					{/if}
				{/each}

				<TimelineKeyframeMarkers
					times={globalState.getAllStyleKeyframeTimes()}
					zoom={timelineState().zoom}
					offset={timelineLeftHeaderWidthPx}
				/>

				<!-- Playhead cursor in ruler -->
				<div
					class="playhead-ruler"
					style="left: {(timelineState().cursorPosition / 1000) * timelineState().zoom +
						timelineLeftHeaderWidthPx}px; opacity: {timelineState().showCursor ? 1 : 0};"
				>
					<div class="playhead-handle"></div>
				</div>
			</div>
		</div>

		<!-- Timeline Tracks Area -->
		<div
			class="timeline-tracks"
			class:fit-tracks-to-height={fitTracksToHeight}
			onscroll={syncScroll}
			id="timeline"
			bind:this={timelineTracksDiv}
		>
			<div
				class="tracks-content grid outline-none"
				class:fit-tracks-to-height={fitTracksToHeight}
				style="width: {totalDuration().toSeconds() * timelineState().zoom +
					timelineLeftHeaderWidthPx}px;"
				onclick={handleTimelineClick}
				onmousemove={handleTimelineDrag}
				role="button"
				tabindex="0"
			>
				<!-- Background grid -->
				<div class="timeline-grid">
					{#each visibleSeconds() as i (i)}
						<div
							class="grid-line"
							class:major={shouldShowTimestamp(i, timelineState().zoom)}
							style="left: {i * timelineState().zoom + timelineLeftHeaderWidthPx}px;"
						></div>
					{/each}
				</div>

				<!-- Track lanes -->
				<div class="track-lanes" class:fit-tracks-to-height={fitTracksToHeight}>
					{#each orderedTrackItems() as { track, index }, displayIndex (track.type)}
						<TrackComponent
							bind:track={globalState.currentProject!.content.timeline.tracks[index]}
							{visibleRangeStartMs}
							{visibleRangeEndMs}
							fitAvailableHeight={fitTracksToHeight}
							{thumbnailRangeStartMs}
							{thumbnailRangeEndMs}
							canMoveUp={displayIndex > 0}
							canMoveDown={displayIndex < orderedTrackItems().length - 1}
							onMoveUp={() => void moveTimelineTrack(track, -1)}
							onMoveDown={() => void moveTimelineTrack(track, 1)}
						/>
					{/each}
				</div>

				<!-- Main playhead cursor -->
				<div
					class="playhead-cursor"
					id="cursor"
					style="left: {(timelineState().cursorPosition / 1000) * timelineState().zoom +
						timelineLeftHeaderWidthPx}px; opacity: {timelineState().showCursor ? 1 : 0};"
				></div>

				<!-- Export range overlay when in Export tab -->
				{#if globalState.currentProject!.projectEditorState.currentTab === ProjectEditorTabs.Export}
					<div
						class="export-range-overlay"
						style="left: {(globalState.getExportState.videoStartTime / 1000) *
							timelineState().zoom +
							timelineLeftHeaderWidthPx}px; 
							   width: {((globalState.getExportState.videoEndTime - globalState.getExportState.videoStartTime) /
							1000) *
							timelineState().zoom}px;"
					></div>
					<div
						class="export-range-border export-start"
						style="left: {(globalState.getExportState.videoStartTime / 1000) *
							timelineState().zoom +
							timelineLeftHeaderWidthPx}px;"
					></div>
					<div
						class="export-range-border export-end"
						style="left: {(globalState.getExportState.videoEndTime / 1000) * timelineState().zoom +
							timelineLeftHeaderWidthPx}px;"
					></div>
					{#each globalState.getExportState.skipRanges ?? [] as range (range)}
						<div
							class="skip-range-overlay"
							style="left: {(range.startTime / 1000) * timelineState().zoom +
								timelineLeftHeaderWidthPx}px;
								width: {(Math.max(0, range.endTime - range.startTime) / 1000) * timelineState().zoom}px;"
						></div>
						<div
							class="skip-range-border skip-start"
							style="left: {(range.startTime / 1000) * timelineState().zoom +
								timelineLeftHeaderWidthPx}px;"
						></div>
						<div
							class="skip-range-border skip-end"
							style="left: {(range.endTime / 1000) * timelineState().zoom +
								timelineLeftHeaderWidthPx}px;"
						></div>
					{/each}
				{/if}
			</div>
		</div>
	</div>
</section>

<style>
	.timeline-container {
		display: flex;
		touch-action: pan-x pan-y;
		flex-direction: column;
		height: 100%;
		background: var(--timeline-bg-primary);
		border-top: 1px solid var(--border-color);
		position: relative;
	}

	/* Timeline Ruler */
	.timeline-ruler {
		height: 20px;
		background: var(--timeline-ruler-bg);
		border-bottom: 1px solid var(--timeline-track-border);
		overflow-x: auto;
		overflow-y: hidden;
		position: relative;
		z-index: 10;
	}

	.ruler-content {
		height: 100%;
		position: relative;
		min-width: 100%;
		cursor: crosshair;
	}

	.ruler-header-spacer {
		position: sticky;
		left: 0;
		top: 0;
		height: 100%;
		background: var(--timeline-ruler-bg);
		border-right: 1px solid var(--timeline-track-border);
		z-index: 30;
		pointer-events: auto;
	}

	.ruler-zoom-controls {
		position: absolute;
		left: 4px;
		top: 50%;
		transform: translateY(-50%);
		display: flex;
		gap: 2px;
		z-index: 6;
	}

	.ruler-zoom-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--text-secondary);
		transition:
			color 0.15s ease,
			background-color 0.15s ease,
			border-color 0.15s ease;
	}

	.ruler-zoom-button:hover {
		color: var(--text-primary);
		background: var(--bg-primary);
		border-color: var(--accent);
	}

	.ruler-zoom-button:active {
		transform: translateY(1px);
	}

	.time-marker {
		position: absolute;
		top: 0;
		height: 100%;
		pointer-events: none;
	}

	.time-label {
		position: absolute;
		top: 2px;
		left: 0;
		transform: translateX(-50%);
		font-size: 10px;
		font-weight: 500;
		color: var(--timeline-timestamp);
		font-family: 'JetBrains Mono', 'SF Mono', 'Monaco', 'Cascadia Code', monospace;
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
		white-space: nowrap;
	}

	.time-marker.major .time-label {
		color: var(--timeline-timestamp-major);
		font-weight: 600;
		font-size: 11px;
	}

	.time-tick {
		position: absolute;
		bottom: 0;
		left: 0;
		width: 1px;
		height: 8px;
		background: var(--timeline-grid-minor);
		transform: translateX(-50%);
	}

	.time-marker.major .time-tick {
		height: 12px;
		width: 2px;
		background: var(--timeline-grid-major);
		box-shadow: 0 0 4px rgba(88, 166, 255, 0.3);
	}

	/* Playhead in ruler */
	.playhead-ruler {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		background: var(--timeline-cursor);
		box-shadow: 0 0 8px var(--timeline-cursor-shadow);
		z-index: 20;
		pointer-events: none;
	}

	.playhead-handle {
		position: absolute;
		top: -2px;
		left: -6px;
		width: 14px;
		height: 8px;
		background: var(--timeline-cursor);
		clip-path: polygon(0 0, 100% 0, 50% 100%);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
	}

	/* Timeline Tracks */
	.timeline-tracks {
		flex: 1;
		overflow-x: auto;
		overflow-y: auto;
		background: var(--timeline-bg-secondary);
	}

	.timeline-tracks.fit-tracks-to-height {
		scrollbar-width: none;
	}

	.timeline-tracks.fit-tracks-to-height::-webkit-scrollbar {
		display: none;
	}

	.tracks-content {
		min-height: calc(100% - 4px);
		position: relative;
		cursor: crosshair;
	}

	.tracks-content.fit-tracks-to-height {
		height: 100%;
	}

	/* Timeline Grid */
	.timeline-grid {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		pointer-events: none;
	}

	.grid-line {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: var(--timeline-grid-minor);
		opacity: 0.5;
	}

	.grid-line.major {
		width: 1px;
		background: var(--timeline-grid-major);
		opacity: 0.8;
	}
	/* Track Lanes */
	.track-lanes {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
	}

	.track-lanes.fit-tracks-to-height {
		height: 100%;
		min-height: 0;
	}

	/* Main Playhead Cursor */
	.playhead-cursor {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		background: var(--timeline-cursor);
		box-shadow:
			0 0 8px var(--timeline-cursor-shadow),
			0 0 16px rgba(248, 81, 73, 0.2);
		z-index: 100;
		pointer-events: none;
	}

	.playhead-cursor::before {
		content: '';
		position: absolute;
		bottom: -4px;
		left: -6px;
		width: 14px;
		height: 8px;
		background: var(--timeline-cursor);
		clip-path: polygon(50% 0, 0 100%, 100% 100%);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
	}

	/* Synchronize scroll between ruler and tracks */
	.timeline-ruler::-webkit-scrollbar {
		display: none;
	}

	/* Export Range Visualization */
	.export-range-overlay {
		position: absolute;
		top: 0;
		bottom: 0;
		background: rgba(34, 197, 94, 0.3);
		border: 1px solid rgba(34, 197, 94, 0.4);
		border-radius: 4px;
		z-index: 0;
		pointer-events: none;
	}

	.export-range-border {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 3px;
		background: #22c55e;
		z-index: 0;
		pointer-events: none;
		box-shadow: 0 0 8px rgba(34, 197, 94, 0.5);
	}

	.export-range-border.export-start {
		border-radius: 3px 0 0 3px;
	}

	.export-range-border.export-end {
		border-radius: 0 3px 3px 0;
		margin-left: -3px;
	}

	.export-range-border::after {
		content: '';
		position: absolute;
		top: -6px;
		left: -3px;
		width: 9px;
		height: 12px;
		background: #22c55e;
		clip-path: polygon(0 0, 100% 0, 50% 100%);
		box-shadow: 0 2px 6px rgba(34, 197, 94, 0.4);
	}

	.skip-range-overlay {
		position: absolute;
		top: 0;
		bottom: 0;
		background: rgba(168, 85, 247, 0.28);
		border: 1px solid rgba(168, 85, 247, 0.55);
		border-radius: 4px;
		z-index: 1;
		pointer-events: none;
	}

	.skip-range-border {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 3px;
		background: #a855f7;
		z-index: 1;
		pointer-events: none;
		box-shadow: 0 0 8px rgba(168, 85, 247, 0.65);
	}

	.skip-range-border.skip-end {
		margin-left: -3px;
	}

	.skip-range-border::after {
		content: '';
		position: absolute;
		top: -6px;
		left: -3px;
		width: 9px;
		height: 12px;
		background: #a855f7;
		clip-path: polygon(0 0, 100% 0, 50% 100%);
		box-shadow: 0 2px 6px rgba(168, 85, 247, 0.5);
	}
</style>
