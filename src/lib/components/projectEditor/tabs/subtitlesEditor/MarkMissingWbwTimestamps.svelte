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
	import { isWbwComputeBusy, runWbwCompute } from '$lib/services/WbwComputeStore.svelte';

	let missingWbwSegmentsCount = $derived(getSubtitleClipsWithoutWbwTimestamps().length);
	let missingWbwSegmentsMarkedCount = $derived(
		(globalState.getSubtitleClips || []).filter((clip) => clip.needsWbwTimestampReview === true)
			.length
	);

	// Occupation hébergée hors composant (store de module) : survit au démontage du
	// Subtitles Editor lors d'une bascule d'onglet/fenêtre dans QC, donc le bouton
	// retrouve son état occupé au remontage et un double calcul est bloqué.
	const projectId = $derived(globalState.currentProject?.detail.id ?? -1);
	const isComputing = $derived(isWbwComputeBusy(projectId));

	/**
	 * Calcule à la demande les timestamps WBW manquants via l'API du Universal Aligner.
	 *
	 * Délègue au store (détaché du composant) : la bascule d'onglet/fenêtre dans QC
	 * n'interrompt plus le calcul, et une notification annonce la fin. Les clips ciblés
	 * sont capturés par référence à l'intérieur de `computeMissingWbwTimestamps`, donc
	 * les résultats se posent sur les bons sous-titres même après une bascule.
	 */
	function handleComputeWbwTimestamps(): void {
		const project = globalState.currentProject;
		if (!project || isComputing) return;
		if (missingWbwSegmentsCount <= 0) {
			toast(get(LL).editor.noMissingWbw());
			return;
		}

		const computeLabel = get(LL).editor.computeTimestamps();
		void runWbwCompute({
			projectId: project.detail.id,
			errorTitle: get(LL).editor.failedToComputeWbwTimestamps(),
			run: async () => {
				const { enriched, total } = await computeMissingWbwTimestamps();
				if (enriched > 0) {
					return {
						title: computeLabel,
						body: get(LL).editor.wbwTimestampsComputed({
							enriched,
							total,
							plural: total > 1 ? 's' : ''
						}),
						level: 'success'
					};
				}
				return {
					title: computeLabel,
					body: get(LL).editor.noWbwTimestampsComputed(),
					level: 'error'
				};
			}
		});
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
