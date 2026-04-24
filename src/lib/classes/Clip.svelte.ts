import { globalState } from '$lib/runes/main.svelte';
import toast from 'svelte-5-french-toast';
import { Edition, Translation } from '.';
import {
	buildTranslationInlineTextSegments,
	getTranslationWordCount,
	type TranslationInlineStyleFlags,
	type TranslationInlineStyleRun,
	type TranslationInlineTextSegment,
	toggleTranslationInlineStyleRuns
} from './Translation.svelte';
import { SerializableBase } from './misc/SerializableBase';
import { Utilities } from './misc/Utilities';
import type { Track } from './Track.svelte';
import type { Category, StyleName } from './VideoStyle.svelte';
import { Quran } from './Quran';
import QPCFontProvider from '$lib/services/FontProvider';
import type { SubtitleAlignmentMetadata } from '$lib/services/AutoSegmentation';

type ClipType =
	| 'Silence'
	| 'Pre-defined Subtitle'
	| 'Subtitle'
	| 'Custom Text'
	| 'Custom Image'
	| 'Asset';

type ArabicRenderParts = {
	text: string;
	suffix: string;
	suffixFontFamily: string | null;
};

export class Clip extends SerializableBase {
	id: number;
	startTime: number = $state(0);
	endTime: number = $state(0);
	duration: number = $state(0);

	type: ClipType;
	showWaveform: boolean = $state(false);

	constructor(startTime: number, endTime: number, type: ClipType) {
		super();

		this.id = Utilities.randomId();
		this.startTime = startTime;
		this.endTime = endTime;
		this.duration = endTime - startTime;
		this.type = type;
	}

	getWidth(): number {
		const timelineZoom = globalState.currentProject?.projectEditorState.timeline.zoom ?? 0;
		if (this.duration === 0) {
			// C'est dans le cas où l'asset est une image. C'est alors l'image de fond de la vidéo.
			// Elle prend la taille de la timeline.
			const longestTrackDuration =
				globalState.currentProject?.content.timeline.getLongestTrackDuration().toSeconds() ?? 0;
			return longestTrackDuration * timelineZoom;
		}

		return (this.duration / 1000) * timelineZoom;
	}

	/**
	 * Met à jour l'heure de début du clip tout en modifiant l'heure de fin du clip précédent pour éviter les chevauchements.
	 * @param newStartTime La nouvelle heure de début.
	 */
	updateStartTime(newStartTime: number) {
		// Vérification 1: Le clip actuel doit avoir au minimum 100ms de durée
		const newCurrentClipDuration = this.endTime - newStartTime;
		if (newCurrentClipDuration < 100) {
			return;
		}

		// Met à jour la endTime du clip à sa gauche pour éviter les chevauchements
		const track: Track = globalState.getSubtitleTrack;

		const previousClip = track.getClipBefore(this.id);

		if (previousClip && previousClip.id !== this.id) {
			// Vérification 2: Le clip précédent doit avoir au minimum 100ms de durée
			const newPreviousClipDuration = newStartTime - 1 - previousClip.startTime;

			if (newPreviousClipDuration < 100) {
				return;
			}

			previousClip.endTime = newStartTime - 1;
			previousClip.duration = previousClip.endTime - previousClip.startTime;
		}

		this.setStartTime(newStartTime);
	}

	/**
	 * Met à jour l'heure de fin du clip tout en modifiant l'heure de début du clip suivant pour éviter les chevauchements.
	 * @param newEndTime La nouvelle heure de fin.
	 */
	updateEndTime(newEndTime: number) {
		// Vérification 1: Le clip actuel doit avoir au minimum 100ms de durée
		const newCurrentClipDuration = newEndTime - this.startTime;
		if (newCurrentClipDuration < 100) {
			return;
		}

		// Met à jour la startTime du clip à sa droite pour éviter les chevauchements
		const track: Track = globalState.getSubtitleTrack;

		const nextClip = track.getClipAfter(this.id);

		if (nextClip && nextClip.id !== this.id) {
			// Vérification 2: Le clip suivant doit avoir au minimum 100ms de durée
			const newNextClipDuration = nextClip.endTime - (newEndTime + 1);

			if (newNextClipDuration < 100) {
				return;
			}

			// Met à jour le startTime du clip suivant
			nextClip.setStartTime(newEndTime + 1);
		}

		this.setEndTime(newEndTime);
	}

