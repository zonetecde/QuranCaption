import { invoke } from '@tauri-apps/api/core';
import { get } from 'svelte/store';
import { SubtitleClip, TrackType } from '$lib/classes';
import type { Project } from '$lib/classes/Project';
import { VerseTranslation } from '$lib/classes/Translation.svelte';
import type editor from '$lib/i18n/en/editor';
import LL, { locale } from '$lib/i18n/i18n-svelte';
import { globalState } from '$lib/runes/main.svelte';
import { resolveAIReasoning } from './AIReasoning';
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
	skipped: number;
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
 * Capture la piste pour refuser un résultat périmé, y compris après undo/redo.
 * @param {Project} project Projet analysé.
 * @returns {string} État sérialisé de la piste.
 */
function snapshot(project: Project): string {
	return JSON.stringify(project.content.timeline.getFirstTrack(TrackType.Subtitle).toJSON());
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
		plan.proposals.some(({ clip }) => !track.clips.includes(clip))
	)
		throw new Error(getCopy().sourceChanged());
}

/**
 * Recherche uniquement les erreurs de transcription très probables sans modifier les sous-titres.
 * @param {Project} project Projet à analyser.
 * @param {AbortSignal} signal Annulation de l'analyse.
 * @param {(progress: number) => void} onProgress Progression entre zéro et un.
 * @returns {Promise<SubtitleCorrectionPlan>} Corrections à approuver individuellement.
 */
export async function detectSubtitleCorrections(
	project: Project,
	signal: AbortSignal,
	onProgress: (progress: number) => void
): Promise<SubtitleCorrectionPlan> {
	const copy = getCopy();
	const settings = { ...globalState.settings!.aiTranslationSettings };
	if (!settings.openAiApiKey.trim()) throw new Error(copy.keyRequired());
	const plan: SubtitleCorrectionPlan = {
		project,
		snapshot: snapshot(project),
		proposals: [],
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
	for (let offset = 0; offset < subtitles.length; offset += 24) {
		assertCurrent(plan);
		signal.throwIfAborted();
		onProgress(offset / subtitles.length);
		const batch = subtitles.slice(offset, offset + 24);
		if (!batch.some(({ editable }) => editable)) continue;
		let response: unknown;
		try {
			response = await invoke('detect_subtitle_corrections', {
				request: {
					apiKey: settings.openAiApiKey,
					endpoint: settings.textAiApiEndpoint,
					model: settings.advancedTrimModel,
					reasoningEffort: reasoning.effort,
					thinkingEnabled: reasoning.thinkingEnabled,
					batch: {
						language: get(locale),
						subtitles: subtitles
							.slice(Math.max(0, offset - 2), offset + 26)
							.map(({ id, text, editable }) => ({
								id,
								text,
								editable: editable && batch.some((entry) => entry.id === id)
							}))
					}
				}
			});
		} catch {
			signal.throwIfAborted();
			throw new Error(copy.requestError());
		}
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
			if (item.confidence < 0.98 || item.after.trim() === entry.text.trim()) continue;
			plan.proposals.push({
				id: entry.id,
				clip: entry.clip,
				before: entry.text,
				after: item.after.trim(),
				reason: item.reason.slice(0, 2000)
			});
		}
	}
	assertCurrent(plan);
	signal.throwIfAborted();
	plan.proposals.sort((a, b) => a.id - b.id);
	if (!project.projectEditorState.subtitlesEditor.completedAiSteps.correction)
		ProjectHistoryManager.track(
			copy.title(),
			() => {
				project.projectEditorState.subtitlesEditor.completedAiSteps.correction = true;
			},
			project
		);
	onProgress(1);
	return plan;
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
			}
			project.detail.updateVideoDetailAttributes();
		},
		project
	);
	globalState.updateVideoPreviewUI();
	return selected.length;
}
