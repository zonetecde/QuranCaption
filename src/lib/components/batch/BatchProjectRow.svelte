<script lang="ts">
	import type { BatchProjectItem, BatchProjectTranslationState } from '$lib/classes';
	import LL from '$lib/i18n/i18n-svelte';
	import type { BatchSegmentationLiveStatus } from '$lib/services/BatchSegmentationService';
	import BatchProjectStageCell from './BatchProjectStageCell.svelte';

	let {
		project,
		stage,
		activeTranslationEditionName,
		selected,
		operationActive,
		segmentationLive,
		batchMessage,
		getMediaActivityLabel,
		getModeLabel,
		getSegmentationActivityLabel,
		getSegmentationError,
		getTranslationStatusLabel,
		onToggle,
		onOpen
	}: {
		project: BatchProjectItem;
		stage: 'media' | 'segmentation' | 'translation';
		activeTranslationEditionName: string | null;
		selected: boolean;
		operationActive: boolean;
		segmentationLive?: BatchSegmentationLiveStatus;
		batchMessage: (key: string, params?: Record<string, string | number>) => string;
		getMediaActivityLabel: (project: BatchProjectItem) => string;
		getModeLabel: (mode: BatchProjectItem['media']['mode']) => string;
		getSegmentationActivityLabel: (project: BatchProjectItem) => string;
		getSegmentationError: (error: string | null) => string;
		getTranslationStatusLabel: (status: BatchProjectTranslationState['status']) => string;
		onToggle: (projectId: number) => void;
		onOpen: (project: BatchProjectItem) => void;
	} = $props();

	let translationState = $derived(
		activeTranslationEditionName ? project.translations[activeTranslationEditionName] : undefined
	);
	let reviewRequired = $derived(
		translationState?.status === 'needs_review' || project.segmentation.status === 'needs_review'
	);
</script>

<tr>
	<td class="px-4 py-4">
		<input
			type="checkbox"
			class="rounded border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--accent-primary)]"
			checked={selected}
			disabled={project.media.status === 'processing' ||
				project.segmentation.status === 'processing' ||
				operationActive}
			aria-label={batchMessage('selectProject')}
			onchange={() => onToggle(project.projectId)}
		/>
	</td>
	<td class="px-4 py-4 text-[var(--text-thirdly)]">{project.order}</td>
	<td class="px-4 py-4 font-medium text-[var(--text-primary)]">{project.projectName}</td>
	<td class="px-4 py-4 text-[var(--text-secondary)]">{project.reciter}</td>
	<td class="max-w-96 px-4 py-4 text-[var(--text-secondary)]">
		<div class="flex items-center gap-2" title={project.source.value}>
			<span class="material-icons-outlined text-base text-[var(--accent-primary)]">
				{project.source.kind === 'url' ? 'link' : 'insert_drive_file'}
			</span>
			<span class="truncate">{project.source.value}</span>
		</div>
	</td>
	<BatchProjectStageCell
		{project}
		{stage}
		{translationState}
		{segmentationLive}
		{batchMessage}
		{getMediaActivityLabel}
		{getModeLabel}
		{getSegmentationActivityLabel}
		{getSegmentationError}
		{getTranslationStatusLabel}
	/>
	<td class="px-4 py-4">
		<button
			class="btn btn-icon h-9 px-3"
			type="button"
			disabled={project.media.status === 'processing' ||
				project.segmentation.status === 'processing' ||
				operationActive}
			onclick={() => onOpen(project)}
		>
			<span class="material-icons-outlined mr-2 text-base">open_in_new</span>
			{reviewRequired ? batchMessage('reviewProject') : $LL.batch.openProject()}
		</button>
	</td>
</tr>
