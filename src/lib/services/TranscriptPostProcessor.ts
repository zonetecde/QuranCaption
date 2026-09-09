import type {
	AITranscriptionResult,
	AITranscriptionSegment,
	AITranscriptionWord
} from '$lib/services/AITranscription';

const ARABIC_LETTER_REGEX = /[\u0621-\u063A\u0641-\u064A]/u;
const ARABIC_DIACRITICS_REGEX = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/gu;
const QURAN_SIGNS_REGEX = /[ۖۗۘۙۚۛۜ۩ࣰؕ-ࣹ]/gu;
const TRAILING_PUNCTUATION_REGEX = /^(.*?)([.,!?؟،؛:…]+)$/u;
const TERMINAL_PUNCTUATION_REGEX = /[.!?؟…]$/u;
const SOFT_PUNCTUATION_REGEX = /[،,؛;:]$/u;
const QURAN_WAQF_REGEX = /[ۖۗۘۙۚۛۜ۩ؕ]/u;
const DEFAULT_MAX_DURATION_SECONDS = 8;
const DEFAULT_MAX_READING_SPEED = 21;
const HARD_TRANSCRIPT_GAP_SECONDS = 2.5;
const MIN_QURAN_MATCH_WORDS = 3;
const MAX_QURAN_MATCH_WORDS = 32;

export type QuranTokenReference = {
	surah: number;
	verse: number;
	word: number;
	verseWordCount: number;
	waqf: boolean;
};

export type ProcessedTranscriptToken = {
	id: number;
	text: string;
	start: number;
	end: number;
	speaker: string;
	confidence: number | null;
	punctuationAfter: string;
	preferredBreakAfter: boolean;
	semanticBreakAfter?: TranscriptSemanticBoundaryKind | null;
	sourceIds: number[];
	quran: QuranTokenReference | null;
	quoteId: number | null;
	quoteType: TranscriptQuoteType | null;
};

export type TranscriptQuoteType = 'hadith' | 'scholar' | 'generic';
export type TranscriptSemanticBoundaryKind = 'sentence' | 'clause' | 'phrase';

export type TranscriptSemanticBoundary = {
	afterId: number;
	kind: TranscriptSemanticBoundaryKind;
};

export type TranscriptAiCorrection = {
	startId: number;
	endId: number;
	replacement: string;
	confidence: 'high' | 'medium' | 'low';
};

export type TranscriptAiQuote = {
	startId: number;
	endId: number;
	type: TranscriptQuoteType;
	confidence: 'high' | 'medium' | 'low';
};

export type TranscriptAiPunctuation = {
	id: number;
	value: string;
};

export type TranscriptAiQuranRejection = {
	startId: number;
	endId: number;
	confidence: 'high' | 'medium' | 'low';
};

export type TranscriptAiAnalysis = {
	corrections: TranscriptAiCorrection[];
	quotes: TranscriptAiQuote[];
	quranRejections?: TranscriptAiQuranRejection[];
	breakAfter: number[];
	punctuationAfter: TranscriptAiPunctuation[];
};

const ALLOWED_TRANSCRIPT_PUNCTUATION = new Set(['.', ',', ';', ':', '?', '!', '…', '،', '؛', '؟']);

/**
 * Vérifie qu'une ponctuation IA est un unique signe pris en charge.
 * @param {string} value Ponctuation proposée.
 * @returns {boolean} `true` lorsque le signe est autorisé.
 */
export function isAllowedTranscriptPunctuation(value: string): boolean {
	return ALLOWED_TRANSCRIPT_PUNCTUATION.has(value);
}

export type QuranCorpusToken = {
	text: string;
	normalized: string;
	surah: number;
	verse: number;
	word: number;
	verseWordCount: number;
	waqf: boolean;
};

export type QuranCorpus = {
	tokens: QuranCorpusToken[];
	exactIndex: Map<string, number[]>;
	prefixIndex: Map<string, number[]>;
};

export type QuranMatch = {
	inputStart: number;
	inputEnd: number;
	corpusStart: number;
	corpusEnd: number;
	score: number;
	matchedWords: number;
	exactWords: number;
};

export type TranscriptProcessingSettings = {
	maxWords: number;
	maxChars: number;
	maxGap: number;
};

export type TranscriptProcessingReport = {
	result: AITranscriptionResult;
	quranPassages: number;
	quotePassages: number;
	correctionsApplied: number;
	originalSegments: number;
	generatedSegments: number;
};

export type PreparedFinalTranscript = {
	tokens: ProcessedTranscriptToken[];
	correctionsApplied: number;
};

type MinimalQuranPayload = {
	verses: Record<string, string[]>;
};

let quranCorpusPromise: Promise<QuranCorpus> | null = null;

/**
 * Normalise un mot arabe pour les comparaisons tolérantes avec le corpus Quran.
 * @param {string} value Texte à normaliser.
 * @returns {string} Forme arabe simplifiée.
 */
export function normalizeArabicForMatching(value: string): string {
	return value
		.normalize('NFKD')
		.replace(ARABIC_DIACRITICS_REGEX, '')
		.replace(QURAN_SIGNS_REGEX, '')
		.replace(/ـ/gu, '')
		.replace(/[أإآٱ]/gu, 'ا')
		.replace(/ى/gu, 'ي')
		.replace(/ؤ/gu, 'و')
		.replace(/ئ/gu, 'ي')
		.replace(/[ةۀ]/gu, 'ه')
		.replace(/[^\u0621-\u063A\u0641-\u064A]/gu, '')
		.trim();
}

/**
 * Indique si un texte contient au moins une lettre arabe.
 * @param {string} value Texte à inspecter.
 * @returns {boolean} `true` lorsqu'une lettre arabe est présente.
 */
function containsArabic(value: string): boolean {
	return ARABIC_LETTER_REGEX.test(value);
}

/**
 * Sépare la ponctuation finale d'un token reconnu par l'ASR.
 * @param {string} value Token brut.
 * @returns {{ text: string; punctuation: string }} Token et ponctuation séparés.
 */
function splitTrailingPunctuation(value: string): { text: string; punctuation: string } {
	const trimmed = value.trim();
	const match = TRAILING_PUNCTUATION_REGEX.exec(trimmed);
	if (!match || !match[1].trim()) return { text: trimmed, punctuation: '' };
	return { text: match[1].trim(), punctuation: match[2] };
}

/**
 * Récupère la ponctuation du texte de segment lorsque l'aligneur ne la conserve pas dans words[].
 * @param {string} segmentText Texte complet retourné par l'ASR.
 * @param {AITranscriptionWord[]} words Mots horodatés sans ponctuation fiable.
 * @returns {string[]} Ponctuation associée à chaque mot horodaté.
 */
