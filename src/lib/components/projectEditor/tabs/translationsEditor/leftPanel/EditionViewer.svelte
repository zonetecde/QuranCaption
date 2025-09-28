<script lang="ts">
	import { SubtitleClip, TrackType, type Edition } from '$lib/classes';
	import type { VerseTranslation } from '$lib/classes/Translation.svelte';
	import Section from '$lib/components/projectEditor/Section.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { ProjectService } from '$lib/services/ProjectService';
	import toast from 'svelte-5-french-toast';
	import AskIaModal from '../modal/AskIAModal.svelte';

	let { edition } = $props();

	let showAskIAModal = $state(false);
	let aiModalTranslationEdition: Edition | null = $state(null);

	async function fetchFromOtherProjects(event: MouseEvent) {
		let skipQC1Projects = false;

		// if ctrl was pressed
		if (event.ctrlKey || event.metaKey) {
			skipQC1Projects = true;
		}

		const fetchPromise = new Promise(async (resolve, reject) => {
			try {
				let doneSubtitlesIds: Set<number> = new Set();

				// Parcours tout les autres projets, et si on trouve le meme sous-titre et que la traduction existe, on la copie
				for (const existingProjects of globalState.userProjectsDetails) {
					// Si ce n'est pas le projet courant
					if (existingProjects.id === globalState.currentProject!.detail.id) continue;

					// Regarde si le projet contient la traduction et qu'elle est suffisamment avancée
					if (
						!(
							existingProjects.translations[edition.author] &&
							existingProjects.translations[edition.author] > 40
						)
					)
						continue;

					// Regarde si le projet date d'avant le 29/08/2025 (date de la QC1)
					// et que l'on veut skip les projets d'avant la QC1
					if (skipQC1Projects && existingProjects.createdAt < new Date('2025-08-29')) {
						continue;
					}

					const project = await ProjectService.load(existingProjects.id);
					if (project) {
						for (const clip of project.content.timeline.getFirstTrack(TrackType.Subtitle).clips) {
							if (!(clip instanceof SubtitleClip)) continue;
							// Si la traduction est reviewed
							if (!clip.translations[edition.name].isStatusComplete()) continue;

							const matchingSubtitle = globalState.getSubtitleClips.find(
								(c) =>
									// Si la traduction du projet n'est pas reviewed
									!c.translations[edition.name].isStatusComplete() &&
									// et qu'on ne l'a pas encore fetch d'un autre projet
									!doneSubtitlesIds.has(c.id) &&
									c.verse === clip.verse &&
									c.surah === clip.surah &&
									c.startWordIndex === clip.startWordIndex &&
									c.endWordIndex === clip.endWordIndex
							) as SubtitleClip | undefined;

							if (matchingSubtitle) {
								doneSubtitlesIds.add(matchingSubtitle.id);

								const src = clip.translations[edition.name] as VerseTranslation;
								const tgt = matchingSubtitle.translations[edition.name] as VerseTranslation;

								Object.assign(tgt, {
									text: src.text,
									startWordIndex: src.startWordIndex,
									endWordIndex: src.endWordIndex,
									isBruteForce: src.isBruteForce,
									status: 'fetched'
								});

								if (src.isBruteForce) {
									// Essaie quand même de le mettre en non-bruteforce et donc de recalculer les indexes
									tgt.tryRecalculateTranslationIndexes(edition, clip.getVerseKey());
								}
							}
						}
					}
				}

				globalState.currentProject!.detail.updatePercentageTranslated(edition);
				resolve(doneSubtitlesIds.size);
			} catch (error) {
				reject(error);
			}
		});

		toast.promise(fetchPromise, {
			loading: 'Fetching translations... ' + (skipQC1Projects ? '(only QC2)' : ''),
			success: (count) => `Successfully fetched ${count} translations`,
			error: 'Failed to fetch translations'
		});
	}
</script>

<div
	class="bg-accent border border-color rounded-lg p-2 hover:border-accent-primary transition-all duration-200"
>
	<Section
		name={edition.author}
		icon={globalState.availableTranslations[edition.language].flag}
		classes="flex items-center"
	>
		<!-- Toggle pour afficher dans l'éditeur -->
		<div class="bg-secondary rounded-lg px-3 py-2 border border-color">
			<label
				class="text-sm font-medium text-secondary cursor-pointer flex items-center gap-3"
				for="showInTranslationsEditor"
			>
				<div class="relative">
					<input
						type="checkbox"
						bind:checked={edition.showInTranslationsEditor}
						class="w-5 h-5 rounded"
					/>
				</div>

				<div class="flex-1">
					<span
						class="block font-medium"
						onmousedown={(event) => {
							event.preventDefault();
							edition.showInTranslationsEditor = !edition.showInTranslationsEditor;
						}}
					>
						Show in editor
					</span>
				</div>
			</label>
		</div>

		<!-- Boutons d'action -->
		<div class="grid grid-cols-2 gap-x-2 mt-1.5">
			<button
				class="btn btn-icon px-4 py-2 text-sm font-medium flex-1 flex-row justify-center"
				onclick={() =>
					globalState.currentProject!.content.projectTranslation.removeTranslation(edition)}
			>
				<span class="material-icons text-base mr-1">delete</span>
				Remove
			</button>

			<button
				class="btn btn-icon px-4 py-2 text-sm flex-1 flex flex-row justify-center"
				onclick={() =>
					globalState.currentProject!.content.projectTranslation.resetTranslation(edition)}
			>
				<span class="material-icons text-base mr-1">refresh</span>
				Reset
			</button>

			<!-- IA -->
			<button
				class="btn btn-icon w-full px-4 py-2 text-sm flex-1 flex flex-row justify-center mt-1.5"
				onclick={(e) => {
					fetchFromOtherProjects(e);
				}}
				title="Fetch translations from other projects"
			>
				<span class="material-icons text-base mr-2"> cloud_sync </span>
				Fetch
			</button>
			<button
				class="btn btn-icon w-full px-4 py-2 text-sm flex-1 flex flex-row justify-center mt-1.5"
				onclick={() => {
					showAskIAModal = true;
					aiModalTranslationEdition = edition;
				}}
			>
				<span class="material-icons text-base mr-2">auto_awesome</span>
				Ask AI
			</button>
		</div>

		{#if globalState.currentProject!.detail.translations[edition.author]}
			<div class="flex justify-between text-xs text-[var(--text-secondary)] mb-1 mt-3">
				<span>Percentage reviewed:</span>
				<span class="font-medium text-[var(--text-primary)]"
					>{globalState.currentProject!.detail.translations[edition.author]}%</span
				>
			</div>
			<div class="bg-[var(--border-color)] rounded h-2 overflow-hidden">
				<div
					class="bg-[var(--accent-primary)] h-full rounded transition-all duration-300 ease-in-out"
					style="width: {globalState.currentProject!.detail.translations[edition.author]}%;"
				></div>
			</div>
		{/if}
	</Section>
</div>

{#if showAskIAModal && aiModalTranslationEdition}
	<div class="modal-wrapper">
		<AskIaModal close={() => (showAskIAModal = false)} edition={aiModalTranslationEdition} />
	</div>
{/if}
