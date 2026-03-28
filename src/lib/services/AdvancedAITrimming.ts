import { invoke } from '@tauri-apps/api/core';

import type { Edition, SubtitleClip } from '$lib/classes';
import type { VerseTranslation } from '$lib/classes/Translation.svelte';
import { globalState } from '$lib/runes/main.svelte';

export type AdvancedTrimModel = 'gpt-5.4' | 'gpt-5.4-mini' | 'gpt-5.4-nano';
export type AdvancedTrimReasoningEffort = 'none' | 'low' | 'medium' | 'high';

export type AdvancedTrimSegment = {
	i: number;
	arabic: string;
	wordByWordEnglish: string[];
	subtitle: SubtitleClip;
};

export type AdvancedTrimVerseCandidate = {
	index: number;
	verseKey: string;
	startTime: number;
	endTime: number;
	subtitles: SubtitleClip[];
	sourceTranslation: string;
	wordCount: number;
	segments: AdvancedTrimSegment[];
	isAlreadyReviewed: boolean;
};

export type AdvancedTrimBatchVersePayload = {
	verseKey: string;
	translation: string;
	segments: Array<{
		i: number;
		arabic: string;
		wordByWordEnglish: string[];
	}>;
};

export type AdvancedTrimBatch = {
	batchId: string;
	startIndex: number;
	endIndex: number;
	wordCount: number;
	verses: AdvancedTrimVerseCandidate[];
	request: {
		verses: AdvancedTrimBatchVersePayload[];
	};
	estimatedInputTokens: number;
	estimatedOutputTokens: number;
	estimatedCostUsd: number;
};

export type AdvancedTrimUsage = {
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
	reasoningTokens?: number;
};

export type AdvancedTrimBatchResponse = {
	batchId: string;
	rawText: string;
	parsed: unknown;
	usage?: AdvancedTrimUsage;
};

export type AdvancedTrimVerseResult = {
	verseKey: string;
	segments: Array<{
		i: number;
		text: string;
	}>;
};

export type AdvancedTrimValidationSuccess = {
	candidate: AdvancedTrimVerseCandidate;
	result: AdvancedTrimVerseResult;
};

export type AdvancedTrimValidationReport = {
	validVerses: AdvancedTrimValidationSuccess[];
	errors: string[];
};

export type AdvancedTrimApplyReport = {
	appliedSegments: number;
	alignedSegments: number;
	erroredSegments: number;
	alignedVerses: number;
	erroredVerses: number;
	errors: string[];
};

export type AdvancedTrimCostEstimate = {
	batches: AdvancedTrimBatch[];
	totalVerses: number;
	totalWords: number;
	totalEstimatedInputTokens: number;
	totalEstimatedOutputTokens: number;
	totalEstimatedCostUsd: number;
	reasoningNote: string;
};

const MAX_BATCH_WORDS = 500;
const APPROX_SYSTEM_PROMPT_CHARS = 2200;

const MODEL_PRICING: Record<
	AdvancedTrimModel,
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

function splitWords(text: string): string[] {
	return text
		.replace(/\u00A0/g, ' ')
		.trim()
		.split(/\s+/)
		.filter(Boolean);
}

function normalizeCoverageToken(token: string): string {
	return token
		.replace(/\u00A0/g, ' ')
		.normalize('NFKC')
		.toLowerCase()
		.replace(/[\u2013\u2014]/g, '-')
		.replace(/^([^\p{L}\p{N}]+)|([^\p{L}\p{N}]+)$/gu, '')
		.trim();
}

function tokenizeForCoverage(text: string): string[] {
	return splitWords(text)
		.map((token) => normalizeCoverageToken(token))
		.filter(Boolean);
}

function countTokens(tokens: string[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const token of tokens) {
		counts.set(token, (counts.get(token) ?? 0) + 1);
	}
	return counts;
}

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

