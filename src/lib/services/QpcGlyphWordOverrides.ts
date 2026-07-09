type QpcGlyphWordSplitOverride = {
	surah: number;
	verse: number;
	wordIndex: number;
	glyphCount: number;
};

const QPC_GLYPH_WORD_SPLIT_OVERRIDES: QpcGlyphWordSplitOverride[] = [
	{
		surah: 13,
		verse: 37,
		wordIndex: 7,
		glyphCount: 2
	}
];

/**
 * Retourne les overrides QPC de decoupage glyph pour un verset.
 * @param {number} surah Numero de sourate.
 * @param {number} verse Numero de verset.
 * @returns {QpcGlyphWordSplitOverride[]} Overrides applicables au verset.
 */
function getQpcGlyphWordSplitOverrides(surah: number, verse: number): QpcGlyphWordSplitOverride[] {
	return QPC_GLYPH_WORD_SPLIT_OVERRIDES.filter(
		(override) => override.surah === surah && override.verse === verse
	);
}

/**
 * Compte les glyphes QPC supplementaires consommes avant ou pendant un mot.
 * @param {QpcGlyphWordSplitOverride[]} overrides Overrides du verset.
 * @param {number} wordIndex Index 0-based du mot logique Uthmani.
 * @param {boolean} includeCurrent Indique si le mot courant doit etre inclus.
 * @returns {number} Nombre de glyphes supplementaires.
 */
function countExtraGlyphsBeforeWord(
	overrides: QpcGlyphWordSplitOverride[],
	wordIndex: number,
	includeCurrent: boolean
): number {
	return overrides.reduce((total, override) => {
		const shouldInclude = includeCurrent
			? override.wordIndex <= wordIndex
			: override.wordIndex < wordIndex;
		return shouldInclude ? total + Math.max(0, override.glyphCount - 1) : total;
	}, 0);
}

/**
 * Retourne les indexes glyph QPC 0-based qui representent un mot logique.
 * @param {number} surah Numero de sourate.
 * @param {number} verse Numero de verset.
 * @param {number} wordIndex Index 0-based du mot logique Uthmani.
 * @returns {number[]} Indexes 0-based des glyphes QPC.
 */
export function getQpcGlyphIndexesForWord(
	surah: number,
	verse: number,
	wordIndex: number
): number[] {
	const overrides = getQpcGlyphWordSplitOverrides(surah, verse);
	const splitOverride = overrides.find((override) => override.wordIndex === wordIndex);
	const baseGlyphIndex = wordIndex + countExtraGlyphsBeforeWord(overrides, wordIndex, false);
	const glyphCount = splitOverride?.glyphCount ?? 1;

	return Array.from({ length: glyphCount }, (_, index) => baseGlyphIndex + index);
}

/**
 * Retourne l'index glyph QPC 0-based du numero de verset apres le dernier mot.
 * @param {number} surah Numero de sourate.
 * @param {number} verse Numero de verset.
 * @param {number} lastWordIndex Index 0-based du dernier mot logique.
 * @returns {number} Index 0-based du glyph de numero de verset.
 */
export function getQpcVerseNumberGlyphIndex(
	surah: number,
	verse: number,
	lastWordIndex: number
): number {
	const overrides = getQpcGlyphWordSplitOverrides(surah, verse);
	return lastWordIndex + 1 + countExtraGlyphsBeforeWord(overrides, lastWordIndex, true);
}
