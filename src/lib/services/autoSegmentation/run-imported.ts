import { parseImportedSegmentationJson } from './parsing';
import { enrichSegmentationResponseWithWordTimestamps } from './enrichment';
import { applySegmentationResponseToProject } from './apply-segmentation';
import { getAutoSegmentationAudioInfo, getAutoSegmentationAudioClips } from './audio';
import { beginAudioNormalizationIfNeeded } from './audio-normalize.svelte';
import ModalManager from '$lib/components/modals/ModalManager';
import { globalState } from '$lib/runes/main.svelte';
import type { AutoSegmentationOptions, AutoSegmentationResult } from './types';
import {
	AutoSegmentationExecutionCoordinator,
	getAutoSegmentationBusyMessage
} from '$lib/services/AutoSegmentationExecutionCoordinator';
import type { Project } from '$lib/classes/Project';
import { TrackType } from '$lib/classes/enums';

/**
 * Applique les sous-titres à partir d'un JSON exporté par Hugging Face Multi-Aligner.
 *
 * @param {string | unknown} importedPayload Charge JSON brute (chaîne ou objet).
 * @param {Pick<AutoSegmentationOptions, 'fillBySilence' | 'extendBeforeSilence' | 'extendBeforeSilenceMs'>} options Options de post-processing de la timeline.
 * @param {Project | null} project Projet explicite ou projet actuellement ouvert.
 * @param {boolean} headless Désactive les interactions UI pour un traitement en arrière-plan.
 * @returns {Promise<AutoSegmentationResult | null>} Résumé du résultat ou null en cas d'erreur.
 */
async function runAutoSegmentationFromImportedJsonCore(
	importedPayload: string | unknown,
	options: Pick<
		AutoSegmentationOptions,
		'fillBySilence' | 'extendBeforeSilence' | 'extendBeforeSilenceMs'
	> = {},
	project: Project | null = globalState.currentProject,
	headless: boolean = false
): Promise<AutoSegmentationResult | null> {
	const fillBySilence: boolean = options.fillBySilence ?? true;
	const extendBeforeSilence: boolean = options.extendBeforeSilence ?? false;
	const extendBeforeSilenceMs: number = options.extendBeforeSilenceMs ?? 0;

	const audioInfo = getAutoSegmentationAudioInfo(project);
	const audioClips = getAutoSegmentationAudioClips(project);
	if ((!audioInfo || audioClips.length === 0) && !headless) {
		return { status: 'failed', message: 'No audio clip found in the project.' };
	}

	// Re-timing audio en parallèle (point d'attente : apply).
	if (!headless) beginAudioNormalizationIfNeeded();

	const subtitleTrack = project?.content.timeline.getFirstTrack(TrackType.Subtitle);
	if (!headless && subtitleTrack && subtitleTrack.clips.length > 0) {
		const confirmOverwrite: boolean = await ModalManager.confirmModal(
			'There are already subtitles in this project. This process will override them. Continue?',
			true
		);
		if (!confirmOverwrite) return { status: 'cancelled' };
	}

	try {
		const parsed = parseImportedSegmentationJson(importedPayload);
		const response =
			!headless && audioClips.length > 0
				? await enrichSegmentationResponseWithWordTimestamps(parsed.response)
				: parsed.response;
		return await applySegmentationResponseToProject({
			response,
			fillBySilence,
			extendBeforeSilence,
			extendBeforeSilenceMs,
			fallbackToCloud: false,
			cloudGpuFallbackToCpu: false,
			requestedMode: 'api',
			effectiveMode: 'api',
			segmentationSource: 'import',
			includeWbwTimestamps: (response.segments ?? []).some(
				(segment) => (segment.words?.length ?? 0) > 0
			),
			modelName: null,
			device: null,
			payloadForLog: importedPayload,
			project: project ?? undefined,
			headless,
			audioNormalizationPromise: headless ? Promise.resolve() : undefined
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { status: 'failed', message };
	}
}

/**
 * Applique un JSON Hugging Face à un projet explicite, sans interaction UI ni audio requis.
 * @param {Project} project Projet Batch nouvellement créé.
 * @param {string | unknown} importedPayload Charge JSON brute.
 * @param {Pick<AutoSegmentationOptions, 'fillBySilence' | 'extendBeforeSilence' | 'extendBeforeSilenceMs'>} options Options de post-traitement.
 * @returns {Promise<AutoSegmentationResult | null>} Résultat de l'application des sous-titres.
 */
export async function runAutoSegmentationFromImportedJsonForProject(
	project: Project,
	importedPayload: string | unknown,
	options: Pick<
		AutoSegmentationOptions,
		'fillBySilence' | 'extendBeforeSilence' | 'extendBeforeSilenceMs'
	> = {}
): Promise<AutoSegmentationResult | null> {
	return runAutoSegmentationFromImportedJsonCore(importedPayload, options, project, true);
}

/**
 * Applique un JSON importé au projet ouvert sous le verrou global de segmentation.
 * @param {string | unknown} importedPayload Charge JSON brute.
 * @param {Pick<AutoSegmentationOptions, 'fillBySilence' | 'extendBeforeSilence' | 'extendBeforeSilenceMs'>} options Options de post-traitement.
 * @returns {Promise<AutoSegmentationResult | null>} Résultat de l'application.
 */
export async function runAutoSegmentationFromImportedJson(
	importedPayload: string | unknown,
	options: Pick<
		AutoSegmentationOptions,
		'fillBySilence' | 'extendBeforeSilence' | 'extendBeforeSilenceMs'
	> = {}
): Promise<AutoSegmentationResult | null> {
	const release = AutoSegmentationExecutionCoordinator.tryAcquire('manual');
	if (!release) {
		return { status: 'failed', message: getAutoSegmentationBusyMessage() };
	}
	try {
		return await runAutoSegmentationFromImportedJsonCore(importedPayload, options);
	} finally {
		release();
	}
}
