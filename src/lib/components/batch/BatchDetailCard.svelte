<script lang="ts">
	import type { BatchDetail } from '$lib/classes';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { BatchService } from '$lib/services/BatchService';
	import Exporter from '$lib/classes/Exporter';
	import ModalManager from '$lib/components/modals/ModalManager';
	import ContextMenu, { Item } from 'svelte-contextmenu';
	import { currentMenu } from 'svelte-contextmenu/stores';
	import { get } from 'svelte/store';

	let { batchDetail }: { batchDetail: BatchDetail } = $props();
	let contextMenu: ContextMenu | undefined = $state(undefined);
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

	/**
	 * Résout les traductions Batch ajoutées avant la génération i18n du pre-commit.
	 * @param {string} key Clé du message Batch.
	 * @param {Record<string, string | number>} params Paramètres éventuels du message.
	 * @returns {string} Message localisé.
	 */
	function batchMessage(key: string, params: Record<string, string | number> = {}): string {
		const translator = Reflect.get(get(LL).batch, key) as
			| ((values?: Record<string, string | number>) => string)
			| undefined;
		return translator?.(params) ?? key;
	}

	/**
	 * Ouvre le menu d'actions sans ouvrir le workspace du batch.
	 * @param {MouseEvent} event Clic sur le bouton d'actions.
	 * @returns {void}
	 */
	function openActionsMenu(event: MouseEvent): void {
		event.stopPropagation();
		contextMenu?.createHandler()(event);
	}

	/**
	 * Exporte uniquement le batch sélectionné et ses projets.
	 * @param {MouseEvent} event Clic sur l'action d'export.
	 * @returns {Promise<void>} Promesse résolue après l'écriture du backup.
	 */
	async function exportBatch(event: MouseEvent): Promise<void> {
		if (event.button !== 0) return;
		await Exporter.backupBatch(batchDetail.id);
	}

	/**
	 * Supprime le batch confirmé et tous les projets qu'il contient.
	 * @param {MouseEvent} event Clic sur l'action de suppression.
	 * @returns {Promise<void>} Promesse résolue après la suppression.
	 */
	async function deleteBatch(event: MouseEvent): Promise<void> {
		if (event.button !== 0) return;
		const confirmed = await ModalManager.confirmModal(
			batchMessage('deleteBatchConfirm', {
				name: batchDetail.name,
				count: batchDetail.projectCount
			})
		);
		if (confirmed) await BatchService.delete(batchDetail.id);
		else currentMenu.set(null);
	}
</script>

<div
	class="group relative flex cursor-pointer flex-col justify-between overflow-hidden rounded-xl border border-[var(--border-color)] bg-secondary text-left shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] backdrop-blur-[10px] transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl"
	data-batch-card={batchDetail.id}
	role="button"
	tabindex="0"
	onclick={openBatch}
	onkeydown={(event) => {
		if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' '))
			openBatch();
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
		<div class="flex items-center gap-2">
			<button
				class="btn-accent flex-grow py-2 text-center text-xs"
				type="button"
				onclick={(event) => {
					event.stopPropagation();
					openBatch();
				}}
			>
				{$LL.home.openProject()}
			</button>
			<button
				class="btn btn-secondary btn-sm flex items-center p-1.5"
				type="button"
				data-batch-actions
				aria-label={batchMessage('batchActions')}
				onclick={openActionsMenu}
			>
				<span class="material-icons-outlined text-sm">more_horiz</span>
			</button>
		</div>
	</div>
</div>

<ContextMenu bind:this={contextMenu}>
	<Item on:click={exportBatch}
		><div class="btn-icon">
			<span class="material-icons-outlined mr-1 text-sm">file_download</span>{batchMessage(
				'exportBatch'
			)}
		</div></Item
	>
	<Item on:click={deleteBatch}
		><div class="btn-icon danger-color">
			<span class="material-icons-outlined mr-1 text-sm">delete</span>{batchMessage('deleteBatch')}
		</div></Item
	>
</ContextMenu>
