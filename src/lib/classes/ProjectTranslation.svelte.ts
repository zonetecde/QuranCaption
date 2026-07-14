import { globalState } from '$lib/runes/main.svelte';
import { ClipWithTranslation, SubtitleClip } from './Clip.svelte';
import { Edition } from './Edition';
import { SerializableBase } from './misc/SerializableBase';
import {
	getTranslationTrimUnits,
	sliceTranslationTrimUnits,
	VerseTranslation
} from './Translation.svelte';
import ModalManager from '$lib/components/modals/ModalManager';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';
import { QdcTranslationService } from '$lib/services/QdcTranslationService';
import {
	createStructuredTranslationSkeleton,
	getStructuredTranslationDraft,
	getUniqueQuranReferences,
	isCompleteQuranOnlySubtitle
} from '$lib/services/StructuredTranslationService';

type TranslationEditionsResponse = Record<string, unknown>;
type PunctuationVerseItem = [number, string];
type SaheehVerseItem = { surah: number; ayah: number; verse: string };
type SaheehResponse = { quran?: { 'en.sahih'?: Record<string, SaheehVerseItem> } };
type StandardSurahVerse = { verse: number; text: string };
type StandardSurahResponse = { chapter?: StandardSurahVerse[] };

export class ProjectTranslation extends SerializableBase {
	private TEXT_NO_TRANSLATION_AVAILABLE = 'No translation found';

	// Liste des traductions ajoutées au projet
	addedTranslationEditions: Edition[];

	// Contient les traductions originales du Coran utilisées dans le projet
	versesTranslations: {
		[key: string]: { [key: string]: string }; // Clé: édition, Valeur: { clé du verset: texte de la traduction }
	};

	constructor() {
		super();
		this.addedTranslationEditions = $state([]);
		this.versesTranslations = $state({});
	}

	/**
	 * Convertit les anciennes éditions directes en entrées de langue compatibles avec Minbar Studio.
	 * Les clés existantes sont conservées pour ne pas casser les styles ni les traductions sauvegardées.
	 * @returns {void}
	 */
	normalizeProjectLanguages(): void {
		for (const entry of this.addedTranslationEditions) {
			if (entry.source === 'project-language' && entry.quranEdition) continue;

			const previousAuthor = entry.author;
			const quranEdition = new Edition(
				entry.key,
				entry.name,
				entry.author,
				entry.language,
				entry.direction,
				entry.source,
				entry.comments,
				entry.link,
				entry.linkmin,
				entry.showInTranslationsEditor
			);
			entry.quranEdition = quranEdition;
			entry.author = entry.language;
			entry.source = 'project-language';

			const percentages = globalState.currentProject?.detail.translations;
			if (
				percentages &&
				previousAuthor !== entry.language &&
				percentages[previousAuthor] !== undefined &&
				percentages[entry.language] === undefined
			) {
				percentages[entry.language] = percentages[previousAuthor];
				delete percentages[previousAuthor];
			}
		}
	}

	/**
	 * Charge dans la mémoire les traductions disponibles
	 */
	static async loadAvailableTranslations() {
		// Regarde si les traductions sont déjà chargées
		if (Object.keys(globalState.availableTranslations).length > 0) {
			return;
		}

		// Charge les traductions disponibles
		const object = (await (
			await fetch('/translations/editions.json')
		).json()) as TranslationEditionsResponse;

		globalState.availableTranslations = object as typeof globalState.availableTranslations;
	}

	getVerseTranslation(edition: Edition, verseKey: string): string {
		return this.versesTranslations[edition.name]?.[verseKey] || this.TEXT_NO_TRANSLATION_AVAILABLE;
	}

	/**
	 * Récupère la traduction d'un verset spécifique dans une édition donnée
	 * @param surah Le numéro de la sourate
	 * @param verse Le numéro du verset
	 * @param edition L'édition de traduction à utiliser
	 * @returns La traduction ou 'No translation found' si non trouvée
	 */
	async downloadVerseTranslation(edition: Edition, surah: number, verse: number): Promise<string> {
		// Regarde si la traduction est déjà dans le cache
		const cacheKey = `${edition.name}_${surah}_${verse}`;
		const cached = globalState.caches.get(cacheKey);
		if (cached) return cached;

		// Récupère l'édition de traduction par son nom
		if (!edition) return this.TEXT_NO_TRANSLATION_AVAILABLE;

		// Load les traductions de toute la sourate si pas déjà chargée
		await this.loadSurahTranslation(edition, surah);

		// Construit l'URL de la traduction
		const cachedAfterLoad = globalState.caches.get(cacheKey);
		return cachedAfterLoad || this.TEXT_NO_TRANSLATION_AVAILABLE;
	}

