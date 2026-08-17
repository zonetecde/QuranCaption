import type { SubtitleClip } from '$lib/classes/Clip.svelte';
import MinimalQuranProvider from '$lib/services/MinimalQuranProvider';

export type MeaningExportVerse = {
	key: string;
	surah: number;
	verse: number;
	startTime: number;
	endTime: number;
	durationMs: number;
	arabic: string;
};

export type MeaningExportRange = {
	id: string;
	startKey: string;
	endKey: string;
	startTime: number;
	endTime: number;
	durationMs: number;
	exceedsMaxDuration: boolean;
};

export type MeaningExportRangeValidationResult = {
	ranges: MeaningExportRange[];
	skippedCount: number;
	missingVerseKeys: string[];
};

export type MeaningArabicTextResolver = (surah: number, verse: number) => Promise<string>;

/**
 * Construit les occurrences chronologiques de versets avec leur durée réelle dans la vidéo.
 * @param {SubtitleClip[]} subtitles Sous-titres de la vidéo à regrouper.
 * @param {MeaningArabicTextResolver} [resolveArabicText] Résolveur de texte arabe optionnel.
 * @returns {Promise<MeaningExportVerse[]>} Occurrences de versets triées dans l'ordre de la vidéo.
 */
export async function buildMeaningExportVerses(
	subtitles: SubtitleClip[],
	resolveArabicText?: MeaningArabicTextResolver
): Promise<MeaningExportVerse[]> {
	const occurrences: Array<{
		key: string;
		surah: number;
		verse: number;
		startTime: number;
		endTime: number;
		lastEndWordIndex: number | null;
	}> = [];

	for (const subtitle of [...subtitles].sort((left, right) => left.startTime - right.startTime)) {
		const key = `${subtitle.surah}:${subtitle.verse}`;
		const current = occurrences.at(-1);
		const wordContinues =
			current &&
			current.key === key &&
			current.lastEndWordIndex !== null &&
			subtitle.startWordIndex > current.lastEndWordIndex;
		const timingContinues =
			current && current.key === key && subtitle.startTime <= current.endTime + 100;
		if (current && current.key === key && (wordContinues || timingContinues)) {
			current.startTime = Math.min(current.startTime, subtitle.startTime);
			current.endTime = Math.max(current.endTime, subtitle.endTime);
			current.lastEndWordIndex = Math.max(current.lastEndWordIndex ?? -1, subtitle.endWordIndex);
			continue;
		}

		occurrences.push({
			key,
			surah: subtitle.surah,
			verse: subtitle.verse,
			startTime: subtitle.startTime,
			endTime: subtitle.endTime,
			lastEndWordIndex: subtitle.endWordIndex
		});
	}

	if (occurrences.length === 0) return [];
	if (!resolveArabicText) await MinimalQuranProvider.prefetch();
	/**
	 * Résout le texte arabe minimal d'un verset préchargé.
	 * @param {number} surah Numéro de sourate.
	 * @param {number} verse Numéro de verset.
	 * @returns {Promise<string>} Texte arabe minimal, ou chaîne vide si absent.
	 */
	const getArabicText =
		resolveArabicText ??
		(async (surah: number, verse: number): Promise<string> =>
			MinimalQuranProvider.getVerseSlice(surah, verse, 0, Number.MAX_SAFE_INTEGER) ?? '');

	return Promise.all(
		occurrences.map(async ({ lastEndWordIndex: _lastEndWordIndex, ...verse }) => ({
			...verse,
			durationMs: Math.max(0, verse.endTime - verse.startTime),
			arabic: await getArabicText(verse.surah, verse.verse)
		}))
	);
}

/**
 * Construit les instructions et les données compactes envoyées au générateur de plages IA.
 * @param {MeaningExportVerse[]} verses Occurrences chronologiques présentes dans la vidéo.
 * @param {number} maxDurationSeconds Durée maximale cible en secondes.
 * @param {boolean} includeAllVerses Indique si chaque occurrence doit être couverte.
 * @returns {{ systemPrompt: string; userPrompt: string }} Prompts prêts pour l'API IA.
 */
