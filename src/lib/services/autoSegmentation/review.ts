import { globalState } from '$lib/runes/main.svelte';
import { SubtitleClip } from '$lib/classes';

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
export function getLongSubtitleClips(minWords: number): SubtitleClip[] {
	return globalState.getSubtitleClips
		.filter((clip) => getSubtitleClipWordCount(clip) >= Math.max(1, minWords))
		.sort((left, right) => left.startTime - right.startTime);
}

/**
 * Marque ou démarque les segments trop longs selon le seuil courant.
 *
 * @param {number} minWords Seuil minimal de mots.
 * @returns {number} Nombre de segments marqués.
 */
export function markLongSegmentsForReview(minWords: number): number {
	const threshold = Math.max(1, minWords);
	let markedCount = 0;

	for (const clip of globalState.getSubtitleClips) {
		const isLong = getSubtitleClipWordCount(clip) >= threshold;
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
