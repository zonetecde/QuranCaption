import { globalState } from '$lib/runes/main.svelte';
import type { SubtitleClip } from './Clip.svelte';
import type { Edition } from './Edition';
import { SerializableBase } from './misc/SerializableBase';

export type TranslationStatus =
	| 'completed by default'
	| 'automatically trimmed'
	| 'ai trimmed'
	| 'to review'
	| 'reviewed'
	| 'ai error'
	| 'fetched'
	| 'undefined';

export type TranslationInlineStyleRun = {
	startWordIndex: number;
	endWordIndex: number;
	bold: boolean;
	italic: boolean;
	underline: boolean;
	color?: string | null;
};

export type TranslationInlineStyleFlags = Pick<
	TranslationInlineStyleRun,
	'bold' | 'italic' | 'underline' | 'color'
>;

export type TranslationInlineTextSegment = {
	text: string;
	bold: boolean;
	italic: boolean;
	underline: boolean;
	color?: string | null;
};

type TranslationTextToken = {
	text: string;
	isWord: boolean;
	wordIndex: number | null;
};

const EMPTY_INLINE_STYLE_FLAGS: TranslationInlineStyleFlags = {
	bold: false,
	italic: false,
	underline: false,
	color: null
};

/**
 * Returns true when at least one inline style flag is active.
 */
function hasInlineStyle(flags: TranslationInlineStyleFlags): boolean {
	return flags.bold || flags.italic || flags.underline || Boolean(flags.color);
}

/**
 * Compares two inline style flag sets.
 */
function sameInlineStyleFlags(
	left: TranslationInlineStyleFlags,
	right: TranslationInlineStyleFlags
): boolean {
	return (
		left.bold === right.bold &&
		left.italic === right.italic &&
		left.underline === right.underline &&
		left.color === right.color
	);
}

/**
 * Creates a safe flag object with strict booleans.
 */
function cloneInlineStyleFlags(flags: TranslationInlineStyleFlags): TranslationInlineStyleFlags {
	return {
		bold: Boolean(flags.bold),
		italic: Boolean(flags.italic),
		underline: Boolean(flags.underline),
		color: typeof flags.color === 'string' && flags.color.trim().length > 0 ? flags.color : null
	};
}

/**
 * Splits translation text into whitespace and word tokens while preserving order,
 * and assigns incremental word indexes to word tokens only.
 */
export function tokenizeTranslationText(text: string): TranslationTextToken[] {
	const matches = text.match(/(\s+|[^\s]+)/g) ?? [];
	let wordIndex = 0;

	return matches.map((token) => {
		const isWord = /\S/.test(token);
		return {
			text: token,
			isWord,
			wordIndex: isWord ? wordIndex++ : null
		};
	});
}

/**
 * Counts how many word tokens exist in a translation string.
 */
export function getTranslationWordCount(text: string): number {
	let count = 0;
	for (const token of tokenizeTranslationText(text)) {
		if (token.isWord) count++;
	}
	return count;
}

/**
 * Normalizes inline style runs by:
 * - clamping to text bounds,
 * - dropping invalid/empty runs,
 * - resolving overlaps by latest write,
 * - and merging adjacent runs with identical flags.
 */