function alignSegmentTextPunctuation(segmentText: string, words: AITranscriptionWord[]): string[] {
	const punctuation = new Array(words.length).fill('') as string[];
	const displayTokens = segmentText
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.map(splitTrailingPunctuation);
	let displayCursor = 0;
	for (const [wordIndex, word] of words.entries()) {
		const source = splitTrailingPunctuation(word.word);
		const sourceNormalized = normalizeArabicForMatching(source.text);
		let matchIndex = -1;
		for (
			let candidateIndex = displayCursor;
			candidateIndex < Math.min(displayTokens.length, displayCursor + 3);
			candidateIndex += 1
		) {
			const candidate = displayTokens[candidateIndex];
			const candidateNormalized = normalizeArabicForMatching(candidate.text);
			const similarity =
				sourceNormalized && candidateNormalized
					? wordSimilarity(sourceNormalized, candidateNormalized)
					: source.text === candidate.text
						? 1
						: 0;
			if (similarity >= 0.72) {
				matchIndex = candidateIndex;
				break;
			}
		}
		if (matchIndex < 0) continue;
		punctuation[wordIndex] = displayTokens[matchIndex].punctuation;
		displayCursor = matchIndex + 1;
	}
	return punctuation;
}

/**
 * Distribue une durée entre plusieurs mots selon leur longueur visuelle.
 * @param {string[]} words Mots à horodater.
 * @param {number} start Début absolu en secondes.
 * @param {number} end Fin absolue en secondes.
 * @returns {Array<{ start: number; end: number }>} Plages continues calculées.
 */
function distributeWordTimings(
	words: string[],
	start: number,
	end: number
): Array<{ start: number; end: number }> {
	const safeEnd = Math.max(start + 0.001, end);
	const weights = words.map((word) =>
		Math.max(1, normalizeArabicForMatching(word).length || word.length)
	);
	const totalWeight = Math.max(
		1,
		weights.reduce((sum, weight) => sum + weight, 0)
	);
	let cursor = start;
	return weights.map((weight, index) => {
		const wordEnd =
			index === weights.length - 1
				? safeEnd
				: Math.min(safeEnd, cursor + ((safeEnd - start) * weight) / totalWeight);
		const timing = { start: cursor, end: Math.max(cursor + 0.001, wordEnd) };
		cursor = timing.end;
		return timing;
	});
}

/**
 * Transforme le résultat ASR en flux atomique de mots horodatés.
 * @param {AITranscriptionResult} result Résultat brut du transcriber.
 * @returns {ProcessedTranscriptToken[]} Mots ordonnés et stables.
 */
export function buildTimedTranscriptTokens(
	result: AITranscriptionResult
): ProcessedTranscriptToken[] {
	const tokens: ProcessedTranscriptToken[] = [];
	let nextId = 0;
	for (const segment of result.segments) {
		const validWords = (segment.words ?? []).filter(
			(word) =>
				word.word?.trim() &&
				Number.isFinite(Number(word.start)) &&
				Number.isFinite(Number(word.end)) &&
				Number(word.end) > Number(word.start)
		);
		if (validWords.length > 0) {
			const segmentTextPunctuation = alignSegmentTextPunctuation(segment.text, validWords);
			for (const [wordIndex, word] of validWords.entries()) {
				const separated = splitTrailingPunctuation(word.word);
				if (!separated.text) continue;
				tokens.push({
					id: nextId,
					text: separated.text,
					start: Number(word.start),
					end: Number(word.end),
					speaker: word.speaker?.trim() || segment.speaker,
					confidence: typeof word.confidence === 'number' ? word.confidence : null,
					punctuationAfter: separated.punctuation || segmentTextPunctuation[wordIndex],
					preferredBreakAfter: false,
					sourceIds: [nextId],
					quran: null,
					quoteId: null,
					quoteType: null
				});
				nextId += 1;
			}
			continue;
		}

		const fallbackWords = segment.text.trim().split(/\s+/).filter(Boolean);
		const timings = distributeWordTimings(fallbackWords, segment.start, segment.end);
		for (const [index, rawWord] of fallbackWords.entries()) {
			const separated = splitTrailingPunctuation(rawWord);
			if (!separated.text) continue;
			tokens.push({
				id: nextId,
				text: separated.text,
				start: timings[index].start,
				end: timings[index].end,
				speaker: segment.speaker,
				confidence: typeof segment.confidence === 'number' ? segment.confidence : null,
				punctuationAfter: separated.punctuation,
				preferredBreakAfter: false,
				sourceIds: [nextId],
				quran: null,
				quoteId: null,
				quoteType: null
			});
			nextId += 1;
		}
	}
	return tokens.sort((left, right) => left.start - right.start || left.end - right.end);
}

/**
 * Construit l'index Quran compact utilisé par le matcher local.
 * @param {Record<string, string[]>} verses Mots canoniques indexés par `sourate:verset`.
 * @returns {QuranCorpus} Corpus aplati et indexé.
 */
export function buildQuranCorpus(verses: Record<string, string[]>): QuranCorpus {
	const tokens: QuranCorpusToken[] = [];
	const exactIndex = new Map<string, number[]>();
	const prefixIndex = new Map<string, number[]>();
	const entries = Object.entries(verses).sort(([left], [right]) => {
		const [leftSurah, leftVerse] = left.split(':').map(Number);
		const [rightSurah, rightVerse] = right.split(':').map(Number);
		return leftSurah - rightSurah || leftVerse - rightVerse;
	});

	for (const [key, words] of entries) {
		const [surah, verse] = key.split(':').map(Number);
		for (const [index, text] of words.entries()) {
			const normalized = normalizeArabicForMatching(text);
			if (!normalized) continue;
			const position = tokens.length;
			tokens.push({
				text,
				normalized,
				surah,
				verse,
				word: index + 1,
				verseWordCount: words.length,
				waqf: QURAN_WAQF_REGEX.test(text)
			});
			const exactPositions = exactIndex.get(normalized) ?? [];
			exactPositions.push(position);
			exactIndex.set(normalized, exactPositions);
			const prefix = normalized.slice(0, 2);
			const prefixPositions = prefixIndex.get(prefix) ?? [];
			prefixPositions.push(position);
			prefixIndex.set(prefix, prefixPositions);
		}
	}
	return { tokens, exactIndex, prefixIndex };
}

/**
 * Charge une seule fois le corpus Quran compact embarqué dans l'application.
 * @returns {Promise<QuranCorpus>} Corpus prêt pour le matching.
 */
export async function loadQuranCorpus(): Promise<QuranCorpus> {
	quranCorpusPromise ??= fetch('/minimal-quran/verses.json')
		.then(async (response) => {
			if (!response.ok) throw new Error(`Unable to load Quran corpus: HTTP ${response.status}`);
			return (await response.json()) as MinimalQuranPayload;
		})
		.then((payload) => buildQuranCorpus(payload.verses));
	return quranCorpusPromise;
}

