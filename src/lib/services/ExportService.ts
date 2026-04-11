import { VerseRange, type Project } from '$lib/classes';
import { exists, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';
import { globalState } from '$lib/runes/main.svelte';
import Exportation, { ExportKind, ExportState } from '$lib/classes/Exportation.svelte';
import { ProjectService } from './ProjectService';
import { listen, type Event as TauriEvent } from '@tauri-apps/api/event';
import { AnalyticsService } from './AnalyticsService';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { detectExportCapturePlatform } from './ExportCapturePolicy';

export default class ExportService {
	static exportFolder: string = 'exports/';
	private static readonly EXPORT_HEARTBEAT_INTERVAL_MS = 5000;
	private static readonly EXPORT_HEARTBEAT_TIMEOUT_MS = 45000;
	private static exportHeartbeatTimers = new Map<number, number>();
	private static exportHeartbeatLastSeenAt = new Map<number, number>();
	private static exportHeartbeatLastState = new Map<number, ExportState>();

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
		const fileName = project.detail.generateExportFileName() + '.mp4';
		let filePath = await join(await this.getExportFolder(), fileName);

		filePath = await this.checkIfFilePathTooLong(filePath);

		console.log('Final export file path:', filePath);

		globalState.exportations.unshift(
			new Exportation(
				project.detail.id,
				fileName,
				filePath,
				globalState.getStyle('global', 'video-dimension').value as {
					width: number;
					height: number;
				},
				project.projectEditorState.export.videoStartTime,
				project.projectEditorState.export.videoEndTime,
				VerseRange.getVerseRange(
					project.projectEditorState.export.videoStartTime,
					project.projectEditorState.export.videoEndTime
				).toString(),
				mode === 'recording' ? ExportState.WaitingForRecord : ExportState.CapturingFrames,
				project.projectEditorState.export.fps,
				0,
				0,
				'',
				ExportKind.Video,
				'',
				project.projectEditorState.export.originalProjectId
			)
		);

		await this.saveExports();
	}

	private static async checkIfFilePathTooLong(filePath: string): Promise<string> {
		if (filePath.length > 250) {
			const pathParts = filePath.split(/[/\\]/);
			const fileName = pathParts.pop()!;
			const dirPath = pathParts.join('/');

			const newFileName = '...' + fileName.slice(-240);
			filePath = await join(dirPath, newFileName);
		}

		return filePath;
	}

	/**
	 * Sauvegarde les exports en cours.
	 */
	static async saveExports() {
		await ProjectService.ensureFolder(this.exportFolder);

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
			globalState.exportations = [];
			return;
		}

		const json = await readTextFile(filePath);
		const parsedData: unknown = JSON.parse(json);
		const data = Array.isArray(parsedData) ? parsedData : [];
		globalState.exportations = data.map(
			(exp) => Exportation.fromJSON(exp as Record<string, unknown>) as Exportation
		);

		globalState.exportations.forEach((exp) => {
			if (exp.isOnGoing()) {
				exp.currentState = ExportState.Canceled;
			}
		});
	}

	static async deleteProjectFile(exportIdId: number) {
		const exportPath = await join(await appDataDir(), this.exportFolder);

		try {
			const filePath = await join(exportPath, `${exportIdId}.json`);
			await remove(filePath);
		} catch (_e) {
			// Ignore file removal failures (already deleted or missing access rights).
		}
	}

	static findExportById(id: number) {
		return globalState.exportations.find((exp) => exp.exportId === id);
	}

	static setupListener() {
		listen('export-progress-main', exportProgress);
		listen('export-heartbeat-main', exportHeartbeat);
		listen('project-export-log-main', projectExportLog);
		listen('project-export-log-batch-main', projectExportLogBatch);
	}

	static currentlyExportingProjects() {
		return globalState.exportations.filter((exp) => exp.isOnGoing());
	}

	static startExportHeartbeatWatchdog(
		exportId: number,
		initialState: ExportState = ExportState.CapturingFrames
	) {
		this.clearExportHeartbeatWatchdog(exportId);
		this.exportHeartbeatLastSeenAt.set(exportId, Date.now());
		this.exportHeartbeatLastState.set(exportId, initialState);

		const timerId = window.setInterval(() => {
			void this.checkExportHeartbeat(exportId);
		}, this.EXPORT_HEARTBEAT_INTERVAL_MS);

		this.exportHeartbeatTimers.set(exportId, timerId);
	}

	static registerExportHeartbeat(
		exportId: number,
		currentState: ExportState = ExportState.CapturingFrames
	) {
		this.exportHeartbeatLastSeenAt.set(exportId, Date.now());
		this.exportHeartbeatLastState.set(exportId, currentState);

		if (
			currentState === ExportState.Exported ||
			currentState === ExportState.Error ||
			currentState === ExportState.Canceled
		) {
			this.clearExportHeartbeatWatchdog(exportId);
		}
	}

	static clearExportHeartbeatWatchdog(exportId: number) {
		const timerId = this.exportHeartbeatTimers.get(exportId);
		if (timerId !== undefined) {
			window.clearInterval(timerId);
			this.exportHeartbeatTimers.delete(exportId);
		}

		this.exportHeartbeatLastSeenAt.delete(exportId);
		this.exportHeartbeatLastState.delete(exportId);
	}

	private static async checkExportHeartbeat(exportId: number) {
		const exportation = globalState.exportations.find((exp) => exp.exportId === exportId);
		if (!exportation || !exportation.isOnGoing()) {
			this.clearExportHeartbeatWatchdog(exportId);
			return;
		}

		const lastSeenAt = this.exportHeartbeatLastSeenAt.get(exportId);
		if (!lastSeenAt) {
			this.exportHeartbeatLastSeenAt.set(exportId, Date.now());
			return;
		}

		const elapsedMs = Date.now() - lastSeenAt;
		if (elapsedMs < this.EXPORT_HEARTBEAT_TIMEOUT_MS) return;

		this.clearExportHeartbeatWatchdog(exportId);

		const lastState = this.exportHeartbeatLastState.get(exportId) ?? exportation.currentState;
		const platform = detectExportCapturePlatform(
			typeof navigator === 'undefined' ? null : navigator.userAgent
		);
		const errorPayload = {
			error: 'export_renderer_heartbeat_timeout',
			exportId,
			platform,
			lastState,
			timeoutMs: this.EXPORT_HEARTBEAT_TIMEOUT_MS,
			lastHeartbeatAt: new Date(lastSeenAt).toISOString(),
			detectedAt: new Date().toISOString(),
			message:
				'The export renderer stopped sending heartbeats. This usually means the export webview main thread froze during frame capture.'
		};
		const errorLog = JSON.stringify(errorPayload);

		exportation.currentState = ExportState.Error;
		exportation.percentageProgress = 100;
		exportation.errorLog = errorLog;

		if (exportation.originalProjectId) {
			await ProjectService.appendExportLog(
				exportation.originalProjectId,
				JSON.stringify({
					timestamp: new Date().toISOString(),
					event: 'export_renderer_heartbeat_timeout',
					exportId,
					platform,
					lastState,
					timeoutMs: this.EXPORT_HEARTBEAT_TIMEOUT_MS
				})
			);
		}

		AnalyticsService.trackExportError(JSON.stringify(exportation), errorLog);
		AnalyticsService.trackMacOSExportLog(errorLog, {
			export_id: exportId.toString(),
			...errorPayload
		});

		try {
			const exportWindow = await WebviewWindow.getByLabel(exportId.toString());
			if (exportWindow) {
				await exportWindow.close();
			}
		} catch (error) {
			console.warn(`Failed to close frozen export window ${exportId}:`, error);
		}

		await this.saveExports();
	}
}

