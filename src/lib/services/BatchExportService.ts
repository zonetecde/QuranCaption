import {
	AssetClip,
	SubtitleClip,
	TrackType,
	type Batch,
	type BatchProjectItem,
	type Project
} from '$lib/classes';
import { ExportState } from '$lib/classes/Exportation.svelte';
import { globalState } from '$lib/runes/main.svelte';
import { join } from '@tauri-apps/api/path';
import { exists } from '@tauri-apps/plugin-fs';
import Exporter, {
	resolveProjectVideoExportRange,
	type YouTubeChaptersChoice
} from '$lib/classes/Exporter';
import ExportService from './ExportService';
import ExportFileService from './ExportFileService';
import { BatchService } from './BatchService';
import { ProjectService } from './ProjectService';
import {
	DEFAULT_RECITATION_CUT_MARGIN_MS,
	DEFAULT_RECITATION_MINIMUM_SILENCE_MS
} from '$lib/classes/ProjectEditorState.svelte';

export const BATCH_EXPORT_CONCURRENCY = 1;

export type BatchExportEligibilityReason =
	| 'PROJECT_MISSING'
	| 'MEDIA_NOT_READY'
	| 'AUDIO_TRACK_EMPTY'
	| 'INVALID_DURATION'
	| 'SUBTITLES_MISSING'
	| 'EXPORT_ACTIVE'
	| 'ASSET_MISSING'
	| 'EXPORT_SETTINGS_INVALID';

export interface BatchExportEligibility {
	item: BatchProjectItem;
	project: Project | null;
	reason: BatchExportEligibilityReason | null;
}

export interface BatchExportProgress {
	activeProjectName: string | null;
	completed: number;
	failed: number;
	remaining: number;
	total: number;
}

type BatchExportUpdate = (item: BatchProjectItem, progress: BatchExportProgress) => void;

export interface BatchExportServiceOptions {
	loadProject?: (projectId: number) => Promise<Project>;
	saveProject?: (project: Project) => Promise<void>;
	saveBatch?: (batch: Batch) => Promise<void>;
	queueProject?: (project: Project, fileName: string, outputPath: string) => Promise<number>;
	waitForExport?: (exportId: number, onProgress: (progress: number) => void) => Promise<void>;
	pathExists?: (path: string) => Promise<boolean>;
	saveTextFile?: (
		fileName: string,
		content: string,
		outputFolder: string,
		exportLabel: string,
		trackInExportMonitor: boolean
	) => Promise<string>;
	onUpdate?: BatchExportUpdate;
}

/**
 * Nettoie un nom de projet pour l'utiliser comme nom de fichier sans extension.
 * @param {string} name Nom du projet.
 * @returns {string} Nom sûr et non vide.
 */
export function sanitizeBatchExportFileName(name: string): string {
	const sanitized = name
		.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
		.replace(/[. ]+$/g, '')
		.trim();
	if (!sanitized) return 'project';
	return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(sanitized)
		? `_${sanitized}`
		: sanitized;
}

/**
 * Inspecte tous les projets dans l'ordre du Batch avant confirmation.
 * @param {BatchProjectItem[]} items Projets à inspecter.
 * @returns {Promise<BatchExportEligibility[]>} Projets chargés et raisons d'incompatibilité.
 */
