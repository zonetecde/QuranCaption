import { invoke } from '@tauri-apps/api/core';
import type { AITranscriptionResult } from '$lib/services/AITranscription';
import type {
	AdvancedTrimModel,
	AdvancedTrimReasoningEffort
} from '$lib/services/AdvancedAITrimming';
import {
	finalizeTranscriptProcessing,
	loadQuranCorpus,
	prepareTranscriptForAnalysis,
	type ProcessedTranscriptToken,
	type TranscriptAiAnalysis,
	type TranscriptAiCorrection,
	type TranscriptAiPunctuation,
	type TranscriptAiQuote,
	type TranscriptProcessingSettings
} from '$lib/services/TranscriptPostProcessor';
import { validateTranscriptQuranReferences } from '$lib/services/TranscriptReferenceService';

const MAX_BATCH_WORDS = 160;
const BATCH_OVERLAP_WORDS = 40;

type TranscriptAnalysisWordPayload = {
	i: number;
	p: string;
	t: string;
	q: boolean;
	g: number | null;
};

export type TranscriptCleanupBatch = {
	batchId: string;
	tokens: ProcessedTranscriptToken[];
	request: {
		w: TranscriptAnalysisWordPayload[];
	};
};

type CompactCorrection = {
	s: number;
	e: number;
	t: string;
	f: 'high' | 'medium' | 'low';
};

type CompactQuote = {
	s: number;
	e: number;
	k: 'hadith' | 'scholar' | 'generic';
	f: 'high' | 'medium' | 'low';
};

type CompactPunctuation = {
	i: number;
	v: string;
};

type TranscriptCleanupBatchResponse = {
	parsed: unknown;
};

export type TranscriptCleanupReport = {
	result: AITranscriptionResult;
	errors: string[];
	processedSegments: number;
	totalSegments: number;
	quranPassages: number;
	quotePassages: number;
	correctionsApplied: number;
};

/**
 * Construit des fenêtres chevauchantes de mots pour préserver le contexte aux limites de batch.
 * @param {ProcessedTranscriptToken[]} tokens Mots horodatés à analyser.
 * @returns {TranscriptCleanupBatch[]} Batches structurés pour le provider texte.
 */
export function buildTranscriptCleanupBatches(
	tokens: ProcessedTranscriptToken[]
): TranscriptCleanupBatch[] {
	if (tokens.length === 0) return [];
	const batches: TranscriptCleanupBatch[] = [];
	const stride = Math.max(1, MAX_BATCH_WORDS - BATCH_OVERLAP_WORDS);
	for (let start = 0; start < tokens.length; start += stride) {
		const batchTokens = tokens.slice(start, start + MAX_BATCH_WORDS);
		if (batchTokens.length === 0) break;
		const batchNumber = batches.length + 1;
		batches.push({
			batchId: `transcript-analysis-${batchNumber}-${batchTokens[0].id}`,
			tokens: batchTokens,
			request: {
				w: batchTokens.map((token, tokenIndex) => {
					const next = batchTokens[tokenIndex + 1];
					return {
						i: token.id,
						p: token.speaker,
						t: `${token.text}${token.punctuationAfter}`,
						q: token.quran !== null,
						g: next ? Math.round(Math.max(0, next.start - token.end) * 1000) / 1000 : null
					};
				})
			}
		});
		if (start + MAX_BATCH_WORDS >= tokens.length) break;
	}
	return batches;
}

/**
 * Vérifie qu'une plage d'identifiants existe dans l'ordre du batch.
 * @param {Map<number, number>} order Position de chaque identifiant.
 * @param {number} startId Premier identifiant.
 * @param {number} endId Dernier identifiant.
 * @returns {boolean} `true` pour une plage ordonnée et présente.
 */
function isValidIdRange(order: Map<number, number>, startId: number, endId: number): boolean {
	const start = order.get(startId);
	const end = order.get(endId);
	return start !== undefined && end !== undefined && start <= end;
}

/**
 * Convertit une valeur de confiance compacte en type strict.
 * @param {unknown} value Valeur brute.
 * @returns {'high' | 'medium' | 'low' | null} Valeur validée.
 */
function parseConfidence(value: unknown): 'high' | 'medium' | 'low' | null {
	return value === 'high' || value === 'medium' || value === 'low' ? value : null;
}

