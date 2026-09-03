import { AssetType, TrackType } from '../enums.js';
import { AssetClip } from '../Clip.svelte.js';
import type { Asset } from '../Asset.svelte.js';
import { globalState } from '$lib/runes/main.svelte.js';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';
import ModalManager from '$lib/components/modals/ModalManager.js';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import { Track } from './Track.svelte.js';

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
	 * @returns {boolean} `true` lorsque la ressource a été ajoutée.
	 */
	addAsset(asset: Asset): boolean {
		ProjectHistoryManager.begin('add asset clip');
		try {
			const result = this.addAssetHeadless(asset);
			if (result === 'looped') {
				ModalManager.errorModal(
					get(LL).editor.clipAdditionError(),
					get(LL).editor.cannotAddMoreClips()
				);
				return false;
			}
			if (result === 'image') {
				ModalManager.errorModal(
					get(LL).editor.backgroundImageError(),
					get(LL).editor.cannotAddBackgroundImage()
				);
				return false;
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
	 * @returns {'added' | 'looped' | 'image'} Résultat de l'insertion.
	 */
	addAssetHeadless(asset: Asset): 'added' | 'looped' | 'image' {
		const lastClip = this.clips.length > 0 ? this.clips[this.clips.length - 1] : null;
		if (lastClip) {
			if (this.clips.some((clip) => clip instanceof AssetClip && clip.loopUntilAudioEnd)) {
				return 'looped';
			}
			if (asset.type === AssetType.Image) return 'image';
			this.clips.push(
				new AssetClip(lastClip.endTime + 1, lastClip.endTime + asset.duration.ms + 1, asset.id)
			);
		} else {
			this.clips.push(new AssetClip(0, asset.duration.ms, asset.id));
		}
		return 'added';
	}
}