	/**
	 * Load la traduction de tout les versets d'une sourate pour une édition donnée
	 */
	private async loadSurahTranslation(edition: Edition, surah: number): Promise<void> {
		// Check if we already have some verses from this surah cached
		const surahCacheKey = `${edition.name}_${surah}_loaded`;
		if (globalState.caches.has(surahCacheKey)) {
			return; // Already loaded
		}

		try {
			const verses = QdcTranslationService.isQdcEdition(edition)
				? await QdcTranslationService.getSurahTranslationVerses(edition, surah)
				: await this.loadLegacySurahTranslation(edition, surah);

			// Cache all verses from the surah
			for (const verseData of verses) {
				const cacheKey = `${edition.name}_${surah}_${verseData.verse}`;
				const processedText = this.processTranslationText(verseData.text, edition);
				globalState.caches.set(cacheKey, processedText);
			}

			// Mark this surah as loaded
			globalState.caches.set(surahCacheKey, 'loaded');
		} catch (error) {
			console.error('Error loading surah translation:', error);
		}
	}

	/**
	 * Charge la traduction d'une sourate
	 */
	private async loadLegacySurahTranslation(
		edition: Edition,
		surah: number
	): Promise<Array<{ verse: number; text: string }>> {
		// Build URL for the entire surah
		const url = this.buildSurahUrl(edition, surah);
		const response = await fetch(url);

		if (!response.ok) {
			return [];
		}

		const data = await response.json();
		return this.extractSurahFromResponse(data, surah, edition);
	}

	/**
	 * Build URL for entire surah translation
	 */
	private buildSurahUrl(edition: Edition, surah: number): string {
		// Si l'édition fait partie des 5 traductions prises via une autre API (pour les poncutations en fin de verset)
		if (edition.comments === 'Ponctuation') {
			return edition.link.replace('{chapter}', surah.toString());
		}

		// Si l'édition fait partie d'une demande spéciale (saheeh international)
		if (edition.comments === 'Saheeh International') {
			return edition.link;
		}

		// Pour les éditions normales, on prend juste la sourate complète
		const baseUrl = edition.link.replace('.json', '');
		return `${baseUrl}/${surah}.json`;
	}

	/**
	 * Extract all verses from a surah response
	 */
	private extractSurahFromResponse(
		data: unknown,
		surah: number,
		edition: Edition
	): Array<{ verse: number; text: string }> {
		if (edition.comments === 'Ponctuation') {
			// Format: array with verse index as key
			const verses = [];
			const punctuationData = Array.isArray(data)
				? (data as Array<PunctuationVerseItem | undefined>)
				: [];
			for (let i = 1; i < punctuationData.length; i++) {
				const item = punctuationData[i];
				if (item && typeof item[1] === 'string') {
					verses.push({ verse: i, text: item[1] });
				}
			}
			return verses;
		} else if (edition.comments === 'Saheeh International') {
			// Format: nested object structure
			const verses = [];
			const saheehData = (data as SaheehResponse).quran?.['en.sahih'] ?? {};
			for (const key in saheehData) {
				const item = saheehData[key];
				if (item.surah === surah) {
					verses.push({ verse: item.ayah, text: item.verse });
				}
			}
			return verses;
		} else {
			// Format standard: { "chapter": [{"chapter": 1, "verse": 1, "text": "..."}, ...] }
			const standardData = data as StandardSurahResponse;
			if (standardData.chapter && Array.isArray(standardData.chapter)) {
				return standardData.chapter.map((item) => ({
					verse: item.verse,
					text: item.text
				}));
			}
			return [];
		}
	}

	/**
	 * Process the translation text to remove unwanted characters
	 */
	private processTranslationText(text: string, edition: Edition): string {
		let processed = text.replace(/\[\d+\]/g, '');

		if (edition.comments === 'Ponctuation') {
			processed = processed
				.replaceAll(' .', '.')
				.replaceAll(' ,', ',')
				.replaceAll(' ', ' ') // Remplace les espaces insécables par des espaces normaux
				.replaceAll(' ;', ';')
				.replaceAll(' ]', ']')
				.replaceAll('[ ', '[')
				.replaceAll(' )', ')')
				.replaceAll('( ', '(')
				//hyphem - pour pouvoir sélectionner le mot avant et après le tiret
				.replaceAll('—', '— ');
		}

		return processed.trim();
	}

