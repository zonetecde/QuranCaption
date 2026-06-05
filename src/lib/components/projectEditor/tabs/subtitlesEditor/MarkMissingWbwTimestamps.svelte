<script lang="ts">
	import { onDestroy } from 'svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import toast from 'svelte-5-french-toast';
	import {
		clearWbwTimestampReview,
		computeMissingWbwTimestamps,
		estimateSegmentationDuration,
		getAutoSegmentationAudioDurationS,
		getSubtitleClipsWithoutWbwTimestamps,
		markSubtitlesWithoutWbwTimestampsForReview
	} from '$lib/services/AutoSegmentation';

	let missingWbwSegmentsCount = $derived(getSubtitleClipsWithoutWbwTimestamps().length);
	let missingWbwSegmentsMarkedCount = $derived(
		(globalState.getSubtitleClips || []).filter((clip) => clip.needsWbwTimestampReview === true)
			.length
	);
	let hasSubtitleSegments = $derived((globalState.getSubtitleClips || []).length > 0);

	let isComputing = $state(false);
	let computeProgress = $state(0);
	let computeRemainingS = $state<number | null>(null);
	let computeTimer: ReturnType<typeof setInterval> | null = null;

	/**
	 * Démarre une barre de progression animée à partir de l'estimation `/estimate_duration`.
	 *
	 * @param {number | null} estimatedDurationS Durée estimée en secondes, ou null si indisponible.
	 */
	function startComputeProgressTimer(estimatedDurationS: number | null): void {
		stopComputeProgressTimer();
		const startedAtMs = Date.now();
		const durationS = estimatedDurationS && estimatedDurationS > 0 ? estimatedDurationS : null;

		computeTimer = setInterval(() => {
			const elapsedS = (Date.now() - startedAtMs) / 1000;
			if (durationS) {
				const ratio = Math.max(0, Math.min(1, elapsedS / durationS));
				// Plafonné à 95% tant que la requête MFA n'est pas revenue.
				computeProgress = Math.min(95, ratio * 100);
				computeRemainingS = Math.max(0, Math.ceil(durationS - elapsedS));
			} else {
				// Sans estimation: progression indéterminée plafonnée.
				computeProgress = Math.min(95, computeProgress + 2);
				computeRemainingS = null;
			}
		}, 400);
	}

	/**
	 * Arrête la barre de progression animée si elle tourne.
	 */
	function stopComputeProgressTimer(): void {
		if (computeTimer) {
			clearInterval(computeTimer);
			computeTimer = null;
		}
	}

	/**
	 * Calcule à la demande les timestamps WBW manquants via l'API du Universal Aligner.
	 */
	async function handleComputeWbwTimestamps(): Promise<void> {
		if (isComputing) return;
		const targetCount = missingWbwSegmentsCount;
		if (targetCount <= 0) {
			toast('No subtitle is missing WBW timestamps.');
			return;
		}

		isComputing = true;
		computeProgress = 0;
		computeRemainingS = null;

		// Lance le calcul immédiatement; l'estimation ne sert qu'à animer la barre,
		// donc elle tourne en parallèle sans retarder le travail MFA réel.
		const computePromise = computeMissingWbwTimestamps();
		startComputeProgressTimer(null);
		const audioDurationS = getAutoSegmentationAudioDurationS();
		if (audioDurationS > 0) {
			estimateSegmentationDuration({
				endpoint: 'timestamps_direct',
				audioDurationS,
				modelName: 'Base',
				device: 'GPU'
			})
				.then((estimate) => {
					if (isComputing && estimate?.estimated_duration_s) {
						startComputeProgressTimer(estimate.estimated_duration_s);
					}
				})
				.catch(() => {});
		}

		try {
			const { enriched, total } = await computePromise;
			if (enriched > 0) {
				toast.success(
					`WBW timestamps computed for ${enriched}/${total} subtitle${total > 1 ? 's' : ''}.`
				);
			} else {
				toast.error('No WBW timestamps could be computed. Please try again.');
			}
		} catch (error) {
			console.error('[WBW] Failed to compute timestamps:', error);
			toast.error('Failed to compute WBW timestamps.');
		} finally {
			stopComputeProgressTimer();
			isComputing = false;
			computeProgress = 0;
			computeRemainingS = null;
		}
	}

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

	onDestroy(stopComputeProgressTimer);
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
					title="Optional feature. Add WBW timestamps to enable word highlighting, fast verse division, and other advanced features. Compute them on demand below (works for any project), or fetch them during AI Segmentation."
				>
					help_outline
				</span>
			</p>
		</div>

		{#if missingWbwSegmentsCount > 0}
			<div class="space-y-2">
				<button
					class="w-full px-2 py-1.5 rounded-md bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 font-medium flex items-center justify-center gap-1.5 hover:bg-emerald-500/30 transition cursor-pointer text-xs disabled:opacity-60 disabled:cursor-not-allowed"
					type="button"
					onclick={handleComputeWbwTimestamps}
					disabled={isComputing}
				>
					{#if isComputing}
						<span class="material-icons text-sm! animate-spin">progress_activity</span>
						Computing timestamps…
					{:else}
						<span class="material-icons text-sm!">auto_awesome</span>
						Compute timestamps
					{/if}
				</button>

				{#if isComputing}
					<div class="space-y-1">
						<div class="h-1.5 w-full rounded-full bg-emerald-900/40 overflow-hidden">
							<div
								class="h-full rounded-full bg-emerald-400 transition-[width] duration-300"
								style="width: {computeProgress}%"
							></div>
						</div>
						<p class="text-[10px] text-thirdly text-center">
							{Math.round(computeProgress)}%{computeRemainingS !== null
								? ` · ~${computeRemainingS}s remaining`
								: ''}
						</p>
					</div>
				{/if}
			</div>
		{/if}

		<div class="grid grid-cols-3 gap-2">
			<button
				class="px-2 py-1.5 rounded-md bg-sky-500/20 border border-sky-400/40 text-sky-200 font-medium flex items-center justify-center gap-1.5 hover:bg-sky-500/30 transition cursor-pointer text-xs disabled:opacity-60 disabled:cursor-not-allowed {missingWbwSegmentsMarkedCount <=
				0
					? 'col-span-3'
					: 'col-span-2'}"
				type="button"
				onclick={handleMarkMissingWbwTimestamps}
				disabled={isComputing}
			>
				<span class="material-icons text-sm!">flag</span>
				Mark
			</button>
			{#if missingWbwSegmentsMarkedCount > 0}
				<button
					class="px-2 py-1.5 rounded-md bg-secondary border border-color text-secondary text-xs font-medium flex items-center justify-center gap-1.5 hover:bg-secondary/80 transition cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
					type="button"
					onclick={handleClearMissingWbwTimestamps}
					disabled={isComputing}
				>
					<span class="material-icons text-sm!">cancel</span>
					Clear
				</button>
			{/if}
		</div>
	</div>
{/if}