function buildRequestPayload(verses: AdvancedTrimVerseCandidate[]): {
	verses: AdvancedTrimBatchVersePayload[];
} {
	return {
		verses: verses.map((verse) => ({
			verseKey: verse.verseKey,
			translation: verse.sourceTranslation,
			segments: verse.segments.map((segment) => ({
				i: segment.i,
				arabic: segment.arabic,
				wordByWordEnglish: segment.wordByWordEnglish
			}))
		}))
	};
}

function estimateBatchCost(
	model: AdvancedTrimModel,
	reasoningEffort: AdvancedTrimReasoningEffort,
	requestPayload: { verses: AdvancedTrimBatchVersePayload[] }
): Pick<AdvancedTrimBatch, 'estimatedInputTokens' | 'estimatedOutputTokens' | 'estimatedCostUsd'> {
	const serializedInput = JSON.stringify(requestPayload);
	const serializedOutputCharBudget =
		requestPayload.verses.reduce((total, verse) => {
			const sourceChars = verse.translation.length;
			const jsonOverhead = verse.segments.length * 28 + verse.verseKey.length + 32;
			return total + Math.ceil(sourceChars * 1.25) + jsonOverhead;
		}, 24) + 32;

	const estimatedInputTokens = charsToTokens(APPROX_SYSTEM_PROMPT_CHARS + serializedInput.length);
	const estimatedOutputTokens = charsToTokens(serializedOutputCharBudget);
	const pricing = MODEL_PRICING[model];
	const estimatedCostUsd =
		(estimatedInputTokens / 1_000_000) * pricing.inputPerMillionUsd +
		(estimatedOutputTokens / 1_000_000) * pricing.outputPerMillionUsd;

	return {
		estimatedInputTokens,
		estimatedOutputTokens,
		estimatedCostUsd: reasoningEffort === 'none' ? estimatedCostUsd : estimatedCostUsd
	};
}

function isVerseAlreadyReviewed(subtitles: SubtitleClip[], edition: Edition): boolean {
	return subtitles.every((subtitle) => {
		const translation = subtitle.translations[edition.name] as VerseTranslation | undefined;
		return translation?.isStatusComplete() ?? false;
	});
}

export function buildAdvancedTrimVerseCandidates(
	edition: Edition,
	includeReviewed: boolean
): AdvancedTrimVerseCandidate[] {
	const grouped = new Map<
		string,
		{
			index: number;
			subtitles: SubtitleClip[];
		}
	>();

	for (let i = 0; i < globalState.getSubtitleClips.length; i++) {
		const subtitle = globalState.getSubtitleClips[i];
		if (subtitle.isFullVerse) continue;

		const verseKey = subtitle.getVerseKey();
		const bucket = grouped.get(verseKey);
		if (bucket) {
			bucket.subtitles.push(subtitle);
		} else {
			grouped.set(verseKey, {
				index: i,
				subtitles: [subtitle]
			});
		}
	}

	return Array.from(grouped.entries())
		.map(([verseKey, entry]) => {
			const sourceTranslation = globalState.getProjectTranslation.getVerseTranslation(
				edition,
				verseKey
			);
			const segments = entry.subtitles.map((subtitle, segmentIndex) => ({
				i: segmentIndex,
				arabic: subtitle.text,
				wordByWordEnglish: subtitle.wbwTranslation ?? [],
				subtitle
			}));
			const isAlreadyReviewed = isVerseAlreadyReviewed(entry.subtitles, edition);

			return {
				index: entry.index,
				verseKey,
				startTime: Math.min(...entry.subtitles.map((subtitle) => subtitle.startTime)),
				endTime: Math.max(...entry.subtitles.map((subtitle) => subtitle.endTime)),
				subtitles: entry.subtitles,
				sourceTranslation,
				wordCount: splitWords(sourceTranslation).length,
				segments,
				isAlreadyReviewed
			};
		})
		.filter((candidate) => (includeReviewed ? true : !candidate.isAlreadyReviewed))
		.sort((left, right) => left.index - right.index);
}

