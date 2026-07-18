<script lang="ts">
	import type { BatchProjectItem, BatchProjectTranslationState } from '$lib/classes';
	import type { BatchSegmentationLiveStatus } from '$lib/services/BatchSegmentationService';
	import BatchProgressBar from './BatchProgressBar.svelte';

	let {
		project,
		stage,
		translationState,
		segmentationLive,
		batchMessage,
		getMediaActivityLabel,
		getModeLabel,
		getSegmentationActivityLabel,
		getSegmentationError,
		getTranslationStatusLabel
	}: {
		project: BatchProjectItem;
		stage: 'media' | 'segmentation' | 'translation';
		translationState?: BatchProjectTranslationState;
		segmentationLive?: BatchSegmentationLiveStatus;
		batchMessage: (key: string, params?: Record<string, string | number>) => string;
		getMediaActivityLabel: (project: BatchProjectItem) => string;
		getModeLabel: (mode: BatchProjectItem['media']['mode']) => string;
		getSegmentationActivityLabel: (project: BatchProjectItem) => string;
		getSegmentationError: (error: string | null) => string;
		getTranslationStatusLabel: (status: BatchProjectTranslationState['status']) => string;
	} = $props();
</script>

<td class="px-4 py-4">
	{#if stage === 'translation'}
		{#if translationState}
			<div class="flex justify-between gap-3 text-xs text-[var(--text-secondary)]">
				<span>{getTranslationStatusLabel(translationState.status)}</span>
				{#if translationState.status === 'adding' || translationState.status === 'fetching'}
					<span>{translationState.progress}%</span>
				{/if}
			</div>
			{#if translationState.status === 'adding' || translationState.status === 'fetching'}
				<div class="mt-2">
					<BatchProgressBar progress={translationState.progress} />
				</div>
			{/if}
			{#if translationState.review.total > 0}
				<p class="mt-2 text-xs text-[var(--text-thirdly)]">
					{batchMessage('translationCounts', {
						complete: translationState.review.complete,
						total: translationState.review.total,
						pending: translationState.review.pending,
						fetched: translationState.review.fetched
					})}
				</p>
			{/if}
			{#if translationState.error}
				<p class="mt-2 max-w-80 break-words text-xs text-red-300">
					{translationState.error === 'TRANSLATION_INTERRUPTED'
						? batchMessage('translationInterrupted')
						: translationState.error}
				</p>
			{/if}
		{:else}
			<span class="text-xs text-[var(--text-secondary)]">
				{batchMessage('translationNotAdded')}
			</span>
		{/if}
	{:else if stage === 'segmentation'}
		<div class="flex justify-between gap-3 text-xs text-[var(--text-secondary)]">
			<span>{getSegmentationActivityLabel(project)}</span>
			{#if project.segmentation.status === 'processing' || project.segmentation.progress > 0}
				<span>{project.segmentation.progress}%</span>
			{/if}
		</div>
		{#if project.segmentation.status === 'processing'}
			<div class="mt-2">
				<BatchProgressBar
					progress={project.segmentation.progress}
					indeterminate={segmentationLive?.indeterminate}
				/>
			</div>
		{/if}
		{#if project.segmentation.status === 'auto_verified' || project.segmentation.status === 'manually_verified'}
			<p class="mt-2 text-xs text-[var(--text-thirdly)]">
				{batchMessage('segmentationSegments', {
					count: project.segmentation.segmentsApplied
				})}
			</p>
		{:else if project.segmentation.status === 'needs_review'}
			<p
				class="mt-2 text-xs text-amber-300"
				title={batchMessage('segmentationReviewTooltip', {
					coverage: project.segmentation.review.coverage,
					lowConfidence: project.segmentation.review.lowConfidence,
					long: project.segmentation.review.long,
					wbw: project.segmentation.review.wbwTimestamps
				})}
			>
				{batchMessage('segmentationIssues', {
					count: project.segmentation.review.pending
				})}
				· {batchMessage('segmentationCoverageCount', {
					count: project.segmentation.review.coverage
				})}
				· {batchMessage('segmentationLowConfidenceCount', {
					count: project.segmentation.review.lowConfidence
				})}
			</p>
		{/if}
		{#if project.segmentation.error}
			<p class="mt-2 max-w-80 break-words text-xs text-red-300">
				{getSegmentationError(project.segmentation.error)}
			</p>
		{/if}
	{:else}
		<div class="flex justify-between text-xs text-[var(--text-secondary)]">
			<span>{getMediaActivityLabel(project)}</span>
			<span>{project.media.progress}%</span>
		</div>
		<div class="mt-2">
			<BatchProgressBar progress={project.media.progress} />
		</div>
		{#if project.media.mode}
			<p class="mt-2 text-xs text-[var(--text-thirdly)]">
				{batchMessage('mediaMode', { mode: getModeLabel(project.media.mode) })}
			</p>
		{/if}
		{#if project.media.error}
			<p class="mt-2 max-w-80 break-words text-xs text-red-300">
				{project.media.error}
			</p>
		{/if}
	{/if}
</td>
