import { SubtitleClip, TrackType, VerseRange, type Project } from '$lib/classes';
import { exists, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { globalState } from '$lib/runes/main.svelte';
import Exportation, {
	ExportKind,
	ExportState,
	type ExportLogEntry
} from '$lib/classes/Exportation.svelte';
import { ProjectService } from './ProjectService';
import { listen, type Event as TauriEvent } from '@tauri-apps/api/event';
import { deriveQuranReflectionContext } from './QuranReflectionService';
import { Quran } from '$lib/classes/Quran';
import { notifyLongTaskCompletion } from './UserAttentionService';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';

/**
 * Parse une date ISO en timestamp millisecondes.
 * Retourne `null` si la valeur est invalide.
 */
function parseIsoDateMs(value: string): number | null {
	const parsed = new Date(value).getTime();
	return Number.isFinite(parsed) ? parsed : null;
}

export interface AddExportOptions {
	finalFileName?: string;
	finalFilePath?: string;
	exportLabel?: string;
	sourceProjectId?: number;
}

export default class ExportService {
	static exportFolder: string = 'exports/';
	private static loadedExportIds = new Set<number>();
	private static ownedExportIds = new Set<number>();

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
	 * @param {Project} project Projet à ajouter.
	 * @param {'recording' | 'stable'} mode État initial dans la queue existante.
	 * @param {AddExportOptions} options Nom, chemin et métadonnées Batch éventuels.
	 * @returns {Promise<void>} Promesse résolue après la persistance du monitor.
	 */
	static async addExport(
		project: Project,
		mode: 'recording' | 'stable' = 'stable',
		options: AddExportOptions = {}
	) {
		// Ajoute le projet à la liste des exports en cours

		const videoExtension = project.projectEditorState.export.exportWithoutBackground
			? project.projectEditorState.export.transparentExportFormat === 'webm_vp9_alpha'
				? 'webm'
				: 'mov'
			: 'mp4';
		let fileName =
			options.finalFileName ?? project.detail.generateExportFileName() + '.' + videoExtension;
		let filePath = options.finalFilePath ?? (await join(await this.getExportFolder(), fileName));

		filePath = await this.constrainFilePathLength(filePath);
		fileName = filePath.split(/[/\\]/).at(-1)!;
		if (options.finalFilePath && (await exists(filePath))) throw new Error('EXPORT_FILE_EXISTS');

		console.log('Final export file path:', filePath);

		const subtitleClips = project.content.timeline
			.getFirstTrack(TrackType.Subtitle)
			.clips.filter((clip): clip is SubtitleClip => clip instanceof SubtitleClip);
		const verseCounts = Object.fromEntries(
			Quran.surahs.map((surah) => [surah.id, surah.totalAyah])
		);
		const reflectionContext = deriveQuranReflectionContext(
			subtitleClips,
			project.projectEditorState.export.videoStartTime,
			project.projectEditorState.export.videoEndTime,
			verseCounts,
			project.projectEditorState.export.skipRanges
		);
		const videoDimensions = (project.content.videoStyle
			.getStylesOfTarget('global')
			?.findStyle('video-dimension')?.value as {
			width: number;
			height: number;
		}) ?? { width: 1920, height: 1080 };
		const exportation = new Exportation(
			project.detail.id,
			fileName,
			filePath,
			videoDimensions,
			project.projectEditorState.export.videoStartTime,
			project.projectEditorState.export.videoEndTime,
			VerseRange.getVerseRangeFromClips(
				project.content.timeline
					.getFirstTrack(TrackType.Subtitle)
					.clips.filter((clip): clip is SubtitleClip => clip instanceof SubtitleClip),
				project.projectEditorState.export.videoStartTime,
				project.projectEditorState.export.videoEndTime
			).toString(),
			mode === 'recording' ? ExportState.WaitingForRecord : ExportState.CapturingFrames,
			project.projectEditorState.export.fps,
			0,
			0,
			'',
			ExportKind.Video,
			options.exportLabel ?? '',
			options.sourceProjectId ?? null,
			reflectionContext
		);
		exportation.startAnalytics({
			video_duration_seconds: exportation.videoLength / 1000,
			video_width: videoDimensions.width,
			video_height: videoDimensions.height,
			fps: project.projectEditorState.export.fps,
			background_included: !project.projectEditorState.export.exportWithoutBackground,
			transparent_format: project.projectEditorState.export.exportWithoutBackground
				? project.projectEditorState.export.transparentExportFormat
				: undefined,
			export_only_recitation: project.projectEditorState.export.exportOnlyRecitation,
			skipped_range_count: project.projectEditorState.export.skipRanges.length,
			queued: mode === 'recording',
			is_batch_export: Boolean(options.exportLabel)
		});

		this.ownedExportIds.add(exportation.exportId);
		globalState.exportations.unshift(exportation);

		// Sauvegarde les exports en cours
		await this.saveExports();
	}

	/**
	 * Réduit le nom de fichier pour conserver une marge compatible avec les chemins temporaires Windows.
	 * @param {string} filePath Chemin de fichier à contraindre.
	 * @returns {Promise<string>} Chemin original ou raccourci.
	 */
	static async constrainFilePathLength(filePath: string): Promise<string> {
		const maxPathLength = 220;
		const tempSuffixMargin = 48;
		const maxFileNameBytes = 255 - tempSuffixMargin;
		const textEncoder = new TextEncoder();
		const pathParts = filePath.split(/[/\\]/);
		const fileName = pathParts.pop()!;
		const dirPath = pathParts.join('/');
		const maxFileNameLength = Math.max(32, maxPathLength - dirPath.length - 1 - tempSuffixMargin);

		// Laisse une marge pour les fichiers temporaires Rust qui ajoutent un suffixe `-tmp-...`.
		if (
			filePath.length > maxPathLength ||
			fileName.length > maxFileNameLength ||
			textEncoder.encode(fileName).length > maxFileNameBytes
		) {
			let suffix = '';
			for (const character of Array.from(fileName).reverse()) {
				const candidate = character + suffix;
				if (
					candidate.length > maxFileNameLength - 3 ||
					textEncoder.encode(candidate).length > maxFileNameBytes - 3
				)
					break;
				suffix = candidate;
			}
			const newFileName = '...' + suffix;
			filePath = await join(dirPath, newFileName);
		}

		return filePath;
	}

	/**
	 * Sauvegarde uniquement les entrées modifiées par cette fenêtre sans écraser celles des autres.
	 * @returns {Promise<void>} Promesse résolue après la fusion côté Rust.
	 */
	static async saveExports(): Promise<void> {
		await ProjectService.ensureFolder(this.exportFolder);

		const currentIds = new Set(globalState.exportations.map((exp) => exp.exportId));
		const changedExportIds = new Set(this.ownedExportIds);

		for (const exportId of currentIds) {
			if (!this.loadedExportIds.has(exportId)) changedExportIds.add(exportId);
		}
		for (const exportId of this.loadedExportIds) {
			if (!currentIds.has(exportId)) changedExportIds.add(exportId);
		}

		if (changedExportIds.size === 0) return;

		await invoke('merge_export_entries', {
			ownedExportIds: Array.from(changedExportIds),
			exports: globalState.exportations
				.filter((exp) => changedExportIds.has(exp.exportId))
				.map((exp) => exp.toJSON())
		});
	}

	/**
	 * Charge le monitor d'exports sans annuler les exports appartenant à une autre fenêtre active.
	 * @returns {Promise<void>} Promesse résolue lorsque l'état local est hydraté.
	 */
	static async loadExports(): Promise<void> {
		const filePath = await join(await appDataDir(), `exports.json`);

		if ((await exists(filePath)) === false) {
			// Aucun export trouvé
			globalState.exportations = [];
			this.loadedExportIds = new Set();
			return;
		}

		const json = await readTextFile(filePath);
		const parsedData: unknown = JSON.parse(json);
		const data = Array.isArray(parsedData) ? parsedData : [];
		globalState.exportations = data.map(
			(exp) => Exportation.fromJSON(exp as Record<string, unknown>) as Exportation
		);
		this.loadedExportIds = new Set(globalState.exportations.map((exp) => exp.exportId));

		// Seule la fenêtre initiale correspond à un vrai redémarrage du processus.
		if (getCurrentWindow().label !== 'main') return;

		const interruptedExportIds: number[] = [];
		globalState.exportations.forEach((exp) => {
			if (exp.isOnGoing()) {
				exp.currentState = ExportState.Canceled;
				interruptedExportIds.push(exp.exportId);
			}
		});

		if (interruptedExportIds.length > 0) {
			const interruptedIds = new Set(interruptedExportIds);
			await invoke('merge_export_entries', {
				ownedExportIds: interruptedExportIds,
				exports: globalState.exportations
					.filter((exp) => interruptedIds.has(exp.exportId))
					.map((exp) => exp.toJSON())
			});
		}
	}

	static async deleteProjectFile(exportIdId: number) {
		const exportPath = await join(await appDataDir(), this.exportFolder);

		try {
			// Construis le chemin d'accès vers le projet
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
		// Écoute les événements de progression d'export donné par Rust
		listen('export-progress-main', exportProgress);
		listen('export-log-main', exportLog);
	}

	static currentlyExportingProjects() {
		return globalState.exportations.filter(
			(exp) => exp.isOnGoing() && this.ownedExportIds.has(exp.exportId)
		);
	}
}

/**
 * Ajoute une ligne de log d'export uniquement en memoire.
 * @param {TauriEvent<ExportLogPayload>} event Evenement de log recu depuis une fenetre d'export.
 * @returns {void}
 */
function exportLog(event: TauriEvent<ExportLogPayload>): void {
	const data = event.payload;
	const exportation = globalState.exportations.find(
		(exp) => exp.exportId === Number(data.exportId)
	);

	if (!exportation) return;

	exportation.addExportLog({
		timestamp: data.timestamp,
		source: data.source,
		level: data.level,
		message: data.message
	});
}

function exportProgress(event: TauriEvent<ExportProgress>): void {
	const data = event.payload as ExportProgress;

	const exportation = globalState.exportations.find((exp) => exp.exportId === data.exportId);
	if (exportation) {
		const previousState = exportation.currentState;
		const wasExported = exportation.currentState === ExportState.Exported;
		const wasErrored = exportation.currentState === ExportState.Error;
		if (exportation.currentState === ExportState.Canceled) {
			// Si l'exportation a été annulée, on ignore les mises à jour
			return;
		}

		exportation.percentageProgress = data.progress;
		exportation.currentState = data.currentState;
		exportation.currentTreatedTime = data.currentTime;
		exportation.hasSecondarySegmentProgress = data.hasSecondarySegmentProgress ?? false;
		exportation.processingBackgroundProgress = data.processingBackgroundProgress ?? 0;
		exportation.processingBackgroundCurrentSegment = data.processingBackgroundCurrentSegment ?? 0;
		exportation.processingBackgroundTotalSegments = data.processingBackgroundTotalSegments ?? 0;
		exportation.mergingFilesProgress = data.mergingFilesProgress ?? 0;
		exportation.mergingFilesCurrentSegment = data.mergingFilesCurrentSegment ?? 0;
		exportation.mergingFilesTotalSegments = data.mergingFilesTotalSegments ?? 0;
		if (typeof data.currentBatchSize === 'number') {
			exportation.currentBatchSize = data.currentBatchSize;
		} else if (
			data.currentState !== ExportState.AddingSubtitles &&
			data.currentState !== ExportState.CreatingVideo
		) {
			exportation.currentBatchSize = null;
		}
		if (!wasExported && data.currentState === ExportState.Exported) {
			const startMs = parseIsoDateMs(exportation.date);
			if (startMs !== null) {
				exportation.totalExportTimeMs = Math.max(0, Date.now() - startMs);
			}

			if (exportation.exportKind === ExportKind.Video) {
				void notifyLongTaskCompletion({
					title: get(LL).settings.videoExportFinished(),
					body: exportation.finalFileName,
					level: 'success'
				});
			}
			exportation.trackAnalyticsTerminal(ExportState.Exported);
		}

		if (data.errorLog) {
			exportation.errorLog = data.errorLog;
		}

		if (
			!wasErrored &&
			data.currentState === ExportState.Error &&
			exportation.exportKind === ExportKind.Video
		) {
			exportation.trackAnalyticsTerminal(ExportState.Error, {
				failureStage: previousState
			});
			void notifyLongTaskCompletion({
				title: get(LL).settings.videoExportFailed(),
				body: exportation.finalFileName,
				level: 'error'
			});
		}
	}

	ExportService.saveExports();
}

export interface ExportProgress {
	exportId: number;
	progress: number;
	currentState: ExportState;
	currentTime: number;
	hasSecondarySegmentProgress?: boolean;
	processingBackgroundProgress?: number;
	processingBackgroundCurrentSegment?: number;
	processingBackgroundTotalSegments?: number;
	mergingFilesProgress?: number;
	mergingFilesCurrentSegment?: number;
	mergingFilesTotalSegments?: number;
	currentBatchSize?: number;
	errorLog?: string;
}

export interface ExportLogPayload extends ExportLogEntry {
	exportId: number | string;
}
