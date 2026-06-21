<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { appDataDir, join } from '@tauri-apps/api/path';
	import { get } from 'svelte/store';
	import LL from '$lib/i18n/i18n-svelte';
	import { onDestroy } from 'svelte';
	import StockMediaCard from './StockMediaCard.svelte';
	import type { StockMediaResult } from './stockMediaTypes';
	import { SourceType } from '$lib/classes';
	import toast from 'svelte-5-french-toast';

	let {
		onBack,
		hideHeader = false
	}: {
		onBack?: () => void;
		hideHeader?: boolean;
	} = $props();

	const lib = $derived(globalState.stockMediaLibrary);
	let searchQuery = $state('');

	// Charger les medias populaires des l'ouverture de la librairie
	let hasLoadedPopular = $state(false);
	$effect(() => {
		if (lib.libraryOpen && !hasLoadedPopular) {
			hasLoadedPopular = true;
			void doSearch();
		}
		if (!lib.libraryOpen) {
			hasLoadedPopular = false;
		}
	});

	$effect(() => {
		searchQuery = lib.searchQuery;
	});

	function getApiKey(): string {
		const source = lib.source;
		const settings = globalState.settings;
		if (!settings) return '';
		if (source === 'pexels') return settings.stockMediaSettings.pexelsApiKey;
		return settings.stockMediaSettings.pixabayApiKey;
	}

	async function doSearch() {
		const apiKey = getApiKey();
		if (!apiKey) {
			globalState.stockMediaLibrary.error = 'API key not configured';
			return;
		}

		globalState.stockMediaLibrary.searchQuery = searchQuery.trim();
		globalState.stockMediaLibrary.page = 1;
		globalState.stockMediaLibrary.isLoading = true;
		globalState.stockMediaLibrary.error = null;
		globalState.stockMediaLibrary.results = [];

		try {
			const response = await invoke<any>('search_stock_media', {
				query: searchQuery.trim(),
				source: lib.source,
				mediaType: lib.mediaType,
				apiKey,
				page: 1,
				perPage: 30
			});

			globalState.stockMediaLibrary.results = response.results;
			globalState.stockMediaLibrary.hasMore = response.hasMore;
		} catch (e) {
			globalState.stockMediaLibrary.error = String(e);
		} finally {
			globalState.stockMediaLibrary.isLoading = false;
		}
	}

	async function loadMore() {
		if (lib.isLoading || !lib.hasMore) return;
		const apiKey = getApiKey();
		if (!apiKey) return;

		const nextPage = lib.page + 1;
		globalState.stockMediaLibrary.isLoading = true;

		try {
			const response = await invoke<any>('search_stock_media', {
				query: lib.searchQuery,
				source: lib.source,
				mediaType: lib.mediaType,
				apiKey,
				page: nextPage,
				perPage: 30
			});

			globalState.stockMediaLibrary.results = [...lib.results, ...response.results];
			globalState.stockMediaLibrary.hasMore = response.hasMore;
			globalState.stockMediaLibrary.page = nextPage;
		} catch (e) {
			globalState.stockMediaLibrary.error = String(e);
		} finally {
			globalState.stockMediaLibrary.isLoading = false;
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter') doSearch();
	}

	function setSource(source: 'pexels' | 'pixabay') {
		globalState.stockMediaLibrary.source = source;
		if (searchQuery.trim().length > 0) doSearch();
	}

	function setMediaType(type: 'all' | 'photo' | 'video') {
		globalState.stockMediaLibrary.mediaType = type;
		if (searchQuery.trim().length > 0) doSearch();
	}

	async function downloadAsset(result: StockMediaResult) {
		const sourceType = result.source === 'pexels' ? SourceType.Pexels : SourceType.Pixabay;
		try {
			globalState.stockMediaLibrary.downloadingId = result.id;

			const downloadDir = await join(await appDataDir(), 'downloads', 'stock-media');
			const ext = result.type === 'video' ? 'mp4' : 'jpg';
			const fileName = `${result.id}.${ext}`;
			const fullPath = await join(downloadDir, fileName);

			await invoke('download_file', {
				url: result.downloadUrl,
				path: fullPath
			});

			globalState.currentProject?.content.addAsset(fullPath, result.pageUrl, sourceType, {
				authorName: result.authorName,
				authorUrl: result.authorUrl,
				skipConstantBitrateWarning: true
			});

			toast.success(get(LL).editor.downloadSuccessful());
		} catch (e) {
			toast.error(get(LL).editor.stockMediaDownloadError({ error: String(e) }));
		} finally {
			globalState.stockMediaLibrary.downloadingId = null;
		}
	}

	let scrollContainer: HTMLDivElement | undefined = $state();

	function handleScroll() {
		if (!scrollContainer) return;
		const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
		if (scrollHeight - scrollTop - clientHeight < 200) {
			loadMore();
		}
	}

	let searchDebounce: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		searchQuery;
		clearTimeout(searchDebounce);
		searchDebounce = setTimeout(() => {
			if (searchQuery.trim().length > 0) doSearch();
		}, 400);
		return () => clearTimeout(searchDebounce);
	});

	onDestroy(() => {
		globalState.stockMediaLibrary.results = [];
		globalState.stockMediaLibrary.error = null;
	});
</script>

