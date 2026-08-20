import { invoke } from '@tauri-apps/api/core';

import { SubtitleClip, TrackType, type Edition, type Project } from '$lib/classes';
import { getTranslationTrimUnits, type VerseTranslation } from '$lib/classes/Translation.svelte';
import { globalState } from '$lib/runes/main.svelte';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import type {
	AdvancedTrimModel,
	AdvancedTrimReasoningEffort,
	AdvancedTrimUsage
} from './AdvancedAITrimming';

export type AiTranslationReviewReason =
	| 'out_of_bounds'
	| 'source_mismatch'
	| 'semantic_mismatch'
	| 'missing_meaning'
	| 'excess_meaning'
	| 'overlap_mismatch'
	| 'repetition_mismatch';

export type AiTranslationReviewSegment = {
	id: number;
	edition: Edition;
	arabicStart: number;
	arabicEnd: number;
	arabic: string;
	wordByWordEnglish: string[];
	isFullVerse: boolean;
	selectedTranslation: string;
	selectedRange: [number, number] | null;
	isCustomText: boolean;
	subtitle: SubtitleClip;
	translation: VerseTranslation;
};

export type AiTranslationReviewVerseCandidate = {
	edition: Edition;
	editionLanguage: string;
	verseKey: string;
	sourceTranslation: string;
	wordCount: number;
	segments: AiTranslationReviewSegment[];
};

export type AiTranslationReviewBatch = {
	batchId: string;
	wordCount: number;
	verses: AiTranslationReviewVerseCandidate[];
	request: {
		verses: Array<{
			editionLanguage: string;
			verseKey: string;
			sourceTranslation: string;
			segments: Array<{
				id: number;
				arabicStart: number;
				arabicEnd: number;
				arabic: string;
				wordByWordEnglish: string[];
				isFullVerse: boolean;
				selectedTranslation: string;
				selectedRange: [number, number] | null;
				isCustomText: boolean;
			}>;
		}>;
	};
};

export type AiTranslationReviewBatchResponse = {
	batchId: string;
	rawText: string;
	parsed: unknown;
	usage?: AdvancedTrimUsage;
};

export type AiTranslationReviewIssue = {
	candidate: AiTranslationReviewSegment;
	reason: AiTranslationReviewReason;
};

export type AiTranslationReviewValidationReport = {
	issues: AiTranslationReviewIssue[];
	errors: string[];
};

const DEFAULT_MAX_BATCH_WORDS = 500;
const REVIEW_REASONS = new Set<AiTranslationReviewReason>([
	'out_of_bounds',
	'source_mismatch',
	'semantic_mismatch',
	'missing_meaning',
	'excess_meaning',
	'overlap_mismatch',
	'repetition_mismatch'
]);

/**
 * Indexe les unités sélectionnables d'une traduction sans en modifier le texte.
 *
 * @param {string} text Traduction source complète.
 * @returns {string} Unités préfixées par leur index.
 */
function buildIndexedTranslation(text: string): string {
	return getTranslationTrimUnits(text)
		.map((unit, index) => `${index}:${unit.text}`)
		.join(' ');
}

/**
 * Construit tous les versets et segments de traduction à faire vérifier par l'IA.
 *
 * @param {Project} project Projet à inspecter.
 * @returns {AiTranslationReviewVerseCandidate[]} Candidats groupés par édition et verset.
 */
