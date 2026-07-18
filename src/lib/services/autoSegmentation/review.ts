import { globalState } from '$lib/runes/main.svelte';
import { PredefinedSubtitleClip, SubtitleClip } from '$lib/classes';
import type { RealignWindow, SegmentationSegment } from './types';
import { enrichSegmentationResponseWithWordTimestamps } from './enrichment';
import { buildSubtitleAlignmentMetadata, refreshSegmentationContextFromTrack } from './context';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';

type WbwTimestampClip = SubtitleClip | PredefinedSubtitleClip;

/**
 * Indique si un clip peut recevoir des timestamps mot à mot.
 *
 * @param {unknown} clip Clip à inspecter.
 * @returns {boolean} `true` pour un sous-titre Quran ou une Basmala/Isti'adha prédéfinie.
 */
export function isWbwTimestampClip(clip: unknown): clip is WbwTimestampClip {
	return (
		clip instanceof SubtitleClip ||
		(clip instanceof PredefinedSubtitleClip &&
			(clip.predefinedSubtitleType === 'Basmala' || clip.predefinedSubtitleType === "Isti'adha"))
	);
}

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
 * @returns {WbwTimestampClip[]} Liste triée des sous-titres sans timestamps WBW.
 */
export function getSubtitleClipsWithoutWbwTimestamps(): WbwTimestampClip[] {
	return globalState.getSubtitleTrack.clips
		.filter(isWbwTimestampClip)
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

	for (const clip of globalState.getSubtitleTrack.clips.filter(isWbwTimestampClip)) {
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
 * Calcule la fenêtre audio (ms, coordonnées timeline) couvrant un ensemble de clips.
 *
 * @param {WbwTimestampClip[]} clips Clips concernés.
 * @returns {RealignWindow} Fenêtre `[startMs, endMs]` à trancher/téléverser.
 */
export function computeRealignWindow(clips: WbwTimestampClip[]): RealignWindow {
	const starts = clips.map((clip) =>
		Math.round((clip.alignmentMetadata?.timeFrom ?? clip.startTime / 1000) * 1000)
	);
	const ends = clips.map((clip) =>
		Math.round((clip.alignmentMetadata?.timeTo ?? clip.endTime / 1000) * 1000)
	);
	return { startMs: Math.min(...starts), endMs: Math.max(...ends) };
}

/**
 * Calcule les timestamps WBW manquants via l'API du Universal Aligner (`/timestamps_direct`).
 *
 * Indépendant de la segmentation : construit un segment par sous-titre dépourvu de timestamps
 * (quelle que soit la façon dont le projet a été créé), demande l'alignement mot à mot à partir de
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
 * Téléverse uniquement la fenêtre audio qui couvre les clips ciblés.
 *
 * @param {WbwTimestampClip[]} clips Sous-titres dont les timestamps doivent être calculés.
 * @returns {Promise<{ enriched: number; total: number }>} Nombre de clips enrichis et total ciblé.
 */
export async function computeWbwTimestampsForClips(
	clips: WbwTimestampClip[]
): Promise<{ enriched: number; total: number }> {
	if (clips.length === 0) return { enriched: 0, total: 0 };
	return computeWbwTimestampsForClipsSliced(clips, {
		window: computeRealignWindow(clips)
	});
}

/**
 * Cœur du calcul WBW, avec tranche audio optionnelle et garde « dernier gagne ».
 *
 * Quand une fenêtre est fournie, seul l'audio `[startMs, endMs]` est téléversé et les temps des
 * segments envoyés au service sont recalés sur l'origine de la fenêtre ; les temps ABSOLUS (timeline)
 * restent écrits dans `alignmentMetadata`. Les mots renvoyés sont relatifs au segment, donc le
 * recalage sur la durée du clip est inchangé.
 *
 * @param {WbwTimestampClip[]} clips Sous-titres à (re)calculer.
 * @param {{ window?: RealignWindow; shouldCommit?: (clip: WbwTimestampClip) => boolean }} opts Options
 *   de tranche et garde « dernier gagne » par clip.
 * @returns {Promise<{ enriched: number; total: number }>} Nombre de clips enrichis et total ciblé.
 */
export async function computeWbwTimestampsForClipsSliced(
	clips: WbwTimestampClip[],
	opts: { window?: RealignWindow; shouldCommit?: (clip: WbwTimestampClip) => boolean }
): Promise<{ enriched: number; total: number }> {
	if (clips.length === 0) return { enriched: 0, total: 0 };

	const window = opts.window && opts.window.endMs > opts.window.startMs ? opts.window : undefined;
	const baseS = window ? window.startMs / 1000 : 0;

	// Segments aux temps ABSOLUS (timeline) — réutilisés pour écrire les métadonnées.
	const segments: SegmentationSegment[] = clips.map((clip, index) => {
		const meta = clip.alignmentMetadata;
		const specialType =
			clip instanceof PredefinedSubtitleClip ? clip.predefinedSubtitleType : meta?.specialType;
		const refFrom =
			meta?.refFrom ||
			(clip instanceof PredefinedSubtitleClip
				? specialType
				: `${clip.surah}:${clip.verse}:${clip.startWordIndex + 1}`);
		const refTo =
			meta?.refTo ||
			(clip instanceof PredefinedSubtitleClip
				? specialType
				: `${clip.surah}:${clip.verse}:${clip.endWordIndex + 1}`);
		return {
			segment: meta?.segment ?? index,
			ref_from: refFrom,
			ref_to: refTo,
			matched_text: meta?.matchedText ?? clip.text,
			special_type: specialType,
			time_from: meta?.timeFrom ?? clip.startTime / 1000,
			time_to: meta?.timeTo ?? clip.endTime / 1000,
			words: []
		};
	});

	// Pour un appel tranché, on recale les temps des segments sur l'origine de la fenêtre uploadée.
	const requestSegments: SegmentationSegment[] = window
		? segments.map((segment) => ({
				...segment,
				time_from: (segment.time_from ?? 0) - baseS,
				time_to: (segment.time_to ?? 0) - baseS
			}))
		: segments;

	const response = await enrichSegmentationResponseWithWordTimestamps(
		{ segments: requestSegments },
		window
	);
	const enrichedSegments = response.segments ?? [];

	let enriched = 0;
	ProjectHistoryManager.track('compute wbw timestamps', () => {
		clips.forEach((clip, index) => {
			const words = enrichedSegments[index]?.words ?? [];
			if (words.length === 0) return;
			// « Dernier gagne » par clip : on n'écrase pas un clip réédité depuis le début de l'appel.
			if (opts.shouldCommit && !opts.shouldCommit(clip)) return;

			// Recale les mots sur la durée du clip, comme lors de l'application d'une segmentation.
			const clipDurationS = (clip.endTime - clip.startTime) / 1000;
			const clampedWords = words.map((word, position, arr) => ({
				...word,
				start: position === 0 ? 0 : Math.max(0, Math.min(clipDurationS, word.start)),
				end:
					position === arr.length - 1
						? clipDurationS
						: Math.max(0, Math.min(clipDurationS, word.end))
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
	});

	if (enriched > 0) refreshSegmentationContextFromTrack(true);
	return { enriched, total: clips.length };
}
