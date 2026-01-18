<script lang="ts">
	import { Duration, PredefinedSubtitleClip, SubtitleClip } from '$lib/classes';
	import { globalState } from '$lib/runes/main.svelte';
	import { invoke } from '@tauri-apps/api/core';

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

	function getSubtitlePreviewStart(clip: SubtitleClip | PredefinedSubtitleClip): number {
		const fadeDuration = globalState.getStyle('global', 'fade-duration').value as number;
		const targetTime = clip.startTime + fadeDuration;
		return Math.min(clip.endTime, Math.max(1, targetTime));
	}

	/**
	 * Navigate to the start of the previous or next subtitle clip.
	 * @param direction - 'previous' to go to the previous subtitle, 'next' to go to the next subtitle.
	 */
	function goToSubtitleStart(direction: 'previous' | 'next'): void {
		const subtitleTrack = globalState.getSubtitleTrack;
		const cursorPosition = globalState.getTimelineState.cursorPosition;
		if (!subtitleTrack || subtitleTrack.clips.length === 0) return;

		const clipUnderCursor = subtitleTrack.getCurrentClip(cursorPosition);
		let targetClip: SubtitleClip | PredefinedSubtitleClip | null = null;

		if (clipUnderCursor) {
			const currentIndex = subtitleTrack.clips.indexOf(clipUnderCursor);
			targetClip =
				direction === 'previous'
					? subtitleTrack.getSubtitleBefore(currentIndex)
					: subtitleTrack.getSubtitleAfter(currentIndex);
		} else {
			const isPrevious = direction === 'previous';
			const startIndex = isPrevious ? subtitleTrack.clips.length - 1 : 0;
			const step = isPrevious ? -1 : 1;
			const compare = isPrevious
				? (clipStart: number) => clipStart < cursorPosition
				: (clipStart: number) => clipStart > cursorPosition;

			for (let i = startIndex; i >= 0 && i < subtitleTrack.clips.length; i += step) {
				const clip = subtitleTrack.clips[i];
				if (
					(clip instanceof SubtitleClip || clip instanceof PredefinedSubtitleClip) &&
					compare(clip.startTime)
				) {
					targetClip = clip as SubtitleClip | PredefinedSubtitleClip;
					break;
				}
			}
		}

		if (!targetClip) return;
		const previewStart = getSubtitlePreviewStart(targetClip);
		globalState.getTimelineState.cursorPosition = previewStart;
		globalState.getTimelineState.movePreviewTo = previewStart;
	}

	function goToPreviousSubtitleStart(): void {
		goToSubtitleStart('previous');
	}

	function goToNextSubtitleStart(): void {
		goToSubtitleStart('next');
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
			class="flex items-center justify-center w-8 h-8 text-white hover:bg-gray-700 rounded-full transition-colors cursor-pointer duration-200"
			onclick={goToPreviousSubtitleStart}
		>
			<span class="material-icons text-xl pt-0.25">chevron_left</span>
		</button>
		<button
			class="flex items-center justify-center w-8 h-8 text-white hover:bg-gray-700 rounded-full transition-colors cursor-pointer duration-200"
			onclick={togglePlayPause}
		>
			<span class="material-icons text-xl pt-0.25">
				{isPlaying() ? 'pause' : 'play_arrow'}
			</span>
		</button>
		<button
			class="flex items-center justify-center w-8 h-8 text-white hover:bg-gray-700 rounded-full transition-colors cursor-pointer duration-200"
			onclick={goToNextSubtitleStart}
		>
			<span class="material-icons text-xl pt-0.25">chevron_right</span>
		</button>
	</section>

	<!-- Toggle fullscreen -->
	<section class="absolute right-3">
		<div class="flex items-center gap-x-2">
			<p class="text-thirdly">Press F11 to toggle fullscreen</p>
			<button
				onclick={globalState.getVideoPreviewState.toggleFullScreen}
				class="flex items-center justify-center w-8 h-8 text-white hover:bg-gray-700 rounded-full transition-colors cursor-pointer duration-200"
			>
				<span class="material-icons text-xl pt-0.25">fullscreen</span>
			</button>
		</div>
	</section>
</div>
