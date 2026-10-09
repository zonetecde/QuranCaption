<script lang="ts">
	import { Duration, ProjectEditorTabs } from '$lib/classes';
	import { globalState } from '$lib/runes/main.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';

	let {
		togglePlayPause,
		overlay = false
	}: {
		togglePlayPause: () => void;
		overlay?: boolean;
	} = $props();

	let isPlaying = $derived(() => globalState.getVideoPreviewState.isPlaying);
	let previewCopy = $derived(
		$LL.editor as unknown as {
			skipBackwardTenSeconds: () => string;
			skipForwardTenSeconds: () => string;
			seekVideo: () => string;
		}
	);
	let durationMs = $derived(
		() => globalState.currentProject!.content.timeline.getLongestTrackDuration().ms
	);
	let cursorMs = $derived(() => globalState.getTimelineState.cursorPosition);

	let videoDuration = $derived(() => new Duration(durationMs()).getFormattedTime(false));

	let currentDuration = $derived(() => new Duration(cursorMs()).getFormattedTime(false, true));

	let isStyleTab = $derived(
		() => globalState.currentProject?.projectEditorState.currentTab === ProjectEditorTabs.Style
	);

	let isAlignmentGridVisible = $derived(() => globalState.getVideoPreviewState.showAlignmentGrid);

	let isPortraitVideo = $derived(() => {
		const dimensions = globalState.getStyle('global', 'video-dimension')?.value as
			| { width?: number; height?: number }
			| undefined;
		return Number(dimensions?.width) < Number(dimensions?.height);
	});

	let isTikTokOverlayVisible = $derived(() => globalState.getVideoPreviewState.showTikTokOverlay);

	/**
	 * Déplace le curseur de prévisualisation dans la durée du projet.
	 * @param {number} positionMs Position cible en millisecondes.
	 * @returns {void}
	 */
	function seekTo(positionMs: number): void {
		const position = Math.max(1, Math.min(positionMs, durationMs()));
		globalState.getTimelineState.cursorPosition = position;
		globalState.getTimelineState.movePreviewTo = position;
		globalState.getVideoPreviewState.scrollTimelineToCursor();
	}

	/**
	 * Déplace la lecture par rapport à la position actuelle.
	 * @param {number} offsetMs Décalage signé en millisecondes.
	 * @returns {void}
	 */
	function skipBy(offsetMs: number): void {
		seekTo(cursorMs() + offsetMs);
	}

	/**
	 * Laisse les boutons traiter Espace une seule fois et conserve ce raccourci sur le curseur.
	 * @param {KeyboardEvent} event Événement clavier des contrôles.
	 * @returns {void}
	 */
	function handleControlKeydown(event: KeyboardEvent): void {
		if (event.key !== ' ') return;
		event.stopPropagation();
		if (event.target instanceof HTMLInputElement) {
			event.preventDefault();
			togglePlayPause();
		}
	}
</script>

<div
	dir="ltr"
	class="w-full min-w-0 flex items-center gap-1 rounded-t-xl px-2 py-1"
	class:bg-primary={!overlay}
	class:fullscreen-overlay={overlay}
	role="group"
	aria-label={get(LL).editor.playbackControls()}
	onkeydown={handleControlKeydown}
