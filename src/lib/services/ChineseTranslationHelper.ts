const CHINESE_SIMPLIFIED_METADATA_LANGUAGE = 'Chinese (simplified)';
const CHINESE_TRADITIONAL_METADATA_LANGUAGE = 'Chinese (traditional)';

const CHINESE_METADATA_LANGUAGE_ALIASES: Record<string, string> = {
	Chinese: CHINESE_SIMPLIFIED_METADATA_LANGUAGE,
	'Chinese(simplified)': CHINESE_SIMPLIFIED_METADATA_LANGUAGE,
	'Chinese(traditional)': CHINESE_TRADITIONAL_METADATA_LANGUAGE
};

const SIMPLIFIED_CHINESE_EDITION_IDS = new Set([
	'zho_majian',
	'zho_mazhonggang',
	'zho-majian',
	'zho-mazhonggang',
	'zho_muhammadmakin',
	'zho-muhammadmakin',
	'qdc-56',
	'qdc-109'
]);

const TRADITIONAL_CHINESE_EDITION_IDS = new Set([
	'zho_anonymousgroupo',
	'zho-anonymousgroupo',
	'zho_majian1',
	'zho-majian1'
]);

export type ChineseSurahTranslationLanguage = 'ChineseSimplified' | 'ChineseTraditional';

/**
 * Retourne la clé de métadonnées locale pour une langue chinoise connue.
 * @param language La langue déclarée par l'édition.
 * @returns La clé `editions.json` correspondante, ou la langue inchangée.
 */
export function getChineseMetadataLanguage(language: string): string {
	return CHINESE_METADATA_LANGUAGE_ALIASES[language] ?? language;
}

/**
 * Choisit la variante chinoise des noms de sourates selon les éditions connues.
 * @param editions Editions de traduction du projet.
 * @returns La variante chinoise à utiliser, ou `null`.
 */
export function getChineseSurahTranslationLanguage(
	editions: {
		key?: string;
		name?: string;
	}[]
): ChineseSurahTranslationLanguage | null {
	for (const edition of editions) {
		const ids = [edition.key, edition.name].map((value) =>
			String(value ?? '')
				.trim()
				.toLowerCase()
		);

		if (ids.some((id) => SIMPLIFIED_CHINESE_EDITION_IDS.has(id))) {
			return 'ChineseSimplified';
		}
		if (ids.some((id) => TRADITIONAL_CHINESE_EDITION_IDS.has(id))) {
			return 'ChineseTraditional';
		}
	}

	return null;
}
