import { Quran } from '$lib/classes/Quran';
import type { SubtitleClip, TranscriptWordTiming } from '$lib/classes/Clip.svelte';
import type { AITranscriptionResult } from '$lib/services/AITranscription';
import {
	getTranscriptReferenceLogicalParts,
	type QuranTranscriptReference,
	type TranscriptReferenceLogicalPart
} from '$lib/services/TranscriptReferenceService';

export type TranscriptBandWordKind = 'plain' | 'citation' | 'quran';

export type TranscriptBandWord = {
	id: string;
	text: string;
	startMs: number;
	endMs: number;
	clipId: number | null;
	clipWordIndex: number;
	location?: string;
	confidence?: number;
	partIndex: number;
	partWordIndex: number;
	partWordCount: number;
	kind: TranscriptBandWordKind;
	quranReference: QuranTranscriptReference | null;
	globalIndex: number;
};

export type TranscriptBandSelection = {
	startIndex: number;
	endIndex: number;
	words: TranscriptBandWord[];
	text: string;
};

type MutableTranscriptPart = Omit<TranscriptReferenceLogicalPart, 'wordCount'> & {
	wordCount: number | null;
};

type ResolvedTranscriptPart = Omit<TranscriptReferenceLogicalPart, 'wordCount'> & {
	wordCount: number;
};

/**
 * Résout le nombre de mots couvert par chaque portion structurée.
 *
 * @param {string} text Texte du segment avec ses marqueurs éventuels.
 * @param {number} totalWordCount Nombre de mots alignés par le moteur vocal.
 * @param {QuranTranscriptReference | null} legacyQuranReference Référence Quran des anciens clips.
 * @returns {Promise<ResolvedTranscriptPart[]>} Portions avec un compte de mots exploitable.
 */
async function resolveTranscriptParts(
	text: string,
	totalWordCount: number,
	legacyQuranReference: QuranTranscriptReference | null = null
): Promise<ResolvedTranscriptPart[]> {
	const logicalParts = getTranscriptReferenceLogicalParts(text);
	if (!logicalParts) {
		return [
			{
				text,
				referenceType: legacyQuranReference ? 'quran' : null,
				quranReference: legacyQuranReference ?? undefined,
				wordCount: totalWordCount
			}
		];
	}

	const resolved: MutableTranscriptPart[] = logicalParts.map((part) => ({
		...part,
		wordCount: part.wordCount
	}));
	const unresolvedQuranParts = resolved.filter(
		(part) => part.wordCount === null && part.quranReference
	);

	if (unresolvedQuranParts.length > 0) {
		try {
			await Quran.load();
			await Promise.all(
				unresolvedQuranParts.map(async (part) => {
					if (!part.quranReference) return;
					const verse = await Quran.getVerse(part.quranReference.surah, part.quranReference.verse);
					if (!verse) return;
					part.wordCount =
						part.quranReference.startWord === null || part.quranReference.endWord === null
							? verse.words.length
							: part.quranReference.endWord - part.quranReference.startWord + 1;
				})
			);
		} catch {
			// Le nombre restant sera réparti sur les portions inconnues ci-dessous.
		}
	}

	const unresolved = resolved.filter((part) => part.wordCount === null);
	const knownWordCount = resolved.reduce((total, part) => total + (part.wordCount ?? 0), 0);
	if (unresolved.length === 1) {
		unresolved[0].wordCount = Math.max(0, totalWordCount - knownWordCount);
	} else if (unresolved.length > 1) {
		let remaining = Math.max(0, totalWordCount - knownWordCount);
		for (const part of unresolved) {
			part.wordCount = remaining;
			remaining = 0;
		}
	}

	let difference =
		totalWordCount - resolved.reduce((total, part) => total + (part.wordCount ?? 0), 0);
	for (let index = resolved.length - 1; index >= 0 && difference !== 0; index -= 1) {
		const part = resolved[index];
		if (difference > 0) {
			part.wordCount = (part.wordCount ?? 0) + difference;
			difference = 0;
			continue;
		}

		const reduction = Math.min(part.wordCount ?? 0, -difference);
		part.wordCount = (part.wordCount ?? 0) - reduction;
		difference += reduction;
	}

	return resolved.map((part) => ({ ...part, wordCount: Math.max(0, part.wordCount ?? 0) }));
}

