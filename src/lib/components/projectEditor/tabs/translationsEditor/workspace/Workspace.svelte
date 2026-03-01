<script lang="ts">
	import {
		PredefinedSubtitleClip,
		SubtitleClip,
		type ClipWithTranslation
	} from '$lib/classes/Clip.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { untrack } from 'svelte';
	import NoTranslationsToShow from './NoTranslationsToShow.svelte';
	import Translation from './translation/Translation.svelte';
	import ArabicText from './ArabicText.svelte';

	function addTranslationButtonClick() {
		// Affiche le pop-up pour ajouter une nouvelle traduction
		setAddTranslationModalVisibility(true);
	}

	let {
		setAddTranslationModalVisibility
	}: {
		setAddTranslationModalVisibility: (visible: boolean) => void;
	} = $props();

	let editionsToShowInEditor = $derived(() =>
		globalState.currentProject!.content.projectTranslation.addedTranslationEditions.filter(
			(edition) => edition.showInTranslationsEditor
		)
	);

	// Le format est : { [sous-titreId]: [edition1, edition2, ...] }
	let allowedTranslations: { [key: string]: string[] } = $state({});

	// Pagination progressive
	const PAGE_SIZE = 10;
	let visibleCount = $state(PAGE_SIZE); // nombre actuel de sous-titres autorisés affichés

	/**
	 * Vérifie si le clip actuel a un chevauchement avec le clip précédent en arabe.
	 * @param currentIndex L'index du clip actuel.
	 */
	function hasArabicOverlapWithPrevious(currentIndex: number): boolean {
		const currentClip = globalState.getSubtitleTrack.clips[currentIndex];
		if (!(currentClip instanceof SubtitleClip)) return false;

		const previousClip = globalState.getSubtitleTrack.getSubtitleBefore(currentIndex);
		if (!(previousClip instanceof SubtitleClip)) return false;

		if (currentClip.surah !== previousClip.surah || currentClip.verse !== previousClip.verse) {
			return false;
		}

		// Si les deux clips couvrent exactement les mêmes mots, ce n'est pas un overlap à traiter.
		if (
			currentClip.startWordIndex === previousClip.startWordIndex &&
			currentClip.endWordIndex === previousClip.endWordIndex
		) {
			return false;
		}

		return currentClip.startWordIndex <= previousClip.endWordIndex;
	}

	function mergeEditions(existing: string[] | undefined, incoming: string[]): string[] {
		if (!existing) return [...incoming];
		return [...new Set([...existing, ...incoming])];
	}

	let allSubtitlesInGroups = $derived(() => {
		// Prends tout les sous-titres du projet et les groupes par verset (même surah:verse)
		// Seulement ceux qui sont à la suite l'un à l'autre, sinon on crée un nouveau groupe
		const groups: number[][] = [];
		let currentGroup: number[] = [];
		let lastSurah = -1;
		let lastVerse = -1;

		for (let index = 0; index < globalState.getSubtitleTrack.clips.length; index++) {
			const subtitle = globalState.getSubtitleTrack.clips[index];
			if (subtitle.type === 'Subtitle') {
				const subtitleClip = subtitle as SubtitleClip;
				// Si ce n'est pas le même verset que le précédent, on crée un nouveau groupe
				if (subtitleClip.surah !== lastSurah || lastVerse !== subtitleClip.verse) {
					if (currentGroup.length > 0) groups.push(currentGroup);
					currentGroup = [index];
					lastSurah = subtitleClip.surah;
					lastVerse = subtitleClip.verse;
				} else {
					currentGroup.push(index);
				}
			} else if (subtitle.type === 'Pre-defined Subtitle') {
				// Pour les Pre-defined Subtitle, on les ajoute à un nouveau groupe isolé
				if (currentGroup.length > 0) {
					groups.push(currentGroup);
					currentGroup = [];
					lastSurah = -1;
					lastVerse = -1;
				}
				groups.push([index]);
			}
		}

		// Ajoute le dernier groupe s'il n'est pas vide
		if (currentGroup.length > 0) groups.push(currentGroup);
		return groups;
	});

	let subtitlesInGroups = $derived(() => {
		const allowedClipIds = new Set(Object.keys(allowedTranslations));
		const onlyShowOverlappingSubtitles =
			globalState.getTranslationsState.onlyShowOverlappingSubtitles;

		// Mode overlap: n'affiche que les clips explicitement autorisés (overlap + contexte précédent)
		if (onlyShowOverlappingSubtitles) {
			return allSubtitlesInGroups()
				.map((group) =>
					group.filter((index) =>
						allowedClipIds.has(String(globalState.getSubtitleTrack.clips[index].id))
					)
				)
				.filter((group) => group.length > 0);
		}

		// Mode normal: si un clip du verset match, on affiche tout le groupe pour garder le contexte
		return allSubtitlesInGroups().filter((group) =>
			group.some((index) => allowedClipIds.has(String(globalState.getSubtitleTrack.clips[index].id)))
		);
	});

	// Réinitialise le compteur si les filtres changent et qu'on a moins d'éléments
	$effect(() => {
		const total = subtitlesInGroups().length;
		if (visibleCount > total) {
			visibleCount = total;
		}
		// Si on change complètement de filtre, on repart de 10 (optionnel)
		if (total && visibleCount === 0) {
			visibleCount = Math.min(PAGE_SIZE, total);
		}
	});

	function loadMoreIfNeeded(container: HTMLElement) {
		const threshold = 50; // px avant le bas
		if (container.scrollTop + container.clientHeight >= container.scrollHeight - threshold) {
			const total = subtitlesInGroups().length;
			if (visibleCount < total) {
				visibleCount = Math.min(visibleCount + PAGE_SIZE, total);
			}
		}
	}

	$effect(() => {
		// Permet de trigger la réactivité en forçant la lecture des status
		for (const key in globalState.getTranslationsState.filters) {
			const value = globalState.getTranslationsState.filters[key];
			const _ = value;
		}

		// Aussi lorsqu'on ajoute/supprime une édition de traduction
		for (const edition of globalState.currentProject!.content.projectTranslation
			.addedTranslationEditions) {
			const _ = edition.name;
		}

		// Lorsqu'on cache/montre une édition dans l'éditeur
		for (const edition of editionsToShowInEditor()) {
			const _ = edition.name;
		}

		// Lorsqu'on modifie la recherche
		const search = globalState.getTranslationsState.searchQuery.toLowerCase().trim();
		// Met à jour les traductions à afficher en fonction des filtres
		const filter = globalState.getTranslationsState.filters;
		const onlyShowOverlappingSubtitles =
			globalState.getTranslationsState.onlyShowOverlappingSubtitles;
		const visibleEditions = editionsToShowInEditor().map((edition) => edition.name);

		untrack(() => {
			allowedTranslations = {};

			for (let index = 0; index < globalState.getSubtitleTrack.clips.length; index += 1) {
				const subtitle = globalState.getSubtitleTrack.clips[index];
				if (subtitle.type !== 'Subtitle' && subtitle.type !== 'Pre-defined Subtitle') continue;

				const subtitleId = subtitle.id;
				// Regarde ses traductions
				const translations = (subtitle as ClipWithTranslation).translations;
				let authorizedEditions: string[] = [];

				if (translations) {
					// Regarde s'il a des traductions correspondant au filtre
					for (const key in translations) {
						const translation = translations[key];

						// Si son statut est dans le filtre
						if (!filter[translation.status]) continue;

						// Si on a une recherche, on regarde si le texte de la traduction contient la recherche
						if (search) {
							const translationText = translation.text.toLowerCase();
							if (!translationText.includes(search)) continue;
						}

						// Si on autorise son affichage dans l'éditeur
						if (visibleEditions.includes(key)) {
							// On ajoute l'édition à la liste des traductions autorisées
							authorizedEditions.push(key);
						}
					}
				}

				if (!onlyShowOverlappingSubtitles) {
					if (authorizedEditions.length > 0) {
						allowedTranslations[subtitleId] = authorizedEditions;
					} else {
						// Si aucune traduction n'est autorisée, on supprime l'entrée
						delete allowedTranslations[subtitleId];
					}
					continue;
				}

				if (!(subtitle instanceof SubtitleClip)) {
					delete allowedTranslations[subtitleId];
					continue;
				}

				// Vérifie si le clip actuel a un chevauchement avec le clip précédent en arabe.
				const hasOverlap = hasArabicOverlapWithPrevious(index);
				if (authorizedEditions.length > 0 && hasOverlap) {
					allowedTranslations[subtitleId] = mergeEditions(
						allowedTranslations[subtitleId],
						authorizedEditions
					);

					const previousSubtitle = globalState.getSubtitleTrack.getSubtitleBefore(index);
					if (previousSubtitle) {
						allowedTranslations[previousSubtitle.id] = mergeEditions(
							allowedTranslations[previousSubtitle.id],
							visibleEditions
						);
					}
				} else {
					delete allowedTranslations[subtitleId];
				}
			}

			const total = Object.keys(allowedTranslations).length;
			// Ajuste visibleCount si nécessaire
			if (visibleCount > total) visibleCount = total;
			if (visibleCount === 0 && total > 0) visibleCount = Math.min(PAGE_SIZE, total);
		});
	});
