import { globalState } from '$lib/runes/main.svelte';
import { SubtitleClip } from '$lib/classes';
import { normalizeTranscriptWordTimings } from '$lib/classes/Clip.svelte';
import {
	formatTranscriptReferencesForExport,
	getQuranTranscriptReferenceWordCount,
	getTranscriptReferenceLogicalParts
} from '$lib/services/TranscriptReferenceService';
import type { RealignWindow, SegmentationSegment } from './types';
import { getSegmentationWhisperXTimestamps } from './enrichment';
import { refreshSegmentationContextFromTrack } from './context';

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
 * Calcule les timestamps WBW manquants avec le runtime WhisperX local.
 *
 * Indépendant de la segmentation : construit un segment par sous-titre dépourvu de timestamps
 * (quelle que soit la façon dont le projet a été créé), demande l'alignement WhisperX à partir de
 * l'audio courant, puis réinjecte les mots dans chaque clip. Réutilise les métadonnées
 * d'alignement existantes quand elles sont présentes, sinon les dérive des références du clip.
 *
 * @returns {Promise<{ enriched: number; total: number }>} Nombre de clips enrichis et total ciblé.
 */
export async function computeMissingWbwTimestamps(): Promise<{ enriched: number; total: number }> {
	return computeWbwTimestampsForClips(getSubtitleClipsWithoutWbwTimestamps());
}

/**
 * Calcule les timestamps WBW pour une liste de sous-titres avec le runtime WhisperX local.
 *
 * Variante ciblée de {@link computeMissingWbwTimestamps} : permet de (re)calculer les
 * timestamps d'un seul clip (menu contextuel) ou d'un sous-ensemble, sans toucher aux autres.
 * Téléverse l'audio complet (utilisé par les actions manuelles « Générer »/« Calculer »).
 *
 * @param {SubtitleClip[]} clips Sous-titres dont les timestamps doivent être calculés.
 * @returns {Promise<{ enriched: number; total: number }>} Nombre de clips enrichis et total ciblé.
 */
export async function computeWbwTimestampsForClips(
	clips: SubtitleClip[]
): Promise<{ enriched: number; total: number }> {
	return computeWbwTimestampsForClipsSliced(clips, {});
}

type WbwAlignmentInput = {
	matchedText: string;
	refFrom: string | null;
	refTo: string | null;
};

/**
 * Résout le texte réellement prononcé et les bornes Quran d'un sous-titre structuré.
 * @param {string} text Texte sérialisé du sous-titre.
 * @returns {Promise<WbwAlignmentInput>} Entrée prête pour l'aligneur WBW.
 */
async function buildWbwAlignmentInput(text: string): Promise<WbwAlignmentInput> {
	const matchedText = await formatTranscriptReferencesForExport(text, 'Plain', false, false);
	const references = (getTranscriptReferenceLogicalParts(text) ?? []).flatMap((part) =>
		part.quranReference ? [part.quranReference] : []
	);
	const first = references[0];
	const last = references.at(-1);
	if (!first || !last) return { matchedText, refFrom: null, refTo: null };

	const lastWord = last.endWord ?? getQuranTranscriptReferenceWordCount(last) ?? 1;
	return {
		matchedText,
		refFrom: `${first.surah}:${first.verse}:${first.startWord ?? 1}`,
		refTo: `${last.surah}:${last.verse}:${lastWord}`
	};
}

/**
 * Cœur du calcul WBW, avec tranche audio optionnelle et garde « dernier gagne ».
 *
 * Quand une fenêtre est fournie, seul l'audio `[startMs, endMs]` est transmis au worker local et les
 * temps des segments sont recalés sur son origine. Les temps absolus restent persistés dans les
 * métadonnées, tandis que les mots renvoyés restent relatifs à chaque sous-titre.
 *
 * @param {SubtitleClip[]} clips Sous-titres à (re)calculer.
 * @param {{ window?: RealignWindow; shouldCommit?: (clip: SubtitleClip) => boolean }} opts Options
 *   de tranche et garde « dernier gagne » par clip.
 * @returns {Promise<{ enriched: number; total: number }>} Nombre de clips enrichis et total ciblé.
 */
export async function computeWbwTimestampsForClipsSliced(
	clips: SubtitleClip[],
	opts: { window?: RealignWindow; shouldCommit?: (clip: SubtitleClip) => boolean }
): Promise<{ enriched: number; total: number }> {
	if (clips.length === 0) return { enriched: 0, total: 0 };

	const window = opts.window && opts.window.endMs > opts.window.startMs ? opts.window : undefined;
	const baseS = window ? window.startMs / 1000 : 0;
	const alignmentInputs = await Promise.all(clips.map((clip) => buildWbwAlignmentInput(clip.text)));

	// Segments aux temps ABSOLUS (timeline) — réutilisés pour écrire les métadonnées.
	const segments: SegmentationSegment[] = clips.map((clip, index) => {
		const meta = clip.alignmentMetadata;
		const input = alignmentInputs[index];
		return {
			segment: meta?.segment ?? index,
			ref_from: input.refFrom ?? meta?.refFrom ?? '',
			ref_to: input.refTo ?? meta?.refTo ?? '',
			matched_text: input.matchedText,
			special_type: meta?.specialType,
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

	const response = await getSegmentationWhisperXTimestamps(requestSegments, window);
	const enrichedSegments = response.segments ?? [];

	let enriched = 0;
	clips.forEach((clip, index) => {
		const words = enrichedSegments[index]?.words ?? [];
		if (words.length === 0) return;
		// « Dernier gagne » par clip : on n'écrase pas un clip réédité depuis le début de l'appel.
		if (opts.shouldCommit && !opts.shouldCommit(clip)) return;

		// Applique les mêmes frontières continues que le post-traitement de la transcription complète.
		const clipDurationS = (clip.endTime - clip.startTime) / 1000;
		const normalizedTimings = normalizeTranscriptWordTimings(
			words.map((word) => ({ ...word, word: word.word ?? word.location })),
			clipDurationS
		);
		const normalizedWords = words.map((word, index) => ({
			...word,
			start: normalizedTimings[index].start,
			end: normalizedTimings[index].end
		}));

		const segment = segments[index];
		clip.alignmentMetadata = {
			source: 'local',
			segment: segment.segment ?? index,
			refFrom: segment.ref_from ?? '',
			refTo: segment.ref_to ?? '',
			matchedText: segment.matched_text ?? clip.text,
			specialType: segment.special_type,
			timeFrom: segment.time_from ?? clip.startTime / 1000,
			timeTo: segment.time_to ?? clip.endTime / 1000,
			words: normalizedWords
		};
		clip.needsWbwTimestampReview = false;
		enriched += 1;
	});

	if (enriched > 0) refreshSegmentationContextFromTrack(true);
	return { enriched, total: clips.length };
}
