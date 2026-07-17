import { invoke } from '@tauri-apps/api/core';

import type { Edition, SubtitleClip } from '$lib/classes';
import type { IslamicTermTranslationMode } from '$lib/classes/Settings.svelte';
import {
	getTranslationTrimUnits,
	sliceTranslationTrimUnits,
	type QuranTranslationSegment,
	type VerseTranslation
} from '$lib/classes/Translation.svelte';
import { globalState } from '$lib/runes/main.svelte';
import MinimalQuranProvider from '$lib/services/MinimalQuranProvider';
import {
	getStructuredTranslationDraft,
	isCompleteQuranOnlySubtitle,
	serializeStructuredTranslation,
	type StructuredTranslationAnchor
} from '$lib/services/StructuredTranslationService';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import { WbwTranslationService } from '$lib/services/WbwTranslationService';

const MAX_BATCH_WORDS = 450;
const CONTEXT_CLIP_COUNT = 2;

export type AIProjectTranslationOptions = {
	retryErrors: boolean;
	overwriteAiTranslated: boolean;
	overwriteReviewed: boolean;
	overwriteManualQuran: boolean;
};

export type AIProjectTranslationContextItem = {
	i: number;
	s: string;
	t: string;
};

export type AIProjectTranslationAnchorPayload = {
	i: string;
	k: 'c' | 'q';
	s: string;
	r?: string;
	f?: boolean;
	l?: boolean;
	a?: string;
	u?: string[];
	w?: string[];
};

export type AIProjectTranslationItemPayload = {
	i: number;
	f: string[];
	a: AIProjectTranslationAnchorPayload[];
};

export type AIProjectTranslationBatch = {
	batchId: string;
	candidates: AIProjectTranslationCandidate[];
	request: {
		b: AIProjectTranslationContextItem[];
		i: AIProjectTranslationItemPayload[];
		a: AIProjectTranslationContextItem[];
	};
	wordCount: number;
};

export type AIProjectTranslationBatchResponse = {
	batchId: string;
	rawText: string;
	parsed: unknown;
	usage?: {
		inputTokens?: number;
		outputTokens?: number;
		totalTokens?: number;
		reasoningTokens?: number;
	};
};

type AIProjectTranslationQuranExpectation = {
	anchor: StructuredTranslationAnchor;
	unitCount: number;
	locked: boolean;
	fullVerse: boolean;
	resetToFullVerse: boolean;
};

export type AIProjectTranslationCandidate = {
	subtitle: SubtitleClip;
	translation: VerseTranslation;
	payload: AIProjectTranslationItemPayload;
	citationIds: string[];
	quranExpectations: AIProjectTranslationQuranExpectation[];
	wordCount: number;
};

export type AIProjectTranslationSuccess = {
	candidate: AIProjectTranslationCandidate;
	freeTexts: string[];
	citations: Record<string, string>;
	quranRanges: Record<string, { startUnitIndex: number; endUnitIndex: number }>;
};

export type AIProjectTranslationValidationReport = {
	validItems: AIProjectTranslationSuccess[];
	errors: string[];
};

export type AIProjectTranslationApplyReport = {
	appliedSubtitles: number;
};

/**
 * Compte grossièrement les mots d'un texte pour limiter la taille des batches.
 * @param {string} text Texte source.
 * @returns {number} Nombre minimal de mots comptabilisés.
 */
function countWords(text: string): number {
	return Math.max(1, text.trim().split(/\s+/u).filter(Boolean).length);
}

/**
 * Compte les mots source utilisés pour découper un sous-titre de traduction IA.
 * @param {SubtitleClip} subtitle Sous-titre à inclure dans un batch.
 * @returns {number} Nombre de mots pris en compte pour le découpage.
 */
function getTranslationBatchWordCount(subtitle: SubtitleClip): number {
	const draft = getStructuredTranslationDraft(subtitle.text, '');
	return countWords(
		[...draft.sourceFreeTexts, ...draft.anchors.map((anchor) => anchor.sourceValue)].join(' ')
	);
}

/**
 * Indique si une traduction doit être traitée selon les options choisies.
 * @param {VerseTranslation} translation Traduction existante.
 * @param {AIProjectTranslationOptions} options Options du workflow.
 * @returns {boolean} `true` lorsque le sous-titre doit être envoyé à l'IA.
 */
