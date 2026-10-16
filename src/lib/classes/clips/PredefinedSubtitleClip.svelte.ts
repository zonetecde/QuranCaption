import { ClipWithTranslation } from './ClipWithTranslation.svelte';
import type { Translation } from '../Translation.svelte';
import { globalState } from '$lib/runes/main.svelte';
import QPCFontProvider from '$lib/services/FontProvider';

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
					globalState.getProjectTranslation.createTranslationForText(_text);
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