export function buildMeaningExportPrompts(
	verses: MeaningExportVerse[],
	maxDurationSeconds: number,
	includeAllVerses: boolean
): { systemPrompt: string; userPrompt: string } {
	const systemPrompt = `You are a Quran video semantic range assistant.
Split the ordered verses into semantically distinct, non-overlapping contiguous video ranges.
Each range must use only verse keys from the input and must respect the input order.
The input is a timeline: repeated occurrences of the same verse key are distinct video occurrences and must never be merged.
The main goal is to make every range as close as possible to ${maxDurationSeconds} seconds without exceeding it.
Pack each range with as many consecutive, semantically coherent verses as possible while its summed duration stays at or below the limit.
Do not create one-verse or very short ranges when the next verses can still fit; only start a new range when adding the next verse would exceed the limit or break the meaning.
If one verse alone exceeds the limit, keep it as a single range.
${includeAllVerses ? 'Cover every timeline occurrence exactly once, including repeated verse keys.' : 'You may leave occurrences out when they do not belong to a meaningful range.'}
Do not invent verses, cover the same timeline occurrence twice, overlap ranges, or reorder occurrences.
When a verse key appears more than once, repeat that key in the output as needed to describe the later occurrence; the software resolves repeated keys in timeline order.
The input field \"o\" is the chronological occurrence number; use the corresponding \"v\" value in the output.
Each range object must contain only the string properties \"start\" and \"end\".
Respond ONLY with strict JSON in this exact format and no markdown:
{"ranges":[{"start":"1:1","end":"1:4"}]}`;
	const input = verses.map((verse, index) => ({
		o: index + 1,
		v: verse.key,
		t: verse.arabic,
		d: Math.round(verse.durationMs) + 'ms'
	}));

	return {
		systemPrompt,
		userPrompt: `Maximum duration: ${maxDurationSeconds} seconds. Stay as close as possible without exceeding it.\nInclude all timeline occurrences: ${includeAllVerses}\nOrdered timeline occurrences (repeated v values are intentional; duration d is in milliseconds; sum d to estimate each range):\n${JSON.stringify(input)}`
	};
}

/**
 * Valide les plages IA et conserve les plages structurellement correctes.
 * @param {unknown} parsed Réponse JSON décodée de l'IA.
 * @param {MeaningExportVerse[]} verses Occurrences utilisées pour la requête.
 * @param {number} maxDurationSeconds Durée maximale cible en secondes.
 * @param {boolean} includeAllVerses Indique si chaque occurrence doit être couverte.
 * @returns {MeaningExportRangeValidationResult} Plages valides et informations ignorées.
 */
export function validateMeaningExportRanges(
	parsed: unknown,
	verses: MeaningExportVerse[],
	maxDurationSeconds: number,
	includeAllVerses: boolean
): MeaningExportRangeValidationResult {
	const ranges: MeaningExportRange[] = [];
	let skippedCount = 0;
	const coveredIndexes = new Set<number>();
	const maxDurationMs = Number.isFinite(maxDurationSeconds)
		? Math.max(0, maxDurationSeconds) * 1000
		: 0;
	const response =
		parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	const responseRanges =
		response &&
		Object.keys(response).every((key) => key === 'ranges') &&
		Array.isArray(response.ranges)
			? response.ranges
			: null;

	if (!responseRanges) {
		return {
			ranges,
			skippedCount: 1,
			missingVerseKeys: includeAllVerses ? verses.map((verse) => verse.key) : []
		};
	}

	let previousEndIndex = -1;
	for (const value of responseRanges) {
		if (!value || typeof value !== 'object') {
			skippedCount += 1;
			continue;
		}

		const range = value as Record<string, unknown>;
		if (
			Object.keys(range).some((key) => key !== 'start' && key !== 'end') ||
			typeof range.start !== 'string' ||
			typeof range.end !== 'string'
		) {
			skippedCount += 1;
			continue;
		}

		let startIndex = -1;
		for (let index = previousEndIndex + 1; index < verses.length; index += 1) {
			if (verses[index].key === range.start) {
				startIndex = index;
				break;
			}
		}
		if (startIndex < 0) {
			skippedCount += 1;
			continue;
		}

		let endIndex = -1;
		for (let index = startIndex; index < verses.length; index += 1) {
			if (verses[index].key === range.end) {
				endIndex = index;
				break;
			}
		}
		if (endIndex < 0) {
			skippedCount += 1;
			continue;
		}

		let hasOverlap = false;
		for (let index = startIndex; index <= endIndex; index += 1) {
			if (coveredIndexes.has(index)) {
				hasOverlap = true;
				break;
			}
		}
		if (hasOverlap) {
			skippedCount += 1;
			continue;
		}

		const startVerse = verses[startIndex];
		const endVerse = verses[endIndex];
		const durationMs = Math.max(0, endVerse.endTime - startVerse.startTime);
		ranges.push({
			id: `${startVerse.key}-${endVerse.key}-${startIndex}-${endIndex}`,
			startKey: startVerse.key,
			endKey: endVerse.key,
			startTime: startVerse.startTime,
			endTime: endVerse.endTime,
			durationMs,
			exceedsMaxDuration: durationMs > maxDurationMs
		});
		for (let index = startIndex; index <= endIndex; index += 1) coveredIndexes.add(index);
		previousEndIndex = endIndex;
	}

	const missingVerseKeys = includeAllVerses
		? verses.filter((_, index) => !coveredIndexes.has(index)).map((verse) => verse.key)
		: [];

	return {
		ranges: missingVerseKeys.length > 0 ? [] : ranges,
		skippedCount,
		missingVerseKeys
	};
}
