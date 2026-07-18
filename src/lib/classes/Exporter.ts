import { globalState } from '$lib/runes/main.svelte';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { LogicalPosition } from '@tauri-apps/api/dpi';
import { PredefinedSubtitleClip, SubtitleClip } from './Clip.svelte';
import SubtitleFileContentGenerator from './misc/SubtitleFileContentGenerator';
import { Quran } from './Quran';
import { Utilities } from './misc/Utilities';
import ExportService from '$lib/services/ExportService';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';
import { BaseDirectory, join } from '@tauri-apps/api/path';
import { exists, remove } from '@tauri-apps/plugin-fs';
import { AnalyticsService } from '$lib/services/AnalyticsService';
import ExportFileService from '$lib/services/ExportFileService';
import SoosiProvider from '$lib/services/SoosiProvider';
import MinimalQuranProvider from '$lib/services/MinimalQuranProvider';
import type { BackgroundThrottlingPolicy } from '@tauri-apps/api/window';
import Exportation, { ExportKind, ExportState } from './Exportation.svelte';
import type { Project } from './Project';
import { ProjectService } from '$lib/services/ProjectService';
import ModalManager from '$lib/components/modals/ModalManager';
import { BatchService } from '$lib/services/BatchService';

import type { Edition } from './Edition';
import { TrackType } from './enums';

export const DEFAULT_YTB_CHAPTERS_FORMAT = '<timestamp> Surah <surah-number>, Verse <verse-number>';

export type YouTubeChapterFormatValues = {
	timestamp: string;
	surahNumber: number;
	surahTranslation: string;
	surahTransliteration: string;
	verseArabic: string;
	verseNumber: number;
	verseTranslation: string;
};

/**
 * Remplace les placeholders connus dans une ligne de chapitres YouTube.
 *
 * @param {string} format Format personnalise saisi par l'utilisateur.
 * @param {YouTubeChapterFormatValues} values Valeurs disponibles pour le chapitre.
 * @returns {string} Ligne formatee avec les placeholders remplaces.
 */
export function formatYouTubeChapterLine(
	format: string,
	values: YouTubeChapterFormatValues
): string {
	return format
		.replaceAll('<timestamp>', values.timestamp)
		.replaceAll('<surah-number>', values.surahNumber.toString())
		.replaceAll('<surah-translation>', values.surahTranslation)
		.replaceAll('<surah-transliteration>', values.surahTransliteration)
		.replaceAll('<verse-arabic>', values.verseArabic)
		.replaceAll('<verse-number>', values.verseNumber.toString())
		.replaceAll('<verse-translation>', values.verseTranslation);
}

/**
 * Conserve la plage d'export d'un projet si elle dure au moins une seconde.
 * @param {number} videoStartTime Début d'export enregistré en millisecondes.
 * @param {number} videoEndTime Fin d'export enregistrée en millisecondes.
 * @param {number} audioDuration Durée audio totale en millisecondes.
 * @returns {[number, number]} Plage enregistrée ou plage audio complète si elle est invalide.
 */
