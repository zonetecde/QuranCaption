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
	| 'error'
	| 'fetched'
	| 'undefined';

export type TranslationInlineStyleRun = {
	startWordIndex: number;
	endWordIndex: number;
	bold: boolean;
	italic: boolean;
	underline: boolean;
	lineBreak?: boolean;
	color?: string | null;
};

export type TranslationInlineStyleFlags = Pick<
	TranslationInlineStyleRun,
	'bold' | 'italic' | 'underline' | 'lineBreak' | 'color'
>;

export type TranslationInlineTextSegment = {
	text: string;
	bold: boolean;
	italic: boolean;
	underline: boolean;
	lineBreak?: boolean;
	color?: string | null;
};

export type TranslationWbwRange = {
	arabicWordIndex: number;
	startUnitIndex: number;
	endUnitIndex: number;
};

type TranslationTextToken = {
	text: string;
	isWord: boolean;
	wordIndex: number | null;
};

export type TranslationTrimUnit = {
	text: string;
	startIndex: number;
	endIndex: number;
};

export const EMPTY_INLINE_STYLE_FLAGS: TranslationInlineStyleFlags = {
	bold: false,
	italic: false,
	underline: false,
	lineBreak: false,
	color: null
};

/**
 * Convertit les flags de style inline en CSS appliqué au segment.
 *
 * @param {TranslationInlineStyleFlags} flags Flags de style inline (bold, italic, underline, color).
 * @returns {string} Chaîne CSS correspondante.
 */
export function getInlineStyleCss(flags: TranslationInlineStyleFlags): string {
	const parts: string[] = [];
	if (flags.bold) parts.push('font-weight: 700;');
	if (flags.italic) parts.push('font-style: italic;');
	if (flags.underline) parts.push('text-decoration: underline;');
	if (flags.color) parts.push(`color: ${flags.color};`);
	return parts.join(' ');
}

/**
 * Retourne les flags inline appliqués à un index de mot donné dans une liste
 * de runs de style. Retourne les flags vides si aucun run ne couvre l'index.
 *
 * @param {TranslationInlineStyleRun[]} runs Liste des runs de style.
 * @param {number} wordIndex Index du mot à tester.
 * @returns {TranslationInlineStyleFlags} Flags applicables.
 */
export function getInlineStyleFlagsForWordIndex(
	runs: TranslationInlineStyleRun[],
	wordIndex: number
): TranslationInlineStyleFlags {
	for (const run of runs ?? []) {
		if (run.startWordIndex <= wordIndex && wordIndex <= run.endWordIndex) {
			return {
				bold: run.bold,
				italic: run.italic,
				underline: run.underline,
				lineBreak: Boolean(run.lineBreak),
				color: run.color ?? null
			};
		}
	}

	return { ...EMPTY_INLINE_STYLE_FLAGS };
}

const VERSE_NUMBER_NUMERAL_SYSTEMS: Record<string, string> = {
	'Western Arabic': '0123456789',
	'Arabic-Indic': '٠١٢٣٤٥٦٧٨٩',
	Persian: '۰۱۲۳۴۵۶۷۸۹',
	Urdu: '۰۱۲۳۴۵۶۷۸۹',
	Bengali: '০১২৩৪৫৬৭৮৯',
	Hindi: '०१२३४५६७८९'
};

const CJK_TEXT_REGEX = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const WORD_TEXT_REGEX = /[\p{L}\p{N}]/u;
const PUNCTUATION_ONLY_TEXT_REGEX = /^[^\p{L}\p{N}\s]+$/u;

/**
 * Convertit les chiffres occidentaux d'un nombre vers le système demandé.
 * @param {number} value Nombre à formater.
 * @param {string} system Système de chiffres cible.
 * @returns {string} Nombre avec les chiffres convertis.
 */
function formatVerseNumberNumerals(value: number, system: string): string {
	const digits =
		VERSE_NUMBER_NUMERAL_SYSTEMS[system] ?? VERSE_NUMBER_NUMERAL_SYSTEMS['Western Arabic'];
	return value.toString().replace(/\d/g, (digit) => digits[Number(digit)] ?? digit);
}

/**
 * Indique si le texte contient une écriture sans séparation fiable par espaces.
 *
 * @param {string} text Texte de traduction à analyser.
 * @returns {boolean} `true` si une segmentation CJK doit être utilisée.
 */
