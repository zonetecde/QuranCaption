import { SubtitleClip, TrackType, VerseRange, type Project } from '$lib/classes';
import { exists, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';
import { globalState } from '$lib/runes/main.svelte';
import Exportation, {
	ExportKind,
	ExportState,
	type ExportLogEntry
} from '$lib/classes/Exportation.svelte';
import { ProjectService } from './ProjectService';
import { listen, type Event as TauriEvent } from '@tauri-apps/api/event';
import { AnalyticsService, type VideoExportFailureStage } from './AnalyticsService';
import { notifyLongTaskCompletion } from './UserAttentionService';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';
import { isWordByWordVisualEnabled } from './StyleVisualResolver';
import type { StyleName } from '$lib/classes/VideoStyle.svelte';
import { deriveQuranReflectionContext } from './QuranReflectionService';
import { Quran } from '$lib/classes/Quran';

/**
 * Parse une date ISO en timestamp millisecondes.
 * Retourne `null` si la valeur est invalide.
 */
function parseIsoDateMs(value: string): number | null {
	const parsed = new Date(value).getTime();
	return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Convertit l'état natif précédent en étape d'échec analytique stable.
 * @param {ExportState} state État actif avant l'échec.
 * @returns {VideoExportFailureStage} Étape normalisée sans détail de fichier ou de log.
 */
function getExportFailureStage(state: ExportState): VideoExportFailureStage {
	switch (state) {
		case ExportState.Initializing:
		case ExportState.WaitingForRecord:
			return 'preparing';
		case ExportState.AddingAudio:
			return 'audio';
		case ExportState.CapturingFrames:
			return 'frames';
		case ExportState.Recording:
		case ExportState.CreatingVideo:
			return 'rendering';
		case ExportState.ProcessingBackground:
		case ExportState.MergingFiles:
			return 'encoding';
		case ExportState.AddingSubtitles:
			return 'writing';
		default:
			return 'finalizing';
	}
}

/**
 * Détermine si le projet exporté utilise au moins un effet visuel mot à mot.
 * @param {Project} project Projet figé pour l'export.
 * @returns {boolean} `true` si un style WBW global ou spécifique à un clip est actif.
 */
function projectUsesWordByWordStyles(project: Project): boolean {
	const subtitleClipIds = project.content.timeline
		.getFirstTrack(TrackType.Subtitle)
		.clips.map((clip) => clip.id);
	return project.content.videoStyle.styles.some(
		(styles) =>
			isWordByWordVisualEnabled((styleId) => styles.getEffectiveValue(styleId as StyleName)) ||
			subtitleClipIds.some((clipId) =>
				isWordByWordVisualEnabled((styleId) =>
					styles.getEffectiveValue(styleId as StyleName, clipId)
				)
			)
	);
}

export interface AddExportOptions {
	finalFileName?: string;
	finalFilePath?: string;
	destinationUri?: string | null;
	exportLabel?: string;
	sourceProjectId?: number;
}

export default class ExportService {
	static exportFolder: string = 'exports/';
	private static isListenerSetup = false;
	private static progressSaveTimer: ReturnType<typeof setTimeout> | null = null;

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

		const exportation = new Exportation(
			project.detail.id,
			fileName,
			filePath,
			(project.content.videoStyle.getStylesOfTarget('global')?.findStyle('video-dimension')
				?.value as {
				width: number;
				height: number;
			}) ?? { width: 1920, height: 1080 },
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
			options.destinationUri ?? null,
			projectUsesWordByWordStyles(project),
			reflectionContext
		);
		globalState.exportations.unshift(exportation);
		AnalyticsService.trackVideoExportStarted(exportation.analyticsWorkflowId, {
			videoDurationSeconds: exportation.videoLength / 1000,
			videoDimensions: `${exportation.videoDimensions.width}x${exportation.videoDimensions.height}`,
			videoWidth: exportation.videoDimensions.width,
			videoHeight: exportation.videoDimensions.height,
			fps: exportation.fps,
			format: videoExtension,
			queued: exportation.currentState === ExportState.WaitingForRecord,
			skippedRangeCount: project.projectEditorState.export.skipRanges.length,
			backgroundIncluded: !project.projectEditorState.export.exportWithoutBackground
		});

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
	 * Sauvegarde les exports en cours.
	 */
	static async saveExports() {
		// S'assure que le dossier existe
		await ProjectService.ensureFolder(this.exportFolder);

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
		const parsedData: unknown = JSON.parse(json);
		const data = Array.isArray(parsedData) ? parsedData : [];
		globalState.exportations = data.map(
			(exp) => Exportation.fromJSON(exp as Record<string, unknown>) as Exportation
		);

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
		} catch (_e) {
			// Ignore file removal failures (already deleted or missing access rights).
		}
	}

	static findExportById(id: number) {
		return globalState.exportations.find((exp) => exp.exportId === id);
	}

	static setupListener() {
		if (this.isListenerSetup) return;
		this.isListenerSetup = true;

		// Écoute les événements de progression d'export donné par Rust
		void listen('export-progress-main', exportProgress);
		void listen('export-log-main', exportLog);
	}

	/**
	 * Regroupe les sauvegardes fréquentes de progression pour limiter les écritures Android.
	 * @returns {void}
	 */
	static scheduleProgressSave(): void {
		if (this.progressSaveTimer !== null) return;
		this.progressSaveTimer = setTimeout(() => {
			this.progressSaveTimer = null;
			void this.saveExports();
		}, 750);
	}

	static currentlyExportingProjects() {
		return globalState.exportations.filter((exp) => exp.isOnGoing());
	}
}

/**
 * Ajoute une ligne de log d'export uniquement en memoire.
 * @param {TauriEvent<ExportLogPayload>} event Evenement de log recu depuis une fenetre d'export.
 * @returns {void}
 */
function exportLog(event: TauriEvent<ExportLogPayload>): void {
	applyExportLog(event.payload);
}

/**
 * Ajoute un log transmis directement par le renderer embarqué.
 * @param {ExportLogPayload} data Log reçu du renderer.
 * @returns {void}
 */
export function applyExportLog(data: ExportLogPayload): void {
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
	applyExportProgress(event.payload);
}

/**
 * Applique une progression transmise directement par le renderer embarqué.
 * @param {ExportProgress} data Progression reçue du renderer.
 * @returns {void}
 */
export function applyExportProgress(data: ExportProgress): void {
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
		if (data.finalFilePath) exportation.finalFilePath = data.finalFilePath;
		if (typeof data.fileSizeBytes === 'number') exportation.fileSizeBytes = data.fileSizeBytes;
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
		const enteredTerminalState =
			![ExportState.Exported, ExportState.Error, ExportState.Canceled].includes(previousState) &&
			[ExportState.Exported, ExportState.Error, ExportState.Canceled].includes(data.currentState);
		if (enteredTerminalState) {
			const startMs = parseIsoDateMs(exportation.date);
			if (startMs !== null) {
				exportation.totalExportTimeMs = Math.max(0, Date.now() - startMs);
			}
			if (exportation.exportKind === ExportKind.Video) {
				AnalyticsService.trackVideoExportFinished(
					exportation.analyticsWorkflowId,
					data.currentState === ExportState.Exported
						? 'completed'
						: data.currentState === ExportState.Canceled
							? 'canceled'
							: 'failed',
					exportation.totalExportTimeMs ?? 0,
					{
						videoDurationSeconds: exportation.videoLength / 1000,
						videoDimensions: `${exportation.videoDimensions.width}x${exportation.videoDimensions.height}`,
						videoWidth: exportation.videoDimensions.width,
						videoHeight: exportation.videoDimensions.height,
						fps: exportation.fps,
						fileSizeBytes: exportation.fileSizeBytes ?? undefined,
						failureStage:
							data.currentState === ExportState.Error
								? getExportFailureStage(previousState)
								: undefined,
						cancelSource: data.currentState === ExportState.Canceled ? 'native' : undefined
					}
				);
			}
		}

		if (!wasExported && data.currentState === ExportState.Exported) {
			if (exportation.exportKind === ExportKind.Video && !data.nativeNotificationCompleted) {
				void notifyLongTaskCompletion({
					title: get(LL).settings.videoExportFinished(),
					body: exportation.finalFileName,
					level: 'success'
				});
			}
		}

		if (data.errorLog) {
			exportation.errorLog = data.errorLog;
		}

		if (
			!wasErrored &&
			data.currentState === ExportState.Error &&
			exportation.exportKind === ExportKind.Video
		) {
			void notifyLongTaskCompletion({
				title: get(LL).settings.videoExportFailed(),
				body: exportation.finalFileName,
				level: 'error'
			});
		}
	}

	if (
		data.currentState === ExportState.Exported ||
		data.currentState === ExportState.Error ||
		data.currentState === ExportState.Canceled
	) {
		void ExportService.saveExports();
	} else {
		ExportService.scheduleProgressSave();
	}
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
	finalFilePath?: string;
	fileSizeBytes?: number;
	nativeNotificationCompleted?: boolean;
}

export interface ExportLogPayload extends ExportLogEntry {
	exportId: number | string;
}
