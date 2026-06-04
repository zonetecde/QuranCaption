<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import toast from 'svelte-5-french-toast';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
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
			toast(get(LL).editor.noMissingWbw());
			return;
		}

		toast.success(
			get(LL).editor.missingWbwMarked({ count: markedCount, plural: markedCount > 1 ? 's were' : ' was' })
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
	<h3 class="text-sm font-medium text-secondary mb-3">{$LL.editor.markMissingWbw()}</h3>

	<div class="rounded-lg border border-sky-400/25 bg-sky-500/10 p-3 space-y-3">
		<div class="flex items-center justify-between gap-2">
			<div class="flex items-center gap-1.5">
				<span class="material-icons text-sky-300 text-sm">flag</span>
				<span class="text-xs text-secondary">{$LL.editor.markMissingWbw()}</span>
			</div>
			<span class="text-xs font-bold text-sky-300">{get(LL).editor.markedCount({ count: missingWbwSegmentsMarkedCount })}</span>
		</div>

		<div class="space-y-2">
			<p class="text-[11px] text-thirdly">
				{$LL.editor.wbwTimestampsMissing({ count: missingWbwSegmentsCount })}
				<span
					class="material-icons align-middle text-[16px]! text-thirdly cursor-help"
					title={$LL.editor.wbwFeatureInfo()}
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
				{$LL.editor.mark()}
			</button>
			{#if missingWbwSegmentsMarkedCount > 0}
				<button
					class="px-2 py-1.5 rounded-md bg-secondary border border-color text-secondary text-xs font-medium flex items-center justify-center gap-1.5 hover:bg-secondary/80 transition cursor-pointer"
					type="button"
					onclick={handleClearMissingWbwTimestamps}
				>
					<span class="material-icons text-sm!">cancel</span>
					{$LL.common.clear()}
				</button>
			{/if}
		</div>
	</div>
{/if}