	/**
	 * Met à jour l'heure de début du clip et recalcule la durée.
	 * @param newStartTime La nouvelle heure de début.
	 */
	setStartTime(newStartTime: number) {
		// Prévention pour pas que le clip est une durée négative
		if (this.endTime < newStartTime) {
			toast.error('The length of the clip cannot be negative.');
			return;
		}

		this.startTime = newStartTime;
		this.duration = this.endTime - this.startTime;
	}

	/**
	 * Met à jour l'heure de fin du clip et recalcule la durée.
	 * @param newEndTime La nouvelle heure de fin.
	 */
	setEndTime(newEndTime: number) {
		// Prévention pour pas que le clip est une durée négative
		if (newEndTime < this.startTime) {
			toast.error('The length of the clip cannot be negative.');
			return;
		}

		this.endTime = newEndTime;
		this.duration = this.endTime - this.startTime;
	}
}

export class AssetClip extends Clip {
	assetId: number;
	loopUntilAudioEnd: boolean = $state(false);

	constructor(startTime: number, endTime: number, assetId: number) {
		super(startTime, endTime, 'Asset');
		this.assetId = assetId;
	}
}

export class ClipWithTranslation extends Clip {
	hasBeenVerified: boolean = $state(false);
	translations: { [key: string]: Translation } = $state({});
	text: string = $state('');
	arabicInlineStyleRuns: TranslationInlineStyleRun[] = $state([]);
	associatedImagePath: string | null = $state(null);
	needsLongReview: boolean = $state(false); // Vrai si le segment a été marqué comme trop long.
	comeFromIA: boolean = $state(false);
	confidence: number | null = $state(null); // Entre 0 et 1
	needsReview: boolean = $state(false); // Vrai si c'est un segment à low-confidence et qu'il n'a pas encore été reviewé
	needsCoverageReview: boolean = $state(false); // Vrai si des lacunes de couverture sont détectées

	constructor(
		text: string,
		startTime: number,
		endTime: number,
		type: ClipType,
		translations: { [key: string]: Translation } = {},
		comeFromIA: boolean = false,
		confidence: number | null = null
	) {
		super(startTime, endTime, type);
		this.translations = translations;
		this.text = text;
		this.comeFromIA = comeFromIA;
		this.confidence = comeFromIA ? confidence : null;
		// Le segment est marqué comme besoin de review si c'est un segment IA et qu'il a une confiance inférieure à 75%
		this.needsReview = comeFromIA && confidence !== null && confidence <= 0.75;
	}

	markAsManualEdit() {
		this.comeFromIA = false;
		this.confidence = null;
		this.needsReview = false; // Le segment n'a plus besoin de review de confiance
		this.needsCoverageReview = false; // Le segment n'a plus besoin de review de couverture
		this.needsLongReview = false;
		this.hasBeenVerified = false;
	}

	/**
	 * Retourne la traduction associée à l'édition spécifiée.
	 * @param edition L'édition pour laquelle obtenir la traduction.
	 * @return La traduction associée à l'édition.
	 */
	getTranslation(edition: Edition | string): Translation {
		return this.translations[typeof edition === 'string' ? edition : edition.name];
	}

	getText(): string {
		return this.text;
	}

	/**
	 * Retourne les parties du texte arabe à afficher.
	 * Par défaut, les clips texte simples utilisent toujours `this.text`.
	 * `SubtitleClip` override cette méthode pour gérer les rendus Quran/QPC/IndoPak.
	 */
	getArabicRenderParts(_mode: 'editor' | 'preview' = 'editor'): ArabicRenderParts {
		return {
			text: this.text,
			suffix: '',
			suffixFontFamily: null
		};
	}

	clearArabicInlineStyles(): void {
		this.arabicInlineStyleRuns = [];
	}

	/**
	 * Toggle les styles inline sur une plage de mots du texte arabe.
	 * Les indexes sont toujours basés sur le texte source stocké dans `this.text`.
	 */
	toggleArabicInlineStyles(
		startWordIndex: number,
		endWordIndex: number,
		flags: TranslationInlineStyleFlags
	): void {
		this.arabicInlineStyleRuns = toggleTranslationInlineStyleRuns(
			this.arabicInlineStyleRuns ?? [],
			getTranslationWordCount(this.text),
			startWordIndex,
			endWordIndex,
			flags
		);
	}

