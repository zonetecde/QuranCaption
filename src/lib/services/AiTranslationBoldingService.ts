import { invoke } from '@tauri-apps/api/core';

import type { Edition, SubtitleClip } from '$lib/classes';
import {
	getTranslationWordCount,
	replaceBoldWordIndexesInInlineStyleRuns,
	tokenizeTranslationText,
	type TranslationInlineStyleRun,
	type VerseTranslation
} from '$lib/classes/Translation.svelte';
import { globalState } from '$lib/runes/main.svelte';
import type {
	AdvancedTrimModel,
	AdvancedTrimReasoningEffort,
	AdvancedTrimUsage
} from './AdvancedAITrimming';

export type AiBoldCandidate = {
	segmentIndex: number;
	verseKey: string;
	startTime: number;
	endTime: number;
	segmentArabic: string;
	translationText: string;
	translationIndexed: string;
	wordCount: number;
	hasExistingBold: boolean;
	subtitle: SubtitleClip;
};

export type AiBoldBatchSegmentPayload = {
	segmentIndex: number;
	verseKey: string;
	segmentArabic: string;
	translationIndexed: string;
};

export type AiBoldBatch = {
	batchId: string;
	wordCount: number;
	segments: AiBoldCandidate[];
	request: {
		segments: AiBoldBatchSegmentPayload[];
	};
	estimatedInputTokens: number;
	estimatedOutputTokens: number;
	estimatedCostUsd: number;
};

export type AiBoldBatchResponse = {
	batchId: string;
	rawText: string;
	parsed: unknown;
	usage?: AdvancedTrimUsage;
};

export type AiBoldBatchResultSegment = {
	segmentIndex: number;
	boldWordIndexes: number[];
};

export type AiBoldValidationSuccess = {
	candidate: AiBoldCandidate;
	boldWordIndexes: number[];
};

export type AiBoldValidationReport = {
	validSegments: AiBoldValidationSuccess[];
	errors: string[];
};

export type AiBoldApplyReport = {
	appliedSegments: number;
	erroredSegments: number;
	errors: string[];
};

export type AiBoldCostEstimate = {
	batches: AiBoldBatch[];
	totalSegments: number;
	totalWords: number;
	totalEstimatedInputTokens: number;
	totalEstimatedOutputTokens: number;
	totalEstimatedCostUsd: number;
	reasoningNote: string;
};

const MAX_BATCH_WORDS = 500;
const APPROX_SYSTEM_PROMPT_CHARS = 1400;

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

function charsToTokens(charCount: number): number {
	return Math.max(1, Math.ceil(charCount / 4));
}

function rangesOverlap(
	leftStart: number,
	leftEnd: number,
	rightStart: number,
	rightEnd: number
): boolean {
	return leftStart <= rightEnd && rightStart <= leftEnd;
}

function hasExistingInlineBold(runs: TranslationInlineStyleRun[] | undefined): boolean {
	return (runs ?? []).some((run) => run.bold);
}

export function buildIndexedTranslationText(text: string): string {
	const tokens = tokenizeTranslationText(text);
	return tokens
		.filter((token): token is { text: string; isWord: true; wordIndex: number } =>
			Boolean(token.isWord && token.wordIndex !== null)
		)
		.map((token) => `${token.wordIndex}:${token.text}`)
		.join(' ');
}

function buildRequestPayload(segments: AiBoldCandidate[]): AiBoldBatch['request'] {
	return {
		segments: segments.map((segment) => ({
			segmentIndex: segment.segmentIndex,
			verseKey: segment.verseKey,
			segmentArabic: segment.segmentArabic,
			translationIndexed: segment.translationIndexed
		}))
	};
}

