import { invoke } from '@tauri-apps/api/core';

import type { Edition, SubtitleClip } from '$lib/classes';
import {
	tokenizeTranslationText,
	type TranslationWbwRange,
	type VerseTranslation
} from '$lib/classes/Translation.svelte';
import { globalState } from '$lib/runes/main.svelte';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import {
	WbwTranslationService,
	type WbwTranslationLanguageCode
} from '$lib/services/WbwTranslationService';
import type {
	AdvancedTrimModel,
	AdvancedTrimReasoningEffort,
	AdvancedTrimUsage
} from './AdvancedAITrimming';
import type {
	AiWbwTranslationApplyReport,
	AiWbwTranslationBatch,
	AiWbwTranslationBatchResponse,
	AiWbwTranslationBatchResultSegment,
	AiWbwTranslationBatchSegmentPayload,
	AiWbwTranslationCandidate,
	AiWbwTranslationCostEstimate,
	AiWbwTranslationValidationReport,
	AiWbwTranslationValidationSuccess
} from './AiWbwTranslationMappingTypes';

// Re-export pour compatibilité ascendante
export type {
	AiWbwTranslationArabicWordPayload,
	AiWbwTranslationApplyReport,
	AiWbwTranslationBatch,
	AiWbwTranslationBatchResponse,
	AiWbwTranslationBatchResultSegment,
	AiWbwTranslationBatchSegmentPayload,
	AiWbwTranslationCandidate,
	AiWbwTranslationCostEstimate,
	AiWbwTranslationValidationReport,
	AiWbwTranslationValidationSuccess
} from './AiWbwTranslationMappingTypes';

const MAX_BATCH_WORDS = 500;
const APPROX_SYSTEM_PROMPT_CHARS = 5600;
const PUNCTUATION_ONLY_REGEX = /^[^\p{L}\p{N}\s]+$/u;

const MODEL_PRICING: Record<
	string,
	{
		inputPerMillionUsd: number;
		outputPerMillionUsd: number;
	}
> = {
	'gpt-5.4': {
		inputPerMillionUsd: 2.5,
		outputPerMillionUsd: 15
	},
	'gpt-5.4-mini': {
		inputPerMillionUsd: 0.75,
		outputPerMillionUsd: 4.5
	},
	'gpt-5.4-nano': {
		inputPerMillionUsd: 0.2,
		outputPerMillionUsd: 1.25
	}
};

/**
 * Convertit une taille approximative de prompt en tokens facturables.
 *
 * @param {number} charCount Nombre de caractères du prompt.
 * @returns {number} Estimation du nombre de tokens.
 */
function charsToTokens(charCount: number): number {
	return Math.max(1, Math.ceil(charCount / 4));
}

/**
 * Indique si deux plages temporelles se croisent.
 *
 * @param {number} leftStart Début de la première plage.
 * @param {number} leftEnd Fin de la première plage.
 * @param {number} rightStart Début de la seconde plage.
 * @param {number} rightEnd Fin de la seconde plage.
 * @returns {boolean} `true` si les plages se chevauchent.
 */
function rangesOverlap(
	leftStart: number,
	leftEnd: number,
	rightStart: number,
	rightEnd: number
): boolean {
	return leftStart <= rightEnd && rightStart <= leftEnd;
}

/**
 * Retourne les unités sélectionnables utilisées par l'IA et par les ranges.
 *
 * @param {string} text Texte de traduction rogné.
 * @returns {string[]} Unités indexées de traduction.
 */
function getSelectableTranslationUnits(text: string): string[] {
	return tokenizeTranslationText(text)
		.filter((token): token is { text: string; isWord: true; wordIndex: number } =>
			Boolean(token.isWord && token.wordIndex !== null)
		)
		.map((token) => token.text);
}

/**
 * Indique si une unité est uniquement composée de ponctuation.
 *
 * @param {string} unit Unité de traduction.
 * @returns {boolean} `true` pour une ponctuation isolée.
 */
function isPunctuationOnlyUnit(unit: string): boolean {
	return PUNCTUATION_ONLY_REGEX.test(unit.trim());
}

/**
 * Étend un range IA vers les ponctuations isolées qui suivent.
 *
 * @param {TranslationWbwRange} range Range validée.
 * @param {string[]} translationUnits Unités de traduction indexées.
 * @returns {TranslationWbwRange} Range avec ponctuation suivante incluse.
 */
