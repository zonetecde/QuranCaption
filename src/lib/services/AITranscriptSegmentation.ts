import { invoke } from '@tauri-apps/api/core';
import type { AdvancedTrimModel } from '$lib/services/AdvancedAITrimming';
import type { AIReasoningEffort } from '$lib/services/AIReasoning';
import type {
	ProcessedTranscriptToken,
	TranscriptSemanticBoundary,
	TranscriptSemanticBoundaryKind
} from '$lib/services/TranscriptPostProcessor';

const SEGMENTATION_CORE_WORDS = 120;
const SEGMENTATION_CONTEXT_WORDS = 30;
const SEGMENTATION_CONCURRENCY = 3;

type TranscriptSegmentationWordPayload = {
	i: number;
	t: string;
	p: number;
	s: number;
	e: number;
	g?: number;
	l?: true;
	q?: string;
	v?: string;
};

export type TranscriptSegmentationBatch = {
	batchId: string;
	request: {
		timingQuality: 'word' | 'estimated';
		before: TranscriptSegmentationWordPayload[];
		core: TranscriptSegmentationWordPayload[];
		after: TranscriptSegmentationWordPayload[];
	};
};

type TranscriptSegmentationBatchResponse = {
	parsed: unknown;
};

/**
 * Convertit un token final en entrée compacte pour l'analyse sémantique.
 * @param {ProcessedTranscriptToken} token Token à convertir.
 * @param {ProcessedTranscriptToken | undefined} next Token suivant éventuel.
 * @param {number} speakerId Identifiant compact du speaker.
 * @returns {TranscriptSegmentationWordPayload} Mot horodaté et ses protections.
 */
function toSegmentationWordPayload(
	token: ProcessedTranscriptToken,
	next: ProcessedTranscriptToken | undefined,
	speakerId: number
): TranscriptSegmentationWordPayload {
	const payload: TranscriptSegmentationWordPayload = {
		i: token.id,
		t: `${token.text}${token.punctuationAfter}`,
		p: speakerId,
		s: Math.round(token.start * 1000) / 1000,
		e: Math.round(token.end * 1000) / 1000
	};
	if (next) payload.g = Math.round(Math.max(0, next.start - token.end) * 1000) / 1000;
	if (token.quran) {
		payload.q = `${token.quran.surah}:${token.quran.verse}`;
		if (!token.quran.waqf && token.quran.word !== token.quran.verseWordCount) payload.l = true;
	}
	if (token.quoteId !== null) payload.v = `${token.quoteType ?? 'generic'}-${token.quoteId}`;
	return payload;
}

/**
 * Construit des lots à cœur exclusif avec du contexte symétrique en lecture seule.
 * @param {ProcessedTranscriptToken[]} tokens Flux nettoyé dans son ordre final.
 * @param {'word' | 'estimated'} timingQuality Qualité des timestamps disponibles.
 * @returns {TranscriptSegmentationBatch[]} Lots indépendants couvrant chaque mot une seule fois.
 */
export function buildTranscriptSegmentationBatches(
	tokens: ProcessedTranscriptToken[],
	timingQuality: 'word' | 'estimated' = 'word'
): TranscriptSegmentationBatch[] {
	const speakers = new Map<string, number>();
	const payloads = tokens.map((token, index) => {
		if (!speakers.has(token.speaker)) speakers.set(token.speaker, speakers.size);
		return toSegmentationWordPayload(token, tokens[index + 1], speakers.get(token.speaker)!);
	});
	const batches: TranscriptSegmentationBatch[] = [];
	for (let start = 0; start < tokens.length; start += SEGMENTATION_CORE_WORDS) {
		const end = Math.min(tokens.length, start + SEGMENTATION_CORE_WORDS);
		batches.push({
			batchId: `transcript-segmentation-${batches.length + 1}-${tokens[start].id}`,
			request: {
				timingQuality,
				before: payloads.slice(Math.max(0, start - SEGMENTATION_CONTEXT_WORDS), start),
				core: payloads.slice(start, end),
				after: payloads.slice(end, end + SEGMENTATION_CONTEXT_WORDS)
			}
		});
	}
	return batches;
}

/**
 * Valide les coupures retournées pour le cœur exclusif d'un lot.
 * @param {TranscriptSegmentationBatch} batch Lot envoyé au provider.
 * @param {unknown} parsed Réponse JSON parsée.
 * @returns {{ boundaries: TranscriptSemanticBoundary[]; errors: string[] }} Coupures sûres et erreurs.
 */
