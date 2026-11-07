import type { Asset } from '$lib/classes/Asset.svelte';
import type { Project } from '$lib/classes/Project';
import { AssetClip } from '$lib/classes/Clip.svelte';
import { DEFAULT_IMAGE_CLIP_DURATION_MS } from '$lib/classes/Track.svelte';
import type { AssetTrack } from '$lib/classes/Track.svelte';
import { AssetType, TrackType } from '$lib/classes/enums';
import { globalState } from '$lib/runes/main.svelte';
import ModalManager from '$lib/components/modals/ModalManager';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import { invoke } from '@tauri-apps/api/core';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';

/**
 * Recueille les choix d'affichage puis ajoute l'asset au projet propriétaire.
 * @param {Project} project Projet propriétaire.
 * @param {Asset} asset Média à ajouter.
 * @param {boolean} asVideo Ajouter en tant que piste vidéo.
 * @param {boolean} asAudio Ajouter en tant que piste audio.
 * @param {boolean} skipDimensionPrompt Si true, ne demande pas la confirmation pour adapter les dimensions.
 * @param {number | undefined} startTime Position explicite en millisecondes, si l'emplacement est libre.
 * @returns {Promise<void>}
 */
export async function addAssetToTimeline(
	project: Project,
	asset: Asset,
	asVideo: boolean,
	asAudio: boolean,
	skipDimensionPrompt = false,
	startTime?: number
): Promise<void> {
	if (globalState.currentProject !== project) return;
	const videoTrack = asVideo
		? (project.content.timeline.getFirstTrack(TrackType.Video) as AssetTrack)
		: null;
	const audioTrack = asAudio
		? (project.content.timeline.getFirstTrack(TrackType.Audio) as AssetTrack)
		: null;
	let imageAsFullBackground = true;
	if (
		startTime === undefined &&
		asVideo &&
		asset.type === AssetType.Image &&
		videoTrack!.clips.length === 0
	) {
		const message = Reflect.get(get(LL).editor, 'setImageAsFullBackgroundConfirm') as () => string;
		imageAsFullBackground = await ModalManager.confirmModal(message(), true);
	}

	if (globalState.currentProject !== project) return;
	const tracks = [videoTrack, audioTrack].filter((track): track is AssetTrack => track !== null);
	const duration =
		asset.type === AssetType.Image ? DEFAULT_IMAGE_CLIP_DURATION_MS : asset.duration.ms;
	if (
		startTime !== undefined &&
		tracks.some(
			(track) =>
				track.getClipsInRange(startTime, startTime + duration).length > 0 ||
				track.clips.some((clip) => clip instanceof AssetClip && clip.loopUntilAudioEnd)
		)
	) {
		const message = Reflect.get(get(LL).editor, 'cannotAddAssetAtCursor') as () => string;
		ModalManager.errorModal(get(LL).editor.clipAdditionError(), message());
		return;
	}
	let wasAddedToVideo = false;
	ProjectHistoryManager.track(
		'add asset to timeline',
		() => {
			if (startTime !== undefined) {
				for (const track of tracks) {
					track.clips.push(new AssetClip(startTime, startTime + duration, asset.id));
					track.clips.sort((left, right) => left.startTime - right.startTime);
				}
				globalState.updateVideoPreviewUI();
				wasAddedToVideo = asVideo;
				return;
			}
			if (asVideo) wasAddedToVideo = videoTrack!.addAsset(asset, imageAsFullBackground);
			if (asAudio) audioTrack!.addAsset(asset);
		},
		project
	);

	if (asVideo && wasAddedToVideo && asset.type === AssetType.Video) {
		// Demande à l'utilisateur s'il veut que le format de les dimensions de la vidéo soient appliquées au projet
		// Récupère les dimensions de la vidéo
		const assetDimensions = (await invoke('get_video_dimensions', {
			filePath: asset.filePath
		})) as {
			width: number;
			height: number;
		};
		if (globalState.currentProject !== project) return;
		// Si les dimensions sont invalides, on ne fait rien
		if (assetDimensions.width <= 0 || assetDimensions.height <= 0) {
			return;
		}
		// Si les dimensions sont déjà les mêmes, on ne fait rien non plus
		const currentProjectDimensions = project.content.videoStyle
			.getStylesOfTarget('global')
			.findStyle('video-dimension')!.value as {
			width: number;
			height: number;
		};
		if (
			assetDimensions.width === currentProjectDimensions.width &&
			assetDimensions.height === currentProjectDimensions.height
		) {
			return;
		}

		if (skipDimensionPrompt) {
			// Applique automatiquement les dimensions sans demander confirmation
			if (assetDimensions.width > 0 && assetDimensions.height > 0) {
				ProjectHistoryManager.track(
					'set video dimensions from asset',
					() => {
						project.content.videoStyle
							.getStylesOfTarget('global')
							.findStyle('video-dimension')!.value = assetDimensions;
					},
					project
				);
			}
			return;
		}
		if (project.projectEditorState.hasAnsweredVideoDimensionPrompt) {
			return;
		}

		// Demande confirmation à l'utilisateur
		const confirm = await ModalManager.confirmModal(
			get(LL).editor.setDimensionsMatchVideo({
				width: String(assetDimensions.width),
				height: String(assetDimensions.height)
			}),
			true
		);

		if (globalState.currentProject !== project) return;
		ProjectHistoryManager.track(
			confirm ? 'set video dimensions from asset' : 'dismiss video dimensions prompt',
			() => {
				project.projectEditorState.hasAnsweredVideoDimensionPrompt = true;
				if (!confirm) return;
				if (assetDimensions.width > 0 && assetDimensions.height > 0) {
					project.content.videoStyle
						.getStylesOfTarget('global')
						.findStyle('video-dimension')!.value = {
						width: assetDimensions.width,
						height: assetDimensions.height
					};
				}
			},
			project
		);
	}
}
