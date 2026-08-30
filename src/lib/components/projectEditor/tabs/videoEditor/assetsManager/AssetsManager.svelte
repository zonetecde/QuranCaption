<script lang="ts">
	import DownloadFromQuranicUniversalAudioSection from './DownloadFromQuranicUniversalAudioSection.svelte';
	import ProjectAssetSection from './ProjectAssetSection.svelte';
	import StockMediaLibrary from './StockMediaLibrary.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
	import { globalState } from '$lib/runes/main.svelte';
	import { mobileModalSheet } from '$lib/services/mobileModalSheet';
	import { fade } from 'svelte/transition';

	type AssetsTab = 'qua' | 'file' | 'stock';

	let {
		stockMediaOpen = false,
		showHeader = true,
		embedded = false,
		importOpen = false,
		onOpenImport,
		onCloseImport
	}: {
		stockMediaOpen?: boolean;
		showHeader?: boolean;
		embedded?: boolean;
		importOpen?: boolean;
		onOpenImport?: () => void;
		onCloseImport?: () => void;
	} = $props();

	let activeTab = $state<AssetsTab>('qua');
	let wasImportOpen = $state(false);
	let assetIdsBeforeImport = $state<number[]>([]);

	$effect(() => {
		if (!importOpen) {
			if (wasImportOpen) closeStockMedia();
			wasImportOpen = false;
			return;
		}

		const assets = globalState.currentProject!.content.assets;
		if (!wasImportOpen) {
			// Le snapshot permet de refermer la feuille dès qu'une source a ajouté un asset.
			assetIdsBeforeImport = assets.map((asset) => asset.id);
			activeTab = 'qua';
			wasImportOpen = true;
			return;
		}

		if (assets.some((asset) => !assetIdsBeforeImport.includes(asset.id))) onCloseImport?.();
	});

	function openStockMedia() {
		globalState.stockMediaLibrary.libraryOpen = true;
	}

	function closeStockMedia() {
		globalState.stockMediaLibrary.libraryOpen = false;
	}
</script>

<div
	class={`bg-secondary h-full relative overflow-auto ${
		embedded ? 'space-y-4 px-0 py-0' : 'border border-color rounded-lg py-6 px-2 space-y-6'
	}`}
