import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import ExportService from './ExportService';
import AndroidMediaService from './AndroidMediaService';
import { globalState } from '$lib/runes/main.svelte';
import Exportation, { ExportKind, ExportState } from '$lib/classes/Exportation.svelte';
import { Utilities } from '$lib/classes/misc/Utilities';

export default class ExportFileService {
	private static sanitizeFileName(value: string): string {
		return value.replace(/[/\\:*?"<>|]/g, '_').trim() || 'export';
	}

	static getProjectNameForFile(): string {
		const projectName = globalState.currentProject?.detail.name ?? 'project';
		return this.sanitizeFileName(projectName);
	}

	/**
	 * Enregistre un fichier texte dans le dossier d'export ou dans Download.
	 * @param {string} fileName Nom du fichier à créer.
	 * @param {string} content Contenu texte à enregistrer.
	 * @param {string} exportLabel Libellé affiché dans le moniteur d'export.
	 * @param {boolean} saveToDownloads Enregistre dans le dossier public Download si vrai.
	 * @returns {Promise<string>} URI ou chemin du fichier enregistré.
	 */
	static async saveTextFile(
		fileName: string,
		content: string,
		exportLabel: string = '',
		saveToDownloads: boolean = false
	): Promise<string> {
		if (saveToDownloads) {
			const filePath = await AndroidMediaService.saveTextFileToDownloads(fileName, content);
			return this.trackTextFile(fileName, filePath, exportLabel);
		}

		const exportFolder = await ExportService.getExportFolder();
		return this.saveTextFileToFolder(fileName, content, exportFolder, exportLabel);
	}

	/**
	 * Ajoute un fichier texte terminé au moniteur d'export.
	 * @param {string} fileName Nom affiché du fichier.
	 * @param {string} filePath URI ou chemin du fichier enregistré.
	 * @param {string} exportLabel Libellé affiché dans le moniteur.
	 * @returns {Promise<string>} URI ou chemin du fichier enregistré.
	 */
	private static async trackTextFile(
		fileName: string,
		filePath: string,
		exportLabel: string
	): Promise<string> {
		const exportId = Utilities.randomId();
		globalState.exportations.unshift(
			new Exportation(
				exportId,
				fileName,
				filePath,
				{ width: 0, height: 0 },
				0,
				0,
				'',
				ExportState.Exported,
				0,
				100,
				0,
				'',
				ExportKind.Text,
				exportLabel
			)
		);
		globalState.uiState.showExportMonitor = true;
		await ExportService.saveExports();
		return filePath;
	}

	/**
	 * Enregistre un export texte dans un dossier explicite.
	 * @param {string} fileName Nom du fichier à créer.
	 * @param {string} content Contenu texte à enregistrer.
	 * @param {string} exportFolder Dossier de destination.
	 * @param {string} exportLabel Libellé affiché dans le moniteur d'export.
	 * @param {boolean} trackInExportMonitor Ajoute le fichier au moniteur d'export.
	 * @returns {Promise<string>} Chemin du fichier enregistré.
	 */
	static async saveTextFileToFolder(
		fileName: string,
		content: string,
		exportFolder: string,
		exportLabel: string = '',
		trackInExportMonitor: boolean = true
	): Promise<string> {
		const filePath = await ExportService.constrainFilePathLength(
			await join(exportFolder, fileName)
		);
		fileName = filePath.split(/[/\\]/).at(-1)!;
		await invoke('save_file', { location: filePath, content });
		if (!trackInExportMonitor) return filePath;
		return this.trackTextFile(fileName, filePath, exportLabel);
	}
}
