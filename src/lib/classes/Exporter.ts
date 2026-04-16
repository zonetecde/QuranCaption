import { globalState } from '$lib/runes/main.svelte';
import { PredefinedSubtitleClip, SubtitleClip } from './Clip.svelte';
import SubtitleFileContentGenerator from './misc/SubtitleFileContentGenerator';
import { Quran } from './Quran';
import { AnalyticsService } from '$lib/services/AnalyticsService';
import ExportFileService from '$lib/services/ExportFileService';
import type { Project } from './Project';
import { ProjectService } from '$lib/services/ProjectService';
import AiTranslationTelemetryService from '$lib/services/AiTranslationTelemetryService';
import ExportService from '$lib/services/ExportService';
import { Utilities } from './misc/Utilities';
import { exists } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import ModalManager from '$lib/components/modals/ModalManager';
import Exportation, { ExportKind, ExportState } from './Exportation.svelte';

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
			return exp.currentState === ExportState.Exporting;
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

			nextExport.currentState = ExportState.Exporting;
			nextExport.percentageProgress = 0;
			nextExport.currentTreatedTime = 0;
			await ExportService.saveExports();

			// TODO
		} catch (error) {
			console.error('Unable to start next pending export:', error);
			if (nextExport && nextExport.currentState === ExportState.Exporting) {
				nextExport.currentState = ExportState.Error;
				nextExport.percentageProgress = 100;
				nextExport.errorLog = String(error);
				await ExportService.saveExports();
			}
		} finally {
			Exporter.isQueueTickRunning = false;
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
						text += subtitle.getTranslation(target).getText();
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

		if (chapters.length > 0 && chapters[0].time !== '0:00') {
			chapters[0].time = '0:00';
		}

		let fileContent = 'YouTube Chapters:\n\n';
		for (const chapter of chapters) {
			fileContent += `${chapter.time} ${chapter.title}\n`;
		}

		AnalyticsService.trackYtbChaptersExport(choice, chapters.length, exportStart, exportEnd);

		const projectName = ExportFileService.getProjectNameForFile();
		const fileName = `qurancaption_chapters_${projectName}.txt`;
		await ExportFileService.saveTextFile(fileName, fileContent, 'YouTube chapters');
	}

	private static formatTimeForYouTube(timeMs: number): string {
		const totalSeconds = Math.floor(timeMs / 1000);
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;

		if (hours > 0) {
			return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
		}

		return `${minutes}:${seconds.toString().padStart(2, '0')}`;
	}

	/**
	 * Exporte le projet sous forme de vidéo.
	 */
	static async exportVideo() {
		const exportFileName = globalState.currentProject!.detail.generateExportFileName() + '.mp4';
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

		// Créer le fichier du projet dans le dossier Export afin que l'Exporter le récupère
		await ExportService.saveProject(project);

		// Ajoute à la liste des exports en cours
		await ExportService.addExport(project, shouldQueue ? 'recording' : 'stable');

		void AiTranslationTelemetryService.handleVideoExportRequested({
			projectId: globalState.currentProject!.detail.id,
			exportStartMs: globalState.getExportState.videoStartTime || 0,
			exportEndMs: globalState.getExportState.videoEndTime || 0,
			clips: globalState.getSubtitleClips.map((clip) => ({
				subtitleId: clip.id,
				startTime: clip.startTime,
				endTime: clip.endTime
			}))
		});

		// Ouvre le popup de monitor d'export
		globalState.uiState.showExportMonitor = true;

		// Set-up l'écouteur d'évènement pour suivre
		// le progrès des projets en cours d'exportation
		Exporter.ensureBackgroundWorkersStarted();

		if (!shouldQueue) {
			// TODO
		}
	}
}
