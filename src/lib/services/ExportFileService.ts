import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import ExportService from './ExportService';
import { globalState } from '$lib/runes/main.svelte';
import Exportation, { ExportKind, ExportState } from '$lib/classes/Exportation.svelte';
import { Utilities } from '$lib/classes/misc/Utilities';
import type { Project } from '$lib/classes/Project';

export default class ExportFileService {
	private static sanitizeFileName(value: string): string {
		return value.replace(/[/\\:*?"<>|]/g, '_').trim() || 'export';
	}

	static getProjectNameForFile(project?: Project | null): string {
		const projectName =
			project?.detail.name ?? globalState.currentProject?.detail.name ?? 'project';
		return this.sanitizeFileName(projectName);
	}

	/**
	 * Enregistre un fichier exporté dans le moniteur d'exports.
	 * @param {string} filePath Chemin du fichier exporté.
	 * @param {string} exportLabel Libellé affiché dans le moniteur d'exports.
	 * @returns {Promise<string>} Chemin du fichier enregistré.
	 */
	static async trackExportedFile(filePath: string, exportLabel: string = ''): Promise<string> {
		const fileName = filePath.split(/[/\\]/).at(-1)!;
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

	static async saveTextFile(
		fileName: string,
		content: string,
		exportLabel: string = ''
	): Promise<string> {
		const exportFolder = await ExportService.getExportFolder();
		return this.saveTextFileToFolder(fileName, content, exportFolder, exportLabel);
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
		await invoke('save_file', { location: filePath, content });
		if (!trackInExportMonitor) return filePath;
		return this.trackExportedFile(filePath, exportLabel);
	}
}
