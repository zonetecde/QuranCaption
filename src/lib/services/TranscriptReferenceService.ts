import { Quran, type Verse } from '$lib/classes/Quran';
import { globalState } from '$lib/runes/main.svelte';
import QPCFontProvider from '$lib/services/FontProvider';

const MARKER_REGEX = /\{\{([^{}]+)\}\}/g;
const QURAN_REFERENCE_REGEX = /^(\d{1,3}):(\d{1,3})(?::(\d+)-(\d+))?$/;

export type QuranTranscriptReference = {
	surah: number;
	verse: number;
	startWord: number | null;
	endWord: number | null;
};

export type TranscriptReferenceRenderPart = {
	text: string;
	isQuran: boolean;
	isCitation: boolean;
	quranReference?: QuranTranscriptReference;
	extraCss: string;
};

const verseCache = new Map<string, Verse>();
const versePromises = new Map<string, Promise<Verse | null>>();

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
 * Charge et met en cache un verset utilisé par une référence de transcription.
 * @param {number} surah Numéro de sourate.
 * @param {number} verse Numéro de verset.
 * @returns {Promise<Verse | null>} Verset trouvé ou `null`.
 */
async function loadReferencedVerse(surah: number, verse: number): Promise<Verse | null> {
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
 * Retourne le texte et la police d'une plage Quran prête à afficher.
 * @param {QuranTranscriptReference} reference Référence validée.
 * @param {Verse} verse Verset local.
 * @param {string} mushafStyle Style de mushaf actif.
 * @param {string} fontFamily Police arabe active.
 * @returns {TranscriptReferenceRenderPart} Partie de rendu Quran.
 */
function buildQuranRenderPart(
	reference: QuranTranscriptReference,
	verse: Verse,
	mushafStyle: string,
	fontFamily: string
): TranscriptReferenceRenderPart {
	const startIndex = (reference.startWord ?? 1) - 1;
	const endIndex = (reference.endWord ?? verse.words.length) - 1;
	const uthmani = verse.getArabicTextBetweenTwoIndexes(startIndex, endIndex);
	const showVerseNumber = Boolean(globalState.getStyle('arabic-quran', 'show-verse-number').value);
	const verseNumber = showVerseNumber && endIndex === verse.words.length - 1 ? ` ۝${verse.id}` : '';

	if (mushafStyle === 'Indopak') {
		return {
			text: verse.getArabicTextBetweenTwoIndexes(startIndex, endIndex, 'indopak') + verseNumber,
			isQuran: true,
			isCitation: false,
			quranReference: reference,
			extraCss: 'font-family: IndoPak, sans-serif; unicode-bidi: isolate;'
		};
	}

	const qpcVersion = fontFamily === 'QPC1' ? '1' : fontFamily === 'QPC2' ? '2' : null;
	if (mushafStyle === 'Tajweed' || qpcVersion) {
		const version = qpcVersion ?? '2';
		const glyph = QPCFontProvider.getQuranVerseGlyph(
			reference.surah,
			reference.verse,
			startIndex,
			endIndex,
			endIndex === verse.words.length - 1,
			version
		);
		if (!glyph) {
			void QPCFontProvider.loadQPC2Data().then(() => globalState.updateVideoPreviewUI());
			return {
				text: uthmani + verseNumber,
				isQuran: true,
				isCitation: false,
				quranReference: reference,
				extraCss: 'font-family: Hafs, sans-serif;'
			};
		}
		const font =
			mushafStyle === 'Tajweed'
				? `${QPCFontProvider.getTajweedFontNameForVerse(reference.surah, reference.verse)}, ${QPCFontProvider.getFontNameForVerse(reference.surah, reference.verse, '2')}`
				: QPCFontProvider.getFontNameForVerse(reference.surah, reference.verse, version);
		return {
			text: glyph,
			isQuran: true,
			isCitation: false,
			quranReference: reference,
			extraCss: `font-family: ${font}; unicode-bidi: isolate;`
		};
	}

	return {
		text: uthmani + verseNumber,
		isQuran: true,
		isCitation: false,
		quranReference: reference,
		extraCss: 'unicode-bidi: isolate;'
	};
}

/**
 * Transforme les marqueurs stockés en parties de rendu synchrones.
 * @param {string} text Texte source du sous-titre.
 * @param {string} mushafStyle Style de mushaf actif.
 * @param {string} fontFamily Police arabe active.
 * @returns {TranscriptReferenceRenderPart[] | null} Parties rendues ou `null` sans marqueur.
 */
export function getTranscriptReferenceRenderParts(
	text: string,
	mushafStyle: string,
	fontFamily: string
): TranscriptReferenceRenderPart[] | null {
	if (!hasTranscriptReferenceMarkers(text)) return null;

	const parts: TranscriptReferenceRenderPart[] = [];
	const plainCss = '';
	let cursor = 0;
	for (const match of text.matchAll(MARKER_REGEX)) {
		if (match.index > cursor) {
			parts.push({
				text: text.slice(cursor, match.index),
				isQuran: false,
				isCitation: false,
				extraCss: plainCss
			});
		}

		const value = match[1].trim();
		const reference = parseQuranTranscriptReference(value);
		if (!reference) {
			parts.push({ text: value, isQuran: false, isCitation: true, extraCss: plainCss });
		} else {
			const verse = verseCache.get(`${reference.surah}:${reference.verse}`);
			if (verse) {
				parts.push(buildQuranRenderPart(reference, verse, mushafStyle, fontFamily));
			} else {
				void loadReferencedVerse(reference.surah, reference.verse).then(() =>
					globalState.updateVideoPreviewUI()
				);
				parts.push({ text: match[0], isQuran: false, isCitation: false, extraCss: plainCss });
			}
		}
		cursor = match.index + match[0].length;
	}

	if (cursor < text.length) {
		parts.push({
			text: text.slice(cursor),
			isQuran: false,
			isCitation: false,
			extraCss: plainCss
		});
	}
	return parts;
}
