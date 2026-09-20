import { invoke } from '@tauri-apps/api/core';
import type { AITranscriptionResult } from '$lib/services/AITranscription';
import type { AdvancedTrimModel } from '$lib/services/AdvancedAITrimming';
import type { AIReasoningEffort } from '$lib/services/AIReasoning';
import {
	buildTimedTranscriptTokens,
	finalizeTranscriptProcessing,
	loadQuranCorpus,
	prepareTranscriptForAnalysis,
	prepareFinalTranscriptTokens,
	isAllowedTranscriptPunctuation,
	type ProcessedTranscriptToken,
	type TranscriptAiAnalysis,
	type TranscriptAiCorrection,
	type TranscriptAiQuote,
	type TranscriptProcessingSettings
} from '$lib/services/TranscriptPostProcessor';
import { validateTranscriptQuranReferences } from '$lib/services/TranscriptReferenceService';
import { analyzeTranscriptSemanticBoundaries } from '$lib/services/AITranscriptSegmentation';

export const DEFAULT_TRANSCRIPT_CLEANUP_BATCH_WORDS = 160;
const BATCH_OVERLAP_WORDS = 30;
const TRANSCRIPT_CLEANUP_CONCURRENCY = 3;

type TranscriptAnalysisWordPayload = {
	i: number;
	p: number;
	t: string;
	q?: true;
	r?: string;
	o?: string;
	u?: string;
	a?: true;
	z?: true;
	g?: number;
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

type CompactQuranRejection = {
	s: number;
	e: number;
	f: 'high' | 'medium' | 'low';
};

type CompactPunctuation = {
	i: number;
	v: string;
};

type TranscriptCleanupBatchResponse = {
	parsed: unknown;
};

type QuranCandidateMetadata = {
	id: string;
	isStart: boolean;
	isEnd: boolean;
};

export type TranscriptCleanupReport = {
	result: AITranscriptionResult;
	errors: string[];
	processedSegments: number;
	totalSegments: number;
	quranPassages: number;
	quotePassages: number;
	correctionsApplied: number;
	analyses: TranscriptAiAnalysis[];
	nextBatchIndex: number;
	totalBatches: number;
	paused: boolean;
};

/**
 * Identifie les limites globales de chaque candidat Quran avant le découpage en batches.
 * @param {ProcessedTranscriptToken[]} tokens Flux complet de mots préparés.
 * @returns {Map<number, QuranCandidateMetadata>} Métadonnées indexées par identifiant de mot.
 */
function buildQuranCandidateMetadata(
	tokens: ProcessedTranscriptToken[]
): Map<number, QuranCandidateMetadata> {
	const metadata = new Map<number, QuranCandidateMetadata>();
	for (let start = 0; start < tokens.length; start += 1) {
		if (!tokens[start].quran) continue;
		const sourceKey = [...tokens[start].sourceIds].sort((left, right) => left - right).join(':');
		let end = start;
		while (
			end + 1 < tokens.length &&
			tokens[end + 1].quran &&
			[...tokens[end + 1].sourceIds].sort((left, right) => left - right).join(':') === sourceKey
		) {
			end += 1;
		}
		const candidateId = `quran-${tokens[start].id}`;
		for (let index = start; index <= end; index += 1) {
			metadata.set(tokens[index].id, {
				id: candidateId,
				isStart: index === start,
				isEnd: index === end
			});
		}
		start = end;
	}
	return metadata;
}

/**
 * Construit des fenêtres chevauchantes de mots pour préserver le contexte aux limites de batch.
 * @param {ProcessedTranscriptToken[]} tokens Mots horodatés à analyser.
 * @param {number} batchWords Nombre maximal de mots par batch.
 * @param {ProcessedTranscriptToken[]} sourceTokens Mots ASR originaux avant remplacement Quran.
 * @returns {TranscriptCleanupBatch[]} Batches structurés pour le provider texte.
 */
export function buildTranscriptCleanupBatches(
	tokens: ProcessedTranscriptToken[],
	batchWords: number = DEFAULT_TRANSCRIPT_CLEANUP_BATCH_WORDS,
	sourceTokens: ProcessedTranscriptToken[] = tokens
): TranscriptCleanupBatch[] {
	if (tokens.length === 0) return [];
	const batches: TranscriptCleanupBatch[] = [];
	const sourceById = new Map(sourceTokens.map((token) => [token.id, token]));
	const quranCandidateByTokenId = buildQuranCandidateMetadata(tokens);
	const speakers = new Map<string, number>();
	const normalizedBatchWords = Math.max(BATCH_OVERLAP_WORDS + 1, Math.round(batchWords));
	const stride = Math.max(1, normalizedBatchWords - BATCH_OVERLAP_WORDS);
	for (let start = 0; start < tokens.length; start += stride) {
		const batchTokens = tokens.slice(start, start + normalizedBatchWords);
		if (batchTokens.length === 0) break;
		const batchNumber = batches.length + 1;
		batches.push({
			batchId: `transcript-analysis-${batchNumber}-${batchTokens[0].id}`,
			tokens: batchTokens,
			request: {
				w: batchTokens.map((token, tokenIndex) => {
					const next = batchTokens[tokenIndex + 1];
					const candidate = quranCandidateByTokenId.get(token.id);
					if (!speakers.has(token.speaker)) speakers.set(token.speaker, speakers.size);
					const originalPassage =
						token.quran && candidate?.isStart
							? token.sourceIds
									.map((id) => sourceById.get(id))
									.filter((source): source is ProcessedTranscriptToken => source !== undefined)
									.map((source) => `${source.text}${source.punctuationAfter}`)
									.join(' ')
									.trim()
							: null;
					const word: TranscriptAnalysisWordPayload = {
						i: token.id,
						p: speakers.get(token.speaker)!,
						t: `${token.text}${token.punctuationAfter}`
					};
					if (next) word.g = Math.round(Math.max(0, next.start - token.end) * 1000) / 1000;
					if (token.quran) {
						word.q = true;
						word.r = `${token.quran.surah}:${token.quran.verse}`;
					}
					if (originalPassage) word.o = originalPassage;
					if (candidate) word.u = candidate.id;
					if (candidate?.isStart) word.a = true;
					if (candidate?.isEnd) word.z = true;
					return word;
				})
			}
		});
		if (start + normalizedBatchWords >= tokens.length) break;
	}
	return batches;
}

/**
 * Estime le nombre de batches depuis les mots disponibles dans une transcription.
 * @param {AITranscriptionResult} result Transcription à nettoyer.
 * @param {number} batchWords Nombre maximal de mots par batch.
 * @returns {number} Nombre estimé de batches.
 */
export function estimateTranscriptCleanupBatchCount(
	result: AITranscriptionResult,
	batchWords: number = DEFAULT_TRANSCRIPT_CLEANUP_BATCH_WORDS
): number {
	const wordCount = result.segments.reduce(
		(total, segment) =>
			total +
			(segment.words?.filter((word) => word.word?.trim()).length ||
				segment.text.trim().split(/\s+/).filter(Boolean).length),
		0
	);
	if (wordCount === 0) return 0;
	const normalizedBatchWords = Math.max(BATCH_OVERLAP_WORDS + 1, Math.round(batchWords));
	return Math.max(
		1,
		Math.ceil((wordCount - BATCH_OVERLAP_WORDS) / (normalizedBatchWords - BATCH_OVERLAP_WORDS))
	);
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
	const payloadById = new Map(batch.request.w.map((word) => [word.i, word]));
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
	const overlappingCorrections = new Set<number>();
	for (let left = 0; left < analysis.corrections.length; left += 1) {
		const leftStart = order.get(analysis.corrections[left].startId)!;
		const leftEnd = order.get(analysis.corrections[left].endId)!;
		for (let right = left + 1; right < analysis.corrections.length; right += 1) {
			const rightStart = order.get(analysis.corrections[right].startId)!;
			const rightEnd = order.get(analysis.corrections[right].endId)!;
			if (leftStart <= rightEnd && rightStart <= leftEnd) {
				overlappingCorrections.add(left);
				overlappingCorrections.add(right);
			}
		}
	}
	if (overlappingCorrections.size > 0) {
		errors.push('AI returned overlapping correction ranges.');
		analysis.corrections = analysis.corrections.filter(
			(_, index) => !overlappingCorrections.has(index)
		);
	}
	const correctedIds = new Set<number>();
	for (const correction of analysis.corrections) {
		const start = order.get(correction.startId)!;
		const end = order.get(correction.endId)!;
		for (const token of batch.tokens.slice(start, end + 1)) correctedIds.add(token.id);
	}

	if (Array.isArray(record.quotes)) {
		for (const raw of record.quotes) {
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

	if (Array.isArray(record.x)) {
		for (const raw of record.x) {
			if (!raw || typeof raw !== 'object') continue;
			const value = raw as Partial<CompactQuranRejection>;
			const startId = Number(value.s);
			const endId = Number(value.e);
			const confidence = parseConfidence(value.f);
			if (
				!Number.isInteger(startId) ||
				!Number.isInteger(endId) ||
				!confidence ||
				!isValidIdRange(order, startId, endId)
			) {
				errors.push('AI returned an invalid Quran rejection range.');
				continue;
			}
			const start = order.get(startId)!;
			const end = order.get(endId)!;
			const selectedPayloads = batch.tokens
				.slice(start, end + 1)
				.map((token) => payloadById.get(token.id)!);
			const candidateId = selectedPayloads[0]?.u;
			if (
				selectedPayloads.some((word) => !word.q) ||
				!candidateId ||
				selectedPayloads.some((word) => word.u !== candidateId) ||
				!selectedPayloads[0].a ||
				!selectedPayloads.at(-1)?.z
			) {
				errors.push('AI attempted to reject an incomplete Quran candidate.');
				continue;
			}
			(analysis.quranRejections ??= []).push({ startId, endId, confidence });
		}
	}

	if (Array.isArray(record.b)) {
		for (const rawId of record.b) {
			const id = Number(rawId);
			if (
				Number.isInteger(id) &&
				order.has(id) &&
				!correctedIds.has(id) &&
				(!protectedIds.has(id) || payloadById.get(id)?.z)
			) {
				analysis.breakAfter.push(id);
			}
		}
	}

	if (Array.isArray(record.p)) {
		for (const raw of record.p) {
			if (!raw || typeof raw !== 'object') continue;
			const value = raw as Partial<CompactPunctuation>;
			const id = Number(value.i);
			const punctuation = typeof value.v === 'string' ? value.v : '';
			if (
				Number.isInteger(id) &&
				order.has(id) &&
				!protectedIds.has(id) &&
				!correctedIds.has(id) &&
				isAllowedTranscriptPunctuation(punctuation)
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
	const quranRejections = Array.from(
		new Map(
			analyses
				.flatMap((analysis) => analysis.quranRejections ?? [])
				.filter((rejection) => rejection.confidence === 'high')
				.map((rejection) => [`${rejection.startId}:${rejection.endId}`, rejection])
		).values()
	);
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
		quranRejections,
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
 * Laisse le navigateur afficher la phase courante avant un traitement synchrone.
 * @returns {Promise<void>} Promesse résolue après un passage de boucle événementielle.
 */
async function yieldToUi(): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/**
 * Corrige, annote et re-segmente une transcription avec une IA textuelle facultative.
 * @param {AITranscriptionResult} result Résultat ASR courant.
 * @param {{ apiKey?: string; endpoint?: string; model?: AdvancedTrimModel; reasoningEffort?: AIReasoningEffort; thinkingEnabled?: boolean | null; batchWords?: number; maxWords: number; maxChars: number; maxGap: number; resume?: { analyses: TranscriptAiAnalysis[]; errors: string[]; nextBatchIndex: number }; shouldPause?: () => boolean; onProgress?: (current: number, total: number, batchId: string) => void; onSemanticSegmentationStart?: () => void; onBatchComplete?: (report: TranscriptCleanupReport, batchId: string) => void | Promise<void> }} options Provider, reprise et contraintes.
 * @returns {Promise<TranscriptCleanupReport>} Transcription préparée et rapport.
 */
export async function cleanupAITranscript(
	result: AITranscriptionResult,
	options: {
		apiKey?: string;
		endpoint?: string;
		model?: AdvancedTrimModel;
		reasoningEffort?: AIReasoningEffort;
		thinkingEnabled?: boolean | null;
		batchWords?: number;
		maxWords: number;
		maxChars: number;
		maxGap: number;
		resume?: {
			analyses: TranscriptAiAnalysis[];
			errors: string[];
			nextBatchIndex: number;
		};
		shouldPause?: () => boolean;
		onProgress?: (current: number, total: number, batchId: string) => void;
		onPreparationStart?: () => void;
		onSemanticSegmentationStart?: () => void;
		onSemanticSegmentationProgress?: (current: number, total: number, batchId: string) => void;
		onSemanticSegmentationBatchComplete?: (batchId: string) => void;
		onSemanticSegmentationBatchFailed?: (batchId: string) => void;
		onFinalizationStart?: () => void;
		onValidationStart?: () => void;
		onBatchComplete?: (report: TranscriptCleanupReport, batchId: string) => void | Promise<void>;
	}
): Promise<TranscriptCleanupReport> {
	options.onPreparationStart?.();
	await yieldToUi();
	const corpus = await loadQuranCorpus();
	const sourceTokens = buildTimedTranscriptTokens(result);
	const prepared = prepareTranscriptForAnalysis(result, corpus);
	const errors: string[] = [...(options.resume?.errors ?? [])];
	const analyses: TranscriptAiAnalysis[] = [...(options.resume?.analyses ?? [])];
	const apiKey = options.apiKey?.trim() ?? '';
	const endpoint = options.endpoint?.trim() ?? '';
	const model = (options.model?.trim() ?? '') as AdvancedTrimModel;
	const reasoningEffort = options.reasoningEffort ?? 'none';
	const batches =
		apiKey && endpoint && model
			? buildTranscriptCleanupBatches(prepared.tokens, options.batchWords, sourceTokens)
			: [];
	let nextBatchToSchedule = Math.min(options.resume?.nextBatchIndex ?? 0, batches.length);
	let nextBatchIndex = nextBatchToSchedule;
	let paused = false;
	let startedThisRun = 0;
	let completionQueue = Promise.resolve();
	const completedBatchIndexes = new Set<number>();
	const batchFailures: Array<Error | undefined> = batches.map(() => undefined);

	/**
	 * Consomme les batches de review avec une concurrence limitée.
	 * @returns {Promise<void>} Promesse résolue quand ce worker n'a plus de batch.
	 */
	async function runCleanupWorker(): Promise<void> {
		while (nextBatchToSchedule < batches.length) {
			if (batchFailures.some(Boolean)) return;
			if (startedThisRun > 0 && options.shouldPause?.()) {
				paused = nextBatchIndex < batches.length;
				return;
			}
			const batchIndex = nextBatchToSchedule;
			nextBatchToSchedule += 1;
			startedThisRun += 1;
			const batch = batches[batchIndex];
			options.onProgress?.(batchIndex + 1, batches.length, batch.batchId);

			let validation: ReturnType<typeof validateTranscriptCleanupBatch>;
			try {
				const response = (await invoke('run_ai_transcript_cleanup_batch_streaming', {
					request: {
						apiKey,
						endpoint,
						model,
						reasoningEffort,
						thinkingEnabled: options.thinkingEnabled,
						batchId: batch.batchId,
						batch: batch.request
					}
				})) as TranscriptCleanupBatchResponse;
				validation = validateTranscriptCleanupBatch(batch, response.parsed);
			} catch (error) {
				batchFailures[batchIndex] = new Error(
					`AI transcript cleanup batch ${batchIndex + 1} failed: ${error instanceof Error ? error.message : String(error)}`
				);
				return;
			}

			completionQueue = completionQueue.then(async () => {
				analyses.push(validation.analysis);
				errors.push(...validation.errors);
				completedBatchIndexes.add(batchIndex);
				while (completedBatchIndexes.has(nextBatchIndex)) nextBatchIndex += 1;
				const progressiveAnalysis = mergeTranscriptAiAnalyses(analyses, prepared.tokens);
				options.onFinalizationStart?.();
				await yieldToUi();
				const progressive = finalizeTranscriptProcessing(
					result,
					prepared.tokens,
					corpus,
					progressiveAnalysis,
					{
						maxWords: Math.max(2, options.maxWords),
						maxChars: Math.max(20, options.maxChars),
						maxGap: Math.max(0.1, options.maxGap),
						preserveWordSilences: result.device === 'groq'
					}
				);
				await options.onBatchComplete?.(
					{
						result: progressive.result,
						errors: [...errors],
						processedSegments: progressive.generatedSegments,
						totalSegments: progressive.originalSegments,
						quranPassages: progressive.quranPassages,
						quotePassages: progressive.quotePassages,
						correctionsApplied: progressive.correctionsApplied,
						analyses: [...analyses],
						nextBatchIndex,
						totalBatches: batches.length,
						paused: false
					},
					batch.batchId
				);
			});
		}
	}

	await Promise.all(
		Array.from(
			{ length: Math.min(TRANSCRIPT_CLEANUP_CONCURRENCY, batches.length - nextBatchToSchedule) },
			() => runCleanupWorker()
		)
	);
	await completionQueue;
	const failure = batchFailures.find((error) => error !== undefined);
	if (failure) throw failure;

	const analysis = mergeTranscriptAiAnalyses(analyses, prepared.tokens);
	const settings: TranscriptProcessingSettings = {
		maxWords: Math.max(2, options.maxWords),
		maxChars: Math.max(20, options.maxChars),
		maxGap: Math.max(0.1, options.maxGap),
		preserveWordSilences: result.device === 'groq'
	};
	options.onFinalizationStart?.();
	await yieldToUi();
	const finalTokens = prepareFinalTranscriptTokens(result, prepared.tokens, corpus, analysis);
	let semantic = { boundaries: [], errors: [] } as Awaited<
		ReturnType<typeof analyzeTranscriptSemanticBoundaries>
	>;
	if (!paused && apiKey && endpoint && model) {
		options.onSemanticSegmentationStart?.();
		await yieldToUi();
		semantic = await analyzeTranscriptSemanticBoundaries(finalTokens.tokens, {
			apiKey,
			endpoint,
			model,
			reasoningEffort,
			thinkingEnabled: options.thinkingEnabled,
			timingQuality: result.segments.every((segment) => (segment.words?.length ?? 0) > 0)
				? 'word'
				: 'estimated',
			onProgress: options.onSemanticSegmentationProgress,
			onBatchComplete: options.onSemanticSegmentationBatchComplete,
			onBatchFailed: options.onSemanticSegmentationBatchFailed
		});
	}
	errors.push(...semantic.errors);
	options.onFinalizationStart?.();
	await yieldToUi();
	const processed = finalizeTranscriptProcessing(
		result,
		prepared.tokens,
		corpus,
		analysis,
		settings,
		semantic.boundaries
	);
	if (!paused) {
		options.onValidationStart?.();
		await yieldToUi();
		errors.push(...(await validateFinalQuranMarkers(processed.result)));
	}
	return {
		result: processed.result,
		errors,
		processedSegments: processed.generatedSegments,
		totalSegments: processed.originalSegments,
		quranPassages: processed.quranPassages,
		quotePassages: processed.quotePassages,
		correctionsApplied: processed.correctionsApplied,
		analyses,
		nextBatchIndex,
		totalBatches: batches.length,
		paused
	};
}