export function normalizeTranslationInlineStyleRuns(
	runs: TranslationInlineStyleRun[],
	totalWordCount: number
): TranslationInlineStyleRun[] {
	if (totalWordCount <= 0 || runs.length === 0) return [];

	const states = Array.from({ length: totalWordCount }, () =>
		cloneInlineStyleFlags(EMPTY_INLINE_STYLE_FLAGS)
	);

	for (const run of runs) {
		const start = Number(run.startWordIndex);
		const end = Number(run.endWordIndex);
		if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) continue;

		const boundedStart = Math.max(0, Math.min(totalWordCount - 1, start));
		const boundedEnd = Math.max(0, Math.min(totalWordCount - 1, end));
		const flags = cloneInlineStyleFlags(run);
		if (!hasInlineStyle(flags)) continue;

		for (let index = boundedStart; index <= boundedEnd; index++) {
			states[index] = cloneInlineStyleFlags(flags);
		}
	}

	const normalized: TranslationInlineStyleRun[] = [];
	let currentStart = -1;
	let currentFlags = cloneInlineStyleFlags(EMPTY_INLINE_STYLE_FLAGS);

	for (let index = 0; index < states.length; index++) {
		const flags = states[index];
		const isStyled = hasInlineStyle(flags);

		if (!isStyled) {
			if (currentStart !== -1) {
				normalized.push({
					startWordIndex: currentStart,
					endWordIndex: index - 1,
					...currentFlags
				});
				currentStart = -1;
				currentFlags = cloneInlineStyleFlags(EMPTY_INLINE_STYLE_FLAGS);
			}
			continue;
		}

		if (currentStart === -1) {
			currentStart = index;
			currentFlags = cloneInlineStyleFlags(flags);
			continue;
		}

		if (!sameInlineStyleFlags(currentFlags, flags)) {
			normalized.push({
				startWordIndex: currentStart,
				endWordIndex: index - 1,
				...currentFlags
			});
			currentStart = index;
			currentFlags = cloneInlineStyleFlags(flags);
		}
	}

	if (currentStart !== -1) {
		normalized.push({
			startWordIndex: currentStart,
			endWordIndex: states.length - 1,
			...currentFlags
		});
	}

	return normalized;
}

/**
 * Toggles selected style flags over a word range and returns normalized runs.
 * Only flags set to true in `toggledFlags` are toggled.
 */
export function toggleTranslationInlineStyleRuns(
	runs: TranslationInlineStyleRun[],
	totalWordCount: number,
	startWordIndex: number,
	endWordIndex: number,
	toggledFlags: TranslationInlineStyleFlags
): TranslationInlineStyleRun[] {
	if (totalWordCount <= 0 || !hasInlineStyle(toggledFlags)) {
		return normalizeTranslationInlineStyleRuns(runs, totalWordCount);
	}

	const normalizedRuns = normalizeTranslationInlineStyleRuns(runs, totalWordCount);
	const states = Array.from({ length: totalWordCount }, () =>
		cloneInlineStyleFlags(EMPTY_INLINE_STYLE_FLAGS)
	);

	for (const run of normalizedRuns) {
		for (let index = run.startWordIndex; index <= run.endWordIndex; index++) {
			states[index] = {
				bold: run.bold,
				italic: run.italic,
				underline: run.underline,
				color: run.color ?? null
			};
		}
	}

	const selectionStart = Math.max(
		0,
		Math.min(totalWordCount - 1, Math.min(startWordIndex, endWordIndex))
	);
	const selectionEnd = Math.max(
		0,
		Math.min(totalWordCount - 1, Math.max(startWordIndex, endWordIndex))
	);

	for (let index = selectionStart; index <= selectionEnd; index++) {
		if (toggledFlags.bold) states[index].bold = !states[index].bold;
		if (toggledFlags.italic) states[index].italic = !states[index].italic;
		if (toggledFlags.underline) states[index].underline = !states[index].underline;
		if (toggledFlags.color) {
			states[index].color =
				states[index].color === toggledFlags.color ? null : toggledFlags.color;
		}
	}

	return normalizeTranslationInlineStyleRuns(
		states.map((flags, index) => ({
			startWordIndex: index,
			endWordIndex: index,
			...flags
		})),
		totalWordCount
	);
}

/**
 * Builds render-ready text segments that preserve original spacing and attach
 * inline style flags to each segment.
 */
