<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import toast from 'svelte-5-french-toast';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
	import {
		clearWbwTimestampReview,
		computeMissingWbwTimestamps,
		getSubtitleClipsWithoutWbwTimestamps,
		markSubtitlesWithoutWbwTimestampsForReview
	} from '$lib/services/AutoSegmentation';

	let missingWbwSegmentsCount = $derived(getSubtitleClipsWithoutWbwTimestamps().length);
	let missingWbwSegmentsMarkedCount = $derived(
		(globalState.getSubtitleClips || []).filter((clip) => clip.needsWbwTimestampReview === true)
			.length
	);

	let isComputing = $state(false);

	/**
	 * Calcule à la demande les timestamps WBW manquants via l'API du Universal Aligner.
	 */
	async function handleComputeWbwTimestamps(): Promise<void> {
		if (isComputing) return;
		const targetCount = missingWbwSegmentsCount;
		if (targetCount <= 0) {
			toast(get(LL).editor.noMissingWbw());
			return;
		}

		isComputing = true;
		try {
			const { enriched, total } = await computeMissingWbwTimestamps();
			if (enriched > 0) {
				toast.success(
					get(LL).editor.wbwTimestampsComputed({
						enriched,
						total,
						plural: total > 1 ? 's' : ''
					})
				);
			} else {
				toast.error(get(LL).editor.noWbwTimestampsComputed());
			}
		} catch (error) {
			console.error('[WBW] Failed to compute timestamps:', error);
			toast.error(get(LL).editor.failedToComputeWbwTimestamps());
		} finally {
			isComputing = false;
		}
	}

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
			get(LL).editor.missingWbwMarked({
				count: markedCount,
				plural: markedCount > 1 ? 's were' : ' was'
			})
		);
	}

	/**
	 * Efface tous les marquages bleus liés aux timestamps WBW manquants.
	 */
	function handleClearMissingWbwTimestamps(): void {
		clearWbwTimestampReview();
	}
</script>

{#if missingWbwSegmentsCount > 0}
	<h3 class="text-sm font-medium text-secondary mb-3">{$LL.editor.markMissingWbw()}</h3>

	<div class="rounded-lg border border-sky-400/25 bg-sky-500/10 p-3 space-y-3">
		<div class="flex items-center justify-between gap-2">
			<div class="flex items-center gap-1.5">
				<span class="material-icons text-primary text-sm">flag</span>
				<span class="text-xs text-secondary">{$LL.editor.markMissingWbw()}</span>
			</div>
			<span class="text-xs font-bold text-primary"
				>{get(LL).editor.markedCount({ count: missingWbwSegmentsMarkedCount })}</span
			>
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

		<div class="space-y-2">
			<button
				class="w-full px-2 py-1.5 rounded-md bg-emerald-500/20 border border-emerald-400/40 text-primary font-medium flex items-center justify-center gap-1.5 hover:bg-emerald-500/30 transition cursor-pointer text-xs disabled:opacity-60 disabled:cursor-not-allowed"
				type="button"
				onclick={handleComputeWbwTimestamps}
				disabled={isComputing}
			>
				{#if isComputing}
					<span
						class="h-3.5 w-3.5 rounded-full border-2 border-[var(--text-primary)] border-t-transparent animate-spin"
					></span>
				{:else}
					<span class="material-icons text-sm!">auto_awesome</span>
					{$LL.editor.computeTimestamps()}
				{/if}
			</button>
		</div>

		<div class="grid grid-cols-3 gap-2">
			<button
				class="px-2 py-1.5 rounded-md bg-sky-500/20 border border-sky-400/40 text-primary font-medium flex items-center justify-center gap-1.5 hover:bg-sky-500/30 transition cursor-pointer text-xs disabled:opacity-60 disabled:cursor-not-allowed {missingWbwSegmentsMarkedCount <=
				0
					? 'col-span-3'
					: 'col-span-2'}"
				type="button"
				onclick={handleMarkMissingWbwTimestamps}
				disabled={isComputing}
			>
				<span class="material-icons text-sm!">flag</span>
				{$LL.editor.mark()}
			</button>
			{#if missingWbwSegmentsMarkedCount > 0}
				<button
					class="px-2 py-1.5 rounded-md bg-secondary border border-color text-secondary text-xs font-medium flex items-center justify-center gap-1.5 hover:bg-secondary/80 transition cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
					type="button"
					onclick={handleClearMissingWbwTimestamps}
					disabled={isComputing}
				>
					<span class="material-icons text-sm!">cancel</span>
					{$LL.common.clear()}
				</button>
			{/if}
		</div>
	</div>
{/if}
