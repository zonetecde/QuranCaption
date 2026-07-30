import { invoke } from '@tauri-apps/api/core';

export default class AndroidMediaService {
	/**
	 * Copie une URI du fournisseur Android dans le stockage privé persistant.
	 * @param {string} filePath Chemin ou URI sélectionné.
	 * @param {number} projectId Projet propriétaire, ou zéro avant sa création.
	 * @returns {Promise<string>} Vrai chemin local utilisable par FFmpeg.
	 */
	static async materializeSelectedFile(filePath: string, projectId: number): Promise<string> {
		if (!filePath.startsWith('content://')) return filePath;
		return await invoke<string>('import_android_media', {
			uri: filePath,
			projectId
		});
	}
}
