import { Quran, type Verse } from '$lib/classes/Quran';
import QPCFontProvider from '$lib/services/FontProvider';

import {
	MARKER_REGEX,
	hasTranscriptReferenceMarkers,
	parseQuranTranscriptReference,
	getTranscriptReferenceLogicalParts as parseLogicalParts,
	type QuranTranscriptReference,
	type TranscriptReferenceLogicalPart
} from './TranscriptMarkup';
export { hasTranscriptReferenceMarkers, parseQuranTranscriptReference } from './TranscriptMarkup';
export type { QuranTranscriptReference, TranscriptReferenceLogicalPart } from './TranscriptMarkup';

export type TranscriptReferenceExportFormat = 'Plain' | 'V1' | 'V2';

const verseCache = new Map<string, Verse>();
const versePromises = new Map<string, Promise<Verse | null>>();

/**
 * Retourne le nombre de mots canoniques couvert par une référence Quran.
 * Pour un verset complet, le corpus doit déjà être chargé dans le cache.
 * @param {QuranTranscriptReference} reference Référence à inspecter.
 * @returns {number | null} Nombre de mots, ou `null` tant que le verset n'est pas chargé.
 */
export function getQuranTranscriptReferenceWordCount(
	reference: QuranTranscriptReference
): number | null {
	if (reference.startWord !== null && reference.endWord !== null) {
		return reference.endWord - reference.startWord + 1;
	}
	return verseCache.get(`${reference.surah}:${reference.verse}`)?.words.length ?? null;
}

/**
 * Résout les portions logiques avec les comptes de mots déjà présents dans le corpus local.
 * @param {string} text Texte annoté du sous-titre.
 * @returns {TranscriptReferenceLogicalPart[] | null} Portions résolues sans déclencher de chargement.
 */
export function getTranscriptReferenceLogicalParts(
	text: string
): TranscriptReferenceLogicalPart[] | null {
	return parseLogicalParts(text, getQuranTranscriptReferenceWordCount);
}

/**
 * Consulte un verset chargé sans dépendance à l'interface de rendu.
 * @param {number} surah Sourate recherchée.
 * @param {number} verse Verset recherché.
 * @returns {Verse | undefined} Verset en cache, s'il existe.
 */
export function getCachedTranscriptVerse(surah: number, verse: number): Verse | undefined {
	return verseCache.get(`${surah}:${verse}`);
}

/**
 * Charge et met en cache un verset utilisé par une référence de transcription.
 * @param {number} surah Numéro de sourate.
 * @param {number} verse Numéro de verset.
 * @returns {Promise<Verse | null>} Verset trouvé ou `null`.
 */
export async function loadReferencedVerse(surah: number, verse: number): Promise<Verse | null> {
	const key = `${surah}:${verse}`;
	const cached = verseCache.get(key);
	if (cached) return cached;
	const pending = versePromises.get(key);
	if (pending) return pending;

	const promise = Quran.load()
		.then(() => Quran.getVerse(surah, verse))
		.then((resolved) => {
			if (resolved) verseCache.set(key, resolved);
			return resolved ?? null;
		})
		.catch(() => null)
		.finally(() => versePromises.delete(key));
	versePromises.set(key, promise);
	return promise;
}

/**
 * Valide toutes les références Quran d'un texte avec les fichiers locaux.
 * @param {string} text Texte nettoyé par l'IA.
 * @returns {Promise<string | null>} Première erreur rencontrée ou `null`.
 */
export async function validateTranscriptQuranReferences(text: string): Promise<string | null> {
	const textWithoutCompleteMarkers = text.replace(MARKER_REGEX, '');
	if (textWithoutCompleteMarkers.includes('{{') || textWithoutCompleteMarkers.includes('}}')) {
		return 'Reference markers must open and close inside the same subtitle segment.';
	}
	for (const match of text.matchAll(MARKER_REGEX)) {
		const value = match[1].trim();
		const reference = parseQuranTranscriptReference(value);
		if (!reference) {
			if (/^\d+\s*:\s*\d+/.test(value)) return `Invalid Quran reference: {{${value}}}.`;
			continue;
		}

		const verse = await loadReferencedVerse(reference.surah, reference.verse);
		if (!verse) return `Quran reference does not exist: {{${value}}}.`;
		if (reference.startWord === null && reference.endWord === null) continue;
		if (
			reference.startWord === null ||
			reference.endWord === null ||
			reference.startWord < 1 ||
			reference.endWord < reference.startWord ||
			reference.endWord > verse.words.length
		) {
			return `Quran word range does not exist: {{${value}}}.`;
		}
	}
	return null;
}

