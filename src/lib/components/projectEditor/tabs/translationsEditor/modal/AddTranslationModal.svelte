<script lang="ts">
	import { ProjectTranslation } from '$lib/classes/ProjectTranslation.svelte';
	import type { Edition } from '$lib/classes';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import {
		QdcTranslationService,
		type TranslationLanguageData,
		type TranslationMetadataMap
	} from '$lib/services/QdcTranslationService';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
	import { get } from 'svelte/store';
	import { onMount } from 'svelte';
	import toast from 'svelte-5-french-toast';

	type TranslationCopy = {
		addLanguageHeading: () => string;
		projectLanguage: () => string;
		quranEdition: () => string;
		quranEditionDescription: () => string;
		selectQuranEdition: () => string;
		languageAlreadyAdded: () => string;
		noQuranEditionAvailable: () => string;
		addingLanguage: () => string;
	};

	let { close }: { close: () => void } = $props();
	const copy = get(LL).translations as unknown as TranslationCopy;

	let catalog = $state<TranslationMetadataMap>({});
	let selectedLanguage = $state('');
	let selectedEditionName = $state('');
	let searchQuery = $state('');
	let isLoading = $state(true);
	let isAdding = $state(false);

	const addedLanguages = $derived(
		new Set(
			globalState.currentProject!.content.projectTranslation.addedTranslationEditions.map(
				(language) => language.language
			)
		)
	);
	const languages = $derived(
		Object.keys(catalog)
			.filter((language) => language.toLowerCase().includes(searchQuery.trim().toLowerCase()))
			.sort((left, right) => left.localeCompare(right))
	);
	const selectedLanguageData = $derived<TranslationLanguageData | null>(
		catalog[selectedLanguage] ?? null
	);
	const selectedEdition = $derived<Edition | null>(
		selectedLanguageData?.translations.find((edition) => edition.name === selectedEditionName) ??
			null
	);

	/**
	 * Fusionne les catalogues Quran historiques et Quran.com sans dupliquer une édition.
	 * @param {TranslationMetadataMap} legacy Catalogue embarqué historique.
	 * @param {TranslationMetadataMap} qdc Catalogue Quran.com.
	 * @returns {TranslationMetadataMap} Catalogue groupé par langue.
	 */
	function mergeCatalogs(
		legacy: TranslationMetadataMap,
		qdc: TranslationMetadataMap
	): TranslationMetadataMap {
		const merged: TranslationMetadataMap = {};
		for (const language of new Set([...Object.keys(legacy), ...Object.keys(qdc)])) {
			const base = legacy[language] ?? qdc[language];
			if (!base) continue;
			const editions = [
				...(legacy[language]?.translations ?? []),
				...(qdc[language]?.translations ?? [])
			];
			merged[language] = {
				...base,
				translations: editions.filter(
					(edition, index) => editions.findIndex((item) => item.name === edition.name) === index
				)
			};
		}
		return merged;
	}

	/**
	 * Sélectionne une langue et sa première édition Quran disponible.
	 * @param {string} language Langue choisie.
	 * @returns {void}
	 */
	function selectLanguage(language: string): void {
		selectedLanguage = language;
		selectedEditionName = catalog[language]?.translations[0]?.name ?? '';
	}

	/**
	 * Ajoute la langue et initialise les traductions libres du projet.
	 * @returns {Promise<void>} Promesse résolue après l'ajout.
	 */
	async function addLanguage(): Promise<void> {
		const edition = selectedEdition;
		if (!selectedLanguage || !edition || isAdding || addedLanguages.has(selectedLanguage)) return;

		isAdding = true;
		try {
			await ProjectHistoryManager.trackAsync('add translation language', async () => {
				await globalState.getProjectTranslation.addLanguage(selectedLanguage, edition);
			});
			await globalState.currentProject?.save(false);
			close();
		} catch (error) {
			console.error('Failed to add translation language:', error);
			toast.error(get(LL).translations.failedToAddTranslations());
		} finally {
			isAdding = false;
		}
	}

	onMount(async () => {
		try {
			await ProjectTranslation.loadAvailableTranslations();
			let qdcCatalog: TranslationMetadataMap = {};
			try {
				qdcCatalog = await QdcTranslationService.getAvailableTranslations(
					globalState.availableTranslations as TranslationMetadataMap
				);
			} catch (error) {
				console.warn('Quran.com translation catalog unavailable:', error);
			}
			catalog = mergeCatalogs(
				globalState.availableTranslations as TranslationMetadataMap,
				qdcCatalog
			);
			const firstAvailable = Object.keys(catalog).find(
				(language) => !addedLanguages.has(language) && catalog[language].translations.length > 0
			);
			if (firstAvailable) selectLanguage(firstAvailable);
		} finally {
			isLoading = false;
		}
	});
</script>

<div
	class="bg-secondary border-color border rounded-2xl w-[860px] max-w-[95vw] h-[700px] max-h-[92vh] shadow-2xl shadow-black flex flex-col overflow-hidden"