/**
 * Calcule une distance de Levenshtein entre deux chaînes courtes.
 * @param {string} left Première chaîne.
 * @param {string} right Seconde chaîne.
 * @returns {number} Nombre minimal d'insertions, suppressions ou substitutions.
 */
function levenshteinDistance(left: string, right: string): number {
	if (left === right) return 0;
	if (!left) return right.length;
	if (!right) return left.length;
	const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
	for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
		const current = [leftIndex];
		for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
			current[rightIndex] = Math.min(
				current[rightIndex - 1] + 1,
				previous[rightIndex] + 1,
				previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
			);
		}
		for (let index = 0; index < current.length; index += 1) previous[index] = current[index];
	}
	return previous[right.length];
}

/**
 * Mesure la similarité de deux mots arabes normalisés.
 * @param {string} left Premier mot.
 * @param {string} right Second mot.
 * @returns {number} Score compris entre 0 et 1.
 */
function wordSimilarity(left: string, right: string): number {
	if (left === right) return 1;
	if (!left || !right) return 0;
	const maxLength = Math.max(left.length, right.length);
	let similarity = 1 - levenshteinDistance(left, right) / maxLength;
	const removablePrefixes = ['و', 'ف', 'ب', 'ك', 'ل'];
	for (const prefix of removablePrefixes) {
		if (left.startsWith(prefix) && left.slice(1) === right) similarity = Math.max(similarity, 0.92);
		if (right.startsWith(prefix) && right.slice(1) === left)
			similarity = Math.max(similarity, 0.92);
	}
	return similarity;
}

/**
 * Retourne les débuts de corpus plausibles grâce aux ancres exactes de la fenêtre ASR.
 * @param {ProcessedTranscriptToken[]} tokens Flux ASR.
 * @param {number} inputStart Début de recherche.
 * @param {QuranCorpus} corpus Corpus Quran.
 * @returns {number[]} Positions candidates classées par nombre d'ancres.
 */
function getQuranCandidateStarts(
	tokens: ProcessedTranscriptToken[],
	inputStart: number,
	corpus: QuranCorpus
): number[] {
	const votes = new Map<number, number>();
	const firstToken = tokens[inputStart];
	const secondToken = tokens[inputStart + 1];
	if (
		firstToken &&
		secondToken &&
		!secondToken.quran &&
		secondToken.speaker === firstToken.speaker
	) {
		const mergedStart =
			normalizeArabicForMatching(firstToken.text) + normalizeArabicForMatching(secondToken.text);
		const mergedPositions = new Set([
			...(corpus.exactIndex.get(mergedStart) ?? []),
			...(corpus.prefixIndex.get(mergedStart.slice(0, 2)) ?? []).filter(
				(position) => wordSimilarity(mergedStart, corpus.tokens[position].normalized) >= 0.78
			)
		]);
		for (const position of mergedPositions) {
			votes.set(position, (votes.get(position) ?? 0) + 3);
		}
	}
	for (let offset = 0; offset < 5 && inputStart + offset < tokens.length; offset += 1) {
		const token = tokens[inputStart + offset];
		if (token.quran || token.speaker !== tokens[inputStart].speaker) break;
		const normalized = normalizeArabicForMatching(token.text);
		if (!normalized) continue;
		const positions = corpus.exactIndex.get(normalized) ?? [];
		for (const position of positions.slice(0, 1200)) {
			const start = position - offset;
			if (start < 0) continue;
			votes.set(start, (votes.get(start) ?? 0) + 1);
		}
	}

	if (votes.size === 0) {
		const normalized = normalizeArabicForMatching(tokens[inputStart]?.text ?? '');
		const prefixPositions = corpus.prefixIndex.get(normalized.slice(0, 2)) ?? [];
		for (const position of prefixPositions.slice(0, 160)) {
			if (wordSimilarity(normalized, corpus.tokens[position].normalized) >= 0.72) {
				votes.set(position, 1);
			}
		}
	}

	return [...votes.entries()]
		.sort((left, right) => right[1] - left[1])
		.slice(0, 64)
		.map(([position]) => position);
}

/**
 * Évalue un alignement monotone entre une fenêtre ASR et une position Quran.
 * @param {ProcessedTranscriptToken[]} tokens Flux ASR.
 * @param {number} inputStart Début ASR.
 * @param {QuranCorpus} corpus Corpus Quran.
 * @param {number} corpusStart Début Quran candidat.
 * @returns {QuranMatch | null} Meilleur préfixe fiable trouvé.
 */
