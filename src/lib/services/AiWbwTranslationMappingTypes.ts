import type { SubtitleClip } from '$lib/classes';
import type { TranslationWbwRange } from '$lib/classes/Translation.svelte';
import type { AdvancedTrimUsage } from './AdvancedAITrimming';

/** Mot arabe envoyé à l'IA pour mapping WBW. */
export type AiWbwTranslationArabicWordPayload = {
	index: number;
	arabic: string;
	helper: string;
};

/** Segment candidat au mapping WBW traduction par IA. */
export type AiWbwTranslationCandidate = {
	segmentIndex: number;
	verseKey: string;
	startTime: number;
	endTime: number;
	segmentArabic: string;
	arabicWords: AiWbwTranslationArabicWordPayload[];
	translationText: string;
	translationIndexed: string;
	translationUnits: string[];
	wordCount: number;
	arabicWordCount: number;
	subtitle: SubtitleClip;
};

/** Payload minimal d'un segment envoyé au backend IA. */
export type AiWbwTranslationBatchSegmentPayload = {
	segmentIndex: number;
	verseKey: string;
	segmentArabic: string;
	arabicWords: AiWbwTranslationArabicWordPayload[];
	translationIndexed: string;
};

/** Batch complet prêt à être envoyé au backend IA. */
export type AiWbwTranslationBatch = {
	batchId: string;
	wordCount: number;
	segments: AiWbwTranslationCandidate[];
	request: {
		segments: AiWbwTranslationBatchSegmentPayload[];
	};
	estimatedInputTokens: number;
	estimatedOutputTokens: number;
	estimatedCostUsd: number;
};

/** Réponse brute d'un batch WBW traduction. */
export type AiWbwTranslationBatchResponse = {
	batchId: string;
	rawText: string;
	parsed: unknown;
	usage?: AdvancedTrimUsage;
};

/** Segment résultat parsé depuis la réponse IA. */
export type AiWbwTranslationBatchResultSegment = {
	segmentIndex: number;
	ranges: TranslationWbwRange[];
};

/** Segment validé avec ses ranges prêtes à appliquer. */
export type AiWbwTranslationValidationSuccess = {
	candidate: AiWbwTranslationCandidate;
	ranges: TranslationWbwRange[];
};

/** Rapport de validation d'un batch IA. */
export type AiWbwTranslationValidationReport = {
	validSegments: AiWbwTranslationValidationSuccess[];
	errors: string[];
};

/** Rapport d'application des mappings WBW. */
export type AiWbwTranslationApplyReport = {
	appliedSegments: number;
	erroredSegments: number;
	errors: string[];
};

/** Estimation de coût pour l'ensemble des batches. */
export type AiWbwTranslationCostEstimate = {
	batches: AiWbwTranslationBatch[];
	totalSegments: number;
	totalWords: number;
	totalEstimatedInputTokens: number;
	totalEstimatedOutputTokens: number;
	totalEstimatedCostUsd: number;
	reasoningNote: string;
};

// ---------------------------------------------------------------------------
// Types d'événements Tauri pour le streaming WBW traduction
// ---------------------------------------------------------------------------

export type WbwTranslationStatusEventPayload = {
	batchId: string;
	step: string;
	message: string;
};

export type WbwTranslationChunkEventPayload = {
	batchId: string;
	delta: string;
	accumulatedText: string;
};

export type WbwTranslationCompleteEventPayload = {
	batchId: string;
	rawText: string;
	usage?: AdvancedTrimUsage;
};

// ---------------------------------------------------------------------------
// Types UI du modal
// ---------------------------------------------------------------------------

export type ActivityTone = 'info' | 'success' | 'error';

export type WbwTranslationActivityEntry = {
	id: string;
	batchId: string;
	step: string;
	message: string;
	tone: ActivityTone;
};