export async function inspectBatchExportEligibility(
	items: BatchProjectItem[]
): Promise<BatchExportEligibility[]> {
	const results: BatchExportEligibility[] = [];
	for (const item of [...items].sort((left, right) => left.order - right.order)) {
		try {
			const project = await ProjectService.load(item.projectId);
			const audioTrack = project.content.timeline.getFirstTrack(TrackType.Audio);
			const subtitleTrack = project.content.timeline.getFirstTrack(TrackType.Subtitle);
			const audioDuration = audioTrack.getDuration().ms;
			const settings = project.projectEditorState.export;
			const activeExport = globalState.exportations.some(
				(exportation) => exportation.sourceProjectId === item.projectId && exportation.isOnGoing()
			);
			const usedAssetIds = new Set(
				project.content.timeline.tracks.flatMap((track) =>
					track.clips.filter((clip) => clip instanceof AssetClip).map((clip) => clip.assetId)
				)
			);
			const usedAssets = project.content.assets.filter((asset) => usedAssetIds.has(asset.id));
			let reason: BatchExportEligibilityReason | null = null;
			if (activeExport) reason = 'EXPORT_ACTIVE';
			else if (item.media.status !== 'completed') reason = 'MEDIA_NOT_READY';
			else if (audioTrack.clips.length === 0) reason = 'AUDIO_TRACK_EMPTY';
			else if (!Number.isFinite(audioDuration) || audioDuration <= 0) reason = 'INVALID_DURATION';
			else if (
				!subtitleTrack.clips.some(
					(clip) => clip.type === 'Subtitle' || clip.type === 'Pre-defined Subtitle'
				)
			)
				reason = 'SUBTITLES_MISSING';
			else if (
				!(await Promise.all(usedAssets.map((asset) => exists(asset.filePath)))).every(Boolean)
			)
				reason = 'ASSET_MISSING';
			else if (!Number.isFinite(settings.fps) || settings.fps <= 0)
				reason = 'EXPORT_SETTINGS_INVALID';
			else
				[settings.videoStartTime, settings.videoEndTime] = resolveProjectVideoExportRange(
					settings.videoStartTime,
					settings.videoEndTime,
					audioDuration
				);
			results.push({ item, project, reason });
		} catch {
			results.push({ item, project: null, reason: 'PROJECT_MISSING' });
		}
	}
	return results;
}

export class BatchExportService {
	private readonly saveProject: NonNullable<BatchExportServiceOptions['saveProject']>;
	private readonly saveBatch: NonNullable<BatchExportServiceOptions['saveBatch']>;
	private readonly queueProject: NonNullable<BatchExportServiceOptions['queueProject']>;
	private readonly waitForExport: NonNullable<BatchExportServiceOptions['waitForExport']>;
	private readonly pathExists: NonNullable<BatchExportServiceOptions['pathExists']>;
	private readonly saveTextFile: NonNullable<BatchExportServiceOptions['saveTextFile']>;
	private readonly onUpdate?: BatchExportUpdate;
	private saveChain: Promise<void> = Promise.resolve();

	/**
	 * Crée l'orchestrateur séquentiel au-dessus de la queue vidéo existante.
	 * @param {BatchExportServiceOptions} options Dépendances injectables et callback de progression.
	 */
	constructor(options: BatchExportServiceOptions = {}) {
		this.saveProject = options.saveProject ?? ProjectService.save.bind(ProjectService);
		this.saveBatch = options.saveBatch ?? BatchService.save.bind(BatchService);
		this.queueProject = options.queueProject ?? Exporter.queueProjectVideo.bind(Exporter);
		this.waitForExport = options.waitForExport ?? this.waitForRuntimeExport.bind(this);
		this.pathExists = options.pathExists ?? exists;
		this.saveTextFile =
			options.saveTextFile ?? ExportFileService.saveTextFileToFolder.bind(ExportFileService);
		this.onUpdate = options.onUpdate;
	}

