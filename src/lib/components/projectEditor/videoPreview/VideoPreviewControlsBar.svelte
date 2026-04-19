<script lang="ts">
	import { Duration, ProjectEditorTabs } from '$lib/classes';
	import { globalState } from '$lib/runes/main.svelte';
	import { goToAdjacentSubtitleFromCursor } from '$lib/services/SubtitleNavigation';

	let {
		togglePlayPause
	}: {
		togglePlayPause: () => void;
	} = $props();

	let isPlaying = $derived(() => globalState.getVideoPreviewState.isPlaying);

	let videoDuration = $derived(() =>
		globalState.currentProject!.content.timeline.getLongestTrackDuration().getFormattedTime(false)
	);

	let currentDuration = $derived(() =>
		new Duration(globalState.getTimelineState.cursorPosition).getFormattedTime(false, true)
	);

	let isStyleTab = $derived(
		() => globalState.currentProject?.projectEditorState.currentTab === ProjectEditorTabs.Style
	);

	let isAlignmentGridVisible = $derived(() => globalState.getVideoPreviewState.showAlignmentGrid);

	function goToPreviousSubtitleStart(): void {
		goToAdjacentSubtitleFromCursor('previous');
	}

	function goToNextSubtitleStart(): void {
		goToAdjacentSubtitleFromCursor('next');
	}
</script>

<div class="bg-primary h-10 w-full flex items-center justify-center relative pt-0.25 rounded-t-xl">
	<!-- Timestamp dans la vidéo -->
	<section class="absolute left-3 monospaced">
		{currentDuration()} / {videoDuration()}
	</section>

	<!-- play/pause button with material icons -->
	<section class="flex items-center gap-x-2">
		<button
			class="preview-control-btn flex items-center justify-center w-8 h-8 rounded-full transition-colors cursor-pointer duration-200"
			onclick={goToPreviousSubtitleStart}
		>
			<span class="material-icons text-xl pt-0.25">chevron_left</span>
		</button>
		<button
			class="preview-control-btn flex items-center justify-center w-8 h-8 rounded-full transition-colors cursor-pointer duration-200"
			onclick={togglePlayPause}
		>
			<span class="material-icons text-xl pt-0.25">
				{isPlaying() ? 'pause' : 'play_arrow'}
			</span>
		</button>
		<button
			class="preview-control-btn flex items-center justify-center w-8 h-8 rounded-full transition-colors cursor-pointer duration-200"
			onclick={goToNextSubtitleStart}
		>
			<span class="material-icons text-xl pt-0.25">chevron_right</span>
		</button>
	</section>

	<!-- Toggle fullscreen -->
	<section class="absolute right-3">
		<div class="flex items-center gap-x-2">
			{#if isStyleTab()}
				<button
					onclick={() =>
						(globalState.getVideoPreviewState.showAlignmentGrid =
							!globalState.getVideoPreviewState.showAlignmentGrid)}
					class="preview-control-btn preview-control-btn-grid flex items-center justify-center w-8 h-8 rounded-full transition-colors cursor-pointer duration-200"
					class:active={isAlignmentGridVisible()}
					title={isAlignmentGridVisible() ? 'Hide alignment grid' : 'Show alignment grid'}
				>
					<span class="material-icons text-xl pt-0.25">
						{isAlignmentGridVisible() ? 'grid_off' : 'grid_on'}
					</span>
				</button>
			{/if}
			<button
				onclick={globalState.getVideoPreviewState.toggleFullScreen}
				class="preview-control-btn flex items-center justify-center w-8 h-8 rounded-full transition-colors cursor-pointer duration-200"
			>
				<span class="material-icons text-xl pt-0.25">fullscreen</span>
			</button>
		</div>
	</section>
</div>

<style>
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
</style>