export function buildAiTranslationReviewCandidates(
	project: Project = globalState.currentProject!
): AiTranslationReviewVerseCandidate[] {
	const subtitles = project.content.timeline
		.getFirstTrack(TrackType.Subtitle)
		.clips.filter((clip): clip is SubtitleClip => clip instanceof SubtitleClip);
	const projectTranslation = project.content.projectTranslation;
	const candidates: AiTranslationReviewVerseCandidate[] = [];
	let segmentId = 0;

	for (const edition of projectTranslation.addedTranslationEditions) {
		const grouped = new Map<string, SubtitleClip[]>();
		for (const subtitle of subtitles) {
			const clips = grouped.get(subtitle.getVerseKey());
			if (clips) clips.push(subtitle);
			else grouped.set(subtitle.getVerseKey(), [subtitle]);
		}

		for (const [verseKey, verseSubtitles] of grouped) {
			const sourceTranslation = projectTranslation.getVerseTranslation(edition, verseKey).trim();
			if (!sourceTranslation || sourceTranslation === 'No translation found') continue;

			const segments = verseSubtitles
				.map((subtitle) => {
					const translation = subtitle.translations[edition.name] as VerseTranslation | undefined;
					if (!translation?.text.trim()) return null;

					const segment: AiTranslationReviewSegment = {
						id: segmentId++,
						edition,
						arabicStart: subtitle.startWordIndex,
						arabicEnd: subtitle.endWordIndex,
						arabic: subtitle.text,
						wordByWordEnglish: subtitle.wbwTranslation ?? [],
						isFullVerse: subtitle.isFullVerse,
						selectedTranslation: translation.text,
						selectedRange: translation.isBruteForce
							? null
							: [translation.startWordIndex, translation.endWordIndex],
						isCustomText: translation.isBruteForce,
						subtitle,
						translation
					};
					return segment;
				})
				.filter((segment): segment is AiTranslationReviewSegment => Boolean(segment));
			if (segments.length === 0) continue;

			candidates.push({
				edition,
				editionLanguage: edition.language,
				verseKey,
				sourceTranslation,
				wordCount:
					getTranslationTrimUnits(sourceTranslation).length +
					segments.reduce(
						(total, segment) => total + getTranslationTrimUnits(segment.selectedTranslation).length,
						0
					),
				segments
			});
		}
	}

	return candidates;
}

/**
 * Découpe les candidats en lots sans séparer les segments d'un même verset.
 *
 * @param {AiTranslationReviewVerseCandidate[]} candidates Versets à vérifier.
 * @param {number} maxBatchWords Nombre maximal de mots de traduction par requête.
 * @returns {AiTranslationReviewBatch[]} Lots prêts à envoyer.
 */
export function buildAiTranslationReviewBatches(
	candidates: AiTranslationReviewVerseCandidate[],
	maxBatchWords: number = DEFAULT_MAX_BATCH_WORDS
): AiTranslationReviewBatch[] {
	const limit = Number.isFinite(maxBatchWords)
		? Math.max(1, Math.floor(maxBatchWords))
		: DEFAULT_MAX_BATCH_WORDS;
	const batches: AiTranslationReviewBatch[] = [];
	let current: AiTranslationReviewVerseCandidate[] = [];
	let currentWordCount = 0;

	/**
	 * Ajoute le lot courant à la liste lorsqu'il contient au moins un verset.
	 *
	 * @returns {void}
	 */
	function pushCurrentBatch(): void {
		if (current.length === 0) return;
		const batchNumber = batches.length + 1;
		batches.push({
			batchId: `ai-translation-review-${batchNumber}`,
			wordCount: currentWordCount,
			verses: current,
			request: {
				verses: current.map((verse) => ({
					editionLanguage: verse.editionLanguage,
					verseKey: verse.verseKey,
					sourceTranslation: buildIndexedTranslation(verse.sourceTranslation),
					segments: verse.segments.map((segment) => ({
						id: segment.id,
						arabicStart: segment.arabicStart,
						arabicEnd: segment.arabicEnd,
						arabic: segment.arabic,
						wordByWordEnglish: segment.wordByWordEnglish,
						isFullVerse: segment.isFullVerse,
						selectedTranslation: segment.selectedTranslation,
						selectedRange: segment.selectedRange,
						isCustomText: segment.isCustomText
					}))
				}))
			}
		});
		current = [];
		currentWordCount = 0;
	}

	for (const candidate of candidates) {
		if (current.length > 0 && currentWordCount + candidate.wordCount > limit) {
			pushCurrentBatch();
		}
		current.push(candidate);
		currentWordCount += candidate.wordCount;
		if (candidate.wordCount > limit) pushCurrentBatch();
	}
	pushCurrentBatch();

	return batches;
}

