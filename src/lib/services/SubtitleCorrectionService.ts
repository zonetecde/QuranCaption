import { invoke } from '@tauri-apps/api/core';
import { get } from 'svelte/store';
import { SubtitleClip, TrackType } from '$lib/classes';
import type { Project } from '$lib/classes/Project';
import { VerseTranslation } from '$lib/classes/Translation.svelte';
import type editor from '$lib/i18n/en/editor';
import LL, { locale } from '$lib/i18n/i18n-svelte';
import { globalState } from '$lib/runes/main.svelte';
import { resolveAIReasoning } from './AIReasoning';
import { getAiBatchEnd, getAiBatchLimits } from './AiBatchSettings';
import type { ManualAiSession } from './ManualAiSession.svelte';
import { ProjectHistoryManager } from './undoRedo/ProjectHistoryManager';

export type SubtitleCorrectionCopy = {
	[K in keyof typeof editor.subtitleCorrection]: () => string;
};
export type SubtitleCorrectionProposal = {
	id: number;
	clip: SubtitleClip;
	before: string;
	after: string;
	reason: string;
};
export type SubtitleCorrectionPlan = {
	project: Project;
	snapshot: string;
	proposals: SubtitleCorrectionProposal[];
	warnings: SubtitleCorrectionWarning[];
	skipped: number;
};
export type SubtitleCorrectionWarning = {
	id: number;
	clip: SubtitleClip;
	text: string;
	suggestion: string;
	reason: string;
};

/**
 * Résout les libellés de correction dans la langue active.
 * @returns {SubtitleCorrectionCopy} Textes localisés.
 */
function getCopy(): SubtitleCorrectionCopy {
	return (get(LL).editor as unknown as { subtitleCorrection: SubtitleCorrectionCopy })
		.subtitleCorrection;
}

/**
 * Capture la piste sans le statut de vérification que la timeline modifie à la lecture.
 * @param {Project} project Projet analysé.
 * @returns {string} État sérialisé de la piste.
 */
function snapshot(project: Project): string {
	return JSON.stringify(
		project.content.timeline.getFirstTrack(TrackType.Subtitle).toJSON(),
		(key, value) => (key === 'hasBeenVerified' ? undefined : value)
	);
}

/**
 * Vérifie que les propositions concernent toujours les mêmes sous-titres.
 * @param {SubtitleCorrectionPlan} plan Analyse à vérifier.
 * @returns {void}
 */
function assertCurrent(plan: SubtitleCorrectionPlan): void {
	const track = plan.project.content.timeline.getFirstTrack(TrackType.Subtitle);
	if (
		globalState.currentProject !== plan.project ||
		snapshot(plan.project) !== plan.snapshot ||
		[...plan.proposals, ...plan.warnings].some(({ clip }) => !track.clips.includes(clip))
	)
		throw new Error(getCopy().sourceChanged());
}

/**
 * Recherche les corrections certaines et signale les passages suspects sans réécrire leur texte.
 * @param {Project} project Projet à analyser.
 * @param {AbortSignal} signal Annulation de l'analyse.
 * @param {(progress: number, totalBatches: number) => void} onProgress Progression des lots et total figé au lancement.
 * @param {ManualAiSession} [manual] Parcours copier-coller optionnel, sans fournisseur API.
 * @param {boolean} [convertArabicPhonetics=true] Proposer la conversion des phrases arabes phonétiques.
 * @returns {Promise<SubtitleCorrectionPlan>} Corrections à approuver individuellement.
 */