>
	<header class="bg-gradient-to-r from-accent to-bg-accent px-6 py-4 border-b border-color">
		<div class="flex items-center justify-between gap-4">
			<div class="flex items-center gap-3">
				<div class="w-9 h-9 bg-accent-primary rounded-full flex items-center justify-center">
					<span class="material-icons text-black">translate</span>
				</div>
				<div>
					<h2 class="text-xl font-bold text-primary">{copy.addLanguageHeading()}</h2>
					<p class="text-sm text-thirdly">{$LL.editor.chooseLanguageAndTranslation()}</p>
				</div>
			</div>
			<button class="btn btn-icon" onclick={close} aria-label={$LL.editor.closeButton()}>
				<span class="material-icons">close</span>
			</button>
		</div>
	</header>

	<div class="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)]">
		<section class="min-h-0 border-r border-color p-4 flex flex-col gap-3">
			<label class="text-xs font-semibold text-secondary" for="translation-language-search">
				{copy.projectLanguage()}
			</label>
			<input
				id="translation-language-search"
				type="search"
				bind:value={searchQuery}
				placeholder={$LL.translations.searchLanguagesOrAuthors()}
				class="w-full rounded-lg border border-color bg-primary px-3 py-2 text-sm text-primary"
			/>

			<div class="min-h-0 flex-1 overflow-y-auto space-y-1 pr-1">
				{#if isLoading}
					<div class="p-4 text-sm text-thirdly">{$LL.common.loading()}</div>
				{:else}
					{#each languages as language (language)}
						{@const data = catalog[language]}
						{@const isAdded = addedLanguages.has(language)}
						<button
							type="button"
							disabled={isAdded || data.translations.length === 0}
							class="w-full rounded-lg border px-3 py-2 text-left transition {selectedLanguage ===
							language
								? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/12'
								: 'border-transparent hover:border-color hover:bg-accent'} disabled:cursor-not-allowed disabled:opacity-45"
							onclick={() => selectLanguage(language)}
						>
							<div class="flex items-center gap-2">
								{#if data.flag}
									<img src={data.flag} alt={language} class="h-5 w-5 rounded-sm" />
								{/if}
								<span class="min-w-0 flex-1 truncate text-sm font-medium text-primary"
									>{language}</span
								>
								<span class="text-xs text-thirdly">{data.translations.length}</span>
							</div>
							{#if isAdded}
								<p class="mt-1 text-xs text-thirdly">{copy.languageAlreadyAdded()}</p>
							{:else if data.translations.length === 0}
								<p class="mt-1 text-xs text-thirdly">{copy.noQuranEditionAvailable()}</p>
							{/if}
						</button>
					{/each}
				{/if}
			</div>
		</section>

		<section class="min-h-0 overflow-y-auto p-6">
			{#if selectedLanguageData}
				<div class="space-y-5">
					<div>
						<p class="text-xs font-semibold uppercase tracking-[0.16em] text-thirdly">
							{copy.projectLanguage()}
						</p>
						<h3 class="mt-1 text-2xl font-semibold text-primary">{selectedLanguage}</h3>
					</div>

					<div class="rounded-xl border border-color bg-accent p-4">
						<label class="text-sm font-semibold text-primary" for="quran-translation-edition">
							{copy.quranEdition()}
						</label>
						<p class="mt-1 text-xs leading-relaxed text-thirdly">
							{copy.quranEditionDescription()}
						</p>
						<select
							id="quran-translation-edition"
							bind:value={selectedEditionName}
							class="mt-4 w-full rounded-lg border border-color bg-primary px-3 py-2.5 text-sm text-primary"
						>
							<option value="" disabled>{copy.selectQuranEdition()}</option>
							{#each selectedLanguageData.translations as edition (edition.name)}
								<option value={edition.name}>{edition.author}</option>
							{/each}
						</select>
					</div>

					{#if selectedEdition}
						<div class="rounded-xl border border-color bg-primary/40 p-4">
							<p class="text-sm font-semibold text-primary">{selectedEdition.author}</p>
							<p class="mt-1 text-xs text-thirdly">{selectedEdition.source}</p>
							{#if selectedEdition.comments}
								<p class="mt-3 text-sm leading-relaxed text-secondary">
									{selectedEdition.comments}
								</p>
							{/if}
						</div>
					{/if}
				</div>
			{:else if !isLoading}
				<div class="h-full flex items-center justify-center text-sm text-thirdly">
					{$LL.translations.pleaseSelectTranslations()}
				</div>
			{/if}
		</section>
	</div>

	<footer class="flex justify-end gap-3 border-t border-color bg-primary/60 px-6 py-4">
		<button class="btn px-5 py-2" onclick={close}>{$LL.translations.cancel()}</button>
		<button
			class="btn-accent px-5 py-2 font-semibold"
			disabled={!selectedEdition || isAdding || addedLanguages.has(selectedLanguage)}
			onclick={() => void addLanguage()}
		>
			{isAdding ? copy.addingLanguage() : $LL.translations.add()}
		</button>
	</footer>
</div>