>
	<span class="monospaced shrink-0 text-[11px] leading-none">{currentDuration()}</span>
	<button
		type="button"
		class="preview-control-btn flex shrink-0 items-center justify-center w-6 h-7 rounded-full transition-colors cursor-pointer duration-200"
		onclick={() => skipBy(-10000)}
		aria-label={previewCopy.skipBackwardTenSeconds()}
		title={previewCopy.skipBackwardTenSeconds()}
	>
		<span class="material-icons text-xl">replay_10</span>
	</button>
	<button
		type="button"
		class="preview-control-btn flex shrink-0 items-center justify-center w-6 h-7 rounded-full transition-colors cursor-pointer duration-200"
		onclick={togglePlayPause}
		aria-label={get(LL).settings.shortcutAction.PLAY_PAUSE()}
	>
		<span class="material-icons text-xl">
			{isPlaying() ? 'pause' : 'play_arrow'}
		</span>
	</button>
	<input
		type="range"
		class="preview-progress min-w-0 flex-1"
		min="1"
		max={Math.max(durationMs(), 1)}
		value={Math.min(cursorMs(), Math.max(durationMs(), 1))}
		disabled={durationMs() <= 0}
		oninput={(event) => seekTo(Number(event.currentTarget.value))}
		aria-label={previewCopy.seekVideo()}
		style={`--progress: ${durationMs() > 0 ? (Math.min(cursorMs(), durationMs()) / durationMs()) * 100 : 0}%`}
	/>
	<button
		type="button"
		class="preview-control-btn flex shrink-0 items-center justify-center w-6 h-7 rounded-full transition-colors cursor-pointer duration-200"
		onclick={() => skipBy(10000)}
		aria-label={previewCopy.skipForwardTenSeconds()}
		title={previewCopy.skipForwardTenSeconds()}
	>
		<span class="material-icons text-xl">forward_10</span>
	</button>
	<span class="monospaced shrink-0 text-[11px] leading-none">{videoDuration()}</span>

	<div class="flex shrink-0 items-center gap-x-1">
		{#if isStyleTab() && !overlay}
			<button
				type="button"
				onclick={() =>
					(globalState.getVideoPreviewState.showAlignmentGrid =
						!globalState.getVideoPreviewState.showAlignmentGrid)}
				class="preview-control-btn preview-control-btn-grid flex items-center justify-center w-6 h-7 rounded-full transition-colors cursor-pointer duration-200"
				class:active={isAlignmentGridVisible()}
				title={isAlignmentGridVisible()
					? $LL.editor.hideAlignmentGrid()
					: $LL.editor.showAlignmentGrid()}
			>
				<span class="material-icons text-xl pt-0.25">
					{isAlignmentGridVisible() ? 'grid_off' : 'grid_on'}
				</span>
			</button>
			{#if isPortraitVideo()}
				<button
					type="button"
					onclick={() =>
						(globalState.getVideoPreviewState.showTikTokOverlay =
							!globalState.getVideoPreviewState.showTikTokOverlay)}
					class="preview-control-btn preview-control-btn-grid flex items-center justify-center w-6 h-7 rounded-full transition-colors cursor-pointer duration-200"
					class:active={isTikTokOverlayVisible()}
					aria-pressed={isTikTokOverlayVisible()}
					aria-label={isTikTokOverlayVisible()
						? $LL.editor.hideTikTokOverlay()
						: $LL.editor.showTikTokOverlay()}
					title={isTikTokOverlayVisible()
						? $LL.editor.hideTikTokOverlay()
						: $LL.editor.showTikTokOverlay()}
				>
					<span class="material-icons text-xl pt-0.25">smartphone</span>
				</button>
			{/if}
		{/if}
		<button
			type="button"
			onclick={globalState.getVideoPreviewState.toggleFullScreen}
			class="preview-control-btn flex items-center justify-center w-6 h-7 rounded-full transition-colors cursor-pointer duration-200"
			aria-label={globalState.getVideoPreviewState.isFullscreen
				? get(LL).editor.exitFullscreen()
				: get(LL).editor.fullscreenMode()}
		>
			<span class="material-icons text-xl pt-0.25">
				{globalState.getVideoPreviewState.isFullscreen ? 'fullscreen_exit' : 'fullscreen'}
			</span>
		</button>
	</div>
</div>

<style>
	.fullscreen-overlay {
		border-radius: 12px;
		background: rgb(0 0 0 / 75%);
		color: white;
		padding-block: 8px;
	}

	.fullscreen-overlay .preview-control-btn {
		color: white;
	}

	.preview-control-btn {
		color: var(--text-primary);
	}

	.preview-control-btn:hover {
		background-color: var(--bg-accent);
		color: var(--text-primary);
	}

	.preview-control-btn-grid.active {
		background-color: var(--bg-accent);
		color: var(--text-primary);
	}

	.preview-progress {
		appearance: none;
		height: 14px;
		background: transparent;
		cursor: pointer;
		border: none;
	}

	.preview-progress::-webkit-slider-runnable-track {
		height: 4px;
		border-radius: 999px;
		background: linear-gradient(
			to right,
			var(--accent-primary) var(--progress),
			var(--bg-accent) var(--progress)
		);
	}

	.preview-progress::-webkit-slider-thumb {
		appearance: none;
		width: 10px;
		height: 10px;
		margin-top: -3px;
		border-radius: 50%;
		background: var(--accent-primary);
	}
</style>
