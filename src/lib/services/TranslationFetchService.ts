import {
	SubtitleClip,
	TrackType,
	type BatchTranslationReviewCounts,
	type Edition,
	type Project,
	type ProjectDetail
} from '$lib/classes';
import {
	sliceTranslationTrimUnits,
	type TranslationStatus,
	type VerseTranslation
} from '$lib/classes/Translation.svelte';
import { markInvalidAdvancedTrimTranslations } from './AdvancedAITrimming';
import { ProjectService } from './ProjectService';

const QC1_RELEASE_DATE = new Date('2025-08-29');
const HIGH_PRIORITY_FETCH_STATUSES = new Set<TranslationStatus>([
	'completed by default',
	'reviewed',
	'automatically trimmed'
]);
const LOW_PRIORITY_FETCH_STATUSES = new Set<TranslationStatus>(['ai trimmed', 'fetched']);

export interface FetchTranslationsOptions {
	targetProject: Project;
	edition: Edition;
	sourceProjectDetails: ProjectDetail[];
	skipQC1Projects?: boolean;
	onProgress?: (progress: number) => void;
}

export interface FetchTranslationResult {
	fetched: number;
	review: BatchTranslationReviewCounts;
}

/**
 * Retourne les clips Quran d'un projet explicite.
 * @param {Project} project Projet à inspecter.
 * @returns {SubtitleClip[]} Clips Quran dans l'ordre de la piste.
 */
export function getProjectSubtitleClips(project: Project): SubtitleClip[] {
	return project.content.timeline
		.getFirstTrack(TrackType.Subtitle)
		.clips.filter((clip): clip is SubtitleClip => clip instanceof SubtitleClip);
}

/**
 * Construit la clé exacte utilisée pour faire correspondre deux segments Quran.
 * @param {SubtitleClip} clip Segment à indexer.
 * @returns {string} Clé sourate, verset et plage de mots.
 */
export function getTranslationFetchKey(clip: SubtitleClip): string {
	return `${clip.surah}:${clip.verse}:${clip.startWordIndex}:${clip.endWordIndex}`;
}

/**
 * Calcule le résumé canonique d'une édition à partir des traductions sauvegardées.
 * @param {Project} project Projet à inspecter.
 * @param {string} editionName Nom technique de l'édition.
 * @returns {BatchTranslationReviewCounts} Compteurs de revue de l'édition.
 */
export function getProjectTranslationReviewCounts(
	project: Project,
	editionName: string
): BatchTranslationReviewCounts {
	const review: BatchTranslationReviewCounts = {
		total: 0,
		complete: 0,
		pending: 0,
		fetched: 0,
		toReview: 0,
		errors: 0
	};
	for (const subtitle of getProjectSubtitleClips(project)) {
		const translation = subtitle.translations[editionName] as VerseTranslation | undefined;
		if (!translation) continue;
		review.total++;
		if (translation.isStatusComplete()) review.complete++;
		else review.pending++;
		if (translation.status === 'fetched') review.fetched++;
		if (translation.status === 'to review') review.toReview++;
		if (
			translation.status === 'ai error' ||
			translation.status === 'error' ||
			translation.status === 'undefined'
		)
			review.errors++;
	}
	return review;
}

/**
 * Récupère les traductions complètes d'autres projets pour une édition précise.
 * @param {FetchTranslationsOptions} options Projet cible, édition et sources autorisées.
 * @returns {Promise<FetchTranslationResult>} Nombre de copies et compteurs finaux.
 */
export async function fetchTranslationsFromOtherProjects(
	options: FetchTranslationsOptions
): Promise<FetchTranslationResult> {
	const {
		targetProject,
		edition,
		sourceProjectDetails,
		skipQC1Projects = false,
		onProgress
	} = options;
	const pendingByKey = new Map<string, SubtitleClip[]>();
	const changedIds = new Set<number>();

	for (const subtitle of getProjectSubtitleClips(targetProject)) {
		const translation = subtitle.translations[edition.name] as VerseTranslation | undefined;
		if (!translation || translation.isStatusComplete()) continue;
		const key = getTranslationFetchKey(subtitle);
		pendingByKey.set(key, [...(pendingByKey.get(key) ?? []), subtitle]);
	}

	const sources = sourceProjectDetails
		.filter(
			(detail) =>
				detail.id !== targetProject.detail.id &&
				(detail.translations[edition.author] ?? 0) > 40 &&
				(!skipQC1Projects || detail.createdAt >= QC1_RELEASE_DATE)
		)
		.slice()
		.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
	const totalSourcePasses = sources.length * 2;
	let completedSourcePasses = 0;
	let reportedProgress = totalSourcePasses === 0 ? 100 : 0;
	onProgress?.(reportedProgress);

	for (const allowedStatuses of [HIGH_PRIORITY_FETCH_STATUSES, LOW_PRIORITY_FETCH_STATUSES]) {
		if (pendingByKey.size === 0) break;
		for (const detail of sources) {
			if (pendingByKey.size === 0) break;
			const sourceProject = await ProjectService.load(detail.id);
			completedSourcePasses++;
			reportedProgress = Math.round((completedSourcePasses * 100) / totalSourcePasses);
			onProgress?.(reportedProgress);
			if (!sourceProject) continue;
			for (const sourceClip of getProjectSubtitleClips(sourceProject)) {
				const source = sourceClip.translations[edition.name] as VerseTranslation | undefined;
				if (!source || !allowedStatuses.has(source.status)) continue;
				const matches = pendingByKey.get(getTranslationFetchKey(sourceClip));
				const targetClip = matches?.shift();
				if (!targetClip || !matches) continue;
				if (matches.length === 0) pendingByKey.delete(getTranslationFetchKey(sourceClip));

				const target = targetClip.translations[edition.name] as VerseTranslation;
				const fullVerse = targetProject.content.projectTranslation.getVerseTranslation(
					edition,
					sourceClip.getVerseKey()
				);
				target.text =
					(source.isBruteForce
						? source.text
						: sliceTranslationTrimUnits(fullVerse, source.startWordIndex, source.endWordIndex)) ||
					source.text;
				target.startWordIndex = source.startWordIndex;
				target.endWordIndex = source.endWordIndex;
				target.isBruteForce = source.isBruteForce;
				target.inlineStyleRuns = [...(source.inlineStyleRuns ?? [])];
				target.status = 'fetched';
				if (source.isBruteForce) {
					target.tryRecalculateTranslationIndexes(edition, sourceClip.getVerseKey(), fullVerse);
				}
				changedIds.add(targetClip.id);
			}
		}
	}
	if (reportedProgress < 100) onProgress?.(100);

	if (changedIds.size > 0) {
		markInvalidAdvancedTrimTranslations(edition, {
			project: targetProject,
			shouldCheckTranslation: (_translation, subtitle) => changedIds.has(subtitle.id)
		});
	}
	targetProject.content.projectTranslation.updateProjectPercentage(targetProject, edition);
	return {
		fetched: changedIds.size,
		review: getProjectTranslationReviewCounts(targetProject, edition.name)
	};
}
