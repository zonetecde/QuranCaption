import { globalState } from '$lib/runes/main.svelte';
import { SubtitleClip } from '$lib/classes';
import type { SegmentationSegment } from './types';
import { enrichSegmentationResponseWithWordTimestamps } from './enrichment';
import { buildSubtitleAlignmentMetadata, refreshSegmentationContextFromTrack } from './context';

/**
 * Compte le nombre de mots Quran couverts par un sous-titre.
 *
 * @param {SubtitleClip} clip Sous-titre Quran à mesurer.
 * @returns {number} Nombre de mots dans la plage du clip.
 */
export function getSubtitleClipWordCount(clip: SubtitleClip): number {
	return Math.max(0, clip.endWordIndex - clip.startWordIndex + 1);
}

/**
 * Retourne les segments Quran considérés comme longs pour un seuil donné.
 *
 * @param {number} minWords Seuil minimal de mots.
 * @returns {SubtitleClip[]} Liste triée des sous-titres trop longs.
 */
export function getLongSubtitleClips(minWords: number, maxWords: number): SubtitleClip[] {
	const lowerBound = Math.max(1, Math.min(minWords, maxWords));
	const upperBound = Math.max(lowerBound, Math.max(minWords, maxWords));

	return globalState.getSubtitleClips
		.filter((clip) => {
			const wordCount = getSubtitleClipWordCount(clip);
			return wordCount >= lowerBound && wordCount <= upperBound;
		})
		.sort((left, right) => left.startTime - right.startTime);
}

/**
 * Marque ou démarque les segments trop longs selon le seuil courant.
 *
 * @param {number} minWords Seuil minimal de mots.
 * @returns {number} Nombre de segments marqués.
 */
export function markLongSegmentsForReview(minWords: number, maxWords: number): number {
	const lowerBound = Math.max(1, Math.min(minWords, maxWords));
	const upperBound = Math.max(lowerBound, Math.max(minWords, maxWords));
	let markedCount = 0;

	for (const clip of globalState.getSubtitleClips) {
		const wordCount = getSubtitleClipWordCount(clip);
		const isLong = wordCount >= lowerBound && wordCount <= upperBound;
		const hasOtherActiveReview = clip.needsReview || clip.needsCoverageReview;

		if (!isLong) {
			clip.needsLongReview = false;
			continue;
		}

		if (clip.hasBeenVerified !== true && hasOtherActiveReview) {
			continue;
		}

		// Si le clip a déjà été vérifié, et que c'était auparavant un segment low confidence ou missing words
		if (clip.hasBeenVerified === true) {
			// On convertit un segment déjà vérifié en segment long, sans garder l'ancien motif.
			clip.needsReview = false;
			clip.needsCoverageReview = false;
			clip.hasBeenVerified = false;
		}

		clip.needsLongReview = true;
		markedCount += 1;
	}

	return markedCount;
}

/**
 * Efface tous les marquages "too long" (rose).
 */
export function clearLongSegmentsReview(): void {
	for (const clip of globalState.getSubtitleClips) {
		clip.needsLongReview = false;
	}
}

/**
 * Retourne les segments Quran qui n'ont pas encore de timestamps WBW.
 *
 * @returns {SubtitleClip[]} Liste triée des sous-titres sans timestamps WBW.
 */
export function getSubtitleClipsWithoutWbwTimestamps(): SubtitleClip[] {
	return globalState.getSubtitleClips
		.filter((clip) => (clip.alignmentMetadata?.words.length ?? 0) === 0)
		.sort((left, right) => left.startTime - right.startTime);
}

/**
 * Marque ou démarque les segments dépourvus de timestamps WBW.
 *
 * @returns {number} Nombre de segments marqués.
 */
