import { AssetType, TrackType } from '../enums.js';
import { AssetClip } from '../Clip.svelte.js';
import type { Asset } from '../Asset.svelte.js';
import { globalState } from '$lib/runes/main.svelte.js';
import toast from 'svelte-5-french-toast';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';
import ModalManager from '$lib/components/modals/ModalManager.js';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import { Track } from './Track.svelte.js';

export const DEFAULT_IMAGE_CLIP_DURATION_MS = 10_000;

export class AssetTrack extends Track {
	volumePercent: number = $state(100);

	/**
	 * Initialise une piste destinée à recevoir des ressources multimédias.
	 * @param {TrackType} type Type de piste multimédia à créer.
	 */
	constructor(type: TrackType) {
		super(type);
	}

	/**
	 * Ajoute une ressource à la piste et affiche une erreur lorsque l'ajout est impossible.
	 * @param {Asset} asset Ressource à convertir en clip.
	 * @param {boolean} imageAsFullBackground Étendre une première image à toute la vidéo.
	 * @returns {boolean} `true` lorsque la ressource a été ajoutée.
	 */
	addAsset(asset: Asset, imageAsFullBackground: boolean = true): boolean {
		ProjectHistoryManager.begin('add asset clip');
		try {
			const result = this.addAssetHeadless(asset, imageAsFullBackground);
			if (result === 'looped') {
				ModalManager.errorModal(
					get(LL).editor.clipAdditionError(),
					get(LL).editor.cannotAddMoreClips()
				);
				return false;
			}
			if (this.type === TrackType.Audio && this.clips.length === 2) {
				const overlapHint = Reflect.get(get(LL).editor, 'audioOverlapHint') as () => string;
				toast(overlapHint(), { icon: '💡', duration: 6000, position: 'bottom-left' });
			}

			// Trigger la réactivité dans la videopreview pour afficher le clip ajouté (si le curseur est dessus)
			setTimeout(() => {
				if (!globalState.currentProject) return;

				globalState.getTimelineState.movePreviewTo =
					globalState.getTimelineState.cursorPosition + 1;
			}, 0);

			return true;
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/**
	 * Insère un clip d'asset sans historique, modal ni effet de preview.
	 * @param {Asset} asset Asset à placer après le dernier clip.
	 * @param {boolean} imageAsFullBackground Étendre une première image à toute la vidéo.
	 * @returns {'added' | 'looped'} Résultat de l'insertion.
	 */
	addAssetHeadless(asset: Asset, imageAsFullBackground: boolean = true): 'added' | 'looped' {
		const lastClip = this.clips.length > 0 ? this.clips[this.clips.length - 1] : null;
		if (lastClip) {
			if (this.clips.some((clip) => clip instanceof AssetClip && clip.loopUntilAudioEnd)) {
				return 'looped';
			}
			if (
				this.type === TrackType.Video &&
				this.clips.length === 1 &&
				lastClip instanceof AssetClip &&
				lastClip.endTime === 0
			) {
				lastClip.endTime = DEFAULT_IMAGE_CLIP_DURATION_MS;
				lastClip.duration = DEFAULT_IMAGE_CLIP_DURATION_MS;
			}
			const startTime =
				this.type === TrackType.Audio ? this.getDuration().ms + 1 : lastClip.endTime + 1;
			const duration =
				asset.type === AssetType.Image ? DEFAULT_IMAGE_CLIP_DURATION_MS : asset.duration.ms;
			this.clips.push(new AssetClip(startTime, startTime + duration, asset.id));
		} else {
			const duration =
				asset.type === AssetType.Image && !imageAsFullBackground
					? DEFAULT_IMAGE_CLIP_DURATION_MS
					: asset.duration.ms;
			this.clips.push(new AssetClip(0, duration, asset.id));
		}
		return 'added';
	}
}