export function hasCjkText(text: string): boolean {
	return CJK_TEXT_REGEX.test(text);
}

/**
 * Découpe une traduction en unités sélectionnables pour le trim.
 *
 * @param {string} text Texte de traduction complet.
 * @returns {TranslationTrimUnit[]} Unités lexicales avec leurs positions dans le texte source.
 */
export function getTranslationTrimUnits(text: string): TranslationTrimUnit[] {
	const normalizedText = text.replace(/\u00A0/g, ' ');

	if (!hasCjkText(normalizedText)) {
		return Array.from(normalizedText.matchAll(/\S+/g)).map((match) => ({
			text: match[0],
			startIndex: match.index ?? 0,
			endIndex: (match.index ?? 0) + match[0].length
		}));
	}

	const units: TranslationTrimUnit[] = [];
	let index = 0;
	for (const char of Array.from(normalizedText)) {
		const endIndex = index + char.length;
		if (WORD_TEXT_REGEX.test(char)) {
			units.push({
				text: char,
				startIndex: index,
				endIndex
			});
		}
		index = endIndex;
	}
	return units;
}

/**
 * Compte les unités de trim d'une traduction.
 *
 * @param {string} text Texte de traduction complet.
 * @returns {number} Nombre d'unités sélectionnables.
 */
export function getTranslationTrimUnitCount(text: string): number {
	return getTranslationTrimUnits(text).length;
}

/**
 * Extrait une plage d'unités de trim sans insérer d'espaces artificiels.
 *
 * @param {string} text Texte de traduction complet.
 * @param {number} startWordIndex Index inclusif de début.
 * @param {number} endWordIndex Index inclusif de fin.
 * @returns {string} Texte correspondant à la plage demandée.
 */
export function sliceTranslationTrimUnits(
	text: string,
	startWordIndex: number,
	endWordIndex: number
): string {
	const units = getTranslationTrimUnits(text);
	if (units.length === 0) return '';

	const start = Math.max(0, Math.min(units.length - 1, startWordIndex));
	const end = Math.max(start, Math.min(units.length - 1, endWordIndex));

	if (!hasCjkText(text)) {
		return units
			.slice(start, end + 1)
			.map((unit) => unit.text)
			.join(' ');
	}

	const sliceEnd = units[end + 1]?.startIndex ?? text.length;
	return text.slice(units[start].startIndex, sliceEnd).trim();
}

/**
 * Returns true when at least one inline style flag is active.
 */
function hasInlineStyle(flags: TranslationInlineStyleFlags): boolean {
	return flags.bold || flags.italic || flags.underline || flags.lineBreak || Boolean(flags.color);
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
		Boolean(left.lineBreak) === Boolean(right.lineBreak) &&
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
		...(flags.lineBreak ? { lineBreak: true } : {}),
		color: typeof flags.color === 'string' && flags.color.trim().length > 0 ? flags.color : null
	};
}

/**
 * Construit un run inline sans stocker les flags optionnels inactifs.
 *
 * @param {number} startWordIndex Index de début du run.
 * @param {number} endWordIndex Index de fin du run.
 * @param {TranslationInlineStyleFlags} flags Flags à écrire.
 * @returns {TranslationInlineStyleRun} Run normalisé.
 */
function createInlineStyleRun(
	startWordIndex: number,
	endWordIndex: number,
	flags: TranslationInlineStyleFlags
): TranslationInlineStyleRun {
	return {
		startWordIndex,
		endWordIndex,
		bold: flags.bold,
		italic: flags.italic,
		underline: flags.underline,
		...(flags.lineBreak ? { lineBreak: true } : {}),
		color: flags.color ?? null
	};
}

/**
 * Splits translation text into spacing and selectable tokens while preserving order,
 * and assigns incremental word indexes to selectable tokens only.
 */
