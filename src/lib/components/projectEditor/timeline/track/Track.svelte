<script lang="ts">
	import {
		TrackType,
		SubtitleClip as SubtitleClipModel,
		type Track,
		type SubtitleClip as SubtitleClipType
	} from '$lib/classes';
	import type { VisualMergeMode } from '$lib/classes/Clip.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import ClipComponent from './Clip.svelte';
	import SubtitleClipComponent from './SubtitleClip.svelte';
	import CustomClipComponent from './CustomClip.svelte';
	import { SubtitleTrack } from '$lib/classes/Track.svelte';
	import { getTimelineCustomClips, type TimelineCustomClipLike } from './timelineCustomClip';
	import ContextMenu, { Item } from 'svelte-contextmenu';

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

	type QuickMergeButtonCandidate = {
		key: string;
		leftPx: number;
		subtitlesToMerge: SubtitleClipModel[];
	};

	let quickMergeContextMenu: ContextMenu | undefined = $state(undefined);
	let quickMergeContextTarget: QuickMergeButtonCandidate | null = $state(null);

	/**
	 * Liste des boutons de fusion rapide pour les clips de sous-titres.
	 * Calcul leur position et les clips à fusionner.
	 */
	let quickMergeButtons = $derived((): QuickMergeButtonCandidate[] => {
		if (track.type !== TrackType.Subtitle) {
			return [];
		}

		const subtitleTrack = track as SubtitleTrack;
		const pixelPerSecond = track.getPixelPerSecond();
		const buttons: QuickMergeButtonCandidate[] = [];

		for (let clipIndex = 0; clipIndex < subtitleTrack.clips.length - 1; clipIndex++) {
			const leftClip = subtitleTrack.clips[clipIndex];
			const rightClip = subtitleTrack.clips[clipIndex + 1];

			if (!(leftClip instanceof SubtitleClipModel) || !(rightClip instanceof SubtitleClipModel)) {
				continue;
			}

			if (
				leftClip.visualMergeGroupId &&
				rightClip.visualMergeGroupId &&
				leftClip.visualMergeGroupId === rightClip.visualMergeGroupId
			) {
				continue;
			}

			const leftGroup = subtitleTrack.getVisualMergeGroupForClipId(leftClip.id);
			const rightGroup = subtitleTrack.getVisualMergeGroupForClipId(rightClip.id);
			const rawSelection = [
				...(leftGroup?.clips ?? [leftClip]),
				...(rightGroup?.clips ?? [rightClip])
			];
			const uniqueSelection = Array.from(
				new Map(rawSelection.map((subtitle) => [subtitle.id, subtitle])).values()
			);
			const mergeSelection = subtitleTrack.getVisualMergeSelection(uniqueSelection);

			if (!mergeSelection) continue;
			if (!subtitleTrack.canUseArabicVisualMerge(mergeSelection.clips)) continue;

			buttons.push({
				key: `${leftClip.id}-${rightClip.id}`,
				leftPx: (leftClip.endTime / 1000) * pixelPerSecond - 11,
				subtitlesToMerge: mergeSelection.clips
			});
		}

		return buttons;
	});

	/**
	 * Applique un merge rapide entre clips adjacents depuis la couche portal.
	 * @param {SubtitleClipModel[]} subtitlesToMerge Clips a merger.
	 * @param {MouseEvent} event Evenement du bouton.
	 * @returns {void}
	 */
	function applyQuickMerge(subtitlesToMerge: SubtitleClipModel[], event: MouseEvent): void {
		event.preventDefault();
		event.stopPropagation();
		(track as SubtitleTrack).applyVisualMerge(subtitlesToMerge, 'both');
	}

	/**
	 * Ouvre le menu contextuel d'un bouton de quick merge.
	 * @param {MouseEvent} event Evenement de clic droit.
	 * @param {QuickMergeButtonCandidate} button Bouton cible.
	 * @returns {void}
	 */
	function openQuickMergeContextMenu(event: MouseEvent, button: QuickMergeButtonCandidate): void {
		event.preventDefault();
		event.stopPropagation();
		quickMergeContextTarget = button;
		quickMergeContextMenu?.show(event);
	}

	/**
	 * Applique un mode de merge depuis le menu contextuel du quick merge.
	 * @param {VisualMergeMode} mode Mode de merge choisi.
	 * @returns {void}
	 */
	function applyQuickMergeWithMode(mode: VisualMergeMode): void {
		if (!quickMergeContextTarget) return;
		(track as SubtitleTrack).applyVisualMerge(quickMergeContextTarget.subtitlesToMerge, mode);
		quickMergeContextTarget = null;
	}
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

	{#if track.type === TrackType.Subtitle}
		<div class="absolute left-[180px] top-0 bottom-0 right-0 z-10 pointer-events-none">
			{#each quickMergeButtons() as button (button.key)}
				<button
					class="timeline-quick-merge-button"
					style="left: {button.leftPx}px;"
					title="Quick merge those subtitles"
					aria-label="Quick merge those subtitles"
					onclick={(event) => applyQuickMerge(button.subtitlesToMerge, event)}
					oncontextmenu={(event) => openQuickMergeContextMenu(event, button)}
				>
					<span class="material-icons-outlined text-[12px]! leading-none">merge_type</span>
				</button>
			{/each}
		</div>
	{/if}
</div>

<ContextMenu bind:this={quickMergeContextMenu}>
	<Item on:click={() => applyQuickMergeWithMode('arabic')}
		><div class="btn-icon">Merge Arabic</div></Item
	>
	<Item on:click={() => applyQuickMergeWithMode('translation')}
		><div class="btn-icon">Merge Translation</div></Item
	>
	<Item on:click={() => applyQuickMergeWithMode('both')}
		><div class="btn-icon">Merge Both</div></Item
	>
</ContextMenu>

<style>
	.flex-1:hover {
		background: linear-gradient(90deg, rgba(88, 166, 255, 0.05) 0%, transparent 200px);
	}

	.timeline-quick-merge-button {
		position: absolute;
		bottom: 0px;
		pointer-events: auto;
		height: 18px;
		width: 22px;
		border-radius: 9999px 9999px 0 0;
		border: 1px solid rgba(16, 185, 129, 0.9);
		background: rgba(16, 185, 129, 0.92);
		color: #000000;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		opacity: 1;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
	}

	.timeline-quick-merge-button:hover {
		opacity: 1;
		background: rgba(5, 150, 105, 0.95);
	}
</style>