/**
 * Valide les seuls segments signalés par l'IA et rejette tout identifiant inattendu.
 *
 * @param {AiTranslationReviewBatch} batch Lot correspondant à la réponse.
 * @param {unknown} parsed Réponse JSON déjà parsée.
 * @returns {AiTranslationReviewValidationReport} Signalements valides et erreurs de structure.
 */
export function validateAiTranslationReviewBatchResult(
	batch: AiTranslationReviewBatch,
	parsed: unknown
): AiTranslationReviewValidationReport {
	const issues: AiTranslationReviewIssue[] = [];
	const errors: string[] = [];
	if (!parsed || typeof parsed !== 'object') {
		return { issues, errors: ['AI response is not a JSON object.'] };
	}

	const issueValues = (parsed as Record<string, unknown>).issues;
	if (!Array.isArray(issueValues)) {
		return { issues, errors: ['AI response is missing the "issues" array.'] };
	}

	const candidates = new Map(
		batch.verses.flatMap((verse) => verse.segments).map((segment) => [segment.id, segment])
	);
	const seen = new Set<number>();
	for (const issueValue of issueValues) {
		if (!issueValue || typeof issueValue !== 'object') {
			errors.push('AI response contains an invalid issue entry.');
			continue;
		}
		const issue = issueValue as Record<string, unknown>;
		const id = Number(issue.id);
		const reason = String(issue.reason ?? '') as AiTranslationReviewReason;
		const candidate = candidates.get(id);
		if (!Number.isInteger(id) || !candidate) {
			errors.push(`AI response contains unexpected segment id ${String(issue.id)}.`);
			continue;
		}
		if (seen.has(id)) {
			errors.push(`AI response contains duplicate segment id ${id}.`);
			continue;
		}
		if (!REVIEW_REASONS.has(reason)) {
			errors.push(`Segment ${id} has unsupported review reason "${reason}".`);
			continue;
		}
		seen.add(id);
		issues.push({ candidate, reason });
	}

	return { issues, errors };
}

/**
 * Marque les traductions signalées dans une seule entrée d'historique undo/redo.
 *
 * @param {AiTranslationReviewIssue[]} issues Signalements validés à appliquer.
 * @returns {number} Nombre de traductions nouvellement marquées.
 */
export function applyAiTranslationReviewIssues(issues: AiTranslationReviewIssue[]): number {
	const uniqueIssues = [...new Map(issues.map((issue) => [issue.candidate.id, issue])).values()];
	return ProjectHistoryManager.track('Mark AI translation issues for review', () => {
		let marked = 0;
		for (const issue of uniqueIssues) {
			if (issue.candidate.translation.status === 'to review') continue;
			issue.candidate.translation.updateStatus('to review', issue.candidate.edition);
			marked++;
		}
		return marked;
	});
}

/**
 * Envoie un lot de vérification au fournisseur IA configuré.
 *
 * @param {{ apiKey: string; endpoint: string; model: AdvancedTrimModel; reasoningEffort: AdvancedTrimReasoningEffort; batchId: string; batch: AiTranslationReviewBatch['request'] }} params Paramètres du fournisseur et contenu du lot.
 * @returns {Promise<AiTranslationReviewBatchResponse>} Réponse structurée du backend.
 */
export async function runAiTranslationReviewBatch(params: {
	apiKey: string;
	endpoint: string;
	model: AdvancedTrimModel;
	reasoningEffort: AdvancedTrimReasoningEffort;
	batchId: string;
	batch: AiTranslationReviewBatch['request'];
}): Promise<AiTranslationReviewBatchResponse> {
	const result = await invoke('run_ai_translation_review_batch_streaming', {
		request: {
			apiKey: params.apiKey,
			endpoint: params.endpoint,
			model: params.model,
			reasoningEffort: params.reasoningEffort,
			batchId: params.batchId,
			batch: params.batch
		}
	});

	return result as AiTranslationReviewBatchResponse;
}
