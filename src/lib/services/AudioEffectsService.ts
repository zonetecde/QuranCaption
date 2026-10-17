import { Asset } from '$lib/classes/Asset.svelte';
import { AssetClip } from '$lib/classes/clips/Clip.svelte';
import type { Project } from '$lib/classes/Project';
import { TrackType } from '$lib/classes/enums';
import { globalState } from '$lib/runes/main.svelte';
import { ProjectHistoryManager } from './undoRedo/ProjectHistoryManager';
import { invoke } from '@tauri-apps/api/core';
import { exists } from '@tauri-apps/plugin-fs';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';

export type AudioEffectId = 'denoise' | 'clarity' | 'echo' | 'reverb';
export type AudioEffectParameters = { primary: number; secondary: number };

/**
 * Résout la source audio dans le projet propriétaire du traitement.
 * @param {Project} project Projet propriétaire.
 * @param {number} clipId Clip audio choisi.
 * @returns {{ clip: AssetClip; asset: Asset }} Clip et source audio.
 */
function getAudioSource(project: Project, clipId: number): { clip: AssetClip; asset: Asset } {
	const clip = project.content.timeline
		.getFirstTrack(TrackType.Audio)
		.clips.find((clip) => clip.id === clipId);
	const asset = clip instanceof AssetClip ? project.content.getAssetById(clip.assetId) : null;
	if (!(clip instanceof AssetClip) || !asset) {
		throw new Error(get(LL).tools.pleaseSelectTimelineAudio());
	}
	return { clip, asset };
}

/**
 * Retourne un chemin WAV disponible à côté de la source.
 * @param {string} sourcePath Chemin source.
 * @param {AudioEffectId} effect Effet ajouté au nom de sortie.
 * @returns {Promise<string>} Chemin de sortie unique.
 */
async function getUniqueOutputPath(sourcePath: string, effect: AudioEffectId): Promise<string> {
	const basePath = sourcePath.replace(/\.[^./\\]+$/, '');
	let suffix = 1;
	let outputPath = `${basePath}_${effect}_${suffix}.wav`;
	while (await exists(outputPath)) {
		suffix += 1;
		outputPath = `${basePath}_${effect}_${suffix}.wav`;
	}
	return outputPath;
}

/**
 * Prépare dix secondes au milieu de la portion audio utilisée par le clip.
 * @param {Project} project Projet propriétaire.
 * @param {number} clipId Clip audio choisi.
 * @param {AudioEffectId} effect Effet à préécouter.
 * @param {AudioEffectParameters} parameters Réglages de l'effet.
 * @returns {Promise<string>} Chemin temporaire à lire puis supprimer par l'interface.
 */
export async function prepareAudioEffectPreview(
	project: Project,
	clipId: number,
	effect: AudioEffectId,
	parameters: AudioEffectParameters
): Promise<string> {
	const { clip, asset } = getAudioSource(project, clipId);
	const { sourceStartTime, startTime, endTime } = clip;
	await asset.ensureDurationLoaded();
	const clipDuration = Math.min(
		Math.max(0, asset.duration.ms - sourceStartTime),
		endTime - startTime
	);
	const durationMs = Math.min(10_000, clipDuration);
	if (durationMs <= 0) throw new Error(get(LL).tools.pleaseSelectTimelineAudio());
	return invoke<string>('preview_audio_effect', {
		sourcePath: asset.filePath,
		effect,
		...parameters,
		startMs: Math.round(sourceStartTime + Math.max(0, (clipDuration - durationMs) / 2)),
		durationMs: Math.round(durationMs)
	});
}

/**
 * Traite la source et remplace celle du clip dans une seule action annulable.
 * @param {Project} project Projet propriétaire.
 * @param {number} clipId Clip audio choisi.
 * @param {AudioEffectId} effect Effet à appliquer.
 * @param {AudioEffectParameters} parameters Réglages de l'effet.
 * @param {AbortSignal} signal Annulation lorsque l'interface est fermée.
 * @returns {Promise<Asset | null>} Source ajoutée, ou null si le résultat est devenu obsolète.
 */
export async function applyProjectAudioEffect(
	project: Project,
	clipId: number,
	effect: AudioEffectId,
	parameters: AudioEffectParameters,
	signal: AbortSignal
): Promise<Asset | null> {
	if (signal.aborted || globalState.currentProject !== project) return null;
	const { clip, asset } = getAudioSource(project, clipId);
	const sourceAssetId = clip.assetId;
	const outputPath = await getUniqueOutputPath(asset.filePath, effect);
	await invoke('apply_audio_effect', {
		sourcePath: asset.filePath,
		outputPath,
		effect,
		...parameters
	});
	const newAsset = new Asset(outputPath);
	await newAsset.ensureDurationLoaded();
	if (signal.aborted || globalState.currentProject !== project) return null;
	const current = project.content.timeline
		.getFirstTrack(TrackType.Audio)
		.clips.find((candidate) => candidate.id === clipId);
	if (
		current !== clip ||
		clip.assetId !== sourceAssetId ||
		project.content.getAssetById(sourceAssetId) !== asset
	)
		return null;
	ProjectHistoryManager.track(
		get(LL).tools.audioEffects(),
		() => {
			project.content.assets.unshift(newAsset);
			clip.assetId = newAsset.id;
		},
		project
	);
	return newAsset;
}