/**
 * Valide la réponse structurée d'un batch sans autoriser l'IA à toucher au Quran protégé.
 * @param {TranscriptCleanupBatch} batch Batch source.
 * @param {unknown} parsed Réponse JSON parsée.
 * @returns {{ analysis: TranscriptAiAnalysis; errors: string[] }} Opérations sûres et erreurs.
 */
export function validateTranscriptCleanupBatch(
	batch: TranscriptCleanupBatch,
	parsed: unknown
): { analysis: TranscriptAiAnalysis; errors: string[] } {
	const analysis: TranscriptAiAnalysis = {
		corrections: [],
		quotes: [],
		breakAfter: [],
		punctuationAfter: []
	};
	const errors: string[] = [];
	if (!parsed || typeof parsed !== 'object') {
		return { analysis, errors: ['AI response is not a JSON object.'] };
	}
	const record = parsed as Record<string, unknown>;
	const order = new Map(batch.tokens.map((token, index) => [token.id, index]));
	const protectedIds = new Set(
		batch.tokens.filter((token) => token.quran).map((token) => token.id)
	);

	if (Array.isArray(record.c)) {
		for (const raw of record.c) {
			if (!raw || typeof raw !== 'object') continue;
			const value = raw as Partial<CompactCorrection>;
			const startId = Number(value.s);
			const endId = Number(value.e);
			const replacement = typeof value.t === 'string' ? value.t.trim() : '';
			const confidence = parseConfidence(value.f);
			if (
				!Number.isInteger(startId) ||
				!Number.isInteger(endId) ||
				!replacement ||
				!confidence ||
				!isValidIdRange(order, startId, endId)
			) {
				errors.push('AI returned an invalid correction operation.');
				continue;
			}
			const start = order.get(startId)!;
			const end = order.get(endId)!;
			if (batch.tokens.slice(start, end + 1).some((token) => protectedIds.has(token.id))) {
				errors.push('AI attempted to rewrite a protected Quran passage.');
				continue;
			}
			analysis.corrections.push({ startId, endId, replacement, confidence });
		}
	}

	if (Array.isArray(record.q)) {
		for (const raw of record.q) {
			if (!raw || typeof raw !== 'object') continue;
			const value = raw as Partial<CompactQuote>;
			const startId = Number(value.s);
			const endId = Number(value.e);
			const type = value.k;
			const confidence = parseConfidence(value.f);
			if (
				!Number.isInteger(startId) ||
				!Number.isInteger(endId) ||
				(type !== 'hadith' && type !== 'scholar' && type !== 'generic') ||
				!confidence ||
				!isValidIdRange(order, startId, endId)
			) {
				errors.push('AI returned an invalid quotation range.');
				continue;
			}
			const start = order.get(startId)!;
			const end = order.get(endId)!;
			if (batch.tokens.slice(start, end + 1).some((token) => protectedIds.has(token.id))) continue;
			analysis.quotes.push({ startId, endId, type, confidence });
		}
	}

	if (Array.isArray(record.b)) {
		for (const rawId of record.b) {
			const id = Number(rawId);
			if (Number.isInteger(id) && order.has(id) && !protectedIds.has(id)) {
				analysis.breakAfter.push(id);
			}
		}
	}

	if (Array.isArray(record.p)) {
		for (const raw of record.p) {
			if (!raw || typeof raw !== 'object') continue;
			const value = raw as Partial<CompactPunctuation>;
			const id = Number(value.i);
			const punctuation = typeof value.v === 'string' ? value.v.trim() : '';
			if (
				Number.isInteger(id) &&
				order.has(id) &&
				!protectedIds.has(id) &&
				/^[.,!?؟،؛:…]+$/u.test(punctuation)
			) {
				analysis.punctuationAfter.push({ id, value: punctuation });
			}
		}
	}
	return { analysis, errors };
}

/**
 * Déduplique les corrections chevauchantes produites par les fenêtres de contexte.
 * @param {TranscriptAiCorrection[]} corrections Corrections validées.
 * @param {Map<number, number>} order Ordre global des identifiants.
 * @returns {TranscriptAiCorrection[]} Corrections non conflictuelles.
 */
