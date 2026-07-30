<script lang="ts">
	import { Edition } from '$lib/classes';
	import { globalState } from '$lib/runes/main.svelte';
	import { AnalyticsService } from '$lib/services/AnalyticsService';
	import {
		QdcTranslationService,
		type QdcAvailableTranslationsMap,
		type TranslationLanguageData
	} from '$lib/services/QdcTranslationService';
	import { onMount } from 'svelte';
	import toast from 'svelte-5-french-toast';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
	import { mobileModalSheet } from '$lib/services/mobileModalSheet';

	let { close } = $props();
	let selectedTranslations: Edition[] = $state([]);
	let searchQuery: string = $state('');
	let translationPreviews: Record<string, Record<string, string>> = $state({});
	let isLoadingPreview = $state(false);
	let activeTranslationsTab = $state<'quran-api' | 'quran-com-api'>('quran-api');
	let qdcTranslations = $state<QdcAvailableTranslationsMap>({});
	let isLoadingQdcTranslations = $state(false);
	let qdcTranslationsError: string | null = $state(null);

	type AvailableTranslationsMap = Record<string, TranslationLanguageData>;

	// Helper function to check if a translation is selected
	function isTranslationSelected(translation: Edition): boolean {
		return selectedTranslations.some((t) => t.name === translation.name);
	}

	// Toggle translation selection
	function toggleTranslationSelection(translation: Edition) {
		if (isTranslationSelected(translation)) {
			// Remove from selection
			selectedTranslations = selectedTranslations.filter((t) => t.name !== translation.name);
			delete translationPreviews[translation.name];
		} else {
			// Add to selection
			selectedTranslations = [...selectedTranslations, translation];
			// Load preview for this translation
			loadTranslationPreview(translation);
		}
	}

	// Load preview for a specific translation
	async function loadTranslationPreview(translation: Edition) {
		if (translationPreviews[translation.name]) return; // Already loaded

		isLoadingPreview = true;
		try {
			const preview =
				await globalState.currentProject!.content.projectTranslation.getAllProjectSubtitlesTranslations(
					translation
				);
			translationPreviews[translation.name] = preview;
		} catch (_error) {
			translationPreviews[translation.name] = {};
		}
		isLoadingPreview = false;
	}

	/**
	 * Charge les traductions Quran.com API pour le second onglet.
	 */
	async function loadQdcTranslations(): Promise<void> {
		if (Object.keys(qdcTranslations).length > 0) return;

		isLoadingQdcTranslations = true;
		qdcTranslationsError = null;
		try {
			qdcTranslations = await QdcTranslationService.getAvailableTranslations(
				globalState.availableTranslations as AvailableTranslationsMap
			);
			globalState.qdcAvailableTranslations = qdcTranslations;
		} catch (error) {
			qdcTranslationsError = get(LL).editor.qdcApiUnavailable();
			console.error('Error loading QDC translations:', error);
		} finally {
			isLoadingQdcTranslations = false;
		}
	}

	/**
	 * Filtre un groupe de traductions selon la recherche courante.
	 * @param translationsMap Les traductions a filtrer.
	 * @returns Les traductions filtrées.
	 */
	function filterTranslationsMap(
		translationsMap: AvailableTranslationsMap
	): AvailableTranslationsMap {
		if (!searchQuery) return translationsMap;

		const filtered: AvailableTranslationsMap = {};
		const query = searchQuery.toLowerCase();

		for (const [language, data] of Object.entries(translationsMap)) {
			if (language.toLowerCase().includes(query)) {
				filtered[language] = data;
				continue;
			}

			const matchingTranslations = data.translations.filter((translation) =>
				translation.author.toLowerCase().includes(query)
			);
			if (matchingTranslations.length === 0) continue;

			filtered[language] = {
				...data,
				translations: matchingTranslations
			};
		}

		return filtered;
	}

	const filteredQuranApiTranslations = $derived(() =>
		filterTranslationsMap(globalState.availableTranslations as AvailableTranslationsMap)
	);
	const filteredQdcTranslations = $derived(() => filterTranslationsMap(qdcTranslations));
	const activeFilteredTranslations = $derived(() =>
		activeTranslationsTab === 'quran-api'
			? filteredQuranApiTranslations()
			: filteredQdcTranslations()
	);
	async function addTranslationButtonClick() {
		if (selectedTranslations.length > 0) {
			try {
				// Add all selected translations to the project in a single operation
				for (const translation of selectedTranslations) {
					const preview = translationPreviews[translation.name] || {};
					globalState.currentProject?.content.projectTranslation.addTranslation(
						translation,
						preview
					);
					AnalyticsService.trackTranslationAdded(
						translation.name,
						translation.author,
						translation.key,
						translation.language
					);
				}
				close();
			} catch (error) {
				toast.error(get(LL).translations.failedToAddTranslations());
				console.error('Error adding translations:', error);
			}
		}
	}

	let recentTranslations: Edition[] = $state([]);

	onMount(async () => {
		await loadQdcTranslations();

		// Récupérer les éditions de traduction des 10 derniers projets ouverts (pour avoir des traductions récentes)
		const recentProjects = globalState.userProjectsDetails
			.filter((p) => p.updatedAt)
			.sort((a, b) => b.updatedAt!.getTime() - a.updatedAt!.getTime())
			.slice(0, 10);

		const recentEditionsSet = new Set<string>();
		for (const projectDetail of recentProjects) {
			if (projectDetail.id === globalState.currentProject?.detail.id) continue; // Skip current project

			for (const editionName of Object.keys(projectDetail.translations)) {
				if (!recentEditionsSet.has(editionName)) {
					const edition = globalState.getEditionFromAuthor(editionName);
					if (edition) {
						recentTranslations.push(edition);
						recentEditionsSet.add(editionName);
					}
				}
			}
		}
	});