	/**
	 * Construit les segments stylés du texte arabe, sans inclure d'éventuel suffixe
	 * comme un numéro de verset.
	 */
	getArabicInlineStyledSegments(
		mode: 'editor' | 'preview' = 'editor'
	): TranslationInlineTextSegment[] {
		return buildTranslationInlineTextSegments(
			this.getArabicRenderParts(mode).text,
			this.arabicInlineStyleRuns ?? []
		);
	}

	getAssociatedImagePath(): string | null {
		return this.associatedImagePath;
	}

	hasAssociatedImage(): boolean {
		return !!this.associatedImagePath;
	}

	setAssociatedImagePath(path: string | null): void {
		this.associatedImagePath = path;
	}
}

export type ReviewIssueCategory = 'coverage' | 'long' | 'low-confidence';

/**
 * Retourne `true` si le clip porte au moins un indicateur de revue actif.
 *
 * @param {ClipWithTranslation | null | undefined} clip Clip a inspecter.
 * @returns {boolean} `true` si le clip doit etre considere comme reviewable.
 */
export function hasClipReviewIssue(clip: ClipWithTranslation | null | undefined): boolean {
	return !!clip && (clip.needsCoverageReview || clip.needsLongReview || clip.needsReview);
}

/**
 * Retourne la categorie principale de review d'un clip.
 *
 * @param {ClipWithTranslation | null | undefined} clip Clip a inspecter.
 * @returns {ReviewIssueCategory | null} Categorie principale ou `null`.
 */
export function getClipPrimaryReviewIssueCategory(
	clip: ClipWithTranslation | null | undefined
): ReviewIssueCategory | null {
	if (!clip) return null;
	if (clip.needsCoverageReview) return 'coverage';
	if (clip.needsLongReview) return 'long';
	if (clip.needsReview) return 'low-confidence';
	return null;
}

/**
 * Retourne `true` si le clip a encore besoin d'une verification explicite.
 *
 * @param {ClipWithTranslation | null | undefined} clip Clip a inspecter.
 * @returns {boolean} `true` si le clip est signale et non encore verifie.
 */
export function isClipPendingVerification(
	clip: ClipWithTranslation | null | undefined
): boolean {
	return !!clip && hasClipReviewIssue(clip) && clip.hasBeenVerified !== true;
}

/**
 * Marque un clip comme verifie s'il porte encore au moins un signal de revue.
 *
 * @param {ClipWithTranslation | null | undefined} clip Clip a mettre a jour.
 * @returns {void}
 */
export function markClipAsVerified(clip: ClipWithTranslation | null | undefined): void {
	if (!clip || !hasClipReviewIssue(clip)) return;
	clip.hasBeenVerified = true;
}

export class SubtitleClip extends ClipWithTranslation {
	surah: number;
	verse: number;
	startWordIndex: number;
	endWordIndex: number;
	indopakText: string;
	private isHydratingIndopakText = false;
	alignmentMetadata: SubtitleAlignmentMetadata | null = $state(null);
	wbwTranslation: string[]; // Traduction mot à mot
	isFullVerse: boolean; // Indique si ce clip contient l'intégralité du verset
	isLastWordsOfVerse: boolean; // Indique si ce clip contient les derniers mots du verset

	constructor(
		startTime: number,
		endTime: number,
		surah: number,
		verse: number,
		startWordIndex: number,
		endWordIndex: number,
		text: string,
		wbwTranslation: string[],
		isFullVerse: boolean,
		isLastWordsOfVerse: boolean,
		translations: { [key: string]: Translation } = {},
		indopakSegmentText?: string,
		comeFromIA: boolean = false,
		confidence: number | null = null
	) {
		super(text, startTime, endTime, 'Subtitle', translations, comeFromIA, confidence);
		this.surah = $state(surah);
		this.verse = $state(verse);
		this.startWordIndex = $state(startWordIndex);
		this.endWordIndex = $state(endWordIndex);
		this.indopakText = $state(indopakSegmentText ?? text);
		this.translations = translations;
		this.wbwTranslation = $state(wbwTranslation);
		this.isFullVerse = $state(isFullVerse);
		this.isLastWordsOfVerse = $state(isLastWordsOfVerse);
	}

