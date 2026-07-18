<script lang="ts">
	import type { BatchDetail } from '$lib/classes';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';

	let { batchDetail }: { batchDetail: BatchDetail } = $props();
	let isListView = $derived(
		(globalState.settings?.persistentUiState.projectCardView ?? 'grid') === 'list'
	);

	/**
	 * Ouvre le workspace du batch sélectionné.
	 * @returns {void}
	 */
	function openBatch(): void {
		globalState.currentBatchId = batchDetail.id;
		globalState.currentPage = 'batch-workspace';
	}
</script>

<div
	class="group relative flex cursor-pointer flex-col justify-between overflow-hidden rounded-xl border border-[var(--border-color)] bg-secondary text-left shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] backdrop-blur-[10px] transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl"
	data-batch-card={batchDetail.id}
	role="button"
	tabindex="0"
	onclick={openBatch}
	onkeydown={(event) => {
		if (event.key === 'Enter' || event.key === ' ') openBatch();
	}}
>
	<div>
		{#if !isListView}
			<div
				class="relative flex h-40 w-full items-center justify-center overflow-hidden rounded-t-lg bg-white/80"
			>
				<span class="material-icons text-6xl! text-black opacity-80">dynamic_feed</span>
				<span
					class="absolute right-3 top-3 rounded-full border border-[var(--accent-primary)] bg-[var(--bg-secondary)]/90 px-2.5 py-1 text-xs font-semibold text-[var(--accent-primary)]"
				>
					{$LL.batch.batch()}
				</span>
			</div>
		{/if}

		<div class="relative mt-4 px-4 pb-4">
			<div class="flex items-start justify-between gap-3">
				<h3 class="truncate text-lg font-semibold text-[var(--text-accent)]">
					{batchDetail.name}
				</h3>
				{#if isListView}
					<span
						class="rounded-full border border-[var(--accent-primary)] px-2.5 py-1 text-xs font-semibold text-[var(--accent-primary)]"
					>
						{$LL.batch.batch()}
					</span>
				{/if}
			</div>
			<p class="mt-2 text-xs text-[var(--text-secondary)]">
				{$LL.home.reciterLabel()}
				<span class="font-semibold">
					{batchDetail.reciter ?? $LL.batch.multipleReciters()}
				</span>
			</p>
			<p class="mt-1 flex items-center gap-1 text-xs text-[var(--text-secondary)]">
				<span class="material-icons-outlined text-sm">inventory_2</span>
				{$LL.batch.projectsCount({ count: batchDetail.projectCount })}
			</p>
		</div>
	</div>

	<div class="mt-auto border-t border-[var(--border-color)] px-4 pb-4 pt-3">
		<div class="mb-2 flex items-center justify-between text-xs text-[var(--text-secondary)]">
			<span>{$LL.home.createdLabel()} {batchDetail.createdAt.toLocaleDateString()}</span>
			<span>{$LL.home.updatedLabel()} {batchDetail.updatedAt.toLocaleDateString()}</span>
		</div>
		<div class="btn-accent py-2 text-center text-xs">{$LL.home.openProject()}</div>
	</div>
</div>
