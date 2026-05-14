import type { VerseRef, CoverageGapDependencies, SegmentationSegment } from './types';
import { getPredefinedType } from './predefined';

/**
 * Parse une référence de verset au format "surah:verse:word".
 *
 * @param {string | undefined} ref Chaîne de référence brute.
 * @returns {VerseRef | null} Référence parsée ou null si invalide.
 */
export function parseVerseRef(ref?: string): VerseRef | null {
	if (!ref) return null;

	const match: RegExpMatchArray | null = ref.match(/^(\d+):(\d+):(\d+)$/);
	if (!match) return null;

	return {
		surah: Number(match[1]),
		verse: Number(match[2]),
		word: Number(match[3])
	};
}

/**
 * Compare deux références de versets (ordre croissant sourate > verset > mot).
 *
 * @param {VerseRef} a Première référence.
 * @param {VerseRef} b Deuxième référence.
 * @returns {number} Nombre négatif si a < b, 0 si égal, positif si a > b.
 */
export function compareVerseRefs(a: VerseRef, b: VerseRef): number {
	if (a.surah !== b.surah) return a.surah - b.surah;
	if (a.verse !== b.verse) return a.verse - b.verse;
	return a.word - b.word;
}

/**
 * Détecte les indices de segments qui créent des trous de couverture dans les versets.
 * Un trou de couverture survient quand des mots d'un verset sont sautés entre deux
 * segments consécutifs, ou quand un verset entier est omis.
 *
 * @param {Array<Pick<SegmentationSegment, 'ref_from' | 'ref_to' | 'error' | 'special_type'>>} orderedSegments
 *   Segments triés par temps.
 * @param {CoverageGapDependencies} deps Dépendances pour la résolution des versets.
 * @returns {Promise<Set<number>>} Ensemble des indices de segments à revoir pour trous de couverture.
 */