	/**
	 * Invalide les métadonnées d'alignement quand le clip devient manuel.
	 */
	override markAsManualEdit() {
		super.markAsManualEdit();
		if (!this.alignmentMetadata) return;

		this.alignmentMetadata = null;
		const currentContext = globalState.getSubtitlesEditorState.segmentationContext;
		globalState.getSubtitlesEditorState.segmentationContext = {
			...currentContext,
			audioId: null,
			alignedSegments: []
		};
	}

	/**
	 * Retourne la clé du verset au format "Surah:Verse".
	 * @returns La clé du verset.
	 */
	getVerseKey(): string {
		return `${this.surah}:${this.verse}`;
	}

	getTextWithVerseNumber(text: string = this.text): string {
		if (this.isLastWordsOfVerse) {
			// if indopak is enabled
			if (globalState.getStyle('arabic', 'mushaf-style')?.value === 'Indopak')
				return `<span style="direction: rtl; unicode-bidi: isolate;">${text} <span style="font-family:Hafs;">${this.latinToArabicNumbers(this.verse)}</span></span>`;
			else return text + ` ${this.latinToArabicNumbers(this.verse)}`;
		}
		return text;
	}

	private latinToArabicNumbers(n: number): string {
		return n.toString().replace(/\d/g, (digit) => {
			const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
			return arabicDigits[parseInt(digit, 10)];
		});
	}

	/**
	 * Retourne les parties du texte arabe à afficher.
	 * - `editor`: toujours le texte Uthmani brut du segment
	 * - `preview`: respecte la police arabe active (QPC, Indopak, etc.)
	 *
	 * Le numéro de verset est renvoyé à part pour éviter de lui appliquer les styles inline.
	 */
	getArabicRenderParts(mode: 'editor' | 'preview' = 'editor'): ArabicRenderParts {
		const showVerseNumber =
			this.isLastWordsOfVerse && Boolean(globalState.getStyle('arabic', 'show-verse-number').value);

		if (mode === 'editor') {
			return {
				text: this.text,
				suffix: showVerseNumber ? ` ${this.latinToArabicNumbers(this.verse)}` : '',
				suffixFontFamily: null
			};
		}

		const fontFamily = globalState.getStyle('arabic', 'font-family')!;
		const mushafStyle = String(globalState.getStyle('arabic', 'mushaf-style')?.value ?? 'Uthmani');
		const shouldUseQpcGlyphs =
			mushafStyle === 'Tajweed' || fontFamily.value === 'QPC1' || fontFamily.value === 'QPC2';

		if (!shouldUseQpcGlyphs) {
			if (mushafStyle === 'Indopak' && !this.indopakText) {
				// L'éditeur peut demander un rendu preview avant que le texte IndoPak soit hydraté.
				void this.hydrateIndopakTextFromLocalQuran();
			}

			return {
				text: mushafStyle === 'Indopak' && this.indopakText ? this.indopakText : this.text,
				suffix: showVerseNumber ? ` ${this.latinToArabicNumbers(this.verse)}` : '',
				// En mode IndoPak, le numéro de verset reste rendu avec Hafs comme avant.
				suffixFontFamily: showVerseNumber && mushafStyle === 'Indopak' ? 'Hafs' : null
			};
		}

		const qpcVersion: '1' | '2' =
			mushafStyle === 'Tajweed' ? '2' : fontFamily.value === 'QPC1' ? '1' : '2';

		return {
			text: QPCFontProvider.getQuranVerseGlyph(
				this.surah,
				this.verse,
				this.startWordIndex,
				this.endWordIndex,
				false,
				qpcVersion
			),
			suffix: showVerseNumber
				? ` ${QPCFontProvider.getQuranVerseGlyph(
						this.surah,
						this.verse,
						this.endWordIndex + 1,
						this.endWordIndex,
						true,
						qpcVersion
					)}`.trimEnd()
				: '',
			suffixFontFamily: null
		};
	}

