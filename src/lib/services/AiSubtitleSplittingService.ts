import { invoke } from '@tauri-apps/api/core';

import { Quran } from '$lib/classes/Quran';
import { SubtitleClip, TrackType, type Project } from '$lib/classes';
import { globalState } from '$lib/runes/main.svelte';
import {
	getSubtitleClipWordCount,
	refreshSegmentationContextFromTrack,
	splitSubtitleClipLocally
} from '$lib/services/AutoSegmentation';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import type {
	AdvancedTrimModel,
	AdvancedTrimReasoningEffort,
	AdvancedTrimUsage
} from '$lib/services/AdvancedAITrimming';

export type AiSubtitleSplitWord = {
	index: number;
	arabic: string;
};

export type AiSubtitleSplitCandidate = {
	segmentIndex: number;
	verseKey: string;
	startTime: number;
	endTime: number;
	wordCount: number;
	maxWords: number;
	words: AiSubtitleSplitWord[];
	subtitle: SubtitleClip;
};

export type AiSubtitleSplitBatch = {
	batchId: string;
	wordCount: number;
	resultingChunkCount: number;
	segments: AiSubtitleSplitCandidate[];
	request: {
		s: Array<{
			i: number;
			v: string;
			m: number;
			w: string;
		}>;
	};
};

export type AiSubtitleSplitBatchResponse = {
	batchId: string;
	rawText: string;
	parsed: unknown;
	usage?: AdvancedTrimUsage;
};

export type AiSubtitleSplitValidationSuccess = {
	candidate: AiSubtitleSplitCandidate;
	chunkEndWordIndexes: number[];
};

export type AiSubtitleSplitValidationReport = {
	validSegments: AiSubtitleSplitValidationSuccess[];
	errors: string[];
};

export type AiSubtitleSplitApplyReport = {
	appliedSegments: number;
	appliedSplits: number;
	erroredSegments: number;
	errors: string[];
};

const MAX_BATCH_WORDS = 500;

/**
 * Construit les candidats dépassant la limite de mots avec leurs mots arabes indexés.
 *
 * @param {number} maxWords Nombre maximal de mots par chunk.
 * @param {Project} [project] Projet explicite à inspecter hors éditeur.
 * @returns {Promise<AiSubtitleSplitCandidate[]>} Candidats triés dans l'ordre de la timeline.
 */
export async function buildAiSubtitleSplitCandidates(
	maxWords: number,
	project?: Project
): Promise<AiSubtitleSplitCandidate[]> {
	const candidates: AiSubtitleSplitCandidate[] = [];
	const verses = new Map<string, Awaited<ReturnType<typeof Quran.getVerse>>>();
	const subtitles = project
		? project.content.timeline
				.getFirstTrack(TrackType.Subtitle)
				.clips.filter((clip): clip is SubtitleClip => clip instanceof SubtitleClip)
		: globalState.getSubtitleClips;

	for (const subtitle of [...subtitles].sort((left, right) => left.startTime - right.startTime)) {
		const wordCount = getSubtitleClipWordCount(subtitle);
		if (!subtitle.alignmentMetadata || wordCount <= maxWords) continue;

		const verseKey = subtitle.getVerseKey();
		let verse = verses.get(verseKey);
		if (!verses.has(verseKey)) {
			verse = await Quran.getVerse(subtitle.surah, subtitle.verse);
			verses.set(verseKey, verse);
		}
		if (!verse) continue;

		const words = verse.words
			.slice(subtitle.startWordIndex, subtitle.endWordIndex + 1)
			.map((word, offset) => ({
				index: subtitle.startWordIndex + offset,
				arabic: word.arabic
			}));
		if (words.length !== wordCount) continue;

		candidates.push({
			segmentIndex: candidates.length,
			verseKey,
			startTime: subtitle.startTime,
			endTime: subtitle.endTime,
			wordCount,
			maxWords,
			words,
			subtitle
		});
	}

	return candidates;
}

/**
 * Regroupe les candidats en lots adaptés au traitement IA.
 *
 * @param {AiSubtitleSplitCandidate[]} candidates Candidats à regrouper.
 * @returns {AiSubtitleSplitBatch[]} Lots plafonnés en nombre de mots.
 */
