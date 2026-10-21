import { invoke } from '@tauri-apps/api/core';
import { get } from 'svelte/store';
import { SubtitleClip, TrackType } from '$lib/classes';
import type { Project } from '$lib/classes/Project';
import { VerseTranslation } from '$lib/classes/Translation.svelte';
import type editor from '$lib/i18n/en/editor';
import LL from '$lib/i18n/i18n-svelte';
import { globalState } from '$lib/runes/main.svelte';
import { resolveAIReasoning } from './AIReasoning';
import { MinimalQuranProvider } from './MinimalQuranProvider';
import { MARKER_REGEX, parseQuranTranscriptReference } from './TranscriptMarkup';
import { ProjectHistoryManager } from './undoRedo/ProjectHistoryManager';

export type ReferenceDetectionCopy = {
	[K in keyof typeof editor.referenceDetection]: () => string;
};
export type ReferenceDetectionOptions = {
	detectQuran: boolean;
	detectCitations: boolean;
	additionalPreferences: string;
};
type QuranRange = { surah: number; verse: number; startWord: number; endWord: number };
type DetectionWord = {
	id: number;
	clip: SubtitleClip;
	start: number;
	end: number;
	text: string;
	protected: boolean;
};
type Candidate = { id: number; from: number; to: number; reference: QuranRange; text: string };
export type ReferenceProposal = {
	id: number;
	kind: 'quran' | 'citation' | 'none';
	status: 'confirmed' | 'uncertain' | 'rejected';
	from: number;
	to: number;
	reference: QuranRange | null;
	reason: string;
	source: string;
	canonical: string;
};
export type ReferenceDetectionPlan = {
	project: Project;
	snapshot: string;
	originalTexts: Map<SubtitleClip, string>;
	words: DetectionWord[];
	proposals: ReferenceProposal[];
	skipped: number;
};

/**
 * Résout les textes de détection depuis la langue active.
 * @returns {ReferenceDetectionCopy} Libellés localisés.
 */
export function getReferenceDetectionCopy(): ReferenceDetectionCopy {
	return (get(LL).editor as unknown as { referenceDetection: ReferenceDetectionCopy })
		.referenceDetection;
}

/**
 * Normalise uniquement la comparaison, sans réécrire le texte original.
 * @param {string} text Mot transcrit ou canonique.
 * @returns {string} Forme comparable sans signes de récitation ni variantes d'alif.
 */
