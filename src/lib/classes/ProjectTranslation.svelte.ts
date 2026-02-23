import { globalState } from '$lib/runes/main.svelte';
import type { SubtitleClip } from './Clip.svelte';
import { canonicalizePredefinedSubtitleType } from './Clip.svelte';
import type { Edition } from './Edition';
import { TrackType } from './enums';
import { SerializableBase } from './misc/SerializableBase';
import toast from 'svelte-5-french-toast';
import { PredefinedSubtitleTranslation, Translation, VerseTranslation } from './Translation.svelte';
import ModalManager from '$lib/components/modals/ModalManager';

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
	 * Charge dans la mémoire les traductions disponibles
	 */
	static async loadAvailableTranslations() {
		// Regarde si les traductions sont déjà chargées
		if (Object.keys(globalState.availableTranslations).length > 0) {
			return;
		}

		// Charge les traductions disponibles
		const object: any = await (await fetch('/translations/editions.json')).json();

		globalState.availableTranslations = object;
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
			// Build URL for the entire surah
			const url = this.buildSurahUrl(edition, surah);
			const response = await fetch(url);

			if (!response.ok) {
				return;
			}

			const data = await response.json();
			const verses = this.extractSurahFromResponse(data, surah, edition);

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
		data: any,
		surah: number,
		edition: Edition
	): Array<{ verse: number; text: string }> {
		if (edition.comments === 'Ponctuation') {
			// Format: array with verse index as key
			const verses = [];
			for (let i = 1; i < data.length; i++) {
				if (data[i]) {
					verses.push({ verse: i, text: data[i][1] });
				}
			}
			return verses;
		} else if (edition.comments === 'Saheeh International') {
			// Format: nested object structure
			const verses = [];
			for (const key in data['quran']['en.sahih']) {
				const item = data['quran']['en.sahih'][key];
				if (item.surah === surah) {
					verses.push({ verse: item.ayah, text: item.verse });
				}
			}
			return verses;
		} else {
			// Format standard: { "chapter": [{"chapter": 1, "verse": 1, "text": "..."}, ...] }
			if (data.chapter && Array.isArray(data.chapter)) {
				return data.chapter.map((item: any) => ({
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
	 * Récupère toutes les traductions des sous-titres du projet pour une édition donnée
	 * @param edition L'édition de traduction à utiliser
	 * @returns Un objet contenant les traductions des sous-titres
	 */
	async getAllProjectSubtitlesTranslations(edition: Edition) {
		// Récupère toutes les traductions des sous-titres du projet pour une traduction donnée
		const translations: { [key: string]: string } = {};

		const versesInProject = new Set<string>();

		for (const predefinedSubtitle of globalState.getPredefinedSubtitleClips) {
			// Ajoute les versets des sous-titres pré-définis
			const type = canonicalizePredefinedSubtitleType(predefinedSubtitle.predefinedSubtitleType);
			if (type === 'Other') continue;

			if (type === 'Basmala') {
				translations['Basmala'] = globalState.availableTranslations[edition.language].basmala;
			} else if (type === "Isti'adha") {
				translations["Isti'adha"] = globalState.availableTranslations[edition.language].istiadhah;
			} else if (type === 'Amin') {
				translations['Amin'] = globalState.availableTranslations[edition.language].amin;
			} else if (type === 'Takbir') {
				translations['Takbir'] = globalState.availableTranslations[edition.language].takbir;
			} else if (type === 'Tahmeed') {
				translations['Tahmeed'] = globalState.availableTranslations[edition.language].tahmeed;
			} else if (type === 'Tasleem') {
				translations['Tasleem'] = globalState.availableTranslations[edition.language].tasleem;
			} else if (type === 'Sadaqa') {
				translations['Sadaqa'] = globalState.availableTranslations[edition.language].sadaqa;
			}
		}

		for (const subtitle of globalState.getSubtitleClips) {
			versesInProject.add(subtitle.getVerseKey());
		}

		// Télécharge les traductions pour chaque verset
		for (const verseKey of versesInProject) {
			const [surah, verse] = verseKey.split(':').map(Number);
			const translationText = await this.downloadVerseTranslation(edition, surah, verse);
			translations[verseKey] = translationText;
		}

		return translations;
	}

	/**
	 * Ajoute une traduction au projet
	 * @param edition L'édition de traduction à ajouter
	 * @param downloadedTranslations Les traductions téléchargées pour cette édition
	 */
	async addTranslation(edition: Edition, downloadedTranslations: Record<string, string>) {
		// Vérifie si l'édition est déjà ajoutée
		if (this.addedTranslationEditions.some((e) => e.name === edition.name)) {
			const response = await ModalManager.confirmModal(
				`The translation ${edition.author} is already added. Do you want to reset it?` +
					` This will replace all existing translations for this edition.`
			);
			if (!response) return;
		} else {
			edition.showInTranslationsEditor = true; // Par défaut
			this.addedTranslationEditions.push(edition);
		}

		// Pour chaque sous-titre du projet, ajoute la traduction correspondante
		for (const subtitle of globalState.getSubtitleClips) {
			// Récupère la traduction à partir du dictionnaire de traductions téléchargées
			const verseKey = subtitle.getVerseKey();
			const translationText =
				downloadedTranslations[verseKey] || this.TEXT_NO_TRANSLATION_AVAILABLE;

			if (!this.versesTranslations[edition.name]) {
				this.versesTranslations[edition.name] = {};
			}

			this.versesTranslations[edition.name][verseKey] = translationText;

			// Ajoute la traduction à l'objet de traduction du clip
			subtitle.translations[edition.name] = new VerseTranslation(
				translationText,
				subtitle.isFullVerse ? 'completed by default' : 'to review'
			);
		}

		// Ajoute maintenant la traduction des sous-titre pré-définis
		for (const subtitle of globalState.getPredefinedSubtitleClips) {
			subtitle.translations[edition.name] = this.getPredefinedSubtitleTranslation(
				edition,
				subtitle.predefinedSubtitleType
			);
		}

		// Ajoute les styles de traduction par défaut
		await globalState.getVideoStyle.addStylesForEdition(edition.name);
	}

	getPredefinedSubtitleTranslation(edition: Edition, type: string): PredefinedSubtitleTranslation {
		const lang = globalState.availableTranslations[edition.language];
		const canonicalType = canonicalizePredefinedSubtitleType(type);

		switch (canonicalType) {
			case 'Basmala':
				return new PredefinedSubtitleTranslation(lang.basmala);
			case "Isti'adha":
				return new PredefinedSubtitleTranslation(lang.istiadhah);
			case 'Amin':
				return new PredefinedSubtitleTranslation(lang.amin);
			case 'Takbir':
				return new PredefinedSubtitleTranslation(lang.takbir);
			case 'Tahmeed':
				return new PredefinedSubtitleTranslation(lang.tahmeed);
			case 'Tasleem':
				return new PredefinedSubtitleTranslation(lang.tasleem);
			case 'Sadaqa':
				return new PredefinedSubtitleTranslation(lang.sadaqa);
			default:
				return new PredefinedSubtitleTranslation('');
		}
	}

	async resetTranslation(edition: Edition) {
		const response = await ModalManager.confirmModal(
			`Are you sure you want to reset the translation for ${edition.author}? This will replace all existing translations for this edition.`
		);

		if (!response) return;

		// Réinitialise la traduction pour l'édition donnée
		const translations = await this.getAllProjectSubtitlesTranslations(edition);

		// Supprime l'édition de la liste des traductions ajoutées
		await this.removeTranslation(edition, true);

		await this.addTranslation(edition, translations);

		globalState.currentProject!.detail.updatePercentageTranslated(edition);
	}

	async removeTranslation(edition: Edition, force: boolean = false) {
		if (!force) {
			const response = await ModalManager.confirmModal(
				`Are you sure you want to remove the translation for ${edition.author}? This will remove all translations for this edition.`
			);

			if (!response) return;
		}

		this.addedTranslationEditions = this.addedTranslationEditions.filter(
			(e) => e.name !== edition.name
		);

		// Supprime les traductions de l'édition dans les clips de sous-titres
		for (const subtitle of globalState.getSubtitleClips) {
			if (subtitle.translations[edition.name]) {
				delete subtitle.translations[edition.name];
			}
		}

		globalState.currentProject!.detail.updatePercentageTranslated(edition);
	}

	/**
	 * Lorsqu'on ajoute un sous-titre au projet après avoir ajouté une traduction,
	 * on doit récupérer les traductions pour ce verset de toutes les éditions ajoutées.
	 * @param surah Le numéro de la sourate
	 * @param verse Le numéro du verset
	 */
	async getTranslations(
		surah: number,
		verse: number,
		isFullVerse: boolean
	): Promise<{
		[key: string]: VerseTranslation;
	}> {
		const translations: { [key: string]: VerseTranslation } = {};
		if (globalState.getProjectTranslation.addedTranslationEditions.length > 0) {
			for (const translationEdition of globalState.getProjectTranslation.addedTranslationEditions) {
				const translation = await globalState.getProjectTranslation.downloadVerseTranslation(
					translationEdition,
					surah,
					verse
				);

				if (!globalState.getProjectTranslation.versesTranslations[translationEdition.name]) {
					globalState.getProjectTranslation.versesTranslations[translationEdition.name] = {};
				}

				// Ajoute la traduction à l'objet translations
				globalState.getProjectTranslation.versesTranslations[translationEdition.name][
					surah + ':' + verse
				] = translation;

				translations[translationEdition.name] = new VerseTranslation(
					translation,
					isFullVerse ? 'completed by default' : 'to review'
				);
			}
		}
		return translations;
	}

	/**
	 * Récupère une édition par son nom.
	 * @param name Le nom de l'édition
	 * @returns L'édition correspondante ou une erreur
	 */
	getEditionFromName(name: string): Edition {
		const edition = globalState.getProjectTranslation.addedTranslationEditions.find(
			(e) => e.name === name
		);
		if (!edition) {
			throw new Error(`Edition not found with name: ${name}`);
		}
		return edition;
	}
}