function includeFollowingPunctuation(
	range: TranslationWbwRange,
	translationUnits: string[]
): TranslationWbwRange {
	let endUnitIndex = range.endUnitIndex;

	while (
		endUnitIndex < translationUnits.length - 1 &&
		isPunctuationOnlyUnit(translationUnits[endUnitIndex + 1])
	) {
		endUnitIndex++;
	}

	return {
		...range,
		endUnitIndex
	};
}

/**
 * Construit la traduction indexée envoyée à l'IA.
 *
 * @param {string} text Texte de traduction rogné.
 * @returns {string} Texte au format `0:mot 1:mot`.
 */
export function buildIndexedWbwTranslationText(text: string): string {
	return getSelectableTranslationUnits(text)
		.map((unit, index) => `${index}:${unit}`)
		.join(' ');
}

/**
 * Construit le payload minimal envoyé au backend pour un batch.
 *
 * @param {AiWbwTranslationCandidate[]} segments Segments candidats.
 * @returns {AiWbwTranslationBatch['request']} Payload sérialisable.
 */
function buildRequestPayload(
	segments: AiWbwTranslationCandidate[]
): AiWbwTranslationBatch['request'] {
	return {
		segments: segments.map((segment) => ({
			segmentIndex: segment.segmentIndex,
			verseKey: segment.verseKey,
			segmentArabic: segment.segmentArabic,
			arabicWords: segment.arabicWords,
			translationIndexed: segment.translationIndexed
		}))
	};
}

/**
 * Estime le coût d'un batch WBW translation.
 *
 * @param {AdvancedTrimModel} model Modèle IA utilisé.
 * @param {AdvancedTrimReasoningEffort} reasoningEffort Niveau de raisonnement.
 * @param {AiWbwTranslationBatch['request']} requestPayload Payload du batch.
 * @returns {Pick<AiWbwTranslationBatch, 'estimatedInputTokens' | 'estimatedOutputTokens' | 'estimatedCostUsd'>} Estimation.
 */
function estimateBatchCost(
	model: AdvancedTrimModel,
	reasoningEffort: AdvancedTrimReasoningEffort,
	requestPayload: AiWbwTranslationBatch['request']
): Pick<
	AiWbwTranslationBatch,
	'estimatedInputTokens' | 'estimatedOutputTokens' | 'estimatedCostUsd'
> {
	const serializedInput = JSON.stringify(requestPayload);
	const serializedOutputCharBudget =
		requestPayload.segments.reduce((total, segment) => {
			return total + Math.max(96, segment.arabicWords.length * 112 + 64);
		}, 48) + 48;

	const estimatedInputTokens = charsToTokens(APPROX_SYSTEM_PROMPT_CHARS + serializedInput.length);
	const estimatedOutputTokens = charsToTokens(serializedOutputCharBudget);
	const pricing = MODEL_PRICING[model];
	const reasoningMultiplier =
		reasoningEffort === 'high'
			? 1.5
			: reasoningEffort === 'medium'
				? 1.25
				: reasoningEffort === 'low'
					? 1.1
					: 1;
	const estimatedCostUsd = pricing
		? ((estimatedInputTokens / 1_000_000) * pricing.inputPerMillionUsd +
				(estimatedOutputTokens / 1_000_000) * pricing.outputPerMillionUsd) *
			reasoningMultiplier
		: 0;

	return {
		estimatedInputTokens,
		estimatedOutputTokens,
		estimatedCostUsd
	};
}

/**
 * Construit les segments éligibles au mapping WBW translation IA.
 *
 * @param {Edition} edition Édition de traduction ciblée.
 * @param {WbwTranslationLanguageCode} helperLanguage Langue du helper WBW.
 * @returns {Promise<AiWbwTranslationCandidate[]>} Segments utilisables par l'IA.
 */