function shouldTranslate(
	translation: VerseTranslation,
	options: AIProjectTranslationOptions
): boolean {
	if (translation.status === 'to translate') return true;
	if (translation.status === 'error') return options.retryErrors;
	if (translation.status === 'ai translated') return options.overwriteAiTranslated;
	if (translation.status === 'reviewed') return options.overwriteReviewed;
	return false;
}

/**
 * Retourne les sous-titres éligibles dans l'ordre de la timeline.
 * @param {Edition} edition Langue cible.
 * @param {AIProjectTranslationOptions} options Options du workflow.
 * @returns {SubtitleClip[]} Sous-titres à traduire.
 */
export function getEligibleAIProjectTranslationSubtitles(
	edition: Edition,
	options: AIProjectTranslationOptions
): SubtitleClip[] {
	return globalState.getSubtitleClips
		.filter((subtitle) => {
			if (isCompleteQuranOnlySubtitle(subtitle.text)) return false;
			const translation = subtitle.translations[edition.name] as VerseTranslation | undefined;
			return Boolean(translation && shouldTranslate(translation, options));
		})
		.sort((left, right) => left.startTime - right.startTime);
}

/**
 * Construit une entrée de contexte non modifiable.
 * @param {SubtitleClip} subtitle Sous-titre de contexte.
 * @param {Edition} edition Langue cible.
 * @returns {AIProjectTranslationContextItem} Contexte source et traduction actuelle.
 */
function buildContextItem(
	subtitle: SubtitleClip,
	edition: Edition
): AIProjectTranslationContextItem {
	const translation = subtitle.translations[edition.name] as VerseTranslation | undefined;
	return {
		i: subtitle.id,
		s: subtitle.text,
		t: translation
			? globalState.getProjectTranslation.resolveStructuredTranslationText(
					edition,
					subtitle,
					translation
				)
			: ''
	};
}

/**
 * Retourne les réglages Quran persistants d'une ancre sans modifier l'état.
 * @param {VerseTranslation} translation Traduction du sous-titre.
 * @param {StructuredTranslationAnchor} anchor Ancre Quran.
 * @param {number} unitCount Nombre d'unités de la traduction Quran.
 * @returns {QuranTranslationSegment} Réglages normalisés.
 */
function getQuranSettings(
	translation: VerseTranslation,
	anchor: StructuredTranslationAnchor,
	unitCount: number
): QuranTranslationSegment {
	return translation.getQuranSegment(anchor.id, anchor.sourceValue, Math.max(0, unitCount - 1));
}

/**
 * Construit le payload d'une ancre Quran ou citation.
 * @param {StructuredTranslationAnchor} anchor Ancre source.
 * @param {VerseTranslation} translation Traduction existante.
 * @param {Edition} edition Langue cible.
 * @param {AIProjectTranslationOptions} options Options du workflow.
 * @returns {Promise<{ payload: AIProjectTranslationAnchorPayload; expectation?: AIProjectTranslationQuranExpectation }>} Payload et attente Quran éventuelle.
 */
async function buildAnchorPayload(
	anchor: StructuredTranslationAnchor,
	translation: VerseTranslation,
	edition: Edition,
	options: AIProjectTranslationOptions
): Promise<{
	payload: AIProjectTranslationAnchorPayload;
	expectation?: AIProjectTranslationQuranExpectation;
}> {
	if (anchor.type === 'citation') {
		return {
			payload: {
				i: anchor.id,
				k: 'c',
				s: anchor.sourceValue
			}
		};
	}

	const reference = anchor.quranReference!;
	const verseKey = `${reference.surah}:${reference.verse}`;
	const original =
		globalState.getProjectTranslation.versesTranslations[edition.name]?.[verseKey] ?? '';
	const units = getTranslationTrimUnits(original).map((unit) => unit.text);
	const fullVerse = reference.startWord === null || reference.endWord === null;
	const settings = getQuranSettings(translation, anchor, units.length);
	const locked =
		fullVerse || (settings.isBruteForce && !options.overwriteManualQuran) || units.length === 0;
	const startWordIndex = Math.max(0, (reference.startWord ?? 1) - 1);
	const endWordIndex = Math.max(
		startWordIndex,
		(reference.endWord ?? reference.startWord ?? 1) - 1
	);
	const arabic = fullVerse
		? ''
		: (MinimalQuranProvider.getVerseSlice(
				reference.surah,
				reference.verse,
				startWordIndex,
				endWordIndex
			) ?? '');
	const wbw =
		fullVerse || locked
			? []
			: await WbwTranslationService.getWordsForRange(
					'en',
					reference.surah,
					reference.verse,
					startWordIndex,
					endWordIndex
				).catch(() => []);

	return {
		payload: {
			i: anchor.id,
			k: 'q',
			s: anchor.sourceValue,
			r: verseKey,
			f: fullVerse,
			l: locked,
			a: arabic,
			u: units,
			w: wbw
		},
		expectation: {
			anchor,
			unitCount: units.length,
			locked,
			fullVerse,
			resetToFullVerse: fullVerse && options.overwriteManualQuran
		}
	};
}