	private async hydrateIndopakTextFromLocalQuran() {
		if (this.isHydratingIndopakText || this.indopakText) return;
		this.isHydratingIndopakText = true;

		try {
			const verse = await Quran.getVerse(this.surah, this.verse);
			if (!verse) return;

			this.indopakText = verse.getArabicTextBetweenTwoIndexes(
				this.startWordIndex,
				this.endWordIndex,
				'indopak'
			);
			globalState.updateVideoPreviewUI();
		} catch {
			// Keep silent: fallback text remains available.
		} finally {
			this.isHydratingIndopakText = false;
		}
	}

	override getText(): string {
		// En fonction de la police d'écriture, renvoie le bon texte
		const fontFamily = globalState.getStyle('arabic', 'font-family')!;
		const mushafStyle = String(globalState.getStyle('arabic', 'mushaf-style')?.value ?? 'Uthmani');

		// Les polices QPC1, QPC2 et Tajweed utilisent des glyphes. Tajweed utilise les glyphes de QPC2.
		const shouldUseQpcGlyphs =
			mushafStyle === 'Tajweed' || fontFamily.value === 'QPC1' || fontFamily.value === 'QPC2';

		if (!shouldUseQpcGlyphs) {
			if (mushafStyle === 'Indopak' && !this.indopakText) {
				void this.hydrateIndopakTextFromLocalQuran();
			}

			const baseText = mushafStyle === 'Indopak' && this.indopakText ? this.indopakText : this.text;

			if (globalState.getStyle('arabic', 'show-verse-number').value)
				return this.getTextWithVerseNumber(baseText);
			else return baseText;
		}

		// Tajweed utilise les glyphes de QPC2
		const qpcVersion: '1' | '2' =
			mushafStyle === 'Tajweed' ? '2' : fontFamily.value === 'QPC1' ? '1' : '2';

		return QPCFontProvider.getQuranVerseGlyph(
			this.surah,
			this.verse,
			this.startWordIndex,
			this.endWordIndex,
			this.isLastWordsOfVerse,
			qpcVersion
		);
	}

	override setEndTime(newEndTime: number) {
		super.setEndTime(newEndTime);
		// Si la modification a bien été prise en compte (pas d'erreur dans le super)
		if (this.endTime === newEndTime) {
			this.markAsManualEdit();
		}
	}

	override setStartTime(newStartTime: number) {
		super.setStartTime(newStartTime);
		// Si la modification a bien été prise en compte (pas d'erreur dans le super)
		if (this.startTime === newStartTime) {
			this.markAsManualEdit();
		}
	}

	// Utilise pour les ajustements automatiques qui ne doivent pas annuler l'origine IA.
	setStartTimeSilently(newStartTime: number) {
		super.setStartTime(newStartTime);
	}

	// Utilise pour les ajustements automatiques qui ne doivent pas annuler l'origine IA.
	setEndTimeSilently(newEndTime: number) {
		super.setEndTime(newEndTime);
	}

	/**
	 * Crée un clone du clip avec de nouveaux timestamps.
	 * @param newStartTime Le nouveau temps de début.
	 * @param newEndTime Le nouveau temps de fin.
	 * @returns Un nouveau SubtitleClip avec les mêmes propriétés mais des timestamps différents.
	 */
	cloneWithTimes(newStartTime: number, newEndTime: number): SubtitleClip {
		const clonedClip = new SubtitleClip(
			newStartTime,
			newEndTime,
			this.surah,
			this.verse,
			this.startWordIndex,
			this.endWordIndex,
			this.text,
			JSON.parse(JSON.stringify(this.wbwTranslation)),
			this.isFullVerse,
			this.isLastWordsOfVerse,
			Object.fromEntries(
				Object.entries(this.translations).map(([key, t]) => [
					key,
					typeof t.clone === 'function' ? t.clone() : JSON.parse(JSON.stringify(t))
				])
			)
		);

		clonedClip.indopakText = this.indopakText;
		clonedClip.arabicInlineStyleRuns = JSON.parse(JSON.stringify(this.arabicInlineStyleRuns ?? []));
		clonedClip.associatedImagePath = this.associatedImagePath;
		clonedClip.needsLongReview = this.needsLongReview;
		clonedClip.needsReview = this.needsReview;
		clonedClip.needsCoverageReview = this.needsCoverageReview;
		clonedClip.hasBeenVerified = this.hasBeenVerified;
		clonedClip.comeFromIA = this.comeFromIA;
		clonedClip.confidence = this.confidence;
		clonedClip.alignmentMetadata = this.alignmentMetadata
			? JSON.parse(JSON.stringify(this.alignmentMetadata))
			: null;
		return clonedClip;
	}
}

