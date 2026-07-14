import {
	parseQuranTranscriptReference,
	type QuranTranscriptReference
} from '$lib/services/TranscriptReferenceService';

const MARKER_REGEX = /\{\{([^{}]*)\}\}/g;

export type StructuredTranslationAnchor = {
	id: string;
	index: number;
	type: 'quran' | 'citation';
	sourceValue: string;
	value: string;
	quranReference: QuranTranscriptReference | null;
};

export type StructuredTranslationDraft = {
	freeTexts: string[];
	sourceFreeTexts: string[];
	anchors: StructuredTranslationAnchor[];
};

type MarkedTextParts = {
	freeTexts: string[];
	markers: string[];
};

/**
 * Décompose un texte en zones libres et marqueurs `{{...}}`.
 * @param {string} text Texte à décomposer.
 * @returns {MarkedTextParts} Zones libres et contenus des marqueurs dans leur ordre d'apparition.
 */
function splitMarkedText(text: string): MarkedTextParts {
	const freeTexts: string[] = [];
	const markers: string[] = [];
	let cursor = 0;

	for (const match of text.matchAll(MARKER_REGEX)) {
		freeTexts.push(text.slice(cursor, match.index));
		markers.push(match[1]);
		cursor = (match.index ?? 0) + match[0].length;
	}

	freeTexts.push(text.slice(cursor));
	return { freeTexts, markers };
}

/**
 * Retourne la structure de traduction alignée sur les ancres du texte source.
 * @param {string} sourceText Texte arabe contenant les ancres obligatoires.
 * @param {string} translationText Traduction sérialisée actuelle.
 * @returns {StructuredTranslationDraft} Zones libres et ancres éditables normalisées.
 */
export function getStructuredTranslationDraft(
	sourceText: string,
	translationText: string
): StructuredTranslationDraft {
	const source = splitMarkedText(sourceText);
	const translation = splitMarkedText(translationText);
	const hasMatchingMarkerCount = translation.markers.length === source.markers.length;
	const freeTexts = hasMatchingMarkerCount
		? translation.freeTexts
		: [translationText, ...Array.from({ length: source.markers.length }, () => '')];

	const anchors: StructuredTranslationAnchor[] = source.markers.map((sourceValue, index) => {
		const quranReference = parseQuranTranscriptReference(sourceValue.trim());
		const translatedValue = hasMatchingMarkerCount ? (translation.markers[index] ?? '') : '';

		return {
			id: `${quranReference ? 'quran' : 'citation'}-${index}`,
			index,
			type: quranReference ? 'quran' : 'citation',
			sourceValue: sourceValue.trim(),
			value: quranReference ? sourceValue.trim() : translatedValue,
			quranReference
		};
	});

	return {
		freeTexts: Array.from({ length: anchors.length + 1 }, (_, index) => freeTexts[index] ?? ''),
		sourceFreeTexts: Array.from(
			{ length: anchors.length + 1 },
			(_, index) => source.freeTexts[index] ?? ''
		),
		anchors
	};
}

/**
 * Construit la traduction minimale conservant toutes les ancres du texte source.
 * @param {string} sourceText Texte arabe de référence.
 * @returns {string} Traduction vide avec les marqueurs obligatoires.
 */
export function createStructuredTranslationSkeleton(sourceText: string): string {
	const source = splitMarkedText(sourceText);
	return source.markers
		.map((value) => {
			const trimmed = value.trim();
			return parseQuranTranscriptReference(trimmed) ? `{{${trimmed}}}` : '{{}}';
		})
		.join('');
}

/**
 * Sérialise un brouillon segmenté tout en empêchant les zones libres de créer de nouvelles ancres.
 * @param {StructuredTranslationDraft} draft Brouillon à sérialiser.
 * @returns {string} Traduction contenant les mêmes ancres que le texte source.
 */
export function serializeStructuredTranslation(draft: StructuredTranslationDraft): string {
	const sanitizeFreeText = (value: string) => value.replaceAll('{{', '{').replaceAll('}}', '}');
	const sanitizeAnchorText = (value: string) => value.replace(/[{}]/g, '');
	let text = '';

	for (let index = 0; index < draft.anchors.length; index++) {
		const anchor = draft.anchors[index];
		text += sanitizeFreeText(draft.freeTexts[index] ?? '');
		text +=
			anchor.type === 'quran'
				? `{{${anchor.sourceValue}}}`
				: `{{${sanitizeAnchorText(anchor.value)}}}`;
	}

	return text + sanitizeFreeText(draft.freeTexts[draft.anchors.length] ?? '');
}

/**
 * Indique si le sous-titre est uniquement un verset Quran complet.
 * @param {string} sourceText Texte arabe du sous-titre.
 * @returns {boolean} `true` pour une unique ancre `{{SS:VV}}` sans autre contenu.
 */
export function isCompleteQuranOnlySubtitle(sourceText: string): boolean {
	const source = splitMarkedText(sourceText);
	if (source.markers.length !== 1 || source.freeTexts.some((text) => text.trim().length > 0)) {
		return false;
	}

	const reference = parseQuranTranscriptReference(source.markers[0].trim());
	return Boolean(reference && reference.startWord === null && reference.endWord === null);
}

/**
 * Extrait les références Quran uniques présentes dans une liste de textes.
 * @param {string[]} texts Textes de sous-titres à inspecter.
 * @returns {QuranTranscriptReference[]} Références uniques par sourate et verset.
 */
export function getUniqueQuranReferences(texts: string[]): QuranTranscriptReference[] {
	const references = new Map<string, QuranTranscriptReference>();

	for (const text of texts) {
		for (const marker of splitMarkedText(text).markers) {
			const reference = parseQuranTranscriptReference(marker.trim());
			if (!reference) continue;
			references.set(`${reference.surah}:${reference.verse}`, reference);
		}
	}

	return [...references.values()];
}