/**
 * Construit un candidat structuré pour un sous-titre.
 * @param {SubtitleClip} subtitle Sous-titre source.
 * @param {Edition} edition Langue cible.
 * @param {AIProjectTranslationOptions} options Options du workflow.
 * @returns {Promise<AIProjectTranslationCandidate>} Candidat prêt à être batché.
 */
async function buildCandidate(
	subtitle: SubtitleClip,
	edition: Edition,
	options: AIProjectTranslationOptions
): Promise<AIProjectTranslationCandidate> {
	const translation = subtitle.translations[edition.name] as VerseTranslation;
	const draft = getStructuredTranslationDraft(subtitle.text, translation.text);
	const builtAnchors = await Promise.all(
		draft.anchors.map((anchor) => buildAnchorPayload(anchor, translation, edition, options))
	);
	const payload: AIProjectTranslationItemPayload = {
		i: subtitle.id,
		f: draft.sourceFreeTexts,
		a: builtAnchors.map((entry) => entry.payload)
	};
	const quranExpectations = builtAnchors.flatMap((entry) =>
		entry.expectation ? [entry.expectation] : []
	);
	return {
		subtitle,
		translation,
		payload,
		citationIds: draft.anchors
			.filter((anchor) => anchor.type === 'citation')
			.map((anchor) => anchor.id),
		quranExpectations,
		wordCount: getTranslationBatchWordCount(subtitle)
	};
}

/**
 * Construit les batches de traduction avec un contexte local avant et après.
 * @param {Edition} edition Langue cible.
 * @param {AIProjectTranslationOptions} options Options du workflow.
 * @returns {Promise<AIProjectTranslationBatch[]>} Batches séquentiels prêts à être envoyés.
 */
export async function buildAIProjectTranslationBatches(
	edition: Edition,
	options: AIProjectTranslationOptions,
	maxBatchWords: number = MAX_BATCH_WORDS
): Promise<AIProjectTranslationBatch[]> {
	await MinimalQuranProvider.prefetch();
	const subtitles = getEligibleAIProjectTranslationSubtitles(edition, options);
	const candidates = await Promise.all(
		subtitles.map((subtitle) => buildCandidate(subtitle, edition, options))
	);
	const allSubtitles = [...globalState.getSubtitleClips].sort(
		(left, right) => left.startTime - right.startTime
	);
	const batches: AIProjectTranslationBatch[] = [];
	const normalizedBatchWords = Math.max(1, Math.round(maxBatchWords));
	let current: AIProjectTranslationCandidate[] = [];
	let currentWords = 0;

	const pushCurrent = (): void => {
		if (current.length === 0) return;
		const firstIndex = allSubtitles.findIndex((subtitle) => subtitle.id === current[0].subtitle.id);
		const lastIndex = allSubtitles.findIndex(
			(subtitle) => subtitle.id === current[current.length - 1].subtitle.id
		);
		const before = allSubtitles
			.slice(Math.max(0, firstIndex - CONTEXT_CLIP_COUNT), Math.max(0, firstIndex))
			.map((subtitle) => buildContextItem(subtitle, edition));
		const after = allSubtitles
			.slice(lastIndex + 1, lastIndex + 1 + CONTEXT_CLIP_COUNT)
			.map((subtitle) => buildContextItem(subtitle, edition));
		batches.push({
			batchId: `project-translation-${batches.length + 1}-${current[0].subtitle.id}`,
			candidates: current,
			request: {
				b: before,
				i: current.map((candidate) => candidate.payload),
				a: after
			},
			wordCount: currentWords
		});
		current = [];
		currentWords = 0;
	};

	for (const candidate of candidates) {
		if (current.length > 0 && currentWords + candidate.wordCount > normalizedBatchWords) {
			pushCurrent();
		}
		current.push(candidate);
		currentWords += candidate.wordCount;
	}
	pushCurrent();
	return batches;
}

