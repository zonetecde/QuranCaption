import { globalState } from '$lib/runes/main.svelte';
import toast from 'svelte-5-french-toast';
import { Edition, TrackType, Translation } from '.';
import type { Asset } from './Asset.svelte';
import { SerializableBase } from './misc/SerializableBase';
import { Utilities } from './misc/Utilities';
import type { Track } from './Track.svelte';
import { PredefinedSubtitleTranslation, type VerseTranslation } from './Translation.svelte';
import type { Category, StyleName, TextStyleName } from './VideoStyle.svelte';
import QPCFontProvider from '$lib/services/FontProvider';

type ClipType =
	| 'Silence'
	| 'Pre-defined Subtitle'
	| 'Subtitle'
	| 'Custom Text'
	| 'Custom Image'
	| 'Asset';

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
		if (this.duration === 0) {
			// C'est dans le cas où l'asset est une image. C'est alors l'image de fond de la vidéo.
			// Elle prend la taille de la timeline.
			return (
				globalState.currentProject!.content.timeline.getLongestTrackDuration().toSeconds() *
				globalState.currentProject?.projectEditorState.timeline.zoom!
			);
		}

		return (this.duration / 1000) * globalState.currentProject?.projectEditorState.timeline.zoom!;
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

	constructor(startTime: number, endTime: number, assetId: number) {
		super(startTime, endTime, 'Asset');
		this.assetId = assetId;
	}
}

export class ClipWithTranslation extends Clip {
	translations: { [key: string]: Translation } = $state({});
	text: string = $state('');
	associatedImagePath: string | null = $state(null);
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

export class SubtitleClip extends ClipWithTranslation {
	surah: number;
	verse: number;
	startWordIndex: number;
	endWordIndex: number;
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
		comeFromIA: boolean = false,
		confidence: number | null = null
	) {
		super(text, startTime, endTime, 'Subtitle', translations, comeFromIA, confidence);
		this.surah = $state(surah);
		this.verse = $state(verse);
		this.startWordIndex = $state(startWordIndex);
		this.endWordIndex = $state(endWordIndex);
		this.translations = translations;
		this.wbwTranslation = $state(wbwTranslation);
		this.isFullVerse = $state(isFullVerse);
		this.isLastWordsOfVerse = $state(isLastWordsOfVerse);
	}

	/**
	 * Retourne la clé du verset au format "Surah:Verse".
	 * @returns La clé du verset.
	 */
	getVerseKey(): string {
		return `${this.surah}:${this.verse}`;
	}

	getTextWithVerseNumber(): string {
		if (this.isLastWordsOfVerse) {
			return this.text + ` ${this.latinToArabicNumbers(this.verse)}`;
		}
		return this.text;
	}

	private latinToArabicNumbers(n: number): string {
		return n.toString().replace(/\d/g, (digit) => {
			const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
			return arabicDigits[parseInt(digit, 10)];
		});
	}

	override getText(): string {
		// En fonction de la police d'écriture, renvoie le bon texte
		// Si on a pas la police QCP2
		const fontFamily = globalState.getStyle('arabic', 'font-family')!;

		// Si ce n'est pas une police avec des caractères spéciaux (QPC1 et QPC2)
		if (fontFamily.value !== 'QPC1' && fontFamily.value !== 'QPC2') {
			// Regarde dans les styles si on doit afficher le numéro de verset
			if (globalState.getStyle('arabic', 'show-verse-number').value)
				return this.getTextWithVerseNumber();
			else return this.text;
		} else {
			return QPCFontProvider.getQuranVerseGlyph(
				this.surah,
				this.verse,
				this.startWordIndex,
				this.endWordIndex,
				this.isLastWordsOfVerse,
				fontFamily.value === 'QPC1' ? '1' : '2'
			);
		}
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

		clonedClip.associatedImagePath = this.associatedImagePath;
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
		startTime: number,
		endTime: number,
		type: PredefinedSubtitleType,
		text?: string,
		comeFromIA: boolean = false,
		confidence: number | null = null
	) {
		const canonicalType = canonicalizePredefinedSubtitleType(type);
		const _text = canonicalType === 'Other' ? text || '' : getPredefinedArabicText(canonicalType);

		if (startTime === undefined) {
			// Deserialisation
			super(_text, 0, 0, 'Pre-defined Subtitle');
			return;
		}

		// Ajoute les traductions du clip
		const translations: { [key: string]: Translation } = {};

		// Recupere les traductions ajoutees au projet
		if (globalState.currentProject)
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

	constructor(startTime: number, endTime: number, type: 'text' | 'image', category: Category) {
		super(startTime, endTime, 'Custom Text');
		this.type = type === 'text' ? 'Custom Text' : 'Custom Image';
		this.category = category;
	}

	setStyle(styleId: StyleName, value: any) {
		if (styleId === 'time-appearance') {
			this.setStartTime(value);
		} else if (styleId === 'time-disappearance') {
			this.setEndTime(value);
		}

		this.category!.styles.find((style) => style.id === styleId)!.value = value;
	}

	getAlwaysShow(): boolean {
		return this.category?.getStyle('always-show')!.value as boolean;
	}

	override getWidth(): number {
		// Si le custom text s'affiche sur toute la durée de la vidéo, alors retourne le temps
		// total de la vidéo
		if (this.getAlwaysShow()) {
			return (
				globalState.currentProject!.content.timeline.getLongestTrackDuration().toSeconds() *
				globalState.currentProject?.projectEditorState.timeline.zoom!
			);
		} else {
			// Appel du getWidth du parent
			return super.getWidth();
		}
	}
}

export class CustomTextClip extends CustomClip {
	constructor(category: Category) {
		// Déserialization
		if (category === undefined) {
			super(0, 0, 'text', category);
			return;
		}

		const startTime = category.getStyle('time-appearance')!.value as number;
		const endTime = category.getStyle('time-disappearance')!.value as number;

		super(startTime, endTime, 'text', category);
		this.category = category;
	}

	getText() {
		return this.category?.getStyle('text')!.value as string;
	}
}

export class CustomImageClip extends CustomClip {
	constructor(category: Category) {
		// Déserialization
		if (category === undefined) {
			super(0, 0, 'image', category);
			return;
		}

		const startTime = category.getStyle('time-appearance')!.value as number;
		const endTime = category.getStyle('time-disappearance')!.value as number;

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