function mergeCorrections(
	corrections: TranscriptAiCorrection[],
	order: Map<number, number>
): TranscriptAiCorrection[] {
	const grouped = new Map<string, TranscriptAiCorrection[]>();
	for (const correction of corrections) {
		const key = `${correction.startId}:${correction.endId}`;
		grouped.set(key, [...(grouped.get(key) ?? []), correction]);
	}
	const confidenceRank = { high: 3, medium: 2, low: 1 } as const;
	const candidates: TranscriptAiCorrection[] = [];
	for (const values of grouped.values()) {
		const replacements = new Set(values.map((value) => value.replacement.trim()));
		if (replacements.size !== 1) continue;
		const strongest = values.reduce((best, value) =>
			confidenceRank[value.confidence] > confidenceRank[best.confidence] ? value : best
		);
		candidates.push(strongest);
	}
	const sorted = candidates.sort(
		(left, right) =>
			(order.get(left.startId) ?? 0) - (order.get(right.startId) ?? 0) ||
			(order.get(left.endId) ?? 0) - (order.get(right.endId) ?? 0)
	);
	const conflicted = new Set<number>();
	for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
		const leftStart = order.get(sorted[leftIndex].startId);
		const leftEnd = order.get(sorted[leftIndex].endId);
		if (leftStart === undefined || leftEnd === undefined) {
			conflicted.add(leftIndex);
			continue;
		}
		for (let rightIndex = leftIndex + 1; rightIndex < sorted.length; rightIndex += 1) {
			const rightStart = order.get(sorted[rightIndex].startId);
			const rightEnd = order.get(sorted[rightIndex].endId);
			if (rightStart === undefined || rightEnd === undefined) {
				conflicted.add(rightIndex);
				continue;
			}
			if (rightStart > leftEnd) break;
			if (leftStart <= rightEnd) {
				conflicted.add(leftIndex);
				conflicted.add(rightIndex);
			}
		}
	}
	return sorted.filter((_, index) => !conflicted.has(index));
}

/**
 * Fusionne les plages de citation identiques ou adjacentes issues des batches chevauchants.
 * @param {TranscriptAiQuote[]} quotes Citations validées.
 * @param {Map<number, number>} order Ordre global des identifiants.
 * @param {ProcessedTranscriptToken[]} tokens Tokens analysés.
 * @returns {TranscriptAiQuote[]} Plages consolidées.
 */
function mergeQuotes(
	quotes: TranscriptAiQuote[],
	order: Map<number, number>,
	tokens: ProcessedTranscriptToken[]
): TranscriptAiQuote[] {
	const grouped = new Map<string, TranscriptAiQuote[]>();
	for (const quote of quotes.filter((candidate) => candidate.confidence === 'high')) {
		const key = `${quote.startId}:${quote.endId}`;
		grouped.set(key, [...(grouped.get(key) ?? []), quote]);
	}
	const candidates = [...grouped.values()]
		.filter((values) => new Set(values.map((value) => value.type)).size === 1)
		.map((values) => values[0])
		.sort(
			(left, right) =>
				(order.get(left.startId) ?? 0) - (order.get(right.startId) ?? 0) ||
				(order.get(left.endId) ?? 0) - (order.get(right.endId) ?? 0)
		);
	const merged: TranscriptAiQuote[] = [];
	let conflictUntil = -1;
	for (const quote of candidates) {
		const start = order.get(quote.startId);
		const end = order.get(quote.endId);
		if (start === undefined || end === undefined || start <= conflictUntil) continue;
		const previous = merged.at(-1);
		if (previous) {
			const previousEnd = order.get(previous.endId)!;
			const sameSpeaker = tokens[previousEnd]?.speaker === tokens[start]?.speaker;
			if (start <= previousEnd) {
				if (previous.type === quote.type && sameSpeaker) {
					if (end > previousEnd) previous.endId = quote.endId;
					continue;
				}
				merged.pop();
				conflictUntil = Math.max(previousEnd, end);
				continue;
			}
			if (start === previousEnd + 1 && previous.type === quote.type && sameSpeaker) {
				previous.endId = quote.endId;
				continue;
			}
		}
		merged.push({ ...quote });
	}
	return merged;
}

/**
 * Agrège les analyses de tous les batches en une analyse globale cohérente.
 * @param {TranscriptAiAnalysis[]} analyses Analyses individuelles.
 * @param {ProcessedTranscriptToken[]} tokens Flux global.
 * @returns {TranscriptAiAnalysis} Analyse fusionnée.
 */