	/**
	 * Construit la clé stable utilisée pour une langue du projet.
	 * @param {string} language Nom de la langue affichée.
	 * @returns {string} Clé compatible avec les traductions et les styles vidéo.
	 */
	private getLanguageKey(language: string): string {
		return `language-${language
			.normalize('NFKD')
			.replace(/\p{M}/gu, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '')}`;
	}

	/**
	 * Crée une traduction libre initiale pour un texte de sous-titre.
	 * @param {string} sourceText Texte arabe contenant éventuellement des ancres.
	 * @returns {VerseTranslation} Traduction structurée prête à être éditée.
	 */
	createTranslationForText(sourceText: string): VerseTranslation {
		const translation = new VerseTranslation(
			createStructuredTranslationSkeleton(sourceText),
			isCompleteQuranOnlySubtitle(sourceText) ? 'completed by default' : 'to translate'
		);
		translation.isStructuredTranslation = true;
		translation.isBruteForce = true;
		return translation;
	}

	/**
	 * Crée les traductions manquantes d'un nouveau sous-titre pour toutes les langues du projet.
	 * @param {string} sourceText Texte du nouveau sous-titre.
	 * @returns {{ [key: string]: VerseTranslation }} Traductions indexées par langue.
	 */
	createTranslationsForSubtitleText(sourceText: string): { [key: string]: VerseTranslation } {
		return Object.fromEntries(
			this.addedTranslationEditions.map((language) => [
				language.name,
				this.createTranslationForText(sourceText)
			])
		);
	}

	/**
	 * Télécharge les traductions Quran nécessaires aux ancres du projet.
	 * @param {Edition} language Langue du projet et son édition Quran associée.
	 * @returns {Promise<Record<string, string>>} Traductions complètes indexées par `SS:VV`.
	 */
	async downloadReferencedQuranTranslations(language: Edition): Promise<Record<string, string>> {
		const quranEdition = language.quranEdition;
		if (!quranEdition) return {};

		const downloaded: Record<string, string> = {};
		const references = getUniqueQuranReferences(
			globalState.getSubtitleClips.map((clip) => clip.text)
		);
		for (const reference of references) {
			const verseKey = `${reference.surah}:${reference.verse}`;
			downloaded[verseKey] = await this.downloadVerseTranslation(
				quranEdition,
				reference.surah,
				reference.verse
			);
		}
		return downloaded;
	}

	/**
	 * Ajoute une langue au projet et initialise tous ses champs de traduction.
	 * @param {string} language Nom de la langue.
	 * @param {Edition} quranEdition Édition Quran utilisée pour les ancres Quran.
	 * @returns {Promise<Edition>} Entrée langue ajoutée au projet.
	 */
	async addLanguage(language: string, quranEdition: Edition): Promise<Edition> {
		const existing = this.addedTranslationEditions.find((entry) => entry.language === language);
		if (existing) return existing;

		const name = this.getLanguageKey(language);
		const projectLanguage = new Edition(
			name,
			name,
			language,
			language,
			quranEdition.direction,
			'project-language',
			'',
			'',
			'',
			true,
			quranEdition
		);

		this.addedTranslationEditions.push(projectLanguage);
		this.versesTranslations[name] = await this.downloadReferencedQuranTranslations(projectLanguage);

		for (const subtitle of globalState.getSubtitleClips) {
			subtitle.translations[name] = this.createTranslationForText(subtitle.text);
		}

		await globalState.getVideoStyle.addStylesForEdition(name);
		return projectLanguage;
	}

	/**
	 * Compatibilité avec les anciens créateurs de projet qui demandent les versets avant l'ajout.
	 * @param {Edition} edition Édition Quran à utiliser.
	 * @returns {Promise<Record<string, string>>} Traductions Quran requises par les marqueurs actuels.
	 */
	async getAllProjectSubtitlesTranslations(edition: Edition): Promise<Record<string, string>> {
		const temporaryLanguage = new Edition(
			'temporary-language',
			'temporary-language',
			edition.language,
			edition.language,
			edition.direction,
			'project-language',
			'',
			'',
			'',
			true,
			edition
		);
		return this.downloadReferencedQuranTranslations(temporaryLanguage);
	}

