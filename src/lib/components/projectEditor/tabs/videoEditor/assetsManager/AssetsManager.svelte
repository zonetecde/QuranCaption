<script lang="ts">
	import DownloadFromQuranicUniversalAudioSection from './DownloadFromQuranicUniversalAudioSection.svelte';
	import DownloadFromYouTubeSection from './DownloadFromYouTubeSection.svelte';
	import ProjectAssetSection from './ProjectAssetSection.svelte';
	import StockMediaLibrary from './StockMediaLibrary.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
	import { globalState } from '$lib/runes/main.svelte';

	type AssetsTab = 'qua' | 'file' | 'social' | 'stock';

	let {
		stockMediaOpen = false,
		showHeader = true,
		embedded = false
	}: {
		stockMediaOpen?: boolean;
		showHeader?: boolean;
		embedded?: boolean;
	} = $props();

	let activeTab = $state<AssetsTab>('qua');
	let showSourceTabs = $state(false);

	$effect(() => {
		if (stockMediaOpen) {
			showSourceTabs = true;
			activeTab = 'stock';
		}
	});

	/**
	 * Révèle les sources d'import et sélectionne Quran Universal Audio par défaut.
	 * @returns {void}
	 */
	function revealSourceTabs(): void {
		showSourceTabs = true;
		activeTab = 'qua';
		closeStockMedia();
	}

	/**
	 * Revient à la liste des assets du projet et masque les sources d'import.
	 * @returns {void}
	 */
	function showProjectAssets(): void {
		showSourceTabs = false;
		closeStockMedia();
	}

	function openStockMedia() {
		globalState.stockMediaLibrary.libraryOpen = true;
	}

	function closeStockMedia() {
		globalState.stockMediaLibrary.libraryOpen = false;
	}
</script>

<div
	data-tour-id="assets-manager"
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
		{#if showSourceTabs}
			<div class="assets-manager-tabs-row">
				<button
					class="assets-manager-tab assets-manager-tab-back"
					type="button"
					aria-label={$LL.common.back()}
					title={$LL.common.back()}
					onclick={showProjectAssets}
				>
					<span class="material-icons text-[18px]">arrow_back</span>
				</button>
				<button
					class:active={activeTab === 'qua'}
					class="assets-manager-tab"
					type="button"
					onclick={() => {
						activeTab = 'qua';
						closeStockMedia();
					}}
				>
					{get(LL).editor.quranUniversalAudio()}
				</button>
				<button
					class:active={activeTab === 'file'}
					class="assets-manager-tab"
					type="button"
					onclick={() => {
						activeTab = 'file';
						closeStockMedia();
					}}
				>
					{$LL.common.upload()}
				</button>
				<button
					class:active={activeTab === 'social'}
					class="assets-manager-tab"
					type="button"
					onclick={() => {
						activeTab = 'social';
						closeStockMedia();
					}}
				>
					{get(LL).editor.downloadFromSocialMedia()}
				</button>
				<button
					class:active={activeTab === 'stock'}
					class="assets-manager-tab"
					type="button"
					onclick={() => {
						activeTab = 'stock';
						openStockMedia();
					}}
				>
					{get(LL).editor.stockMedia()}
				</button>
			</div>
		{/if}

		<div class="assets-manager-panel">
			{#if !showSourceTabs}
				<ProjectAssetSection plainList onRevealSources={revealSourceTabs} />
			{:else if activeTab === 'qua'}
				<DownloadFromQuranicUniversalAudioSection compact />
			{:else if activeTab === 'file'}
				<ProjectAssetSection buttonOnly />
			{:else if activeTab === 'social'}
				<DownloadFromYouTubeSection compact />
			{:else if stockMediaOpen}
				<StockMediaLibrary hideHeader />
			{/if}
		</div>
	</div>
</div>

<style>
	.assets-manager-shell {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}

	.assets-manager-tabs-row {
		display: flex;
		gap: 0.45rem;
		overflow-x: auto;
		overflow-y: hidden;
		padding-bottom: 0.1rem;
	}

	.assets-manager-tabs-row::-webkit-scrollbar {
		display: none;
	}

	.assets-manager-panel {
		min-height: 0;
	}

	.assets-manager-tab {
		display: inline-flex;
		height: 32px;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--border-color);
		border-radius: 9999px;
		padding: 0 0.85rem;
		background: var(--bg-primary);
		color: var(--text-secondary);
		font-size: 0.75rem;
		font-weight: 600;
		white-space: nowrap;
	}

	.assets-manager-tab.active {
		border-color: var(--accent);
		background: var(--bg-accent);
		color: var(--text-primary);
	}

	.assets-manager-tab-back {
		width: 32px;
		padding: 0;
	}
</style>