<div class="flex h-full min-h-0 flex-col">
	{#if !hideHeader}
		<div class="flex items-center gap-3 border-b border-color px-3 py-3">
			{#if onBack}
				<button
					class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-secondary transition-colors hover:bg-primary hover:text-primary"
					type="button"
					onclick={onBack}
					aria-label={get(LL).editor.backToAssets()}
				>
					<span class="material-icons-outlined text-lg">arrow_back</span>
				</button>
			{/if}
			<div class="min-w-0 flex-1">
				<h2 class="truncate text-lg font-semibold text-primary">
					{get(LL).editor.stockMedia()}
				</h2>
			</div>
		</div>
	{/if}

	<div
		class="min-h-0 flex-1 overflow-y-auto px-3 py-3 space-y-3"
		bind:this={scrollContainer}
		onscroll={handleScroll}
	>
		<!-- Barre de recherche -->
		<div class="relative">
			<span
				class="material-icons-outlined pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-thirdly"
			>
				search
			</span>
			<input
				bind:value={searchQuery}
				onkeydown={handleKeyDown}
				class="h-9 w-full rounded-md border border-color bg-primary py-1 pl-8 pr-2 text-xs text-primary outline-none transition-colors placeholder:text-thirdly focus:border-[var(--accent-primary)]"
				type="search"
				placeholder={get(LL).editor.searchStockMedia()}
			/>
		</div>

		<!-- Filtres source -->
		<div class="flex gap-2">
			<button
				class={(lib.source === 'pixabay' ? 'btn-accent' : 'btn') + ' flex-1 py-1.5 text-xs'}
				type="button"
				onclick={() => setSource('pixabay')}
			>
				{get(LL).editor.pixabaySource()}
			</button>
			<button
				class={(lib.source === 'pexels' ? 'btn-accent' : 'btn') + ' flex-1 py-1.5 text-xs'}
				type="button"
				onclick={() => setSource('pexels')}
			>
				{get(LL).editor.pexelsSource()}
			</button>
		</div>

		<!-- Filtres type de media -->
		<div class="flex gap-2">
			<button
				class={(lib.mediaType === 'video' ? 'btn-accent' : 'btn') + ' flex-1 py-1.5 text-xs'}
				type="button"
				onclick={() => setMediaType('video')}
			>
				{get(LL).editor.videos()}
			</button>
			<button
				class={(lib.mediaType === 'photo' ? 'btn-accent' : 'btn') + ' flex-1 py-1.5 text-xs'}
				type="button"
				onclick={() => setMediaType('photo')}
			>
				{get(LL).editor.images()}
			</button>
			<button
				class={(lib.mediaType === 'all' ? 'btn-accent' : 'btn') + ' flex-1 py-1.5 text-xs'}
				type="button"
				onclick={() => setMediaType('all')}
			>
				{get(LL).editor.allMedia()}
			</button>
		</div>

		<!-- Avertissement droits d'auteur -->
		<!-- <div
			class="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-amber-100 text-xs"
		>
			<div class="flex items-start gap-2">
				<span class="material-icons-outlined text-sm mt-0.5">warning</span>
				<p>
					{get(LL).editor.stockMediaDisclaimer({
						source: lib.source === 'pexels' ? 'Pexels' : 'Pixabay'
					})}
				</p>
			</div>
		</div> -->

		<!-- Message si pas de clé API -->
		{#if !getApiKey()}
			<div class="rounded-lg border border-red-400/35 bg-red-500/10 px-3 py-3 text-sm text-red-100">
				<div class="flex items-start gap-2">
					<span class="material-icons-outlined text-base">key_off</span>
					<div class="min-w-0 flex-1">
						<p class="font-medium">{$LL.common.warning()}</p>
						<p class="mt-0.5 text-xs text-red-100/80">
							{get(LL).editor.configureApiKeys()}
						</p>
					</div>
				</div>
			</div>
		{/if}

		<!-- Message d'erreur -->
		{#if lib.error}
			<div class="rounded-lg border border-red-400/35 bg-red-500/10 px-3 py-3 text-sm text-red-100">
				<div class="flex items-start gap-2">
					<span class="material-icons-outlined text-base">error</span>
					<div class="min-w-0 flex-1">
						<p class="font-medium">{get(LL).editor.stockMediaError()}</p>
						<p class="mt-0.5 text-xs text-red-100/80">{lib.error}</p>
					</div>
					<button class="btn px-2 py-1 text-xs" type="button" onclick={doSearch}>
						{$LL.common.retry()}
					</button>
				</div>
			</div>
		{/if}

		<!-- Résultats -->
		{#if lib.isLoading && lib.results.length === 0}
			<div class="grid grid-cols-2 gap-3">
				{#each Array(6) as _, i (i)}
					<div class="h-32 animate-pulse rounded-lg border border-color bg-primary/50"></div>
				{/each}
			</div>
		{:else if !lib.isLoading && lib.results.length === 0 && searchQuery.trim().length > 0}
			<div
				class="flex flex-col items-center justify-center gap-2 rounded-lg border border-color bg-primary/40 px-4 py-10 text-center"
			>
				<span class="material-icons-outlined text-2xl text-thirdly">image_not_supported</span>
				<p class="text-sm font-medium text-primary">{get(LL).editor.noStockMediaResults()}</p>
				<p class="text-xs text-thirdly">{get(LL).editor.noStockMediaResultsMessage()}</p>
			</div>
		{:else}
			<div class="grid grid-cols-2 gap-3">
				{#each lib.results as result (result.id)}
					<StockMediaCard
						{result}
						onDownload={downloadAsset}
						isDownloading={lib.downloadingId === result.id}
					/>
				{/each}
			</div>

			{#if lib.hasMore}
				<button
					class="btn w-full py-2 text-xs"
					type="button"
					onclick={loadMore}
					disabled={lib.isLoading}
				>
					{lib.isLoading ? $LL.common.loading() : $LL.common.next()}
				</button>
			{/if}
		{/if}
	</div>
</div>