export function tokenizeTranslationText(text: string): TranslationTextToken[] {
	if (hasCjkText(text)) {
		const units = getTranslationTrimUnits(text);
		const tokens: TranslationTextToken[] = [];
		let cursor = 0;
		let wordIndex = 0;

		for (const unit of units) {
			if (unit.startIndex > cursor) {
				tokens.push({
					text: text.slice(cursor, unit.startIndex),
					isWord: false,
					wordIndex: null
				});
			}

			tokens.push({
				text: unit.text,
				isWord: true,
				wordIndex: wordIndex++
			});
			cursor = unit.endIndex;
		}

		if (cursor < text.length) {
			tokens.push({
				text: text.slice(cursor),
				isWord: false,
				wordIndex: null
			});
		}

		return tokens;
	}

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
				normalized.push(createInlineStyleRun(currentStart, index - 1, currentFlags));
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
			normalized.push(createInlineStyleRun(currentStart, index - 1, currentFlags));
			currentStart = index;
			currentFlags = cloneInlineStyleFlags(flags);
		}
	}

	if (currentStart !== -1) {
		normalized.push(createInlineStyleRun(currentStart, states.length - 1, currentFlags));
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
				lineBreak: Boolean(run.lineBreak),
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
		if (toggledFlags.lineBreak) states[index].lineBreak = !states[index].lineBreak;
		if (toggledFlags.color) {
			states[index].color = states[index].color === toggledFlags.color ? null : toggledFlags.color;
		}
	}

	return normalizeTranslationInlineStyleRuns(
		states.map((flags, index) => createInlineStyleRun(index, index, flags)),
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
				lineBreak: Boolean(run.lineBreak),
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
			const flags = flagsByWordIndex[token.wordIndex];
			pushText(token.text, flags);
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

		if (previousFlags.lineBreak) continue;
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
				lineBreak: Boolean(run.lineBreak),
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
		states.map((flags, index) => createInlineStyleRun(index, index, flags)),
		totalWordCount
	);
}

/**
 * Normalise les ranges WBW de traduction en supprimant les entrées invalides.
 *
 * @param {TranslationWbwRange[]} ranges Ranges stockées sur la traduction.
 * @param {number} arabicWordCount Nombre de mots arabes du sous-titre.
 * @param {number} unitCount Nombre d'unités sélectionnables dans la traduction.
 * @returns {TranslationWbwRange[]} Ranges bornées et valides.
 */