/**
 * Construit la bande globale de mots alignés du projet, dans l'ordre de l'audio.
 *
 * @param {ReadonlyArray<SubtitleClip>} clips Sous-titres portant des timestamps WBW.
 * @param {AITranscriptionResult | null} sourceResult Dernier résultat nettoyé éventuel.
 * @returns {Promise<TranscriptBandWord[]>} Mots aplatis avec timestamps absolus et structure source.
 */
export async function buildTranscriptBandWords(
	clips: ReadonlyArray<SubtitleClip>,
	sourceResult: AITranscriptionResult | null = null
): Promise<TranscriptBandWord[]> {
	const assignedWords = await buildAssignedTranscriptBandWords(clips);
	if (!sourceResult) return assignedWords;

	const sourceWords = buildRawTranscriptBandWords(sourceResult);
	if (sourceWords.length === 0) return assignedWords;
	return sourceWords
		.map((word) => mergeTranscriptBandAssignment(word, assignedWords))
		.map((word, globalIndex) => ({ ...word, globalIndex }));
}

/**
 * Construit la bande à partir des mots encore présents dans les sous-titres.
 *
 * @param {ReadonlyArray<SubtitleClip>} clips Sous-titres portant des timestamps WBW.
 * @returns {Promise<TranscriptBandWord[]>} Mots associés à leurs clips.
 */
async function buildAssignedTranscriptBandWords(
	clips: ReadonlyArray<SubtitleClip>
): Promise<TranscriptBandWord[]> {
	const orderedClips = clips
		.filter((clip) => (clip.alignmentMetadata?.words.length ?? 0) > 0)
		.slice()
		.sort((left, right) => left.startTime - right.startTime || left.id - right.id);
	const words: TranscriptBandWord[] = [];

	for (const clip of orderedClips) {
		const sourceWords = clip.alignmentMetadata?.words ?? [];
		const legacyQuranReference =
			getTranscriptReferenceLogicalParts(clip.text) === null && clip.surah > 0 && clip.verse > 0
				? {
						surah: clip.surah,
						verse: clip.verse,
						startWord: clip.isFullVerse ? null : clip.startWordIndex + 1,
						endWord: clip.isFullVerse ? null : clip.endWordIndex + 1
					}
				: null;
		const parts = await resolveTranscriptParts(clip.text, sourceWords.length, legacyQuranReference);
		const baseTimeS = Number.isFinite(clip.alignmentMetadata?.timeFrom)
			? Number(clip.alignmentMetadata?.timeFrom)
			: clip.startTime / 1000;
		let sourceWordIndex = 0;

		for (const [partIndex, part] of parts.entries()) {
			const kind: TranscriptBandWordKind =
				part.referenceType === 'quran'
					? 'quran'
					: part.referenceType === 'citation'
						? 'citation'
						: 'plain';

			for (let partWordIndex = 0; partWordIndex < part.wordCount; partWordIndex += 1) {
				const sourceWord = sourceWords[sourceWordIndex];
				if (!sourceWord) break;
				const text = sourceWord.word?.trim();
				if (!text) {
					sourceWordIndex += 1;
					continue;
				}

				words.push({
					id: `${clip.id}-${sourceWordIndex}`,
					text,
					startMs: getAbsoluteWordTimeMs(baseTimeS, sourceWord, 'start'),
					endMs: Math.max(
						getAbsoluteWordTimeMs(baseTimeS, sourceWord, 'start') + 1,
						getAbsoluteWordTimeMs(baseTimeS, sourceWord, 'end')
					),
					clipId: clip.id,
					clipWordIndex: sourceWordIndex,
					...(sourceWord.location ? { location: sourceWord.location } : {}),
					...(typeof sourceWord.confidence === 'number'
						? { confidence: sourceWord.confidence }
						: {}),
					partIndex,
					partWordIndex,
					partWordCount: part.wordCount,
					kind,
					quranReference: part.quranReference ?? null,
					globalIndex: -1
				});
				sourceWordIndex += 1;
			}
		}
	}

	return words
		.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs)
		.map((word, globalIndex) => ({ ...word, globalIndex }));
}