	/**
	 * Exporte un fichier de chapitres YouTube par projet chargé.
	 * @param {BatchExportEligibility[]} inspection Projets sélectionnés déjà chargés.
	 * @param {string} outputFolder Dossier de sortie commun.
	 * @param {YouTubeChaptersChoice} choice Regroupement par sourate ou par verset.
	 * @param {boolean} exportOnlyRecitation Retire les silences et passages hors récitation.
	 * @returns {Promise<BatchExportProgress>} Résumé final.
	 */
	async runYouTubeChapters(
		inspection: BatchExportEligibility[],
		outputFolder: string,
		choice: YouTubeChaptersChoice,
		exportOnlyRecitation: boolean = false
	): Promise<BatchExportProgress> {
		const projects = inspection
			.filter((result) => result.project !== null)
			.sort((left, right) => left.item.order - right.item.order);
		const reservedPaths = new Set<string>();
		let completed = 0;
		let failed = inspection.length - projects.length;
		for (const [index, result] of projects.entries()) {
			const project = result.project!;
			this.notify(
				result.item,
				project.detail.name,
				completed,
				failed,
				projects.length - index - 1,
				inspection.length
			);
			try {
				const surahCount = new Set(
					project.content.timeline
						.getFirstTrack(TrackType.Subtitle)
						.clips.filter((clip): clip is SubtitleClip => clip instanceof SubtitleClip)
						.map((clip) => clip.surah)
				).size;
				const chapters = await Exporter.generateYouTubeChapters(
					project,
					choice,
					exportOnlyRecitation,
					surahCount === 1
						? '<timestamp> Verse <verse-number>'
						: '<timestamp> Surah <surah-number>, Verse <verse-number>'
				);
				if (chapters.chapterCount === 0) throw new Error('SUBTITLES_MISSING');
				const outputPath = await this.reserveOutputPath(
					outputFolder,
					`qurancaption_chapters_${sanitizeBatchExportFileName(result.item.projectName)}`,
					'txt',
					reservedPaths
				);
				await this.saveTextFile(
					outputPath.split(/[/\\]/).at(-1)!,
					chapters.content,
					outputFolder,
					'YouTube chapters',
					false
				);
				completed++;
			} catch {
				failed++;
			}
			this.notify(
				result.item,
				null,
				completed,
				failed,
				projects.length - index - 1,
				inspection.length
			);
		}
		return { activeProjectName: null, completed, failed, remaining: 0, total: inspection.length };
	}

	/**
	 * Exporte les projets éligibles un par un, sans arrêter la queue après un échec.
	 * @param {Batch} batch Batch dont les statuts sont persistés.
	 * @param {BatchExportEligibility[]} inspection Résultats confirmés par l'utilisateur.
	 * @param {string} outputFolder Dossier de sortie commun.
	 * @param {boolean} includeNotReady Inclut les projets chargeables malgré leur avertissement.
	 * @param {boolean} exportOnlyRecitation Force les réglages de récitation par défaut sur les copies exportées.
	 * @returns {Promise<BatchExportProgress>} Résumé final.
	 */
	async run(
		batch: Batch,
		inspection: BatchExportEligibility[],
		outputFolder: string,
		includeNotReady: boolean = false,
		exportOnlyRecitation: boolean = false
	): Promise<BatchExportProgress> {
		const eligible = inspection
			.filter(
				(result) =>
					result.project &&
					(result.reason === null || (includeNotReady && result.reason !== 'EXPORT_ACTIVE'))
			)
			.sort((left, right) => left.item.order - right.item.order);
		const eligibleIds = new Set(eligible.map((result) => result.item.projectId));
		const reservedPaths = new Set<string>();
		for (const result of inspection.filter((entry) => !eligibleIds.has(entry.item.projectId))) {
			result.item.export.status = 'failed';
			result.item.export.progress = 0;
			result.item.export.error = result.reason;
		}
		for (const result of eligible) {
			result.item.export.status = 'queued';
			result.item.export.progress = 0;
			result.item.export.error = null;
		}
		await this.persist(batch);

		let completed = 0;
		let failed = 0;
		for (const [index, result] of eligible.entries()) {
			const item = result.item;
			const project = result.project!;
			item.export.status = 'processing';
			item.export.progress = 0;
			this.notify(
				item,
				project.detail.name,
				completed,
				failed,
				eligible.length - index - 1,
				eligible.length
			);
			await this.persist(batch);
			try {
				await this.saveProject(project);
				const extension = project.projectEditorState.export.exportWithoutBackground
					? project.projectEditorState.export.transparentExportFormat === 'webm_vp9_alpha'
						? 'webm'
						: 'mov'
					: 'mp4';
				const outputPath = await this.reserveOutputPath(
					outputFolder,
					sanitizeBatchExportFileName(item.projectName),
					extension,
					reservedPaths
				);
				const fileName = outputPath.split(/[/\\]/).at(-1)!;
				item.export.outputPath = outputPath;
				const exportProject = exportOnlyRecitation ? project.clone() : project;
				if (exportOnlyRecitation) {
					exportProject.projectEditorState.export.exportOnlyRecitation = true;
					exportProject.projectEditorState.export.recitationCutMarginMs =
						DEFAULT_RECITATION_CUT_MARGIN_MS;
					exportProject.projectEditorState.export.recitationMinimumSilenceMs =
						DEFAULT_RECITATION_MINIMUM_SILENCE_MS;
				}
				const exportId = await this.queueProject(exportProject, fileName, outputPath);
				await this.waitForExport(exportId, (progress) => {
					item.export.progress = progress;
					void this.persist(batch);
					this.notify(
						item,
						project.detail.name,
						completed,
						failed,
						eligible.length - index - 1,
						eligible.length
					);
				});
				item.export.status = 'completed';
				item.export.progress = 100;
				item.export.exportedAt = new Date();
				completed++;
			} catch (error) {
				item.export.status = 'failed';
				item.export.error = String(error);
				failed++;
			}
			this.notify(item, null, completed, failed, eligible.length - index - 1, eligible.length);
			await this.persist(batch);
		}
		return { activeProjectName: null, completed, failed, remaining: 0, total: eligible.length };
	}