export function buildTranslationInlineTextSegments(
	text: string,
	runs: TranslationInlineStyleRun[]
): TranslationInlineTextSegment[] {
	const tokens = tokenizeTranslationText(text);
	if (tokens.length === 0) return [];

	const totalWordCount = getTranslationWordCount(text);
	const normalizedRuns = normalizeTranslationInlineStyleRuns(runs, totalWordCount);
	const flagsByWordIndex = Array.from({ length: totalWordCount }, () =>
		cloneInlineStyleFlags(EMPTY_INLINE_STYLE_FLAGS)
	);

	for (const run of normalizedRuns) {
		for (let index = run.startWordIndex; index <= run.endWordIndex; index++) {
			flagsByWordIndex[index] = {
				bold: run.bold,
				italic: run.italic,
				underline: run.underline,
				color: run.color ?? null
			};
		}
	}

	const segments: TranslationInlineTextSegment[] = [];

	// Merge adjacent segments that share the same style flags.
	function pushText(segmentText: string, flags: TranslationInlineStyleFlags): void {
		const previous = segments[segments.length - 1];
		if (previous && sameInlineStyleFlags(previous, flags)) {
			previous.text += segmentText;
			return;
		}

		segments.push({
			text: segmentText,
			...cloneInlineStyleFlags(flags)
		});
	}

	for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
		const token = tokens[tokenIndex];

		if (token.isWord && token.wordIndex !== null) {
			pushText(token.text, flagsByWordIndex[token.wordIndex]);
			continue;
		}

		const previousWordToken = [...tokens.slice(0, tokenIndex)]
			.reverse()
			.find((item) => item.isWord);
		const nextWordToken = tokens.slice(tokenIndex + 1).find((item) => item.isWord);
		const previousFlags =
			previousWordToken?.wordIndex !== null && previousWordToken?.wordIndex !== undefined
				? flagsByWordIndex[previousWordToken.wordIndex]
				: EMPTY_INLINE_STYLE_FLAGS;
		const nextFlags =
			nextWordToken?.wordIndex !== null && nextWordToken?.wordIndex !== undefined
				? flagsByWordIndex[nextWordToken.wordIndex]
				: EMPTY_INLINE_STYLE_FLAGS;
		const whitespaceFlags =
			hasInlineStyle(previousFlags) && sameInlineStyleFlags(previousFlags, nextFlags)
				? previousFlags
				: EMPTY_INLINE_STYLE_FLAGS;

		pushText(token.text, whitespaceFlags);
	}

	return segments;
}

/**
 * Replaces the bold flag for the provided word indexes while preserving existing
 * italic and underline flags on every word.
 */
export function replaceBoldWordIndexesInInlineStyleRuns(
	runs: TranslationInlineStyleRun[],
	totalWordCount: number,
	boldWordIndexes: number[]
): TranslationInlineStyleRun[] {
	if (totalWordCount <= 0) return [];

	const normalizedRuns = normalizeTranslationInlineStyleRuns(runs, totalWordCount);
	const states = Array.from({ length: totalWordCount }, () =>
		cloneInlineStyleFlags(EMPTY_INLINE_STYLE_FLAGS)
	);

	for (const run of normalizedRuns) {
		for (let index = run.startWordIndex; index <= run.endWordIndex; index++) {
			states[index] = {
				bold: false,
				italic: run.italic,
				underline: run.underline,
				color: run.color ?? null
			};
		}
	}

	for (const rawIndex of boldWordIndexes) {
		const index = Number(rawIndex);
		if (!Number.isInteger(index) || index < 0 || index >= totalWordCount) continue;
		states[index].bold = true;
	}

	return normalizeTranslationInlineStyleRuns(
		states.map((flags, index) => ({
			startWordIndex: index,
			endWordIndex: index,
			...flags
		})),
		totalWordCount
	);
}

export class Translation extends SerializableBase {
	// Le texte de la traduction
	text: string = $state('');

	// Status
	status: TranslationStatus = $state('undefined');

	// Type de la traduction
	type: 'verse' | 'predefined' | 'other' = 'other';

	constructor(text: string, status: TranslationStatus) {
		super();
		this.text = text;
		this.status = status;
	}

	isStatusComplete(): boolean {
		return (
			this.status === 'completed by default' ||
			this.status === 'reviewed' ||
			this.status === 'automatically trimmed' ||
			this.status === 'ai trimmed' ||
			this.status === 'fetched'
		);
	}

	getText(_edition?: string, _subtitle?: SubtitleClip): string {
		return this.text.replaceAll('— ', '—'); // Enlève l'espace après le tiret long qu'on a ajouté pour pouvoir sélectionner les mots avant et après le tiret
	}

	updateStatus(status: TranslationStatus, edition: Edition) {
		this.status = status;

		globalState.currentProject!.detail.updatePercentageTranslated(edition);
	}
}

