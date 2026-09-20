import { globalState } from '$lib/runes/main.svelte';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';
import toast from 'svelte-5-french-toast';
import { Edition, Translation } from '.';
import {
	buildTranslationInlineTextSegments,
	getInlineStyleFlagsForWordIndex,
	getTranslationWordCount,
	type TranslationInlineStyleFlags,
	type TranslationInlineStyleRun,
	type TranslationInlineTextSegment,
	toggleTranslationInlineStyleRuns
} from './Translation.svelte';
import { SerializableBase } from './misc/SerializableBase';
import { Utilities } from './misc/Utilities';
import type { Track } from './Track.svelte';
import type { Category, Style, StyleName } from './VideoStyle.svelte';
import QPCFontProvider from '$lib/services/FontProvider';
import MinimalQuranProvider from '$lib/services/MinimalQuranProvider';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import {
	getTimedOverlayRangesFromStyles,
	syncTimedOverlayLegacyRange,
	updateTimedOverlayRange,
	getTimedOverlayRanges,
	type TimedOverlayRange
} from '$lib/services/TimedOverlayRanges';

type ClipType =
	| 'Silence'
	| 'Pre-defined Subtitle'
	| 'Subtitle'
	| 'Custom Text'
	| 'Custom Image'
	| 'Asset';

type ArabicRenderParts = {
	text: string;
	words?: string[];
	sourceWordIndexes?: number[][];
	suffix: string;
	suffixFontFamily: string | null;
};

export type TranscriptWordTiming = {
	word?: string;
	location?: string;
	start: number;
	end: number;
	confidence?: number;
};

export type TranscriptAlignmentMetadata = {
	source: 'api' | 'local' | 'import' | 'manual';
	segment?: number;
	refFrom?: string;
	refTo?: string;
	matchedText?: string;
	specialType?: string;
	timeFrom: number;
	timeTo: number;
	words: TranscriptWordTiming[];
};

/**
 * Normalise des timestamps mot par mot pour couvrir toute la durée du segment sans trou.
 * Le premier mot commence à 0, chaque mot reste affiché jusqu'au début réel du suivant,
 * et le dernier mot se termine exactement à la fin du segment.
 */
export function normalizeTranscriptWordTimings(
	words: TranscriptWordTiming[],
	clipDurationSeconds: number
): TranscriptWordTiming[] {
	const duration = Number.isFinite(clipDurationSeconds) ? Math.max(0, clipDurationSeconds) : 0;
	if (words.length === 0) return [];

	const sanitized = words.map((word) => {
		const rawStart = Number.isFinite(word.start) ? word.start : 0;
		const rawEnd = Number.isFinite(word.end) ? word.end : rawStart;
		const start = Math.max(0, Math.min(duration, rawStart));
		const end = Math.max(start, Math.min(duration, rawEnd));
		return { ...word, start, end };
	});

	let sharedBoundary = 0;
	return sanitized.map((word, index) => {
		const isLastWord = index === sanitized.length - 1;
		const nextWord = sanitized[index + 1];
		const boundaryCandidate = nextWord ? nextWord.start : duration;
		const end = isLastWord
			? duration
			: Math.max(sharedBoundary, Math.min(duration, boundaryCandidate));
		const normalized = { ...word, start: sharedBoundary, end };
		sharedBoundary = end;
		return normalized;
	});
}