/**
 * Précharge les versets et glyphes nécessaires au rendu des transcriptions.
 * @param {string[]} texts Textes de sous-titres à préparer.
 * @returns {Promise<void>} Promesse résolue après le préchargement.
 */
export async function prefetchTranscriptReferences(texts: string[]): Promise<void> {
	const references = texts.flatMap((text) =>
		Array.from(text.matchAll(MARKER_REGEX), (match) =>
			parseQuranTranscriptReference(match[1])
		).filter((reference): reference is QuranTranscriptReference => reference !== null)
	);
	if (references.length === 0) return;
	await Promise.all([
		...references.map((reference) => loadReferencedVerse(reference.surah, reference.verse)),
		QPCFontProvider.loadQPC2Data()
	]);
}

/**
 * Formate les rÃ©fÃ©rences Quran pour un fichier de sous-titres, sans dÃ©pendre
 * des styles actifs de la preview.
 * @param {string} text Texte source contenant Ã©ventuellement des rÃ©fÃ©rences.
 * @param {TranscriptReferenceExportFormat} format Format arabe demandÃ©.
 * @param {boolean} includeVerseNumbers Inclut le numÃ©ro Ã  la fin des versets complets.
 * @returns {Promise<string>} Texte prÃªt Ã  Ãªtre exportÃ©.
 */
export async function formatTranscriptReferencesForExport(
	text: string,
	format: TranscriptReferenceExportFormat,
	includeVerseNumbers: boolean,
	includeAyahParentheses: boolean
): Promise<string> {
	if (!hasTranscriptReferenceMarkers(text)) return text;
	if (format !== 'Plain') await QPCFontProvider.loadQPC2Data();

	let result = '';
	let cursor = 0;
	for (const match of text.matchAll(MARKER_REGEX)) {
		result += text.slice(cursor, match.index);
		const reference = parseQuranTranscriptReference(match[1]);
		if (!reference) {
			result += match[1].trim();
			cursor = (match.index ?? 0) + match[0].length;
			continue;
		}

		const verse = await loadReferencedVerse(reference.surah, reference.verse);
		if (!verse) {
			result += match[0];
			cursor = (match.index ?? 0) + match[0].length;
			continue;
		}

		const startIndex = (reference.startWord ?? 1) - 1;
		const endIndex = (reference.endWord ?? verse.words.length) - 1;
		const qpcVersion = format === 'V1' ? '1' : format === 'V2' ? '2' : null;
		const glyphWords = qpcVersion
			? QPCFontProvider.getQuranVerseGlyphWords(
					reference.surah,
					reference.verse,
					startIndex,
					endIndex,
					qpcVersion
				)
			: [];
		const verseText =
			glyphWords.length === endIndex - startIndex + 1
				? glyphWords.join(' ')
				: verse.getArabicTextBetweenTwoIndexes(startIndex, endIndex);
		let verseNumber =
			includeVerseNumbers && endIndex === verse.words.length - 1
				? ` \uFD3F${verse.id
						.toString()
						.replace(/\d/g, (digit) => 'Ù Ù¡Ù¢Ù£Ù¤Ù¥Ù¦Ù§Ù¨Ù©'[Number(digit)])}\uFD3E`
				: '';
		if (includeVerseNumbers && endIndex === verse.words.length - 1) {
			verseNumber = ` ${verse.id
				.toString()
				.replace(/\d/g, (digit) => String.fromCharCode(0x0660 + Number(digit)))}`;
		}
		const isFullVerse = startIndex === 0 && endIndex === verse.words.length - 1;
		result +=
			includeAyahParentheses && isFullVerse
				? `\uFD3F${verseText}${verseNumber}\uFD3E`
				: verseText + verseNumber;
		cursor = (match.index ?? 0) + match[0].length;
	}

	return result + text.slice(cursor);
}