export class SilenceClip extends Clip {
	constructor(startTime: number, endTime: number) {
		super(startTime, endTime, 'Silence');
	}
}

export type PredefinedSubtitleType =
	| 'Basmala'
	| "Isti'adha"
	| 'Amin'
	| 'Takbir'
	| 'Tahmeed'
	| 'Tasleem'
	| 'Sadaqa'
	| 'Other';

const PREDEFINED_ARABIC_TEXT: Record<PredefinedSubtitleType, string> = {
	Basmala: 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيم',
	"Isti'adha": 'أَعُوذُ بِٱللَّهِ مِنَ الشَّيْطَانِ الرَّجِيم',
	Amin: 'آمِين',
	Takbir: 'اللَّهُ أَكْبَر',
	Tahmeed: 'سَمِعَ اللَّهُ لِمَنْ حَمِدَه',
	Tasleem: 'ٱلسَّلَامُ عَلَيْكُمْ وَرَحْمَةُ ٱللَّه',
	Sadaqa: 'صَدَقَ ٱللَّهُ ٱلْعَظِيم',
	Other: ''
};

export function canonicalizePredefinedSubtitleType(
	type?: string
): PredefinedSubtitleType | 'Other' {
	switch (type) {
		case 'Basmala':
			return 'Basmala';
		case "Isti'adha":
		case 'Istiadhah':
			return "Isti'adha";
		case 'Amin':
			return 'Amin';
		case 'Takbir':
			return 'Takbir';
		case 'Tahmeed':
			return 'Tahmeed';
		case 'Tasleem':
			return 'Tasleem';
		case 'Sadaqa':
		case 'Sadaqallahul Azim':
			return 'Sadaqa';
		default:
			return 'Other';
	}
}

export function getPredefinedArabicText(type: PredefinedSubtitleType | 'Other'): string {
	return PREDEFINED_ARABIC_TEXT[type] ?? '';
}

/**
 * Force certaines polices pour les sous-titres prédéfinis
 *
 * Règle:
 * - Si on a QPC1 ou QPC2 alors on force Hafs pour les sous-titres prédéfinis non-supporté par ces polices
 * - Si la police supporte un texte pré-défini comme le sadaqa, alors on force la police correspondante
 * - Si la police est une police personnalisée, alors on ne force aucune police
 *
 * @param type Le type de sous-titre prédéfini
 * @returns La police à utiliser ou null si aucune police n'est forcée
 */
export function getForcedFontForPredefinedSubtitle(
	type?: string,
	currentArabicFontFamily?: string
): string | null {
	const canonicalType = canonicalizePredefinedSubtitleType(type);

	const activeFontFamily =
		currentArabicFontFamily ?? String(globalState.getStyle('arabic', 'font-family')?.value ?? '');

	const isQpcFont = activeFontFamily === 'QPC1' || activeFontFamily === 'QPC2';

	// Sadaqa a un glyph spécifique en QPC2
	if (canonicalType === 'Sadaqa') return isQpcFont ? 'QPC2BSML' : null;

	// Toutes les autres polices ont Hafs si on est en QPC1 ou QPC2
	const shouldForceHafs = isQpcFont;

	if (
		shouldForceHafs &&
		(canonicalType === 'Amin' ||
			canonicalType === 'Takbir' ||
			canonicalType === 'Tahmeed' ||
			canonicalType === 'Tasleem')
	) {
		return 'Hafs';
	}
	return null;
}

export class PredefinedSubtitleClip extends ClipWithTranslation {
	predefinedSubtitleType: PredefinedSubtitleType = $state('Other');

	constructor(
		startTime: number = 0,
		endTime: number = 0,
		type: PredefinedSubtitleType = 'Other',
		text: string = '',
		comeFromIA: boolean = false,
		confidence: number | null = null
	) {
		const isDeserializationCall = arguments.length === 0;
		const canonicalType = canonicalizePredefinedSubtitleType(type);
		const _text = canonicalType === 'Other' ? text : getPredefinedArabicText(canonicalType);

		// Ajoute les traductions du clip
		const translations: { [key: string]: Translation } = {};

		// Recupere les traductions ajoutees au projet
		if (!isDeserializationCall && globalState.currentProject)
			for (const edition of globalState.getProjectTranslation.addedTranslationEditions) {
				translations[edition.name] =
					globalState.getProjectTranslation.getPredefinedSubtitleTranslation(
						edition,
						canonicalType
					);
			}

		super(_text, startTime, endTime, 'Pre-defined Subtitle', translations, comeFromIA, confidence);

		this.predefinedSubtitleType = canonicalType;
	}

