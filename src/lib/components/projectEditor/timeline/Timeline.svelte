<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { onDestroy, onMount, untrack } from 'svelte';
	import Track from './track/Track.svelte';
	import { Duration, TrackType, ProjectEditorTabs, SubtitleClip } from '$lib/classes';
	import { slide } from 'svelte/transition';
	import ShortcutService from '$lib/services/ShortcutService';

	let totalDuration = $derived(() => {
		// Récupère la fin du clip le plus loin dans la timeline
		const longestClipEnd = globalState.currentProject?.content.timeline.getLongestTrackDuration()!;

		globalState.currentProject!.detail.duration = longestClipEnd;

		if (!longestClipEnd.isNull())
			return new Duration(
				// Ajoute 2 minutes pour pas que la timeline soit au ras bord
				longestClipEnd.ms + 120000
			);
		else return new Duration(120000); // 2 minutes par défaut
	});

	let timelineState = $derived(() => globalState.currentProject?.projectEditorState.timeline!);

	let timelineDiv: HTMLDivElement | null = null;

	// Supprime les sous-titres actuellement sélectionnés dans le Style tab via Backspace
	function handleRemoveSelectedSubtitles(): void {
		const currentProject = globalState.currentProject;
		if (!currentProject) return;

		const selectedClipIds = globalState.getStylesState.selectedSubtitles.map(
			(subtitle) => subtitle.id
		);
		if (selectedClipIds.length === 0) return;

		const subtitleTrack = globalState.getSubtitleTrack;
		globalState.getStylesState.clearSelection();

		selectedClipIds.forEach((id) => subtitleTrack.removeClip(id, true));
		currentProject.detail.updateVideoDetailAttributes();
	}

	function handleSplitSubtitle(): void {
		const currentProject = globalState.currentProject;
		if (!currentProject) return;

		let clipToSplit: any = null;

		const selectedSubtitles = globalState.getStylesState.selectedSubtitles;
		if (selectedSubtitles.length === 1) {
			clipToSplit = selectedSubtitles[0];
		} else {
			const cursorPosition = globalState.getTimelineState.cursorPosition;
			const subtitleTrack = globalState.getSubtitleTrack;
			const clipUnderCursor = subtitleTrack.getCurrentClip(cursorPosition);

			if (
				clipUnderCursor &&
				(clipUnderCursor.type === 'Subtitle' || clipUnderCursor.type === 'Pre-defined Subtitle')
			) {
				clipToSplit = clipUnderCursor;
			}
		}

		if (clipToSplit && clipToSplit.type === 'Subtitle') {
			const success = globalState.getSubtitleTrack.splitSubtitle(clipToSplit.id);
			if (success) {
				currentProject.detail.updateVideoDetailAttributes();
				globalState.getStylesState.clearSelection();

				// Start editing the first subtitle
				// only if we are on the subtitles editor tab
				if (
					globalState.currentProject?.projectEditorState.currentTab ===
					ProjectEditorTabs.SubtitlesEditor
				) {
					globalState.getSubtitlesEditorState.editSubtitle = clipToSplit;
				}
			}
		}
	}

	/**
	 * Définit la fin du sous-titre actuel (sous le curseur) à la position du curseur.
	 * Si un sous-titre suivant existe, ajuste son temps de début à cursorPosition + 1.
	 */
	function handleSetSubtitleEndTime(): void {
		const subtitleTrack = globalState.getSubtitleTrack;
		const cursorPosition = globalState.getTimelineState.cursorPosition;

		// Trouve le sous-titre sous le curseur
		const currentClip = subtitleTrack.getCurrentClip(cursorPosition);

		if (currentClip) {
			// Vérifie que le curseur est dans une position valide (pas au tout début du clip)
			if (cursorPosition <= currentClip.startTime + 50) {
				return; // Curseur trop proche du début, ne rien faire
			}

			// Définit la fin du sous-titre actuel à la position du curseur
			currentClip.setEndTime(cursorPosition);

			// Trouve le sous-titre suivant et ajuste son temps de début
			const nextClip = subtitleTrack.getClipAfter(currentClip.id);
			if (nextClip) {
				nextClip.setStartTime(cursorPosition + 1);
			}

			globalState.currentProject?.detail.updateVideoDetailAttributes();
			globalState.updateVideoPreviewUI();
		} else {
			// Fallback: Si aucun clip sous le curseur, on prend le dernier sous-titre
			const lastClip = subtitleTrack.getLastClip();
			if (lastClip) {
				lastClip.setEndTime(cursorPosition);

				globalState.currentProject?.detail.updateVideoDetailAttributes();
				globalState.updateVideoPreviewUI();
			}
		}
	}

	$effect(() => {
		if (!globalState.settings) return;

		const currentTab = globalState.currentProject?.projectEditorState.currentTab;
        const ids: { [key: string]: string } = {};

		// On active le shortcut de split pour tous les onglets
        const splitShortcut = globalState.settings.shortcuts.SUBTITLES_EDITOR.SPLIT_SUBTITLE;
		ids.SPLIT_SUBTITLE = ShortcutService.registerShortcut({
			key: splitShortcut,
			onKeyDown: handleSplitSubtitle
		});

		// Le raccourci de suppression (Backspace) reste spécifique à l'onglet Style pour l'instant
		// (pour éviter de supprimer par erreur dans d'autres contextes)
		if (currentTab === ProjectEditorTabs.Style) {
            ids.REMOVE_LAST_SUBTITLE = ShortcutService.registerShortcut({
                key: globalState.settings.shortcuts.SUBTITLES_EDITOR.REMOVE_LAST_SUBTITLE,
                onKeyDown: handleRemoveSelectedSubtitles
            });
		}

		// Le raccourci M pour définir la fin du sous-titre fonctionne dans tous les tabs maintenant
        ids.SET_LAST_SUBTITLE_END = ShortcutService.registerShortcut({
			key: globalState.settings.shortcuts.SUBTITLES_EDITOR.SET_LAST_SUBTITLE_END,
			onKeyDown: handleSetSubtitleEndTime
		});

		return () => {
            ShortcutService.unregisterShortcut(splitShortcut, ids.SPLIT_SUBTITLE);
            
            if (ids.REMOVE_LAST_SUBTITLE) {
                ShortcutService.unregisterShortcut(
                    globalState.settings!.shortcuts.SUBTITLES_EDITOR.REMOVE_LAST_SUBTITLE,
                    ids.REMOVE_LAST_SUBTITLE
                );
            }

            ShortcutService.unregisterShortcut(
                globalState.settings!.shortcuts.SUBTITLES_EDITOR.SET_LAST_SUBTITLE_END,
                ids.SET_LAST_SUBTITLE_END
            );
		};
	});

	onMount(() => {
		// Restitue le scroll
		timelineDiv!.scrollLeft = timelineState().scrollX;

		// Au cas où il serait en false après un changement de taille de sous-titre
		globalState.getTimelineState.showCursor = true;

		globalState.getVideoPreviewState.scrollTimelineToCursor = scrollTimelineToCursor;
	});

	/**
	 * Scroll la timeline à la position du curseur
	 */
	function scrollTimelineToCursor() {
		if (!timelineDiv) return;
		// Calcule la position du curseur en pixels (même formule que le playhead)
		const cursorPixelPosition =
			(globalState.getTimelineState.cursorPosition / 1000) * timelineState().zoom + 180;
		// Centre le curseur dans la vue (soustrait la moitié de la largeur visible)
		const viewportWidth = timelineDiv.clientWidth;
		timelineDiv.scrollLeft = Math.max(0, cursorPixelPosition - viewportWidth / 2);
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

	// Fonction pour déterminer si on doit afficher un timestamp à cette position
	function shouldShowTimestamp(secondIndex: number, zoom: number): boolean {
		const interval = getTimestampInterval(zoom);
		return secondIndex % interval === 0;
	}

	function handleTimelineClick(event: MouseEvent) {
		const target = event.currentTarget as HTMLElement;
		if (!target) return;

		// Si l'élément est un bouton ou un élément interactif ou son parent direct, on ne fait rien
		if (
			//@ts-ignore
			event.target!.closest('.track-left-part') ||
			//@ts-ignore
			event.target.classList.contains('material-icons')
		)
			return;

		const rect = target.getBoundingClientRect();
		const clickX = event.clientX - rect.left - 180; // Soustrait la largeur du header
		const newPosition = Math.max(1, (clickX / timelineState().zoom) * 1000);

		timelineState().cursorPosition = newPosition;
		timelineState().movePreviewTo = newPosition;
	}

	function handleTimelineDrag(event: MouseEvent) {
		if (event.buttons !== 1) return; // Seulement si le bouton gauche est maintenu

		const target = event.currentTarget as HTMLElement;
		if (!target) return;

		//@ts-ignore
		if (event.target!.closest('.track-left-part')) return;

		const rect = target.getBoundingClientRect();
		const clickX = event.clientX - rect.left - 180; // Soustrait la largeur du header
		const newPosition = Math.max(1, (clickX / timelineState().zoom) * 1000);

		timelineState().cursorPosition = newPosition;
		timelineState().movePreviewTo = newPosition;
	}

	function handleRulerClick(event: MouseEvent) {
		const target = event.currentTarget as HTMLElement;
		if (!target) return;

		const rect = target.getBoundingClientRect();
		const clickX = event.clientX - rect.left - 180; // Soustrait la largeur du header
		const newPosition = Math.max(1, (clickX / timelineState().zoom) * 1000);

		timelineState().cursorPosition = newPosition;
		timelineState().movePreviewTo = newPosition;
	}

	function handleRulerDrag(event: MouseEvent) {
		if (event.buttons !== 1) return; // Seulement si le bouton gauche est maintenu

		const target = event.currentTarget as HTMLElement;
		if (!target) return;

		const rect = target.getBoundingClientRect();
		const clickX = event.clientX - rect.left - 180; // Soustrait la largeur du header
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

	function handleMouseWheelWheeling(event: any) {
		// Si la touche CTRL est enfoncée
		if (event.ctrlKey) {
			// Zoom avant ou arrière
			if (event.deltaY > 0 && timelineState().zoom > 0.2) {
				timelineState().zoom -= 0.75;
			} else if (timelineState().zoom < 100) {
				timelineState().zoom += 0.75;
			}

			if (timelineState().zoom === 10) {
				// Valeur interdite qui fait beuguer le rendu
				timelineState().zoom = 10.01;
			}
		}
	}

	onDestroy(() => {
		// Cleanup handled by effect
	});
</script>

<section
	class="overflow-hidden min-w-0 timeline-section flex-1 min-h-0"
	style="height: {100 - globalState.currentProject!.projectEditorState.upperSectionHeight}%;"
>
	<div class="timeline-container select-none" onwheel={handleMouseWheelWheeling}>
		<!-- Timeline Header -->
		<div class="timeline-ruler" onscroll={syncScroll} bind:this={timelineDiv}>
			<div
				class="ruler-content"
				style="width: {totalDuration().toSeconds() * timelineState().zoom + 180}px;"
				onclick={handleRulerClick}
				onmousemove={handleRulerDrag}
				role="button"
				tabindex="0"
			>
				<!-- Header spacer for alignment -->
				<div class="ruler-header-spacer"></div>

				<!-- Time markers -->
				{#each Array.from({ length: totalDuration().toSeconds() }, (_, i) => i) as i}
					{#if shouldShowTimestamp(i, timelineState().zoom)}
						<div
							class="time-marker"
							class:major={getTimestampInterval(timelineState().zoom) >= 10 &&
								i % (getTimestampInterval(timelineState().zoom) * 2) === 0}
							style="left: {i * timelineState().zoom + 180}px;"
						>
							<div class="time-label z-5">
								{new Duration(i * 1000).getFormattedTime(true)}
							</div>
							<div class="time-tick"></div>
						</div>
					{/if}
				{/each}

				<!-- Playhead cursor in ruler -->
				<div
					class="playhead-ruler"
					style="left: {(timelineState().cursorPosition / 1000) * timelineState().zoom +
						180}px; opacity: {timelineState().showCursor ? 1 : 0};"
				>
					<div class="playhead-handle"></div>
				</div>
			</div>
		</div>

		<!-- Timeline Tracks Area -->
		<div class="timeline-tracks" onscroll={syncScroll} id="timeline">
			<div
				class="tracks-content grid outline-none"
				style="width: {totalDuration().toSeconds() * timelineState().zoom + 180}px;"
				onclick={handleTimelineClick}
				onmousemove={handleTimelineDrag}
				role="button"
				tabindex="0"
			>
				<!-- Background grid -->
				<div class="timeline-grid">
					{#each Array.from({ length: totalDuration().toSeconds() }, (_, i) => i) as i}
						<div
							class="grid-line"
							class:major={shouldShowTimestamp(i, timelineState().zoom)}
							style="left: {i * timelineState().zoom + 180}px;"
						></div>
					{/each}
				</div>

				<!-- Track lanes -->
				<div class="track-lanes">
					{#each globalState.currentProject!.content.timeline.tracks as track, i}
						<!-- N'affiche pas la track des customs texts s'il y en a pas dans le projet -->
						{#if !(track.type === TrackType.CustomClip && track.clips.length === 0)}
							<Track bind:track={globalState.currentProject!.content.timeline.tracks[i]} />
						{/if}
					{/each}
				</div>

				<!-- Main playhead cursor -->
				<div
					class="playhead-cursor"
					id="cursor"
					style="left: {(timelineState().cursorPosition / 1000) * timelineState().zoom +
						180}px; opacity: {timelineState().showCursor ? 1 : 0};"
				></div>

				<!-- Export range overlay when in Export tab -->
				{#if globalState.currentProject!.projectEditorState.currentTab === ProjectEditorTabs.Export}
					<div
						class="export-range-overlay"
						style="left: {(globalState.getExportState.videoStartTime / 1000) *
							timelineState().zoom +
							180}px; 
							   width: {((globalState.getExportState.videoEndTime - globalState.getExportState.videoStartTime) /
							1000) *
							timelineState().zoom}px;"
					></div>
					<div
						class="export-range-border export-start"
						style="left: {(globalState.getExportState.videoStartTime / 1000) *
							timelineState().zoom +
							180}px;"
					></div>
					<div
						class="export-range-border export-end"
						style="left: {(globalState.getExportState.videoEndTime / 1000) * timelineState().zoom +
							180}px;"
					></div>
				{/if}
			</div>
		</div>
	</div>
</section>

<style>
	.timeline-container {
		display: flex;
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
		position: absolute;
		left: 0;
		top: 0;
		width: 180px;
		height: 100%;
		background: var(--timeline-ruler-bg);
		border-right: 1px solid var(--timeline-track-border);
		z-index: 5;
		pointer-events: none;
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

	.tracks-content {
		min-height: calc(100% - 4px);
		position: relative;
		cursor: crosshair;
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
</style>