function normalizeWord(text: string): string {
	return text
		.normalize('NFKD')
		.replace(/[\p{M}\u0640]/gu, '')
		.replace(/ٱ/g, 'ا')
		.replace(/ى/g, 'ي')
		.replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * Capture les sources dont dépendent les plages et leurs aperçus.
 * @param {Project} project Projet analysé.
 * @returns {string} État stable de la piste de sous-titres.
 */
function snapshot(project: Project): string {
	return JSON.stringify(project.content.timeline.getFirstTrack(TrackType.Subtitle).toJSON());
}

/**
 * Protège le projet contre les résultats périmés et les applications répétées.
 * @param {ReferenceDetectionPlan} plan Résultat lié au projet d'origine.
 * @returns {void}
 */
function assertCurrent(plan: ReferenceDetectionPlan): void {
	if (globalState.currentProject !== plan.project || snapshot(plan.project) !== plan.snapshot)
		throw new Error(getReferenceDetectionCopy().sourceChanged());
}

/**
 * Recherche des plages exactes normalisées sans présumer qu'elles sont citées comme Coran.
 * @param {DetectionWord[]} words Mots éditables et contexte protégé.
 * @param {Readonly<Record<string, readonly string[]>>} corpus Corpus indexé par verset.
 * @returns {Candidate[]} Candidats bornés à soumettre au verdict contextuel de l'IA.
 */
function findCandidates(
	words: DetectionWord[],
	corpus: Readonly<Record<string, readonly string[]>>
): Candidate[] {
	const index = new Map<string, { key: string; offset: number; words: string[] }[]>();
	for (const [key, original] of Object.entries(corpus)) {
		const normalized = original.map(normalizeWord);
		for (const [offset, word] of normalized.entries()) {
			if (!word) continue;
			const positions = index.get(word) ?? [];
			positions.push({ key, offset, words: normalized });
			index.set(word, positions);
		}
	}
	const normalized = words.map((word) => (word.protected ? '' : normalizeWord(word.text)));
	const matches: Candidate[] = [];
	for (let i = 0; i < words.length; i++) {
		for (const position of index.get(normalized[i]) ?? []) {
			let count = 0;
			while (
				i + count < words.length &&
				position.offset + count < position.words.length &&
				normalized[i + count] &&
				normalized[i + count] === position.words[position.offset + count]
			)
				count++;
			if (count < 3 && !(position.offset === 0 && count >= 2 && count === position.words.length))
				continue;
			const [surah, verse] = position.key.split(':').map(Number);
			matches.push({
				id: 0,
				from: words[i].id,
				to: words[i + count - 1].id,
				reference: {
					surah,
					verse,
					startWord: position.offset + 1,
					endWord: position.offset + count
				},
				text: corpus[position.key].slice(position.offset, position.offset + count).join(' ')
			});
		}
	}
	return matches
		.filter(
			(match) =>
				!matches.some(
					(other) =>
						other !== match &&
						other.reference.surah === match.reference.surah &&
						other.reference.verse === match.reference.verse &&
						other.from <= match.from &&
						other.to >= match.to &&
						other.to - other.from > match.to - match.from &&
						other.reference.startWord + match.from - other.from === match.reference.startWord
				)
		)
		.sort((a, b) => b.to - b.from - (a.to - a.from) || a.from - b.from);
}

/**
 * Analyse les citations sans modifier le projet, avec recherche canonique et contexte autour des lots.
 * @param {Project} project Projet à analyser.
 * @param {ReferenceDetectionOptions} options Catégories et préférences éditoriales.
 * @param {AbortSignal} signal Annulation empêchant les requêtes suivantes.
 * @param {(progress: number) => void} onProgress Progression de zéro à un.
 * @returns {Promise<ReferenceDetectionPlan>} Propositions vérifiées à prévisualiser.
 */
export async function detectProjectReferences(
	project: Project,
	options: ReferenceDetectionOptions,
	signal: AbortSignal,
	onProgress: (progress: number) => void
): Promise<ReferenceDetectionPlan> {
	const copy = getReferenceDetectionCopy();
	const settings = { ...globalState.settings!.aiTranslationSettings };
	if (!settings.openAiApiKey.trim()) throw new Error(copy.keyRequired());
	if (!options.detectQuran && !options.detectCitations) throw new Error(copy.chooseCategory());
	const plan: ReferenceDetectionPlan = {
		project,
		snapshot: snapshot(project),
		originalTexts: new Map(),
		words: [],
		proposals: [],
		skipped: 0
	};
	assertCurrent(plan);
	signal.throwIfAborted();
	onProgress(0);
	const clips = [...project.content.timeline.getFirstTrack(TrackType.Subtitle).clips].sort(
		(a, b) => a.startTime - b.startTime
	);
	for (const clip of clips) {
		if (!(clip instanceof SubtitleClip)) continue;
		plan.originalTexts.set(clip, clip.text);
		const protectedClip =
			Object.getPrototypeOf(clip) !== SubtitleClip.prototype ||
			clip.arabicInlineStyleRuns.length > 0 ||
			Object.values(clip.translations).some(
				(translation) =>
					translation instanceof VerseTranslation &&
					(translation.inlineStyleRuns.length > 0 || translation.wbwRanges.length > 0)
			);
		if (protectedClip) plan.skipped++;
		const markers = [...clip.text.matchAll(MARKER_REGEX)];
		const malformed = /[{}]/u.test(clip.text.replace(MARKER_REGEX, ''));
		const parts = [...clip.text.matchAll(/\{\{[^{}]+\}\}|[^\s{}]+|[{}]+/gu)];
		for (const part of parts) {
			const start = part.index!;
			plan.words.push({
				id: plan.words.length + 1,
				clip,
				text: part[0],
				start,
				end: start + part[0].length,
				protected:
					protectedClip ||
					malformed ||
					markers.some(
						(marker) => start >= marker.index! && start < marker.index! + marker[0].length
					)
			});
		}
	}
	if (!plan.words.some((word) => !word.protected)) throw new Error(copy.noText());
	let corpus: Readonly<Record<string, readonly string[]>> = {};
	if (options.detectQuran) {
		try {
			corpus = await MinimalQuranProvider.getVerses();
		} catch {
			throw new Error(copy.corpusError());
		}
	}
	assertCurrent(plan);
	signal.throwIfAborted();
	const candidates = options.detectQuran ? findCandidates(plan.words, corpus) : [];
	const reasoning = resolveAIReasoning(
		settings.textAiApiEndpoint,
		settings.advancedTrimModel,
		settings.projectTranslationReasoningMode
	);
	for (let offset = 0; offset < plan.words.length; offset += 400) {
		assertCurrent(plan);
		signal.throwIfAborted();
		onProgress(0.1 + (0.8 * offset) / plan.words.length);
		const from = offset + 1;
		const to = Math.min(offset + 400, plan.words.length);
		const context = plan.words.slice(
			Math.max(0, offset - 150),
			Math.min(plan.words.length, offset + 550)
		);
		if (!context.some((word) => word.id >= from && word.id <= to && !word.protected)) continue;
		const local = candidates
			.filter(
				(candidate) =>
					candidate.from >= from &&
					candidate.from <= to &&
					candidate.to <= context[context.length - 1].id
			)
			.slice(0, 48)
			.map((candidate, id) => ({ ...candidate, id }));
		const batch = {
			preferences: options,
			editableFrom: from,
			editableTo: to,
			words: context.map((word) => ({ id: word.id, text: word.text, protected: word.protected })),
			candidates: local,
			pauses: clips
				.filter(
					(clip) =>
						clip.type === 'Silence' &&
						clip.startTime >= context[0].clip.startTime &&
						clip.endTime <= context[context.length - 1].clip.endTime
				)
				.map((clip) => ({
					afterWord:
						context.filter((word) => word.clip.endTime < clip.startTime).at(-1)?.id ?? null,
					beforeWord: context.find((word) => word.clip.startTime > clip.endTime)?.id ?? null,
					duration: (clip.endTime - clip.startTime) / 1000
				}))
		};
		let response: unknown;
		try {
			response = await invoke('detect_subtitle_references', {
				request: {
					apiKey: settings.openAiApiKey,
					endpoint: settings.textAiApiEndpoint,
					model: settings.advancedTrimModel,
					reasoningEffort: reasoning.effort,
					thinkingEnabled: reasoning.thinkingEnabled,
					batch
				}
			});
		} catch {
			signal.throwIfAborted();
			throw new Error(copy.requestError());
		}
		assertCurrent(plan);
		signal.throwIfAborted();
		const findings = (response as { findings?: unknown } | null)?.findings;
		if (!Array.isArray(findings) || findings.length > context.length + local.length)
			throw new Error(copy.invalidResponse());
		const verdicts = new Set<number>();
		for (const value of findings) {
			const item = value as Record<string, unknown> | null;
			if (
				!item ||
				!['quran', 'citation', 'none'].includes(String(item.kind)) ||
				!['confirmed', 'uncertain', 'rejected'].includes(String(item.status)) ||
				!Number.isInteger(item.from) ||
				!Number.isInteger(item.to) ||
				(item.from as number) < from ||
				(item.from as number) > to ||
				(item.to as number) < (item.from as number) ||
				(item.to as number) > context[context.length - 1].id ||
				typeof item.reason !== 'string'
			)
				throw new Error(copy.invalidResponse());
			const candidate = local.find((entry) => entry.id === item.candidateId);
			if (item.candidateId !== null) {
				if (
					!Number.isInteger(item.candidateId) ||
					!candidate ||
					(item.from as number) > candidate.to ||
					(item.to as number) < candidate.from ||
					verdicts.has(item.candidateId as number)
				)
					throw new Error(copy.invalidResponse());
				verdicts.add(item.candidateId as number);
			}
			const words = plan.words.slice((item.from as number) - 1, item.to as number);
			if (words.some((word) => word.protected)) throw new Error(copy.invalidResponse());
			const proposal: ReferenceProposal = {
				id: plan.proposals.length,
				kind: item.kind as ReferenceProposal['kind'],
				status: item.status as ReferenceProposal['status'],
				from: item.from as number,
				to: item.to as number,
				reference: item.kind === 'none' && candidate ? { ...candidate.reference } : null,
				reason: item.reason.slice(0, 2000),
				source: words.map((word) => word.text).join(' '),
				canonical: item.kind === 'none' && candidate ? candidate.text : ''
			};
			if (
				proposal.status === 'confirmed' &&
				(proposal.kind === 'none' ||
					(proposal.kind === 'quran' && !options.detectQuran) ||
					(proposal.kind === 'citation' && !options.detectCitations))
			)
				throw new Error(copy.invalidResponse());
			if (proposal.kind === 'quran') {
				const reference = item.reference as QuranRange | null;
				const canonical = reference && corpus[`${reference.surah}:${reference.verse}`];
				if (
					!reference ||
					![reference.surah, reference.verse, reference.startWord, reference.endWord].every(
						Number.isInteger
					) ||
					!canonical ||
					reference.startWord < 1 ||
					reference.endWord > canonical.length ||
					reference.endWord - reference.startWord + 1 !== words.length ||
					words.some(
						(word, i) =>
							!normalizeWord(word.text) ||
							normalizeWord(word.text) !== normalizeWord(canonical[reference.startWord - 1 + i])
					)
				) {
					if (proposal.status === 'confirmed') proposal.status = 'uncertain';
					proposal.reason = `${copy.unverifiedQuran()} ${proposal.reason}`;
				} else {
					proposal.reference = { ...reference };
					proposal.canonical = canonical
						.slice(reference.startWord - 1, reference.endWord)
						.join(' ');
				}
			}
			if (proposal.kind === 'citation' && words.some((word) => /[{}]/u.test(word.text)))
				throw new Error(copy.invalidResponse());
			if (proposal.kind === 'citation' && parseQuranTranscriptReference(proposal.source)) {
				proposal.status = 'uncertain';
				proposal.reason = copy.ambiguousMarker();
			}
			plan.proposals.push(proposal);
		}
		if (verdicts.size !== local.length) throw new Error(copy.invalidResponse());
	}
	const accepted: ReferenceProposal[] = [];
	for (const proposal of [...plan.proposals].sort(
		(a, b) => Number(b.kind === 'quran') - Number(a.kind === 'quran') || a.from - b.from
	)) {
		if (proposal.status !== 'confirmed') continue;
		if (accepted.some((other) => proposal.from <= other.to && proposal.to >= other.from)) {
			proposal.status = 'uncertain';
			proposal.reason = copy.overlappingProposal();
		} else accepted.push(proposal);
	}
	assertCurrent(plan);
	signal.throwIfAborted();
	onProgress(1);
	return plan;
}

/**
 * Reconstruit uniquement les plages choisies, en conservant espaces, ponctuation et marqueurs existants.
 * @param {ReferenceDetectionPlan} plan Analyse originale.
 * @param {number[]} selectedIds Propositions confirmées sélectionnées.
 * @returns {{clip: SubtitleClip; before: string; after: string}[]} Aperçus des sous-titres modifiés.
 */
export function previewReferenceAnnotations(
	plan: ReferenceDetectionPlan,
	selectedIds: number[]
): { clip: SubtitleClip; before: string; after: string }[] {
	const selected = plan.proposals.filter((proposal) => selectedIds.includes(proposal.id));
	if (
		selectedIds.length !== selected.length ||
		selected.some((proposal) => proposal.status !== 'confirmed')
	)
		throw new Error(getReferenceDetectionCopy().invalidSelection());
	const changes = new Map<SubtitleClip, { start: number; end: number; text: string }[]>();
	for (const proposal of selected) {
		const words = plan.words.slice(proposal.from - 1, proposal.to);
		let used = 0;
		while (used < words.length) {
			const first = words[used];
			let end = used + 1;
			while (end < words.length && words[end].clip === first.clip) end++;
			const last = words[end - 1];
			const source = plan.originalTexts.get(first.clip)!.slice(first.start, last.end);
			const reference = proposal.reference;
			const text = reference
				? `${source.match(/^[^\p{L}\p{N}]*/u)?.[0] ?? ''}{{${reference.surah}:${reference.verse}:${reference.startWord + used}-${reference.startWord + end - 1}}}${source.match(/[^\p{L}\p{N}\p{M}]*$/u)?.[0] ?? ''}`
				: `{{${source}}}`;
			const replacements = changes.get(first.clip) ?? [];
			if (replacements.some((other) => first.start < other.end && last.end > other.start))
				throw new Error(getReferenceDetectionCopy().invalidSelection());
			replacements.push({ start: first.start, end: last.end, text });
			changes.set(first.clip, replacements);
			used = end;
		}
	}
	return [...changes].map(([clip, replacements]) => {
		const before = plan.originalTexts.get(clip)!;
		let after = before;
		for (const change of replacements.sort((a, b) => b.start - a.start))
			after = after.slice(0, change.start) + change.text + after.slice(change.end);
		return { clip, before, after };
	});
}

/**
 * Applique les annotations sélectionnées dans une seule action annulable sans retoucher les clips.
 * @param {Project} project Projet propriétaire.
 * @param {ReferenceDetectionPlan} plan Aperçu à appliquer.
 * @param {number[]} selectedIds Identifiants confirmés sélectionnés.
 * @returns {number} Nombre de sous-titres annotés.
 */
export function applyReferenceAnnotations(
	project: Project,
	plan: ReferenceDetectionPlan,
	selectedIds: number[]
): number {
	if (project !== plan.project) throw new Error(getReferenceDetectionCopy().sourceChanged());
	assertCurrent(plan);
	const changes = previewReferenceAnnotations(plan, selectedIds);
	if (!changes.length) return 0;
	let translations: { translation: VerseTranslation; text: string }[];
	try {
		translations = changes.flatMap(({ clip }) =>
			Object.entries(clip.translations).flatMap(([edition, translation]) => {
				if (!(translation instanceof VerseTranslation) || !translation.isStructuredTranslation)
					return [];
				return [{ translation, text: translation.getText(edition, clip) }];
			})
		);
	} catch {
		throw new Error(getReferenceDetectionCopy().translationError());
	}
	ProjectHistoryManager.track(
		getReferenceDetectionCopy().title(),
		() => {
			// Conserve le rendu existant; les nouvelles ancres doivent être traduites séparément.
			for (const { translation, text } of translations) {
				translation.text = text;
				translation.isStructuredTranslation = false;
			}
			for (const { clip, after } of changes) {
				clip.text = after;
				clip.hasBeenVerified = false;
				if (clip.alignmentMetadata)
					clip.alignmentMetadata = { ...clip.alignmentMetadata, matchedText: after };
			}
			project.detail.updateVideoDetailAttributes();
		},
		project
	);
	globalState.updateVideoPreviewUI();
	return changes.length;
}
