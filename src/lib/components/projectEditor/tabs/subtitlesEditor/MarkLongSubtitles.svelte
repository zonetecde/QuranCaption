<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import toast from 'svelte-5-french-toast';
	import {
		clearLongSegmentsReview,
		getLongSubtitleClips,
		markLongSegmentsForReview
	} from '$lib/services/AutoSegmentation';

	let longSegmentsMatchingThreshold = $derived(
		getLongSubtitleClips(globalState.getSubtitlesEditorState.longSegmentMinWords).length
	);
	let longSegmentsMarkedCount = $derived(
		(globalState.getSubtitleClips || []).filter((clip) => clip.needsLongReview === true).length
	);
	let hasSubtitleSegments = $derived((globalState.getSubtitleClips || []).length > 0);

	/**
	 * Marque en rose tous les segments dépassant le seuil courant.
	 */
	function handleMarkLongSegments(): void {
		const markedCount = markLongSegmentsForReview(
			globalState.getSubtitlesEditorState.longSegmentMinWords
		);
		if (markedCount <= 0) {
			toast('No long segment matches the current threshold.');
			return;
		}

		toast.success(`${markedCount} long segment${markedCount > 1 ? 's were' : ' was'} marked.`);
	}

	/**
	 * Efface tous les marquages roses de segments longs.
	 */
	function handleClearLongSegments(): void {
		clearLongSegmentsReview();
	}
</script>

{#if hasSubtitleSegments}
	<h3 class="text-sm font-medium text-secondary mb-3">Long subtitles</h3>

	<div class="bg-accent rounded-lg p-3 space-y-3">
		<div class="flex items-center justify-between gap-2">
			<div class="flex items-center gap-1.5">
				<span class="material-icons text-pink-400 text-sm">flag</span>
				<span class="text-xs text-secondary">Mark long subtitles</span>
			</div>
			<span class="text-xs font-bold text-pink-400">{longSegmentsMarkedCount} marked</span>
		</div>

		<div class="space-y-2">
			<label class="text-[11px] text-thirdly" for="long-segment-min-words"> Min words </label>
			<input
				id="long-segment-min-words"
				type="number"
				min="1"
				bind:value={globalState.getSubtitlesEditorState.longSegmentMinWords}
				class="w-full rounded-md border border-color bg-secondary px-2 py-1.5 text-sm text-primary"
			/>
			<p class="text-[10px] text-thirdly">
				{longSegmentsMatchingThreshold} segment(s) match the current threshold.
			</p>
		</div>

		<div class="grid grid-cols-3 gap-2">
			<button
				class="px-2 py-1.5 rounded-md bg-pink-500/20 border border-pink-500/40 text-pink-300 font-medium flex items-center justify-center gap-1.5 hover:bg-pink-500/30 transition cursor-pointer text-xs {longSegmentsMarkedCount <=
				0
					? 'col-span-3'
					: 'col-span-2'}"
				type="button"
				onclick={handleMarkLongSegments}
			>
				<span class="material-icons text-sm!">flag</span>
				Mark
			</button>
			{#if longSegmentsMarkedCount > 0}
				<button
					class="px-2 py-1.5 rounded-md bg-secondary border border-color text-secondary text-xs font-medium flex items-center justify-center gap-1.5 hover:bg-secondary/80 transition cursor-pointer"
					type="button"
					onclick={handleClearLongSegments}
				>
					<span class="material-icons text-sm!">cancel</span>
					Clear
				</button>
			{/if}
		</div>
	</div>
{/if}