	/**
	 * Réserve un chemin disponible en suffixant les collisions existantes ou déjà planifiées.
	 * @param {string} folder Dossier commun.
	 * @param {string} baseName Nom sans extension.
	 * @param {string} extension Extension sans point.
	 * @param {Set<string>} reservedPaths Chemins réservés par l'exécution courante.
	 * @returns {Promise<string>} Chemin final unique.
	 */
	private async reserveOutputPath(
		folder: string,
		baseName: string,
		extension: string,
		reservedPaths: Set<string>
	): Promise<string> {
		let suffix = 0;
		while (true) {
			const fileName = `${baseName}${suffix === 0 ? '' : `-${suffix}`}.${extension}`;
			const outputPath = await join(folder, fileName);
			if (!reservedPaths.has(outputPath) && !(await this.pathExists(outputPath))) {
				reservedPaths.add(outputPath);
				return outputPath;
			}
			suffix++;
		}
	}

	/**
	 * Attend l'état terminal d'un export existant et relaie sa progression.
	 * @param {number} exportId Identifiant runtime de l'Export Monitor.
	 * @param {(progress: number) => void} onProgress Callback de progression.
	 * @returns {Promise<void>} Promesse rejetée si l'export échoue ou est annulé.
	 */
	private async waitForRuntimeExport(
		exportId: number,
		onProgress: (progress: number) => void
	): Promise<void> {
		while (true) {
			const exportation = ExportService.findExportById(exportId);
			if (!exportation) throw new Error('EXPORT_MISSING');
			onProgress(exportation.percentageProgress);
			if (exportation.currentState === ExportState.Exported) return;
			if (
				exportation.currentState === ExportState.Error ||
				exportation.currentState === ExportState.Canceled
			)
				throw new Error(exportation.errorLog || exportation.currentState);
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
	}

	/**
	 * Sauvegarde le manifeste après chaque transition durable.
	 * @param {Batch} batch Batch à sauvegarder.
	 * @returns {Promise<void>} Promesse résolue après l'écriture.
	 */
	private persist(batch: Batch): Promise<void> {
		batch.updatedAt = new Date();
		this.saveChain = this.saveChain.then(() => this.saveBatch(batch));
		return this.saveChain;
	}

	/**
	 * Publie un résumé compact pour le workspace.
	 * @param {BatchProjectItem} item Projet venant de changer.
	 * @param {string | null} activeProjectName Projet actif éventuel.
	 * @param {number} completed Nombre de succès.
	 * @param {number} failed Nombre d'échecs.
	 * @param {number} remaining Nombre restant.
	 * @param {number} total Nombre total éligible.
	 * @returns {void}
	 */
	private notify(
		item: BatchProjectItem,
		activeProjectName: string | null,
		completed: number,
		failed: number,
		remaining: number,
		total: number
	): void {
		this.onUpdate?.(item, { activeProjectName, completed, failed, remaining, total });
	}
}