export async function buildAiWbwTranslationCandidates(
	edition: Edition,
	helperLanguage: WbwTranslationLanguageCode
): Promise<AiWbwTranslationCandidate[]> {
	const candidates = await Promise.all(
		globalState.getSubtitleClips.map(async (subtitle, segmentIndex) => {
			const translation = subtitle.translations[edition.name] as VerseTranslation | undefined;
			const translationText = String(translation?.text ?? '').trim();
			if (!translation || translationText.length === 0) return null;

			const translationUnits = getSelectableTranslationUnits(translationText);
			const wordCount = translationUnits.length;
			if (wordCount <= 0) return null;

			const arabicWords = subtitle.getArabicRenderParts().text.split(' ').filter(Boolean);
			if (arabicWords.length === 0) return null;

			const helperWords = await WbwTranslationService.getWordsForRange(
				helperLanguage,
				subtitle.surah,
				subtitle.verse,
				subtitle.startWordIndex,
				subtitle.endWordIndex
			).catch(() => []);

			return {
				segmentIndex,
				verseKey: subtitle.getVerseKey(),
				startTime: subtitle.startTime,
				endTime: subtitle.endTime,
				segmentArabic: subtitle.text,
				arabicWords: arabicWords.map((arabic, index) => ({
					index,
					arabic,
					helper: helperWords[index] ?? ''
				})),
				translationText,
				translationIndexed: buildIndexedWbwTranslationText(translationText),
				translationUnits,
				wordCount,
				arabicWordCount: arabicWords.length,
				subtitle
			} satisfies AiWbwTranslationCandidate;
		})
	);

	return candidates.filter((candidate): candidate is AiWbwTranslationCandidate =>
		Boolean(candidate)
	);
}

/**
 * Groupe les candidats WBW translation dans des batches temporels.
 *
 * @param {AiWbwTranslationCandidate[]} candidates Candidats disponibles.
 * @param {AdvancedTrimModel} model Modèle IA utilisé.
 * @param {AdvancedTrimReasoningEffort} reasoningEffort Niveau de raisonnement.
 * @param {number} startTimeMs Début de la plage traitée.
 * @param {number} endTimeMs Fin de la plage traitée.
 * @returns {AiWbwTranslationBatch[]} Batches prêts à envoyer.
 */
export function buildAiWbwTranslationBatches(
	candidates: AiWbwTranslationCandidate[],
	model: AdvancedTrimModel,
	reasoningEffort: AdvancedTrimReasoningEffort,
	startTimeMs: number,
	endTimeMs: number
): AiWbwTranslationBatch[] {
	if (candidates.length === 0) return [];

	const selected = candidates.filter((candidate) =>
		rangesOverlap(candidate.startTime, candidate.endTime, startTimeMs, endTimeMs)
	);

	const batches: AiWbwTranslationBatch[] = [];
	let current: AiWbwTranslationCandidate[] = [];
	let currentWordCount = 0;

	/**
	 * Ajoute le batch courant à la liste, puis réinitialise l'accumulateur.
	 *
	 * @returns {void}
	 */
	function pushCurrentBatch(): void {
		if (current.length === 0) return;
		const request = buildRequestPayload(current);
		const estimated = estimateBatchCost(model, reasoningEffort, request);
		const batchNumber = batches.length + 1;
		batches.push({
			batchId: `advanced-wbw-translation-batch-${batchNumber}-${current[0].segmentIndex}`,
			wordCount: currentWordCount,
			segments: current,
			request,
			...estimated
		});
		current = [];
		currentWordCount = 0;
	}

	for (const candidate of selected) {
		const segmentWordCount = Math.max(candidate.wordCount + candidate.arabicWordCount, 1);
		const wouldOverflow =
			current.length > 0 && currentWordCount + segmentWordCount > MAX_BATCH_WORDS;

		if (wouldOverflow) {
			pushCurrentBatch();
		}

		current.push(candidate);
		currentWordCount += segmentWordCount;

		if (segmentWordCount > MAX_BATCH_WORDS) {
			pushCurrentBatch();
		}
	}

	pushCurrentBatch();

	return batches;
}

/**
 * Calcule le résumé de coût de plusieurs batches WBW translation.
 *
 * @param {AiWbwTranslationBatch[]} batches Batches générés.
 * @param {AdvancedTrimReasoningEffort} reasoningEffort Niveau de raisonnement.
 * @returns {AiWbwTranslationCostEstimate} Résumé de coût.
 */
