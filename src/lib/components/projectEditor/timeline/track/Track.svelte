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
	import WbwSubtitleClipEditor from './WbwSubtitleClipEditor.svelte';
	import CustomClipComponent from './CustomClip.svelte';
	import { SubtitleTrack } from '$lib/classes/Track.svelte';
	import { getTimelineCustomClips, type TimelineCustomClipLike } from './timelineCustomClip';
	import ContextMenu, { Item } from 'svelte-contextmenu';
	import LL from '$lib/i18n/i18n-svelte';

	let {
		track = $bindable(),
		visibleRangeStartMs = 0,
		visibleRangeEndMs = Number.POSITIVE_INFINITY,
		canMoveUp = false,
		canMoveDown = false,
		onMoveUp = () => {},
		onMoveDown = () => {}
	}: {
		track: Track;
		visibleRangeStartMs: number;
		visibleRangeEndMs: number;
		canMoveUp?: boolean;
		canMoveDown?: boolean;
		onMoveUp?: () => void;
		onMoveDown?: () => void;
	} = $props();

	let visibleClips = $derived(() => track.getClipsInRange(visibleRangeStartMs, visibleRangeEndMs));

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
		action: 'merge' | 'split';
		leftClip: SubtitleClipModel;
		rightClip: SubtitleClipModel;
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
		const candidateIndexes = new Set<number>();

		for (const { clipIndex } of subtitleTrack.getClipsInRange(
			visibleRangeStartMs,
			visibleRangeEndMs
		)) {
			if (clipIndex > 0) candidateIndexes.add(clipIndex - 1);
			if (clipIndex < subtitleTrack.clips.length - 1) candidateIndexes.add(clipIndex);
		}

		for (const clipIndex of [...candidateIndexes].sort((a, b) => a - b)) {
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
				buttons.push({
					key: `${leftClip.id}-${rightClip.id}`,
					leftPx: (leftClip.endTime / 1000) * pixelPerSecond - 11,
					action: 'split',
					leftClip,
					rightClip,
					subtitlesToMerge: []
				});
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
				action: 'merge',
				leftClip,
				rightClip,
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
	 * Coupe le merge visuel entre deux clips adjacents depuis la couche portal.
	 * @param {SubtitleClipModel} leftClip Clip a gauche de la coupure.
	 * @param {SubtitleClipModel} rightClip Clip a droite de la coupure.
	 * @param {MouseEvent} event Evenement du bouton.
	 * @returns {void}
	 */
	function splitQuickMerge(
		leftClip: SubtitleClipModel,
		rightClip: SubtitleClipModel,
		event: MouseEvent
	): void {
		event.preventDefault();
		event.stopPropagation();
		(track as SubtitleTrack).splitVisualMergeBetween(leftClip, rightClip);
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
		if (button.action === 'split') return;
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

	/**
	 * Déplace la piste vers le haut sans propager le clic à la timeline.
	 * @param {MouseEvent} event Evenement du bouton.
	 * @returns {void}
	 */
	function handleMoveUp(event: MouseEvent): void {
		event.stopPropagation();
		onMoveUp();
	}

	/**
	 * Déplace la piste vers le bas sans propager le clic à la timeline.
	 * @param {MouseEvent} event Evenement du bouton.
	 * @returns {void}
	 */
	function handleMoveDown(event: MouseEvent): void {
		event.stopPropagation();
		onMoveDown();
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
		<div class="track-order-buttons ml-auto flex flex-col gap-0.5 opacity-0 transition-opacity">
			{#if canMoveUp}
				<button
					class="track-order-button"
					type="button"
					title={$LL.editor.moveTrackUp()}
					aria-label={$LL.editor.moveTrackUp()}
					onclick={handleMoveUp}
				>
					<span class="material-icons-outlined text-[15px]! leading-none">keyboard_arrow_up</span>
				</button>
			{/if}
			{#if canMoveDown}
				<button
					class="track-order-button"
					type="button"
					title={$LL.editor.moveTrackDown()}
					aria-label={$LL.editor.moveTrackDown()}
					onclick={handleMoveDown}
				>
					<span class="material-icons-outlined text-[15px]! leading-none">keyboard_arrow_down</span>
				</button>
			{/if}
		</div>

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
						{@const isManualWbwClip =
							globalState.shared.wbwEdit.active &&
							clip instanceof SubtitleClipModel &&
							globalState.shared.wbwEdit.clipId === clip.id}

						{#if isManualWbwClip}
							<WbwSubtitleClipEditor clip={track.clips[clipIndex] as SubtitleClipType} {track} />
						{:else}
							<SubtitleClipComponent
								bind:clip={track.clips[clipIndex] as SubtitleClipType}
								{track}
								{nextIsSameVerse}
								{previousIsSameVerse}
							/>
						{/if}
					{:else}
						<ClipComponent {clip} {track} {clipIndex} />
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
					class:timeline-quick-split-button={button.action === 'split'}
					style="left: {button.leftPx}px;"
					title={button.action === 'split'
						? $LL.editor.splitVisualMergeHere()
						: $LL.editor.quickMergeTooltip()}
					aria-label={button.action === 'split'
						? $LL.editor.splitVisualMergeHere()
						: $LL.editor.quickMergeTooltip()}
					onclick={(event) =>
						button.action === 'split'
							? splitQuickMerge(button.leftClip, button.rightClip, event)
							: applyQuickMerge(button.subtitlesToMerge, event)}
					oncontextmenu={(event) => openQuickMergeContextMenu(event, button)}
				>
					<span class="material-icons-outlined text-[12px]! leading-none"
						>{button.action === 'split' ? 'call_split' : 'merge_type'}</span
					>
				</button>
			{/each}
		</div>
	{/if}
</div>

<ContextMenu bind:this={quickMergeContextMenu}>
	<Item on:click={() => applyQuickMergeWithMode('arabic')}
		><div class="btn-icon">{$LL.editor.mergeArabic()}</div></Item
	>
	<Item on:click={() => applyQuickMergeWithMode('translation')}
		><div class="btn-icon">{$LL.editor.mergeTranslation()}</div></Item
	>
	<Item on:click={() => applyQuickMergeWithMode('both')}
		><div class="btn-icon">{$LL.editor.mergeBoth()}</div></Item
	>
</ContextMenu>

<style>
	.flex-1:hover {
		background: linear-gradient(90deg, rgba(88, 166, 255, 0.05) 0%, transparent 200px);
	}

	.track-left-part:hover .track-order-buttons {
		opacity: 1;
	}

	.track-order-button {
		display: flex;
		height: 18px;
		width: 18px;
		align-items: center;
		justify-content: center;
		border-radius: 4px;
		color: var(--text-secondary);
		background: color-mix(in srgb, var(--bg-primary) 80%, transparent);
	}

	.track-order-button:hover {
		color: var(--text-primary);
		background: var(--bg-primary);
	}

	.timeline-quick-merge-button {
		position: absolute;
		bottom: 0px;
		pointer-events: auto;
		height: 18px;
		width: 22px;
		border-radius: 9999px 9999px 0 0;
		border: 1px solid var(--timeline-subtitle-clip-border);
		background: rgb(from var(--timeline-subtitle-clip-color) r g b / 100%);
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
		background: rgb(from var(--timeline-subtitle-clip-color) r g b / 80%);
		filter: brightness(0.85);
	}

	.timeline-quick-split-button {
		background: #44296a;
		border-color: #4a3e30;
		color: #ffffff;
	}

	.timeline-quick-split-button:hover {
		background: #ea580c;
		filter: none;
	}
</style>
