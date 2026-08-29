import { CustomTextClip } from '../Clip.svelte.js';
import { TrackType } from '../enums.js';
import { CustomTextTrack } from '../Track.svelte.js';
import { globalState } from '$lib/runes/main.svelte.js';
import type { Style } from './Style.svelte.js';
import type { StyleCategoryName, StyleName } from './types.js';
import { VideoStyleFactory } from './VideoStyleFactory.js';

/** Coordonne les contenus personnalisés associés aux styles vidéo. */
export class VideoStyleCustomClipService {
	/**
	 * Modifie un style d'un contenu texte existant.
	 * @param {StyleCategoryName} customTextId Identifiant du contenu.
	 * @param {StyleName} styleId Style à modifier.
	 * @param {Style['value']} value Nouvelle valeur.
	 * @returns {void}
	 */
	static setStyle(
		customTextId: StyleCategoryName,
		styleId: StyleName,
		value: Style['value']
	): void {
		const clip = globalState.getCustomClipTrack.clips.find(
			(candidate) => (candidate as CustomTextClip).category?.id === customTextId
		) as CustomTextClip | undefined;
		clip?.setStyle(styleId, value);
	}

	/**
	 * Ajoute un contenu texte ou image à la piste personnalisée.
	 * @param {'text' | 'image'} clipType Nature du contenu.
	 * @param {number} [startTime] Début facultatif en millisecondes.
	 * @param {number} [endTime] Fin facultative en millisecondes.
	 * @returns {Promise<void>} Promesse résolue une fois l'ajout déclenché.
	 */
	static async add(
		clipType: 'text' | 'image',
		startTime?: number,
		endTime?: number
	): Promise<void> {
		if (!globalState.currentProject!.content.timeline.doesTrackExist(TrackType.CustomClip)) {
			globalState.currentProject!.content.timeline.addTrack(new CustomTextTrack());
		}
		const category = await VideoStyleFactory.createCustomCategory(clipType);
		globalState.getCustomClipTrack.addCustomClip(category, clipType, startTime, endTime);
		setTimeout(() => globalState.updateVideoPreviewUI(), 10);
	}
}