export function estimateAiWbwTranslationCost(
	batches: AiWbwTranslationBatch[],
	reasoningEffort: AdvancedTrimReasoningEffort
): AiWbwTranslationCostEstimate {
	const totalSegments = batches.reduce((count, batch) => count + batch.segments.length, 0);
	const totalWords = batches.reduce((count, batch) => count + batch.wordCount, 0);
	const totalEstimatedInputTokens = batches.reduce(
		(total, batch) => total + batch.estimatedInputTokens,
		0
	);
	const totalEstimatedOutputTokens = batches.reduce(
		(total, batch) => total + batch.estimatedOutputTokens,
		0
	);
	const totalEstimatedCostUsd = batches.reduce((cost, batch) => cost + batch.estimatedCostUsd, 0);

	return {
		batches,
		totalSegments,
		totalWords,
		totalEstimatedInputTokens,
		totalEstimatedOutputTokens,
		totalEstimatedCostUsd,
		reasoningNote: batches.some((batch) => batch.estimatedCostUsd === 0)
			? 'Approximation based on prompt/output size only. Cost is unavailable for one or more custom models.'
			: reasoningEffort === 'none'
				? 'Approximation based on prompt/output size only.'
				: 'Approximation based on prompt/output size only. Actual cost may increase with reasoning effort.'
	};
}

/**
 * Normalise les ranges retournées par l'IA pour un segment.
 *
 * @param {unknown} value Valeur brute `ranges`.
 * @param {number} arabicWordCount Nombre de mots arabes attendus.
 * @param {string[]} translationUnits Unités de traduction.
 * @returns {{ ranges: TranslationWbwRange[]; error: string | null }} Ranges valides ou erreur.
 */
function normalizeAiRanges(
	value: unknown,
	arabicWordCount: number,
	translationUnits: string[]
): { ranges: TranslationWbwRange[]; error: string | null } {
	const translationUnitCount = translationUnits.length;
	if (!Array.isArray(value)) {
		return {
			ranges: [],
			error: 'ranges must be an array.'
		};
	}

	const mappedArabicIndexes = new Set<number>();
	const ranges: TranslationWbwRange[] = [];

	for (const rawRange of value) {
		if (!rawRange || typeof rawRange !== 'object') {
			return {
				ranges: [],
				error: 'ranges contains an invalid entry.'
			};
		}

		const record = rawRange as Record<string, unknown>;
		const arabicWordIndex = Number(record.arabicWordIndex);
		const startUnitIndex = Number(record.startUnitIndex);
		const endUnitIndex = Number(record.endUnitIndex);

		if (
			!Number.isInteger(arabicWordIndex) ||
			!Number.isInteger(startUnitIndex) ||
			!Number.isInteger(endUnitIndex)
		) {
			return {
				ranges: [],
				error: 'ranges must contain integer indexes only.'
			};
		}

		if (arabicWordIndex < 0 || arabicWordIndex >= arabicWordCount) {
			return {
				ranges: [],
				error: `ranges contains out-of-bounds arabicWordIndex ${arabicWordIndex}.`
			};
		}

		if (
			startUnitIndex < 0 ||
			endUnitIndex < 0 ||
			startUnitIndex >= translationUnitCount ||
			endUnitIndex >= translationUnitCount ||
			startUnitIndex > endUnitIndex
		) {
			return {
				ranges: [],
				error: `ranges contains invalid unit range ${startUnitIndex}-${endUnitIndex}.`
			};
		}

		mappedArabicIndexes.add(arabicWordIndex);
		ranges.push(
			includeFollowingPunctuation(
				{
					arabicWordIndex,
					startUnitIndex,
					endUnitIndex
				},
				translationUnits
			)
		);
	}

	for (let index = 0; index < arabicWordCount; index++) {
		if (!mappedArabicIndexes.has(index)) {
			return {
				ranges: [],
				error: `ranges is missing arabicWordIndex ${index}.`
			};
		}
	}

	return {
		ranges: ranges.sort(
			(left, right) =>
				left.arabicWordIndex - right.arabicWordIndex ||
				left.startUnitIndex - right.startUnitIndex ||
				left.endUnitIndex - right.endUnitIndex
		),
		error: null
	};
}

/**
 * Valide la réponse IA d'un batch WBW translation.
 *
 * @param {AiWbwTranslationBatch} batch Batch envoyé à l'IA.
 * @param {unknown} parsed Réponse JSON parsée.
 * @returns {AiWbwTranslationValidationReport} Segments valides et erreurs.
 */