export function normalizeTranslationWbwRanges(
	ranges: TranslationWbwRange[],
	arabicWordCount: number,
	unitCount: number
): TranslationWbwRange[] {
	if (arabicWordCount <= 0 || unitCount <= 0) return [];

	return (ranges ?? [])
		.map((range) => ({
			arabicWordIndex: Number(range.arabicWordIndex),
			startUnitIndex: Number(range.startUnitIndex),
			endUnitIndex: Number(range.endUnitIndex)
		}))
		.filter(
			(range) =>
				Number.isInteger(range.arabicWordIndex) &&
				Number.isInteger(range.startUnitIndex) &&
				Number.isInteger(range.endUnitIndex) &&
				range.arabicWordIndex >= 0 &&
				range.arabicWordIndex < arabicWordCount &&
				range.startUnitIndex <= range.endUnitIndex
		)
		.map((range) => ({
			arabicWordIndex: range.arabicWordIndex,
			startUnitIndex: Math.max(0, Math.min(unitCount - 1, range.startUnitIndex)),
			endUnitIndex: Math.max(0, Math.min(unitCount - 1, range.endUnitIndex))
		}))
		.filter((range) => range.startUnitIndex <= range.endUnitIndex);
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

	/**
	 * Default text update path for translations without inline style support.
	 * VerseTranslation overrides this to also clear inline styles.
	 */
	setTextAndClearInlineStyles(text: string): void {
		this.text = text;
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

	// Ranges associant les mots arabes aux unités de traduction trim.
	wbwRanges: TranslationWbwRange[] = $state([]);

	constructor(text: string, status: TranslationStatus) {
		super(text, status);

		if (text === undefined) return; // déserialisation

		this.startWordIndex = 0;
		this.endWordIndex = Math.max(0, getTranslationTrimUnitCount(text) - 1);
		this.isBruteForce = false;
		this.inlineStyleRuns = [];
		this.wbwRanges = [];
		this.type = 'verse';
	}

	/**
	 * Removes all inline emphasis styles.
	 */
	clearInlineStyles(): void {
		this.inlineStyleRuns = [];
	}

	/**
	 * Supprime tous les mappings WBW de traduction.
	 *
	 * @returns {void}
	 */
	clearWbwRanges(): void {
		this.wbwRanges = [];
	}

	/**
	 * Supprime le mapping WBW associé à un mot arabe.
	 *
	 * @param {number} arabicWordIndex Index du mot arabe local au sous-titre.
	 * @returns {void}
	 */
	clearWbwRange(arabicWordIndex: number): void {
		this.wbwRanges = (this.wbwRanges ?? []).filter(
			(range) => range.arabicWordIndex !== arabicWordIndex
		);
	}

	/**
	 * Définit la plage de traduction liée à un mot arabe.
	 *
	 * @param {number} arabicWordIndex Index du mot arabe local au sous-titre.
	 * @param {number} startUnitIndex Index inclusif de début dans la traduction trim.
	 * @param {number} endUnitIndex Index inclusif de fin dans la traduction trim.
	 * @returns {void}
	 */
	setWbwRange(arabicWordIndex: number, startUnitIndex: number, endUnitIndex: number): void {
		this.wbwRanges = [
			...(this.wbwRanges ?? []).filter((range) => range.arabicWordIndex !== arabicWordIndex),
			{
				arabicWordIndex,
				startUnitIndex: Math.min(startUnitIndex, endUnitIndex),
				endUnitIndex: Math.max(startUnitIndex, endUnitIndex)
			}
		];
	}

	/**
	 * Ajoute une plage de traduction au mapping d'un mot arabe.
	 *
	 * @param {number} arabicWordIndex Index du mot arabe local au sous-titre.
	 * @param {number} startUnitIndex Index inclusif de début dans la traduction trim.
	 * @param {number} endUnitIndex Index inclusif de fin dans la traduction trim.
	 * @returns {void}
	 */
	addWbwRange(arabicWordIndex: number, startUnitIndex: number, endUnitIndex: number): void {
		this.setWbwUnitRangeSelection(arabicWordIndex, startUnitIndex, endUnitIndex, true);
	}

	/**
	 * Définit l'état sélectionné d'une plage d'unités pour un mot arabe.
	 *
	 * @param {number} arabicWordIndex Index du mot arabe local au sous-titre.
	 * @param {number} startUnitIndex Index inclusif de début dans la traduction trim.
	 * @param {number} endUnitIndex Index inclusif de fin dans la traduction trim.
	 * @param {boolean} isSelected État cible des unités.
	 * @returns {void}
	 */
	setWbwUnitRangeSelection(
		arabicWordIndex: number,
		startUnitIndex: number,
		endUnitIndex: number,
		isSelected: boolean
	): void {
		const normalizedRanges = this.getNormalizedWbwRanges(Number.MAX_SAFE_INTEGER);
		const start = Math.min(startUnitIndex, endUnitIndex);
		const end = Math.max(startUnitIndex, endUnitIndex);
		const selectedUnits = new Set<number>();
		const nextRanges = normalizedRanges.filter((range) => {
			if (range.arabicWordIndex !== arabicWordIndex) return true;
			for (let index = range.startUnitIndex; index <= range.endUnitIndex; index++) {
				selectedUnits.add(index);
			}
			return false;
		});

		for (let index = start; index <= end; index++) {
			if (isSelected) {
				selectedUnits.add(index);
			} else {
				selectedUnits.delete(index);
			}
		}

		const sortedUnits = [...selectedUnits].sort((left, right) => left - right);
		let rangeStart = sortedUnits[0] ?? -1;
		let previous = rangeStart;
		for (let index = 1; index <= sortedUnits.length; index++) {
			const current = sortedUnits[index];
			if (current === previous + 1) {
				previous = current;
				continue;
			}
			if (rangeStart >= 0) {
				nextRanges.push({
					arabicWordIndex,
					startUnitIndex: rangeStart,
					endUnitIndex: previous
				});
			}
			rangeStart = current ?? -1;
			previous = current ?? -1;
		}

		this.wbwRanges = normalizeTranslationWbwRanges(
			nextRanges,
			Number.MAX_SAFE_INTEGER,
			getTranslationWordCount(this.text)
		);
	}

	/**
	 * Active ou désactive une unité de traduction pour un mot arabe.
	 *
	 * @param {number} arabicWordIndex Index du mot arabe local au sous-titre.
	 * @param {number} unitIndex Index de l'unité trim à basculer.
	 * @returns {void}
	 */
	toggleWbwUnit(arabicWordIndex: number, unitIndex: number): void {
		const normalizedRanges = this.getNormalizedWbwRanges(Number.MAX_SAFE_INTEGER);
		const nextRanges: TranslationWbwRange[] = [];
		let removedUnit = false;

		for (const range of normalizedRanges) {
			const isTargetRange =
				range.arabicWordIndex === arabicWordIndex &&
				range.startUnitIndex <= unitIndex &&
				unitIndex <= range.endUnitIndex;
			if (!isTargetRange) {
				nextRanges.push(range);
				continue;
			}

			removedUnit = true;
			if (range.startUnitIndex < unitIndex) {
				nextRanges.push({
					arabicWordIndex,
					startUnitIndex: range.startUnitIndex,
					endUnitIndex: unitIndex - 1
				});
			}
			if (unitIndex < range.endUnitIndex) {
				nextRanges.push({
					arabicWordIndex,
					startUnitIndex: unitIndex + 1,
					endUnitIndex: range.endUnitIndex
				});
			}
		}

		if (!removedUnit) {
			nextRanges.push({
				arabicWordIndex,
				startUnitIndex: unitIndex,
				endUnitIndex: unitIndex
			});
		}

		this.wbwRanges = normalizeTranslationWbwRanges(
			nextRanges,
			Number.MAX_SAFE_INTEGER,
			getTranslationWordCount(this.text)
		);
	}

	/**
	 * Retourne les mappings WBW valides pour le texte courant.
	 *
	 * @param {number} arabicWordCount Nombre de mots arabes du sous-titre.
	 * @returns {TranslationWbwRange[]} Ranges WBW normalisées.
	 */
	getNormalizedWbwRanges(arabicWordCount: number): TranslationWbwRange[] {
		return normalizeTranslationWbwRanges(
			this.wbwRanges ?? [],
			arabicWordCount,
			getTranslationWordCount(this.text)
		);
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
		this.wbwRanges = this.getNormalizedWbwRanges(Number.MAX_SAFE_INTEGER);
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
		this.clearWbwRanges();
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
			const numeralSystem = String(
				globalState.getStyle(edition, 'verse-number-numeral-system')?.value ?? 'Western Arabic'
			);
			const verseNumber = formatVerseNumberNumerals(subtitle.verse, numeralSystem);
			const format = String(globalState.getStyle(edition, 'verse-number-format').value).replace(
				'<number>',
				verseNumber
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
				.normalize('NFKD')
				.replace(/\p{M}/gu, '')
				.toLowerCase()
				.replace(/[\u2018\u2019\u02BC\uFF07]/g, "'")
				.replace(/[\u2013\u2014]/g, '-')
				.replace(/^([^\p{L}\p{N}]+)|([^\p{L}\p{N}]+)$/gu, '');

		// Découpe robuste en unités lexicales, y compris pour les langues CJK.
		const splitWords = (s: string) => getTranslationTrimUnits(s).map((unit) => unit.text);
		const originalWords = splitWords(originalTranslationText);

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
				.normalize('NFKD')
				.replace(/\p{M}/gu, '')
				.toLowerCase()
				.replace(/[\u2018\u2019\u02BC\uFF07]/g, "'")
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

		/**
		 * Étend l'index de fin vers les ponctuations isolées qui suivent.
		 *
		 * @param {number} tokenEnd Index du dernier token normalisé matché.
		 * @returns {number} Index de fin dans les unités de traduction originales.
		 */
		const getEndWordIndexWithFollowingPunctuation = (tokenEnd: number): number => {
			let endWordIndex = originalTokens[tokenEnd].sourceWordIndex;

			while (
				endWordIndex < originalWords.length - 1 &&
				PUNCTUATION_ONLY_TEXT_REGEX.test(originalWords[endWordIndex + 1].trim())
			) {
				endWordIndex++;
			}

			return endWordIndex;
		};

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
			this.endWordIndex = getEndWordIndexWithFollowingPunctuation(originalTokens.length - 1);
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
			this.endWordIndex = getEndWordIndexWithFollowingPunctuation(bestFuzzyCandidate.tokenEnd);
			this.isBruteForce = false;
			return;
		}

		const bestCandidate = chooseBestCandidate(candidates);
		this.startWordIndex = originalTokens[bestCandidate.tokenStart].sourceWordIndex;
		this.endWordIndex = getEndWordIndexWithFollowingPunctuation(bestCandidate.tokenEnd);
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