export function buildAdvancedTrimBatches(
	candidates: AdvancedTrimVerseCandidate[],
	model: AdvancedTrimModel,
	reasoningEffort: AdvancedTrimReasoningEffort,
	startTimeMs: number,
	endTimeMs: number
): AdvancedTrimBatch[] {
	if (candidates.length === 0) return [];

	const selected = candidates.filter(
		(candidate) => candidate.startTime <= endTimeMs && candidate.endTime >= startTimeMs
	);

	const batches: AdvancedTrimBatch[] = [];
	let current: AdvancedTrimVerseCandidate[] = [];
	let currentWordCount = 0;

	function pushCurrentBatch(): void {
		if (current.length === 0) return;
		const request = buildRequestPayload(current);
		const estimated = estimateBatchCost(model, reasoningEffort, request);
		const batchNumber = batches.length + 1;
		batches.push({
			batchId: `advanced-trim-batch-${batchNumber}-${current[0].index}`,
			startIndex: current[0].index,
			endIndex: current[current.length - 1].index,
			wordCount: currentWordCount,
			verses: current,
			request,
			...estimated
		});
		current = [];
		currentWordCount = 0;
	}

	for (const candidate of selected) {
		const verseWordCount = Math.max(candidate.wordCount, 1);
		const wouldOverflow = current.length > 0 && currentWordCount + verseWordCount > MAX_BATCH_WORDS;

		if (wouldOverflow) {
			pushCurrentBatch();
		}

		current.push(candidate);
		currentWordCount += verseWordCount;

		if (verseWordCount > MAX_BATCH_WORDS) {
			pushCurrentBatch();
		}
	}

	pushCurrentBatch();

	return batches;
}

export function estimateAdvancedTrimCost(
	batches: AdvancedTrimBatch[],
	reasoningEffort: AdvancedTrimReasoningEffort
): AdvancedTrimCostEstimate {
	const totalVerses = batches.reduce((count, batch) => count + batch.verses.length, 0);
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
		totalVerses,
		totalWords,
		totalEstimatedInputTokens,
		totalEstimatedOutputTokens,
		totalEstimatedCostUsd,
		reasoningNote:
			reasoningEffort === 'none'
				? 'Approximation based on prompt/output size only.'
				: 'Approximation based on prompt/output size only. Actual cost may increase with reasoning effort.'
	};
}

