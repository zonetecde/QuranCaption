import { globalState } from '$lib/runes/main.svelte';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { LogicalPosition } from '@tauri-apps/api/dpi';
import { PredefinedSubtitleClip, SubtitleClip } from './Clip.svelte';
import SubtitleFileContentGenerator from './misc/SubtitleFileContentGenerator';
import { Quran } from './Quran';
import { Utilities } from './misc/Utilities';
import ExportService from '$lib/services/ExportService';
import { BaseDirectory, join } from '@tauri-apps/api/path';
import { exists, remove } from '@tauri-apps/plugin-fs';
import { AnalyticsService } from '$lib/services/AnalyticsService';
import ExportFileService from '$lib/services/ExportFileService';
import type { BackgroundThrottlingPolicy } from '@tauri-apps/api/window';
import Exportation, { ExportKind, ExportState } from './Exportation.svelte';
import type { Project } from './Project';
import { ProjectService } from '$lib/services/ProjectService';
import ModalManager from '$lib/components/modals/ModalManager';
import AiTranslationTelemetryService from '$lib/services/AiTranslationTelemetryService';
import { getRukuExportTargets, type RukuExportTarget } from '$lib/services/RukuExportService';

export default class Exporter {
	private static queueIntervalId: number | null = null;
	private static isQueueTickRunning = false;
	private static isExportListenerSetup = false;
	private static readonly QUEUE_POLL_INTERVAL_MS = 750;

	/**
	 * Ensure that background workers are started for exporting.
	 * @returns {void}
	 */
	private static ensureBackgroundWorkersStarted() {
		if (!Exporter.isExportListenerSetup) {
			ExportService.setupListener();
			Exporter.isExportListenerSetup = true;
		}

		if (Exporter.queueIntervalId !== null) return;
		Exporter.queueIntervalId = window.setInterval(() => {
			void Exporter.processExportQueue();
		}, Exporter.QUEUE_POLL_INTERVAL_MS);
	}

	/**
	 * Checks if there is an active video export.
	 * @returns {boolean}
	 */
	private static hasActiveVideoExport(): boolean {
		return globalState.exportations.some((exp) => {
			if (exp.exportKind !== ExportKind.Video) return false;
			return (
				exp.currentState === ExportState.CapturingFrames ||
				exp.currentState === ExportState.Initializing ||
				exp.currentState === ExportState.ProcessingBackground ||
				exp.currentState === ExportState.AddingSubtitles ||
				exp.currentState === ExportState.CreatingVideo ||
				exp.currentState === ExportState.MergingFiles ||
				exp.currentState === ExportState.Recording ||
				exp.currentState === ExportState.AddingAudio
			);
		});
	}

