import { Quran } from '$lib/classes/Quran';
import { getChineseSurahTranslationLanguage } from './ChineseTranslationHelper';

export type SupportedSurahTranslationLanguage =
	| 'English'
	| 'Spanish'
	| 'French'
	| 'Bengali'
	| 'ChineseSimplified'
	| 'ChineseTraditional';

export const QURAN_TEXT_TAGS = [
	'<number>',
	'<surah>',
	'<verse>',
	'<min-range>',
	'<max-range>',
	'<transliteration>',
	'<translation>',
	'<arabic>',
	'<translation-en>',
	'<translation-es>',
	'<translation-fr>',
	'<translation-bn>',
	'<translation-zh>',
	'<translation-zh_hant>',
	'<translation-zh-hant>',
	'<br>'
] as const;

type SurahTranslations = Record<SupportedSurahTranslationLanguage, string[]>;

export type QuranTextTagValues = {
	number?: string | number;
	surah?: string | number;
	verse?: string | number;
	minRange?: string | number;
	maxRange?: string | number;
	transliteration?: string;
	translation?: string;
	arabic?: string;
	translations?: Partial<Record<SupportedSurahTranslationLanguage, string>>;
};

const supportedTranslationLanguages: SupportedSurahTranslationLanguage[] = [
	'English',
	'Spanish',
	'French',
	'Bengali',
	'ChineseSimplified',
	'ChineseTraditional'
];

const supportedSurahTranslationUrls: Record<SupportedSurahTranslationLanguage, string> = {
	English: '/translations/surahNames/en.json',
	Spanish: '/translations/surahNames/es.json',
	French: '/translations/surahNames/fr.json',
	Bengali: '/translations/surahNames/bn.json',
	ChineseSimplified: '/translations/surahNames/zh.json',
	ChineseTraditional: '/translations/surahNames/zh_hant.json'
};

const surahTranslationTagLanguages: Record<string, SupportedSurahTranslationLanguage> = {
	en: 'English',
	es: 'Spanish',
	fr: 'French',
	bn: 'Bengali',
	zh: 'ChineseSimplified',
	zh_hant: 'ChineseTraditional',
	'zh-hant': 'ChineseTraditional'
};

const supportedSurahTranslations = $state<SurahTranslations>({
	English: [],
	Spanish: [],
	French: [],
	Bengali: [],
	ChineseSimplified: [],
	ChineseTraditional: []
});

let surahNameTranslationsLoadPromise: Promise<void> | null = null;

/**
 * Charge une seule fois les traductions disponibles des noms de sourates.
 * @returns {Promise<void>} Promesse résolue après le chargement des traductions.
 */
export function loadSurahNameTranslations(): Promise<void> {
	if (surahNameTranslationsLoadPromise) return surahNameTranslationsLoadPromise;

	surahNameTranslationsLoadPromise = Promise.all(
		supportedTranslationLanguages.map(async (language) => {
			try {
				const response = await fetch(supportedSurahTranslationUrls[language]);

				if (!response.ok) {
					throw new Error(`Failed to fetch surah names for ${language}: ${response.status}`);
				}

				const names: unknown = await response.json();
				supportedSurahTranslations[language] = Array.isArray(names) ? (names as string[]) : [];
			} catch (error) {
				console.error(`Error loading surah names for ${language}:`, error);
				supportedSurahTranslations[language] = [];
			}
		})
	).then(() => undefined);

	return surahNameTranslationsLoadPromise;
}

/**
 * Retourne le nom traduit d'une sourate avec les mêmes replis que l'overlay Sourate.
 * @param {number} surahNumber Numéro de la sourate.
 * @param {SupportedSurahTranslationLanguage} language Langue demandée.
 * @returns {string} Nom traduit, ou le nom local de Quran en dernier recours.
 */
export function getSurahTranslatedName(
	surahNumber: number,
	language: SupportedSurahTranslationLanguage
): string {
	const surah = Quran.surahs[surahNumber - 1];
	if (!surah) return '';

	const translationFromRequestedLanguage = supportedSurahTranslations[language]?.[surahNumber - 1];
	if (translationFromRequestedLanguage?.trim()) return translationFromRequestedLanguage;

	const englishFallback = supportedSurahTranslations.English?.[surahNumber - 1];
	return englishFallback?.trim() ? englishFallback : surah.translation;
}

/**
 * Choisit la langue des noms de sourates selon les éditions du projet.
 * @param {{ key?: string; name?: string; language?: string }[]} editions Éditions de traduction.
 * @returns {SupportedSurahTranslationLanguage} Langue à utiliser pour le nom de sourate.
 */
export function getPreferredSurahTranslationLanguage(
	editions: { key?: string; name?: string; language?: string }[]
): SupportedSurahTranslationLanguage {
	if (editions.length === 0) return 'English';

	const chineseLanguage = getChineseSurahTranslationLanguage(editions);
	if (chineseLanguage) return chineseLanguage;

	for (let index = editions.length - 1; index >= 0; index--) {
		const language = editions[index].language;
		if (supportedTranslationLanguages.includes(language as SupportedSurahTranslationLanguage)) {
			return language as SupportedSurahTranslationLanguage;
		}
	}

	return 'English';
}

/**
 * Retourne les traductions utilisables par les balises explicites de noms de sourates.
 * @param {number} surahNumber Numéro de la sourate.
 * @returns {Partial<Record<SupportedSurahTranslationLanguage, string>>} Traductions par langue.
 */
export function getSurahTranslationTagValues(
	surahNumber: number
): Partial<Record<SupportedSurahTranslationLanguage, string>> {
	return Object.fromEntries(
		supportedTranslationLanguages.map((language) => [
			language,
			getSurahTranslatedName(surahNumber, language)
		])
	) as Partial<Record<SupportedSurahTranslationLanguage, string>>;
}

/**
 * Remplace les balises de texte Quran connues dans un format utilisateur.
 * @param {string} text Texte contenant éventuellement des balises.
 * @param {QuranTextTagValues} values Valeurs courantes des balises.
 * @returns {string} Texte avec les balises résolues.
 */
export function resolveQuranTextTags(text: string, values: QuranTextTagValues): string {
	const replacements: Record<string, string | number | undefined> = {
		number: values.number,
		surah: values.surah,
		verse: values.verse,
		'min-range': values.minRange,
		'max-range': values.maxRange,
		transliteration: values.transliteration,
		translation: values.translation,
		arabic: values.arabic,
		br: '\n'
	};

	return text.replace(/<([a-z][a-z0-9_-]*)>/gi, (tag, rawName: string) => {
		const name = rawName.toLowerCase();
		if (name.startsWith('translation-')) {
			const language = surahTranslationTagLanguages[name.slice('translation-'.length)];
			const translation = language ? values.translations?.[language] : undefined;
			return translation === undefined ? tag : translation;
		}

		const value = replacements[name];
		return value === undefined ? tag : String(value);
	});
}