export function validateTranscriptSegmentationBatch(
	batch: TranscriptSegmentationBatch,
	parsed: unknown
): { boundaries: TranscriptSemanticBoundary[]; errors: string[] } {
	const boundaries: TranscriptSemanticBoundary[] = [];
	const errors: string[] = [];
	const coreById = new Map(batch.request.core.map((word) => [word.i, word]));
	const coreOrder = new Map(batch.request.core.map((word, index) => [word.i, index]));
	const seen = new Set<number>();
	if (
		!parsed ||
		typeof parsed !== 'object' ||
		!Array.isArray((parsed as { boundaries?: unknown }).boundaries)
	) {
		return {
			boundaries,
			errors: ['AI returned an invalid semantic segmentation response.']
		};
	}
	const values = (parsed as { boundaries: unknown[] }).boundaries;
	for (const raw of values) {
		if (!raw || typeof raw !== 'object') {
			errors.push('AI returned an invalid semantic subtitle boundary.');
			continue;
		}
		const value = raw as { after?: unknown; kind?: unknown };
		const afterId = Number(value.after);
		const kind = value.kind as TranscriptSemanticBoundaryKind;
		const word = coreById.get(afterId);
		if (
			!Number.isInteger(afterId) ||
			!word ||
			word.l === true ||
			seen.has(afterId) ||
			(kind !== 'sentence' && kind !== 'clause' && kind !== 'phrase')
		) {
			errors.push('AI returned an invalid semantic subtitle boundary.');
			continue;
		}
		seen.add(afterId);
		boundaries.push({ afterId, kind });
	}
	boundaries.sort((left, right) => coreOrder.get(left.afterId)! - coreOrder.get(right.afterId)!);
	return { boundaries, errors };
}

/**
 * Analyse les coupures naturelles du transcript nettoyé avec le provider texte.
 * @param {ProcessedTranscriptToken[]} tokens Flux final avant segmentation.
 * @param {{ apiKey: string; endpoint: string; model: AdvancedTrimModel; reasoningEffort: AIReasoningEffort; thinkingEnabled?: boolean | null; timingQuality: 'word' | 'estimated' }} options Provider et qualité temporelle.
 * @returns {Promise<{ boundaries: TranscriptSemanticBoundary[]; errors: string[] }>} Coupures sémantiques validées.
 */
export async function analyzeTranscriptSemanticBoundaries(
	tokens: ProcessedTranscriptToken[],
	options: {
		apiKey: string;
		endpoint: string;
		model: AdvancedTrimModel;
		reasoningEffort: AIReasoningEffort;
		thinkingEnabled?: boolean | null;
		timingQuality: 'word' | 'estimated';
	}
): Promise<{ boundaries: TranscriptSemanticBoundary[]; errors: string[] }> {
	const batches = buildTranscriptSegmentationBatches(tokens, options.timingQuality);
	const boundaries: TranscriptSemanticBoundary[] = [];
	const errors: string[] = [];
	let nextBatch = 0;
	/**
	 * Traite les prochains lots disponibles jusqu'à épuisement de la file partagée.
	 * @returns {Promise<void>} Fin du worker.
	 */
	const runWorker = async (): Promise<void> => {
		while (nextBatch < batches.length) {
			const batch = batches[nextBatch++];
			try {
				const response = await invoke<TranscriptSegmentationBatchResponse>(
					'run_ai_transcript_segmentation_batch_streaming',
					{
						request: {
							apiKey: options.apiKey,
							endpoint: options.endpoint,
							model: options.model,
							reasoningEffort: options.reasoningEffort,
							thinkingEnabled: options.thinkingEnabled ?? null,
							batchId: batch.batchId,
							batch: batch.request
						}
					}
				);
				const validation = validateTranscriptSegmentationBatch(batch, response.parsed);
				boundaries.push(...validation.boundaries);
				errors.push(...validation.errors);
			} catch (error) {
				errors.push(
					`AI semantic segmentation batch failed: ${error instanceof Error ? error.message : String(error)}`
				);
			}
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(SEGMENTATION_CONCURRENCY, batches.length) }, () => runWorker())
	);
	return { boundaries, errors };
}