	/**
	 * Get the next pending video export.
	 * @returns {Exportation | undefined}
	 */
	private static getNextPendingVideoExport(): Exportation | undefined {
		return globalState.exportations
			.filter(
				(exp) =>
					exp.exportKind === ExportKind.Video && exp.currentState === ExportState.WaitingForRecord
			)
			.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];
	}

	// Queue rule: only one active video export at a time (FIFO for pending exports).
	private static async processExportQueue() {
		if (Exporter.isQueueTickRunning) return;
		Exporter.isQueueTickRunning = true;
		let nextExport: Exportation | undefined;

		try {
			if (Exporter.hasActiveVideoExport()) return;

			nextExport = Exporter.getNextPendingVideoExport();
			if (!nextExport) return;

			nextExport.currentState = ExportState.CapturingFrames;
			nextExport.percentageProgress = 0;
			nextExport.currentTreatedTime = 0;
			await ExportService.saveExports();

			await Exporter.openExportWindow(nextExport.exportId.toString());
		} catch (error) {
			console.error('Unable to start next pending export:', error);
			if (nextExport && nextExport.currentState === ExportState.CapturingFrames) {
				nextExport.currentState = ExportState.Error;
				nextExport.percentageProgress = 100;
				nextExport.errorLog = String(error);
				await ExportService.saveExports();
			}
		} finally {
			Exporter.isQueueTickRunning = false;
		}
	}

	private static async openExportWindow(exportId: string) {
		// Créer une fenêtre Tauri avec la bonne taille
		const w = new WebviewWindow(exportId, {
			center: false,
			decorations: false,
			visible: true,
			focus: false,
			skipTaskbar: true,
			preventOverflow: false,
			x: -10000,
			y: -10000,
			backgroundThrottling: 'disabled' as BackgroundThrottlingPolicy,
			alwaysOnTop: false,
			alwaysOnBottom: true,
			title: 'QC - ' + exportId,
			url: '/exporter?' + new URLSearchParams({ id: exportId }) // Met en paramètre l'ID de l'export pour que l'exportateur puisse le récupérer
		});

		w.once('tauri://created', async () => {
			try {
				await w.setPosition(new LogicalPosition(-10000, -10000));
			} catch (error) {
				console.warn('Unable to move export window off-screen:', error);
			}
		});

		// listen  to close
		w.listen('tauri://close-requested', async () => {
			try {
				// Supprime le dossier temporaire des images
				await remove(await join(ExportService.exportFolder, exportId), {
					baseDir: BaseDirectory.AppData,
					recursive: true
				});
			} catch (error) {
				console.error('Error removing temporary images folder:', error);
			} finally {
				// ferme la fenêtre
				await w.destroy();
			}
		});
	}

	/**
	 * Retourne l'extension video selon les reglages d'export courants.
	 * @returns {'mp4' | 'mov' | 'webm'} Extension sans point.
	 */
	private static getVideoExtension(): 'mp4' | 'mov' | 'webm' {
		if (!globalState.getExportState.exportWithoutBackground) return 'mp4';
		return globalState.getExportState.transparentExportFormat === 'webm_vp9_alpha' ? 'webm' : 'mov';
	}

	/**
	 * Nettoie un nom de fichier sans extension pour Windows/macOS/Linux.
	 * @param {string} fileNameBase Nom de fichier sans extension.
	 * @returns {string} Nom nettoye.
	 */
	private static sanitizeFileNameBase(fileNameBase: string): string {
		return fileNameBase.replace(/[/\\:*?"<>|]/g, '_').trim();
	}

	/**
	 * Retourne le nom de fichier sans extension d'une video de ruku.
	 * @param {RukuExportTarget} target Segment ruku a exporter.
	 * @returns {string} Nom de fichier sans extension.
	 */
	private static getRukuFileNameBase(target: RukuExportTarget): string {
		const surahName = Quran.surahs[target.surah - 1]?.name || `Surah ${target.surah}`;
		const rukuNumber = target.rukuNumber.toString().padStart(2, '0');
		const customFileName = globalState.getExportState.customFileName.trim();
		const baseName = customFileName || globalState.currentProject!.detail.generateExportFileName();

		return Exporter.sanitizeFileNameBase(
			`${baseName} - Ruku ${rukuNumber} - ${surahName} ${target.startAyah}-${target.endAyah}`
		);
	}

	/**
	 * Retourne la fin effective de la plage d'export courante.
	 * @returns {number} Fin d'export en millisecondes.
	 */
	private static getResolvedExportEndTime(): number {
		const exportStart = globalState.getExportState.videoStartTime || 0;
		const exportEnd = globalState.getExportState.videoEndTime || 0;
		if (exportEnd > exportStart) return exportEnd;

		return (
			globalState.getAudioTrack.getDuration().ms ||
			globalState.getSubtitleTrack.getDuration().ms ||
			Number.POSITIVE_INFINITY
		);
	}

	/**
	 * Calcule les segments ruku complets depuis les versets captionnes.
	 * @returns {RukuExportTarget[]} Segments de ruku exportables.
	 */
	private static getRukuVideoExportTargets(): RukuExportTarget[] {
		return getRukuExportTargets(
			globalState.getSubtitleClips.map((clip) => ({
				surah: clip.surah,
				verse: clip.verse,
				startTime: clip.startTime,
				endTime: clip.endTime
			})),
			globalState.getExportState.videoStartTime || 0,
			Exporter.getResolvedExportEndTime()
		);
	}

	/**
	 * Enregistre un projet d'export video et le demarre ou le met en file.
	 * @param {Project} project Copie du projet a exporter.
	 * @param {'recording' | 'stable'} mode Etat initial de l'export.
	 * @param {string | undefined} fileNameBase Nom de fichier sans extension, si deja calcule.
	 * @returns {Promise<void>} Promise resolue quand l'export est ajoute.
	 */
	private static async queueVideoProjectExport(
		project: Project,
		mode: 'recording' | 'stable',
		fileNameBase?: string
	): Promise<void> {
		await ExportService.saveProject(project);
		await ExportService.addExport(project, mode, fileNameBase);

		void AiTranslationTelemetryService.handleVideoExportRequested({
			projectId: globalState.currentProject!.detail.id,
			exportStartMs: project.projectEditorState.export.videoStartTime || 0,
			exportEndMs: project.projectEditorState.export.videoEndTime || 0,
			clips: globalState.getSubtitleClips.map((clip) => ({
				subtitleId: clip.id,
				startTime: clip.startTime,
				endTime: clip.endTime
			}))
		});

		globalState.uiState.showExportMonitor = true;
		Exporter.ensureBackgroundWorkersStarted();

		if (mode === 'stable') {
			await Exporter.openExportWindow(project.detail.id.toString());
		}
	}

	/**
	 * Exporte le projet sous forme de sous-titres
	 */
	static async exportSubtitles() {
		const es = globalState.getExportState;

		const settings = {
			format: es.subtitleFormat,
			includedTargets: Object.entries(es.includedTarget)
				.filter(([, included]) => included)
				.map(([target]) => target),
			exportVerseNumbers: es.exportVerseNumbers
		};

		const subtitles: {
			startTimeMs: number;
			endTimeMs: number;
			text: string;
		}[] = [];

		for (const subtitle of globalState.getSubtitleTrack.clips) {
			// Skip les clips silencieux ou sans texte
			if (!(subtitle instanceof SubtitleClip || subtitle instanceof PredefinedSubtitleClip))
				continue;

			const startTime = subtitle.startTime;
			const endTime = subtitle.endTime;

			let text = '';

			for (const target of settings.includedTargets) {
				if (target === 'arabic') {
					text += subtitle.getText();
				} else {
					if (subtitle instanceof SubtitleClip)
						text += subtitle.getTranslation(target).getText(target, subtitle);
					else if (subtitle instanceof PredefinedSubtitleClip)
						text += subtitle.getTranslation(target).getText(); // Pas de numéro de verset, donc getText() suffit
				}

				text += '\n';
			}

			subtitles.push({
				startTimeMs: startTime,
				endTimeMs: endTime,
				text: text.trim()
			});
		}

		const fileContent = SubtitleFileContentGenerator.generateSubtitleFile(
			subtitles,
			settings.format
		);

		AnalyticsService.trackSubtitlesExport(
			settings.format,
			settings.includedTargets,
			settings.exportVerseNumbers,
			subtitles.length
		);

		const projectName = ExportFileService.getProjectNameForFile();
		const fileName = `qurancaption_subtitles_${projectName}.${settings.format.toLowerCase()}`;
		await ExportFileService.saveTextFile(fileName, fileContent, 'Subtitles');
	}
	static async exportProjectData(project?: Project | null) {
		const projectData = project || globalState.currentProject;

		if (!projectData) {
			console.error('No project data available for export.');
			return;
		}

		const json = JSON.stringify(projectData, null, 2);
		const projectName = ExportFileService.getProjectNameForFile();
		const fileName = `qurancaption_project_${projectName}.json`;
		await ExportFileService.saveTextFile(fileName, json, 'Project data');
	}
	static async backupAllProjects() {
		const projectsDetails = globalState.userProjectsDetails;
		if (!projectsDetails || projectsDetails.length === 0) {
			console.error('No projects available for backup.');
			return;
		}

		const projects: Project[] = [];
		for (const project of projectsDetails) {
			const json = await ProjectService.load(project.id);
			projects.push(json);
		}

		await ExportFileService.saveTextFile(
			`qurancaption_backup_${Date.now()}.json`,
			JSON.stringify(projects),
			'Project backup'
		);
	}
	static async exportYtbChapters() {
		const choice = globalState.getExportState.ytbChaptersChoice;
		const subtitlesClips: SubtitleClip[] = globalState.getSubtitleClips;
		const exportStart = globalState.getExportState.videoStartTime || 0;
		const exportEnd = globalState.getExportState.videoEndTime || 0;
		const hasEndBound = exportEnd > exportStart;

		const clipWithinExportRange = (clip: SubtitleClip) => {
			if (clip.endTime <= exportStart) return false;
			if (hasEndBound && clip.startTime >= exportEnd) return false;
			return true;
		};

		const normalizeTime = (timeMs: number) => Math.max(0, timeMs - exportStart);

		if (!subtitlesClips || subtitlesClips.length === 0) {
			console.error('No subtitle clips available for export.');
			return;
		}

		const chapters: { time: string; title: string }[] = [];

		if (choice === 'Each Surah') {
			// Groupe par sourate
			let lastSurahAdded = -1;

			for (const clip of subtitlesClips) {
				if (!(clip instanceof SubtitleClip)) continue;
				if (!clipWithinExportRange(clip)) continue;

				if (clip.surah !== lastSurahAdded) {
					lastSurahAdded = clip.surah;
					const timeFormatted = Exporter.formatTimeForYouTube(normalizeTime(clip.startTime));
					const surahName = Quran.surahs[clip.surah - 1]?.name || `Surah ${clip.surah}`;
					chapters.push({
						time: timeFormatted,
						title: `Surah ${surahName}`
					});
				}
			}
		} else if (choice === 'Each Verse') {
			// Groupe par verset
			let lastSurahVerse = '';

			for (const clip of subtitlesClips) {
				if (!(clip instanceof SubtitleClip)) continue;
				if (!clipWithinExportRange(clip)) continue;

				const currentSurahVerse = `${clip.surah}:${clip.verse}`;
				if (currentSurahVerse !== lastSurahVerse) {
					lastSurahVerse = currentSurahVerse;
					const timeFormatted = Exporter.formatTimeForYouTube(normalizeTime(clip.startTime));
					chapters.push({
						time: timeFormatted,
						title: `Surah ${clip.surah}, Verse ${clip.verse}`
					});
				}
			}
		}

		// S'assurer que le premier timestamp est 0:00 pour la compatibilité YouTube
		if (chapters.length > 0 && chapters[0].time !== '0:00') {
			chapters[0].time = '0:00';
		}

		// Génère le contenu du fichier
		let fileContent = 'YouTube Chapters:\n\n';
		for (const chapter of chapters) {
			fileContent += `${chapter.time} ${chapter.title}\n`;
		}

		AnalyticsService.trackYtbChaptersExport(choice, chapters.length, exportStart, exportEnd);

		const projectName = ExportFileService.getProjectNameForFile();
		const fileName = `qurancaption_chapters_${projectName}.txt`;
		await ExportFileService.saveTextFile(fileName, fileContent, 'YouTube chapters');
	}
	/**
	 * Convertit le temps en millisecondes au format YouTube (MM:SS ou HH:MM:SS)
	 */
	private static formatTimeForYouTube(timeMs: number): string {
		const totalSeconds = Math.floor(timeMs / 1000);
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;

		if (hours > 0) {
			return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
		} else {
			return `${minutes}:${seconds.toString().padStart(2, '0')}`;
		}
	}

	/**
	 * Exporte une video separee pour chaque ruku complet de la plage courante.
	 * @returns {Promise<void>} Promise resolue quand tous les exports sont ajoutes.
	 */
	static async exportRukuVideos(): Promise<void> {
		const targets = Exporter.getRukuVideoExportTargets();
		if (targets.length === 0) {
			await ModalManager.errorModal(
				'No complete ruku ranges found',
				'Ruku export needs every ayah of a ruku to be captioned inside the selected export range.'
			);
			return;
		}

		const videoExtension = Exporter.getVideoExtension();
		const exportFolder = await ExportService.getExportFolder();
		const plannedExports: Array<{
			target: RukuExportTarget;
			fileNameBase: string;
			filePath: string;
		}> = [];

		for (const target of targets) {
			const fileNameBase = Exporter.getRukuFileNameBase(target);
			plannedExports.push({
				target,
				fileNameBase,
				filePath: await join(exportFolder, `${fileNameBase}.${videoExtension}`)
			});
		}

		const existingFileCount = (
			await Promise.all(plannedExports.map((planned) => exists(planned.filePath)))
		).filter(Boolean).length;

		if (existingFileCount > 0) {
			const confirmOverwrite = await ModalManager.confirmModal(
				`${existingFileCount} ruku video file${
					existingFileCount > 1 ? 's' : ''
				} already exist. They will be overwritten. Continue?`,
				true
			);
			if (!confirmOverwrite) return;
		}

		for (const planned of plannedExports) {
			const exportId = Utilities.randomId().toString();
			const shouldQueue =
				Exporter.hasActiveVideoExport() || Exporter.getNextPendingVideoExport() !== undefined;
			const project = globalState.currentProject!.clone();
			project.detail.id = Number(exportId);
			project.projectEditorState.export.videoStartTime = planned.target.startTime;
			project.projectEditorState.export.videoEndTime = planned.target.endTime;
			project.projectEditorState.export.customFileName = planned.fileNameBase;

			await Exporter.queueVideoProjectExport(
				project,
				shouldQueue ? 'recording' : 'stable',
				planned.fileNameBase
			);
		}
	}

	/**
	 * Exporte le projet sous forme de video.
	 * @returns {Promise<void>} Promise resolue quand l'export est ajoute.
	 */
	static async exportVideo() {
		const videoExtension = Exporter.getVideoExtension();
		const exportFileName =
			globalState.currentProject!.detail.generateExportFileName() + '.' + videoExtension;
		const exportFilePath = await join(await ExportService.getExportFolder(), exportFileName);
		if (await exists(exportFilePath)) {
			const confirmOverwrite = await ModalManager.confirmModal(
				'An exported video with the same name already exists. It will be overwritten. Continue?',
				true
			);
			if (!confirmOverwrite) {
				return;
			}
		}

		// Génère un ID d'export unique.
		const exportId = Utilities.randomId().toString();
		const shouldQueue =
			Exporter.hasActiveVideoExport() || Exporter.getNextPendingVideoExport() !== undefined;

		// Fait une copie du projet à l'état actuelle
		const project = globalState.currentProject!.clone();
		project.detail.id = Number(exportId); // L'ID du projet est l'ID d'export

		await Exporter.queueVideoProjectExport(project, shouldQueue ? 'recording' : 'stable');
	}
}
