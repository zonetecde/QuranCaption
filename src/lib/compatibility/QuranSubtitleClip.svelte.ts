import { SubtitleClip } from '$lib/classes/clips/SubtitleClip.svelte';
import type { ArabicRenderParts } from '$lib/classes/clips/ClipWithTranslation.svelte';
import { Translation } from '$lib/classes/Translation.svelte';
import { SerializableBase } from '$lib/classes/misc/SerializableBase';
import { globalState } from '$lib/runes/main.svelte';
import MinimalQuranProvider from '$lib/services/MinimalQuranProvider';

/** Adaptateur des segments du moteur Quran ; les transcriptions Minbar utilisent SubtitleClip. */
export class QuranSubtitleClip extends SubtitleClip {
	// Métadonnées Qur'an conservées pour les projets existants et les outils WBW.
	surah: number = $state(0);
	verse: number = $state(0);
	startWordIndex: number = $state(0);
	endWordIndex: number = $state(0);
	indopakText: string = $state('');
	wbwTranslation: string[] = $state([]);
	isFullVerse: boolean = $state(false);
	isLastWordsOfVerse: boolean = $state(false);

	/**
	 * Adapte un segment orienté verset sans modifier le contrat des sous-titres Minbar.
	 * @param {number} startTime Début en millisecondes.
	 * @param {number} endTime Fin en millisecondes.
	 * @param {number} surah Sourate source.
	 * @param {number} verse Verset source.
	 * @param {number} startWordIndex Premier mot canonique, indexé à zéro.
	 * @param {number} endWordIndex Dernier mot canonique, indexé à zéro.
	 * @param {string} text Texte arabe source.
	 * @param {string[]} wbwTranslation Traductions mot par mot.
	 * @param {boolean} isFullVerse Indique un verset complet.
	 * @param {boolean} isLastWordsOfVerse Indique la fin du verset.
	 * @param {Record<string, Translation>} translations Traductions existantes.
	 * @param {string} indopakText Texte alternatif IndoPak.
	 * @param {boolean} comeFromIA Origine automatique du segment.
	 * @param {number | null} confidence Confiance du moteur.
	 */
	constructor(
		startTime = 0,
		endTime = 0,
		surah = 0,
		verse = 0,
		startWordIndex = 0,
		endWordIndex = 0,
		text = '',
		wbwTranslation: string[] = [],
		isFullVerse = false,
		isLastWordsOfVerse = false,
		translations: Record<string, Translation> = {},
		indopakText = '',
		comeFromIA = false,
		confidence: number | null = null
	) {
		super(startTime, endTime, text, translations, comeFromIA, confidence);
		this.surah = surah;
		this.verse = verse;
		this.startWordIndex = startWordIndex;
		this.endWordIndex = endWordIndex;
		this.wbwTranslation = wbwTranslation;
		this.isFullVerse = isFullVerse;
		this.isLastWordsOfVerse = isLastWordsOfVerse;
		this.indopakText = indopakText || text;
	}

	/**
	 * Retourne le numéro de verset dans le format numérique utilisé par l'éditeur.
	 * @returns {string} Numéro de verset en chiffres arabo-indiens.
	 */
	private latinToArabicNumbers(n: number): string {
		return n.toString().replace(/\d/g, (digit) => '٠١٢٣٤٥٦٧٨٩'[Number(digit)] ?? digit);
	}

	/**
	 * Retourne les parties du texte arabe adaptées au contexte d'affichage.
	 * @param {'editor' | 'preview'} mode Contexte de rendu.
	 * @returns {ArabicRenderParts} Texte, mots rendus et suffixe éventuel.
	 */
	override getArabicRenderParts(mode: 'editor' | 'preview' = 'editor'): ArabicRenderParts {
		if (this.surah <= 0 || this.verse <= 0) return super.getArabicRenderParts(mode);

		const showVerseNumber =
			this.isLastWordsOfVerse &&
			Boolean(globalState.getStyle('arabic', 'show-verse-number')?.value);
		const suffix = showVerseNumber ? ` ${this.latinToArabicNumbers(this.verse)}` : '';
		if (mode === 'editor') {
			return { text: this.text, suffix, suffixFontFamily: null };
		}

		const mushafStyle = String(globalState.getStyle('arabic', 'mushaf-style')?.value ?? 'Uthmani');
		if (mushafStyle === 'Minimal Quran') {
			const words =
				MinimalQuranProvider.getVerseWordsSlice(
					this.surah,
					this.verse,
					this.startWordIndex,
					this.endWordIndex
				) ?? undefined;
			return {
				text: words?.join(' ') ?? this.text,
				words,
				sourceWordOffset: this.startWordIndex,
				sourceWordIndexes: words?.map((_, index) => [this.startWordIndex + index]),
				suffix,
				suffixFontFamily: null
			};
		}

		if (mushafStyle === 'Indopak') {
			return {
				text: this.indopakText.trim() || this.text,
				suffix,
				suffixFontFamily: suffix ? 'Hafs' : null
			};
		}

		return { text: this.text, suffix, suffixFontFamily: null };
	}

	/**
	 * Clone le segment du moteur avec ses données canoniques et ses éditions Minbar.
	 * @param {number} newStartTime Nouveau début en millisecondes.
	 * @param {number} newEndTime Nouvelle fin en millisecondes.
	 * @returns {QuranSubtitleClip} Copie indépendante du segment.
	 */
	override cloneWithTimes(newStartTime: number, newEndTime: number): QuranSubtitleClip {
		const base = super.cloneWithTimes(newStartTime, newEndTime);
		const clonedClip = new QuranSubtitleClip(
			newStartTime,
			newEndTime,
			this.surah,
			this.verse,
			this.startWordIndex,
			this.endWordIndex,
			base.text,
			[...this.wbwTranslation],
			this.isFullVerse,
			this.isLastWordsOfVerse,
			base.translations,
			this.indopakText,
			base.comeFromIA,
			base.confidence
		);
		clonedClip.alignmentMetadata = base.alignmentMetadata;
		this.copyEditingStateTo(clonedClip);
		return clonedClip;
	}

	/**
	 * Retourne la référence Qur'an associée au clip quand elle existe.
	 * @returns {string} Référence au format `sourate:verset`.
	 */
	getVerseKey(): string {
		return `${this.surah}:${this.verse}`;
	}
}

SerializableBase.registerChildClass(QuranSubtitleClip, 'translations', Translation);

/**
 * Identifie les anciens clips Quran et retire leurs champs inutilisés des transcriptions Minbar.
 * @param {Record<string, unknown>} data Ancien sous-titre sérialisé.
 * @returns {Record<string, unknown>} Données adaptées au bon modèle sans modifier l'original.
 */
export function migrateLegacySubtitleData(data: Record<string, unknown>): Record<string, unknown> {
	if (Number(data.surah) > 0 && Number(data.verse) > 0)
		return { ...data, __className: 'QuranSubtitleClip' };
	const migrated = { ...data };
	for (const key of [
		'surah',
		'verse',
		'startWordIndex',
		'endWordIndex',
		'indopakText',
		'wbwTranslation',
		'isFullVerse',
		'isLastWordsOfVerse'
	])
		delete migrated[key];
	return migrated;
}