/**
 * Estime le nombre de batches sans charger les données Quran nécessaires à l'exécution réelle.
 * @param {Edition} edition Langue cible.
 * @param {AIProjectTranslationOptions} options Options du workflow.
 * @param {number} maxBatchWords Taille maximale d'un batch en mots.
 * @returns {number} Nombre de batches qui seront créés.
 */
export function estimateAIProjectTranslationBatchCount(
	edition: Edition,
	options: AIProjectTranslationOptions,
	maxBatchWords: number = MAX_BATCH_WORDS
): number {
	const normalizedBatchWords = Math.max(1, Math.round(maxBatchWords));
	let batches = 0;
	let currentWords = 0;

	for (const subtitle of getEligibleAIProjectTranslationSubtitles(edition, options)) {
		const wordCount = getTranslationBatchWordCount(subtitle);
		if (currentWords > 0 && currentWords + wordCount > normalizedBatchWords) {
			batches += 1;
			currentWords = 0;
		}
		currentWords += wordCount;
	}

	return currentWords > 0 ? batches + 1 : batches;
}

/**
 * Vérifie qu'un texte généré ne peut pas créer de nouveaux marqueurs.
 * @param {unknown} value Valeur brute.
 * @returns {value is string} `true` pour une chaîne sûre.
 */
function isSafeGeneratedText(value: unknown): value is string {
	return typeof value === 'string' && !value.includes('{{') && !value.includes('}}');
}

/**
 * Valide strictement la réponse d'un batch de traduction.
 * @param {AIProjectTranslationBatch} batch Batch source.
 * @param {unknown} parsed Réponse JSON brute.
 * @returns {AIProjectTranslationValidationReport} Éléments sûrs et erreurs.
 */
export function validateAIProjectTranslationBatch(
	batch: AIProjectTranslationBatch,
	parsed: unknown
): AIProjectTranslationValidationReport {
	const validItems: AIProjectTranslationSuccess[] = [];
	const errors: string[] = [];
	if (!parsed || typeof parsed !== 'object') {
		return { validItems, errors: ['AI response is not a JSON object.'] };
	}
	const rawItems = (parsed as Record<string, unknown>).i;
	if (!Array.isArray(rawItems)) {
		return { validItems, errors: ['AI response is missing the items array.'] };
	}
	const candidateById = new Map(
		batch.candidates.map((candidate) => [candidate.subtitle.id, candidate])
	);
	const seenIds = new Set<number>();

	for (const rawItem of rawItems) {
		if (!rawItem || typeof rawItem !== 'object') {
			errors.push('AI response contains an invalid item.');
			continue;
		}
		const item = rawItem as Record<string, unknown>;
		const id = Number(item.i);
		const candidate = candidateById.get(id);
		if (!Number.isInteger(id) || !candidate || seenIds.has(id)) {
			errors.push(`AI response contains an unexpected or duplicate subtitle id ${String(item.i)}.`);
			continue;
		}
		seenIds.add(id);

		const freeTexts = item.f;
		if (
			!Array.isArray(freeTexts) ||
			freeTexts.length !== candidate.payload.a.length + 1 ||
			!freeTexts.every(isSafeGeneratedText)
		) {
			errors.push(`Subtitle ${id}: invalid free text slots.`);
			continue;
		}

		const citationValues = item.c ?? (candidate.citationIds.length === 0 ? [] : null);
		if (!Array.isArray(citationValues)) {
			errors.push(`Subtitle ${id}: invalid citation payload.`);
			continue;
		}
		const citations: Record<string, string> = {};
		let invalid = false;
		for (const value of citationValues) {
			if (!value || typeof value !== 'object') {
				invalid = true;
				break;
			}
			const record = value as Record<string, unknown>;
			const citationId = typeof record.i === 'string' ? record.i : '';
			const text = record.t;
			if (
				!candidate.citationIds.includes(citationId) ||
				citations[citationId] !== undefined ||
				!isSafeGeneratedText(text) ||
				text.trim().length === 0
			) {
				invalid = true;
				break;
			}
			citations[citationId] = text.trim();
		}
		if (invalid || Object.keys(citations).length !== candidate.citationIds.length) {
			errors.push(`Subtitle ${id}: citation anchors do not match the source.`);
			continue;
		}

		const expectedRanges = candidate.quranExpectations.filter((expectation) => !expectation.locked);
		const rawRanges = item.q ?? (expectedRanges.length === 0 ? [] : null);
		if (!Array.isArray(rawRanges)) {
			errors.push(`Subtitle ${id}: invalid Quran range payload.`);
			continue;
		}
		const quranRanges: Record<string, { startUnitIndex: number; endUnitIndex: number }> = {};
		for (const value of rawRanges) {
			if (!value || typeof value !== 'object') {
				invalid = true;
				break;
			}
			const record = value as Record<string, unknown>;
			const anchorId = typeof record.i === 'string' ? record.i : '';
			const expectation = expectedRanges.find((entry) => entry.anchor.id === anchorId);
			const start = Number(record.s);
			const end = Number(record.e);
			if (
				!expectation ||
				quranRanges[anchorId] !== undefined ||
				!Number.isInteger(start) ||
				!Number.isInteger(end) ||
				start < 0 ||
				end < start ||
				end >= expectation.unitCount
			) {
				invalid = true;
				break;
			}
			quranRanges[anchorId] = { startUnitIndex: start, endUnitIndex: end };
		}
		if (invalid || Object.keys(quranRanges).length !== expectedRanges.length) {
			errors.push(`Subtitle ${id}: Quran ranges do not match the editable partial passages.`);
			continue;
		}

		validItems.push({
			candidate,
			freeTexts: freeTexts as string[],
			citations,
			quranRanges
		});
	}

	for (const candidate of batch.candidates) {
		if (!seenIds.has(candidate.subtitle.id)) {
			errors.push(`Subtitle ${candidate.subtitle.id}: missing from AI response.`);
		}
	}
	return { validItems, errors };
}