</script>

<section
	class="min-h-0 bg-secondary border border-color rounded-lg shadow-lg h-full overflow-y-auto overflow-x-hidden"
	id="translations-workspace"
	onscroll={(e) => {
		// Sauvegarde la position du scroll
		const el = e.target as HTMLElement;
		loadMoreIfNeeded(el);
	}}
>
	{#if globalState.currentProject!.content.projectTranslation.addedTranslationEditions.length === 0}
		<div class="flex items-center flex-col gap-6 justify-center h-full pb-10">
			<div class="flex flex-col items-center gap-4">
				<div class="w-16 h-16 bg-accent rounded-full flex items-center justify-center">
					<span class="material-icons text-accent text-2xl">translate</span>
				</div>
				<div class="text-center">
					<h3 class="text-primary text-lg font-semibold mb-2">No Translations Yet</h3>
					<p class="text-thirdly text-sm max-w-md">
						Start by adding translation editions to begin working on your translations.
					</p>
				</div>
			</div>
			<button
				class="btn-accent px-6 py-3 text-sm font-semibold rounded-lg flex items-center gap-2 hover:shadow-lg transition-all duration-200"
				onclick={addTranslationButtonClick}
			>
				<span class="material-icons text-base">add</span>
				Add Translation
			</button>
		</div>
	{:else}
		<div class="flex p-4 flex-col bg-secondary gap-y-3 h-full">
			{#if Object.keys(allowedTranslations).length === 0}
				<NoTranslationsToShow />
			{:else}
				{#key visibleCount}
					{#each subtitlesInGroups().slice(0, visibleCount) as group}
						{@const firstClipInGroup = globalState.getSubtitleTrack.clips[group[0]] as
							| SubtitleClip
							| PredefinedSubtitleClip}
						<div class="border border-color rounded px-4 py-4 text-primary relative space-y-7">
							{#if firstClipInGroup instanceof SubtitleClip}
								<!-- Affiche le numéro de verset en haut à gauche -->
								<div
									class="absolute top-0 left-0 bg-white/10 px-1 py-1 rounded-br-lg border-color border-l-0 border-t-0 border-1 text-sm"
								>
									{firstClipInGroup.surah}:{firstClipInGroup.verse}
								</div>
							{/if}

							{#each group as clipIndex (globalState.getSubtitleTrack.clips[clipIndex].id)}
								{@const _clipIndex = clipIndex}
								<!-- clipIndex est l'index réel dans clips -->
								<section class="relative">
									<ArabicText subtitle={globalState.getSubtitleTrack.clips[_clipIndex]} />
									{#each editionsToShowInEditor() as edition}
										{#key edition.name}
											<Translation
												{edition}
												subtitle={
													globalState.getSubtitleTrack.clips[_clipIndex] as SubtitleClip
												}
												previousSubtitle={_clipIndex > 0
													? (globalState.getSubtitleTrack.getSubtitleBefore(
															_clipIndex
														) as SubtitleClip)
													: undefined}
											/>
										{/key}
									{/each}
								</section>
							{/each}
						</div>

						<!-- Séparateur entre chaque groupe du verset -->
						<div class="w-full min-h-0.5 bg-[var(--accent-primary)]/40 my-2"></div>
					{/each}
					{#if visibleCount < subtitlesInGroups().length}
						<div class="text-center py-4 text-thirdly text-sm">Scrolling to load more...</div>
					{/if}
				{/key}
			{/if}
		</div>
	{/if}
</section>
