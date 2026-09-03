import type { ProjectTranslation } from '../../ProjectTranslation.svelte.js';
import type { Verse } from '../../Quran.js';
import { SubtitleClip, type ClipWithTranslation } from '../../Clip.svelte.js';
import type { VerseTranslation } from '../../Translation.svelte.js';

export type SubtitleContentProperties = {
	isFullVerse: boolean;
	isLastWordsOfVerse: boolean;
	translations: Record<string, VerseTranslation>;
};

export type SubtitlePropertiesResolver = (
	verse: Verse,
	firstWordIndex: number,
	lastWordIndex: number,
	surah: number
) => Promise<SubtitleContentProperties>;

export type SubtitleClipCreation = {
	startTime: number;
	endTime: number;
	surah: number;
	verse: Verse;
	firstWordIndex: number;
	lastWordIndex: number;
	associatedImageSource?: ClipWithTranslation;
};

/** Construit et hydrate le contenu textuel des clips Quran. */
export class SubtitleContentFactory {
	/**
	 * Calcule les propriétés dérivées et les traductions d'une plage de verset.
	 * @param {Verse} verse Verset source.
	 * @param {number} firstWordIndex Premier mot inclus.
	 * @param {number} lastWordIndex Dernier mot inclus.
	 * @param {number} surah Numéro de la sourate.
	 * @param {ProjectTranslation | null} projectTranslation Traductions disponibles dans le projet.
	 * @returns {Promise<SubtitleContentProperties>} Propriétés dérivées de la plage.
	 */
	static async getProperties(
		verse: Verse,
		firstWordIndex: number,
		lastWordIndex: number,
		surah: number,
		projectTranslation: ProjectTranslation | null
	): Promise<SubtitleContentProperties> {
		const isFullVerse = verse.words.length === lastWordIndex - firstWordIndex + 1;
		const isLastWordsOfVerse = verse.words.length - lastWordIndex - 1 === 0;
		const translations = projectTranslation
			? await projectTranslation.getTranslations(surah, verse.id, isFullVerse)
			: {};

		return { isFullVerse, isLastWordsOfVerse, translations };
	}

	/**
	 * Met à jour le contenu d'un clip existant depuis une plage de verset.
	 * @param {SubtitleClip} clip Clip à hydrater.
	 * @param {Verse} verse Verset source.
	 * @param {number} firstWordIndex Premier mot inclus.
	 * @param {number} lastWordIndex Dernier mot inclus.
	 * @param {SubtitlePropertiesResolver} resolveProperties Résolveur des propriétés dérivées.
	 * @returns {Promise<void>} Promesse résolue lorsque le clip est hydraté.
	 */
	static async hydrateClip(
		clip: SubtitleClip,
		verse: Verse,
		firstWordIndex: number,
		lastWordIndex: number,
		resolveProperties: SubtitlePropertiesResolver
	): Promise<void> {
		clip.startWordIndex = firstWordIndex;
		clip.endWordIndex = lastWordIndex;
		clip.text = verse.getArabicTextBetweenTwoIndexes(firstWordIndex, lastWordIndex);
		clip.wbwTranslation = verse.getWordByWordTranslationBetweenTwoIndexes(
			firstWordIndex,
			lastWordIndex
		);
		const properties = await resolveProperties(verse, firstWordIndex, lastWordIndex, clip.surah);
		clip.isFullVerse = properties.isFullVerse;
		clip.isLastWordsOfVerse = properties.isLastWordsOfVerse;
		clip.translations = properties.translations;
		clip.clearArabicInlineStyles();
	}

	/**
	 * Crée un clip Quran entièrement hydraté.
	 * @param {SubtitleClipCreation} creation Données temporelles et textuelles du clip.
	 * @param {SubtitlePropertiesResolver} resolveProperties Résolveur des propriétés dérivées.
	 * @returns {Promise<SubtitleClip>} Nouveau clip prêt à rejoindre une piste.
	 */
	static async createClip(
		creation: SubtitleClipCreation,
		resolveProperties: SubtitlePropertiesResolver
	): Promise<SubtitleClip> {
		const properties = await resolveProperties(
			creation.verse,
			creation.firstWordIndex,
			creation.lastWordIndex,
			creation.surah
		);
		const clip = new SubtitleClip(
			creation.startTime,
			creation.endTime,
			creation.surah,
			creation.verse.id,
			creation.firstWordIndex,
			creation.lastWordIndex,
			creation.verse.getArabicTextBetweenTwoIndexes(
				creation.firstWordIndex,
				creation.lastWordIndex
			),
			creation.verse.getWordByWordTranslationBetweenTwoIndexes(
				creation.firstWordIndex,
				creation.lastWordIndex
			),
			properties.isFullVerse,
			properties.isLastWordsOfVerse,
			properties.translations
		);
		clip.associatedImagePath = creation.associatedImageSource?.associatedImagePath ?? '';
		return clip;
	}
}