	private getCanonicalType(): PredefinedSubtitleType {
		const canonicalType = canonicalizePredefinedSubtitleType(this.predefinedSubtitleType);
		if (this.predefinedSubtitleType !== canonicalType) {
			this.predefinedSubtitleType = canonicalType;
		}
		return canonicalType;
	}

	/**
	 * Retourne le texte du clip en fonction de la police d'ecriture
	 * @returns Le texte du clip
	 */
	override getText(): string {
		const canonicalType = this.getCanonicalType();

		// En fonction de la police d'ecriture, renvoie le bon texte
		const fontFamily = globalState.getStyle('arabic', 'font-family')!;
		const qpcVersion = fontFamily.value === 'QPC1' ? '1' : fontFamily.value === 'QPC2' ? '2' : null;

		if (canonicalType === 'Sadaqa') {
			return qpcVersion ? QPCFontProvider.getSadaqaGlyph() : super.getText();
		}

		// Si on a pas une police avec les caracteres speciaux
		if (!qpcVersion) {
			return super.getText();
		}

		if (canonicalType === 'Basmala') return QPCFontProvider.getBasmalaGlyph(qpcVersion);
		if (canonicalType === "Isti'adha") return QPCFontProvider.getIstiadhahGlyph(qpcVersion);

		// Dans ce cas, on retourne le texte par defaut
		return super.getText();
	}
}

export class CustomClip extends Clip {
	category: Category | undefined = $state(undefined);

	constructor(startTime: number, endTime: number, type: 'text' | 'image', category?: Category) {
		super(startTime, endTime, 'Custom Text');
		this.type = type === 'text' ? 'Custom Text' : 'Custom Image';
		this.category = category;
	}

	setStyle(styleId: StyleName, value: string | number | boolean) {
		if (styleId === 'time-appearance') {
			if (typeof value === 'number') this.setStartTime(value);
		} else if (styleId === 'time-disappearance') {
			if (typeof value === 'number') this.setEndTime(value);
		}

		this.category!.styles.find((style) => style.id === styleId)!.value = value;
	}

	getAlwaysShow(): boolean {
		return this.category?.getStyle('always-show')!.value as boolean;
	}

	override getWidth(): number {
		const timelineZoom = globalState.currentProject?.projectEditorState.timeline.zoom ?? 0;
		// Si le custom text s'affiche sur toute la durée de la vidéo, alors retourne le temps
		// total de la vidéo
		if (this.getAlwaysShow()) {
			const longestTrackDuration =
				globalState.currentProject?.content.timeline.getLongestTrackDuration().toSeconds() ?? 0;
			return longestTrackDuration * timelineZoom;
		} else {
			// Appel du getWidth du parent
			return super.getWidth();
		}
	}
}

export class CustomTextClip extends CustomClip {
	constructor(category?: Category) {
		const startTime = (category?.getStyle('time-appearance')!.value as number) ?? 0;
		const endTime = (category?.getStyle('time-disappearance')!.value as number) ?? 0;

		super(startTime, endTime, 'text', category);
		this.category = category;
	}

	getText() {
		return this.category?.getStyle('text')!.value as string;
	}
}

export class CustomImageClip extends CustomClip {
	constructor(category?: Category) {
		const startTime = (category?.getStyle('time-appearance')!.value as number) ?? 0;
		const endTime = (category?.getStyle('time-disappearance')!.value as number) ?? 0;

		super(startTime, endTime, 'image', category);
		this.category = category;
	}

	getFilePath() {
		return this.category?.getStyle('filepath')!.value as string;
	}
}

SerializableBase.registerChildClass(SubtitleClip, 'translations', Translation);
SerializableBase.registerChildClass(ClipWithTranslation, 'translations', Translation);
SerializableBase.registerChildClass(CustomTextClip, 'translations', Translation);
