import { globalState } from '$lib/runes/main.svelte';
import type { Verse } from '$lib/classes/Quran';
import QPCFontProvider from '$lib/services/FontProvider';
import {
	MARKER_REGEX,
	hasTranscriptReferenceMarkers,
	parseQuranTranscriptReference,
	type QuranTranscriptReference
} from '$lib/services/TranscriptMarkup';
import {
	getCachedTranscriptVerse,
	loadReferencedVerse
} from '$lib/services/TranscriptReferenceService';

export type TranscriptReferenceRenderPart = {
	text: string;
	words?: string[];
	suffix?: string;
	suffixFontFamily?: string | null;
	isQuran: boolean;
	isCitation: boolean;
	quranReference?: QuranTranscriptReference;
	extraCss: string;
};

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
			suffix: verseNumber,
			suffixFontFamily: null,
			isQuran: true,
			isCitation: false,
			quranReference: reference,
			extraCss: 'font-family: IndoPak, sans-serif; unicode-bidi: isolate;'
		};
	}

	const qpcVersion = fontFamily === 'QPC1' ? '1' : fontFamily === 'QPC2' ? '2' : null;
	if (mushafStyle === 'Tajweed' || qpcVersion) {
		const version = qpcVersion ?? '2';
		const glyphWords = QPCFontProvider.getQuranVerseGlyphWords(
			reference.surah,
			reference.verse,
			startIndex,
			endIndex,
			version
		);
		if (glyphWords.length !== endIndex - startIndex + 1) {
			void QPCFontProvider.loadQPC2Data().then(() => globalState.updateVideoPreviewUI());
			return {
				text: uthmani + verseNumber,
				suffix: verseNumber,
				suffixFontFamily: null,
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
		const verseNumberGlyph =
			showVerseNumber && endIndex === verse.words.length - 1
				? QPCFontProvider.getQuranVerseNumberGlyph(
						reference.surah,
						reference.verse,
						endIndex,
						version
					)
				: '';
		const suffix = verseNumberGlyph ? ` ${verseNumberGlyph}` : '';
		return {
			text: glyphWords.join(' ') + suffix,
			words: glyphWords,
			suffix,
			suffixFontFamily: font,
			isQuran: true,
			isCitation: false,
			quranReference: reference,
			extraCss: `font-family: ${font}; unicode-bidi: isolate;`
		};
	}

	return {
		text: uthmani + verseNumber,
		suffix: verseNumber,
		suffixFontFamily: null,
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
			const verse = getCachedTranscriptVerse(reference.surah, reference.verse);
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
