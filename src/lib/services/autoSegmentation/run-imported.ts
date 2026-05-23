import { parseImportedSegmentationJson } from './parsing';
import { enrichSegmentationResponseWithWordTimestamps } from './enrichment';
import { applySegmentationResponseToProject } from './apply-segmentation';
import { getAutoSegmentationAudioInfo, getAutoSegmentationAudioClips } from './audio';
import ModalManager from '$lib/components/modals/ModalManager';
import { globalState } from '$lib/runes/main.svelte';
import type { AutoSegmentationOptions, AutoSegmentationResult } from './types';

/**
 * Applique les sous-titres à partir d'un JSON exporté par Hugging Face Multi-Aligner.
 *
 * @param {string | unknown} importedPayload Charge JSON brute (chaîne ou objet).
 * @param {Pick<AutoSegmentationOptions, 'fillBySilence' | 'extendBeforeSilence' | 'extendBeforeSilenceMs'>} options Options de post-processing de la timeline.
 * @returns {Promise<AutoSegmentationResult | null>} Résumé du résultat ou null en cas d'erreur.
 */
export async function runAutoSegmentationFromImportedJson(
	importedPayload: string | unknown,
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

	const subtitleTrack = globalState.getSubtitleTrack;
	if (subtitleTrack.clips.length > 0) {
		const confirmOverwrite: boolean = await ModalManager.confirmModal(
			'There are already subtitles in this project. This process will override them. Continue?',
			true
		);
		if (!confirmOverwrite) return { status: 'cancelled' };
	}

	try {
		const parsed = parseImportedSegmentationJson(importedPayload);
		const response = await enrichSegmentationResponseWithWordTimestamps(parsed.response);
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
			payloadForLog: importedPayload
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { status: 'failed', message };
	}
}
