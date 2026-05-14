import { invoke } from '@tauri-apps/api/core';
import { globalState } from '$lib/runes/main.svelte';
import type {
	AutoSegmentationAudioClip,
	AutoSegmentationAudioInfo,
	LocalSegmentationStatus,
	SegmentationMode
} from './types';

/**
 * Extrait les clips audio présents sur la timeline du projet.
 *
 * @returns {AutoSegmentationAudioClip[]} Liste des clips audio triés par temps de début.
 */
export function getAutoSegmentationAudioClips(): AutoSegmentationAudioClip[] {
	const project = globalState.currentProject;
	const audioTrack = globalState.getAudioTrack;

	if (!project || !audioTrack) return [];

	const clips: AutoSegmentationAudioClip[] = [];

	for (const clip of audioTrack.clips) {
		if (!clip || typeof clip !== 'object') continue;

		const assetId = (clip as { assetId?: unknown }).assetId;
		if (typeof assetId !== 'number') continue;

		const startTime = (clip as { startTime?: unknown }).startTime;
		const endTime = (clip as { endTime?: unknown }).endTime;
		if (typeof startTime !== 'number' || typeof endTime !== 'number') continue;

		const audioAsset = project.content.getAssetById(assetId);
		const filePath: string | undefined = audioAsset?.filePath;
		if (!filePath) continue;

		const fileName: string = filePath.split(/[/\\]/).pop() || filePath;
		clips.push({
			filePath,
			fileName,
			startMs: Math.max(0, Math.round(startTime)),
			endMs: Math.max(0, Math.round(endTime))
		});
	}

	return clips.sort((a, b) => a.startMs - b.startMs);
}

/**
 * Récupère les informations du premier clip audio du projet.
 *
 * @returns {AutoSegmentationAudioInfo | null} Infos du premier clip, ou null si aucun clip audio.
 */
export function getAutoSegmentationAudioInfo(): AutoSegmentationAudioInfo | null {
	const clips = getAutoSegmentationAudioClips();
	if (clips.length === 0) return null;

	const first = clips[0];
	return {
		filePath: first.filePath,
		fileName: first.fileName,
		clipCount: clips.length
	};
}

/**
 * Calcule la durée totale des clips audio en secondes.
 *
 * @returns {number} Durée audio totale en secondes.
 */
export function getAutoSegmentationAudioDurationS(): number {
	const clips = getAutoSegmentationAudioClips();
	if (clips.length === 0) return 0;
	const totalMs = clips.reduce((sum, clip) => sum + Math.max(0, clip.endMs - clip.startMs), 0);
	return totalMs / 1000;
}

/**
 * Vérifie si la segmentation locale est disponible et prête.
 *
 * @param {string} [hfToken] Token Hugging Face optionnel.
 * @returns {Promise<LocalSegmentationStatus>} Statut détaillé des moteurs locaux.
 */
export async function checkLocalSegmentationStatus(
	hfToken?: string
): Promise<LocalSegmentationStatus> {
	try {
		const result = await invoke('check_local_segmentation_ready', {
			hfToken: hfToken && hfToken.trim().length > 0 ? hfToken : undefined
		});
		return result as LocalSegmentationStatus;
	} catch (error) {
		console.error('Failed to check local segmentation status:', error);
		return {
			ready: false,
			pythonInstalled: false,
			packagesInstalled: false,
			message: 'Failed to check local segmentation status',
			engines: {
				legacy: {
					ready: false,
					venvExists: false,
					packagesInstalled: false,
					usable: false,
					message: 'Status check failed'
				},
				multi: {
					ready: false,
					venvExists: false,
					packagesInstalled: false,
					usable: false,
					tokenRequired: true,
					tokenProvided: false,
					message: 'Status check failed'
				},
				muaalem: {
					ready: false,
					venvExists: false,
					packagesInstalled: false,
					usable: false,
					message: 'Status check failed'
				}
			}
		};
	}
}

/**
 * Installe les dépendances pour la segmentation locale.
 *
 * @param {'legacy' | 'multi' | 'muaalem'} engine Moteur cible.
 * @param {string} [hfToken] Token Hugging Face optionnel.
 * @returns {Promise<void>}
 */
export async function installLocalSegmentationDeps(
	engine: 'legacy' | 'multi' | 'muaalem',
	hfToken?: string
): Promise<void> {
	try {
		await invoke('install_local_segmentation_deps', {
			engine,
			hfToken: hfToken && hfToken.trim().length > 0 ? hfToken : undefined
		});
	} catch (error) {
		console.error('Failed to install local segmentation deps:', error);
		throw error;
	}
}

/**
 * Récupère le mode de segmentation préféré.
 * Retourne 'local' si prêt, sinon 'api'.
 *
 * @returns {Promise<SegmentationMode>} Mode de segmentation préféré.
 */
export async function getPreferredSegmentationMode(): Promise<SegmentationMode> {
	const status = await checkLocalSegmentationStatus();
	return status.ready ? 'local' : 'api';
}
