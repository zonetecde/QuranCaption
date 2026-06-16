import { parseImportedSegmentationJson } from './parsing';
import { applySegmentationResponseToProject } from './apply-segmentation';
import { getAutoSegmentationAudioInfo, getAutoSegmentationAudioClips } from './audio';
import { beginAudioNormalizationIfNeeded } from './audio-normalize.svelte';
import ModalManager from '$lib/components/modals/ModalManager';
import { globalState } from '$lib/runes/main.svelte';
import type { AutoSegmentationOptions, AutoSegmentationResult } from './types';

/**
 * Applique les sous-titres à partir d'un payload Preload ("Quranic Universal Audio").
 *
 * Identique au flux d'import JSON ({@link runAutoSegmentationFromImportedJson}) — même
 * parsing, même application/timeline, donc aucune logique de timing/clock réimplémentée —
 * MAIS on saute volontairement l'étape d'enrichissement MFA : le Preload embarque déjà
 * des timestamps mot à mot révisés à la main, et un appel MFA live serait lancé dès qu'un
 * segment n'a pas de mots (segments spéciaux). On consomme donc les timestamps tels quels.
 *
 * L'audio (mp3 du chapitre complet) doit déjà avoir été ajouté à la piste audio.
 *
 * @param {string | unknown} payload Réponse `preload_segments` (objet ou JSON).
 * @param {Pick<AutoSegmentationOptions, 'fillBySilence' | 'extendBeforeSilence' | 'extendBeforeSilenceMs'>} options Options de post-processing.
 * @returns {Promise<AutoSegmentationResult | null>} Résumé du résultat ou null.
 */
export async function applyPreloadSegmentsToProject(
	payload: string | unknown,
	options: Pick<
		AutoSegmentationOptions,
		'fillBySilence' | 'extendBeforeSilence' | 'extendBeforeSilenceMs'
	> = {}
): Promise<AutoSegmentationResult | null> {
	const fillBySilence: boolean = options.fillBySilence ?? true;
	const extendBeforeSilence: boolean = options.extendBeforeSilence ?? false;
	const extendBeforeSilenceMs: number = options.extendBeforeSilenceMs ?? 0;

	const audioInfo = getAutoSegmentationAudioInfo();
	const audioClips = getAutoSegmentationAudioClips();
	if (!audioInfo || audioClips.length === 0) {
		return { status: 'failed', message: 'No audio clip found in the project.' };
	}

	// Re-timing audio en parallèle (point d'attente : apply).
	beginAudioNormalizationIfNeeded();

	const subtitleTrack = globalState.getSubtitleTrack;
	if (subtitleTrack.clips.length > 0) {
		const confirmOverwrite: boolean = await ModalManager.confirmModal(
			'There are already subtitles in this project. This process will override them. Continue?',
			true
		);
		if (!confirmOverwrite) return { status: 'cancelled' };
	}

	try {
		const parsed = parseImportedSegmentationJson(payload);
		return await applySegmentationResponseToProject({
			response: parsed.response,
			fillBySilence,
			extendBeforeSilence,
			extendBeforeSilenceMs,
			fallbackToCloud: false,
			cloudGpuFallbackToCpu: false,
			requestedMode: 'api',
			effectiveMode: 'api',
			segmentationSource: 'import',
			includeWbwTimestamps: (parsed.response.segments ?? []).some(
				(segment) => (segment.words?.length ?? 0) > 0
			),
			modelName: null,
			device: null,
			payloadForLog: payload
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { status: 'failed', message };
	}
}
