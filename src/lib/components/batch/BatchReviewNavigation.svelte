<script lang="ts">
	import type { Batch } from '$lib/classes';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { BatchService } from '$lib/services/BatchService';
	import { getBatchSegmentationReviewCounts } from '$lib/services/BatchSegmentationReview';
	import { getProjectTranslationReviewCounts } from '$lib/services/TranslationFetchService';
	import {
		leaveBatchReview,
		navigateBatchReview,
		type BatchReviewDirection
	} from '$lib/services/BatchReviewNavigationService';
	import { get } from 'svelte/store';
	import { onMount } from 'svelte';

	let batch = $state<Batch | null>(null);
	let currentId = $derived(globalState.shared.batchReview.currentProjectId);
	let reviewKind = $derived(globalState.shared.batchReview.kind);
	let editionName = $derived(globalState.shared.batchReview.editionName);
	let currentIndex = $derived(
		batch?.projects.findIndex((project) => project.projectId === currentId) ?? -1
	);
	let flagged = $derived(
		batch?.projects.filter((project) =>
			reviewKind === 'translation' && editionName
				? project.translations[editionName]?.status === 'needs_review'
				: project.segmentation.status === 'needs_review'
		) ?? []
	);
	let flaggedIndex = $derived(flagged.findIndex((project) => project.projectId === currentId));
	let hasPrevious = $derived(
		currentIndex > 0 &&
			(batch?.projects
				.slice(0, currentIndex)
				.some((project) =>
					reviewKind === 'translation' && editionName
						? project.translations[editionName]?.status === 'needs_review'
						: project.segmentation.status === 'needs_review'
				) ??
				false)
	);
	let hasNext = $derived(
		currentIndex >= 0 &&
			(batch?.projects
				.slice(currentIndex + 1)
				.some((project) =>
					reviewKind === 'translation' && editionName
						? project.translations[editionName]?.status === 'needs_review'
						: project.segmentation.status === 'needs_review'
				) ??
				false)
	);
	let currentReviewResolved = $derived(
		globalState.currentProject
			? reviewKind === 'translation' && editionName
				? getProjectTranslationReviewCounts(globalState.currentProject!, editionName).pending === 0
				: (() => {
						const review = getBatchSegmentationReviewCounts(globalState.currentProject!);
						return review.lowConfidence === 0 && review.coverage === 0;
					})()
			: false
	);
	let canNavigateNext = $derived(hasNext || currentReviewResolved);

	/**
	 * Résout une traduction Batch avant la génération automatique des types.
	 * @param {string} key Clé de traduction.
	 * @param {Record<string, string | number>} params Paramètres du message.
	 * @returns {string} Texte localisé.
	 */
	function reviewMessage(key: string, params: Record<string, string | number> = {}): string {
		const translator = Reflect.get(get(LL).batch, key) as
			| ((values?: Record<string, string | number>) => string)
			| undefined;
		return translator?.(params) ?? key;
	}

	/**
	 * Recharge le manifeste le plus récent pour les limites et la position.
	 * @returns {Promise<void>}
	 */
	async function refreshBatch(): Promise<void> {
		const batchId = globalState.shared.batchReview.batchId;
		if (batchId === null) return;
		batch = await BatchService.load(batchId);
	}

	/**
	 * Lance une navigation puis actualise le manifeste affiché.
	 * @param {BatchReviewDirection} direction Sens demandé.
	 * @returns {Promise<void>}
	 */
	async function navigate(direction: BatchReviewDirection): Promise<void> {
		await navigateBatchReview(direction);
		if (globalState.shared.batchReview.active) await refreshBatch();
	}

	/**
	 * Gère les raccourcis Alt + flèche hors saisie et hors modale.
	 * @param {KeyboardEvent} event Événement clavier global.
	 * @returns {void}
	 */
	function handleKeydown(event: KeyboardEvent): void {
		if (!event.altKey || globalState.shared.batchReview.isNavigating) return;
		const target = event.target;
		if (
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLSelectElement ||
			(target instanceof HTMLElement && target.isContentEditable) ||
			document.querySelector('.modal-wrapper, [role="dialog"]')
		)
			return;
		if (event.key === 'ArrowLeft' && hasPrevious) {
			event.preventDefault();
			void navigate('previous');
		} else if (event.key === 'ArrowRight' && canNavigateNext) {
			event.preventDefault();
			void navigate('next');
		}
	}

	onMount(refreshBatch);
</script>

<svelte:window onkeydown={handleKeydown} />

<div
	class="absolute left-1/2 flex h-9 max-w-[52vw] -translate-x-1/2 items-center gap-1 rounded-lg border border-color bg-secondary px-1"
>
	<button
		class="flex h-7 w-7 items-center justify-center rounded text-primary hover:bg-accent disabled:cursor-not-allowed disabled:opacity-35"
		type="button"
		disabled={!hasPrevious || globalState.shared.batchReview.isNavigating}
		onclick={() => navigate('previous')}
		aria-label={reviewMessage('reviewPreviousProject')}
		title={reviewMessage('reviewPreviousProject')}
	>
		<span class="material-icons text-[20px]!">chevron_left</span>
	</button>
	<span class="max-w-64 truncate px-2 text-sm font-medium text-primary">
		{globalState.currentProject?.detail.name ?? ''}{reviewKind === 'translation' && editionName
			? ` · ${batch?.projects.find((project) => project.projectId === currentId)?.translations[editionName]?.editionAuthor ?? editionName}`
			: ''}
	</span>
	<span
		class="shrink-0 text-xs text-secondary"
		aria-label={reviewMessage('reviewingProject', {
			current: Math.max(flaggedIndex + 1, 1),
			total: flagged.length
		})}
	>
		{Math.max(flaggedIndex + 1, 1)} / {flagged.length}
	</span>
	<button
		class="flex h-7 w-7 items-center justify-center rounded text-primary hover:bg-accent disabled:cursor-not-allowed disabled:opacity-35"
		type="button"
		disabled={!canNavigateNext || globalState.shared.batchReview.isNavigating}
		onclick={() => navigate('next')}
		aria-label={reviewMessage('reviewNextProject')}
		title={reviewMessage('reviewNextProject')}
	>
		<span class="material-icons text-[20px]!">chevron_right</span>
	</button>
	<button
		class="ml-1 flex h-7 w-7 items-center justify-center rounded text-primary hover:bg-accent disabled:cursor-not-allowed disabled:opacity-35"
		type="button"
		disabled={globalState.shared.batchReview.isNavigating}
		onclick={() => leaveBatchReview('batch')}
		aria-label={reviewMessage('reviewBackToBatch')}
		title={reviewMessage('reviewBackToBatch')}
	>
		<span class="material-icons text-[18px]!">view_list</span>
	</button>
</div>
