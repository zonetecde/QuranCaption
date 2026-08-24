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

	/**
	 * Enregistre un fichier texte dans le dossier public Download du téléphone.
	 * @param {string} fileName Nom du fichier à créer.
	 * @param {string} content Contenu UTF-8 du fichier.
	 * @returns {Promise<string>} URI ou chemin du fichier enregistré.
	 */
	static async saveTextFileToDownloads(fileName: string, content: string): Promise<string> {
		return await invoke<string>('save_android_download_file', { fileName, content });
	}

	/**
	 * Ouvre le sélecteur Android de dossiers et retourne la pool locale importée.
	 * @returns {Promise<string>} Chemin privé contenant les médias sélectionnés.
	 */
	static async pickBackgroundFolder(): Promise<string> {
		return await invoke<string>('pick_android_background_folder');
	}
}