	/**
	 * Compatibilité avec l'ancien ajout direct d'une édition Quran.
	 * @param {Edition} edition Édition Quran choisie.
	 * @param {Record<string, string>} downloadedTranslations Traductions déjà téléchargées.
	 * @returns {Promise<void>} Promesse résolue après l'ajout de la langue.
	 */
	async addTranslation(
		edition: Edition,
		downloadedTranslations: Record<string, string>
	): Promise<void> {
		const language = await this.addLanguage(edition.language, edition);
		this.versesTranslations[language.name] = {
			...(this.versesTranslations[language.name] ?? {}),
			...downloadedTranslations
		};
	}

	/**
	 * Résout les ancres Quran et citations d'une traduction pour son affichage final.
	 * @param {Edition} language Langue du projet.
	 * @param {SubtitleClip} subtitle Sous-titre source.
	 * @param {VerseTranslation} translation Traduction structurée.
	 * @returns {string} Texte final sans doubles accolades visibles.
	 */
	resolveStructuredTranslationText(
		language: Edition,
		subtitle: SubtitleClip,
		translation: VerseTranslation
	): string {
		if (!translation.isStructuredTranslation) return translation.text;

		const draft = getStructuredTranslationDraft(subtitle.text, translation.text);
		let resolved = '';

		for (let index = 0; index < draft.anchors.length; index++) {
			const anchor = draft.anchors[index];
			resolved += draft.freeTexts[index] ?? '';
			if (anchor.type === 'citation') {
				resolved += anchor.value;
				continue;
			}

			const reference = anchor.quranReference;
			if (!reference) continue;
			const verseKey = `${reference.surah}:${reference.verse}`;
			const original = this.versesTranslations[language.name]?.[verseKey] ?? '';
			const units = getTranslationTrimUnits(original);
			const settings = translation.quranSegments?.[anchor.id];
			if (settings?.isBruteForce) {
				resolved += settings.manualText;
				continue;
			}

			resolved += sliceTranslationTrimUnits(
				original,
				settings?.startUnitIndex ?? 0,
				settings?.endUnitIndex ?? Math.max(0, units.length - 1)
			);
		}

		return resolved + (draft.freeTexts[draft.anchors.length] ?? '');
	}

	/**
	 * Réinitialise les traductions libres d'une langue et recharge ses versets Quran.
	 * @param {Edition} edition Langue à réinitialiser.
	 * @returns {Promise<void>} Promesse résolue après la réinitialisation.
	 */
	async resetTranslation(edition: Edition): Promise<void> {
		const response = await ModalManager.confirmModal(
			get(LL).translations.translationResetConfirm({ author: edition.language })
		);
		if (!response) return;

		this.versesTranslations[edition.name] = await this.downloadReferencedQuranTranslations(edition);
		for (const subtitle of globalState.getSubtitleClips) {
			subtitle.translations[edition.name] = this.createTranslationForText(subtitle.text);
		}
		globalState.currentProject!.detail.updatePercentageTranslated(edition);
	}

	/**
	 * Supprime une langue et les traductions associées de tous les clips.
	 * @param {Edition} edition Langue à supprimer.
	 * @param {boolean} force Ignore la confirmation lorsque vrai.
	 * @returns {Promise<void>} Promesse résolue après la suppression.
	 */
	async removeTranslation(edition: Edition, force: boolean = false): Promise<void> {
		if (!force) {
			const response = await ModalManager.confirmModal(
				get(LL).translations.translationRemoveConfirm({ author: edition.language })
			);
			if (!response) return;
		}

		this.addedTranslationEditions = this.addedTranslationEditions.filter(
			(entry) => entry.name !== edition.name
		);
		delete this.versesTranslations[edition.name];

		for (const clip of globalState.getSubtitleTrack.clips) {
			if (clip instanceof ClipWithTranslation) delete clip.translations[edition.name];
		}
		delete globalState.currentProject!.detail.translations[edition.language];
	}

	/**
	 * Récupère une langue du projet par sa clé interne.
	 * @param {string} name Clé de langue.
	 * @returns {Edition} Langue correspondante.
	 */
	getEditionFromName(name: string): Edition {
		const edition = this.addedTranslationEditions.find((entry) => entry.name === name);
		if (!edition) throw new Error(`Edition not found with name: ${name}`);
		return edition;
	}
}