export function buildAiSubtitleSplitBatches(
	candidates: AiSubtitleSplitCandidate[]
): AiSubtitleSplitBatch[] {
	const batches: AiSubtitleSplitBatch[] = [];
	let current: AiSubtitleSplitCandidate[] = [];
	let currentWordCount = 0;

	/**
	 * Ajoute le lot courant s'il contient au moins un segment.
	 *
	 * @returns {void}
	 */
	function pushCurrentBatch(): void {
		if (current.length === 0) return;
		const batchNumber = batches.length + 1;
		batches.push({
			batchId: `ai-subtitle-split-batch-${batchNumber}-${current[0].segmentIndex}`,
			wordCount: currentWordCount,
			resultingChunkCount: current.reduce(
				(total, candidate) => total + Math.ceil(candidate.wordCount / candidate.maxWords),
				0
			),
			segments: current,
			request: {
				s: current.map((candidate) => ({
					i: candidate.segmentIndex,
					v: candidate.verseKey,
					m: candidate.maxWords,
					w: candidate.words.map((word) => `${word.index}:${word.arabic}`).join(' ')
				}))
			}
		});
		current = [];
		currentWordCount = 0;
	}

	for (const candidate of candidates) {
		if (current.length > 0 && currentWordCount + candidate.wordCount > MAX_BATCH_WORDS) {
			pushCurrentBatch();
		}
		current.push(candidate);
		currentWordCount += candidate.wordCount;
		if (candidate.wordCount > MAX_BATCH_WORDS) pushCurrentBatch();
	}

	pushCurrentBatch();
	return batches;
}

/**
 * Valide strictement les fins de chunks renvoyées par l'IA.
 *
 * @param {AiSubtitleSplitBatch} batch Lot source.
 * @param {unknown} parsed Réponse JSON inconnue.
 * @returns {AiSubtitleSplitValidationReport} Segments valides et erreurs détectées.
 */
export function validateAiSubtitleSplitBatchResult(
	batch: AiSubtitleSplitBatch,
	parsed: unknown
): AiSubtitleSplitValidationReport {
	const validSegments: AiSubtitleSplitValidationSuccess[] = [];
	const errors: string[] = [];
	if (!parsed || typeof parsed !== 'object') {
		return { validSegments, errors: ['AI response is not a JSON object.'] };
	}

	const segmentsValue = (parsed as Record<string, unknown>).s;
	if (!Array.isArray(segmentsValue)) {
		return { validSegments, errors: ['AI response is missing the "s" array.'] };
	}

	const responseMap = new Map<number, number[]>();
	for (const segmentValue of segmentsValue) {
		if (!segmentValue || typeof segmentValue !== 'object') {
			errors.push('AI response contains an invalid segment entry.');
			continue;
		}

		const record = segmentValue as Record<string, unknown>;
		const segmentIndex = Number(record.i);
		const candidate = batch.segments.find((segment) => segment.segmentIndex === segmentIndex);
		if (!Number.isSafeInteger(segmentIndex) || !candidate) {
			errors.push(`Segment ${segmentIndex}: unexpected segment returned by AI.`);
			continue;
		}
		if (responseMap.has(segmentIndex)) {
			errors.push(`Segment ${segmentIndex}: duplicate entry in AI response.`);
			continue;
		}

		const indexesValue = record.e;
		if (!Array.isArray(indexesValue) || !indexesValue.every(Number.isSafeInteger)) {
			errors.push(`Segment ${segmentIndex}: chunkEndWordIndexes must contain integers only.`);
			continue;
		}
		const indexes = indexesValue as number[];
		const expectedChunkCount = Math.ceil(candidate.wordCount / candidate.maxWords);
		if (indexes.length !== expectedChunkCount) {
			errors.push(
				`Segment ${segmentIndex}: expected ${expectedChunkCount} chunk end indexes, received ${indexes.length}.`
			);
			continue;
		}

		let previousEnd = candidate.subtitle.startWordIndex - 1;
		let boundaryError: string | null = null;
		for (const index of indexes) {
			const chunkWordCount = index - previousEnd;
			if (
				index <= previousEnd ||
				index > candidate.subtitle.endWordIndex ||
				chunkWordCount > candidate.maxWords
			) {
				boundaryError = `Segment ${segmentIndex}: invalid chunk boundary ${index}.`;
				break;
			}
			previousEnd = index;
		}
		if (boundaryError || previousEnd !== candidate.subtitle.endWordIndex) {
			errors.push(
				boundaryError ??
					`Segment ${segmentIndex}: the final chunk must end at word ${candidate.subtitle.endWordIndex}.`
			);
			continue;
		}

		responseMap.set(segmentIndex, indexes);
	}

	for (const candidate of batch.segments) {
		const chunkEndWordIndexes = responseMap.get(candidate.segmentIndex);
		if (!chunkEndWordIndexes) {
			if (!errors.some((error) => error.startsWith(`Segment ${candidate.segmentIndex}:`))) {
				errors.push(`Segment ${candidate.segmentIndex}: missing from AI response.`);
			}
			continue;
		}
		validSegments.push({ candidate, chunkEndWordIndexes });
	}

	return { validSegments, errors };
}