/**
 * Transforme le résultat nettoyé conservé en mots affichables dans la bande.
 *
 * @param {AITranscriptionResult} result Résultat nettoyé de transcription.
 * @returns {TranscriptBandWord[]} Mots transcrits avec leurs timestamps absolus.
 */
function buildRawTranscriptBandWords(result: AITranscriptionResult): TranscriptBandWord[] {
	const words: TranscriptBandWord[] = [];
	for (const [segmentIndex, segment] of result.segments.entries()) {
		const segmentWords = segment.words ?? [];
		for (const [wordIndex, sourceWord] of segmentWords.entries()) {
			const text = sourceWord.word?.trim();
			const startMs = Math.round(Number(sourceWord.start) * 1000);
			const endMs = Math.round(Number(sourceWord.end) * 1000);
			if (!text || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs)
				continue;

			words.push({
				id: `raw-${segmentIndex}-${wordIndex}`,
				text,
				startMs,
				endMs: Math.max(startMs + 1, endMs),
				clipId: null,
				clipWordIndex: -1,
				partIndex: 0,
				partWordIndex: wordIndex,
				partWordCount: segmentWords.length,
				kind: 'plain',
				quranReference: null,
				...(typeof sourceWord.confidence === 'number' ? { confidence: sourceWord.confidence } : {}),
				globalIndex: -1
			});
		}
	}

	return words.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
}

/**
 * Rattache un mot brut au sous-titre qui le contient encore, si possible.
 *
 * @param {TranscriptBandWord} sourceWord Mot brut à rattacher.
 * @param {TranscriptBandWord[]} assignedWords Mots issus des sous-titres actuels.
 * @returns {TranscriptBandWord} Mot brut enrichi ou marqué comme non assigné.
 */
function mergeTranscriptBandAssignment(
	sourceWord: TranscriptBandWord,
	assignedWords: TranscriptBandWord[]
): TranscriptBandWord {
	const sourceText = normalizeTranscriptBandWord(sourceWord.text);
	const candidates = assignedWords
		.map((candidate) => {
			const overlapMs =
				Math.min(sourceWord.endMs, candidate.endMs) -
				Math.max(sourceWord.startMs, candidate.startMs);
			const distanceMs = Math.min(
				Math.abs(sourceWord.startMs - candidate.startMs),
				Math.abs(sourceWord.endMs - candidate.endMs)
			);
			return {
				candidate,
				overlapMs,
				distanceMs,
				textMatch: normalizeTranscriptBandWord(candidate.text) === sourceText
			};
		})
		.filter(
			({ overlapMs, textMatch, distanceMs }) => textMatch && (overlapMs > 0 || distanceMs <= 250)
		)
		.sort(
			(left, right) =>
				Number(right.textMatch) - Number(left.textMatch) ||
				right.overlapMs - left.overlapMs ||
				left.distanceMs - right.distanceMs
		);
	const assignment = candidates[0]?.candidate;
	if (!assignment) return sourceWord;

	return {
		...sourceWord,
		clipId: assignment.clipId,
		clipWordIndex: assignment.clipWordIndex,
		partIndex: assignment.partIndex,
		partWordIndex: assignment.partWordIndex,
		partWordCount: assignment.partWordCount,
		kind: assignment.kind,
		quranReference: assignment.quranReference
	};
}

/**
 * Normalise un mot pour comparer la sortie brute aux mots alignés.
 *
 * @param {string} word Mot à normaliser.
 * @returns {string} Mot comparable sans ponctuation périphérique.
 */
