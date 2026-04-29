import { Edition } from '$lib/classes';

const QURAN_CAPTION_WEBSITE_BASE_URL = 'https://qurancaption.com';
const QDC_TRANSLATION_EDITION_PREFIX = 'qdc-translation-';
const ENGLISH_LANGUAGE_KEY = 'English';

export type TranslationLanguageData = {
	flag: string;
	basmala: string;
	istiadhah: string;
	amin: string;
	takbir: string;
	tahmeed: string;
	tasleem: string;
	sadaqa: string;
	translations: Edition[];
};

export type TranslationMetadataMap = Record<string, TranslationLanguageData>;
export type QdcAvailableTranslationsMap = Record<string, TranslationLanguageData>;

export type QdcTranslationCatalogItem = {
	id: number;
	name: string;
	author_name?: string;
	language_name?: string;
};

type QdcTranslationsCatalogResponse = {
	translations?: QdcTranslationCatalogItem[];
};

type QdcChapterTranslationItem = {
	text: string;
	verse_number?: number;
	verse_key?: string;
};

type QdcChapterTranslationsResponse = {
	translations?: QdcChapterTranslationItem[];
};

/**
 * Gère les traductions Quran.com API exposées via le website Quran Caption.
 */
export class QdcTranslationService {
	/**
	 * Indique si une édition provient de l'API Quran.com.
	 * @param edition L'édition à vérifier.
	 * @returns `true` si l'édition vient du flux QDC.
	 */
	static isQdcEdition(edition: Edition): boolean {
		return edition.source === 'qdc-api';
	}

	/**
	 * Charge et groupe les traductions QDC par langue.
	 * @param metadataByLanguage Les métadonnées issues de `editions.json`.
	 * @returns Les traductions QDC groupées pour l'UI.
	 */
	static async getAvailableTranslations(
		metadataByLanguage: TranslationMetadataMap
	): Promise<QdcAvailableTranslationsMap> {
		const response = await fetch('/translations/qdc-editions.json');
		if (!response.ok) {
			throw new Error('Failed to load local QDC translations catalog');
		}

		const payload = (await response.json()) as QdcTranslationsCatalogResponse;
		const groupedTranslations: QdcAvailableTranslationsMap = {};

		for (const item of payload.translations ?? []) {
			const language = this.getDisplayLanguage(item.language_name);
			const metadata = this.resolveMetadata(metadataByLanguage, language);
			const edition = this.createEdition(
				item,
				language,
				metadata.translations[0]?.direction || 'ltr'
			);
			const hasLanguageMetadata = this.hasLanguageMetadata(metadataByLanguage, language);

			if (!groupedTranslations[language]) {
				groupedTranslations[language] = {
					flag: hasLanguageMetadata ? metadata.flag : '',
					basmala: metadata.basmala,
					istiadhah: metadata.istiadhah,
					amin: metadata.amin,
					takbir: metadata.takbir,
					tahmeed: metadata.tahmeed,
					tasleem: metadata.tasleem,
					sadaqa: metadata.sadaqa,
					translations: []
				};
			}

			groupedTranslations[language].translations.push(edition);
		}

		for (const translations of Object.values(groupedTranslations)) {
			translations.translations.sort((a, b) => a.author.localeCompare(b.author));
		}

		return Object.fromEntries(
			Object.entries(groupedTranslations).sort(([a], [b]) => a.localeCompare(b))
		);
	}

	/**
	 * Charge la traduction complète d'une sourate pour une édition QDC.
	 * @param edition L'édition QDC à charger.
	 * @param surah Le numéro de sourate.
	 * @returns Les versets traduits de la sourate.
	 */
	static async getSurahTranslationVerses(
		edition: Edition,
		surah: number
	): Promise<Array<{ verse: number; text: string }>> {
		const translationId = this.getTranslationIdFromEdition(edition);
		const searchParams = new URLSearchParams({
			chapterId: String(surah),
			translationId: String(translationId)
		});

		const response = await fetch(
			`${QURAN_CAPTION_WEBSITE_BASE_URL}/api/quran/content/chapter-translations?${searchParams.toString()}`
		);
		if (!response.ok) {
			throw new Error('Failed to fetch QDC chapter translations');
		}

		const payload = (await response.json()) as QdcChapterTranslationsResponse;
		return (payload.translations ?? [])
			.map((item, index) => ({
				verse: this.getVerseNumber(item, index),
				text: this.removeFootnotes(item.text)
			}))
			.filter((item) => Number.isInteger(item.verse) && item.verse > 0);
	}