export function validateAiWbwTranslationBatchResult(
	batch: AiWbwTranslationBatch,
	parsed: unknown
): AiWbwTranslationValidationReport {
	const errors: string[] = [];
	const validSegments: AiWbwTranslationValidationSuccess[] = [];

	if (!parsed || typeof parsed !== 'object') {
		return {
			validSegments,
			errors: ['AI response is not a JSON object.']
		};
	}

	const segmentsValue = (parsed as Record<string, unknown>).segments;
	if (!Array.isArray(segmentsValue)) {
		return {
			validSegments,
			errors: ['AI response is missing the "segments" array.']
		};
	}

	const responseMap = new Map<number, AiWbwTranslationBatchResultSegment>();
	for (const segmentValue of segmentsValue) {
		if (!segmentValue || typeof segmentValue !== 'object') {
			errors.push('AI response contains an invalid segment entry.');
			continue;
		}

		const segmentIndex = Number((segmentValue as Record<string, unknown>).segmentIndex);
		if (!Number.isInteger(segmentIndex)) {
			errors.push('AI response contains a segment without a valid segmentIndex.');
			continue;
		}

		if (responseMap.has(segmentIndex)) {
			errors.push(`Segment ${segmentIndex}: duplicate entry in AI response.`);
			continue;
		}

		const candidate = batch.segments.find((segment) => segment.segmentIndex === segmentIndex);
		if (!candidate) {
			errors.push(`Segment ${segmentIndex}: unexpected segment returned by AI.`);
			continue;
		}

		const normalized = normalizeAiRanges(
			(segmentValue as Record<string, unknown>).ranges,
			candidate.arabicWordCount,
			candidate.translationUnits
		);
		if (normalized.error) {
			errors.push(`Segment ${segmentIndex}: ${normalized.error}`);
			continue;
		}

		responseMap.set(segmentIndex, {
			segmentIndex,
			ranges: normalized.ranges
		});
	}

	for (const candidate of batch.segments) {
		const result = responseMap.get(candidate.segmentIndex);
		if (!result) {
			errors.push(`Segment ${candidate.segmentIndex}: missing from AI response.`);
			continue;
		}

		validSegments.push({
			candidate,
			ranges: result.ranges
		});
	}

	return {
		validSegments,
		errors
	};
}

/**
 * Applique les mappings WBW translation validés avec une entrée undo/redo.
 *
 * @param {Edition} edition Édition ciblée.
 * @param {AiWbwTranslationValidationSuccess[]} validSegments Segments validés.
 * @returns {AiWbwTranslationApplyReport} Résumé d'application.
 */
export function applyAiWbwTranslationValidationSuccess(
	edition: Edition,
	validSegments: AiWbwTranslationValidationSuccess[]
): AiWbwTranslationApplyReport {
	return ProjectHistoryManager.track('apply ai wbw translation mappings', () => {
		const errors: string[] = [];
		let appliedSegments = 0;
		let erroredSegments = 0;

		for (const success of validSegments) {
			const translation = success.candidate.subtitle.translations[edition.name] as
				| VerseTranslation
				| undefined;
			if (!translation) {
				errors.push(`Segment ${success.candidate.segmentIndex}: translation not found.`);
				erroredSegments++;
				continue;
			}

			try {
				translation.wbwRanges = success.ranges;
				appliedSegments++;
			} catch (error) {
				erroredSegments++;
				errors.push(
					`Segment ${success.candidate.segmentIndex}: ${
						error instanceof Error ? error.message : String(error)
					}`
				);
			}
		}

		return {
			appliedSegments,
			erroredSegments,
			errors
		};
	});
}

/**
 * Lance un batch IA streaming pour le mapping WBW translation.
 *
 * @param {{ apiKey: string; endpoint: string; model: AdvancedTrimModel; reasoningEffort: AdvancedTrimReasoningEffort; batchId: string; customPromptNote: string; batch: AiWbwTranslationBatch['request'] }} params Paramètres d'appel.
 * @returns {Promise<AiWbwTranslationBatchResponse>} Réponse IA.
 */
export async function runAiWbwTranslationBatchStreaming(params: {
	apiKey: string;
	endpoint: string;
	model: AdvancedTrimModel;
	reasoningEffort: AdvancedTrimReasoningEffort;
	batchId: string;
	customPromptNote: string;
	batch: AiWbwTranslationBatch['request'];
}): Promise<AiWbwTranslationBatchResponse> {
	const result = await invoke('run_advanced_ai_wbw_translation_batch_streaming', {
		request: {
			apiKey: params.apiKey,
			endpoint: params.endpoint,
			model: params.model,
			reasoningEffort: params.reasoningEffort,
			batchId: params.batchId,
			customPromptNote: params.customPromptNote,
			batch: params.batch
		}
	});

	return result as AiWbwTranslationBatchResponse;
}