function evaluateQuranCandidate(
	tokens: ProcessedTranscriptToken[],
	inputStart: number,
	corpus: QuranCorpus,
	corpusStart: number
): QuranMatch | null {
	const firstCorpusToken = corpus.tokens[corpusStart];
	if (!firstCorpusToken) return null;
	let inputIndex = inputStart;
	let corpusIndex = corpusStart;
	let matchedWords = 0;
	let exactWords = 0;
	let distinctiveExactWords = 0;
	let similaritySum = 0;
	let skippedWords = 0;
	let leadingSkips = 0;
	let firstMatchedInput = -1;
	let firstMatchedCorpus = -1;
	let lastMatchedInput = -1;
	let lastMatchedCorpus = -1;
	let best: QuranMatch | null = null;

	while (
		inputIndex < tokens.length &&
		corpusIndex < corpus.tokens.length &&
		inputIndex - inputStart < MAX_QURAN_MATCH_WORDS + 4 &&
		corpusIndex - corpusStart < MAX_QURAN_MATCH_WORDS + 4
	) {
		const inputToken = tokens[inputIndex];
		const corpusToken = corpus.tokens[corpusIndex];
		if (
			inputToken.quran ||
			inputToken.speaker !== tokens[inputStart].speaker ||
			corpusToken.surah !== firstCorpusToken.surah
		) {
			break;
		}
		const inputNormalized = normalizeArabicForMatching(inputToken.text);
		if (!inputNormalized || !containsArabic(inputToken.text)) break;
		const similarity = wordSimilarity(inputNormalized, corpusToken.normalized);
		const nextInput = tokens[inputIndex + 1];
		const mergedInputSimilarity =
			nextInput &&
			!nextInput.quran &&
			nextInput.speaker === inputToken.speaker &&
			containsArabic(nextInput.text)
				? wordSimilarity(
						inputNormalized + normalizeArabicForMatching(nextInput.text),
						corpusToken.normalized
					)
				: 0;
		const nextCorpus = corpus.tokens[corpusIndex + 1];
		const mergedCorpusSimilarity =
			nextCorpus && nextCorpus.surah === corpusToken.surah
				? wordSimilarity(inputNormalized, corpusToken.normalized + nextCorpus.normalized)
				: 0;

		if (mergedInputSimilarity >= 0.8 && mergedInputSimilarity > similarity + 0.08) {
			if (firstMatchedInput < 0) {
				firstMatchedInput = inputIndex;
				firstMatchedCorpus = corpusIndex;
			}
			lastMatchedInput = inputIndex + 1;
			lastMatchedCorpus = corpusIndex;
			matchedWords += 1;
			similaritySum += mergedInputSimilarity;
			if (mergedInputSimilarity === 1) {
				exactWords += 1;
				if (corpusToken.normalized.length >= 5) distinctiveExactWords += 1;
			}
			inputIndex += 2;
			corpusIndex += 1;
		} else if (mergedCorpusSimilarity >= 0.8 && mergedCorpusSimilarity > similarity + 0.08) {
			if (firstMatchedInput < 0) {
				firstMatchedInput = inputIndex;
				firstMatchedCorpus = corpusIndex;
			}
			lastMatchedInput = inputIndex;
			lastMatchedCorpus = corpusIndex + 1;
			matchedWords += 2;
			similaritySum += mergedCorpusSimilarity * 2;
			if (mergedCorpusSimilarity === 1) {
				exactWords += 2;
				if (corpusToken.normalized.length + nextCorpus.normalized.length >= 5) {
					distinctiveExactWords += 1;
				}
			}
			inputIndex += 1;
			corpusIndex += 2;
		} else if (similarity >= 0.64) {
			if (firstMatchedInput < 0) {
				firstMatchedInput = inputIndex;
				firstMatchedCorpus = corpusIndex;
			}
			lastMatchedInput = inputIndex;
			lastMatchedCorpus = corpusIndex;
			matchedWords += 1;
			similaritySum += similarity;
			if (similarity === 1) {
				exactWords += 1;
				if (corpusToken.normalized.length >= 5) distinctiveExactWords += 1;
			}
			inputIndex += 1;
			corpusIndex += 1;
		} else {
			const skipInputSimilarity =
				inputIndex + 1 < tokens.length
					? wordSimilarity(
							normalizeArabicForMatching(tokens[inputIndex + 1].text),
							corpusToken.normalized
						)
					: 0;
			const skipCorpusSimilarity =
				corpusIndex + 1 < corpus.tokens.length
					? wordSimilarity(inputNormalized, corpus.tokens[corpusIndex + 1].normalized)
					: 0;
			if (
				skipInputSimilarity >= 0.72 &&
				skipInputSimilarity > skipCorpusSimilarity &&
				(firstMatchedInput >= 0 || leadingSkips < 2)
			) {
				inputIndex += 1;
				if (firstMatchedInput >= 0) skippedWords += 1;
				else leadingSkips += 1;
			} else if (skipCorpusSimilarity >= 0.72 && (firstMatchedCorpus >= 0 || leadingSkips < 2)) {
				corpusIndex += 1;
				if (firstMatchedCorpus >= 0) skippedWords += 1;
				else leadingSkips += 1;
			} else if (similarity >= 0.45 && skippedWords <= 2 && firstMatchedInput >= 0) {
				if (firstMatchedInput < 0) {
					firstMatchedInput = inputIndex;
					firstMatchedCorpus = corpusIndex;
				}
				lastMatchedInput = inputIndex;
				lastMatchedCorpus = corpusIndex;
				matchedWords += 1;
				similaritySum += similarity;
				inputIndex += 1;
				corpusIndex += 1;
			} else {
				break;
			}
		}

		if (
			matchedWords >= MIN_QURAN_MATCH_WORDS &&
			firstMatchedInput >= 0 &&
			firstMatchedCorpus >= 0 &&
			lastMatchedInput >= firstMatchedInput &&
			lastMatchedCorpus >= firstMatchedCorpus
		) {
			const inputConsumed = lastMatchedInput - firstMatchedInput + 1;
			const corpusConsumed = lastMatchedCorpus - firstMatchedCorpus + 1;
			const coverage = matchedWords / Math.max(inputConsumed, corpusConsumed, 1);
			const averageSimilarity = similaritySum / matchedWords;
			const score = averageSimilarity * 0.78 + coverage * 0.22 - skippedWords * 0.025;
			const exactRatio = exactWords / matchedWords;
			const matchedFirstCorpusToken = corpus.tokens[firstMatchedCorpus];
			const matchedLastCorpusToken = corpus.tokens[lastMatchedCorpus];
			const touchesVerseBoundary =
				matchedFirstCorpusToken.word === 1 ||
				matchedLastCorpusToken.word === matchedLastCorpusToken.verseWordCount;
			const isCompleteSingleVerse =
				matchedFirstCorpusToken.surah === matchedLastCorpusToken.surah &&
				matchedFirstCorpusToken.verse === matchedLastCorpusToken.verse &&
				matchedFirstCorpusToken.word === 1 &&
				matchedLastCorpusToken.word === matchedLastCorpusToken.verseWordCount &&
				corpusConsumed === matchedLastCorpusToken.verseWordCount;
			const spansVerseBoundary = matchedFirstCorpusToken.verse !== matchedLastCorpusToken.verse;
			const reliableCompleteThreeWordVerse =
				matchedWords === 3 &&
				isCompleteSingleVerse &&
				exactWords >= 2 &&
				coverage >= 0.99 &&
				skippedWords === 0 &&
				score >= 0.93;
			const anchoredCrossVerseMatch =
				matchedWords >= 4 &&
				spansVerseBoundary &&
				(matchedLastCorpusToken.word === matchedLastCorpusToken.verseWordCount ||
					matchedLastCorpusToken.waqf) &&
				distinctiveExactWords >= 1 &&
				coverage >= 0.8 &&
				skippedWords === 0 &&
				averageSimilarity >= 0.8 &&
				score >= 0.8;
			const threeWordMatchIsSafe =
				matchedWords !== 3 ||
				reliableCompleteThreeWordVerse ||
				(score >= 0.97 && exactRatio >= 0.95 && touchesVerseBoundary);
			const minimumScore = matchedWords === 3 ? 0.97 : matchedWords === 4 ? 0.91 : 0.83;
			const standardMatch = score >= minimumScore && (matchedWords >= 5 || exactRatio >= 0.66);
			if (
				threeWordMatchIsSafe &&
				(standardMatch || reliableCompleteThreeWordVerse || anchoredCrossVerseMatch)
			) {
				const candidate: QuranMatch = {
					inputStart: firstMatchedInput,
					inputEnd: lastMatchedInput,
					corpusStart: firstMatchedCorpus,
					corpusEnd: lastMatchedCorpus,
					score,
					matchedWords,
					exactWords
				};
				if (!best || candidate.matchedWords * candidate.score > best.matchedWords * best.score) {
					best = candidate;
				}
			}
		}
	}
	return best;
}

/**
 * Sélectionne des correspondances Quran fiables et non chevauchantes.
 * @param {ProcessedTranscriptToken[]} tokens Flux de mots à analyser.
 * @param {QuranCorpus} corpus Corpus Quran local.
 * @returns {QuranMatch[]} Correspondances retenues dans l'ordre temporel.
 */