function estimateBatchCost(
	model: AdvancedTrimModel,
	reasoningEffort: AdvancedTrimReasoningEffort,
	requestPayload: AiBoldBatch['request']
): Pick<AiBoldBatch, 'estimatedInputTokens' | 'estimatedOutputTokens' | 'estimatedCostUsd'> {
	const serializedInput = JSON.stringify(requestPayload);
	const serializedOutputCharBudget =
		requestPayload.segments.reduce((total, segment) => {
			const translationWordCount = segment.translationIndexed.split(/\s+/).filter(Boolean).length;
			return total + Math.max(32, translationWordCount * 5 + 48);
		}, 24) + 32;

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

export function buildAiBoldCandidates(
	edition: Edition,
	includeAlreadyBolded: boolean
): AiBoldCandidate[] {
	return globalState.getSubtitleClips
		.map((subtitle, segmentIndex) => {
			const translation = subtitle.translations[edition.name] as VerseTranslation | undefined;
			const translationText = String(translation?.text ?? '').trim();
			if (!translation || translationText.length === 0) return null;

			const wordCount = getTranslationWordCount(translationText);
			if (wordCount <= 0) return null;

			const hasBold = hasExistingInlineBold(translation.inlineStyleRuns);
			if (!includeAlreadyBolded && hasBold) return null;

			return {
				segmentIndex,
				verseKey: subtitle.getVerseKey(),
				startTime: subtitle.startTime,
				endTime: subtitle.endTime,
				segmentArabic: subtitle.text,
				translationText,
				translationIndexed: buildIndexedTranslationText(translationText),
				wordCount,
				hasExistingBold: hasBold,
				subtitle
			} satisfies AiBoldCandidate;
		})
		.filter((candidate): candidate is AiBoldCandidate => Boolean(candidate));
}

export function buildAiBoldBatches(
	candidates: AiBoldCandidate[],
	model: AdvancedTrimModel,
	reasoningEffort: AdvancedTrimReasoningEffort,
	startTimeMs: number,
	endTimeMs: number
): AiBoldBatch[] {
	if (candidates.length === 0) return [];

	const selected = candidates.filter((candidate) =>
		rangesOverlap(candidate.startTime, candidate.endTime, startTimeMs, endTimeMs)
	);

	const batches: AiBoldBatch[] = [];
	let current: AiBoldCandidate[] = [];
	let currentWordCount = 0;

	function pushCurrentBatch(): void {
		if (current.length === 0) return;
		const request = buildRequestPayload(current);
		const estimated = estimateBatchCost(model, reasoningEffort, request);
		const batchNumber = batches.length + 1;
		batches.push({
			batchId: `advanced-bold-batch-${batchNumber}-${current[0].segmentIndex}`,
			wordCount: currentWordCount,
			segments: current,
			request,
			...estimated
		});
		current = [];
		currentWordCount = 0;
	}

	for (const candidate of selected) {
		const segmentWordCount = Math.max(candidate.wordCount, 1);
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

export function estimateAiBoldCost(
	batches: AiBoldBatch[],
	reasoningEffort: AdvancedTrimReasoningEffort
): AiBoldCostEstimate {
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

function normalizeBoldWordIndexes(
	value: unknown,
	maxWordCount: number
): { indexes: number[]; error: string | null } {
	if (!Array.isArray(value)) {
		return {
			indexes: [],
			error: 'boldWordIndexes must be an array.'
		};
	}

	const uniqueIndexes = new Set<number>();
	for (const rawIndex of value) {
		const index = Number(rawIndex);
		if (!Number.isInteger(index)) {
			return {
				indexes: [],
				error: 'boldWordIndexes must contain integers only.'
			};
		}
		if (index < 0 || index >= maxWordCount) {
			return {
				indexes: [],
				error: `boldWordIndexes contains out-of-bounds index ${index}.`
			};
		}
		uniqueIndexes.add(index);
	}

	return {
		indexes: [...uniqueIndexes].sort((left, right) => left - right),
		error: null
	};
}

export function validateAiBoldBatchResult(
	batch: AiBoldBatch,
	parsed: unknown
): AiBoldValidationReport {
	const errors: string[] = [];
	const validSegments: AiBoldValidationSuccess[] = [];

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

	const responseMap = new Map<number, AiBoldBatchResultSegment>();
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

		const normalized = normalizeBoldWordIndexes(
			(segmentValue as Record<string, unknown>).boldWordIndexes,
			candidate.wordCount
		);
		if (normalized.error) {
			errors.push(`Segment ${segmentIndex}: ${normalized.error}`);
			continue;
		}

		responseMap.set(segmentIndex, {
			segmentIndex,
			boldWordIndexes: normalized.indexes
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
			boldWordIndexes: result.boldWordIndexes
		});
	}

	return {
		validSegments,
		errors
	};
}

export function applyAiBoldValidationSuccess(
	edition: Edition,
	validSegments: AiBoldValidationSuccess[]
): AiBoldApplyReport {
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
			translation.replaceBoldWordIndexes(success.boldWordIndexes);
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
}

export function previewAiBoldInlineRuns(
	currentRuns: TranslationInlineStyleRun[],
	text: string,
	boldWordIndexes: number[]
): TranslationInlineStyleRun[] {
	return replaceBoldWordIndexesInInlineStyleRuns(
		currentRuns,
		getTranslationWordCount(text),
		boldWordIndexes
	);
}

export async function runAiBoldBatchStreaming(params: {
	apiKey: string;
	endpoint: string;
	model: AdvancedTrimModel;
	reasoningEffort: AdvancedTrimReasoningEffort;
	batchId: string;
	customPromptNote: string;
	batch: AiBoldBatch['request'];
}): Promise<AiBoldBatchResponse> {
	const result = await invoke('run_advanced_ai_bold_batch_streaming', {
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

	return result as AiBoldBatchResponse;
}