function exportProgress(event: TauriEvent<ExportProgress>): void {
	const data = event.payload as ExportProgress;
	ExportService.registerExportHeartbeat(data.exportId, data.currentState);

	const exportation = globalState.exportations.find((exp) => exp.exportId === data.exportId);
	if (exportation) {
		if (exportation.currentState === ExportState.Canceled) {
			return;
		}

		if (
			exportation.currentState !== ExportState.Exported &&
			data.currentState === ExportState.Exported
		) {
			AnalyticsService.trackExport(
				exportation.videoLength / 1000,
				exportation.verseRange,
				exportation.videoDimensions.width + 'x' + exportation.videoDimensions.height,
				exportation.fps
			);
		}
		exportation.percentageProgress = data.progress;
		exportation.currentState = data.currentState;
		exportation.currentTreatedTime = data.currentTime;

		if (data.errorLog) {
			exportation.errorLog = data.errorLog;
			AnalyticsService.trackExportError(JSON.stringify(exportation), data.errorLog);
		}
	}

	ExportService.saveExports();
}

function exportHeartbeat(event: TauriEvent<ExportHeartbeat>): void {
	const data = event.payload as ExportHeartbeat;
	ExportService.registerExportHeartbeat(data.exportId, data.currentState);
}

export interface ExportProgress {
	exportId: number;
	progress: number;
	currentState: ExportState;
	currentTime: number;
	errorLog?: string;
}

export interface ExportHeartbeat {
	exportId: number;
	currentState: ExportState;
	currentTime?: number;
}

export interface ProjectExportLogEvent {
	projectId: number;
	logEntry: string;
}

function projectExportLog(event: TauriEvent<ProjectExportLogEvent>): void {
	const data = event.payload as ProjectExportLogEvent;

	if (globalState.currentProject?.detail.id === data.projectId) {
		const existingLogs = Array.isArray(
			globalState.currentProject.projectEditorState.export.exportLogs
		)
			? globalState.currentProject.projectEditorState.export.exportLogs
			: [];
		globalState.currentProject.projectEditorState.export.exportLogs = [
			...existingLogs,
			data.logEntry
		].slice(-50000);
	}
}

export interface ProjectExportLogBatchEvent {
	projectId: number;
	logEntries: string[];
}

function projectExportLogBatch(event: TauriEvent<ProjectExportLogBatchEvent>): void {
	const data = event.payload as ProjectExportLogBatchEvent;
	if (data.logEntries.length === 0) return;

	if (globalState.currentProject?.detail.id === data.projectId) {
		const existingLogs = Array.isArray(
			globalState.currentProject.projectEditorState.export.exportLogs
		)
			? globalState.currentProject.projectEditorState.export.exportLogs
			: [];
		globalState.currentProject.projectEditorState.export.exportLogs = [
			...existingLogs,
			...data.logEntries
		].slice(-50000);
	}
}
