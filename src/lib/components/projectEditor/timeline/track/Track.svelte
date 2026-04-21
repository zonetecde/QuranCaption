<script lang="ts">
	import {
		TrackType,
		type Track,
		type SubtitleClip as SubtitleClipType
	} from '$lib/classes';
	import { globalState } from '$lib/runes/main.svelte';
	import ClipComponent from './Clip.svelte';
	import SubtitleClipComponent from './SubtitleClip.svelte';
	import CustomClipComponent from './CustomClip.svelte';
	import { SubtitleTrack } from '$lib/classes/Track.svelte';
	import {
		getTimelineCustomClips,
		type TimelineCustomClipLike
	} from './timelineCustomClip';

	let {
		track = $bindable(),
		visibleRangeStartMs = 0,
		visibleRangeEndMs = Number.POSITIVE_INFINITY
	}: {
		track: Track;
		visibleRangeStartMs: number;
		visibleRangeEndMs: number;
	} = $props();

	let visibleClips = $derived(() =>
		track.clips
			.map((clip, clipIndex) => ({ clip, clipIndex }))
			.filter(
				({ clip }) =>
					(track.type === TrackType.CustomClip &&
						(clip as TimelineCustomClipLike).getAlwaysShow?.() === true) ||
					(clip.endTime >= visibleRangeStartMs && clip.startTime <= visibleRangeEndMs)
			)
	);

	let visibleCustomClips = $derived(() =>
		getTimelineCustomClips()
			.map((clip, clipIndex) => ({ clip, clipIndex }))
			.filter(
				({ clip }) =>
					clip.getAlwaysShow?.() === true ||
					(clip.endTime >= visibleRangeStartMs && clip.startTime <= visibleRangeEndMs)
			)
	);
</script>

<div
	class="flex-1 min-h-[75px] border-b border-[var(--timeline-track-border)] relative select-none"
	style="background: linear-gradient(90deg, var(--timeline-bg-accent) 0%, transparent 200px);"
>
	<div
		class="left-0 top-0 bottom-0 w-[180px] h-full border-r border-[var(--timeline-track-border)] flex items-center px-3 gap-2 z-20 track-left-part sticky"
		style="background: linear-gradient(135deg, var(--timeline-bg-accent) 0%, var(--timeline-bg-secondary) 100%);"
	>
		<span class="material-icons text-base opacity-80">{track.getIcon()}</span>
		<span class="text-[var(--text-secondary)] text-xs font-medium truncate">{track.getName()}</span>

		{#if track.type === TrackType.Audio}
			<div class="absolute bottom-0 right-0.5 opacity-45 hover:opacity-100 transition-opacity">
				<section class="flex items-center gap-1">
					<input
						type="checkbox"
						bind:checked={globalState.settings!.persistentUiState.showWaveforms}
						class="cursor-pointer"
						title="Show waveforms"
						id="show-waveforms-checkbox"
					/>
					<label
						class="text-xs text-[var(--text-secondary)] cursor-pointer pt-1"
						for="show-waveforms-checkbox"
					>
						<span class="material-icons">graphic_eq</span>
					</label>
				</section>
			</div>
		{/if}
	</div>
	<div class="absolute left-[180px] top-0 bottom-0 right-0 z-[5]">
		{#if track.type === TrackType.CustomClip}
			{@const total = Math.max(getTimelineCustomClips().length, 1)}
			<!-- Container relatif pour positionner chaque lane -->
			<div class="absolute inset-0">
				{#each visibleCustomClips() as { clip, clipIndex } (clip.id)}
					<div
						class="absolute left-0 right-0"
						style="top: {((total - 1 - clipIndex) * 100) / total}%; height: {100 / total}%;"
					>
						<div class="relative h-full">
							<CustomClipComponent {clip} {track} />
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<div class="flex items-center h-full px-3 gap-2">
				{#each visibleClips() as { clip, clipIndex } (clip.id)}
					{#if track.type === TrackType.Subtitle}
						{@const nextIsSameVerse =
							(track as SubtitleTrack).getSubtitleAfter(clipIndex)?.verse ===
							(clip as SubtitleClipType).verse}
						{@const previousIsSameVerse =
							(track as SubtitleTrack).getSubtitleBefore(clipIndex)?.verse ===
							(clip as SubtitleClipType).verse}

						<SubtitleClipComponent
							bind:clip={track.clips[clipIndex] as SubtitleClipType}
							{track}
							{nextIsSameVerse}
							{previousIsSameVerse}
						/>
					{:else}
						<ClipComponent {clip} {track} />
					{/if}
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.flex-1:hover {
		background: linear-gradient(90deg, rgba(88, 166, 255, 0.05) 0%, transparent 200px);
	}
</style>