export function validateAdvancedTrimBatchResult(
	batch: AdvancedTrimBatch,
	parsed: unknown
): AdvancedTrimValidationReport {
	const errors: string[] = [];
	const validVerses: AdvancedTrimValidationSuccess[] = [];

	if (!parsed || typeof parsed !== 'object') {
		return {
			validVerses,
			errors: ['AI response is not a JSON object.']
		};
	}

	const versesValue = (parsed as Record<string, unknown>).verses;
	if (!Array.isArray(versesValue)) {
		return {
			validVerses,
			errors: ['AI response is missing the "verses" array.']
		};
	}

	const responseMap = new Map<string, AdvancedTrimVerseResult>();
	for (const verseValue of versesValue) {
		if (!verseValue || typeof verseValue !== 'object') {
			errors.push('AI response contains an invalid verse entry.');
			continue;
		}

		const verseKey = (verseValue as Record<string, unknown>).verseKey;
		const segments = (verseValue as Record<string, unknown>).segments;
		if (typeof verseKey !== 'string') {
			errors.push('AI response contains a verse without a valid verseKey.');
			continue;
		}
		if (responseMap.has(verseKey)) {
			errors.push(`Verse ${verseKey}: duplicate entry in AI response.`);
			continue;
		}
		if (!Array.isArray(segments)) {
			errors.push(`Verse ${verseKey}: missing segments array.`);
			continue;
		}

		responseMap.set(verseKey, {
			verseKey,
			segments: segments as AdvancedTrimVerseResult['segments']
		});
	}

	for (const verseKey of responseMap.keys()) {
		if (!batch.verses.some((candidate) => candidate.verseKey === verseKey)) {
			errors.push(`Verse ${verseKey}: unexpected verse returned by AI.`);
		}
	}

	for (const candidate of batch.verses) {
		const result = responseMap.get(candidate.verseKey);
		if (!result) {
			errors.push(`Verse ${candidate.verseKey}: missing from AI response.`);
			continue;
		}

		if (!Array.isArray(result.segments)) {
			errors.push(`Verse ${candidate.verseKey}: segments payload is invalid.`);
			continue;
		}

		if (result.segments.length !== candidate.segments.length) {
			errors.push(
				`Verse ${candidate.verseKey}: expected ${candidate.segments.length} segments, received ${result.segments.length}.`
			);
			continue;
		}

		const sortedSegments = [...result.segments].sort((left, right) => {
			const leftIndex = Number((left as Record<string, unknown>).i);
			const rightIndex = Number((right as Record<string, unknown>).i);
			return leftIndex - rightIndex;
		});
		let isValid = true;
		const normalizedTexts: string[] = [];

		for (let index = 0; index < sortedSegments.length; index++) {
			const segment = sortedSegments[index] as Record<string, unknown>;
			const returnedIndex = Number(segment.i);
			const returnedText = typeof segment.text === 'string' ? segment.text.trim() : '';

			if (!Number.isInteger(returnedIndex) || returnedIndex !== index) {
				errors.push(
					`Verse ${candidate.verseKey}: expected segment index ${index}, received ${String(segment.i)}.`
				);
				isValid = false;
				break;
			}

			if (returnedText.length === 0) {
				errors.push(`Verse ${candidate.verseKey}, segment ${index + 1}: empty text.`);
				isValid = false;
				break;
			}

			normalizedTexts.push(returnedText);
		}

		if (!isValid) continue;

		const sourceTokens = tokenizeForCoverage(candidate.sourceTranslation);
		const outputTokens = tokenizeForCoverage(normalizedTexts.join(' '));
		const sourceCounts = countTokens(sourceTokens);
		const outputCounts = countTokens(outputTokens);

		for (const token of outputCounts.keys()) {
			if (!sourceCounts.has(token)) {
				errors.push(
					`Verse ${candidate.verseKey}: AI introduced a token not present in source translation ("${token}").`
				);
				isValid = false;
			}
		}

		for (const [token, sourceCount] of sourceCounts.entries()) {
			const outputCount = outputCounts.get(token) ?? 0;
			if (outputCount < sourceCount) {
				errors.push(
					`Verse ${candidate.verseKey}: token coverage is incomplete for "${token}" (${outputCount}/${sourceCount}).`
				);
				isValid = false;
			}
		}

		if (!isValid) continue;

		validVerses.push({
			candidate,
			result: {
				verseKey: result.verseKey,
				segments: sortedSegments.map((segment) => ({
					i: Number((segment as Record<string, unknown>).i),
					text: String((segment as Record<string, unknown>).text)
				}))
			}
		});
	}

	return {
		validVerses,
		errors
	};
}

