import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import { SerializableBase } from '../misc/SerializableBase';
import { Clip, type ClipType } from './Clip.svelte';
import type { Edition } from '../Edition';
import {
	Translation,
	buildTranslationInlineTextSegments,
	getInlineStyleFlagsForWordIndex,
	getTranslationWordCount,
	toggleTranslationInlineStyleRuns,
	type TranslationInlineStyleFlags,
	type TranslationInlineStyleRun,
	type TranslationInlineTextSegment
} from '../Translation.svelte';

export type ArabicRenderParts = {
	sourceWordOffset?: number;
	text: string;
	words?: string[];
	sourceWordIndexes?: number[][];
	suffix: string;
	suffixFontFamily: string | null;
};

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
	needsWbwTimestampReview: boolean = $state(false); // Vrai si les timestamps WBW sont absents.

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
		// Le segment est marqué comme besoin de review uniquement lorsque la confiance IA est très faible.
		this.needsReview = comeFromIA && confidence !== null && confidence <= 0.4;
	}

	markAsManualEdit() {
		this.comeFromIA = false;
		this.confidence = null;
		this.needsReview = false; // Le segment n'a plus besoin de review de confiance
		this.needsCoverageReview = false; // Le segment n'a plus besoin de review de couverture
		this.needsLongReview = false;
		this.needsWbwTimestampReview = false;
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
	 * Les segments de transcription utilisent ce rendu texte générique.
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
		const parts = this.getArabicRenderParts(mode);
		if (parts.words && parts.sourceWordIndexes) {
			return parts.words.map((word, index) => {
				const flags = parts
					.sourceWordIndexes![index].map((sourceWordIndex) =>
						getInlineStyleFlagsForWordIndex(
							this.arabicInlineStyleRuns ?? [],
							sourceWordIndex - (parts.sourceWordOffset ?? 0)
						)
					)
					.reduce(
						(merged, sourceFlags) => ({
							bold: merged.bold || sourceFlags.bold,
							italic: merged.italic || sourceFlags.italic,
							underline: merged.underline || sourceFlags.underline,
							lineBreak: merged.lineBreak || sourceFlags.lineBreak,
							color: sourceFlags.color ?? merged.color,
							glow: sourceFlags.glow ?? merged.glow
						}),
						{
							bold: false,
							italic: false,
							underline: false,
							lineBreak: false,
							color: null,
							glow: null
						} as TranslationInlineStyleFlags
					);
				return { text: `${index > 0 ? ' ' : ''}${word}`, ...flags };
			});
		}
		return buildTranslationInlineTextSegments(parts.text, this.arabicInlineStyleRuns ?? []);
	}

	getAssociatedImagePath(): string | null {
		return this.associatedImagePath;
	}

	hasAssociatedImage(): boolean {
		return !!this.associatedImagePath;
	}

	setAssociatedImagePath(path: string | null): void {
		ProjectHistoryManager.track('set linked image', () => {
			this.associatedImagePath = path;
		});
	}
}

export type ReviewIssueCategory = 'coverage' | 'wbw-timestamps' | 'long' | 'low-confidence';

/**
 * Retourne `true` si le clip porte au moins un indicateur de revue actif.
 *
 * @param {ClipWithTranslation | null | undefined} clip Clip a inspecter.
 * @returns {boolean} `true` si le clip doit etre considere comme reviewable.
 */
export function hasClipReviewIssue(clip: ClipWithTranslation | null | undefined): boolean {
	return (
		!!clip &&
		(clip.needsCoverageReview ||
			clip.needsWbwTimestampReview ||
			clip.needsLongReview ||
			clip.needsReview)
	);
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
	if (clip.needsReview) return 'low-confidence';
	if (clip.needsLongReview) return 'long';
	if (clip.needsWbwTimestampReview) return 'wbw-timestamps';
	return null;
}

/**
 * Retourne `true` si le clip a encore besoin d'une verification explicite.
 *
 * @param {ClipWithTranslation | null | undefined} clip Clip a inspecter.
 * @returns {boolean} `true` si le clip est signale et non encore verifie.
 */
export function isClipPendingVerification(clip: ClipWithTranslation | null | undefined): boolean {
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

SerializableBase.registerChildClass(ClipWithTranslation, 'translations', Translation);
