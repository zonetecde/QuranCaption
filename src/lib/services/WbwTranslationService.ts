export type WbwTranslationLanguageCode = 'en' | 'fr' | 'de' | 'hi' | 'id' | 'ur' | 'bn';

export type WbwTranslationLanguageOption = {
	code: WbwTranslationLanguageCode;
	label: string;
	direction: 'ltr' | 'rtl';
};

type WbwTranslationData = Record<string, Record<string, [string[]]>>;

export const WBW_TRANSLATION_LANGUAGES: WbwTranslationLanguageOption[] = [
	{ code: 'en', label: 'English', direction: 'ltr' },
	{ code: 'fr', label: 'Français', direction: 'ltr' },
	{ code: 'de', label: 'Deutsch', direction: 'ltr' },
	{ code: 'hi', label: 'Hindi', direction: 'ltr' },
	{ code: 'id', label: 'Indonesian', direction: 'ltr' },
	{ code: 'ur', label: 'Urdu', direction: 'rtl' },
	{ code: 'bn', label: 'Bangla', direction: 'ltr' }
];

const wbwTranslationCache = new Map<WbwTranslationLanguageCode, Promise<WbwTranslationData>>();

export class WbwTranslationService {
	/**
	 * Charge les traductions WBW locales pour une langue.
	 * @param {WbwTranslationLanguageCode} languageCode Code de la langue WBW.
	 * @returns {Promise<WbwTranslationData>} Données WBW indexées par sourate puis verset.
	 */
	static loadLanguage(languageCode: WbwTranslationLanguageCode): Promise<WbwTranslationData> {
		if (!wbwTranslationCache.has(languageCode)) {
			wbwTranslationCache.set(
				languageCode,
				fetch(`/translations/wbw/${languageCode}.json`).then((response) => {
					if (!response.ok) {
						throw new Error(`Unable to load WBW translation language: ${languageCode}`);
					}
					return response.json() as Promise<WbwTranslationData>;
				})
			);
		}

		return wbwTranslationCache.get(languageCode)!;
	}

	/**
	 * Retourne les mots WBW d'un segment de verset.
	 * @param {WbwTranslationLanguageCode} languageCode Code de la langue WBW.
	 * @param {number} surah Numéro de sourate.
	 * @param {number} verse Numéro de verset.
	 * @param {number} startWordIndex Index inclusif du premier mot.
	 * @param {number} endWordIndex Index inclusif du dernier mot.
	 * @returns {Promise<string[]>} Mots WBW du segment demandé.
	 */
	static async getWordsForRange(
		languageCode: WbwTranslationLanguageCode,
		surah: number,
		verse: number,
		startWordIndex: number,
		endWordIndex: number
	): Promise<string[]> {
		const data = await WbwTranslationService.loadLanguage(languageCode);
		const words = data[String(surah)]?.[String(verse)]?.[0] ?? [];
		return words.slice(startWordIndex, endWordIndex + 1);
	}

	/**
	 * Retourne la direction d'écriture d'une langue WBW.
	 * @param {WbwTranslationLanguageCode} languageCode Code de la langue WBW.
	 * @returns {'ltr' | 'rtl'} Direction d'écriture.
	 */
	static getLanguageDirection(languageCode: WbwTranslationLanguageCode): 'ltr' | 'rtl' {
		return (
			WBW_TRANSLATION_LANGUAGES.find((language) => language.code === languageCode)?.direction ??
			'ltr'
		);
	}
}
