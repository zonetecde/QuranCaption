<script lang="ts">
	import Settings from '$lib/classes/Settings.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { markInvalidAdvancedTrimTranslations } from '$lib/services/AdvancedAITrimming';
	import { WBW_TRANSLATION_LANGUAGES } from '$lib/services/WbwTranslationService';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
	import { onDestroy } from 'svelte';
	import toast from 'svelte-5-french-toast';
	import EditionViewer from './EditionViewer.svelte';

	const SEARCH_DEBOUNCE_MS = 250;

	let {
		setAddTranslationModalVisibility
	}: {
		setAddTranslationModalVisibility: (visible: boolean) => void;
	} = $props();

	// Variable locale pour le search query avant validation
	let localSearchQuery = $state(globalState.getTranslationsState.searchQuery);
	let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined;
	let isMarkingTranslationErrors = $state(false);

	$effect(() => {
		localSearchQuery = globalState.getTranslationsState.searchQuery;
	});

	$effect(() => {
		if (globalState.getTranslationsState.filters.error === undefined) {
			globalState.getTranslationsState.filters.error = true;
		}
	});

	// Fonction pour valider le search query
	function validateSearchQuery() {
		if (searchDebounceTimer !== undefined) {
			clearTimeout(searchDebounceTimer);
			searchDebounceTimer = undefined;
		}
		globalState.getTranslationsState.searchQuery = localSearchQuery;
	}

	/**
	 * Diffère l'application de la recherche pour éviter de recalculer les filtres à chaque frappe.
	 * @returns {void}
	 */
	function scheduleSearchQueryValidation(): void {
		if (searchDebounceTimer !== undefined) clearTimeout(searchDebounceTimer);
		searchDebounceTimer = setTimeout(validateSearchQuery, SEARCH_DEBOUNCE_MS);
	}

	// Gestionnaire pour la touche Entrée
	function handleSearchKeypress(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			validateSearchQuery();
		}
	}

	/**
	 * Récupère le nombre de sous-titres ayant un statut spécifique.
	 */
	let numberOfSubtitlesWithStatus = $derived((status: string) => {
		// Permet de trigger la réactivité en forçant la lecture des status
		const _ = globalState.getSubtitleClips.map((clip) => {
			for (const key in clip.translations) {
				const value = clip.translations[key];
				const _ = value.status;
			}
		});
		// Pareille lorsqu'on ajoute/supprime une édition de traduction
		for (const edition of globalState.currentProject!.content.projectTranslation
			.addedTranslationEditions) {
			const _ = edition.name;
		}

		return globalState.getSubtitleClips.filter((clip) => {
			for (const key in clip.translations) {
				const value = clip.translations[key];
				if (value.status === status) {
					return true;
				}
			}
		}).length;
	});

	/**
	 * Marque les traductions dont les ranges ne respectent pas les règles de trim.
	 *
	 * @returns {Promise<void>} Promesse résolue après la vérification.
	 */
	async function markTranslationErrors(): Promise<void> {
		if (isMarkingTranslationErrors) return;

		isMarkingTranslationErrors = true;
		try {
			let checkedSegments = 0;
			let markedSegments = 0;
			let erroredVerses = 0;

			for (const edition of globalState.currentProject!.content.projectTranslation
				.addedTranslationEditions) {
				const report = markInvalidAdvancedTrimTranslations(edition);
				checkedSegments += report.checkedSegments;
				markedSegments += report.markedSegments;
				erroredVerses += report.erroredVerses;
			}

			globalState.getTranslationsState.checkOnlyFilters(['error']);
			await globalState.currentProject?.save(false);

			if (markedSegments > 0) {
				toast.success(
					get(LL).editor.markedTranslationErrors({
						marked: markedSegments,
						checked: checkedSegments,
						verses: erroredVerses
					})
				);
			} else {
				toast.success(get(LL).translations.checkedSegmentsNoErrors({ count: checkedSegments }));
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			toast.error(get(LL).editor.failedToMarkErrors({ error: message }));
		} finally {
			isMarkingTranslationErrors = false;
		}
	}

	onDestroy(() => {
		if (searchDebounceTimer !== undefined) clearTimeout(searchDebounceTimer);
	});
</script>

<div
	class="bg-secondary h-full border border-color rounded-lg py-6 px-2 space-y-6 border-r-0 relative overflow-y-auto"
>
	<div class="relative z-10 overflow-x-hidden">
		<!-- En-tête avec icône -->
		<div class="flex gap-x-2 items-center justify-center mb-6">
			<span class="material-icons text-accent text-xl">translate</span>
			<h2 class="text-xl font-bold text-primary">{$LL.editor.translations()}</h2>
		</div>

		<!-- Liste des traductions -->
		<div class="space-y-4">
			{#each globalState.currentProject!.content.projectTranslation.addedTranslationEditions as edition (edition.name)}
				{#if globalState.getTranslationMetadata(edition.language)}
					<EditionViewer {edition} />
				{/if}
			{/each}
		</div>

		<!-- Bouton d'ajout de nouvelle traduction -->
		<div class="pt-4 border-t border-color mt-6">
			<button
				class="btn-accent w-full px-6 py-3 text-sm font-semibold rounded-lg flex items-center justify-center gap-2 hover:shadow-lg transition-all duration-200"
				onclick={() => setAddTranslationModalVisibility(true)}
			>
				<span class="material-icons text-base">add</span>
				{$LL.editor.addNewTranslation()}
			</button>
		</div>

		<!-- Section des filtres modernisée -->
		<div class="border-t border-color pt-4 space-y-3">
			<div class="flex items-center gap-2 mb-2">
				<span class="material-icons text-accent-primary text-lg">filter_list</span>
				<h3 class="text-base font-semibold text-primary">{$LL.editor.translationFilters()}</h3>
			</div>

			<!-- Search input -->
			<div class="px-1 flex">
				<input
					id="search-input"
					type="text"
					placeholder={$LL.editor.verseSearchPlaceholder()}
					autocomplete="off"
					class="w-full px-3 py-1.5 text-sm border border-color rounded-r-none! border-r-0!"
					bind:value={localSearchQuery}
					oninput={scheduleSearchQueryValidation}
					onkeypress={handleSearchKeypress}
				/>
				<button
					onclick={validateSearchQuery}
					class="flex items-center border border-color border-r-0 px-1 hover:bg-accent"
				>
					<span class="material-icons text-base">search</span>
				</button>
				<button
					onclick={() => {
						localSearchQuery = '';
						validateSearchQuery();
					}}
					class="flex items-center border border-color rounded-r-lg px-1 hover:bg-accent"
				>
					<span class="material-icons text-base">clear</span>
				</button>
			</div>

			<!-- Grille des filtres -->
			<div class="bg-accent border border-color rounded-lg p-1">
				<div class="grid xl:grid-cols-2 gap-1.5">
					{#each ['to review', 'ai error', 'error', 'ai trimmed', 'automatically trimmed', 'fetched', 'reviewed', 'completed by default'] as filter (filter)}
						<label
							class="flex items-center gap-2 cursor-pointer rounded-md py-1.5 hover:bg-secondary transition-all duration-200"
							for="filter-checkbox-{filter}"
						>
							<input
								type="checkbox"
								id="filter-checkbox-{filter}"
								bind:checked={globalState.getTranslationsState.filters[filter]}
								class="h-3.5 w-3.5 rounded transition-all duration-200 focus:ring-2 focus:ring-[var(--accent-primary)] focus:ring-offset-2 focus:ring-offset-[var(--bg-accent)]"
							/>
							<span
								class="min-w-0 flex-1 text-xs text-secondary font-medium leading-tight capitalize"
							>
								{filter.replace(/([a-z])([A-Z])/g, '$1 $2')}
							</span>
							<!-- Badge de statut -->
							<span
								class="ml-auto shrink-0 px-1 py-0.25 text-[10px] rounded-full {filter ===
								'to review'
									? 'bg-yellow-500/20 text-yellow-400'
									: filter === 'ai error' || filter === 'error'
										? 'bg-red-500/20 text-red-400'
										: 'bg-green-500/20 text-green-400'}"
							>
								{numberOfSubtitlesWithStatus(filter)}
							</span>
						</label>
					{/each}
				</div>
			</div>

			<div
				class="mx-1 rounded-lg border border-[var(--accent-primary)]/50 bg-[var(--accent-primary)]/15 p-2"
			>
				<label
					for="overlap-only-checkbox"
					class="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-all duration-200 hover:bg-[var(--accent-primary)]/10"
				>
					<input
						id="overlap-only-checkbox"
						type="checkbox"
						bind:checked={globalState.getTranslationsState.onlyShowOverlappingSubtitles}
						class="h-3.5 w-3.5 rounded border-[var(--accent-primary)] focus:ring-2 focus:ring-[var(--accent-primary)] focus:ring-offset-2 focus:ring-offset-[var(--bg-secondary)]"
					/>
					<span class="text-xs font-semibold text-primary leading-tight"
						>{$LL.editor.onlyShowOverlappingSubtitles()}</span
					>
				</label>
			</div>
			<!-- Boutons d'action rapide -->
			<div class="grid xl:grid-cols-2 gap-2 px-1 pb-1">
				<button
					class="btn w-full px-2 py-2 text-xs font-medium hover:bg-blue-500 hover:border-blue-500 hover:text-white transition-all duration-200 flex items-center justify-center gap-1.5 relative hover:z-10"
					onclick={() => {
						globalState.getTranslationsState.checkOnlyFilters(
							Object.keys(globalState.getTranslationsState.filters)
						);
					}}
				>
					<span class="material-icons text-base">select_all</span>
					{$LL.editor.showAllSubtitles()}
				</button>

				<button
					class="btn w-full px-2 py-2 text-xs font-medium hover:bg-accent-primary hover:border-accent-primary hover:text-black transition-all duration-200 flex items-center justify-center gap-1.5 relative hover:z-10"
					onclick={() => {
						globalState.getTranslationsState.checkOnlyFilters([
							'to review',
							'ai error',
							'error',
							'reviewed',
							'automatically trimmed'
						]);
					}}
				>
					<span class="material-icons text-base">checklist</span>
					{$LL.editor.showPartialVerses()}
				</button>

				<button
					class="btn w-full px-2 py-2 text-xs font-medium hover:bg-emerald-500 hover:border-emerald-500 hover:text-white transition-all duration-200 flex items-center justify-center gap-1.5 relative hover:z-10"
					onclick={() => {
						globalState.getTranslationsState.checkOnlyFilters(['ai trimmed', 'ai error', 'error']);
					}}
				>
					<span class="material-icons text-base">auto_fix_high</span>
					{$LL.editor.showAiFetched()}
				</button>

				<button
					class="btn w-full px-2 py-2 text-xs font-medium hover:bg-orange-500 hover:border-orange-500 hover:text-white transition-all duration-200 flex items-center justify-center gap-1.5 relative hover:z-10"
					onclick={() => {
						globalState.getTranslationsState.checkOnlyFilters(['to review', 'ai error', 'error']);
					}}
				>
					<span class="material-icons text-base">priority_high</span>
					{$LL.editor.showNeedsReview()}
				</button>
			</div>
		</div>
	</div>

	<div class="mb-6 rounded-lg border border-color bg-accent p-3">
		<label for="wbw-translation-language" class="mb-2 block text-sm font-semibold text-primary">
			{$LL.editor.wbwHelperLanguage()}
		</label>
		<select
			id="wbw-translation-language"
			class="w-full rounded-lg border border-color bg-secondary px-3 py-2 text-sm text-primary"
			bind:value={globalState.settings!.persistentUiState.wbwTranslationLanguage}
			onchange={() => void Settings.save()}
		>
			{#each WBW_TRANSLATION_LANGUAGES as language (language.code)}
				<option value={language.code}>{language.label}</option>
			{/each}
		</select>
	</div>

	<div class="mb-6 rounded-lg border border-color bg-accent p-3">
		<div class="mb-2 flex items-center gap-2">
			<span class="material-icons text-accent-primary text-lg">rule</span>
			<h3 class="text-sm font-semibold text-primary">{$LL.editor.translationChecks()}</h3>
		</div>
		<p class="mb-3 text-xs leading-relaxed text-secondary">
			{$LL.editor.checkWordCoverage()}
		</p>
		<button
			class="btn w-full px-3 py-2 text-xs font-medium hover:bg-red-500 hover:border-red-500 hover:text-white transition-all duration-200 flex items-center justify-center gap-1.5"
			disabled={isMarkingTranslationErrors}
			onclick={markTranslationErrors}
		>
			<span class="material-icons text-base">
				{isMarkingTranslationErrors ? 'hourglass_empty' : 'report'}
			</span>
			{isMarkingTranslationErrors
				? $LL.editor.checkingTranslations()
				: $LL.editor.markTranslationErrors()}
		</button>
	</div>
</div>