export function resolveProjectVideoExportRange(
	videoStartTime: number,
	videoEndTime: number,
	audioDuration: number
): [number, number] {
	if (!Number.isFinite(audioDuration) || audioDuration <= 0)
		throw new Error('INVALID_EXPORT_DURATION');
	if (
		Number.isFinite(videoStartTime) &&
		Number.isFinite(videoEndTime) &&
		videoStartTime >= 0 &&
		videoEndTime <= audioDuration &&
		videoEndTime - videoStartTime >= 1000
	)
		return [videoStartTime, videoEndTime];
	return [0, audioDuration];
}

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
	 * Exporte le projet sous forme de sous-titres
	 */
	static async exportSubtitles() {
		const es = globalState.settings!.subtitleExportSettings;

		const settings = {
			format: es.subtitleFormat,
			includedTargets: Object.entries(es.includedTarget)
				.filter(([, included]) => included)
				.map(([target]) => target),
			exportVerseNumbers: es.exportVerseNumbers
		};

		if (settings.includedTargets.includes('arabic')) {
			const mushafStyle = globalState.getStyle('arabic', 'mushaf-style')?.value;
			if (mushafStyle === 'Soosi') await SoosiProvider.prefetch();
			if (mushafStyle === 'Minimal Quran') await MinimalQuranProvider.prefetch();
		}

		const subtitles: {
			startTimeMs: number;
			endTimeMs: number;
			text: string;
		}[] = [];

		// Sauvegarde les styles pour les restaurer après l'export
		let originalFontFamily: string | null = null;
		const originalShowVerseNumbers: { target: string; value: boolean }[] = [];

		// Synchronise les styles avec les paramètres d'export avant la boucle,
		// car getText() se base sur les styles (font-family, show-verse-number)
		// qui peuvent être désynchronisés des paramètres d'export.
		if (settings.includedTargets.includes('arabic')) {
			const fontStyle = globalState.getStyle('arabic', 'font-family')!;
			const exportFontFamily =
				es.arabicTextFormat === 'Plain' &&
				(fontStyle.value === 'QPC1' || fontStyle.value === 'QPC2')
					? 'Hafs'
					: es.arabicTextFormat === 'Plain'
						? (fontStyle.value as string)
						: `QPC${es.arabicTextFormat[1]}`;
			if (fontStyle.value !== exportFontFamily) {
				originalFontFamily = fontStyle.value as string;
				fontStyle.value = exportFontFamily;
			}
		}

		for (const target of settings.includedTargets) {
			const showVerseStyle = globalState.getStyle(target, 'show-verse-number');
			const desiredShowVerse = Boolean(es.exportVerseNumbers[target]);
			if (showVerseStyle && showVerseStyle.value !== desiredShowVerse) {
				originalShowVerseNumbers.push({ target, value: showVerseStyle.value as boolean });
				showVerseStyle.value = desiredShowVerse;
			}
		}

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

		// Restaure les styles modifiés
		if (originalFontFamily !== null) {
			globalState.getStyle('arabic', 'font-family')!.value = originalFontFamily;
		}
		for (const { target, value } of originalShowVerseNumbers) {
			globalState.getStyle(target, 'show-verse-number')!.value = value;
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
		const extension = settings.format.toLowerCase();
		const customFileName = es.customFileName.trim().replace(/[/\\:*?"<>|]/g, '_');
		const fileName = customFileName
			? `${customFileName}.${extension}`
			: `qurancaption_subtitles_${projectName}.${extension}`;
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

	/**
	 * Exporte uniquement les sous-titres Quran édités, avec les informations word-level utiles.
	 * @returns {Promise<void>}
	 */
	static async exportSubtitlesJson() {
		const projectData = globalState.currentProject;
		if (!projectData) {
			console.error('No project data available for subtitle JSON export.');
			return;
		}

		const segments = globalState.getSubtitleTrack.clips
			.filter((clip): clip is SubtitleClip => clip instanceof SubtitleClip)
			.map((clip, index) => {
				const alignmentBaseTimeS = clip.alignmentMetadata?.timeFrom ?? clip.startTime / 1000;
				const arabicWords = clip.text.trim().split(/\s+/).filter(Boolean);
				const fallbackWords = Array.from(
					{ length: Math.max(0, clip.endWordIndex - clip.startWordIndex + 1) },
					(_, wordIndex) => ({
						location: `${clip.surah}:${clip.verse}:${clip.startWordIndex + wordIndex + 1}`,
						word: arabicWords[wordIndex] ?? null,
						translation: clip.wbwTranslation[wordIndex] ?? null,
						relativeStartMs: null,
						relativeEndMs: null,
						startTimeMs: null,
						endTimeMs: null
					})
				);

				return {
					index,
					id: clip.id,
					startTimeMs: clip.startTime,
					endTimeMs: clip.endTime,
					durationMs: clip.duration,
					surah: clip.surah,
					verse: clip.verse,
					verseKey: clip.getVerseKey(),
					startWordIndex: clip.startWordIndex,
					endWordIndex: clip.endWordIndex,
					wordCount: Math.max(0, clip.endWordIndex - clip.startWordIndex + 1),
					arabicText: clip.text,
					displayText: clip.getText(),
					indopakText: clip.indopakText,
					isFullVerse: clip.isFullVerse,
					isLastWordsOfVerse: clip.isLastWordsOfVerse,
					confidence: clip.confidence,
					review: {
						hasBeenVerified: clip.hasBeenVerified,
						needsReview: clip.needsReview,
						needsCoverageReview: clip.needsCoverageReview,
						needsLongReview: clip.needsLongReview,
						needsWbwTimestampReview: clip.needsWbwTimestampReview
					},
					alignment: clip.alignmentMetadata
						? {
								source: clip.alignmentMetadata.source,
								segment: clip.alignmentMetadata.segment,
								refFrom: clip.alignmentMetadata.refFrom,
								refTo: clip.alignmentMetadata.refTo,
								matchedText: clip.alignmentMetadata.matchedText,
								specialType: clip.alignmentMetadata.specialType ?? null,
								timeFromMs: Math.round(clip.alignmentMetadata.timeFrom * 1000),
								timeToMs: Math.round(clip.alignmentMetadata.timeTo * 1000)
							}
						: null,
					words:
						clip.alignmentMetadata?.words.map((word, wordIndex) => ({
							location: word.location,
							word: word.word ?? arabicWords[wordIndex] ?? null,
							translation: clip.wbwTranslation[wordIndex] ?? null,
							relativeStartMs: Math.round(word.start * 1000),
							relativeEndMs: Math.round(word.end * 1000),
							startTimeMs: Math.round((alignmentBaseTimeS + word.start) * 1000),
							endTimeMs: Math.round((alignmentBaseTimeS + word.end) * 1000)
						})) ?? fallbackWords,
					translations: Object.fromEntries(
						Object.entries(clip.translations).map(([editionName, translation]) => {
							const translationData =
								translation && typeof translation === 'object' ? translation : null;

							return [
								editionName,
								{
									text: translationData ? translationData.text : String(translation ?? ''),
									status: translationData?.status ?? null,
									type: translationData?.type ?? null,
									startWordIndex:
										translationData && 'startWordIndex' in translationData
											? translationData.startWordIndex
											: null,
									endWordIndex:
										translationData && 'endWordIndex' in translationData
											? translationData.endWordIndex
											: null,
									isBruteForce:
										translationData && 'isBruteForce' in translationData
											? translationData.isBruteForce
											: null,
									inlineStyleRuns:
										translationData && 'inlineStyleRuns' in translationData
											? translationData.inlineStyleRuns
											: []
								}
							];
						})
					)
				};
			});

		const json = JSON.stringify(
			{
				project: {
					id: projectData.detail.id,
					name: projectData.detail.name,
					reciter: projectData.detail.reciter
				},
				exportedAt: new Date().toISOString(),
				segmentCount: segments.length,
				segments
			},
			null,
			2
		);
		const projectName = ExportFileService.getProjectNameForFile();
		const fileName = `qurancaption_subtitles_data_${projectName}.json`;
		try {
			await ExportFileService.saveTextFile(fileName, json, 'Subtitle JSON');
		} catch (error) {
			console.error('Unable to export subtitle JSON:', error);
		}
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
		const batches = await BatchService.loadAll();

		await ExportFileService.saveTextFile(
			`qurancaption_backup_${Date.now()}.json`,
			JSON.stringify({
				version: 2,
				projects,
				batches: batches.map((batch) => batch.toJSON())
			}),
			get(LL).settings.projectBackup()
		);
	}

	/**
	 * Exporte un batch et tous ses projets dans le format de backup versionné.
	 * @param {number} batchId Identifiant du batch à exporter.
	 * @returns {Promise<void>} Promesse résolue après l'écriture du backup.
	 */
	static async backupBatch(batchId: number): Promise<void> {
		const batch = await BatchService.load(batchId);
		const projects = await Promise.all(
			batch.projects.map((item) => ProjectService.load(item.projectId))
		);
		await ExportFileService.saveTextFile(
			`qurancaption_batch_${batch.id}_${Date.now()}.json`,
			JSON.stringify({ version: 2, projects, batches: [batch.toJSON()] }),
			get(LL).settings.projectBackup()
		);
	}
	static async exportYtbChapters() {
		const choice = globalState.getExportState.ytbChaptersChoice;
		const subtitlesClips: SubtitleClip[] = globalState.getSubtitleClips;
		const exportStart = globalState.getExportState.videoStartTime || 0;
		const exportEnd = globalState.getExportState.videoEndTime || 0;
		const hasEndBound = exportEnd > exportStart;
		const format =
			globalState.getExportState.ytbChaptersFormat?.trim() || DEFAULT_YTB_CHAPTERS_FORMAT;
		const translationEdition =
			globalState.getProjectTranslation.addedTranslationEditions.find(
				(edition) => edition.name === globalState.getExportState.ytbChaptersTranslationEditionName
			) ?? null;

		const clipWithinExportRange = (clip: SubtitleClip) => {
			if (clip.endTime <= exportStart) return false;
			if (hasEndBound && clip.startTime >= exportEnd) return false;
			return true;
		};

		const getTimeFormatted = (timeMs: number) =>
			Exporter.formatTimeForYouTube(Math.max(0, timeMs - exportStart));

		if (!subtitlesClips || subtitlesClips.length === 0) {
			console.error('No subtitle clips available for export.');
			return;
		}

		const chapters: string[] = [];

		if (choice === 'Each Surah') {
			// Groupe par sourate
			let lastSurahAdded = -1;

			for (const clip of subtitlesClips) {
				if (!(clip instanceof SubtitleClip)) continue;
				if (!clipWithinExportRange(clip)) continue;

				if (clip.surah !== lastSurahAdded) {
					lastSurahAdded = clip.surah;
					const timeFormatted = chapters.length === 0 ? '0:00' : getTimeFormatted(clip.startTime);
					const values = await Exporter.getYouTubeChapterFormatValues(
						clip,
						timeFormatted,
						translationEdition
					);
					chapters.push(formatYouTubeChapterLine(format, values));
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
					const timeFormatted = chapters.length === 0 ? '0:00' : getTimeFormatted(clip.startTime);
					const values = await Exporter.getYouTubeChapterFormatValues(
						clip,
						timeFormatted,
						translationEdition
					);
					chapters.push(formatYouTubeChapterLine(format, values));
				}
			}
		}

		// Génère le contenu du fichier
		let fileContent = 'YouTube Chapters:\n\n';
		for (const chapter of chapters) {
			fileContent += `${chapter}\n`;
		}

		AnalyticsService.trackYtbChaptersExport(choice, chapters.length, exportStart, exportEnd);

		const projectName = ExportFileService.getProjectNameForFile();
		const customFileName = globalState.getExportState.customFileName
			.trim()
			.replace(/[/\\:*?"<>|]/g, '_');
		const fileName = customFileName
			? `${customFileName}.txt`
			: `qurancaption_chapters_${projectName}.txt`;
		await ExportFileService.saveTextFile(fileName, fileContent, 'YouTube chapters');
	}

	/**
	 * Construit les valeurs disponibles pour une ligne de chapitres YouTube.
	 *
	 * @param {SubtitleClip} clip Clip source du chapitre.
	 * @param {string} timestamp Timestamp YouTube deja normalise.
	 * @param {Edition | null} translationEdition Edition de traduction selectionnee.
	 * @returns {Promise<YouTubeChapterFormatValues>} Valeurs de remplacement des placeholders.
	 */
	private static async getYouTubeChapterFormatValues(
		clip: SubtitleClip,
		timestamp: string,
		translationEdition: Edition | null
	): Promise<YouTubeChapterFormatValues> {
		const surah = Quran.surahs[clip.surah - 1];
		let verseArabic = clip.text;
		try {
			const verse = await Quran.getVerse(clip.surah, clip.verse);
			verseArabic = verse
				? verse.getArabicTextBetweenTwoIndexes(0, verse.words.length - 1)
				: clip.text;
		} catch (error) {
			console.error('Unable to load full verse text for YouTube chapters:', error);
		}
		const verseTranslation = translationEdition
			? globalState.getProjectTranslation.getVerseTranslation(
					translationEdition,
					clip.getVerseKey()
				)
			: '';

		return {
			timestamp,
			surahNumber: clip.surah,
			surahTranslation: surah?.translation ?? '',
			surahTransliteration: surah?.name ?? '',
			verseArabic,
			verseNumber: clip.verse,
			verseTranslation
		};
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
	 * Exporte le projet sous forme de vidéo.
	 */
	static async exportVideo() {
		const videoExtension = globalState.getExportState.exportWithoutBackground
			? globalState.getExportState.transparentExportFormat === 'webm_vp9_alpha'
				? 'webm'
				: 'mov'
			: 'mp4';
		const exportFileName =
			globalState.currentProject!.detail.generateExportFileName() + '.' + videoExtension;
		const exportFilePath = await join(await ExportService.getExportFolder(), exportFileName);
		if (await exists(exportFilePath)) {
			const confirmOverwrite = await ModalManager.confirmModal(
				get(LL).export.overwriteExistingVideo(),
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
		const sourceProject = globalState.currentProject!;
		const project = sourceProject.clone();
		project.detail.id = Number(exportId); // L'ID du projet est l'ID d'export

		// Créer le fichier du projet dans le dossier Export afin que l'Exporter le récupère
		await ExportService.saveProject(project);

		// Ajoute à la liste des exports en cours
		await ExportService.addExport(project, shouldQueue ? 'recording' : 'stable', {
			sourceProjectId: sourceProject.detail.id
		});

		// Ouvre le popup de monitor d'export
		globalState.uiState.showExportMonitor = true;

		// Set-up l'écouteur d'évènement pour suivre
		// le progrès des projets en cours d'exportation
		Exporter.ensureBackgroundWorkersStarted();

		if (!shouldQueue) {
			await Exporter.openExportWindow(exportId);
		}
	}

	/**
	 * Ajoute un projet explicite à la queue vidéo existante sans modifier le projet courant.
	 * @param {Project} sourceProject Projet sauvegardé contenant ses propres réglages d'export.
	 * @param {string} finalFileName Nom final déjà sécurisé.
	 * @param {string} finalFilePath Chemin final réservé sans écrasement.
	 * @returns {Promise<number>} Identifiant runtime visible dans l'Export Monitor.
	 */
	static async queueProjectVideo(
		sourceProject: Project,
		finalFileName: string,
		finalFilePath: string
	): Promise<number> {
		const exportId = Utilities.randomId();
		const shouldQueue =
			Exporter.hasActiveVideoExport() || Exporter.getNextPendingVideoExport() !== undefined;
		const project = sourceProject.clone();
		const exportSettings = project.projectEditorState.export;
		const [videoStartTime, videoEndTime] = resolveProjectVideoExportRange(
			exportSettings.videoStartTime,
			exportSettings.videoEndTime,
			project.content.timeline.getFirstTrack(TrackType.Audio).getDuration().ms
		);
		exportSettings.videoStartTime = videoStartTime;
		exportSettings.videoEndTime = videoEndTime;
		project.detail.id = exportId;
		await ExportService.saveProject(project);
		await ExportService.addExport(project, shouldQueue ? 'recording' : 'stable', {
			finalFileName,
			finalFilePath,
			exportLabel: sourceProject.detail.name,
			sourceProjectId: sourceProject.detail.id
		});
		globalState.uiState.showExportMonitor = true;
		Exporter.ensureBackgroundWorkersStarted();
		if (!shouldQueue) await Exporter.openExportWindow(exportId.toString());
		return exportId;
	}
}