/**
 * Résout un résultat IA en texte lisible pour servir de contexte au batch suivant.
 * @param {Edition} edition Langue cible.
 * @param {AIProjectTranslationSuccess} success Résultat validé.
 * @returns {string} Traduction résolue sans marqueurs visibles.
 */
export function resolveAIProjectTranslationSuccessContext(
	edition: Edition,
	success: AIProjectTranslationSuccess
): string {
	const draft = getStructuredTranslationDraft(
		success.candidate.subtitle.text,
		success.candidate.translation.text
	);
	let resolved = '';
	for (let index = 0; index < draft.anchors.length; index += 1) {
		const anchor = draft.anchors[index];
		resolved += success.freeTexts[index] ?? '';
		if (anchor.type === 'citation') {
			resolved += success.citations[anchor.id] ?? '';
			continue;
		}
		const reference = anchor.quranReference;
		if (!reference) continue;
		const verseKey = `${reference.surah}:${reference.verse}`;
		const original =
			globalState.getProjectTranslation.versesTranslations[edition.name]?.[verseKey] ?? '';
		const units = getTranslationTrimUnits(original);
		const range = success.quranRanges[anchor.id];
		const expectation = success.candidate.quranExpectations.find(
			(entry) => entry.anchor.id === anchor.id
		);
		const existing = success.candidate.translation.getQuranSegment(
			anchor.id,
			anchor.sourceValue,
			Math.max(0, units.length - 1)
		);
		if (!range && existing.isBruteForce && !expectation?.resetToFullVerse) {
			resolved += existing.manualText;
			continue;
		}
		resolved += sliceTranslationTrimUnits(
			original,
			expectation?.resetToFullVerse ? 0 : (range?.startUnitIndex ?? existing.startUnitIndex),
			expectation?.resetToFullVerse
				? Math.max(0, units.length - 1)
				: (range?.endUnitIndex ?? existing.endUnitIndex)
		);
	}
	return resolved + (success.freeTexts[draft.anchors.length] ?? '');
}

/**
 * Réinitialise les réglages manuels des occurrences Quran couvrant un verset complet.
 * @param {Edition} edition Langue cible.
 * @returns {void}
 */