function normalizeTranscriptBandWord(word: string): string {
	return word
		.normalize('NFKC')
		.toLocaleLowerCase()
		.replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, '');
}

/**
 * Retourne la plage de mots appartenant à un sous-titre.
 *
 * @param {TranscriptBandWord[]} words Mots aplatis du projet.
 * @param {number | null} clipId Identifiant du sous-titre courant.
 * @returns {{startIndex: number; endIndex: number} | null} Plage inclusive ou `null`.
 */
export function getTranscriptBandClipRange(
	words: TranscriptBandWord[],
	clipId: number | null
): { startIndex: number; endIndex: number } | null {
	if (clipId === null) return null;
	const clipWords = words.filter((word) => word.clipId === clipId);
	if (clipWords.length === 0) return null;
	return {
		startIndex: clipWords[0].globalIndex,
		endIndex: clipWords[clipWords.length - 1].globalIndex
	};
}

/**
 * Sérialise une plage de mots en conservant les marqueurs Quran et citation.
 *
 * @param {TranscriptBandWord[]} words Mots aplatis du projet.
 * @param {number} startIndex Index global inclusif de début.
 * @param {number} endIndex Index global inclusif de fin.
 * @returns {string} Texte structuré prêt à être chargé dans l'éditeur.
 */
export function serializeTranscriptBandSelection(
	words: TranscriptBandWord[],
	startIndex: number,
	endIndex: number
): string {
	const selectedWords = words
		.filter((word) => word.globalIndex >= startIndex && word.globalIndex <= endIndex)
		.sort((left, right) => left.globalIndex - right.globalIndex);
	if (selectedWords.length === 0) return '';

	const groups: TranscriptBandWord[][] = [];
	for (const word of selectedWords) {
		const previousGroup = groups[groups.length - 1];
		const previousWord = previousGroup?.[0];
		if (
			previousWord &&
			previousWord.clipId === word.clipId &&
			previousWord.partIndex === word.partIndex
		) {
			previousGroup.push(word);
		} else {
			groups.push([word]);
		}
	}

	return mergeAdjacentQuranGroups(groups).map(serializeTranscriptBandGroup).join(' ').trim();
}

/**
 * Construit une sélection complète utilisée par le composeur.
 *
 * @param {TranscriptBandWord[]} words Mots aplatis du projet.
 * @param {number} startIndex Index global inclusif de début.
 * @param {number} endIndex Index global inclusif de fin.
 * @returns {TranscriptBandSelection} Sélection ordonnée et son texte structuré.
 */
export function createTranscriptBandSelection(
	words: TranscriptBandWord[],
	startIndex: number,
	endIndex: number
): TranscriptBandSelection {
	const normalizedStart = Math.min(startIndex, endIndex);
	const normalizedEnd = Math.max(startIndex, endIndex);
	return {
		startIndex: normalizedStart,
		endIndex: normalizedEnd,
		words: words
			.filter((word) => word.globalIndex >= normalizedStart && word.globalIndex <= normalizedEnd)
			.sort((left, right) => left.globalIndex - right.globalIndex),
		text: serializeTranscriptBandSelection(words, normalizedStart, normalizedEnd)
	};
}

/**
 * Retourne le temps absolu d'un mot d'alignement.
 *
 * @param {number} baseTimeS Début absolu du segment en secondes.
 * @param {TranscriptWordTiming} word Mot aligné.
 * @param {'start' | 'end'} boundary Borne à convertir.
 * @returns {number} Timestamp absolu en millisecondes.
 */
function getAbsoluteWordTimeMs(
	baseTimeS: number,
	word: TranscriptWordTiming,
	boundary: 'start' | 'end'
): number {
	const relativeTimeS = Number(word[boundary]);
	return Math.round((baseTimeS + (Number.isFinite(relativeTimeS) ? relativeTimeS : 0)) * 1000);
}

