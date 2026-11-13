import { invoke } from '@tauri-apps/api/core';
import { get } from 'svelte/store';
import { TrackType } from '$lib/classes';
import { ClipWithTranslation } from '$lib/classes/Clip.svelte';
import type { Project } from '$lib/classes/Project';
import type exportCopy from '$lib/i18n/en/export';
import LL, { locale } from '$lib/i18n/i18n-svelte';
import { globalState } from '$lib/runes/main.svelte';
import { resolveAIReasoning } from './AIReasoning';
import type { ManualAiSession } from './ManualAiSession.svelte';
import { formatTranscriptReferencesForExport } from './TranscriptReferenceService';

export type MeaningExportRange = {
	id: string;
	startTime: number;
	endTime: number;
	title: string;
	context: string;
};
export type MeaningExportSegment = { id: number; start: number; end: number; text: string };
export type MeaningExportCopy = { [K in keyof typeof exportCopy.meaning]: () => string };

/** Résout les textes de l'assistant dans la langue active. @returns {MeaningExportCopy} Libellés. */
export function getMeaningExportCopy(): MeaningExportCopy {
	return (get(LL).export as unknown as { meaning: MeaningExportCopy }).meaning;
}

/**
 * Valide les bornes chronologiques et la durée réelle sans accepter de timestamps inventés.
 * @param {unknown} response Réponse JSON du fournisseur ou du parcours manuel.
 * @param {readonly MeaningExportSegment[]} segments Transcript chronologique indexé.
 * @param {number} maxDuration Durée maximale en secondes, silences compris.
 * @returns {MeaningExportRange[]} Extraits complets proposés, dans l'ordre du discours.
 */
export function validateMeaningExportRanges(
	response: unknown,
	segments: readonly MeaningExportSegment[],
	maxDuration: number
): MeaningExportRange[] {
	const copy = getMeaningExportCopy();
	const ranges = (response as { ranges?: unknown } | null)?.ranges;
	if (!Array.isArray(ranges) || !Number.isFinite(maxDuration) || maxDuration <= 0)
		throw new Error(copy.invalidResponse());
	const result: MeaningExportRange[] = [];
	let previousEnd = -1;
	for (const range of ranges) {
		if (
			!range ||
			!Number.isInteger(range.from) ||
			!Number.isInteger(range.to) ||
			range.to < range.from ||
			typeof range.title !== 'string' ||
			!range.title.trim() ||
			typeof range.context !== 'string' ||
			!range.context.trim()
		)
			throw new Error(copy.invalidResponse());
		const start = segments.find((segment) => segment.id === range.from);
		const end = segments.find((segment) => segment.id === range.to);
		if (
			!start ||
			!end ||
			!Number.isFinite(start.start) ||
			!Number.isFinite(end.end) ||
			start.start < 0 ||
			start.start < previousEnd ||
			end.end <= start.start ||
			end.end - start.start > maxDuration * 1000
		)
			throw new Error(copy.invalidResponse());
		result.push({
			id: `${range.from}-${range.to}`,
			startTime: start.start,
			endTime: end.end,
			title: range.title.trim(),
			context: range.context.trim()
		});
		previousEnd = end.end;
	}
	return result;
}

/**
 * Analyse tout le discours sans le modifier et refuse les réponses devenues obsolètes.
 * @param {Project} project Projet capturé à l'ouverture de la modale.
 * @param {number} maxDuration Durée maximale d'un extrait en secondes.
 * @param {AbortSignal} signal Annulation empêchant tout résultat tardif.
 * @param {ManualAiSession} [manual] Session copier-coller facultative.
 * @param {string} [additionalPreferences=''] Consignes éditoriales facultatives.
 * @returns {Promise<{ranges: MeaningExportRange[]; assertCurrent: () => void}>} Propositions et contrôle avant application.
 */
export async function generateMeaningExportRanges(
	project: Project,
	maxDuration: number,
	signal: AbortSignal,
	manual?: ManualAiSession,
	additionalPreferences = ''
): Promise<{ ranges: MeaningExportRange[]; assertCurrent: () => void }> {
	const copy = getMeaningExportCopy();
	if (!Number.isFinite(maxDuration) || maxDuration < 1) throw new Error(copy.invalidDuration());
	const track = project.content.timeline.getFirstTrack(TrackType.Subtitle);
	const snapshot = JSON.stringify(track.toJSON());
	/** Refuse une réponse après édition du discours ou annulation. @returns {void} */
	function assertCurrent(): void {
		signal.throwIfAborted();
		if (
			globalState.currentProject !== project ||
			project.content.timeline.getFirstTrack(TrackType.Subtitle) !== track ||
			JSON.stringify(track.toJSON()) !== snapshot
		)
			throw new Error(copy.sourceChanged());
	}
	assertCurrent();
	const clips = track.clips
		.filter(
			(clip): clip is ClipWithTranslation =>
				clip instanceof ClipWithTranslation && !!clip.text.trim()
		)
		.sort((a, b) => a.startTime - b.startTime);
	const segments: MeaningExportSegment[] = [];
	for (const [index, clip] of clips.entries()) {
		signal.throwIfAborted();
		const text = await formatTranscriptReferencesForExport(clip.text, 'Plain', false, false);
		segments.push({ id: index + 1, start: clip.startTime, end: clip.endTime, text });
	}
	if (!segments.length) throw new Error(copy.noTranscript());
	assertCurrent();
	const batch = {
		language: get(locale),
		maxDurationSeconds: maxDuration,
		additionalPreferences: additionalPreferences.trim(),
		segments
	};
	/** Valide une réponse complète avant de l'afficher. @param {unknown} value Réponse IA. @returns {MeaningExportRange[]} Extraits valides. */
	function validate(value: unknown): MeaningExportRange[] {
		assertCurrent();
		return validateMeaningExportRanges(value, segments, maxDuration);
	}
	let ranges: MeaningExportRange[];
	if (manual) {
		ranges = await manual.request('suggest_meaning_export_ranges', { batch }, validate);
	} else {
		const settings = globalState.settings!.aiTranslationSettings;
		const reasoning = resolveAIReasoning(
			settings.textAiApiEndpoint,
			settings.advancedTrimModel,
			settings.projectTranslationReasoningMode
		);
		let response: unknown;
		try {
			response = await invoke('suggest_meaning_export_ranges', {
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
		ranges = validate(response);
	}
	assertCurrent();
	return { ranges, assertCurrent };
}
