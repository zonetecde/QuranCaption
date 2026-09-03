import { type Clip, PredefinedSubtitleClip, SilenceClip, SubtitleClip } from '../../Clip.svelte.js';
import { Quran, type Verse } from '../../Quran.js';
import { Translation } from '../../Translation.svelte.js';
import {
	SubtitleContentFactory,
	type SubtitlePropertiesResolver
} from './SubtitleContentFactory.js';

export type WordBoundarySplitCandidate = {
	leftEndWordIndex: number;
	splitTimeMs: number;
};

type WordBoundarySplitRequest = {
	clips: Clip[];
	clipIndex: number;
	clip: SubtitleClip;
	splitTimeMs: number;
	leftEndWordIndex: number;
	resolveProperties: SubtitlePropertiesResolver;
};

/** Regroupe les règles métier propres au découpage des sous-titres. */
export class SubtitleSplitService {
	/**
	 * Retourne l'index Quran 0-based porté par une location MFA.
	 * @param {string} location Clé au format `surah:verse:word`.
	 * @returns {number | null} Index 0-based, ou `null` si la clé est invalide.
	 */
	private static getWordIndexFromLocation(location: string): number | null {
		const wordIndex = Number(location.split(':')[2]);
		return Number.isFinite(wordIndex) && wordIndex > 0 ? wordIndex - 1 : null;
	}

	/**
	 * Cherche la limite de mot la plus proche du curseur.
	 * @param {SubtitleClip} clip Clip Quran à couper.
	 * @param {number} splitTimeMs Position actuelle du curseur.
	 * @returns {WordBoundarySplitCandidate | null} Limite retenue, ou `null` sans timestamps WBW.
	 */
	static getNearestWordBoundarySplitCandidate(
		clip: SubtitleClip,
		splitTimeMs: number
	): WordBoundarySplitCandidate | null {
		const metadata = clip.alignmentMetadata;
		if (!metadata?.words.length) return null;

		let bestCandidate: WordBoundarySplitCandidate | null = null;
		let bestDistance = Number.POSITIVE_INFINITY;
		for (const word of metadata.words) {
			const wordIndex = this.getWordIndexFromLocation(word.location);
			if (wordIndex === null) continue;
			const candidates = [
				{
					leftEndWordIndex: wordIndex - 1,
					splitTimeMs: Math.round((metadata.timeFrom + word.start) * 1000)
				},
				{
					leftEndWordIndex: wordIndex,
					splitTimeMs: Math.round((metadata.timeFrom + word.end) * 1000)
				}
			];
			for (const candidate of candidates) {
				if (
					candidate.leftEndWordIndex < clip.startWordIndex ||
					candidate.leftEndWordIndex >= clip.endWordIndex
				) {
					continue;
				}
				const distance = Math.abs(candidate.splitTimeMs - splitTimeMs);
				if (distance >= bestDistance) continue;
				bestDistance = distance;
				bestCandidate = candidate;
			}
		}
		return bestCandidate;
	}

	/**
	 * Choisit la répartition des mots pour une coupe exacte au curseur.
	 * @param {SubtitleClip} clip Clip Quran à couper.
	 * @param {number} splitTimeMs Position actuelle du curseur.
	 * @returns {number | null} Dernier mot de la partie gauche, ou `null`.
	 */
	static getExactCursorSplitWordIndex(clip: SubtitleClip, splitTimeMs: number): number | null {
		const metadata = clip.alignmentMetadata;
		if (!metadata?.words.length) return null;

		const splitOffsetS = splitTimeMs / 1000 - metadata.timeFrom;
		let leftEndWordIndex: number | null = null;
		for (const word of metadata.words) {
			const wordIndex = this.getWordIndexFromLocation(word.location);
			if (wordIndex === null) continue;
			if (splitOffsetS <= word.start) {
				leftEndWordIndex = wordIndex - 1;
				break;
			}
			if (splitOffsetS >= word.end) {
				leftEndWordIndex = wordIndex;
				continue;
			}
			const leftDuration = splitOffsetS - word.start;
			const rightDuration = word.end - splitOffsetS;
			leftEndWordIndex = leftDuration >= rightDuration ? wordIndex : wordIndex - 1;
			break;
		}
		return leftEndWordIndex === null
			? null
			: Math.max(clip.startWordIndex, Math.min(clip.endWordIndex - 1, leftEndWordIndex));
	}

