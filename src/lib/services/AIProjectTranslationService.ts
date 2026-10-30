import { invoke } from '@tauri-apps/api/core';
import { get } from 'svelte/store';
import LL, { locale } from '$lib/i18n/i18n-svelte';

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
import type { AIReasoningEffort } from '$lib/services/AIReasoning';

import { getAiBatchLimits } from './AiBatchSettings';
const CONTEXT_CLIP_COUNT = 10;
const MAX_CONTEXT_CHARACTERS = 12000;

export type AIProjectTranslationOptions = {
	retryErrors: boolean;
	overwriteAiTranslated: boolean;
	overwriteReviewed: boolean;
	overwriteManualQuran: boolean;
};

export type AIProjectTranslationInputItem = {
	i: number;
	editable: boolean;
	durationMs: number;
	pauseBeforeMs: number;
	contextGapBefore?: boolean;
	parts: (AIProjectTranslationAnchorPayload | { k: 't'; i: number; s: string })[];
	t?: string;
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
	t?: string;
};

export type AIProjectTranslationItemPayload = {
	i: number;
	f: string[];
	a: AIProjectTranslationAnchorPayload[];
};

export type AIProjectTranslationBatch = {
	batchId: string;
	candidates: AIProjectTranslationCandidate[];
	beforeSubtitleIds: number[];
	afterSubtitleIds: number[];
	request: {
		language?: string;
		timeline: AIProjectTranslationInputItem[];
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
	snapshot: string;
};

export type AIProjectTranslationSuccess = {
	candidate: AIProjectTranslationCandidate;
	freeTexts: string[];
	citations: Record<string, string>;
	quranRanges: Record<string, { startUnitIndex: number; endUnitIndex: number }>;
	reviewReason?: string;
};

export type AIProjectTranslationValidationReport = {
	validItems: AIProjectTranslationSuccess[];
	errors: string[];
};

export type AIProjectTranslationApplyReport = {
	appliedSubtitles: number;
	reviewSubtitles: number;
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
	if (translation.status === 'to review' && translation.reviewReason) return true;
	if (translation.status === 'error' || translation.status === 'ai error')
		return options.retryErrors;
	if (translation.status === 'ai translated') return options.overwriteAiTranslated;
	if (translation.status === 'reviewed') return options.overwriteReviewed;
	return options.overwriteReviewed;
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
 * Construit une lecture linéaire des blocs source avec leur durée et leur pause précédente.
 * @param {SubtitleClip} subtitle Sous-titre de contexte.
 * @param {Edition} edition Langue cible.
 * @param {number} index Index chronologique local au batch.
 * @param {SubtitleClip | undefined} previous Sous-titre précédent dans la timeline.
 * @param {AIProjectTranslationCandidate | undefined} candidate Candidat modifiable éventuel.
 * @returns {AIProjectTranslationInputItem} Blocs ordonnés et contexte non modifiable éventuel.
 */
function buildContextItem(
	subtitle: SubtitleClip,
	edition: Edition,
	index: number,
	previous?: SubtitleClip,
	candidate?: AIProjectTranslationCandidate
): AIProjectTranslationInputItem {
	const translation = subtitle.translations[edition.name] as VerseTranslation | undefined;
	const draft = getStructuredTranslationDraft(subtitle.text, '');
	const anchors =
		candidate?.payload.a ??
		draft.anchors.map((anchor) => ({
			i: anchor.id,
			k: anchor.type === 'quran' ? ('q' as const) : ('c' as const),
			s:
				anchor.type === 'quran'
					? (MinimalQuranProvider.getVerseSlice(
							anchor.quranReference!.surah,
							anchor.quranReference!.verse,
							Math.max(0, (anchor.quranReference!.startWord ?? 1) - 1),
							(anchor.quranReference!.endWord ?? Number.MAX_SAFE_INTEGER) - 1
						) ?? anchor.sourceValue)
					: anchor.sourceValue
		}));
	const parts: AIProjectTranslationInputItem['parts'] = [];
	for (let slot = 0; slot < draft.sourceFreeTexts.length; slot += 1) {
		parts.push({ k: 't', i: slot, s: draft.sourceFreeTexts[slot] });
		if (anchors[slot]) parts.push(anchors[slot]);
	}
	return {
		i: index,
		editable: Boolean(candidate),
		durationMs: subtitle.endTime - subtitle.startTime,
		pauseBeforeMs: previous
			? Math.max(0, subtitle.startTime - previous.endTime)
			: subtitle.startTime,
		parts,
		...(!candidate
			? {
					t: translation
						? globalState.getProjectTranslation.resolveStructuredTranslationText(
								edition,
								subtitle,
								translation
							)
						: ''
				}
			: {})
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
	const arabic =
		MinimalQuranProvider.getVerseSlice(
			reference.surah,
			reference.verse,
			startWordIndex,
			fullVerse ? Number.MAX_SAFE_INTEGER : endWordIndex
		) ?? '';
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
			w: wbw,
			...(locked
				? {
						t:
							settings.isBruteForce && !options.overwriteManualQuran
								? settings.manualText
								: sliceTranslationTrimUnits(
										original,
										fullVerse ? 0 : settings.startUnitIndex,
										fullVerse ? Math.max(0, units.length - 1) : settings.endUnitIndex
									)
					}
				: {})
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
	const snapshot = JSON.stringify([
		subtitle.text,
		subtitle.startTime,
		subtitle.endTime,
		translation
	]);
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
		snapshot,
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
	options: AIProjectTranslationOptions
): Promise<AIProjectTranslationBatch[]> {
	const limits = getAiBatchLimits(globalState.settings?.aiTranslationSettings, true);
	await MinimalQuranProvider.prefetch();
	const subtitles = getEligibleAIProjectTranslationSubtitles(edition, options);
	const candidates = await Promise.all(
		subtitles.map((subtitle) => buildCandidate(subtitle, edition, options))
	);
	const allSubtitles = [...globalState.getSubtitleClips].sort(
		(left, right) => left.startTime - right.startTime
	);
	const batches: AIProjectTranslationBatch[] = [];
	let current: AIProjectTranslationCandidate[] = [];
	let currentWords = 0;
	let currentCharacters = 0;
	const positions = new Map(allSubtitles.map((subtitle, index) => [subtitle.id, index]));

	/** Enregistre le passage courant avec son contexte chronologique borné. @returns {void} */
	const pushCurrent = (): void => {
		if (current.length === 0) return;
		const firstIndex = positions.get(current[0].subtitle.id)!;
		const lastIndex = positions.get(current[current.length - 1].subtitle.id)!;
		const candidateBySubtitle = new Map(
			current.map((candidate) => [candidate.subtitle.id, candidate])
		);
		const included = new Set(current.map(({ subtitle }) => positions.get(subtitle.id)!));
		let contextCharacters = 0;
		const contextBudget = Math.min(
			MAX_CONTEXT_CHARACTERS,
			Math.max(0, limits.characters - currentCharacters)
		);
		// Répartit le contexte autour de chaque cible, en privilégiant les voisins immédiats.
		for (let distance = 1; distance <= CONTEXT_CLIP_COUNT; distance++) {
			for (const { subtitle } of current) {
				const position = positions.get(subtitle.id)!;
				for (const index of [position - distance, position + distance]) {
					if (!allSubtitles[index] || included.has(index)) continue;
					const length = JSON.stringify(buildContextItem(allSubtitles[index], edition, 0)).length;
					if (length > MAX_CONTEXT_CHARACTERS / 2 || contextCharacters + length > contextBudget)
						continue;
					included.add(index);
					contextCharacters += length;
				}
			}
		}
		const indexes = [...included].sort((a, b) => a - b);
		const timeline = indexes.map((position, index) => ({
			...buildContextItem(
				allSubtitles[position],
				edition,
				index,
				allSubtitles[position - 1],
				candidateBySubtitle.get(allSubtitles[position].id)
			),
			...(index > 0 && position > indexes[index - 1] + 1 ? { contextGapBefore: true } : {})
		}));
		batches.push({
			batchId: `project-translation-${batches.length + 1}-${current[0].subtitle.id}`,
			candidates: current,
			beforeSubtitleIds: indexes
				.filter((index) => index < firstIndex)
				.map((index) => allSubtitles[index].id),
			afterSubtitleIds: indexes
				.filter((index) => index > lastIndex)
				.map((index) => allSubtitles[index].id),
			request: { language: get(locale), timeline },
			wordCount: currentWords
		});
		current = [];
		currentWords = 0;
		currentCharacters = 0;
	};

	for (const candidate of candidates) {
		const previous = current.at(-1);
		const candidateCharacters = JSON.stringify(
			buildContextItem(candidate.subtitle, edition, 0, undefined, candidate)
		).length;
		const naturalBoundary =
			previous &&
			currentWords >= limits.words * 0.9 &&
			(/[.!?؟。！？」»]\s*$/u.test(previous.subtitle.text) ||
				candidate.subtitle.startTime - previous.subtitle.endTime >= 1200);
		if (
			current.length > 0 &&
			(currentWords + candidate.wordCount > limits.words ||
				naturalBoundary ||
				currentCharacters + candidateCharacters > limits.characters)
		) {
			pushCurrent();
		}
		current.push(candidate);
		currentWords += candidate.wordCount;
		currentCharacters += candidateCharacters;
	}
	pushCurrent();
	return batches;
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
	const copy = Reflect.get(get(LL).translations, 'aiResponseErrors');
	if (!parsed || typeof parsed !== 'object') {
		return { validItems, errors: [copy.notObject()] };
	}
	const rawItems = (parsed as Record<string, unknown>).i;
	if (!Array.isArray(rawItems)) {
		return { validItems, errors: [copy.missingItems()] };
	}
	const editableItems = batch.request.timeline.filter((item) => item.editable);
	const candidateById = new Map(
		editableItems.map((item, index) => [item.i, batch.candidates[index]])
	);
	const promptIdByCandidate = new Map(
		batch.candidates.map((candidate, index) => [candidate, editableItems[index]?.i])
	);
	const seenIds = new Set<number>();

	for (const rawItem of rawItems) {
		if (!rawItem || typeof rawItem !== 'object') {
			errors.push(copy.invalidItem());
			continue;
		}
		const item = rawItem as Record<string, unknown>;
		const id = Number(item.i);
		const candidate = candidateById.get(id);
		if (!Number.isInteger(id) || !candidate || seenIds.has(id)) {
			errors.push(copy.unexpectedId({ id: String(item.i) }));
			continue;
		}
		seenIds.add(id);
		const issue = item.issue === undefined ? '' : item.issue;
		if (typeof issue !== 'string' || issue.length > 2000) {
			errors.push(copy.invalidItem());
			continue;
		}
		// Accepte encore les avertissements de prompts copiés avant l'ajout des propositions.
		if (
			issue.trim() &&
			[item.f, item.c, item.q].every((value) => Array.isArray(value) && value.length === 0)
		) {
			validItems.push({
				candidate,
				freeTexts: [],
				citations: {},
				quranRanges: {},
				reviewReason: issue.trim()
			});
			continue;
		}

		const freeTexts = item.f;
		if (
			!Array.isArray(freeTexts) ||
			freeTexts.length !== candidate.payload.a.length + 1 ||
			!freeTexts.every(isSafeGeneratedText)
		) {
			errors.push(copy.invalidFreeTexts({ id }));
			continue;
		}

		const citationValues = item.c ?? (candidate.citationIds.length === 0 ? [] : null);
		if (!Array.isArray(citationValues)) {
			errors.push(copy.invalidCitation({ id }));
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
			errors.push(copy.citationMismatch({ id }));
			continue;
		}
		// Les marqueurs d'incertitude usuels ne doivent jamais devenir du texte vidéo.
		if (
			[...freeTexts, ...Object.values(citations)].some((text) =>
				/\[\s*(?:unclear(?: phrase| text| passage)?|inaudible|unintelligible|phrase peu claire|passage incompréhensible|unverständlich|unklare (?:phrase|stelle)|frase poco clara|ininteligible|غير واضح|عبارة غير واضحة)\s*\]/iu.test(
					text
				)
			)
		) {
			validItems.push({
				candidate,
				freeTexts: [],
				citations: {},
				quranRanges: {},
				reviewReason: Reflect.get(get(LL).translations, 'aiTranslationUnclearOutput')()
			});
			continue;
		}

		const expectedRanges = candidate.quranExpectations.filter((expectation) => !expectation.locked);
		const rawRanges = item.q ?? (expectedRanges.length === 0 ? [] : null);
		if (!Array.isArray(rawRanges)) {
			errors.push(copy.invalidQuranRange({ id }));
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
			errors.push(copy.quranRangeMismatch({ id }));
			continue;
		}

		validItems.push({
			candidate,
			freeTexts: freeTexts as string[],
			citations,
			quranRanges,
			...(issue.trim() ? { reviewReason: issue.trim() } : {})
		});
	}

	for (const candidate of batch.candidates) {
		const promptId = promptIdByCandidate.get(candidate);
		if (promptId === undefined || !seenIds.has(promptId)) {
			errors.push(copy.missingSubtitle({ id: candidate.subtitle.id }));
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
	if (success.reviewReason) return '';
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
 * @param {Set<SubtitleClip>} excluded Sous-titres signalés dont la traduction doit rester intacte.
 * @returns {void}
 */
function resetFullVerseQuranTranslations(edition: Edition, excluded: Set<SubtitleClip>): void {
	for (const subtitle of globalState.getSubtitleClips) {
		if (excluded.has(subtitle)) continue;
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
	if (
		successes.some(
			({ candidate }) =>
				!globalState.getSubtitleClips.includes(candidate.subtitle) ||
				candidate.snapshot !==
					JSON.stringify([
						candidate.subtitle.text,
						candidate.subtitle.startTime,
						candidate.subtitle.endTime,
						candidate.translation
					])
		)
	) {
		throw new Error(
			(
				get(LL).translations as unknown as { aiTranslationSourceChanged: () => string }
			).aiTranslationSourceChanged()
		);
	}
	return ProjectHistoryManager.track('apply AI project translation', () => {
		const reviews = successes.filter((success) => success.reviewReason);
		if (options.overwriteManualQuran)
			resetFullVerseQuranTranslations(
				edition,
				new Set(reviews.map(({ candidate }) => candidate.subtitle))
			);
		for (const success of successes) {
			const { candidate } = success;
			if (success.reviewReason && !success.freeTexts.length) {
				candidate.translation.status = 'to review';
				candidate.translation.reviewReason = success.reviewReason;
				continue;
			}
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
			candidate.translation.status = success.reviewReason ? 'to review' : 'ai translated';
			candidate.translation.reviewReason = success.reviewReason ?? '';
		}
		const pendingReviews = globalState.getSubtitleClips.filter(
			(clip) => clip.translations[edition.name]?.status === 'to review'
		);
		if (pendingReviews.length) {
			const state = globalState.getTranslationsState;
			state.filters['to translate'] ??= false;
			state.filters['ai translated'] ??= false;
			state.filters.reviewed ??= false;
			state.checkOnlyFilters(['to review']);
			state.searchQuery = '';
			edition.showInTranslationsEditor = true;
			globalState.shared.translationScrollTargetClipId = pendingReviews[0].id;
		}
		globalState.currentProject!.detail.updatePercentageTranslated(edition);
		globalState.updateVideoPreviewUI();
		return {
			appliedSubtitles: successes.length - reviews.length,
			reviewSubtitles: pendingReviews.length
		};
	});
}

/**
 * Exécute un batch de traduction structurée via la commande Tauri.
 * @param {{ apiKey: string; endpoint: string; model: string; reasoningEffort: AIReasoningEffort; thinkingEnabled?: boolean | null; additionalPreferences?: string; useSalawatSymbol?: boolean; targetLanguage: string; islamicTermMode: IslamicTermTranslationMode; batch: AIProjectTranslationBatch }} params Paramètres du provider, terminologie et batch.
 * @returns {Promise<AIProjectTranslationBatchResponse>} Réponse structurée du backend.
 */
export async function runAIProjectTranslationBatchStreaming(params: {
	apiKey: string;
	endpoint: string;
	model: string;
	reasoningEffort: AIReasoningEffort;
	thinkingEnabled?: boolean | null;
	additionalPreferences?: string;
	useSalawatSymbol?: boolean;
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
			thinkingEnabled: params.thinkingEnabled,
			additionalPreferences: params.additionalPreferences ?? '',
			useSalawatSymbol: params.useSalawatSymbol ?? true,
			batchId: params.batch.batchId,
			targetLanguage: params.targetLanguage,
			islamicTermMode: params.islamicTermMode,
			batch: params.batch.request
		}
	})) as AIProjectTranslationBatchResponse;
}