export type VisualMergeMode = 'arabic' | 'translation' | 'both';

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
		if (this.duration === 0 && this.type === 'Asset') {
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
		ProjectHistoryManager.begin('set clip start');
		try {
			// Prévention pour pas que le clip est une durée négative
			if (this.endTime < newStartTime) {
				toast.error(get(LL).editor.clipLengthNegative());
				return;
			}

			this.startTime = newStartTime;
			this.duration = this.endTime - this.startTime;
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/**
	 * Met à jour l'heure de fin du clip et recalcule la durée.
	 * @param newEndTime La nouvelle heure de fin.
	 */
	setEndTime(newEndTime: number) {
		ProjectHistoryManager.begin('set clip end');
		try {
			// Prévention pour pas que le clip est une durée négative
			if (newEndTime < this.startTime) {
				toast.error(get(LL).editor.clipLengthNegative());
				return;
			}

			this.endTime = newEndTime;
			this.duration = this.endTime - this.startTime;
		} finally {
			ProjectHistoryManager.commit();
		}
	}
}

export class AssetClip extends Clip {
	assetId: number;
	loopUntilAudioEnd: boolean = $state(false);
	sourceStartTime: number = $state(0);
	volumePercent: number = $state(100);

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
							sourceWordIndex - (this instanceof SubtitleClip ? this.startWordIndex : 0)
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

export class SubtitleClip extends ClipWithTranslation {
	speaker: string = $state('Unknown speaker');
	// Métadonnées Qur'an conservées pour les projets existants et les outils WBW.
	surah: number = $state(0);
	verse: number = $state(0);
	startWordIndex: number = $state(0);
	endWordIndex: number = $state(0);
	indopakText: string = $state('');
	wbwTranslation: string[] = $state([]);
	isFullVerse: boolean = $state(false);
	isLastWordsOfVerse: boolean = $state(false);
	wbwTimestampsManuallyEdited: boolean = $state(false);
	alignmentMetadata: TranscriptAlignmentMetadata | null = $state(null);
	visualMergeGroupId: string | null = $state(null);
	visualMergeMode: VisualMergeMode | null = $state(null);

	constructor(
		startTime: number,
		endTime: number,
		text: string,
		speaker?: string,
		translations?: { [key: string]: Translation },
		comeFromIA?: boolean,
		confidence?: number | null,
		alignmentMetadata?: TranscriptAlignmentMetadata | null
	);
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
		translations?: { [key: string]: Translation },
		indopakText?: string,
		comeFromIA?: boolean,
		confidence?: number | null
	);
	constructor(startTime: number = 0, endTime: number = 0, ...args: unknown[]) {
		const isLegacyConstructor = typeof args[0] === 'number';
		const text = isLegacyConstructor ? String(args[4] ?? '') : String(args[0] ?? '');
		const translations = (isLegacyConstructor ? args[8] : args[2]) as
			| { [key: string]: Translation }
			| undefined;
		const initialTranslations =
			!isLegacyConstructor &&
			(!translations || Object.keys(translations).length === 0) &&
			globalState.currentProject
				? globalState.getProjectTranslation.createTranslationsForSubtitleText(text)
				: (translations ?? {});
		const comeFromIA = isLegacyConstructor
			? Boolean(typeof args[9] === 'boolean' ? args[9] : args[10])
			: Boolean(args[3]);
		const confidence = (
			isLegacyConstructor ? (typeof args[9] === 'boolean' ? args[10] : args[11]) : args[4]
		) as number | null | undefined;
		super(
			text,
			startTime,
			endTime,
			'Subtitle',
			initialTranslations,
			comeFromIA,
			confidence ?? null
		);

		if (isLegacyConstructor) {
			this.surah = Number(args[0]);
			this.verse = Number(args[1]);
			this.startWordIndex = Number(args[2]);
			this.endWordIndex = Number(args[3]);
			this.wbwTranslation = Array.isArray(args[5]) ? (args[5] as string[]) : [];
			this.isFullVerse = Boolean(args[6]);
			this.isLastWordsOfVerse = Boolean(args[7]);
			this.indopakText = typeof args[9] === 'string' ? args[9] : text;
		} else {
			this.speaker =
				typeof args[1] === 'string' && args[1].trim() ? args[1].trim() : 'Unknown speaker';
			this.alignmentMetadata = (args[5] as TranscriptAlignmentMetadata | null | undefined) ?? null;
		}
		if (this.alignmentMetadata) {
			this.alignmentMetadata = {
				...this.alignmentMetadata,
				words: normalizeTranscriptWordTimings(
					this.alignmentMetadata.words,
					Math.max(0, (endTime - startTime) / 1000)
				)
			};
		}
	}

	static override fromJSON<T extends SerializableBase>(
		this: any,
		data: Record<string, unknown>
	): T {
		const clip = super.fromJSON.call(this, data) as T;
		if (clip instanceof SubtitleClip && clip.alignmentMetadata) {
			clip.alignmentMetadata = {
				...clip.alignmentMetadata,
				timeFrom: clip.startTime / 1000,
				timeTo: clip.endTime / 1000,
				words: normalizeTranscriptWordTimings(
					clip.alignmentMetadata.words,
					Math.max(0, (clip.endTime - clip.startTime) / 1000)
				)
			};
		}
		return clip;
	}

	setVisualMerge(groupId: string, mode: VisualMergeMode): void {
		this.visualMergeGroupId = groupId;
		this.visualMergeMode = mode;
	}

	clearVisualMerge(): void {
		this.visualMergeGroupId = null;
		this.visualMergeMode = null;
	}

	isVisuallyMerged(): boolean {
		return !!this.visualMergeGroupId && !!this.visualMergeMode;
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

	private retimeAlignmentAfterStartChange(previousStartTime: number): void {
		if (!this.alignmentMetadata) return;

		const clipDurationSeconds = Math.max(0, (this.endTime - this.startTime) / 1000);
		const offsetSeconds = (previousStartTime - this.startTime) / 1000;
		const shiftedWords = this.alignmentMetadata.words.map((word, index) => ({
			...word,
			start: index === 0 ? 0 : word.start + offsetSeconds,
			end: word.end + offsetSeconds
		}));

		this.alignmentMetadata = {
			...this.alignmentMetadata,
			timeFrom: this.startTime / 1000,
			timeTo: this.endTime / 1000,
			words: normalizeTranscriptWordTimings(shiftedWords, clipDurationSeconds)
		};
	}

	private retimeAlignmentAfterEndChange(): void {
		if (!this.alignmentMetadata) return;

		const clipDurationSeconds = Math.max(0, (this.endTime - this.startTime) / 1000);
		this.alignmentMetadata = {
			...this.alignmentMetadata,
			timeFrom: this.startTime / 1000,
			timeTo: this.endTime / 1000,
			words: normalizeTranscriptWordTimings(this.alignmentMetadata.words, clipDurationSeconds)
		};
	}

	override setEndTime(newEndTime: number) {
		super.setEndTime(newEndTime);
		if (this.endTime === newEndTime) {
			this.retimeAlignmentAfterEndChange();
			super.markAsManualEdit();
		}
	}

	override setStartTime(newStartTime: number) {
		const previousStartTime = this.startTime;
		super.setStartTime(newStartTime);
		if (this.startTime === newStartTime) {
			this.retimeAlignmentAfterStartChange(previousStartTime);
			super.markAsManualEdit();
		}
	}

	setStartTimeSilently(newStartTime: number) {
		const previousStartTime = this.startTime;
		super.setStartTime(newStartTime);
		if (this.startTime === newStartTime) {
			this.retimeAlignmentAfterStartChange(previousStartTime);
		}
	}

	setEndTimeSilently(newEndTime: number) {
		super.setEndTime(newEndTime);
		if (this.endTime === newEndTime) {
			this.retimeAlignmentAfterEndChange();
		}
	}

	cloneWithTimes(newStartTime: number, newEndTime: number): SubtitleClip {
		const clonedClip = new SubtitleClip(
			newStartTime,
			newEndTime,
			this.text,
			this.speaker,
			Object.fromEntries(
				Object.entries(this.translations).map(([key, translation]) => [
					key,
					typeof translation.clone === 'function'
						? translation.clone()
						: JSON.parse(JSON.stringify(translation))
				])
			),
			this.comeFromIA,
			this.confidence,
			this.alignmentMetadata ? JSON.parse(JSON.stringify(this.alignmentMetadata)) : null
		);

		clonedClip.arabicInlineStyleRuns = JSON.parse(JSON.stringify(this.arabicInlineStyleRuns ?? []));
		clonedClip.associatedImagePath = this.associatedImagePath;
		clonedClip.needsLongReview = this.needsLongReview;
		clonedClip.needsReview = this.needsReview;
		clonedClip.needsCoverageReview = this.needsCoverageReview;
		clonedClip.needsWbwTimestampReview = this.needsWbwTimestampReview;
		clonedClip.hasBeenVerified = this.hasBeenVerified;
		clonedClip.surah = this.surah;
		clonedClip.verse = this.verse;
		clonedClip.startWordIndex = this.startWordIndex;
		clonedClip.endWordIndex = this.endWordIndex;
		clonedClip.indopakText = this.indopakText;
		clonedClip.wbwTranslation = [...this.wbwTranslation];
		clonedClip.isFullVerse = this.isFullVerse;
		clonedClip.isLastWordsOfVerse = this.isLastWordsOfVerse;
		clonedClip.wbwTimestampsManuallyEdited = this.wbwTimestampsManuallyEdited;
		clonedClip.visualMergeGroupId = this.visualMergeGroupId;
		clonedClip.visualMergeMode = this.visualMergeMode;
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

export class CustomClip extends Clip {
	category: Category | undefined = $state(undefined);

	constructor(startTime: number, endTime: number, type: 'text' | 'image', category?: Category) {
		super(startTime, endTime, 'Custom Text');
		this.type = type === 'text' ? 'Custom Text' : 'Custom Image';
		this.category = category;
	}

	/**
	 * Retourne les apparitions temporelles du contenu personnalisé.
	 * @param {boolean} [sort=true] Trie les plages par apparition.
	 * @returns {TimedOverlayRange[]} Plages temporelles normalisées.
	 */
	getTimedOverlayRanges(sort = true): TimedOverlayRange[] {
		return getTimedOverlayRangesFromStyles(this.category?.styles ?? [], sort);
	}

	/**
	 * Met à jour le début du clip et sa première plage d'apparition.
	 * @param {number} newStartTime Nouveau début en millisecondes.
	 * @returns {void}
	 */
	override setStartTime(newStartTime: number): void {
		ProjectHistoryManager.begin('set custom clip start');
		try {
			const rangesStyle = this.category?.getStyle('time-ranges');
			const ranges = rangesStyle ? this.getTimedOverlayRanges() : [];
			const nextRanges = rangesStyle
				? updateTimedOverlayRange(ranges, 0, 'startTime', newStartTime)
				: [];
			super.setStartTime(nextRanges[0]?.startTime ?? newStartTime);
			if (rangesStyle) {
				rangesStyle.value = nextRanges;
				syncTimedOverlayLegacyRange(this.category?.styles ?? [], nextRanges[0]);
			}
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/**
	 * Met à jour la fin du clip et sa première plage d'apparition.
	 * @param {number} newEndTime Nouvelle fin en millisecondes.
	 * @returns {void}
	 */
	override setEndTime(newEndTime: number): void {
		ProjectHistoryManager.begin('set custom clip end');
		try {
			const rangesStyle = this.category?.getStyle('time-ranges');
			const ranges = rangesStyle ? this.getTimedOverlayRanges() : [];
			const nextRanges = rangesStyle
				? updateTimedOverlayRange(ranges, 0, 'endTime', newEndTime)
				: [];
			super.setEndTime(nextRanges[0]?.endTime ?? newEndTime);
			if (rangesStyle) {
				rangesStyle.value = nextRanges;
				syncTimedOverlayLegacyRange(this.category?.styles ?? [], nextRanges[0]);
			}
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	setStyle(styleId: StyleName, value: Style['value']) {
		ProjectHistoryManager.begin('set custom clip style');
		try {
			if (styleId === 'time-ranges') {
				const ranges = getTimedOverlayRanges(value);
				const firstRange = ranges[0];
				if (firstRange) {
					this.startTime = firstRange.startTime;
					this.endTime = firstRange.endTime;
					this.duration = firstRange.endTime - firstRange.startTime;
					syncTimedOverlayLegacyRange(this.category!.styles, firstRange);
				}
				this.category!.styles.find((style) => style.id === styleId)!.value = ranges;
			} else if (styleId === 'time-appearance') {
				if (typeof value === 'number') this.setStartTime(value);
			} else if (styleId === 'time-disappearance') {
				if (typeof value === 'number') this.setEndTime(value);
			}

			if (styleId !== 'time-ranges') {
				this.category!.styles.find((style) => style.id === styleId)!.value = value;
			}
		} finally {
			ProjectHistoryManager.commit();
		}
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
		const firstRange = getTimedOverlayRangesFromStyles(category?.styles ?? [])[0];
		const startTime = firstRange?.startTime ?? 0;
		const endTime = firstRange?.endTime ?? 0;

		super(startTime, endTime, 'text', category);
		this.category = category;
	}

	getText() {
		return this.category?.getStyle('text')!.value as string;
	}
}

export class CustomImageClip extends CustomClip {
	constructor(category?: Category) {
		const firstRange = getTimedOverlayRangesFromStyles(category?.styles ?? [])[0];
		const startTime = firstRange?.startTime ?? 0;
		const endTime = firstRange?.endTime ?? 0;

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