export function applyAdvancedTrimValidationSuccess(
	edition: Edition,
	validVerses: AdvancedTrimValidationSuccess[]
): AdvancedTrimApplyReport {
	let appliedSegments = 0;
	let alignedSegments = 0;
	let erroredSegments = 0;
	let alignedVerses = 0;
	let erroredVerses = 0;
	const errors: string[] = [];

	for (const success of validVerses) {
		const verseTranslations: Array<VerseTranslation | null> = [];
		const erroredIndexes = new Set<number>();
		const verseErrors: string[] = [];

		for (let index = 0; index < success.candidate.subtitles.length; index++) {
			const subtitle = success.candidate.subtitles[index];
			const verseTranslation = subtitle.translations[edition.name] as VerseTranslation;
			const nextText = success.result.segments[index]?.text;
			verseTranslations[index] = verseTranslation ?? null;
			if (!verseTranslation || typeof nextText !== 'string') continue;

			verseTranslation.text = nextText;
			verseTranslation.isBruteForce = false;
			verseTranslation.tryRecalculateTranslationIndexes(edition, success.candidate.verseKey);
			appliedSegments++;

			if (verseTranslation.isBruteForce) {
				erroredIndexes.add(index);
				verseErrors.push(
					`Verse ${success.candidate.verseKey}, segment ${index + 1}: failed to map the AI text back to a contiguous source range.`
				);
			}
		}

		for (let leftIndex = 0; leftIndex < success.candidate.subtitles.length; leftIndex++) {
			if (erroredIndexes.has(leftIndex)) continue;
			const leftSubtitle = success.candidate.subtitles[leftIndex];
			const leftTranslation = verseTranslations[leftIndex];
			if (!leftTranslation) continue;

			for (
				let rightIndex = leftIndex + 1;
				rightIndex < success.candidate.subtitles.length;
				rightIndex++
			) {
				if (erroredIndexes.has(rightIndex)) continue;
				const rightSubtitle = success.candidate.subtitles[rightIndex];
				const rightTranslation = verseTranslations[rightIndex];
				if (!rightTranslation) continue;

				const hasArabicOverlap = rangesOverlap(
					leftSubtitle.startWordIndex,
					leftSubtitle.endWordIndex,
					rightSubtitle.startWordIndex,
					rightSubtitle.endWordIndex
				);
				if (!hasArabicOverlap) continue;

				const hasTranslationOverlap = rangesOverlap(
					leftTranslation.startWordIndex,
					leftTranslation.endWordIndex,
					rightTranslation.startWordIndex,
					rightTranslation.endWordIndex
				);

				if (!hasTranslationOverlap) {
					erroredIndexes.add(leftIndex);
					erroredIndexes.add(rightIndex);
					verseErrors.push(
						`Verse ${success.candidate.verseKey}, segments ${leftIndex + 1} and ${rightIndex + 1}: Arabic segments overlap but mapped translation ranges do not overlap.`
					);
				}
			}
		}

		for (let index = 0; index < success.candidate.subtitles.length; index++) {
			const verseTranslation = verseTranslations[index];
			if (!verseTranslation) continue;

			if (erroredIndexes.has(index)) {
				verseTranslation.isBruteForce = true;
				verseTranslation.updateStatus('ai error', edition);
				erroredSegments++;
			} else {
				verseTranslation.updateStatus('ai trimmed', edition);
				alignedSegments++;
			}
		}

		if (erroredIndexes.size > 0) {
			erroredVerses++;
		} else {
			alignedVerses++;
		}

		errors.push(...verseErrors);
	}

	return {
		appliedSegments,
		alignedSegments,
		erroredSegments,
		alignedVerses,
		erroredVerses,
		errors
	};
}

export function formatUsd(value: number): string {
	return `$${value.toFixed(value < 0.01 ? 4 : 2)}`;
}

export function maskApiKey(value: string): string {
	if (!value) return 'Not configured';
	if (value.length <= 10) return value;
	return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export async function runAdvancedTrimBatchStreaming(params: {
	apiKey: string;
	model: AdvancedTrimModel;
	reasoningEffort: AdvancedTrimReasoningEffort;
	batchId: string;
	batch: AdvancedTrimBatch['request'];
}): Promise<AdvancedTrimBatchResponse> {
	const result = await invoke('run_advanced_ai_trim_batch_streaming', {
		request: {
			apiKey: params.apiKey,
			model: params.model,
			reasoningEffort: params.reasoningEffort,
			batchId: params.batchId,
			batch: params.batch
		}
	});

	return result as AdvancedTrimBatchResponse;
}