export function mergeTranscriptAiAnalyses(
	analyses: TranscriptAiAnalysis[],
	tokens: ProcessedTranscriptToken[]
): TranscriptAiAnalysis {
	const order = new Map(tokens.map((token, index) => [token.id, index]));
	const punctuationOptions = new Map<number, Set<string>>();
	for (const item of analyses.flatMap((analysis) => analysis.punctuationAfter)) {
		const values = punctuationOptions.get(item.id) ?? new Set<string>();
		values.add(item.value);
		punctuationOptions.set(item.id, values);
	}
	return {
		corrections: mergeCorrections(
			analyses.flatMap((analysis) => analysis.corrections),
			order
		),
		quotes: mergeQuotes(
			analyses.flatMap((analysis) => analysis.quotes),
			order,
			tokens
		),
		breakAfter: Array.from(new Set(analyses.flatMap((analysis) => analysis.breakAfter))),
		punctuationAfter: [...punctuationOptions.entries()].flatMap(([id, values]) =>
			values.size === 1 ? [{ id, value: [...values][0] }] : []
		)
	};
}

/**
 * Vérifie tous les marqueurs Quran du résultat final avant son affichage.
 * @param {AITranscriptionResult} result Résultat segmenté.
 * @returns {Promise<string[]>} Erreurs de références détectées.
 */
async function validateFinalQuranMarkers(result: AITranscriptionResult): Promise<string[]> {
	const errors: string[] = [];
	for (const [index, segment] of result.segments.entries()) {
		const error = await validateTranscriptQuranReferences(segment.text);
		if (error) errors.push(`Segment ${index + 1}: ${error}`);
	}
	return errors;
}

/**
 * Corrige, annote et re-segmente une transcription avec une IA textuelle facultative.
 * @param {AITranscriptionResult} result Résultat ASR courant.
 * @param {{ apiKey?: string; endpoint?: string; model?: AdvancedTrimModel; reasoningEffort?: AdvancedTrimReasoningEffort; maxWords: number; maxChars: number; maxGap: number; onProgress?: (current: number, total: number, batchId: string) => void }} options Provider et contraintes.
 * @returns {Promise<TranscriptCleanupReport>} Transcription préparée et rapport.
 */
export async function cleanupAITranscript(
	result: AITranscriptionResult,
	options: {
		apiKey?: string;
		endpoint?: string;
		model?: AdvancedTrimModel;
		reasoningEffort?: AdvancedTrimReasoningEffort;
		maxWords: number;
		maxChars: number;
		maxGap: number;
		onProgress?: (current: number, total: number, batchId: string) => void;
	}
): Promise<TranscriptCleanupReport> {
	const corpus = await loadQuranCorpus();
	const prepared = prepareTranscriptForAnalysis(result, corpus);
	const errors: string[] = [];
	const analyses: TranscriptAiAnalysis[] = [];
	const apiKey = options.apiKey?.trim() ?? '';
	const endpoint = options.endpoint?.trim() ?? '';
	const model = options.model?.trim() ?? '';
	const reasoningEffort = options.reasoningEffort ?? 'none';
	const batches = apiKey && endpoint && model ? buildTranscriptCleanupBatches(prepared.tokens) : [];

	for (const [batchIndex, batch] of batches.entries()) {
		options.onProgress?.(batchIndex + 1, batches.length, batch.batchId);
		try {
			const response = (await invoke('run_ai_transcript_cleanup_batch_streaming', {
				request: {
					apiKey,
					endpoint,
					model,
					reasoningEffort,
					batchId: batch.batchId,
					batch: batch.request
				}
			})) as TranscriptCleanupBatchResponse;
			const validation = validateTranscriptCleanupBatch(batch, response.parsed);
			analyses.push(validation.analysis);
			errors.push(...validation.errors);
		} catch (error) {
			errors.push(error instanceof Error ? error.message : String(error));
		}
	}

	const analysis = mergeTranscriptAiAnalyses(analyses, prepared.tokens);
	const settings: TranscriptProcessingSettings = {
		maxWords: Math.max(2, options.maxWords),
		maxChars: Math.max(20, options.maxChars),
		maxGap: Math.max(0.1, options.maxGap)
	};
	const processed = finalizeTranscriptProcessing(
		result,
		prepared.tokens,
		corpus,
		analysis,
		settings
	);
	errors.push(...(await validateFinalQuranMarkers(processed.result)));
	return {
		result: processed.result,
		errors,
		processedSegments: processed.generatedSegments,
		totalSegments: processed.originalSegments,
		quranPassages: processed.quranPassages,
		quotePassages: processed.quotePassages,
		correctionsApplied: processed.correctionsApplied
	};
}