export function findQuranMatches(
	tokens: ProcessedTranscriptToken[],
	corpus: QuranCorpus
): QuranMatch[] {
	const candidates: QuranMatch[] = [];
	for (let inputStart = 0; inputStart < tokens.length; inputStart += 1) {
		const token = tokens[inputStart];
		if (token.quran || !containsArabic(token.text)) continue;
		let best: QuranMatch | null = null;
		for (const corpusStart of getQuranCandidateStarts(tokens, inputStart, corpus)) {
			const candidate = evaluateQuranCandidate(tokens, inputStart, corpus, corpusStart);
			if (!candidate) continue;
			if (!best || candidate.matchedWords * candidate.score > best.matchedWords * best.score) {
				best = candidate;
			}
		}
		if (best) candidates.push(best);
	}

	const sorted = candidates.sort((left, right) => left.inputEnd - right.inputEnd);
	const bestWeight = new Array(sorted.length + 1).fill(0) as number[];
	const previousCompatible = sorted.map((candidate, index) => {
		for (let previous = index - 1; previous >= 0; previous -= 1) {
			if (sorted[previous].inputEnd < candidate.inputStart) return previous;
		}
		return -1;
	});
	const take = new Array(sorted.length).fill(false) as boolean[];
	for (let index = 0; index < sorted.length; index += 1) {
		const candidate = sorted[index];
		const weight = candidate.matchedWords * candidate.score * candidate.score;
		const withCandidate = weight + bestWeight[previousCompatible[index] + 1];
		const withoutCandidate = bestWeight[index];
		if (withCandidate > withoutCandidate) {
			bestWeight[index + 1] = withCandidate;
			take[index] = true;
		} else {
			bestWeight[index + 1] = withoutCandidate;
		}
	}

	const selected: QuranMatch[] = [];
	let index = sorted.length - 1;
	while (index >= 0) {
		if (take[index]) {
			selected.push(sorted[index]);
			index = previousCompatible[index];
		} else {
			index -= 1;
		}
	}
	return selected.reverse().sort((left, right) => left.inputStart - right.inputStart);
}

/**
 * Remplace les plages reconnues par les mots Quran canoniques horodatés.
 * @param {ProcessedTranscriptToken[]} tokens Flux source.
 * @param {QuranMatch[]} matches Correspondances retenues.
 * @param {QuranCorpus} corpus Corpus Quran.
 * @returns {ProcessedTranscriptToken[]} Flux enrichi avec références exactes.
 */
export function canonicalizeQuranMatches(
	tokens: ProcessedTranscriptToken[],
	matches: QuranMatch[],
	corpus: QuranCorpus
): ProcessedTranscriptToken[] {
	if (matches.length === 0) return tokens;
	const output: ProcessedTranscriptToken[] = [];
	let inputCursor = 0;
	let nextId = Math.max(-1, ...tokens.map((token) => token.id)) + 1;
	for (const match of matches) {
		const canonical = corpus.tokens.slice(match.corpusStart, match.corpusEnd + 1);
		if (canonical.length === 0) continue;
		let effectiveInputStart = match.inputStart;
		const previousInput = tokens[effectiveInputStart - 1];
		const firstMatchedInput = tokens[effectiveInputStart];
		if (
			previousInput &&
			firstMatchedInput &&
			effectiveInputStart - 1 >= inputCursor &&
			previousInput.speaker === firstMatchedInput.speaker &&
			normalizeArabicForMatching(previousInput.text) +
				normalizeArabicForMatching(firstMatchedInput.text) ===
				canonical[0].normalized
		) {
			effectiveInputStart -= 1;
		}
		if (effectiveInputStart < inputCursor) continue;
		output.push(...tokens.slice(inputCursor, effectiveInputStart));
		const replaced = tokens.slice(effectiveInputStart, match.inputEnd + 1);
		if (replaced.length === 0) continue;
		const timings = distributeWordTimings(
			canonical.map((token) => token.text),
			replaced[0].start,
			replaced[replaced.length - 1].end
		);
		const sourceIds = Array.from(new Set(replaced.flatMap((token) => token.sourceIds)));
		const confidences = replaced
			.map((token) => token.confidence)
			.filter((confidence): confidence is number => typeof confidence === 'number');
		const confidence =
			confidences.length > 0
				? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
				: null;
		for (const [canonicalIndex, canonicalToken] of canonical.entries()) {
			output.push({
				id: nextId,
				text: canonicalToken.text.replace(QURAN_SIGNS_REGEX, '').trim(),
				start: timings[canonicalIndex].start,
				end: timings[canonicalIndex].end,
				speaker: replaced[0].speaker,
				confidence,
				punctuationAfter: '',
				preferredBreakAfter:
					canonicalToken.waqf || canonicalToken.word === canonicalToken.verseWordCount,
				sourceIds,
				quran: {
					surah: canonicalToken.surah,
					verse: canonicalToken.verse,
					word: canonicalToken.word,
					verseWordCount: canonicalToken.verseWordCount,
					waqf: canonicalToken.waqf
				},
				quoteId: null,
				quoteType: null
			});
			nextId += 1;
		}
		inputCursor = match.inputEnd + 1;
	}
	output.push(...tokens.slice(inputCursor));
	return output.sort((left, right) => left.start - right.start || left.end - right.end);
}

/**
 * Trouve les tokens issus d'une plage d'identifiants, même après une correction multi-mots.
 * @param {ProcessedTranscriptToken[]} tokens Flux courant.
 * @param {number} startId Premier identifiant source.
 * @param {number} endId Dernier identifiant source.
 * @returns {number[]} Index de tokens concernés.
 */
function findTokenIndexesBySourceRange(
	tokens: ProcessedTranscriptToken[],
	startId: number,
	endId: number
): number[] {
	const minimum = Math.min(startId, endId);
	const maximum = Math.max(startId, endId);
	return tokens.flatMap((token, index) =>
		token.sourceIds.some((sourceId) => sourceId >= minimum && sourceId <= maximum) ? [index] : []
	);
}

/**
 * Applique uniquement les corrections IA à haute confiance sans toucher aux mots Quran validés.
 * @param {ProcessedTranscriptToken[]} tokens Flux pré-validé.
 * @param {TranscriptAiCorrection[]} corrections Opérations structurées.
 * @returns {{ tokens: ProcessedTranscriptToken[]; applied: number }} Flux corrigé et compteur.
 */