>
	{#if showHeader}
		<div class="flex gap-x-2 items-center justify-center mb-6">
			<span class="material-icons text-accent text-xl">movie</span>
			<h2 class="text-xl font-bold text-primary">{get(LL).editor.videoEditorLabel()}</h2>
		</div>
	{/if}

	<div class="assets-manager-shell">
		<div class="assets-manager-panel">
			<ProjectAssetSection plainList {onOpenImport} />
		</div>
	</div>
</div>

{#if importOpen}
	<div class="modal-wrapper assets-import-backdrop" transition:fade={{ duration: 120 }}>
		<section
			class="assets-import-sheet border border-color bg-secondary shadow-2xl shadow-black"
			use:mobileModalSheet={() => onCloseImport?.()}
			aria-label={get(LL).editor.addAssetLabel()}
		>
			<header class="assets-import-header">
				<div class="min-w-0">
					<h2 class="truncate text-base font-bold text-primary">
						{get(LL).editor.addAssetLabel()}
					</h2>
					<p class="mt-0.5 text-xs text-thirdly">
						{activeTab === 'file'
							? ($LL.editor as unknown as { fileLabel: () => string }).fileLabel()
							: activeTab === 'qua'
								? ($LL.editor as unknown as { quaShortLabel: () => string }).quaShortLabel()
								: get(LL).editor.stockMedia()}
					</p>
				</div>
				<button
					class="assets-import-close"
					type="button"
					onclick={() => onCloseImport?.()}
					aria-label={$LL.common.close()}
				>
					<span class="material-icons text-[20px]">close</span>
				</button>
			</header>

			<div class="assets-import-body">
				<div class="assets-import-choices" role="tablist">
					<button
						class:active={activeTab === 'qua'}
						class="assets-import-choice"
						type="button"
						role="tab"
						aria-selected={activeTab === 'qua'}
						onclick={() => {
							activeTab = 'qua';
							closeStockMedia();
						}}
					>
						<span class="material-icons-outlined">graphic_eq</span>
						<span>
							{($LL.editor as unknown as { quaShortLabel: () => string }).quaShortLabel()}
						</span>
					</button>
					<button
						class:active={activeTab === 'file'}
						class="assets-import-choice"
						type="button"
						role="tab"
						aria-selected={activeTab === 'file'}
						onclick={() => {
							activeTab = 'file';
							closeStockMedia();
						}}
					>
						<span class="material-icons-outlined">folder_open</span>
						<span>
							{($LL.editor as unknown as { fileLabel: () => string }).fileLabel()}
						</span>
					</button>
					<button
						class:active={activeTab === 'stock'}
						class="assets-import-choice"
						type="button"
						role="tab"
						aria-selected={activeTab === 'stock'}
						onclick={() => {
							activeTab = 'stock';
							openStockMedia();
						}}
					>
						<span class="material-icons-outlined">photo_library</span>
						<span>{get(LL).editor.stockMedia()}</span>
					</button>
				</div>

				<div class:assets-import-panel-file={activeTab === 'file'} class="assets-import-panel">
					{#if activeTab === 'file'}
						<ProjectAssetSection buttonOnly />
					{:else if activeTab === 'qua'}
						<DownloadFromQuranicUniversalAudioSection compact />
					{:else if stockMediaOpen}
						<StockMediaLibrary hideHeader />
					{/if}
				</div>
			</div>
		</section>
	</div>
{/if}

<style>
	.assets-manager-shell {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}

	.assets-manager-panel {
		min-height: 0;
	}

	.assets-import-backdrop {
		background: rgb(0 0 0 / 55%);
	}

	.assets-import-sheet {
		display: flex;
		width: 100%;
		max-width: 42rem;
		flex-direction: column;
		border-radius: 1rem 1rem 0 0;
		overflow: hidden;
	}

	:global(.assets-import-sheet.mobile-modal-sheet-panel) {
		height: 75dvh !important;
		max-height: 78dvh !important;
	}

	.assets-import-header {
		display: flex;
		min-height: 4.25rem;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		border-bottom: 1px solid var(--border-color);
		padding: 1.15rem 1rem 0.75rem;
	}

	.assets-import-close {
		display: inline-flex;
		height: 2.25rem;
		width: 2.25rem;
		flex: 0 0 auto;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--border-color);
		border-radius: 9999px;
		background: var(--bg-primary);
		color: var(--text-secondary);
	}

	.assets-import-body {
		display: flex;
		min-height: 0;
		flex: 1;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0.75rem;
	}

	.assets-import-choices {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.4rem;
	}

	.assets-import-choice {
		display: flex;
		min-width: 0;
		min-height: 4.2rem;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		border: 1px solid var(--border-color);
		border-radius: 0.75rem;
		padding: 0.45rem 0.25rem;
		background: var(--bg-primary);
		color: var(--text-secondary);
		font-size: 0.65rem;
		font-weight: 600;
		line-height: 1.15;
		text-align: center;
	}

	.assets-import-choice .material-icons-outlined {
		font-size: 1.25rem;
	}

	.assets-import-choice.active {
		border-color: color-mix(in srgb, var(--accent-primary) 70%, var(--border-color));
		background: color-mix(in srgb, var(--accent-primary) 16%, var(--bg-secondary));
		color: var(--accent-primary);
	}

	.assets-import-panel {
		min-height: 0;
		flex: 1;
		overflow-y: auto;
		border: 1px solid var(--border-color);
		border-radius: 0.85rem;
		padding: 0.75rem;
		background: color-mix(in srgb, var(--bg-primary) 72%, var(--bg-secondary));
		color: var(--text-primary);
	}

	.assets-import-panel :global(> .flex.h-full) {
		height: 100%;
	}

	.assets-import-panel-file {
		display: flex;
		align-items: flex-start;
		justify-content: flex-start;
	}

	.assets-import-panel-file :global(> div) {
		width: min(100%, 28rem);
		margin-inline: auto;
	}

	@media (max-width: 380px) {
		.assets-import-choice {
			font-size: 0.6rem;
		}
	}
</style>