export async function detectCoverageGapIndices(
	orderedSegments: Array<
		Pick<SegmentationSegment, 'ref_from' | 'ref_to' | 'error' | 'special_type'>
	>,
	deps: CoverageGapDependencies
): Promise<Set<number>> {
	const { getVerseWordCount, getVerseCount, getSurahCount } = deps;

	const normalizeRef = async (ref: VerseRef): Promise<VerseRef | null> => {
		const wordCount = await getVerseWordCount(ref.surah, ref.verse);
		if (!wordCount || wordCount <= 0) return null;

		let word = ref.word;
		if (word < 1) word = 1;
		if (word > wordCount) word = wordCount;

		return { surah: ref.surah, verse: ref.verse, word };
	};

	const getExpectedNextRef = async (ref: VerseRef): Promise<VerseRef | null> => {
		const wordCount = await getVerseWordCount(ref.surah, ref.verse);
		if (!wordCount || wordCount <= 0) return null;

		if (ref.word < wordCount) {
			return { surah: ref.surah, verse: ref.verse, word: ref.word + 1 };
		}

		const verseCount = getVerseCount(ref.surah);
		if (verseCount > 0 && ref.verse < verseCount) {
			return { surah: ref.surah, verse: ref.verse + 1, word: 1 };
		}

		const surahCount = getSurahCount();
		if (ref.surah < surahCount) {
			return { surah: ref.surah + 1, verse: 1, word: 1 };
		}

		return null;
	};

	const coverageMap = new Map<string, Set<number>>();
	const normalizedSegments: Array<{ startRef: VerseRef; endRef: VerseRef } | null> = Array(
		orderedSegments.length
	).fill(null);

	const addCoverageRange = (
		surah: number,
		verse: number,
		startWord: number,
		endWord: number
	): void => {
		if (startWord > endWord) return;

		const key = `${surah}:${verse}`;
		let covered = coverageMap.get(key);
		if (!covered) {
			covered = new Set<number>();
			coverageMap.set(key, covered);
		}

		for (let word = startWord; word <= endWord; word += 1) {
			covered.add(word);
		}
	};

	for (let i = 0; i < orderedSegments.length; i += 1) {
		const segment = orderedSegments[i];
		if (segment.error) continue;
		if (getPredefinedType(segment.ref_from, segment.special_type)) continue;

		const rawStartRef = parseVerseRef(segment.ref_from);
		const rawEndRef = parseVerseRef(segment.ref_to);
		if (!rawStartRef || !rawEndRef) continue;
		if (rawStartRef.surah !== rawEndRef.surah) continue;

		let startRef = await normalizeRef(rawStartRef);
		let endRef = await normalizeRef(rawEndRef);
		if (!startRef || !endRef) continue;

		if (compareVerseRefs(startRef, endRef) > 0) {
			[startRef, endRef] = [endRef, startRef];
		}

		normalizedSegments[i] = { startRef, endRef };

		if (startRef.verse === endRef.verse) {
			addCoverageRange(startRef.surah, startRef.verse, startRef.word, endRef.word);
			continue;
		}

		for (let verseNumber = startRef.verse; verseNumber <= endRef.verse; verseNumber += 1) {
			const wordCount = await getVerseWordCount(startRef.surah, verseNumber);
			if (!wordCount || wordCount <= 0) continue;

			const isFirstVerse = verseNumber === startRef.verse;
			const isLastVerse = verseNumber === endRef.verse;

			const fromWord = isFirstVerse ? startRef.word : 1;
			const toWord = isLastVerse ? endRef.word : wordCount;

			addCoverageRange(startRef.surah, verseNumber, fromWord, toWord);
		}
	}

	const getPreviousRef = async (ref: VerseRef): Promise<VerseRef | null> => {
		const wordCount = await getVerseWordCount(ref.surah, ref.verse);
		if (!wordCount || wordCount <= 0) return null;

		if (ref.word > 1) {
			return { surah: ref.surah, verse: ref.verse, word: ref.word - 1 };
		}

		const prevVerse = ref.verse - 1;
		if (prevVerse >= 1) {
			const prevWordCount = await getVerseWordCount(ref.surah, prevVerse);
			const prevLast = prevWordCount && prevWordCount > 0 ? prevWordCount : 1;
			return { surah: ref.surah, verse: prevVerse, word: prevLast };
		}

		const prevSurah = ref.surah - 1;
		if (prevSurah >= 1) {
			const prevVerseCount = getVerseCount(prevSurah);
			if (prevVerseCount > 0) {
				const prevWordCount = await getVerseWordCount(prevSurah, prevVerseCount);
				const prevLast = prevWordCount && prevWordCount > 0 ? prevWordCount : 1;
				return { surah: prevSurah, verse: prevVerseCount, word: prevLast };
			}
		}

		return null;
	};

	const isRangeFullyCovered = async (start: VerseRef, end: VerseRef): Promise<boolean> => {
		let current = { ...start };
		while (compareVerseRefs(current, end) <= 0) {
			const wordCount = await getVerseWordCount(current.surah, current.verse);
			if (!wordCount || wordCount <= 0) return false;

			const isLastVerse = current.surah === end.surah && current.verse === end.verse;
			const endWord = isLastVerse ? end.word : wordCount;
			const key = `${current.surah}:${current.verse}`;
			const covered = coverageMap.get(key);

			for (let word = current.word; word <= endWord; word += 1) {
				if (!covered?.has(word)) return false;
			}

			if (isLastVerse) break;

			const verseCount = getVerseCount(current.surah);
			if (verseCount > 0 && current.verse < verseCount) {
				current = { surah: current.surah, verse: current.verse + 1, word: 1 };
			} else {
				const surahCount = getSurahCount();
				if (current.surah < surahCount) {
					current = { surah: current.surah + 1, verse: 1, word: 1 };
				} else {
					break;
				}
			}
		}
		return true;
	};

	const coverageGapIndices = new Set<number>();
	let progressRef: VerseRef | null = null;

	for (let i = 0; i < orderedSegments.length; i += 1) {
		const segment = orderedSegments[i];
		if (segment.error) continue;
		if (getPredefinedType(segment.ref_from, segment.special_type)) continue;

		const normalized = normalizedSegments[i];
		if (!normalized) continue;

		const { startRef } = normalized;

		if (progressRef) {
			const expectedNextRef = await getExpectedNextRef(progressRef);
			if (expectedNextRef && compareVerseRefs(startRef, expectedNextRef) > 0) {
				const gapEndRef = await getPreviousRef(startRef);
				const gapCovered = gapEndRef ? await isRangeFullyCovered(expectedNextRef, gapEndRef) : false;
				if (!gapCovered) {
					coverageGapIndices.add(i - 1);
					coverageGapIndices.add(i);
				}
			}
		}

		if (!progressRef || compareVerseRefs(normalized.endRef, progressRef) > 0) {
			progressRef = normalized.endRef;
		}
	}

	return coverageGapIndices;
}
