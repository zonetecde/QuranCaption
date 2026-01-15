<script lang="ts">
	import type { Edition } from '$lib/classes';
	import { globalState } from '$lib/runes/main.svelte';
	import { onDestroy, onMount } from 'svelte';
	import Section from '../../../Section.svelte';
	import AskIaModal from '../modal/AskIAModal.svelte';
	import EditionViewer from './EditionViewer.svelte';

	let {
		setAddTranslationModalVisibility
	}: {
		setAddTranslationModalVisibility: (visible: boolean) => void;
	} = $props();

	// Variable locale pour le search query avant validation
	let localSearchQuery = $state(globalState.getTranslationsState.searchQuery);

	// Fonction pour valider le search query
	function validateSearchQuery() {
		globalState.getTranslationsState.searchQuery = localSearchQuery;
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
</script>

<div
	class="bg-secondary h-full border border-color rounded-lg py-6 px-2 space-y-6 border-r-0 relative overflow-y-auto"
>
	<div class="relative z-10 overflow-x-hidden">
		<!-- En-tête avec icône -->
		<div class="flex gap-x-2 items-center justify-center mb-6">
			<span class="material-icons text-accent text-xl">translate</span>
			<h2 class="text-xl font-bold text-primary">Translations Editor</h2>
		</div>

		<!-- Liste des traductions -->
		<div class="space-y-4">
			{#each globalState.currentProject!.content.projectTranslation.addedTranslationEditions as edition}
				{#if globalState.availableTranslations && globalState.availableTranslations[edition.language]}
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
				Add New Translation
			</button>
		</div>

		<!-- Section des filtres modernisée -->
		<div class="border-t border-color pt-6 space-y-4">
			<div class="flex items-center gap-2 mb-4">
				<span class="material-icons text-accent-primary text-lg">filter_list</span>
				<h3 class="text-lg font-semibold text-primary">Translation Filters</h3>
			</div>

			<!-- Search input -->
			<div class="mb-4 px-1 flex">
				<input
					id="search-input"
					type="text"
					placeholder="Must contain... (Press Enter to search)"
					autocomplete="off"
					class="w-full px-4 py-2 border border-color rounded-r-none! border-r-0!"
					bind:value={localSearchQuery}
					onkeypress={handleSearchKeypress}
				/>
				<button
					onclick={validateSearchQuery}
					class="flex items-center border border-color border-r-0 px-1 hover:bg-accent"
				>
					<span class="material-icons">search</span>
				</button>
				<button
					onclick={() => {
						localSearchQuery = '';
						validateSearchQuery();
					}}
					class="flex items-center border border-color rounded-r-lg px-1 hover:bg-accent"
				>
					<span class="material-icons">clear</span>
				</button>
			</div>

			<!-- Grille des filtres -->
			<div class="bg-accent border border-color rounded-lg p-4">
				<div class="grid grid-cols-1 gap-3">
					{#each ['to review', 'ai error', 'ai trimmed', 'automatically trimmed', 'fetched', 'reviewed', 'completed by default'] as filter}
						<label
							class="flex items-center gap-3 cursor-pointer p-2 rounded-md hover:bg-secondary transition-all duration-200"
							for="filter-checkbox-{filter}"
						>
							<input
								type="checkbox"
								id="filter-checkbox-{filter}"
								bind:checked={globalState.getTranslationsState.filters[filter]}
								class="w-4 h-4 rounded transition-all duration-200 focus:ring-2 focus:ring-[var(--accent-primary)] focus:ring-offset-2 focus:ring-offset-[var(--bg-accent)]"
							/>
							<span class="text-sm text-secondary font-medium capitalize">
								{filter.replace(/([a-z])([A-Z])/g, '$1 $2')}
							</span>
							<!-- Badge de statut -->
							<span
								class="ml-auto px-2 py-1 text-xs rounded-full {filter === 'to review'
									? 'bg-yellow-500/20 text-yellow-400'
									: filter === 'ai error'
										? 'bg-red-500/20 text-red-400'
										: 'bg-green-500/20 text-green-400'}"
							>
								{numberOfSubtitlesWithStatus(filter)}
							</span>
						</label>
					{/each}
				</div>
			</div>
			<!-- Boutons d'action rapide -->
			<div class="space-y-2 px-1">
				<button
					class="btn w-full px-4 py-2.5 text-sm font-medium hover:bg-emerald-500 hover:border-emerald-500 hover:text-white transition-all duration-200 flex items-center justify-center gap-2 relative hover:z-10"
					onclick={() => {
						globalState.getTranslationsState.checkOnlyFilters(['fetched']);
					}}
				>
					<span class="material-icons text-base">download_done</span>
					Show Fetched
				</button>

				<button
					class="btn w-full px-4 py-2.5 text-sm font-medium hover:bg-accent-primary hover:border-accent-primary hover:text-black transition-all duration-200 flex items-center justify-center gap-2 relative hover:z-10"
					onclick={() => {
						globalState.getTranslationsState.checkOnlyFilters([
							'to review',
							'ai error',
							'reviewed',
							'automatically trimmed'
						]);
					}}
				>
					<span class="material-icons text-base">checklist</span>
					Show Partial Verses
				</button>

				<button
					class="btn w-full mb-3 px-4 py-2.5 text-sm font-medium hover:bg-orange-500 hover:border-orange-500 hover:text-white transition-all duration-200 flex items-center justify-center gap-2 relative hover:z-10"
					onclick={() => {
						globalState.getTranslationsState.checkOnlyFilters(['to review', 'ai error']);
					}}
				>
					<span class="material-icons text-base">priority_high</span>
					Show Needs Review
				</button>

				<button
					class="btn w-full mb-3 px-4 py-2.5 text-sm font-medium hover:bg-blue-500 hover:border-blue-500 hover:text-white transition-all duration-200 flex items-center justify-center gap-2 relative hover:z-10"
					onclick={() => {
						globalState.getTranslationsState.checkOnlyFilters(
							Object.keys(globalState.getTranslationsState.filters)
						);
					}}
				>
					<span class="material-icons text-base">select_all</span>
					Show All
				</button>
			</div>
		</div>
	</div>
</div>