</script>

<div
	class="relative flex h-[700px] w-full flex-col overflow-hidden rounded-2xl border border-color bg-secondary shadow-2xl shadow-black"
	use:mobileModalSheet={close}
>
	<!-- Header with gradient background -->
	<div class="border-b border-color bg-gradient-to-r from-accent to-bg-accent px-4 py-3">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3">
				<div class="w-8 h-8 bg-accent-primary rounded-full flex items-center justify-center">
					<span class="material-icons text-black text-lg">translate</span>
				</div>
				<div>
					<h2 class="text-xl font-bold text-primary">{$LL.translations.addTranslationHeading()}</h2>
					<p class="text-sm text-thirdly">
						{$LL.editor.chooseLanguageAndTranslation()}
					</p>
				</div>
			</div>

			<!-- Close button -->
			<button
				class="w-8 h-8 rounded-full hover:bg-[rgba(255,255,255,0.1)] flex items-center justify-center transition-all duration-200 text-secondary hover:text-primary cursor-pointer"
				onclick={close}
			>
				<span class="material-icons text-lg">close</span>
			</button>
		</div>
	</div>
	<!-- Search bar -->
	<div class="space-y-3 border-b border-color bg-primary px-4 py-3">
		<div class="relative w-full">
			<input
				type="text"
				placeholder={$LL.editor.searchLanguagesOrAuthors()}
				bind:value={searchQuery}
				class="w-full rounded-xl border border-color bg-secondary py-3 pr-4 pl-10! text-primary transition-all duration-200 focus:border-accent-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:ring-opacity-20"
			/>

			<span class="material-icons absolute left-3 top-1/2 -translate-y-1/2 transform text-thirdly"
				>search</span
			>
		</div>

		<div class="flex items-center justify-between gap-3">
			{#if recentTranslations.length > 0 && !searchQuery}
				<div class="flex min-w-0 items-center gap-2">
					<span class="material-icons text-accent-primary text-sm">history</span>
					<span class="truncate text-sm font-medium text-primary">
						{$LL.editor.recentTranslations()}
					</span>
				</div>
			{:else}
				<div></div>
			{/if}

			<div class="flex shrink-0 items-center rounded-lg border border-color bg-secondary p-0.5">
				<button
					class="rounded-md px-2 py-1 text-xs transition-all duration-200 {activeTranslationsTab ===
					'quran-api'
						? 'bg-[rgba(88,166,255,0.14)] text-primary shadow-[inset_0_0_0_1px_rgba(88,166,255,0.35)]'
						: 'text-thirdly hover:text-primary'}"
					aria-pressed={activeTranslationsTab === 'quran-api'}
					onclick={() => (activeTranslationsTab = 'quran-api')}
				>
					{$LL.editor.quranApi()}
				</button>
				<button
					class="rounded-md px-2 py-1 text-xs transition-all duration-200 {activeTranslationsTab ===
					'quran-com-api'
						? 'bg-[rgba(88,166,255,0.14)] text-primary shadow-[inset_0_0_0_1px_rgba(88,166,255,0.35)]'
						: 'text-thirdly hover:text-primary'}"
					aria-pressed={activeTranslationsTab === 'quran-com-api'}
					onclick={() => (activeTranslationsTab = 'quran-com-api')}
				>
					{$LL.editor.quranCom()}
				</button>
			</div>
		</div>

		{#if recentTranslations.length > 0 && !searchQuery}
			<div class="recent-translations-scroll flex w-full gap-2 overflow-x-auto pb-1">
				{#each recentTranslations as translation (translation.key)}
					{@const isSelected = isTranslationSelected(translation)}
					{@const isQdcTranslation = QdcTranslationService.isQdcEdition(translation)}
					<button
						class="flex shrink-0 items-center gap-1.5 rounded-lg border border-color bg-secondary px-2.5 py-1.5 text-xs transition-all duration-200 hover:border-accent-primary
							       {isSelected ? 'border-accent-primary bg-[rgba(88,166,255,0.1)]' : ''}"
						onclick={() => toggleTranslationSelection(translation)}
					>
						{#if isSelected}
							<span class="material-icons text-accent-primary" style="font-size: 12px;"
								>check_circle</span
							>
						{:else}
							<span class="material-icons text-thirdly opacity-50" style="font-size: 12px;"
								>add_circle_outline</span
							>
						{/if}
						<span class="text-primary font-medium">{translation.author}</span>
						<span class="text-[10px] uppercase tracking-wide text-thirdly">
							({isQdcTranslation ? 'QDC' : 'QAPI'})
						</span>
					</button>
				{/each}
			</div>
		{/if}
	</div>
	<!-- Content area -->
	<div class="flex-1 overflow-hidden">
		{#if selectedTranslations.length > 0}
			<div class="h-full overflow-y-auto">
				<!-- Selection -->
				<div class="px-3 py-3">
					<div class="mb-3">
						<h3 class="mb-1 text-base font-semibold text-primary">
							{$LL.translations.availableTranslations()}
						</h3>
						<p class="text-xs text-thirdly">
							{$LL.editor.translationsSelected({ count: selectedTranslations.length })}
						</p>
					</div>

					<div class="space-y-3">
						{#if activeTranslationsTab === 'quran-com-api' && isLoadingQdcTranslations}
							<div class="bg-accent border border-color rounded-lg p-6 text-center">
								<div
									class="w-8 h-8 border-2 border-accent-primary border-t-transparent rounded-full animate-spin mx-auto mb-3"
								></div>
								<p class="text-sm text-thirdly">{$LL.editor.loadingQdcTranslations()}</p>
							</div>
						{:else if activeTranslationsTab === 'quran-com-api' && qdcTranslationsError}
							<div class="bg-accent border border-color rounded-lg p-4 text-sm text-red-400">
								{qdcTranslationsError}
							</div>
						{/if}

						{#each Object.keys(activeFilteredTranslations()) as language (language)}
							{@const translationFlag = activeFilteredTranslations()[language].flag}
							{@const translations = activeFilteredTranslations()[language].translations}

							<!-- Language section -->
							<div class="overflow-hidden rounded-lg border border-color bg-accent">
								<!-- Language header -->
								<div
									class="flex items-center gap-2 border-b border-color bg-gradient-to-r from-bg-secondary to-bg-accent p-2"
								>
									{#if translationFlag}
										<img src={translationFlag} alt={language} class="h-5 w-5 shadow-lg" />
									{:else}
										<div class="h-5 w-5 shrink-0 rounded-sm border border-color bg-black"></div>
									{/if}
									<div>
										<h4 class="text-sm font-semibold text-primary">{language}</h4>
										<p class="text-[11px] text-thirdly">
											{$LL.editor.availableCount({ count: translations.length })}
										</p>
									</div>
								</div>

								<!-- Translations -->
								<div class="space-y-1.5 p-2">
									{#each translations as translationDetail (translationDetail.key)}
										{@const isSelected = isTranslationSelected(translationDetail)}
										<button
											class="w-full rounded-md border border-color bg-secondary p-2 text-left transition-all duration-200 hover:border-accent-primary
											       {isSelected ? 'border-accent-primary bg-[rgba(88,166,255,0.1)]' : ''}"
											onclick={() => toggleTranslationSelection(translationDetail)}
										>
											<div class="flex items-center justify-between">
												<div class="flex items-center gap-2">
													{#if translationDetail.comments === 'Ponctuation' || translationDetail.comments === 'Saheeh International'}
														<span class="material-icons text-yellow-200 text-sm">star</span>
													{/if}
													<span class="text-xs font-medium text-primary"
														>{translationDetail.author}</span
													>
												</div>
												{#if isSelected}
													<span class="material-icons text-accent-primary text-sm"
														>check_circle</span
													>
												{:else}
													<span class="material-icons text-thirdly text-sm opacity-50"
														>radio_button_unchecked</span
													>
												{/if}
											</div>
										</button>
									{/each}
								</div>
							</div>
						{/each}
					</div>
				</div>

				<!-- Preview -->
				<div class="border-t border-color px-3 py-3">
					<div class="mb-4">
						<h3 class="text-lg font-semibold text-primary mb-2">
							{$LL.editor.translationPreviews()}
						</h3>
						<p class="text-sm text-thirdly">
							{$LL.editor.previewDescription()}
						</p>
					</div>

					{#if isLoadingPreview}
						<!-- Loading state -->
						<div class="flex items-center justify-center py-12">
							<div class="text-center">
								<div
									class="w-8 h-8 border-2 border-accent-primary border-t-transparent rounded-full animate-spin mx-auto mb-3"
								></div>
								<p class="text-sm text-thirdly">{$LL.editor.translationPreview()}</p>
							</div>
						</div>
					{:else if selectedTranslations.length === 0}
						<!-- Empty state -->
						<div class="flex items-center justify-center py-12">
							<div class="text-center">
								<div
									class="w-12 h-12 bg-accent rounded-full flex items-center justify-center mb-3 mx-auto"
								>
									<span class="material-icons text-thirdly">translate</span>
								</div>
								<p class="text-sm text-thirdly">{$LL.editor.selectTranslationsForPreview()}</p>
							</div>
						</div>{:else if selectedTranslations.length === 1}
						<!-- Single translation - Full preview -->
						{@const translation = selectedTranslations[0]}
						{@const preview = translationPreviews[translation.name] || {}}

						<div class="mb-4">
							<div class="flex items-center gap-2 mb-2">
								<span class="material-icons text-accent-primary text-sm">translate</span>
								<h4 class="font-medium text-primary">{translation.author}</h4>
							</div>
						</div>

						{#if Object.keys(preview).length === 0}
							<div class="flex items-center justify-center py-12">
								<div class="text-center">
									<div
										class="w-12 h-12 bg-accent rounded-full flex items-center justify-center mb-3 mx-auto"
									>
										<span class="material-icons text-thirdly">translate</span>
									</div>
									<p class="text-sm text-thirdly">{$LL.editor.noVersesForTranslation()}</p>
								</div>
							</div>
						{:else}
							<!-- Full translation preview -->
							<div class="space-y-3">
								{#each Object.entries(preview) as [verseKey, translationText] (verseKey)}
									{@const [surah, verse] =
										verseKey.split(':').length === 2 ? verseKey.split(':') : [null, null]}
									<div
										class="bg-secondary border border-color rounded-lg p-4 hover:border-accent-primary transition-all duration-200"
									>
										<!-- Verse reference -->
										<div class="flex items-center gap-2 mb-2">
											<span
												class="bg-accent-primary text-black px-2 py-1 rounded-md text-xs font-semibold"
											>
												{verseKey}
											</span>
											{#if surah && verse}
												<span class="text-xs text-thirdly"
													>{$LL.editor.surahAndVerse({
														surah: Number(surah),
														verse: Number(verse)
													})}</span
												>
											{/if}
										</div>

										<!-- Translation text -->
										<p class="text-sm text-primary leading-relaxed">{translationText}</p>
									</div>
								{/each}
							</div>
						{/if}
					{:else}
						<!-- Multiple translations - Condensed preview showing first 3 verses max per translation -->
						<div class="space-y-4">
							{#each selectedTranslations as translation (translation.key)}
								{@const preview = translationPreviews[translation.name] || {}}
								<div class="border border-color rounded-lg p-4 bg-secondary">
									<div class="flex items-center gap-2 mb-3">
										<span class="material-icons text-accent-primary text-sm">translate</span>
										<h4 class="font-medium text-primary">{translation.author}</h4>
										{#if Object.keys(preview).length > 0}
											<span class="text-xs text-thirdly bg-accent px-2 py-1 rounded">
												{$LL.editor.versesCount({ count: Object.keys(preview).length })}
											</span>
										{/if}
									</div>

									{#if Object.keys(preview).length === 0}
										<p class="text-xs text-thirdly italic">{$LL.editor.loadingPreview()}</p>
									{:else}
										<!-- Show max 3 verses per translation in condensed mode -->
										<div class="space-y-2">
											{#each Object.entries(preview).slice(0, 3) as [verseKey, translationText] (verseKey)}
												<div class="bg-accent rounded p-3 border border-color">
													<div class="flex items-center gap-2 mb-2">
														<span
															class="bg-accent-primary text-black px-2 py-1 rounded text-xs font-semibold"
														>
															{verseKey}
														</span>
													</div>
													<!-- Truncate long texts in condensed mode -->
													<p class="text-xs text-primary leading-relaxed line-clamp-2">
														{translationText.length > 120
															? translationText.substring(0, 120) + '...'
															: translationText}
													</p>
												</div>
											{/each}
											{#if Object.keys(preview).length > 3}
												<div class="text-center">
													<span class="text-xs text-thirdly bg-bg-secondary px-3 py-1 rounded-full">
														{$LL.editor.moreVersesCount({ count: Object.keys(preview).length - 3 })}
													</span>
												</div>
											{/if}
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		{:else}
			<!-- Original single column layout when no translation selected -->
			<div class="h-full space-y-3 overflow-y-auto px-3 py-3">
				{#if activeTranslationsTab === 'quran-com-api' && isLoadingQdcTranslations}
					<div class="flex flex-col items-center justify-center h-full text-center">
						<div
							class="w-10 h-10 border-2 border-accent-primary border-t-transparent rounded-full animate-spin mb-4"
						></div>
						<p class="text-thirdly">{$LL.editor.loadingQdcTranslations()}</p>
					</div>
				{:else if activeTranslationsTab === 'quran-com-api' && qdcTranslationsError}
					<div class="flex flex-col items-center justify-center h-full text-center">
						<div class="w-16 h-16 bg-accent rounded-full flex items-center justify-center mb-4">
							<span class="material-icons text-red-400 text-2xl">error_outline</span>
						</div>
						<h3 class="text-lg font-semibold text-primary mb-2">
							{$LL.editor.qdcApiUnavailable()}
						</h3>
						<p class="text-thirdly max-w-md">{qdcTranslationsError}</p>
					</div>
				{:else if Object.keys(activeFilteredTranslations()).length === 0}
					<!-- Empty state -->
					<div class="flex flex-col items-center justify-center h-full text-center">
						<div class="w-16 h-16 bg-accent rounded-full flex items-center justify-center mb-4">
							<span class="material-icons text-thirdly text-2xl">search_off</span>
						</div>
						<h3 class="text-lg font-semibold text-primary mb-2">
							{$LL.editor.noTranslationsFoundModal()}
						</h3>
						<p class="text-thirdly max-w-md">
							{#if searchQuery}
								{$LL.editor.noTranslationsMatchSearch()}
							{:else}
								{$LL.editor.noTranslationsAvailable()}
							{/if}
						</p>
						{#if searchQuery}
							<button class="btn mt-4 px-4 py-2" onclick={() => (searchQuery = '')}>
								{$LL.editor.clearSearch()}
							</button>
						{/if}
					</div>
				{:else}
					{#each Object.keys(activeFilteredTranslations()) as language (language)}
						{@const translationFlag = activeFilteredTranslations()[language].flag}
						{@const translations = activeFilteredTranslations()[language].translations}

						<!-- Language section -->
						<div class="overflow-hidden rounded-lg border border-color bg-accent">
							<!-- Language header -->
							<div
								class="flex items-center gap-2 border-b border-color bg-gradient-to-r from-bg-secondary to-bg-accent p-2"
							>
								<div class="relative">
									{#if translationFlag}
										<img src={translationFlag} alt={language} class="h-5 w-5 shadow-lg" />
									{:else}
										<div class="h-5 w-5 shrink-0 rounded-sm border border-color bg-black"></div>
									{/if}
								</div>
								<div>
									<h3 class="text-sm font-semibold text-primary">{language}</h3>
									<p class="text-xs text-thirdly">
										{$LL.editor.availableCount({ count: translations.length })}
									</p>
								</div>
							</div>

							<!-- Translations grid -->
							<div class="p-2">
								<div class="grid grid-cols-1 gap-2">
									{#each translations as translationDetail (translationDetail.key)}
										{@const isSelected = isTranslationSelected(translationDetail)}
										<button
											class="group relative cursor-pointer rounded-md border border-color bg-secondary p-2.5 text-left transition-all duration-200 hover:border-accent-primary hover:bg-[rgba(88,166,255,0.05)]
											       {isSelected ? 'border-accent-primary bg-[rgba(88,166,255,0.1)]' : ''}"
											onclick={() => toggleTranslationSelection(translationDetail)}
										>
											<!-- Selection indicator -->
											<div
												class="absolute top-2 right-2 flex h-4 w-4 items-center justify-center rounded-full border-2 border-accent-primary transition-all duration-200
												       {isSelected
													? 'bg-accent-primary'
													: 'group-hover:bg-accent-primary group-hover:bg-opacity-20'}"
											>
												{#if isSelected}
													<span class="material-icons text-black text-xs">check</span>
												{/if}
											</div>

											<!-- Content -->
											<div class="cursor-pointer pr-6">
												<h4
													class="flex items-center text-sm font-semibold text-primary transition-colors duration-200 group-hover:text-accent-primary"
												>
													{#if translationDetail.comments === 'Ponctuation' || translationDetail.comments === 'Saheeh International'}
														<!-- star icon -->
														<span class="material-icons text-yellow-200 text-xs mr-1">star</span>
													{/if}
													{translationDetail.author}
												</h4>
											</div>

											<!-- Hover effect -->
											<div
												class="absolute inset-0 rounded-lg bg-gradient-to-r from-transparent to-accent-primary opacity-0 group-hover:opacity-5 transition-opacity duration-200 cursor-pointer"
											></div>
										</button>
									{/each}
								</div>
							</div>
						</div>
					{/each}
				{/if}
			</div>
		{/if}
	</div>
	<!-- Footer with action buttons -->
	<div class="border-t border-color bg-primary px-3 py-3">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-2 text-sm text-thirdly">
				{#if selectedTranslations.length > 0}
					<span class="material-icons text-accent-secondary">check_circle</span>
					<span>
						{$LL.editor.selectedCount({ count: selectedTranslations.length })}
					</span>
				{:else}{/if}
			</div>

			<div class="flex gap-3">
				<button class="btn px-4 py-2 font-medium" onclick={close}>
					{$LL.common.cancel()}
				</button>
				<button
					class="btn-accent flex items-center gap-2 px-4 py-2 font-medium disabled:cursor-not-allowed disabled:opacity-50"
					onclick={addTranslationButtonClick}
					disabled={selectedTranslations.length === 0}
				>
					<span class="material-icons text-lg">add</span>
					{$LL.translations.addTranslation()}
				</button>
			</div>
		</div>
	</div>
</div>

<style>
	/* Custom scrollbar */
	.overflow-y-auto::-webkit-scrollbar {
		width: 8px;
	}

	.overflow-y-auto::-webkit-scrollbar-track {
		background: var(--bg-secondary);
		border-radius: 4px;
	}

	.overflow-y-auto::-webkit-scrollbar-thumb {
		background: var(--timeline-scrollbar);
		border-radius: 4px;
		transition: background 0.2s ease;
	}

	.overflow-y-auto::-webkit-scrollbar-thumb:hover {
		background: var(--timeline-scrollbar-hover);
	}

	.recent-translations-scroll::-webkit-scrollbar {
		height: 4px;
	}

	.recent-translations-scroll {
		scrollbar-width: thin;
		scrollbar-color: var(--timeline-scrollbar) transparent;
	}

	.recent-translations-scroll::-webkit-scrollbar-thumb {
		border-radius: 9999px;
		background: var(--timeline-scrollbar);
	}

	/* Line clamp utility for text truncation */
	.line-clamp-2 {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	/* Smooth animations */
	@keyframes slideInUp {
		from {
			opacity: 0;
			transform: translateY(20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.bg-secondary {
		animation: slideInUp 0.3s ease-out;
	}

	/* Enhanced gradient backgrounds */
	.bg-gradient-to-r.from-accent.to-bg-accent {
		background: linear-gradient(135deg, var(--bg-accent) 0%, var(--bg-secondary) 100%);
	}

	.bg-gradient-to-r.from-bg-secondary.to-bg-accent {
		background: linear-gradient(90deg, var(--bg-secondary) 0%, var(--bg-accent) 100%);
	}

	/* Enhanced hover effects */
	button:hover {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
	}

	.btn-accent:hover {
		box-shadow: 0 4px 16px rgba(88, 166, 255, 0.3);
	}

	/* Flag image enhancements */
	img[alt] {
		object-fit: cover;
		transition: transform 0.2s ease;
	}

	img[alt]:hover {
		transform: scale(1.1);
	}

	/* Selection indicator animation */
	.group:hover .absolute.top-2.right-2 {
		animation: pulse 2s infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.7;
		}
	}

	/* Enhanced focus states */
	input:focus {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(88, 166, 255, 0.2);
	}

	/* Better disabled state */
	button:disabled {
		transform: none !important;
		box-shadow: none !important;
	}
</style>