/**
 * Vérifie que chaque coupe proposée possède un timestamp et garde des chunks d'au moins 100 ms.
 *
 * @param {AiSubtitleSplitValidationSuccess} success Proposition validée à inspecter.
 * @returns {string | null} Message d'erreur ou null.
 */
function validateSplitTimings(success: AiSubtitleSplitValidationSuccess): string | null {
	const { candidate, chunkEndWordIndexes } = success;
	const metadata = candidate.subtitle.alignmentMetadata;
	if (!metadata) return `Segment ${candidate.segmentIndex}: word timestamps are missing.`;

	const boundaries = chunkEndWordIndexes.slice(0, -1);
	const splitTimes = boundaries.map((index) => {
		const word = metadata.words.find(
			(metadataWord) => metadataWord.location === `${candidate.verseKey}:${index + 1}`
		);
		return word ? Math.round((metadata.timeFrom + word.end) * 1000) : null;
	});
	if (splitTimes.some((time) => time === null)) {
		return `Segment ${candidate.segmentIndex}: a selected word timestamp is missing.`;
	}

	const times = [
		candidate.subtitle.startTime,
		...(splitTimes as number[]),
		candidate.subtitle.endTime
	];
	if (times.some((time, index) => index > 0 && time - times[index - 1] < 100)) {
		return `Segment ${candidate.segmentIndex}: a selected boundary would create a chunk shorter than 100ms.`;
	}
	return null;
}

/**
 * Applique les coupes IA valides dans une seule transaction undo/redo.
 *
 * @param {AiSubtitleSplitValidationSuccess[]} validSegments Propositions à appliquer.
 * @param {Project} [project] Projet explicite à modifier hors éditeur.
 * @returns {Promise<AiSubtitleSplitApplyReport>} Résultat détaillé de l'application.
 */
export async function applyAiSubtitleSplitValidationSuccess(
	validSegments: AiSubtitleSplitValidationSuccess[],
	project?: Project
): Promise<AiSubtitleSplitApplyReport> {
	const errors: string[] = [];
	let appliedSegments = 0;
	let appliedSplits = 0;
	let erroredSegments = 0;

	if (!project) ProjectHistoryManager.begin('AI split long subtitles');
	try {
		for (const success of validSegments) {
			const timingError = validateSplitTimings(success);
			if (timingError) {
				errors.push(timingError);
				erroredSegments++;
				continue;
			}

			let segmentSplits = 0;
			for (const splitWordIndex of success.chunkEndWordIndexes.slice(0, -1).reverse()) {
				const rightClip = await splitSubtitleClipLocally(
					success.candidate.subtitle,
					splitWordIndex,
					project
				);
				if (!rightClip) break;
				segmentSplits++;
			}

			const expectedSplits = success.chunkEndWordIndexes.length - 1;
			if (segmentSplits !== expectedSplits) {
				errors.push(`Segment ${success.candidate.segmentIndex}: unable to apply every boundary.`);
				erroredSegments++;
				continue;
			}
			appliedSegments++;
			appliedSplits += segmentSplits;
		}

		if (appliedSplits > 0) {
			refreshSegmentationContextFromTrack(false, project);
			if (!project) {
				globalState.currentProject?.detail.updateVideoDetailAttributes();
				globalState.updateVideoPreviewUI();
			}
		}
	} finally {
		if (!project) ProjectHistoryManager.commit();
	}

	return { appliedSegments, appliedSplits, erroredSegments, errors };
}

/**
 * Lance un lot de découpage sémantique via la configuration IA existante.
 *
 * @param {object} params Paramètres d'appel du fournisseur IA.
 * @param {string} params.apiKey Clé API.
 * @param {string} params.endpoint Endpoint texte.
 * @param {AdvancedTrimModel} params.model Modèle texte.
 * @param {AdvancedTrimReasoningEffort} params.reasoningEffort Effort de raisonnement.
 * @param {string} params.batchId Identifiant du lot.
 * @param {AiSubtitleSplitBatch['request']} params.batch Payload du lot.
 * @returns {Promise<AiSubtitleSplitBatchResponse>} Réponse JSON et métriques d'usage.
 */
export async function runAiSubtitleSplitBatchStreaming(params: {
	apiKey: string;
	endpoint: string;
	model: AdvancedTrimModel;
	reasoningEffort: AdvancedTrimReasoningEffort;
	batchId: string;
	batch: AiSubtitleSplitBatch['request'];
}): Promise<AiSubtitleSplitBatchResponse> {
	const result = await invoke('run_advanced_ai_subtitle_split_batch_streaming', {
		request: {
			apiKey: params.apiKey,
			endpoint: params.endpoint,
			model: params.model,
			reasoningEffort: params.reasoningEffort,
			batchId: params.batchId,
			batch: params.batch
		}
	});

	return result as AiSubtitleSplitBatchResponse;
}
