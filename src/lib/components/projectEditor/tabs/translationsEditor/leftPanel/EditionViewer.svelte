<script lang="ts">
	import { SubtitleClip, TrackType, type Edition } from '$lib/classes';
	import {
		sliceTranslationTrimUnits,
		type TranslationStatus,
		type VerseTranslation
	} from '$lib/classes/Translation.svelte';
	import Section from '$lib/components/projectEditor/Section.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { markInvalidAdvancedTrimTranslations } from '$lib/services/AdvancedAITrimming';
	import { ProjectService } from '$lib/services/ProjectService';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
	import toast from 'svelte-5-french-toast';
	import ModalManager from '$lib/components/modals/ModalManager';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';

	const LL_ = get(LL);

	let { edition } = $props();
	const translationMetadata = $derived(() => globalState.getTranslationMetadata(edition.language));

	// Date de séparation QC1/QC2 utilisée quand on appuie sur Ctrl/Cmd.
	// (only fetch QC2 projects)
	const QC1_RELEASE_DATE = new Date('2025-08-29');

	// Priorité métier: ces statuts passent avant "ai trimmed" et "fetched",
	// même si les projets correspondants sont plus anciens.
	const HIGH_PRIORITY_FETCH_STATUSES: Set<TranslationStatus> = new Set([
		'completed by default',
		'reviewed',
		'automatically trimmed'
	]);

	// Statuts de secours, utilisés seulement après la passe prioritaire.
	const LOW_PRIORITY_FETCH_STATUSES: Set<TranslationStatus> = new Set(['ai trimmed', 'fetched']);

	// Clé de matching d'un sous-titre entre deux projets.
	function getSubtitleLookupKey(clip: SubtitleClip): string {
		return `${clip.surah}:${clip.verse}:${clip.startWordIndex}:${clip.endWordIndex}`;
	}

	async function fetchFromOtherProjects(event: MouseEvent) {
		let skipQC1Projects = false;

		// Ctrl/Cmd: ne garder que les projets créés après la sortie QC1.
		if (event.ctrlKey || event.metaKey) {
			skipQC1Projects = true;
		}

		const fetchPromise = ProjectHistoryManager.trackAsync('fetch translations', async () => {
			const doneSubtitlesIds: Set<number> = new Set();

			// Index rapide des sous-titres encore incomplets dans le projet courant.
			// Dès qu'un sous-titre est fetch, on le retire de cette map pour éviter
			// toute re-recherche dans les itérations suivantes.
			const pendingSubtitlesByKey: Map<string, SubtitleClip[]> = new Map();
			for (const subtitle of globalState.getSubtitleClips) {
				const subtitleTranslation = subtitle.translations[edition.name] as
					| VerseTranslation
					| undefined;
				if (!subtitleTranslation || subtitleTranslation.isStatusComplete()) continue;

				const subtitleKey = getSubtitleLookupKey(subtitle);
				const bucket = pendingSubtitlesByKey.get(subtitleKey);
				if (bucket) {
					bucket.push(subtitle);
				} else {
					pendingSubtitlesByKey.set(subtitleKey, [subtitle]);
				}
			}

			// Parcours des projets du plus récent au plus ancien.
			// On trie une copie pour ne pas muter l'ordre global.
			const sortedEligibleProjects = globalState.userProjectsDetails
				.filter((projectDetail) => {
					if (projectDetail.id === globalState.currentProject!.detail.id) return false;
					if (
						!(
							projectDetail.translations[edition.author] &&
							projectDetail.translations[edition.author] > 40
						)
					)
						return false;
					if (skipQC1Projects && projectDetail.createdAt < QC1_RELEASE_DATE) return false;
					return true;
				})
				.slice()
				.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

			// Stratégie en 2 passes:
			// 1) statuts prioritaires sur tous les projets (récent -> ancien)
			// 2) statuts de secours sur tous les projets (récent -> ancien)
			// => la priorité de statut passe avant la récence.
			const statusPasses: Array<Set<TranslationStatus>> = [
				HIGH_PRIORITY_FETCH_STATUSES,
				LOW_PRIORITY_FETCH_STATUSES
			];

			for (const allowedStatuses of statusPasses) {
				if (pendingSubtitlesByKey.size === 0) break;

				for (const projectDetail of sortedEligibleProjects) {
					if (pendingSubtitlesByKey.size === 0) break;

					const project = await ProjectService.load(projectDetail.id);
					if (!project) continue;

					for (const clip of project.content.timeline.getFirstTrack(TrackType.Subtitle).clips) {
						if (pendingSubtitlesByKey.size === 0) break;
						if (!(clip instanceof SubtitleClip)) continue;

						const src = clip.translations[edition.name] as VerseTranslation | undefined;
						if (!src || !allowedStatuses.has(src.status)) continue;

						const matchingSubtitleKey = getSubtitleLookupKey(clip);
						const pendingMatches = pendingSubtitlesByKey.get(matchingSubtitleKey);
						if (!pendingMatches || pendingMatches.length === 0) continue;

						const matchingSubtitle = pendingMatches.shift();
						if (!matchingSubtitle) continue;

						// Bucket vide = plus rien à chercher pour cette clé.
						if (pendingMatches.length === 0) {
							pendingSubtitlesByKey.delete(matchingSubtitleKey);
						}

						doneSubtitlesIds.add(matchingSubtitle.id);

						const tgt = matchingSubtitle.translations[edition.name] as VerseTranslation;
						const sourceText = src.isBruteForce
							? src.text
							: // Retrouve le texte de la traduction à partir des unités de découpage
								sliceTranslationTrimUnits(
									globalState.currentProject!.content.projectTranslation.getVerseTranslation(
										edition,
										clip.getVerseKey()
									),
									src.startWordIndex,
									src.endWordIndex
								);
						tgt.text = sourceText || src.text;
						tgt.startWordIndex = src.startWordIndex;
						tgt.endWordIndex = src.endWordIndex;
						tgt.isBruteForce = src.isBruteForce;
						tgt.inlineStyleRuns = [...(src.inlineStyleRuns ?? [])];
						tgt.status = 'fetched';

						if (src.isBruteForce) {
							// Tente de retrouver des indexes propres après import.
							tgt.tryRecalculateTranslationIndexes(edition, clip.getVerseKey());
						}
					}
				}
			}

			if (doneSubtitlesIds.size > 0) {
				markInvalidAdvancedTrimTranslations(edition, {
					shouldCheckTranslation: (_translation, subtitle) => doneSubtitlesIds.has(subtitle.id)
				});
			}

			globalState.currentProject!.detail.updatePercentageTranslated(edition);
			return doneSubtitlesIds.size;
		});

		toast.promise(fetchPromise, {
			loading: LL_.editor.fetchingTranslations() + (skipQC1Projects ? '(only QC2)' : ''),
			success: (count) => LL_.editor.successfullyFetched(),
			error: LL_.editor.failedToFetchTranslations()
		});
	}