export async function detectSubtitleCorrections(
	project: Project,
	signal: AbortSignal,
	onProgress: (progress: number, totalBatches: number) => void,
	manual?: ManualAiSession,
	convertArabicPhonetics: boolean = true
): Promise<SubtitleCorrectionPlan> {
	const copy = getCopy();
	const settings = { ...globalState.settings!.aiTranslationSettings };
	if (!manual && !settings.openAiApiKey.trim()) throw new Error(copy.keyRequired());
	const plan: SubtitleCorrectionPlan = {
		project,
		snapshot: snapshot(project),
		proposals: [],
		warnings: [],
		skipped: 0
	};
	const subtitles = project.content.timeline
		.getFirstTrack(TrackType.Subtitle)
		.clips.filter((clip): clip is SubtitleClip => clip instanceof SubtitleClip)
		.sort((a, b) => a.startTime - b.startTime)
		.map((clip, index) => {
			const editable =
				Object.getPrototypeOf(clip) === SubtitleClip.prototype &&
				Boolean(clip.text.trim()) &&
				!/[{}]/u.test(clip.text) &&
				!clip.visualMergeGroupId &&
				!clip.arabicInlineStyleRuns.length &&
				!Object.values(clip.translations).some(
					(translation) =>
						translation instanceof VerseTranslation &&
						(translation.inlineStyleRuns.length > 0 || translation.wbwRanges.length > 0)
				);
			if (!editable) plan.skipped++;
			return { id: index + 1, clip, text: clip.text, editable };
		});
	if (!subtitles.some(({ editable }) => editable)) throw new Error(copy.noText());
	const reasoning = resolveAIReasoning(
		settings.textAiApiEndpoint,
		settings.advancedTrimModel,
		settings.projectTranslationReasoningMode
	);
	const limits = getAiBatchLimits(settings);
	const batches: { offset: number; end: number }[] = [];
	for (let offset = 0; offset < subtitles.length; ) {
		const end = getAiBatchEnd(subtitles, offset, limits.items, limits.characters);
		if (subtitles.slice(offset, end).some(({ editable }) => editable))
			batches.push({ offset, end });
		offset = end;
	}
	for (const [index, { offset, end }] of batches.entries()) {
		assertCurrent(plan);
		signal.throwIfAborted();
		onProgress(index / batches.length, batches.length);
		const batch = subtitles.slice(offset, end);
		const input = {
			language: get(locale),
			convertArabicPhonetics,
			subtitles: subtitles
				.slice(Math.max(0, offset - 2), end + 2)
				.map(({ id, text, editable }) => ({
					id,
					text,
					editable: editable && batch.some((entry) => entry.id === id)
				}))
		};
		/**
		 * Valide tout le lot avant de retenir ses propositions.
		 * @param {unknown} response Réponse de l'IA.
		 * @returns {{proposals: SubtitleCorrectionProposal[]; warnings: SubtitleCorrectionWarning[]}} Corrections et signalements valides.
		 */
		function validate(response: unknown): {
			proposals: SubtitleCorrectionProposal[];
			warnings: SubtitleCorrectionWarning[];
		} {
			const proposals: SubtitleCorrectionProposal[] = [];
			const warnings: SubtitleCorrectionWarning[] = [];
			assertCurrent(plan);
			signal.throwIfAborted();
			const corrections = (response as { corrections?: unknown } | null)?.corrections;
			if (!Array.isArray(corrections) || corrections.length > batch.length)
				throw new Error(copy.invalidResponse());
			const seen = new Set<number>();
			for (const value of corrections) {
				const item = value as Record<string, unknown> | null;
				const entry = batch.find(({ id }) => id === item?.id);
				if (
					!item ||
					!Number.isInteger(item.id) ||
					!entry?.editable ||
					seen.has(entry.id) ||
					item.before !== entry.text ||
					typeof item.after !== 'string' ||
					!item.after.trim() ||
					item.after.length > Math.max(500, entry.text.length * 2) ||
					/[{}]/u.test(item.after) ||
					typeof item.reason !== 'string' ||
					!item.reason.trim() ||
					typeof item.confidence !== 'number' ||
					!Number.isFinite(item.confidence) ||
					item.confidence < 0 ||
					item.confidence > 1
				)
					throw new Error(copy.invalidResponse());
				seen.add(entry.id);
				if (item.after.trim() === entry.text.trim()) continue;
				if (item.confidence < 0.98) {
					warnings.push({
						id: entry.id,
						clip: entry.clip,
						text: entry.text,
						suggestion: item.after.trim(),
						reason: item.reason.trim().slice(0, 2000)
					});
					continue;
				}
				proposals.push({
					id: entry.id,
					clip: entry.clip,
					before: entry.text,
					after: item.after.trim(),
					reason: item.reason.slice(0, 2000)
				});
			}
			const { warnings: notices = [] } = response as { warnings?: unknown };
			if (!Array.isArray(notices) || notices.length > batch.length)
				throw new Error(copy.invalidResponse());
			for (const value of notices) {
				const item = value as Record<string, unknown> | null;
				const entry = batch.find(({ id }) => id === item?.id);
				if (
					!item ||
					!Number.isInteger(item.id) ||
					!entry?.editable ||
					seen.has(entry.id) ||
					item.text !== entry.text ||
					typeof item.suggestion !== 'string' ||
					!item.suggestion.trim() ||
					item.suggestion.trim() === entry.text.trim() ||
					item.suggestion.length > Math.max(500, entry.text.length * 2) ||
					/[{}]/u.test(item.suggestion) ||
					typeof item.reason !== 'string' ||
					!item.reason.trim()
				)
					throw new Error(copy.invalidResponse());
				seen.add(entry.id);
				warnings.push({
					id: entry.id,
					clip: entry.clip,
					text: entry.text,
					suggestion: item.suggestion.trim(),
					reason: item.reason.trim().slice(0, 2000)
				});
			}
			return { proposals, warnings };
		}
		let result: ReturnType<typeof validate>;
		if (manual) {
			result = await manual.request('detect_subtitle_corrections', { batch: input }, validate);
		} else {
			let response: unknown;
			try {
				response = await invoke('detect_subtitle_corrections', {
					request: {
						apiKey: settings.openAiApiKey,
						endpoint: settings.textAiApiEndpoint,
						model: settings.advancedTrimModel,
						reasoningEffort: reasoning.effort,
						thinkingEnabled: reasoning.thinkingEnabled,
						batch: input
					}
				});
			} catch {
				signal.throwIfAborted();
				throw new Error(copy.requestError());
			}
			result = validate(response);
		}
		plan.proposals.push(...result.proposals);
		plan.warnings.push(...result.warnings);
	}
	assertCurrent(plan);
	signal.throwIfAborted();
	plan.proposals.sort((a, b) => a.id - b.id);
	plan.warnings.sort((a, b) => a.id - b.id);
	ProjectHistoryManager.track(
		copy.title(),
		() => {
			for (const { clip } of plan.warnings) {
				clip.needsReview = true;
				clip.hasBeenVerified = false;
			}
			project.projectEditorState.subtitlesEditor.completedAiSteps.correction = true;
		},
		project
	);
	plan.snapshot = snapshot(project);
	if (plan.warnings.length) globalState.updateVideoPreviewUI();
	onProgress(1, batches.length);
	return plan;
}