export function applyTranscriptCorrections(
	tokens: ProcessedTranscriptToken[],
	corrections: TranscriptAiCorrection[]
): { tokens: ProcessedTranscriptToken[]; applied: number } {
	let output = [...tokens];
	let applied = 0;
	let nextId = Math.max(-1, ...tokens.map((token) => token.id)) + 1;
	const sorted = corrections
		.filter((correction) => correction.confidence === 'high' && correction.replacement.trim())
		.sort((left, right) => right.startId - left.startId);

	for (const correction of sorted) {
		const indexes = findTokenIndexesBySourceRange(output, correction.startId, correction.endId);
		if (indexes.length === 0) continue;
		const startIndex = Math.min(...indexes);
		const endIndex = Math.max(...indexes);
		const replaced = output.slice(startIndex, endIndex + 1);
		if (replaced.some((token) => token.quran)) continue;
		const replacementWords = correction.replacement.trim().split(/\s+/).filter(Boolean);
		if (
			replacementWords.length === 0 ||
			replacementWords.length > Math.max(8, replaced.length * 2 + 2)
		) {
			continue;
		}
		const timings = distributeWordTimings(
			replacementWords,
			replaced[0].start,
			replaced[replaced.length - 1].end
		);
		const sourceIds = Array.from(new Set(replaced.flatMap((token) => token.sourceIds)));
		const replacements = replacementWords.map((word, index) => {
			const separated = splitTrailingPunctuation(word);
			const token: ProcessedTranscriptToken = {
				id: nextId,
				text: separated.text,
				start: timings[index].start,
				end: timings[index].end,
				speaker: replaced[0].speaker,
				confidence: replaced[0].confidence,
				punctuationAfter:
					separated.punctuation ||
					(index === replacementWords.length - 1 ? replaced.at(-1)!.punctuationAfter : ''),
				preferredBreakAfter:
					index === replacementWords.length - 1 && replaced.at(-1)!.preferredBreakAfter,
				semanticBreakAfter:
					index === replacementWords.length - 1 ? replaced.at(-1)!.semanticBreakAfter : null,
				sourceIds,
				quran: null,
				quoteId: null,
				quoteType: null
			};
			nextId += 1;
			return token;
		});
		output.splice(startIndex, endIndex - startIndex + 1, ...replacements);
		applied += 1;
	}
	return { tokens: output, applied };
}

/**
 * Restaure les mots ASR originaux lorsqu'un passage Quran automatique est rejeté avec certitude.
 * @param {ProcessedTranscriptToken[]} tokens Flux contenant les passages Quran canoniques.
 * @param {ProcessedTranscriptToken[]} sourceTokens Flux ASR original avant détection Quran.
 * @param {TranscriptAiQuranRejection[]} rejections Rejets structurés retournés par l'IA.
 * @returns {ProcessedTranscriptToken[]} Flux avec les faux passages Quran restaurés.
 */
export function applyQuranRejections(
	tokens: ProcessedTranscriptToken[],
	sourceTokens: ProcessedTranscriptToken[],
	rejections: TranscriptAiQuranRejection[]
): ProcessedTranscriptToken[] {
	let output = [...tokens];
	const sourceById = new Map(sourceTokens.map((token) => [token.id, token]));
	const candidates = rejections
		.filter((rejection) => rejection.confidence === 'high')
		.map((rejection) => ({
			start: output.findIndex((token) => token.id === rejection.startId),
			end: output.findIndex((token) => token.id === rejection.endId)
		}))
		.filter(({ start, end }) => start >= 0 && end >= start)
		.sort((left, right) => right.start - left.start);

	for (const { start, end } of candidates) {
		const selected = output.slice(start, end + 1);
		if (selected.length === 0 || selected.some((token) => !token.quran)) continue;
		const sourceIds = Array.from(new Set(selected.flatMap((token) => token.sourceIds))).sort(
			(left, right) => left - right
		);
		const sourceKey = sourceIds.join(':');
		let expandedStart = start;
		let expandedEnd = end;
		while (
			expandedStart > 0 &&
			output[expandedStart - 1].quran &&
			[...output[expandedStart - 1].sourceIds].sort((a, b) => a - b).join(':') === sourceKey
		) {
			expandedStart -= 1;
		}
		while (
			expandedEnd + 1 < output.length &&
			output[expandedEnd + 1].quran &&
			[...output[expandedEnd + 1].sourceIds].sort((a, b) => a - b).join(':') === sourceKey
		) {
			expandedEnd += 1;
		}
		const restored = sourceIds
			.map((id) => sourceById.get(id))
			.filter((token): token is ProcessedTranscriptToken => token !== undefined)
			.map((token) => ({ ...token, quran: null, quoteId: null, quoteType: null }));
		if (restored.length === 0) continue;
		output.splice(expandedStart, expandedEnd - expandedStart + 1, ...restored);
	}
	return output;
}

/**
 * Attache les niveaux de coupure sémantique validés aux tokens correspondants.
 * @param {ProcessedTranscriptToken[]} tokens Flux nettoyé.
 * @param {TranscriptSemanticBoundary[]} boundaries Coupures retournées par l'IA.
 * @returns {ProcessedTranscriptToken[]} Copie annotée prête pour la segmentation locale.
 */
export function applyTranscriptSemanticBoundaries(
	tokens: ProcessedTranscriptToken[],
	boundaries: TranscriptSemanticBoundary[]
): ProcessedTranscriptToken[] {
	const byId = new Map(boundaries.map((boundary) => [boundary.afterId, boundary.kind]));
	return tokens.map((token) => ({
		...token,
		semanticBreakAfter: byId.get(token.id) ?? null
	}));
}

/**
 * Applique les citations, ponctuations et préférences de coupure retournées par l'IA.
 * @param {ProcessedTranscriptToken[]} tokens Flux corrigé.
 * @param {TranscriptAiAnalysis} analysis Analyse structurée.
 * @returns {ProcessedTranscriptToken[]} Flux annoté.
 */
export function applyTranscriptAnnotations(
	tokens: ProcessedTranscriptToken[],
	analysis: TranscriptAiAnalysis
): ProcessedTranscriptToken[] {
	const output = tokens.map((token) => ({ ...token }));
	let quoteId = 1;
	for (const quote of analysis.quotes.filter((candidate) => candidate.confidence === 'high')) {
		const indexes = findTokenIndexesBySourceRange(output, quote.startId, quote.endId);
		if (indexes.length === 0 || indexes.some((index) => output[index].quran)) continue;
		for (const index of indexes) {
			output[index].quoteId = quoteId;
			output[index].quoteType = quote.type;
		}
		quoteId += 1;
	}

	for (const punctuation of analysis.punctuationAfter) {
		const indexes = findTokenIndexesBySourceRange(output, punctuation.id, punctuation.id);
		const index = indexes.at(-1);
		if (index === undefined || output[index].quran) continue;
		if (isAllowedTranscriptPunctuation(punctuation.value)) {
			output[index].punctuationAfter = punctuation.value;
		}
	}
	for (const sourceId of analysis.breakAfter) {
		const indexes = findTokenIndexesBySourceRange(output, sourceId, sourceId);
		const index = indexes.at(-1);
		if (index !== undefined) output[index].preferredBreakAfter = true;
	}
	return output;
}