/**
 * Sérialise un groupe provenant d'une même portion structurée.
 *
 * @param {TranscriptBandWord[]} group Groupe contigu de mots.
 * @returns {string} Portion sérialisée.
 */
function serializeTranscriptBandGroup(group: TranscriptBandWord[]): string {
	const firstWord = group[0];
	if (!firstWord) return '';
	const text = group.map((word) => word.text).join(' ');
	if (firstWord.kind === 'citation') return `{{${text}}}`;
	if (firstWord.kind !== 'quran' || !firstWord.quranReference) return text;

	const reference = firstWord.quranReference;
	const referenceStart = reference.startWord ?? 1;
	const referenceEnd =
		reference.endWord ?? referenceStart + Math.max(0, firstWord.partWordCount - 1);
	const selectedWordIndexes = group.map(getQuranWordIndex);
	const selectedStart = Math.min(...selectedWordIndexes);
	const selectedEnd = Math.max(...selectedWordIndexes);
	const isCompleteReference =
		reference.startWord === null &&
		reference.endWord === null &&
		selectedStart <= referenceStart &&
		selectedEnd >= referenceEnd;
	const value = isCompleteReference
		? formatQuranReference(reference)
		: `${reference.surah}:${reference.verse}:${selectedStart}-${selectedEnd}`;
	return `{{${value}}}`;
}

/**
 * Fusionne les portions Quran contiguës d'un même verset, même si elles viennent de clips différents.
 *
 * @param {TranscriptBandWord[][]} groups Portions déjà regroupées par source structurée.
 * @returns {TranscriptBandWord[][]} Portions avec les plages Quran contiguës réunies.
 */
function mergeAdjacentQuranGroups(groups: TranscriptBandWord[][]): TranscriptBandWord[][] {
	const merged: TranscriptBandWord[][] = [];
	for (const group of groups) {
		const previous = merged.at(-1);
		if (previous && canMergeQuranGroups(previous, group)) {
			previous.push(...group);
		} else {
			merged.push([...group]);
		}
	}
	return merged;
}

/**
 * Indique si deux portions Quran se suivent sans rupture dans le même verset.
 *
 * @param {TranscriptBandWord[]} previous Portion précédente.
 * @param {TranscriptBandWord[]} next Portion suivante.
 * @returns {boolean} `true` si les deux portions peuvent être fusionnées.
 */
function canMergeQuranGroups(previous: TranscriptBandWord[], next: TranscriptBandWord[]): boolean {
	const previousLast = previous.at(-1);
	const nextFirst = next[0];
	if (
		!previousLast ||
		!nextFirst ||
		previousLast.kind !== 'quran' ||
		nextFirst.kind !== 'quran' ||
		!previousLast.quranReference ||
		!nextFirst.quranReference
	) {
		return false;
	}

	return (
		previousLast.quranReference.surah === nextFirst.quranReference.surah &&
		previousLast.quranReference.verse === nextFirst.quranReference.verse &&
		previousLast.globalIndex + 1 === nextFirst.globalIndex &&
		getQuranWordIndex(previousLast) + 1 === getQuranWordIndex(nextFirst)
	);
}

/**
 * Retourne l'index canonique d'un mot dans sa référence Quran.
 *
 * @param {TranscriptBandWord} word Mot Quran aplati.
 * @returns {number} Index du mot dans le verset, en base 1.
 */
function getQuranWordIndex(word: TranscriptBandWord): number {
	return (word.quranReference?.startWord ?? 1) + word.partWordIndex;
}

/**
 * Formate une référence Quran dans sa forme source.
 *
 * @param {QuranTranscriptReference} reference Référence à formater.
 * @returns {string} Référence sans marqueurs.
 */
function formatQuranReference(reference: QuranTranscriptReference): string {
	if (reference.startWord === null || reference.endWord === null) {
		return `${reference.surah}:${reference.verse}`;
	}
	return `${reference.surah}:${reference.verse}:${reference.startWord}-${reference.endWord}`;
}