export function markSubtitlesWithoutWbwTimestampsForReview(): number {
	let markedCount = 0;

	for (const clip of globalState.getSubtitleClips) {
		const hasWbwTimestamps = (clip.alignmentMetadata?.words.length ?? 0) > 0;
		if (hasWbwTimestamps) {
			clip.needsWbwTimestampReview = false;
			continue;
		}

		clip.needsWbwTimestampReview = true;
		clip.hasBeenVerified = false;
		markedCount += 1;
	}

	return markedCount;
}

/**
 * Efface tous les marquages bleus de segments sans timestamps WBW.
 */
export function clearWbwTimestampReview(): void {
	for (const clip of globalState.getSubtitleClips) {
		clip.needsWbwTimestampReview = false;
	}
}

/**
 * Calcule les timestamps WBW manquants via l'API du Universal Aligner (`/timestamps_direct`).
 *
 * Indépendant de la segmentation : construit un segment par sous-titre dépourvu de timestamps
 * (quelle que soit la façon dont le projet a été créé), demande l'alignement MFA à partir de
 * l'audio courant, puis réinjecte les mots dans chaque clip. Réutilise les métadonnées
 * d'alignement existantes quand elles sont présentes, sinon les dérive des références du clip.
 *
 * @returns {Promise<{ enriched: number; total: number }>} Nombre de clips enrichis et total ciblé.
 */
export async function computeMissingWbwTimestamps(): Promise<{ enriched: number; total: number }> {
	return computeWbwTimestampsForClips(getSubtitleClipsWithoutWbwTimestamps());
}

/**
 * Calcule les timestamps WBW pour une liste de sous-titres donnée via `/timestamps_direct`.
 *
 * Variante ciblée de {@link computeMissingWbwTimestamps} : permet de (re)calculer les
 * timestamps d'un seul clip (menu contextuel) ou d'un sous-ensemble, sans toucher aux autres.
 *
 * @param {SubtitleClip[]} clips Sous-titres dont les timestamps doivent être calculés.
 * @returns {Promise<{ enriched: number; total: number }>} Nombre de clips enrichis et total ciblé.
 */
export async function computeWbwTimestampsForClips(
	clips: SubtitleClip[]
): Promise<{ enriched: number; total: number }> {
	if (clips.length === 0) return { enriched: 0, total: 0 };

	const segments: SegmentationSegment[] = clips.map((clip, index) => {
		const meta = clip.alignmentMetadata;
		return {
			segment: meta?.segment ?? index,
			ref_from: meta?.refFrom || `${clip.surah}:${clip.verse}:${clip.startWordIndex + 1}`,
			ref_to: meta?.refTo || `${clip.surah}:${clip.verse}:${clip.endWordIndex + 1}`,
			matched_text: meta?.matchedText ?? clip.text,
			special_type: meta?.specialType,
			time_from: meta?.timeFrom ?? clip.startTime / 1000,
			time_to: meta?.timeTo ?? clip.endTime / 1000,
			words: []
		};
	});

	const response = await enrichSegmentationResponseWithWordTimestamps({ segments });
	const enrichedSegments = response.segments ?? [];

	let enriched = 0;
	clips.forEach((clip, index) => {
		const words = enrichedSegments[index]?.words ?? [];
		if (words.length === 0) return;

		// Recale les mots sur la durée du clip, comme lors de l'application d'une segmentation.
		const clipDurationS = (clip.endTime - clip.startTime) / 1000;
		const clampedWords = words.map((word, position, arr) => ({
			...word,
			start: position === 0 ? 0 : Math.max(0, Math.min(clipDurationS, word.start)),
			end:
				position === arr.length - 1 ? clipDurationS : Math.max(0, Math.min(clipDurationS, word.end))
		}));

		const metadata = buildSubtitleAlignmentMetadata(
			clip.alignmentMetadata?.source ?? 'api',
			segments[index],
			clampedWords
		);
		if (metadata) {
			clip.alignmentMetadata = metadata;
			clip.needsWbwTimestampReview = false;
			enriched += 1;
		}
	});

	if (enriched > 0) refreshSegmentationContextFromTrack(true);
	return { enriched, total: clips.length };
}