export class VerseTranslation extends Translation {
	// L'indice du mot de début de la traduction dans le texte original
	startWordIndex: number = $state(0);

	// L'indice du mot de fin de la traduction dans le texte original
	endWordIndex: number = $state(0);

	// Indique si la traduction ne se base pas sur la traduction originale
	isBruteForce: boolean = $state(false);

	// Non-overlapping style runs indexed on trimmed translation words.
	inlineStyleRuns: TranslationInlineStyleRun[] = $state([]);

	constructor(text: string, status: TranslationStatus) {
		super(text, status);

		if (text === undefined) return; // déserialisation

		this.startWordIndex = 0;
		this.endWordIndex = text.split(' ').length - 1;
		this.isBruteForce = false;
		this.inlineStyleRuns = [];
		this.type = 'verse';
	}

	/**
	 * Removes all inline emphasis styles.
	 */
	clearInlineStyles(): void {
		this.inlineStyleRuns = [];
	}

	/**
	 * Reconciles stored style runs with current text word count.
	 * Useful after import/deserialization or any out-of-band text changes.
	 */
	syncInlineStylesWithText(): void {
		this.inlineStyleRuns = normalizeTranslationInlineStyleRuns(
			this.inlineStyleRuns ?? [],
			getTranslationWordCount(this.text)
		);
	}

	/**
	 * Updates text and clears inline style runs.
	 * This avoids invalid ranges when text content changes.
	 */
	setTextAndClearInlineStyles(text: string): void {
		// Ne vide pas les styles si le texte reste strictement identique.
		// Ça évite de perdre les word styles sur certains refresh/sync idempotents.
		if (this.text === text) return;

		this.text = text;
		this.clearInlineStyles();
	}

	/**
	 * Copies inline style runs from another translation and normalizes them for
	 * this translation's current text length.
	 */
	copyInlineStylesFrom(other: VerseTranslation | null | undefined): void {
		if (!other) {
			this.inlineStyleRuns = [];
			return;
		}

		this.inlineStyleRuns = normalizeTranslationInlineStyleRuns(
			other.inlineStyleRuns ?? [],
			getTranslationWordCount(this.text)
		);
	}

	/**
	 * Toggles one or more inline style flags on the selected word range.
	 */
	toggleInlineStyles(
		startWordIndex: number,
		endWordIndex: number,
		flags: TranslationInlineStyleFlags
	): void {
		this.inlineStyleRuns = toggleTranslationInlineStyleRuns(
			this.inlineStyleRuns ?? [],
			getTranslationWordCount(this.text),
			startWordIndex,
			endWordIndex,
			flags
		);
	}

	/**
	 * Returns render-ready segments with merged text and per-segment style flags.
	 */
	getInlineStyledSegments(): TranslationInlineTextSegment[] {
		return buildTranslationInlineTextSegments(super.getText(), this.inlineStyleRuns ?? []);
	}

	/**
	 * Replaces all existing inline bold on this translation while preserving
	 * italic and underline runs.
	 */
	replaceBoldWordIndexes(boldWordIndexes: number[]): void {
		this.inlineStyleRuns = replaceBoldWordIndexesInInlineStyleRuns(
			this.inlineStyleRuns ?? [],
			getTranslationWordCount(this.text),
			boldWordIndexes
		);
	}

	getFormattedTextParts(
		edition: string,
		subtitle: SubtitleClip
	): { prefix: string; text: string; suffix: string } {
		const text = super.getText();
		const position = globalState.getStyle(edition, 'verse-number-position').value;

		if (
			((subtitle.startWordIndex === 0 && position === 'before') ||
				(subtitle.isLastWordsOfVerse && position === 'after')) &&
			globalState.getStyle(edition, 'show-verse-number').value
		) {
			const format = String(globalState.getStyle(edition, 'verse-number-format').value).replace(
				'<number>',
				subtitle.verse.toString()
			);

			if (position === 'before' && subtitle.startWordIndex === 0) {
				return {
					prefix: format,
					text,
					suffix: ''
				};
			}

			if (position === 'after' && subtitle.isLastWordsOfVerse) {
				return {
					prefix: '',
					text,
					suffix: format
				};
			}
		}

		return {
			prefix: '',
			text,
			suffix: ''
		};
	}