	/**
	 * Coupe un clip Quran en conservant ses plages de mots et timestamps WBW.
	 * @param {WordBoundarySplitRequest} request Données nécessaires à la coupe.
	 * @returns {Promise<boolean>} `true` lorsque la coupe a été appliquée.
	 */
	static async splitAtWordBoundary(request: WordBoundarySplitRequest): Promise<boolean> {
		const { clip, splitTimeMs, leftEndWordIndex } = request;
		const metadata = clip.alignmentMetadata;
		if (!metadata) return false;
		if (leftEndWordIndex < clip.startWordIndex || leftEndWordIndex >= clip.endWordIndex) {
			return false;
		}

		const verse = await Quran.getVerse(clip.surah, clip.verse);
		if (!verse) return false;
		const originalEndTime = clip.endTime;
		const originalStartTime = clip.startTime;
		const originalStartWordIndex = clip.startWordIndex;
		const originalEndWordIndex = clip.endWordIndex;
		const rightStartWordIndex = leftEndWordIndex + 1;
		const rightClip = clip.cloneWithTimes(splitTimeMs, originalEndTime);

		clip.setEndTimeSilently(splitTimeMs);
		await SubtitleContentFactory.hydrateClip(
			clip,
			verse,
			originalStartWordIndex,
			leftEndWordIndex,
			request.resolveProperties
		);
		await SubtitleContentFactory.hydrateClip(
			rightClip,
			verse,
			rightStartWordIndex,
			originalEndWordIndex,
			request.resolveProperties
		);

		clip.alignmentMetadata = this.buildAlignmentMetadata(
			metadata,
			verse,
			clip.surah,
			clip.verse,
			originalStartWordIndex,
			leftEndWordIndex,
			0,
			originalStartTime / 1000,
			splitTimeMs / 1000
		);
		rightClip.alignmentMetadata = this.buildAlignmentMetadata(
			metadata,
			verse,
			rightClip.surah,
			rightClip.verse,
			rightStartWordIndex,
			originalEndWordIndex,
			splitTimeMs / 1000 - metadata.timeFrom,
			splitTimeMs / 1000,
			originalEndTime / 1000
		);
		this.markAsManualEdit(clip);
		this.markAsManualEdit(rightClip);
		request.clips.splice(request.clipIndex + 1, 0, rightClip);
		return true;
	}

	/**
	 * Clone un clip non aligné pour la partie droite d'une coupe simple.
	 * @param {SubtitleClip | PredefinedSubtitleClip | SilenceClip} clip Clip source.
	 * @param {number} splitTime Début du nouveau clip.
	 * @param {number} originalEndTime Fin du clip source avant la coupe.
	 * @returns {SubtitleClip | PredefinedSubtitleClip | SilenceClip} Partie droite clonée.
	 */
	static cloneRightClip(
		clip: SubtitleClip | PredefinedSubtitleClip | SilenceClip,
		splitTime: number,
		originalEndTime: number
	): SubtitleClip | PredefinedSubtitleClip | SilenceClip {
		if (clip instanceof SubtitleClip) return clip.cloneWithTimes(splitTime, originalEndTime);
		if (clip instanceof SilenceClip) return new SilenceClip(splitTime, originalEndTime);

		const clone = new PredefinedSubtitleClip(
			splitTime,
			originalEndTime,
			clip.predefinedSubtitleType,
			clip.text,
			clip.comeFromIA,
			clip.confidence
		);
		const translations: Record<string, Translation> = {};
		for (const [key, translation] of Object.entries(clip.translations || {})) {
			translations[key] = translation.clone();
		}
		clone.translations = translations;
		clone.associatedImagePath = clip.associatedImagePath;
		return clone;
	}

	/**
	 * Applique les indicateurs d'édition manuelle sans supprimer les timestamps WBW.
	 * @param {SubtitleClip | PredefinedSubtitleClip} clip Clip à marquer.
	 * @returns {void}
	 */
	static markAsManualEdit(clip: SubtitleClip | PredefinedSubtitleClip): void {
		clip.comeFromIA = false;
		clip.confidence = null;
		clip.needsReview = false;
		clip.needsCoverageReview = false;
		clip.needsLongReview = false;
		clip.hasBeenVerified = false;
	}

	/**
	 * Reconstruit les timestamps WBW d'une moitié de split.
	 * @param {NonNullable<SubtitleClip['alignmentMetadata']>} metadata Métadonnées source.
	 * @param {Verse} verse Verset source.
	 * @param {number} surah Sourate du clip.
	 * @param {number} verseNumber Numéro du verset.
	 * @param {number} startWordIndex Premier mot inclus.
	 * @param {number} endWordIndex Dernier mot inclus.
	 * @param {number} offsetS Décalage à soustraire aux timings.
	 * @param {number} timeFromS Début absolu du clip en secondes.
	 * @param {number} timeToS Fin absolue du clip en secondes.
	 * @returns {NonNullable<SubtitleClip['alignmentMetadata']>} Métadonnées de la nouvelle moitié.
	 */
	private static buildAlignmentMetadata(
		metadata: NonNullable<SubtitleClip['alignmentMetadata']>,
		verse: Verse,
		surah: number,
		verseNumber: number,
		startWordIndex: number,
		endWordIndex: number,
		offsetS: number,
		timeFromS: number,
		timeToS: number
	): NonNullable<SubtitleClip['alignmentMetadata']> {
		const clipDurationS = Math.max(0, timeToS - timeFromS);
		let previousEnd = 0;
		const words = metadata.words
			.filter((word) => {
				const index = this.getWordIndexFromLocation(word.location);
				return index !== null && index >= startWordIndex && index <= endWordIndex;
			})
			.map((word) => {
				const start = Math.max(previousEnd, Math.min(clipDurationS, word.start - offsetS));
				const end = Math.max(start, Math.min(clipDurationS, word.end - offsetS));
				previousEnd = end;
				return { ...word, start, end };
			});
		if (words.length) {
			words[0] = { ...words[0], start: 0 };
			words[words.length - 1] = { ...words[words.length - 1], end: clipDurationS };
		}
		return {
			...metadata,
			refFrom: `${surah}:${verseNumber}:${startWordIndex + 1}`,
			refTo: `${surah}:${verseNumber}:${endWordIndex + 1}`,
			matchedText: verse.getArabicTextBetweenTwoIndexes(startWordIndex, endWordIndex),
			timeFrom: timeFromS,
			timeTo: timeToS,
			words
		};
	}
}