/**
 * Corrige un passage suspect avec le traitement existant, sans invalider les autres propositions.
 * @param {SubtitleCorrectionPlan} plan Analyse courante.
 * @param {number} id Identifiant du passage à corriger.
 * @param {string} text Texte corrigé et confirmé par l'utilisateur.
 * @returns {void}
 */
export function correctSubtitleCorrectionWarning(
	plan: SubtitleCorrectionPlan,
	id: number,
	text: string
): void {
	assertCurrent(plan);
	const warning = plan.warnings.find((item) => item.id === id);
	const after = text.trim();
	if (!warning || !after || after === warning.text.trim() || /[{}]/u.test(after))
		throw new Error(getCopy().invalidSelection());
	applySubtitleCorrections(
		plan.project,
		{
			...plan,
			proposals: [{ id, clip: warning.clip, before: warning.text, after, reason: warning.reason }]
		},
		[id]
	);
	warning.text = after;
	plan.snapshot = snapshot(plan.project);
}

/**
 * Applique les corrections choisies en une seule action annulable, sans changer les timings.
 * @param {Project} project Projet propriétaire.
 * @param {SubtitleCorrectionPlan} plan Propositions originales.
 * @param {number[]} selectedIds Identifiants des corrections approuvées.
 * @returns {number} Nombre de sous-titres corrigés.
 */
export function applySubtitleCorrections(
	project: Project,
	plan: SubtitleCorrectionPlan,
	selectedIds: number[]
): number {
	if (project !== plan.project) throw new Error(getCopy().sourceChanged());
	assertCurrent(plan);
	const selected = plan.proposals.filter(({ id }) => selectedIds.includes(id));
	if (selected.length !== selectedIds.length) throw new Error(getCopy().invalidSelection());
	if (!selected.length) return 0;
	ProjectHistoryManager.track(
		getCopy().title(),
		() => {
			for (const { clip, before, after } of selected) {
				clip.text = after;
				if (clip.alignmentMetadata) {
					const original = before.trim().split(/\s+/u);
					const corrected = after.split(/\s+/u);
					const words = clip.alignmentMetadata.words;
					// Conserve les mesures uniquement si les mots restent alignés un à un.
					const aligned =
						original.length === corrected.length &&
						words.length === original.length &&
						words.every((word, i) => word.word === original[i]);
					clip.alignmentMetadata = {
						...clip.alignmentMetadata,
						matchedText: after,
						words: aligned ? words.map((word, i) => ({ ...word, word: corrected[i] })) : []
					};
					if (!aligned) clip.wbwTimestampsManuallyEdited = false;
				}
				clip.markAsManualEdit();
				// Une reconstruction incertaine reste à vérifier après son application.
				if (plan.warnings.some((warning) => warning.clip === clip)) {
					clip.needsReview = true;
					clip.hasBeenVerified = false;
				}
			}
			project.detail.updateVideoDetailAttributes();
		},
		project
	);
	globalState.updateVideoPreviewUI();
	return selected.length;
}
