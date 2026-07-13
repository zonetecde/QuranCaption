import { invoke } from '@tauri-apps/api/core';
import type { AITranscriptionResult, AITranscriptionSegment } from '$lib/services/AITranscription';
import { validateTranscriptQuranReferences } from '$lib/services/TranscriptReferenceService';
import type {
	AdvancedTrimModel,
	AdvancedTrimReasoningEffort
} from '$lib/services/AdvancedAITrimming';

const MAX_BATCH_WORDS = 150;

type TranscriptCleanupCandidate = {
	segmentIndex: number;
	segment: AITranscriptionSegment;
};

export type TranscriptCleanupBatch = {
	batchId: string;
	segments: TranscriptCleanupCandidate[];
	request: {
		addDiacritics: boolean;
		s: Array<{ i: number; p: string; t: string }>;
	};
};

type TranscriptCleanupBatchResponse = {
	parsed: unknown;
};

export type TranscriptCleanupReport = {
	result: AITranscriptionResult;
	errors: string[];
	processedSegments: number;
	totalSegments: number;
};

/**
 * Compte approximativement les mots d'un texte pour limiter les batches.
 * @param {string} text Texte à mesurer.
 * @returns {number} Nombre de mots non vides.
 */
function countWords(text: string): number {
	return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Construit des batches contigus de nettoyage de transcription.
 * @param {AITranscriptionSegment[]} segments Segments WhisperX.
 * @param {boolean} addDiacritics Indique si l'IA doit ajouter les voyelles.
 * @param {Record<string, string>} speakerMap Noms attribués aux identifiants de voix.
 * @returns {TranscriptCleanupBatch[]} Batches prêts à envoyer.
 */
export function buildTranscriptCleanupBatches(
	segments: AITranscriptionSegment[],
	addDiacritics: boolean,
	speakerMap: Record<string, string> = {}
): TranscriptCleanupBatch[] {
	const batches: TranscriptCleanupBatch[] = [];
	let current: TranscriptCleanupCandidate[] = [];
	let currentWordCount = 0;

	/**
	 * Ajoute le batch courant à la liste.
	 * @returns {void}
	 */
	function pushCurrentBatch(): void {
		if (current.length === 0) return;
		const batchNumber = batches.length + 1;
		batches.push({
			batchId: `transcript-cleanup-${batchNumber}-${current[0].segmentIndex}`,
			segments: current,
			request: {
				addDiacritics,
				s: current.map((candidate) => ({
					i: candidate.segmentIndex,
					p: speakerMap[candidate.segment.speaker] ?? candidate.segment.speaker,
					t: candidate.segment.text
				}))
			}
		});
		current = [];
		currentWordCount = 0;
	}

	for (const [segmentIndex, segment] of segments.entries()) {
		const wordCount = Math.max(1, countWords(segment.text));
		if (current.length > 0 && currentWordCount + wordCount > MAX_BATCH_WORDS) pushCurrentBatch();
		current.push({ segmentIndex, segment });
		currentWordCount += wordCount;
		if (wordCount > MAX_BATCH_WORDS) pushCurrentBatch();
	}
	pushCurrentBatch();
	return batches;
}

/**
 * Valide et extrait les textes retournés pour un batch.
 * @param {TranscriptCleanupBatch} batch Batch source.
 * @param {unknown} parsed Réponse JSON parsée.
 * @returns {Promise<{ texts: Map<number, string>; errors: string[] }>} Textes valides et erreurs.
 */
async function validateTranscriptCleanupBatch(
	batch: TranscriptCleanupBatch,
	parsed: unknown
): Promise<{ texts: Map<number, string>; errors: string[] }> {
	const texts = new Map<number, string>();
	const errors: string[] = [];
	if (!parsed || typeof parsed !== 'object') {
		return { texts, errors: ['AI response is not a JSON object.'] };
	}

	const values = (parsed as Record<string, unknown>).s;
	if (!Array.isArray(values)) return { texts, errors: ['AI response is missing the "s" array.'] };
	const expected = new Set(batch.segments.map((candidate) => candidate.segmentIndex));

	for (const value of values) {
		if (!value || typeof value !== 'object') {
			errors.push('AI response contains an invalid segment.');
			continue;
		}
		const record = value as Record<string, unknown>;
		const segmentIndex = Number(record.i);
		const text = typeof record.t === 'string' ? record.t.trim() : '';
		if (!Number.isInteger(segmentIndex) || !expected.has(segmentIndex) || !text) {
			errors.push(`Invalid transcript cleanup segment ${String(record.i)}.`);
			continue;
		}
		if (texts.has(segmentIndex)) {
			errors.push(`Duplicate transcript cleanup segment ${segmentIndex}.`);
			continue;
		}
		const referenceError = await validateTranscriptQuranReferences(text);
		if (referenceError) {
			errors.push(`Segment ${segmentIndex}: ${referenceError}`);
			continue;
		}
		texts.set(segmentIndex, text);
	}

	for (const segmentIndex of expected) {
		if (!texts.has(segmentIndex)) errors.push(`Segment ${segmentIndex} was not safely rewritten.`);
	}
	return { texts, errors };
}

/**
 * Nettoie une transcription en batches et conserve les segments invalides d'origine.
 * @param {AITranscriptionResult} result Résultat WhisperX courant.
 * @param {{ apiKey: string; endpoint: string; model: AdvancedTrimModel; reasoningEffort: AdvancedTrimReasoningEffort; addDiacritics: boolean; speakerMap?: Record<string, string>; onProgress?: (current: number, total: number, batchId: string) => void }} options Options provider et progression.
 * @returns {Promise<TranscriptCleanupReport>} Transcription nettoyée et rapport.
 */
export async function cleanupAITranscript(
	result: AITranscriptionResult,
	options: {
		apiKey: string;
		endpoint: string;
		model: AdvancedTrimModel;
		reasoningEffort: AdvancedTrimReasoningEffort;
		addDiacritics: boolean;
		speakerMap?: Record<string, string>;
		onProgress?: (current: number, total: number, batchId: string) => void;
	}
): Promise<TranscriptCleanupReport> {
	const batches = buildTranscriptCleanupBatches(
		result.segments,
		options.addDiacritics,
		options.speakerMap
	);
	const cleanedTexts = new Map<number, string>();
	const errors: string[] = [];

	for (const [batchIndex, batch] of batches.entries()) {
		options.onProgress?.(batchIndex + 1, batches.length, batch.batchId);
		try {
			const response = (await invoke('run_ai_transcript_cleanup_batch_streaming', {
				request: {
					apiKey: options.apiKey,
					endpoint: options.endpoint,
					model: options.model,
					reasoningEffort: options.reasoningEffort,
					batchId: batch.batchId,
					batch: batch.request
				}
			})) as TranscriptCleanupBatchResponse;
			const validation = await validateTranscriptCleanupBatch(batch, response.parsed);
			for (const [segmentIndex, text] of validation.texts) cleanedTexts.set(segmentIndex, text);
			errors.push(...validation.errors);
		} catch (error) {
			errors.push(error instanceof Error ? error.message : String(error));
		}
	}

	return {
		result: {
			...result,
			segments: result.segments.map((segment, index) => ({
				...segment,
				text: cleanedTexts.get(index) ?? segment.text
			}))
		},
		errors,
		processedSegments: cleanedTexts.size,
		totalSegments: result.segments.length
	};
}