	/**
	 * Extrait l'identifiant QDC depuis une édition synthétique.
	 * @param edition L'édition QDC.
	 * @returns L'identifiant numérique upstream.
	 */
	private static getTranslationIdFromEdition(edition: Edition): number {
		const rawId = edition.key.startsWith(QDC_TRANSLATION_EDITION_PREFIX)
			? edition.key.slice(QDC_TRANSLATION_EDITION_PREFIX.length)
			: edition.name.startsWith(QDC_TRANSLATION_EDITION_PREFIX)
				? edition.name.slice(QDC_TRANSLATION_EDITION_PREFIX.length)
				: '';
		const translationId = Number(rawId);
		if (!Number.isInteger(translationId) || translationId <= 0) {
			throw new Error('Invalid QDC translation id');
		}
		return translationId;
	}

	/**
	 * Crée une édition compatible avec le modèle existant.
	 * @param item La traduction QDC brute.
	 * @param language La langue affichée.
	 * @returns Une édition compatible avec le projet.
	 */
	private static createEdition(
		item: QdcTranslationCatalogItem,
		language: string,
		direction: string
	): Edition {
		const translationName = item.name.trim();
		const authorName = item.author_name?.trim();
		const label =
			authorName && authorName.toLowerCase() !== translationName.toLowerCase()
				? `${translationName} - ${authorName}`
				: translationName;
		return new Edition(
			`${QDC_TRANSLATION_EDITION_PREFIX}${item.id}`,
			`${QDC_TRANSLATION_EDITION_PREFIX}${item.id}`,
			label,
			language,
			direction,
			'qdc-api',
			item.name.trim(),
			'',
			''
		);
	}

	/**
	 * Résout les métadonnées de langue avec fallback anglais.
	 * @param metadataByLanguage Les métadonnées existantes.
	 * @param language La langue demandée.
	 * @returns Les métadonnées associées.
	 */
	private static resolveMetadata(
		metadataByLanguage: TranslationMetadataMap,
		language: string
	): TranslationLanguageData {
		const exactMatch = metadataByLanguage[language];
		if (exactMatch) return exactMatch;

		const lowerLanguage = language.toLowerCase();
		for (const [key, value] of Object.entries(metadataByLanguage)) {
			if (key.toLowerCase() === lowerLanguage) {
				return value;
			}
		}

		const englishMetadata = metadataByLanguage[ENGLISH_LANGUAGE_KEY];
		if (englishMetadata) return englishMetadata;

		const firstLanguage = Object.values(metadataByLanguage)[0];
		if (!firstLanguage) {
			throw new Error('No translation metadata available');
		}

		return firstLanguage;
	}

	/**
	 * Indique si une langue possède une entrée explicite dans `editions.json`.
	 * @param metadataByLanguage Les métadonnées existantes.
	 * @param language La langue à vérifier.
	 * @returns `true` si une entrée existe pour cette langue.
	 */
	private static hasLanguageMetadata(
		metadataByLanguage: TranslationMetadataMap,
		language: string
	): boolean {
		if (metadataByLanguage[language]) return true;

		const lowerLanguage = language.toLowerCase();
		return Object.keys(metadataByLanguage).some((key) => key.toLowerCase() === lowerLanguage);
	}

	/**
	 * Normalise le nom de langue reçu depuis QDC.
	 * @param languageName Le nom de langue brut.
	 * @returns Le libellé de langue à afficher.
	 */
	private static getDisplayLanguage(languageName?: string): string {
		const trimmedLanguage = languageName?.trim();
		if (!trimmedLanguage) return ENGLISH_LANGUAGE_KEY;

		return trimmedLanguage
			.split(/\s+/)
			.map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1).toLowerCase())
			.join(' ');
	}

	/**
	 * Récupère le numéro de verset depuis la réponse QDC.
	 * @param item L'item de traduction.
	 * @param index L'index dans le tableau de réponse, utilisé en fallback.
	 * @returns Le numéro de verset, ou 0 si introuvable.
	 */
	private static getVerseNumber(item: QdcChapterTranslationItem, index: number): number {
		if (Number.isInteger(item.verse_number) && item.verse_number! > 0) {
			return item.verse_number!;
		}

		const verseKey = item.verse_key?.split(':')[1];
		const verseNumber = Number(verseKey);
		if (Number.isInteger(verseNumber) && verseNumber > 0) {
			return verseNumber;
		}

		return index + 1;
	}

	/**
	 * Supprime les footnotes HTML injectées par Quran.com dans certains textes.
	 * @param text Le texte de traduction brut.
	 * @returns Le texte sans balises de note.
	 */
	private static removeFootnotes(text: string): string {
		return text.replace(/<sup\b[^>]*>.*?<\/sup>/gi, '').trim();
	}
}
