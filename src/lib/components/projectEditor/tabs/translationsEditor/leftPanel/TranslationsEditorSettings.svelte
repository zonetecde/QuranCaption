<script lang="ts">
	import Settings from '$lib/classes/Settings.svelte';
	import type { Edition } from '$lib/classes';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { WBW_TRANSLATION_LANGUAGES } from '$lib/services/WbwTranslationService';
	import { onDestroy } from 'svelte';
	import EditionViewer from './EditionViewer.svelte';

	type TranslationCopy = {
		aiTranslatedStatus: () => string;
		manuallyTranslatedStatus: () => string;
	};

	const SEARCH_DEBOUNCE_MS = 250;
	const copy = $derived($LL.translations as unknown as TranslationCopy);
	let {
		setAddTranslationModalVisibility,
		setAiTranslationEdition
	}: {
		setAddTranslationModalVisibility: (visible: boolean) => void;
		setAiTranslationEdition: (edition: Edition) => void;
	} = $props();

	let localSearchQuery = $derived(globalState.getTranslationsState.searchQuery);
	let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined;
	const visibleStatuses = ['to translate', 'to review', 'ai translated', 'reviewed'] as const;

	/**
	 * Applique la recherche locale au workspace.
	 * @returns {void}
	 */
	function validateSearchQuery(): void {
		if (searchDebounceTimer !== undefined) clearTimeout(searchDebounceTimer);
		searchDebounceTimer = undefined;
		globalState.getTranslationsState.searchQuery = localSearchQuery;
	}

	/**
	 * Diffère l'application de la recherche pendant la saisie.
	 * @returns {void}
	 */
	function scheduleSearchQueryValidation(): void {
		if (searchDebounceTimer !== undefined) clearTimeout(searchDebounceTimer);
		searchDebounceTimer = setTimeout(validateSearchQuery, SEARCH_DEBOUNCE_MS);
	}

	/**
	 * Compte les sous-titres portant un statut donné dans au moins une langue.
	 * @param {string} status Statut à compter.
	 * @returns {number} Nombre de sous-titres correspondants.
	 */
	function countStatus(status: string): number {
		return globalState.getSubtitleClips.filter((clip) =>
			globalState.getProjectTranslation.addedTranslationEditions.some(
				(edition) => clip.translations[edition.name]?.getFilterStatus() === status
			)
		).length;
	}

	$effect(() => {
		for (const status of visibleStatuses) {
			if (globalState.getTranslationsState.filters[status] === undefined) {
				globalState.getTranslationsState.filters[status] = true;
			}
		}
	});

	onDestroy(() => {
		if (searchDebounceTimer !== undefined) clearTimeout(searchDebounceTimer);
	});
</script>

<div
	class="bg-secondary h-full border border-color rounded-lg py-6 px-2 space-y-6 border-e-0 relative overflow-y-auto"
>
	<div class="relative z-10 overflow-x-hidden">
		<div class="flex gap-x-2 items-center justify-center mb-6">
			<span class="material-icons text-accent text-xl">translate</span>
			<h2 class="text-xl font-bold text-primary">{$LL.editor.translations()}</h2>
		</div>

		<div class="space-y-4">
			{#each globalState.getProjectTranslation.addedTranslationEditions as edition (edition.name)}
				<EditionViewer {edition} onTranslateWithAi={() => setAiTranslationEdition(edition)} />
			{/each}
		</div>

		<div class="pt-4 border-t border-color mt-6">
			<button
				class="btn-accent w-full px-6 py-3 text-sm font-semibold rounded-lg flex items-center justify-center gap-2"
				onclick={() => setAddTranslationModalVisibility(true)}
			>
				<span class="material-icons text-base">add</span>
				{$LL.editor.addNewTranslation()}
			</button>
		</div>

		{#if globalState.settings}
			<div class="mt-4 border-t border-color pt-4">
				<label
					for="wbw-translation-language"
					class="mb-1.5 block text-xs font-semibold text-secondary"
				>
					{$LL.editor.wbwHelperLanguage()}
				</label>
				<select
					id="wbw-translation-language"
					class="w-full rounded-lg border border-color bg-secondary px-2.5 py-1.5 text-xs text-primary"
					bind:value={globalState.settings.persistentUiState.wbwTranslationLanguage}
					onchange={() => void Settings.save()}
				>
					{#each WBW_TRANSLATION_LANGUAGES as language (language.code)}
						<option value={language.code}>{language.label}</option>
					{/each}
				</select>
			</div>
		{/if}

		<div class="border-t border-color pt-4 space-y-3">
			<div class="flex items-center gap-2 mb-2">
				<span class="material-icons text-accent-primary text-lg">filter_list</span>
				<h3 class="text-base font-semibold text-primary">{$LL.editor.translationFilters()}</h3>
			</div>

			<div class="px-1 flex">
				<input
					id="translation-search-input"
					type="text"
					placeholder={$LL.translations.searchTranslations()}
					autocomplete="off"
					class="w-full px-3 py-1.5 text-sm border border-color rounded-e-none! border-e-0!"
					bind:value={localSearchQuery}
					oninput={scheduleSearchQueryValidation}
					onkeydown={(event) => {
						if (event.key === 'Enter') validateSearchQuery();
					}}
				/>
				<button
					onclick={validateSearchQuery}
					class="flex items-center border border-color border-e-0 px-1 hover:bg-accent"
				>
					<span class="material-icons text-base">search</span>
				</button>
				<button
					onclick={() => {
						localSearchQuery = '';
						validateSearchQuery();
					}}
					class="flex items-center border border-color rounded-e-lg px-1 hover:bg-accent"
				>
					<span class="material-icons text-base">clear</span>
				</button>
			</div>

			<div class="bg-accent border border-color rounded-lg p-1 space-y-1">
				{#each visibleStatuses as status (status)}
					<label
						class="flex items-center gap-2 cursor-pointer rounded-md px-2 py-1.5 hover:bg-secondary"
					>
						<input
							type="checkbox"
							bind:checked={globalState.getTranslationsState.filters[status]}
						/>
						<span class="min-w-0 flex-1 text-xs text-secondary font-medium">
							{status === 'to translate'
								? $LL.editor.toReview()
								: status === 'to review'
									? $LL.status.toReview()
									: status === 'ai translated'
										? copy.aiTranslatedStatus()
										: copy.manuallyTranslatedStatus()}
						</span>
						<span class="rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-thirdly">
							{countStatus(status)}
						</span>
					</label>
				{/each}
			</div>

			<div class="grid grid-cols-2 gap-2 px-1">
				<button
					class="btn px-2 py-2 text-xs"
					onclick={() => globalState.getTranslationsState.checkOnlyFilters(['to review'])}
				>
					{$LL.status.toReview()}
				</button>
				<button
					class="btn px-2 py-2 text-xs"
					onclick={() => globalState.getTranslationsState.checkOnlyFilters([...visibleStatuses])}
				>
					{$LL.common.all()}
				</button>
			</div>
		</div>
	</div>
</div>
