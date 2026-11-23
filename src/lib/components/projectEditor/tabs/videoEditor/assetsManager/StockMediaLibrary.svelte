<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { appDataDir, join } from '@tauri-apps/api/path';
	import { get } from 'svelte/store';
	import LL from '$lib/i18n/i18n-svelte';
	import { onDestroy } from 'svelte';
	import StockMediaCard from './StockMediaCard.svelte';
	import type { StockMediaResult, StockMediaSource } from './stockMediaTypes';
	import { SourceType } from '$lib/classes';
	import toast from 'svelte-5-french-toast';
	import {
		downloadFileWithProgress,
		type DownloadProgress
	} from '$lib/services/DownloadWithProgress';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';

	let {
		onBack,
		hideHeader = false
	}: {
		onBack?: () => void;
		hideHeader?: boolean;
	} = $props();

	const lib = $derived(globalState.stockMediaLibrary);
	let searchQuery = $state('');
	type SearchResponse = {
		results: StockMediaResult[];
		hasMore: boolean;
		pinterestBookmarks?: [string | null, string | null];
	};

	const pageSize = 30;
	const cacheLifetime = 5 * 60 * 1000;
	const cacheLimit = 100;
	const pageCache = new Map<string, { expiresAt: number; response: Promise<SearchResponse> }>();
	let orientation = $state('all');
	let duration = $state('all');
	let resolution = $state(0);
	let searchRequest = 0;
	let pendingResults: StockMediaResult[] = [];
	let seenResults = new Set<string>();
	let hasMorePages = false;
	let pinterestBookmarks: SearchResponse['pinterestBookmarks'];
	const sources = ['pinterest', 'pixabay', 'pexels'] as const;
	const sourceTypes = {
		pexels: SourceType.Pexels,
		pixabay: SourceType.Pixabay,
		pinterest: SourceType.Pinterest
	};

	let downloadProgress = $state<DownloadProgress | null>(null);

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
		if (!settings || source === 'pinterest') return '';
		if (source === 'pexels') return settings.stockMediaSettings.pexelsApiKey;
		return settings.stockMediaSettings.pixabayApiKey;
	}

	/**
	 * Applique les filtres aux dimensions et a la duree du resultat.
	 * @param {StockMediaResult} result Media a filtrer.
	 * @returns {boolean} Indique si le media satisfait les filtres actifs.
	 */
	function matchesFilters(result: StockMediaResult): boolean {
		const { width, height } = result;
		if (resolution && Math.min(width, height) < resolution) return false;
		if (orientation !== 'all') {
			if (!width || !height) return false;
			const shape = width === height ? 'square' : width > height ? 'landscape' : 'portrait';
			if (shape !== orientation) return false;
		}
		if (duration === 'all' || lib.mediaType === 'photo') return true;
		const seconds = result.duration;
		if (result.type !== 'video' || !seconds) return false;
		if (duration === 'short') return seconds < 15;
		if (duration === 'medium') return seconds >= 15 && seconds < 30;
		return seconds >= 30;
	}

	/**
	 * Reutilise une page brute pour une meme recherche, independamment des filtres locaux.
	 * @param {number} page Numero de la page du fournisseur.
	 * @param {string} apiKey Cle API de la source, si applicable.
	 * @returns {Promise<SearchResponse>} Page brute et curseurs de la source.
	 */
	function fetchPage(page: number, apiKey: string): Promise<SearchResponse> {
		const args = {
			query: lib.searchQuery,
			source: lib.source,
			mediaType: lib.mediaType,
			apiKey,
			page,
			perPage: pageSize,
			pinterestBookmarks
		};
		const key = JSON.stringify(args);
		const now = Date.now();
		const cached = pageCache.get(key);
		if (cached && cached.expiresAt > now) return cached.response;

		pageCache.delete(key);
		if (pageCache.size >= cacheLimit) {
			const oldest = pageCache.keys().next();
			if (!oldest.done) pageCache.delete(oldest.value);
		}
		const response = invoke<SearchResponse>('search_stock_media', args).catch((error) => {
			if (pageCache.get(key)?.response === response) pageCache.delete(key);
			throw error;
		});
		pageCache.set(key, { expiresAt: now + cacheLifetime, response });
		return response;
	}

	/**
	 * Relance la recherche avec les filtres courants.
	 * @returns {Promise<void>} Promesse resolue apres le premier lot.
	 */
	async function doSearch() {
		searchRequest++;
		lib.searchQuery = searchQuery.trim();
		lib.page = 0;
		lib.error = null;
		lib.results = [];
		lib.isLoading = false;
		hasMorePages = lib.source === 'pinterest' || Boolean(getApiKey());
		lib.hasMore = hasMorePages;
		pinterestBookmarks = undefined;
		pendingResults = [];
		seenResults = new Set();
		await loadMore();
	}

	async function loadMore() {
		if (lib.isLoading || !lib.hasMore) return;
		const apiKey = getApiKey();
		if (lib.source !== 'pinterest' && !apiKey) return;

		const request = searchRequest;
		lib.isLoading = true;
		lib.error = null;

		try {
			let remaining = pageSize;
			while (remaining > 0) {
				if (pendingResults.length) {
					const results = pendingResults.splice(0, remaining);
					lib.results = [...lib.results, ...results];
					remaining -= results.length;
				}
				if (!remaining || !hasMorePages) break;

				const response = await fetchPage(lib.page + 1, apiKey);
				if (request !== searchRequest) return;
				for (const result of response.results) {
					if (seenResults.has(result.id) || !matchesFilters(result)) continue;
					seenResults.add(result.id);
					pendingResults.push(result);
				}
				lib.page++;
				hasMorePages = response.hasMore;
				pinterestBookmarks = response.pinterestBookmarks;
			}
		} catch (e) {
			if (request === searchRequest) lib.error = String(e);
		} finally {
			if (request === searchRequest) {
				lib.hasMore = hasMorePages || pendingResults.length > 0;
				lib.isLoading = false;
			}
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter') doSearch();
	}

	function setSource(source: StockMediaSource) {
		if (lib.source === source) return;
		globalState.stockMediaLibrary.source = source;
		doSearch();
	}

	function setMediaType(type: 'all' | 'photo' | 'video') {
		if (lib.mediaType === type) return;
		globalState.stockMediaLibrary.mediaType = type;
		doSearch();
	}

	/**
	 * Télécharge le média et ajoute les vidéos à la piste vidéo du projet courant.
	 * @param {StockMediaResult} result Média sélectionné.
	 * @returns {Promise<void>} Promesse résolue après l'import.
	 */
	async function downloadAsset(result: StockMediaResult): Promise<void> {
		const project = globalState.currentProject;
		if (!project || lib.downloadingId !== null) return;
		const sourceType = sourceTypes[result.source];
		try {
			globalState.stockMediaLibrary.downloadingId = result.id;
			downloadProgress = null;

			const pinterestExtension =
				result.source === 'pinterest'
					? new URL(result.downloadUrl).pathname.split('.').pop()?.toLowerCase()
					: undefined;
			let fullPath: string;
			if (pinterestExtension === 'm3u8') {
				fullPath = await invoke<string>('download_pinterest_hls', {
					url: result.downloadUrl,
					id: result.id,
					expectedDuration: result.duration
				});
			} else {
				const downloadDir = await join(await appDataDir(), 'downloads', 'stock-media');
				const ext = result.type === 'video' ? 'mp4' : (pinterestExtension ?? 'jpg');
				fullPath = await join(downloadDir, `${result.id}.${ext}`);
				await downloadFileWithProgress(result.downloadUrl, fullPath, (progress) => {
					downloadProgress = progress;
				});
			}

			if (globalState.currentProject !== project) return;
			const importedAsset = await ProjectHistoryManager.trackAsync(
				'import stock media',
				async () => {
					const asset = project.content.addAsset(fullPath, result.pageUrl, sourceType, {
						authorName: result.authorName,
						authorUrl: result.authorUrl,
						skipConstantBitrateWarning: true
					});
					if (asset && result.type === 'video') {
						await asset.ensureDurationLoaded();
						if (globalState.currentProject === project) globalState.getVideoTrack.addAsset(asset);
					}
					return asset;
				}
			);

			toast.success(get(LL).editor.downloadSuccessful());
			if (importedAsset && sourceType === SourceType.Pinterest) {
				const key = `pinterest-usage-disclaimer:${project.detail.id}`;
				let showDisclaimer = true;
				try {
					showDisclaimer = localStorage.getItem(key) !== '1';
					if (showDisclaimer) localStorage.setItem(key, '1');
				} catch {
					// Le toast reste disponible si le stockage local est indisponible.
				}
				if (showDisclaimer) {
					toast(get(LL).editor.pinterestUsageDisclaimer(), {
						icon: '⚠️',
						position: 'bottom-left',
						duration: 4000,
						style: 'max-width: 420px; border: 1px solid #f59e0b; text-align: start;'
					});
				}
			}
		} catch (e) {
			toast.error(get(LL).editor.stockMediaDownloadError({ error: String(e) }));
		} finally {
			globalState.stockMediaLibrary.downloadingId = null;
			downloadProgress = null;
		}
	}

	let scrollContainer: HTMLDivElement | undefined = $state();

	function handleScroll() {
		if (!scrollContainer || lib.error) return;
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
			if (searchQuery.trim() || (lib.source === 'pinterest' && lib.searchQuery)) doSearch();
		}, 400);
		return () => clearTimeout(searchDebounce);
	});

	onDestroy(() => {
		searchRequest++;
		lib.isLoading = false;
		lib.hasMore = false;
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
		<div class="grid grid-cols-3 border-b border-color">
			{#each sources as source (source)}
				<button
					class="min-w-0 border-b-2 px-1 py-2 text-sm font-medium transition-colors hover:text-primary {lib.source ===
					source
						? 'border-[var(--accent-primary)] text-[var(--accent-primary)]'
						: 'border-transparent text-secondary'}"
					type="button"
					aria-pressed={lib.source === source}
					onclick={() => setSource(source)}
				>
					{get(LL).editor[`${source}Source`]()}
				</button>
			{/each}
		</div>

		<!-- Barre de recherche -->
		<div class="relative">
			<span
				class="material-icons-outlined pointer-events-none absolute start-2 top-1/2 -translate-y-1/2 text-sm text-thirdly"
			>
				search
			</span>
			<input
				bind:value={searchQuery}
				onkeydown={handleKeyDown}
				class="h-9 w-full rounded-md border border-color bg-primary py-1 ps-8 pe-2 text-xs text-primary outline-none transition-colors placeholder:text-thirdly focus:border-[var(--accent-primary)]"
				type="search"
				placeholder={get(LL).editor.searchStockMedia()}
			/>
		</div>

		<div
			class="grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg border border-color bg-primary/30 p-2.5"
		>
			<label class="flex min-w-0 flex-col gap-1 text-xs text-secondary">
				{get(LL).common.type()}
				<select
					class="btn min-w-0 p-1.5 text-xs"
					value={lib.mediaType}
					onchange={(event) => setMediaType(event.currentTarget.value as typeof lib.mediaType)}
				>
					<option value="video">{get(LL).editor.videos()}</option>
					<option value="photo">{get(LL).editor.images()}</option>
					<option value="all">{get(LL).editor.allMedia()}</option>
				</select>
			</label>
			<label class="flex min-w-0 flex-col gap-1 text-xs text-secondary">
				{get(LL).export.orientation()}
				<select
					class="btn min-w-0 p-1.5 text-xs"
					bind:value={orientation}
					onchange={() => queueMicrotask(doSearch)}
				>
					<option value="all">{get(LL).common.all()}</option>
					<option value="portrait">{get(LL).style.orientationPortrait()}</option>
					<option value="landscape">{get(LL).style.orientationLandscape()}</option>
					<option value="square">{get(LL).style.orientationSquare()}</option>
				</select>
			</label>
			<label class="flex min-w-0 flex-col gap-1 text-xs text-secondary">
				{get(LL).home.duration()}
				<select
					class="btn min-w-0 p-1.5 text-xs"
					bind:value={duration}
					onchange={() => queueMicrotask(doSearch)}
					disabled={lib.mediaType === 'photo'}
				>
					<option value="all">{get(LL).common.all()}</option>
					<option value="short">&lt; 0:15</option>
					<option value="medium">0:15 &ndash; &lt; 0:30</option>
					<option value="long">&ge; 0:30</option>
				</select>
			</label>
			<label class="flex min-w-0 flex-col gap-1 text-xs text-secondary">
				{get(LL).aiVideo.resolutionLabel()}
				<select
					class="btn min-w-0 p-1.5 text-xs"
					bind:value={resolution}
					onchange={() => queueMicrotask(doSearch)}
				>
					<option value={0}>{get(LL).common.all()}</option>
					<option value={720}>&ge; 720p</option>
					<option value={1080}>&ge; 1080p</option>
					<option value={2160}>&ge; 2160p</option>
				</select>
			</label>
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
		{#if lib.source !== 'pinterest' && !getApiKey()}
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
					<button class="btn px-2 py-1 text-xs" type="button" onclick={loadMore}>
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
		{:else if !lib.error && !lib.isLoading && lib.results.length === 0 && (lib.source === 'pinterest' || searchQuery.trim().length > 0 || orientation !== 'all' || duration !== 'all' || resolution > 0)}
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
						downloadDisabled={lib.downloadingId !== null}
						progress={lib.downloadingId === result.id ? downloadProgress : null}
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
			{:else if !lib.isLoading && !lib.error && lib.results.length > 0}
				<p class="border-t border-color py-2 text-center text-xs text-thirdly">
					{get(LL).editor.stockMediaEndOfResults()}
				</p>
			{/if}
		{/if}
	</div>
</div>