/**
 * Calcule le coût de lisibilité d'un sous-titre candidat.
 * @param {ProcessedTranscriptToken[]} block Bloc d'un même speaker.
 * @param {number} start Premier mot inclus.
 * @param {number} end Dernier mot inclus.
 * @param {TranscriptProcessingSettings} settings Limites utilisateur.
 * @returns {number} Coût à minimiser, ou l'infini pour une plage interdite.
 */
function getSubtitleCandidateCost(
	block: ProcessedTranscriptToken[],
	start: number,
	end: number,
	settings: TranscriptProcessingSettings
): number {
	const words = block.slice(start, end + 1);
	const duration = Math.max(0.001, words.at(-1)!.end - words[0].start);
	const wordCount = words.length;
	const charCount = words.reduce(
		(sum, token) => sum + token.text.length + token.punctuationAfter.length,
		0
	);
	const hardMaxWords = Math.max(settings.maxWords + 6, Math.ceil(settings.maxWords * 1.45));
	const hardMaxChars = Math.max(settings.maxChars + 40, Math.ceil(settings.maxChars * 1.4));
	if (
		duration > DEFAULT_MAX_DURATION_SECONDS ||
		wordCount > hardMaxWords ||
		charCount > hardMaxChars
	) {
		return Number.POSITIVE_INFINITY;
	}

	const readingSpeed = charCount / duration;
	let cost = Math.abs(duration - 3.6) * 0.8 + Math.abs(wordCount - 9) * 0.18;
	if (duration < 1.1) cost += (1.1 - duration) * 8;
	if (duration > 6) cost += (duration - 6) * 4;
	if (wordCount > settings.maxWords) cost += (wordCount - settings.maxWords) * 2.3;
	if (charCount > settings.maxChars) cost += (charCount - settings.maxChars) * 0.28;
	if (readingSpeed > DEFAULT_MAX_READING_SPEED) {
		cost += (readingSpeed - DEFAULT_MAX_READING_SPEED) * 1.8;
	}

	const last = words.at(-1)!;
	const next = block[end + 1];
	const gap = next ? Math.max(0, next.start - last.end) : settings.maxGap;
	// Un preset plus long exige une frontière sémantique plus forte avant de changer de sous-titre.
	if (next) cost += settings.maxWords * 0.75;
	if (!next || gap >= settings.maxGap) cost -= 5;
	if (TERMINAL_PUNCTUATION_REGEX.test(last.punctuationAfter)) cost -= 4;
	else if (SOFT_PUNCTUATION_REGEX.test(last.punctuationAfter)) cost -= 2;
	if (last.preferredBreakAfter) cost -= 4;
	if (last.semanticBreakAfter === 'sentence') cost -= 18;
	else if (last.semanticBreakAfter === 'clause') cost -= 13;
	else if (last.semanticBreakAfter === 'phrase') cost -= 8;
	if (gap >= 0.7) cost -= 4;
	else if (gap >= 0.35) cost -= 1.5;
	if (last.quran && last.quran.word === last.quran.verseWordCount) cost -= 9;
	else if (last.quran?.waqf) cost -= 6;
	else if (last.quran && next?.quran) cost += 7;
	if (last.quoteId && next?.quoteId === last.quoteId) cost += 1.5;

	const connector = normalizeArabicForMatching(last.text);
	if (['و', 'ف', 'في', 'من', 'الي', 'على', 'عن', 'ان', 'لكن', 'لان', 'ثم'].includes(connector)) {
		cost += 7;
	}
	const remaining = block.length - end - 1;
	if (wordCount === 1) cost += 12;
	else if (wordCount === 2) cost += 5;
	if (remaining === 1) cost += 14;
	else if (remaining === 2) cost += 6;
	return cost;
}

/**
 * Découpe un bloc continu par programmation dynamique.
 * @param {ProcessedTranscriptToken[]} block Mots d'un speaker sans longue pause.
 * @param {TranscriptProcessingSettings} settings Limites de lisibilité.
 * @returns {ProcessedTranscriptToken[][]} Sous-titres optimisés.
 */
function segmentContinuousBlock(
	block: ProcessedTranscriptToken[],
	settings: TranscriptProcessingSettings
): ProcessedTranscriptToken[][] {
	if (block.length === 0) return [];
	const costs = new Array(block.length + 1).fill(Number.POSITIVE_INFINITY) as number[];
	const previous = new Array(block.length + 1).fill(-1) as number[];
	costs[0] = 0;
	for (let endExclusive = 1; endExclusive <= block.length; endExclusive += 1) {
		for (let start = endExclusive - 1; start >= 0; start -= 1) {
			const candidateCost = getSubtitleCandidateCost(block, start, endExclusive - 1, settings);
			if (!Number.isFinite(candidateCost)) continue;
			const total = costs[start] + candidateCost;
			if (total < costs[endExclusive]) {
				costs[endExclusive] = total;
				previous[endExclusive] = start;
			}
		}
	}
	if (previous[block.length] < 0) return block.map((token) => [token]);

	const segments: ProcessedTranscriptToken[][] = [];
	let cursor = block.length;
	while (cursor > 0) {
		const start = previous[cursor];
		if (start < 0) break;
		segments.push(block.slice(start, cursor));
		cursor = start;
	}
	return segments.reverse();
}

/**
 * Joint des tokens ordinaires en conservant leur ponctuation attachée.
 * @param {ProcessedTranscriptToken[]} tokens Mots à afficher.
 * @returns {string} Texte lisible.
 */
function joinDisplayTokens(tokens: ProcessedTranscriptToken[]): string {
	return tokens
		.map((token) => `${token.text}${token.punctuationAfter}`)
		.join(' ')
		.trim();
}

/**
 * Produit les marqueurs Quran et citations d'un sous-titre final.
 * @param {ProcessedTranscriptToken[]} tokens Mots du sous-titre.
 * @returns {string} Texte stocké dans le SubtitleClip.
 */
