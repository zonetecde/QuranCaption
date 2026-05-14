import { invoke } from '@tauri-apps/api/core';
import type { DurationEstimateResult, MultiAlignerModel, SegmentationDevice } from './types';

/**
 * Estime la durée d'une segmentation à partir des paramètres fournis.
 *
 * @param {Object} options Options d'estimation.
 * @param {string} [options.endpoint] Point d'accès API (défaut: 'process_audio_session').
 * @param {number} options.audioDurationS Durée audio en secondes.
 * @param {MultiAlignerModel} options.modelName Nom du modèle.
 * @param {SegmentationDevice} options.device Appareil cible (GPU/CPU).
 * @returns {Promise<DurationEstimateResult | null>} Estimation, ou null si invalide.
 */
export async function estimateSegmentationDuration(options: {
	endpoint?: string;
	audioDurationS: number;
	modelName: MultiAlignerModel;
	device: SegmentationDevice;
}): Promise<DurationEstimateResult | null> {
	const endpoint = options.endpoint ?? 'process_audio_session';
	if (!Number.isFinite(options.audioDurationS) || options.audioDurationS <= 0) return null;
	try {
		const result = await invoke('estimate_segmentation_duration', {
			endpoint,
			audioDurationS: options.audioDurationS,
			modelName: options.modelName,
			device: options.device
		});
		return result as DurationEstimateResult;
	} catch (error) {
		console.warn('[AutoSegmentation] Failed to estimate duration:', error);
		return null;
	}
}
