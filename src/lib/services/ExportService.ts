import { VerseRange, type Project } from '$lib/classes';
import { exists, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';
import { globalState } from '$lib/runes/main.svelte';
import Exportation, { ExportState } from '$lib/classes/Exportation.svelte';
import { ProjectService } from './ProjectService';
import { listen } from '@tauri-apps/api/event';

export default class ExportService {
	static exportFolder: string = 'exports/';

	constructor() {}

	/**
	 * Charge un projet (utiliser par la fenêtre d'export)
	 * @param exportId L'ID d'exportation (qui est aussi l'ID du projet)
	 * @returns Le projet
	 */
	static async loadProject(exportId: number): Promise<Project> {
		return await ProjectService.load(exportId, false, this.exportFolder);
	}

	/**
	 * Enregistre un projet dans le dossier export. Le nom du fichier
	 * est l'id du projet (soit l'idée de l'export)
	 * @param project Le projet à exporter
	 */
	static async saveProject(project: Project) {
		const folder: string = await ProjectService.ensureFolder(this.exportFolder);

		// Enregistre le projet dans le dossier d'export
		await writeTextFile(
			await join(folder, project.detail.id.toString() + '.json'),
			JSON.stringify(project.toJSON(), null, 2)
		);
	}

	/**
	 * Retourne le chemin du dossier d'export.
	 * @returns Le chemin du dossier d'export
	 */
	static async getExportFolder(): Promise<string> {
		if (globalState.settings?.persistentUiState.videoExportFolder) {
			return globalState.settings.persistentUiState.videoExportFolder;
		}

		return join(await appDataDir(), this.exportFolder);
	}

	/**
	 * Ajoute un projet à la liste des exports en cours.
	 * @param project Le projet à ajouter
	 */
	static async addExport(project: Project, mode: 'recording' | 'stable' = 'stable') {
		// Ajoute le projet à la liste des exports en cours

		const fileName = project.detail.generateExportFileName() + '.mp4';
		let filePath = await join(await this.getExportFolder(), fileName);

		filePath = await this.checkIfFilePathTooLong(filePath);

		console.log('Final export file path:', filePath);

		globalState.exportations.unshift(
			new Exportation(
				project.detail.id,
				fileName,
				filePath,
				globalState.getStyle('global', 'video-dimension').value,
				project.projectEditorState.export.videoStartTime,
				project.projectEditorState.export.videoEndTime,
				VerseRange.getVerseRange(
					project.projectEditorState.export.videoStartTime,
					project.projectEditorState.export.videoEndTime
				).toString(),
				mode === 'recording' ? ExportState.WaitingForRecord : ExportState.CapturingFrames,
				project.projectEditorState.export.fps
			)
		);

		// Sauvegarde les exports en cours
		await this.saveExports();
	}

	private static async checkIfFilePathTooLong(filePath: string): Promise<string> {
		// Si le chemin est trop long (> 250 caractères), on met `...` dans le nom du fichier (mais pas dans le chemin)
		if (filePath.length > 250) {
			const pathParts = filePath.split(/[/\\]/);
			const fileName = pathParts.pop()!;
			const dirPath = pathParts.join('/');

			const newFileName = '...' + fileName.slice(-240); // Garde les 240 derniers caractères du nom de fichier
			filePath = await join(dirPath, newFileName);
		}

		return filePath;
	}

	/**
	 * Sauvegarde les exports en cours.
	 */
	static async saveExports() {
		// S'assure que le dossier existe
		const exportsPath = await ProjectService.ensureFolder(this.exportFolder);

		// Construis le chemin d'accès vers le fichier contenant tout les exports
		const filePath = await join(await appDataDir(), `exports.json`);

		await writeTextFile(
			filePath,
			JSON.stringify(
				globalState.exportations.map((exp) => exp.toJSON()),
				null,
				2
			)
		);
	}

	static async loadExports() {
		const filePath = await join(await appDataDir(), `exports.json`);

		if ((await exists(filePath)) === false) {
			// Aucun export trouvé
			globalState.exportations = [];
			return;
		}

		const json = await readTextFile(filePath);
		const data = JSON.parse(json);
		globalState.exportations = data.map((exp: any) => Exportation.fromJSON(exp));

		// Tout les exports en cours on les mets en canceled
		globalState.exportations.forEach((exp) => {
			if (exp.isOnGoing()) {
				exp.currentState = ExportState.Canceled;
			}
		});
	}

	static async deleteProjectFile(exportIdId: number) {
		const exportPath = await join(await appDataDir(), this.exportFolder);

		try {
			// Construis le chemin d'accès vers le projet
			const filePath = await join(exportPath, `${exportIdId}.json`);
			await remove(filePath);
		} catch (e) {}
	}

	static findExportById(id: number) {
		return globalState.exportations.find((exp) => exp.exportId === id);
	}

	static setupListener() {
		// Écoute les événements de progression d'export donné par Rust
		listen('export-progress-main', exportProgress);
	}

	static currentlyExportingProjects() {
		return globalState.exportations.filter((exp) => exp.isOnGoing());
	}
}

function exportProgress(event: any): void {
	const data = event.payload as ExportProgress;

	const exportation = globalState.exportations.find((exp) => exp.exportId === data.exportId);
	if (exportation) {
		if (exportation.currentState === ExportState.Canceled) {
			// Si l'exportation a été annulée, on ignore les mises à jour
			return;
		}

		exportation.percentageProgress = data.progress;
		
		// Si l'état change pour "Exported", on enregistre la date de fin
		if (data.currentState === ExportState.Exported && exportation.currentState !== ExportState.Exported) {
			exportation.completedDate = new Date().toISOString();
		}
		
		exportation.currentState = data.currentState;
		exportation.currentTreatedTime = data.currentTime;

		if (data.errorLog) {
			exportation.errorLog = data.errorLog;
		}
	}

	ExportService.saveExports();
}

export interface ExportProgress {
	exportId: number;
	progress: number;
	currentState: ExportState;
	currentTime: number;
	errorLog?: string;
}