</script>

<div
	class="bg-accent border border-color rounded-lg p-2 hover:border-accent-primary transition-all duration-200"
>
	<Section
		name={edition.author}
		icon={translationMetadata()?.flag || ''}
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
						{$LL.editor.showInEditor()}
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
				{$LL.common.remove()}
			</button>

			<button
				class="btn btn-icon px-4 py-2 text-sm flex-1 flex flex-row justify-center"
				onclick={() =>
					globalState.currentProject!.content.projectTranslation.resetTranslation(edition)}
			>
				<span class="material-icons text-base mr-1">refresh</span>
				{$LL.common.reset()}
			</button>

			<!-- IA -->
			<button
				class="btn btn-icon w-full px-4 py-2 text-sm flex-1 flex flex-row justify-center mt-1.5"
				onclick={(e) => {
					fetchFromOtherProjects(e);
				}}
				title={$LL.editor.fetchTranslations()}
			>
				<span class="material-icons text-base mr-2"> cloud_sync </span>
				{$LL.editor.fetchButton()}
			</button>
			<button
				class="btn btn-icon w-full px-4 py-2 text-sm flex-1 flex flex-row justify-center mt-1.5"
				onclick={() => void ModalManager.askTranslationModal(edition)}
			>
				<span class="material-icons text-base mr-2">auto_awesome</span>
				{$LL.editor.askAi()}
			</button>
		</div>

		{#if globalState.currentProject!.detail.translations[edition.author]}
			<div class="flex justify-between text-xs text-[var(--text-secondary)] mb-1 mt-3">
				<span>{$LL.editor.percentageReviewed()}</span>
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
