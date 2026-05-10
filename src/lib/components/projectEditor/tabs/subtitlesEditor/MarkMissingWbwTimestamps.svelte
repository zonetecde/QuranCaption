<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import toast from 'svelte-5-french-toast';
	import {
		clearWbwTimestampReview,
		getSubtitleClipsWithoutWbwTimestamps,
		markSubtitlesWithoutWbwTimestampsForReview
	} from '$lib/services/AutoSegmentation';

	let missingWbwSegmentsCount = $derived(getSubtitleClipsWithoutWbwTimestamps().length);
	let missingWbwSegmentsMarkedCount = $derived(
		(globalState.getSubtitleClips || []).filter((clip) => clip.needsWbwTimestampReview === true)
			.length
	);
	let hasSubtitleSegments = $derived((globalState.getSubtitleClips || []).length > 0);

	/**
	 * Marque en bleu clair tous les segments qui n'ont pas de timestamps WBW.
	 */
	function handleMarkMissingWbwTimestamps(): void {
		const markedCount = markSubtitlesWithoutWbwTimestampsForReview();
		if (markedCount <= 0) {
			toast('No subtitle is missing WBW timestamps.');
			return;
		}

		toast.success(
			`${markedCount} subtitle${markedCount > 1 ? 's were' : ' was'} marked for missing WBW timestamps.`
		);
	}

	/**
	 * Efface tous les marquages bleus liés aux timestamps WBW manquants.
	 */
	function handleClearMissingWbwTimestamps(): void {
		clearWbwTimestampReview();
	}
</script>

{#if hasSubtitleSegments}
	<h3 class="text-sm font-medium text-secondary mb-3">Missing WBW timestamps</h3>

	<div class="rounded-lg border border-sky-400/25 bg-sky-500/10 p-3 space-y-3">
		<div class="flex items-center justify-between gap-2">
			<div class="flex items-center gap-1.5">
				<span class="material-icons text-sky-300 text-sm">flag</span>
				<span class="text-xs text-secondary">Mark subtitles without WBW timestamps</span>
			</div>
			<span class="text-xs font-bold text-sky-300">{missingWbwSegmentsMarkedCount} marked</span>
		</div>

		<div class="space-y-2">
			<p class="text-[11px] text-thirdly">
				{missingWbwSegmentsCount} subtitle(s) are missing word-by-word timestamps.
				<span
					class="material-icons align-middle text-[16px]! text-thirdly cursor-help"
					title="Optional feature. Add WBW timestamps to enable word highlighting, fast verse division, and other advanced features. You can also fetch them automatically via AI Segmentation (enable 'Include word-by-word timestamps')."
				>
					help_outline
				</span>
			</p>
		</div>

		<div class="grid grid-cols-3 gap-2">
			<button
				class="px-2 py-1.5 rounded-md bg-sky-500/20 border border-sky-400/40 text-sky-200 font-medium flex items-center justify-center gap-1.5 hover:bg-sky-500/30 transition cursor-pointer text-xs {missingWbwSegmentsMarkedCount <=
				0
					? 'col-span-3'
					: 'col-span-2'}"
				type="button"
				onclick={handleMarkMissingWbwTimestamps}
			>
				<span class="material-icons text-sm!">flag</span>
				Mark
			</button>
			{#if missingWbwSegmentsMarkedCount > 0}
				<button
					class="px-2 py-1.5 rounded-md bg-secondary border border-color text-secondary text-xs font-medium flex items-center justify-center gap-1.5 hover:bg-secondary/80 transition cursor-pointer"
					type="button"
					onclick={handleClearMissingWbwTimestamps}
				>
					<span class="material-icons text-sm!">cancel</span>
					Clear
				</button>
			{/if}
		</div>
	</div>
{/if}