function resetFullVerseQuranTranslations(edition: Edition): void {
	for (const subtitle of globalState.getSubtitleClips) {
		const translation = subtitle.translations[edition.name] as VerseTranslation | undefined;
		if (!translation?.isStructuredTranslation) continue;
		const draft = getStructuredTranslationDraft(subtitle.text, translation.text);
		const fullVerseAnchorIds = new Set(
			draft.anchors
				.filter(
					(anchor) =>
						anchor.type === 'quran' &&
						anchor.quranReference?.startWord === null &&
						anchor.quranReference?.endWord === null
				)
				.map((anchor) => anchor.id)
		);
		if (fullVerseAnchorIds.size === 0) continue;
		translation.quranSegments = Object.fromEntries(
			Object.entries(translation.quranSegments).filter(([id]) => !fullVerseAnchorIds.has(id))
		);
		if (isCompleteQuranOnlySubtitle(subtitle.text)) {
			translation.status = 'completed by default';
		}
	}
}

/**
 * Applique tous les résultats validés dans une unique entrée undo/redo.
 * @param {Edition} edition Langue cible.
 * @param {AIProjectTranslationSuccess[]} successes Résultats validés.
 * @param {AIProjectTranslationOptions} options Options d'écrasement du workflow.
 * @returns {AIProjectTranslationApplyReport} Rapport d'application.
 */
export function applyAIProjectTranslationResults(
	edition: Edition,
	successes: AIProjectTranslationSuccess[],
	options: AIProjectTranslationOptions = {
		retryErrors: true,
		overwriteAiTranslated: false,
		overwriteReviewed: false,
		overwriteManualQuran: false
	}
): AIProjectTranslationApplyReport {
	return ProjectHistoryManager.track('apply AI project translation', () => {
		if (options.overwriteManualQuran) resetFullVerseQuranTranslations(edition);
		for (const success of successes) {
			const { candidate } = success;
			const draft = getStructuredTranslationDraft(
				candidate.subtitle.text,
				candidate.translation.text
			);
			draft.freeTexts = [...success.freeTexts];
			for (const anchor of draft.anchors) {
				if (anchor.type === 'citation') anchor.value = success.citations[anchor.id] ?? anchor.value;
			}
			candidate.translation.setTextAndClearInlineStyles(serializeStructuredTranslation(draft));
			candidate.translation.isStructuredTranslation = true;
			candidate.translation.isBruteForce = true;

			for (const expectation of candidate.quranExpectations) {
				const range = success.quranRanges[expectation.anchor.id];
				if (!range) continue;
				const settings = candidate.translation.getOrCreateQuranSegment(
					expectation.anchor.id,
					expectation.anchor.sourceValue,
					Math.max(0, expectation.unitCount - 1)
				);
				settings.startUnitIndex = range.startUnitIndex;
				settings.endUnitIndex = range.endUnitIndex;
				settings.isBruteForce = false;
				settings.manualText = '';
			}
			candidate.translation.status = 'ai translated';
		}
		globalState.currentProject!.detail.updatePercentageTranslated(edition);
		globalState.updateVideoPreviewUI();
		return { appliedSubtitles: successes.length };
	});
}

/**
 * Exécute un batch de traduction structurée via la commande Tauri.
 * @param {{ apiKey: string; endpoint: string; model: string; reasoningEffort: 'none' | 'low' | 'medium' | 'high'; targetLanguage: string; islamicTermMode: IslamicTermTranslationMode; batch: AIProjectTranslationBatch }} params Paramètres du provider, terminologie et batch.
 * @returns {Promise<AIProjectTranslationBatchResponse>} Réponse structurée du backend.
 */
export async function runAIProjectTranslationBatchStreaming(params: {
	apiKey: string;
	endpoint: string;
	model: string;
	reasoningEffort: 'none' | 'low' | 'medium' | 'high';
	targetLanguage: string;
	islamicTermMode: IslamicTermTranslationMode;
	batch: AIProjectTranslationBatch;
}): Promise<AIProjectTranslationBatchResponse> {
	return (await invoke('run_ai_project_translation_batch_streaming', {
		request: {
			apiKey: params.apiKey,
			endpoint: params.endpoint,
			model: params.model,
			reasoningEffort: params.reasoningEffort,
			batchId: params.batch.batchId,
			targetLanguage: params.targetLanguage,
			islamicTermMode: params.islamicTermMode,
			batch: params.batch.request
		}
	})) as AIProjectTranslationBatchResponse;
}
