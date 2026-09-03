import { TrackType } from '../enums.js';
import { CustomClip, CustomImageClip, CustomTextClip } from '../Clip.svelte.js';
import { globalState } from '$lib/runes/main.svelte.js';
import type { Category } from '../VideoStyle.svelte.js';
import { open } from '@tauri-apps/plugin-dialog';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import { Track } from './Track.svelte.js';

export class CustomTextTrack extends Track {
	/** Initialise une piste de textes et d'images personnalisés. */
	constructor() {
		super(TrackType.CustomClip);
	}

	/**
	 * Crée un clip personnalisé associé à une catégorie de style.
	 * @param {Category} customClipCategory Catégorie qui configure l'apparence du clip.
	 * @param {'text' | 'image'} clipType Nature du contenu à créer.
	 * @param {number} [startTime] Début facultatif du clip en millisecondes.
	 * @param {number} [endTime] Fin facultative du clip en millisecondes.
	 * @returns {Promise<void>} Promesse résolue après l'ajout du clip.
	 */
	async addCustomClip(
		customClipCategory: Category,
		clipType: 'text' | 'image',
		startTime?: number,
		endTime?: number
	) {
		ProjectHistoryManager.begin('add custom clip');
		try {
			// Si des durées sont spécifiées, alors on désactive l'option "always show"
			if (startTime !== undefined && endTime !== undefined) {
				customClipCategory.getStyle('always-show')!.value = false;
				const rangesStyle = customClipCategory.getStyle('time-ranges');
				if (rangesStyle) rangesStyle.value = [{ startTime, endTime }];
				customClipCategory.getStyle('time-appearance')!.value = startTime;
				customClipCategory.getStyle('time-disappearance')!.value = endTime;
			}

			let clip: CustomImageClip | CustomTextClip;
			if (clipType === 'image') {
				// Ajoute un clip image

				// Ouvre la modale de sélection d'image
				let imagePath = '';

				const result = await open({
					multiple: false,
					directory: false,
					filters: [
						{
							name: 'Image Files',
							extensions: ['png', 'jpg', 'jpeg', 'gif']
						}
					]
				});

				if (result) {
					imagePath = result as string;
					customClipCategory.getStyle('filepath')!.value = imagePath;
				} else {
					return; // Annule l'ajout du clip si aucun fichier n'est sélectionné
				}

				clip = new CustomImageClip(customClipCategory);
			} else {
				clip = new CustomTextClip(customClipCategory);
			}

			// Set les temps si spécifiés
			if (startTime !== undefined && endTime !== undefined) {
				clip.startTime = startTime;
				clip.endTime = endTime;
			}

			this.clips.push(clip);

			// Trigger la réactivité dans la videopreview pour afficher le clip ajouté (si le curseur est dessus)
			globalState.updateVideoPreviewUI();
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/**
	 * Retourne tous les clips personnalisés visibles à la position courante.
	 * @returns {CustomClip[]} Clips visibles dans l'ordre de la piste.
	 */
	getCurrentClips(): CustomClip[] {
		// Retourne tout les clips à afficher
		const currentTime = globalState.currentProject?.projectEditorState.timeline.cursorPosition ?? 0;
		const clips: CustomClip[] = [];

		for (let index = 0; index < this.clips.length; index++) {
			const element = this.clips[index] as CustomClip;
			if (
				element.getAlwaysShow() ||
				element
					.getTimedOverlayRanges()
					.some((range) => currentTime >= range.startTime && currentTime <= range.endTime)
			) {
				clips.push(element);
			}
		}

		return clips;
	}

	/**
	 * Recherche le clip texte rattaché à une catégorie.
	 * @param {string} categoryId Identifiant de la catégorie recherchée.
	 * @returns {CustomTextClip | undefined} Clip texte correspondant, s'il existe.
	 */
	getCustomTextWithId(categoryId: string) {
		return this.clips.find(
			(clip) => clip instanceof CustomTextClip && clip.category!.id === categoryId
		) as CustomTextClip | undefined;
	}

	/**
	 * Recherche un clip personnalisé rattaché à une catégorie.
	 * @param {string} categoryId Identifiant de la catégorie recherchée.
	 * @returns {CustomClip | undefined} Clip correspondant, s'il existe.
	 */
	getCustomClipWithId(categoryId: string) {
		return this.clips.find(
			(clip) => clip instanceof CustomClip && clip.category?.id === categoryId
		) as CustomClip | undefined;
	}
}
