import { globalState } from '$lib/runes/main.svelte';
import type { Project } from '$lib/classes/Project';
import { TrackType } from '$lib/classes/enums';
import type { AutoSegmentationAudioClip, AutoSegmentationAudioInfo } from './types';

/**
 * Extrait les clips audio présents sur la timeline du projet.
 *
 * @param {Project | null} project Projet explicite, ou projet global par défaut.
 * @returns {AutoSegmentationAudioClip[]} Liste des clips audio triés par temps de début.
 */
export function getAutoSegmentationAudioClips(
	project: Project | null = globalState.currentProject
): AutoSegmentationAudioClip[] {
	if (!project) return [];
	const audioTrack = project.content.timeline.getFirstTrack(TrackType.Audio);

	const clips: AutoSegmentationAudioClip[] = [];

	for (const clip of audioTrack.clips) {
		if (!clip || typeof clip !== 'object') continue;

		const assetId = (clip as { assetId?: unknown }).assetId;
		if (typeof assetId !== 'number') continue;

		const startTime = (clip as { startTime?: unknown }).startTime;
		const endTime = (clip as { endTime?: unknown }).endTime;
		if (typeof startTime !== 'number' || typeof endTime !== 'number') continue;
		const sourceStartTime = (clip as { sourceStartTime?: unknown }).sourceStartTime;

		const audioAsset = project.content.getAssetById(assetId);
		const filePath: string | undefined = audioAsset?.filePath;
		if (!filePath) continue;

		const fileName: string = filePath.split(/[/\\]/).pop() || filePath;
		clips.push({
			filePath,
			fileName,
			startMs: Math.max(0, Math.round(startTime)),
			endMs: Math.max(0, Math.round(endTime)),
			sourceStartMs:
				typeof sourceStartTime === 'number' ? Math.max(0, Math.round(sourceStartTime)) : 0
		});
	}

	return clips.sort((a, b) => a.startMs - b.startMs);
}

/**
 * Récupère les informations du premier clip audio du projet.
 *
 * @param {Project | null} project Projet explicite, ou projet global par défaut.
 * @returns {AutoSegmentationAudioInfo | null} Infos du premier clip, ou null si aucun clip audio.
 */
export function getAutoSegmentationAudioInfo(
	project: Project | null = globalState.currentProject
): AutoSegmentationAudioInfo | null {
	const clips = getAutoSegmentationAudioClips(project);
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
 * @param {Project | null} project Projet explicite, ou projet global par défaut.
 * @returns {number} Durée audio totale en secondes.
 */
export function getAutoSegmentationAudioDurationS(
	project: Project | null = globalState.currentProject
): number {
	const clips = getAutoSegmentationAudioClips(project);
	if (clips.length === 0) return 0;
	const totalMs = clips.reduce((sum, clip) => sum + Math.max(0, clip.endMs - clip.startMs), 0);
	return totalMs / 1000;
}
