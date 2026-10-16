export const MARKER_REGEX = /\{\{([^{}]+)\}\}/g;
const QURAN_REFERENCE_REGEX = /^(\d{1,3}):(\d{1,3})(?::(\d+)-(\d+))?$/;

export type QuranTranscriptReference = {
	surah: number;
	verse: number;
	startWord: number | null;
	endWord: number | null;
};

export type TranscriptReferenceLogicalPart = {
	text: string;
	referenceType: 'quran' | 'citation' | null;
	quranReference?: QuranTranscriptReference;
	wordCount: number | null;
};

/**
 * Parse une référence Quran stockée sans ses doubles accolades.
 * @param {string} value Contenu du marqueur.
 * @returns {QuranTranscriptReference | null} Référence parsée ou `null`.
 */
export function parseQuranTranscriptReference(value: string): QuranTranscriptReference | null {
	const match = QURAN_REFERENCE_REGEX.exec(value.trim());
	if (!match) return null;
	return {
		surah: Number(match[1]),
		verse: Number(match[2]),
		startWord: match[3] ? Number(match[3]) : null,
		endWord: match[4] ? Number(match[4]) : null
	};
}

/**
 * Indique si un texte contient au moins un marqueur de référence ou de citation.
 * @param {string} text Texte du sous-titre.
 * @returns {boolean} `true` si un marqueur est présent.
 */
export function hasTranscriptReferenceMarkers(text: string): boolean {
	return /\{\{[^{}]+\}\}/.test(text);
}

/**
 * Compte les unités textuelles séparées par des espaces.
 * Les mots Quran composés sont comptés depuis leur plage canonique, pas avec cette fonction.
 * @param {string} text Texte ordinaire ou citation.
 * @returns {number} Nombre d'unités non vides.
 */
function countSpacedWords(text: string): number {
	return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Compte une plage explicite sans charger de corpus ni consulter le projet.
 * @param {QuranTranscriptReference} reference Annotation de contenu.
 * @returns {number | null} Nombre canonique connu ou absence de résolution.
 */
function getReferenceRangeWordCount(reference: QuranTranscriptReference): number | null {
	return reference.startWord !== null && reference.endWord !== null
		? reference.endWord - reference.startWord + 1
		: null;
}

/**
 * Décompose un texte de transcription en portions logiques sans rendre les marqueurs.
 * Les comptes retournés correspondent aux unités de `alignmentMetadata.words`.
 * @param {string} text Texte source contenant éventuellement des `{{...}}`.
 * @param {(reference: QuranTranscriptReference) => number | null} resolveWordCount Résolution facultative des versets complets.
 * @returns {TranscriptReferenceLogicalPart[] | null} Portions ordonnées, ou `null` sans marqueur.
 */
export function getTranscriptReferenceLogicalParts(
	text: string,
	resolveWordCount: (
		reference: QuranTranscriptReference
	) => number | null = getReferenceRangeWordCount
): TranscriptReferenceLogicalPart[] | null {
	if (!hasTranscriptReferenceMarkers(text)) return null;

	const parts: TranscriptReferenceLogicalPart[] = [];
	let cursor = 0;
	for (const match of text.matchAll(MARKER_REGEX)) {
		if (match.index > cursor) {
			const plainText = text.slice(cursor, match.index);
			parts.push({
				text: plainText,
				referenceType: null,
				wordCount: countSpacedWords(plainText)
			});
		}

		const value = match[1].trim();
		const reference = parseQuranTranscriptReference(value);
		if (reference) {
			parts.push({
				text: value,
				referenceType: 'quran',
				quranReference: reference,
				wordCount: resolveWordCount(reference)
			});
		} else {
			parts.push({
				text: value,
				referenceType: 'citation',
				wordCount: countSpacedWords(value)
			});
		}
		cursor = match.index + match[0].length;
	}

	if (cursor < text.length) {
		const plainText = text.slice(cursor);
		parts.push({
			text: plainText,
			referenceType: null,
			wordCount: countSpacedWords(plainText)
		});
	}
	return parts;
}
