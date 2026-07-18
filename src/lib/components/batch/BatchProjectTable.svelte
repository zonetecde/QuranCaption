<script lang="ts">
	import type { BatchProjectItem, BatchProjectTranslationState } from '$lib/classes';
	import LL from '$lib/i18n/i18n-svelte';
	import type { BatchSegmentationLiveStatus } from '$lib/services/BatchSegmentationService';
	import BatchProjectRow from './BatchProjectRow.svelte';

	let {
		projects,
		stage,
		activeTranslationEditionName,
		selectedIds,
		allSelected,
		operationActive,
		segmentationLive,
		rowVersions,
		batchMessage,
		getMediaActivityLabel,
		getModeLabel,
		getSegmentationActivityLabel,
		getSegmentationError,
		getTranslationStatusLabel,
		onToggleAll,
		onToggleProject,
		onOpenProject
	}: {
		projects: BatchProjectItem[];
		stage: 'media' | 'segmentation' | 'translation';
		activeTranslationEditionName: string | null;
		selectedIds: Set<number>;
		allSelected: boolean;
		operationActive: boolean;
		segmentationLive: Map<number, BatchSegmentationLiveStatus>;
		rowVersions: Record<number, number>;
		batchMessage: (key: string, params?: Record<string, string | number>) => string;
		getMediaActivityLabel: (project: BatchProjectItem) => string;
		getModeLabel: (mode: BatchProjectItem['media']['mode']) => string;
		getSegmentationActivityLabel: (project: BatchProjectItem) => string;
		getSegmentationError: (error: string | null) => string;
		getTranslationStatusLabel: (status: BatchProjectTranslationState['status']) => string;
		onToggleAll: () => void;
		onToggleProject: (projectId: number) => void;
		onOpenProject: (project: BatchProjectItem) => void;
	} = $props();
</script>

<section
	class="overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl"
>
	<div class="overflow-x-auto">
		<table class="w-full text-left text-sm">
			<thead class="bg-[var(--bg-accent)] text-[var(--text-secondary)]">
				<tr>
					<th class="px-4 py-3">
						<input
							type="checkbox"
							class="rounded border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--accent-primary)]"
							checked={allSelected}
							aria-label={batchMessage('selectProject')}
							onchange={onToggleAll}
						/>
					</th>
					<th class="px-4 py-3">#</th>
					<th class="px-4 py-3">{$LL.batch.project()}</th>
					<th class="px-4 py-3">{$LL.batch.reciter()}</th>
					<th class="px-4 py-3">{$LL.batch.source()}</th>
					<th class="min-w-64 px-4 py-3">
						{stage === 'translation'
							? batchMessage('translations')
							: stage === 'segmentation'
								? batchMessage('aiSegmentation')
								: $LL.batch.media()}
					</th>
					<th class="px-4 py-3">{$LL.batch.actions()}</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-[var(--border-color)]">
				{#each projects as project (`${project.projectId}-${rowVersions[project.projectId] ?? 0}`)}
					<BatchProjectRow
						{project}
						{stage}
						{activeTranslationEditionName}
						selected={selectedIds.has(project.projectId)}
						{operationActive}
						segmentationLive={segmentationLive.get(project.projectId)}
						{batchMessage}
						{getMediaActivityLabel}
						{getModeLabel}
						{getSegmentationActivityLabel}
						{getSegmentationError}
						{getTranslationStatusLabel}
						onToggle={onToggleProject}
						onOpen={onOpenProject}
					/>
				{/each}
			</tbody>
		</table>
	</div>
</section>
