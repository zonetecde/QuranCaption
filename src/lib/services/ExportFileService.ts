import ExportService from './ExportService';
import AndroidMediaService from './AndroidMediaService';
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
	 * @param {string | undefined} displayFileName Nom affiché lorsque le chemin est une URI Android.
	 * @returns {Promise<string>} Chemin du fichier enregistré.
	 */
	static async trackExportedFile(
		filePath: string,
		exportLabel: string = '',
		displayFileName?: string
	): Promise<string> {
		const fileName = displayFileName ?? filePath.split(/[/\\]/).at(-1)!;
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
	 * Enregistre un fichier texte dans le dossier public Download.
	 * @param {string} fileName Nom du fichier à créer.
	 * @param {string} content Contenu texte à enregistrer.
	 * @param {string} exportLabel Libellé affiché dans le moniteur d'export.
	 * @returns {Promise<string>} URI ou chemin du fichier enregistré.
	 */
	static async saveTextFile(
		fileName: string,
		content: string,
		exportLabel: string = ''
	): Promise<string> {
		const filePath = await AndroidMediaService.saveTextFileToDownloads(fileName, content);
		return this.trackTextFile(fileName, filePath, exportLabel);
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
}