export function renderProcessedSubtitleText(tokens: ProcessedTranscriptToken[]): string {
	const parts: string[] = [];
	let cursor = 0;
	while (cursor < tokens.length) {
		const token = tokens[cursor];
		if (token.quran) {
			let end = cursor;
			while (
				end + 1 < tokens.length &&
				tokens[end + 1].quran?.surah === token.quran.surah &&
				tokens[end + 1].quran?.verse === token.quran.verse &&
				tokens[end + 1].quran!.word === tokens[end].quran!.word + 1
			) {
				end += 1;
			}
			const startWord = token.quran.word;
			const endWord = tokens[end].quran!.word;
			parts.push(
				startWord === 1 && endWord === token.quran.verseWordCount
					? `{{${token.quran.surah}:${token.quran.verse}}}`
					: `{{${token.quran.surah}:${token.quran.verse}:${startWord}-${endWord}}}`
			);
			cursor = end + 1;
			continue;
		}
		if (token.quoteId !== null) {
			let end = cursor;
			while (end + 1 < tokens.length && tokens[end + 1].quoteId === token.quoteId) end += 1;
			parts.push(`{{${joinDisplayTokens(tokens.slice(cursor, end + 1))}}}`);
			cursor = end + 1;
			continue;
		}
		let end = cursor;
		while (end + 1 < tokens.length && !tokens[end + 1].quran && tokens[end + 1].quoteId === null) {
			end += 1;
		}
		parts.push(joinDisplayTokens(tokens.slice(cursor, end + 1)));
		cursor = end + 1;
	}
	return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Transforme le flux préparé en segments de sous-titres optimisés.
 * @param {ProcessedTranscriptToken[]} tokens Mots corrigés et annotés.
 * @param {TranscriptProcessingSettings} settings Contraintes de segmentation.
 * @returns {AITranscriptionSegment[]} Segments prêts à prévisualiser ou appliquer.
 */
export function segmentProcessedTranscript(
	tokens: ProcessedTranscriptToken[],
	settings: TranscriptProcessingSettings
): AITranscriptionSegment[] {
	const blocks: ProcessedTranscriptToken[][] = [];
	let current: ProcessedTranscriptToken[] = [];
	for (const token of tokens) {
		const previous = current.at(-1);
		if (
			previous &&
			(previous.speaker !== token.speaker ||
				token.start - previous.end >= HARD_TRANSCRIPT_GAP_SECONDS)
		) {
			blocks.push(current);
			current = [];
		}
		current.push(token);
	}
	if (current.length > 0) blocks.push(current);

	return blocks
		.flatMap((block) => segmentContinuousBlock(block, settings))
		.map((segmentTokens) => {
			const confidenceValues = segmentTokens
				.map((token) => token.confidence)
				.filter((value): value is number => typeof value === 'number');
			const words: AITranscriptionWord[] = segmentTokens.map((token) => ({
				word: token.text,
				start: token.start,
				end: token.end,
				confidence: token.confidence,
				speaker: token.speaker
			}));
			return {
				start: segmentTokens[0].start,
				end: segmentTokens.at(-1)!.end,
				text: renderProcessedSubtitleText(segmentTokens),
				speaker: segmentTokens[0].speaker,
				confidence:
					confidenceValues.length > 0
						? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
						: null,
				words
			};
		});
}

/**
 * Applique les opérations de contenu validées avant toute décision de segmentation.
 * @param {AITranscriptionResult} source Résultat ASR original.
 * @param {ProcessedTranscriptToken[]} preparedTokens Tokens protégés par la première passe Quran.
 * @param {QuranCorpus} corpus Corpus Quran.
 * @param {TranscriptAiAnalysis} analysis Opérations IA validées.
 * @returns {PreparedFinalTranscript} Flux nettoyé et nombre de corrections appliquées.
 */
export function prepareFinalTranscriptTokens(
	source: AITranscriptionResult,
	preparedTokens: ProcessedTranscriptToken[],
	corpus: QuranCorpus,
	analysis: TranscriptAiAnalysis
): PreparedFinalTranscript {
	const corrected = applyTranscriptCorrections(preparedTokens, analysis.corrections);
	const postMatches = findQuranMatches(corrected.tokens, corpus);
	const quranAware = canonicalizeQuranMatches(corrected.tokens, postMatches, corpus);
	const reviewedQuran = applyQuranRejections(
		quranAware,
		buildTimedTranscriptTokens(source),
		analysis.quranRejections ?? []
	);
	return {
		tokens: applyTranscriptAnnotations(reviewedQuran, analysis),
		correctionsApplied: corrected.applied
	};
}

/**
 * Compte les passages Quran continus présents dans le flux.
 * @param {ProcessedTranscriptToken[]} tokens Flux enrichi.
 * @returns {number} Nombre de passages distincts.
 */
function countQuranPassages(tokens: ProcessedTranscriptToken[]): number {
	let count = 0;
	for (const [index, token] of tokens.entries()) {
		if (!token.quran) continue;
		const previous = tokens[index - 1];
		if (
			!previous?.quran ||
			previous.quran.surah !== token.quran.surah ||
			previous.quran.verse !== token.quran.verse ||
			previous.quran.word + 1 !== token.quran.word
		) {
			count += 1;
		}
	}
	return count;
}

/**
 * Exécute la passe déterministe finale après l'analyse IA facultative.
 * @param {AITranscriptionResult} source Résultat ASR original.
 * @param {ProcessedTranscriptToken[]} preparedTokens Tokens déjà protégés par la première passe Quran.
 * @param {QuranCorpus} corpus Corpus Quran.
 * @param {TranscriptAiAnalysis} analysis Opérations IA validées.
 * @param {TranscriptProcessingSettings} settings Contraintes de segmentation.
 * @returns {TranscriptProcessingReport} Résultat final et statistiques.
 */
export function finalizeTranscriptProcessing(
	source: AITranscriptionResult,
	preparedTokens: ProcessedTranscriptToken[],
	corpus: QuranCorpus,
	analysis: TranscriptAiAnalysis,
	settings: TranscriptProcessingSettings,
	semanticBoundaries: TranscriptSemanticBoundary[] = []
): TranscriptProcessingReport {
	const prepared = prepareFinalTranscriptTokens(source, preparedTokens, corpus, analysis);
	const annotated = applyTranscriptSemanticBoundaries(prepared.tokens, semanticBoundaries);
	const segments = segmentProcessedTranscript(annotated, settings);
	const quoteIds = new Set(annotated.map((token) => token.quoteId).filter((id) => id !== null));
	return {
		result: {
			...source,
			segments,
			speakers: Array.from(new Set(segments.map((segment) => segment.speaker))),
			wordTimestampsAvailable: segments.some((segment) => segment.words.length > 0)
		},
		quranPassages: countQuranPassages(annotated),
		quotePassages: quoteIds.size,
		correctionsApplied: prepared.correctionsApplied,
		originalSegments: source.segments.length,
		generatedSegments: segments.length
	};
}

/**
 * Prépare le flux pour l'IA en protégeant d'abord les passages Quran déjà certains.
 * @param {AITranscriptionResult} source Résultat ASR.
 * @param {QuranCorpus} corpus Corpus Quran local.
 * @returns {{ tokens: ProcessedTranscriptToken[]; quranPassages: number }} Flux canonique initial.
 */
export function prepareTranscriptForAnalysis(
	source: AITranscriptionResult,
	corpus: QuranCorpus
): { tokens: ProcessedTranscriptToken[]; quranPassages: number } {
	const rawTokens = buildTimedTranscriptTokens(source);
	const matches = findQuranMatches(rawTokens, corpus);
	const tokens = canonicalizeQuranMatches(rawTokens, matches, corpus);
	return { tokens, quranPassages: countQuranPassages(tokens) };
}
