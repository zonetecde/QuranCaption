import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import ModalManager from '$lib/components/modals/ModalManager';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';
import type { VideoStyleFileData } from './types.js';

/** Lit et valide les fichiers de presets sélectionnés par l'utilisateur. */
export class VideoStylePresetFileService {
	/**
	 * Ouvre le sélecteur puis parse le preset choisi.
	 * @returns {Promise<VideoStyleFileData | null>} Preset lu, ou `null` après annulation ou erreur.
	 */
	static async select(): Promise<VideoStyleFileData | null> {
		const file = await open({ multiple: false, directory: false });
		if (!file) return null;
		try {
			return JSON.parse((await readTextFile(file)).toString()) as VideoStyleFileData;
		} catch (error) {
			ModalManager.errorModal(
				get(LL).settings.errorImportingStyles(),
				get(LL).settings.stylesFileInvalid(),
				JSON.stringify(error, Object.getOwnPropertyNames(error))
			);
			return null;
		}
	}
}