	/**
	 * Retourne le texte de la traduction en ajoutant le numéro de verset si demandé dans les styles
	 * @param edition L'édition de la traduction
	 * @param subtitle Le clip de sous-titre associé à la traduction
	 * @returns Le texte de la traduction avec le numéro de verset si demandé
	 */
	override getText(edition: string, subtitle: SubtitleClip): string {
		const { prefix, text, suffix } = this.getFormattedTextParts(edition, subtitle);
		return `${prefix}${text}${suffix}`;
	}

	/**
	 * Recalcule les indexes de début et de fin de la traduction dans le texte original en fonction du texte actuel
	 */
	tryRecalculateTranslationIndexes(edition: Edition, verseKey: string): void {
		const originalTranslationText: string =
			globalState.currentProject!.content.projectTranslation.getVerseTranslation(edition, verseKey);

		if (!originalTranslationText) return;

		// Normalise un mot pour comparer les contenus sans être sensible à la casse,
		// aux espaces spéciaux, aux variantes de tirets et à la ponctuation de bord.
		const normalizeWord = (w: string) =>
			w
				.replace(/\u00A0/g, ' ')
				.normalize('NFKC')
				.toLowerCase()
				.replace(/[\u2013\u2014]/g, '-')
				.replace(/^([^\p{L}\p{N}]+)|([^\p{L}\p{N}]+)$/gu, '');

		// Découpe robuste en mots, sans produire [''] quand la chaîne est vide.
		const splitWords = (s: string) =>
			s
				.replace(/\u00A0/g, ' ')
				.replace(/\s+/g, ' ')
				.trim()
				.split(' ')
				.filter((w) => w.length > 0);

		type IndexedToken = { value: string; sourceWordIndex: number };
		type MatchCandidate = {
			tokenStart: number;
			tokenEnd: number;
			similarity: number;
		};

		// Transforme un texte en tokens normalisés tout en conservant l'index
		// du mot source. Les tokens vides (ex: ponctuation seule) sont ignorés.
		const toIndexedTokens = (text: string): IndexedToken[] =>
			splitWords(text)
				.map((word, sourceWordIndex) => ({
					value: normalizeWord(word),
					sourceWordIndex
				}))
				.filter((token) => token.value.length > 0);

		const normalizeTextForFuzzy = (text: string) =>
			text
				.replace(/\u00A0/g, ' ')
				.normalize('NFKC')
				.toLowerCase()
				.replace(/[\u2013\u2014]/g, '-')
				.replace(/\s*-\s*/g, '-')
				.replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
				.replace(/\s+/g, ' ')
				.trim();

		const levenshteinDistance = (left: string, right: string): number => {
			if (left === right) return 0;
			if (left.length === 0) return right.length;
			if (right.length === 0) return left.length;

			const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
			const current = new Array<number>(right.length + 1).fill(0);

			for (let i = 1; i <= left.length; i++) {
				current[0] = i;
				for (let j = 1; j <= right.length; j++) {
					const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
					current[j] = Math.min(
						current[j - 1] + 1,
						previous[j] + 1,
						previous[j - 1] + substitutionCost
					);
				}
				for (let j = 0; j <= right.length; j++) {
					previous[j] = current[j];
				}
			}

			return previous[right.length];
		};

		const getSimilarity = (left: string, right: string): number => {
			const normalizedLeft = normalizeTextForFuzzy(left);
			const normalizedRight = normalizeTextForFuzzy(right);
			if (!normalizedLeft || !normalizedRight) return 0;
			if (normalizedLeft === normalizedRight) return 1;
			const maxLength = Math.max(normalizedLeft.length, normalizedRight.length);
			if (maxLength === 0) return 1;
			return 1 - levenshteinDistance(normalizedLeft, normalizedRight) / maxLength;
		};

		const originalTokens = toIndexedTokens(originalTranslationText);

		const chooseBestCandidate = (candidates: MatchCandidate[]): MatchCandidate => {
			const previousStart = this.startWordIndex ?? 0;
			let bestCandidate = candidates[0];
			let bestDistance = Math.abs(
				originalTokens[bestCandidate.tokenStart].sourceWordIndex - previousStart
			);

			for (let i = 1; i < candidates.length; i++) {
				const candidate = candidates[i];
				const candidateDistance = Math.abs(
					originalTokens[candidate.tokenStart].sourceWordIndex - previousStart
				);
				if (
					candidate.similarity > bestCandidate.similarity ||
					(candidate.similarity === bestCandidate.similarity && candidateDistance < bestDistance)
				) {
					bestCandidate = candidate;
					bestDistance = candidateDistance;
				}
			}

			return bestCandidate;
		};

		const currentTokens = toIndexedTokens(this.text);

		// Si le texte courant est vide/invalide après normalisation,
		// ou plus long que l'original, aucun alignement fiable n'est possible.
		if (
			currentTokens.length === 0 ||
			originalTokens.length === 0 ||
			currentTokens.length > originalTokens.length
		) {
			this.isBruteForce = true;
			return;
		}

		// Cas simple: contenu identique après normalisation.
		// On force isBruteForce à false pour éviter un état stale à true.
		const sameNormalizedContent =
			originalTokens.length === currentTokens.length &&
			originalTokens.every((token, i) => token.value === currentTokens[i].value);
		if (sameNormalizedContent) {
			this.startWordIndex = originalTokens[0].sourceWordIndex;
			this.endWordIndex = originalTokens[originalTokens.length - 1].sourceWordIndex;
			this.isBruteForce = false;
			return;
		}

		// Recherche d'une correspondance contiguë du texte courant dans le texte original.
		const candidates: MatchCandidate[] = [];
		for (let i = 0; i <= originalTokens.length - currentTokens.length; i++) {
			let ok = true;
			for (let j = 0; j < currentTokens.length; j++) {
				if (originalTokens[i + j].value !== currentTokens[j].value) {
					ok = false;
					break;
				}
			}
			if (ok) {
				candidates.push({
					tokenStart: i,
					tokenEnd: i + currentTokens.length - 1,
					similarity: 1
				});
			}
		}

		if (candidates.length === 0) {
			const currentTextForFuzzy = currentTokens.map((token) => token.value).join(' ');
			const fuzzyCandidates: MatchCandidate[] = [];
			const minWindowSize = Math.max(1, currentTokens.length - 2);
			const maxWindowSize = Math.min(originalTokens.length, currentTokens.length + 2);

			for (let windowSize = minWindowSize; windowSize <= maxWindowSize; windowSize++) {
				for (let tokenStart = 0; tokenStart <= originalTokens.length - windowSize; tokenStart++) {
					const tokenEnd = tokenStart + windowSize - 1;
					const candidateText = originalTokens
						.slice(tokenStart, tokenEnd + 1)
						.map((token) => token.value)
						.join(' ');
					const similarity = getSimilarity(currentTextForFuzzy, candidateText);
					if (similarity >= 0.95) {
						fuzzyCandidates.push({
							tokenStart,
							tokenEnd,
							similarity
						});
					}
				}
			}

			if (fuzzyCandidates.length === 0) {
				this.isBruteForce = true;
				return;
			}

			const bestFuzzyCandidate = chooseBestCandidate(fuzzyCandidates);
			this.startWordIndex = originalTokens[bestFuzzyCandidate.tokenStart].sourceWordIndex;
			this.endWordIndex = originalTokens[bestFuzzyCandidate.tokenEnd].sourceWordIndex;
			this.isBruteForce = false;
			return;
		}

		const bestCandidate = chooseBestCandidate(candidates);
		this.startWordIndex = originalTokens[bestCandidate.tokenStart].sourceWordIndex;
		this.endWordIndex = originalTokens[bestCandidate.tokenEnd].sourceWordIndex;
		this.isBruteForce = false;
	}
}

export class PredefinedSubtitleTranslation extends Translation {
	constructor(text: string) {
		super(text, 'completed by default');

		if (text === undefined) return; // déserialisation

		if (text.length > 0) {
			this.type = 'predefined';
		} else {
			this.type = 'other';
		}
	}
}
