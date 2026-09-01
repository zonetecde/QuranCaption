import { globalState } from '$lib/runes/main.svelte';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { LogicalPosition } from '@tauri-apps/api/dpi';
import { AssetClip, PredefinedSubtitleClip, SubtitleClip } from './Clip.svelte';
import {
	VerseTranslation,
	getTranslationTrimUnits,
	sliceTranslationTrimUnits
} from './Translation.svelte';
import SubtitleFileContentGenerator from './misc/SubtitleFileContentGenerator';
import { Quran } from './Quran';
import { Utilities } from './misc/Utilities';
import ExportService from '$lib/services/ExportService';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';
import { BaseDirectory, join } from '@tauri-apps/api/path';
import { exists, readDir, remove, type DirEntry } from '@tauri-apps/plugin-fs';
import { AnalyticsService } from '$lib/services/AnalyticsService';
import ExportFileService from '$lib/services/ExportFileService';
import { formatTranscriptReferencesForExport } from '$lib/services/TranscriptReferenceService';
import { getStructuredTranslationDraft } from '$lib/services/StructuredTranslationService';
import type { BackgroundThrottlingPolicy } from '@tauri-apps/api/window';
import Exportation, { ExportKind, ExportState } from './Exportation.svelte';
import type { Project } from './Project';
import { ProjectService } from '$lib/services/ProjectService';
import ModalManager from '$lib/components/modals/ModalManager';

import type { Edition } from './Edition';
import { AssetType, SourceType, TrackType } from './enums';

export const DEFAULT_YTB_CHAPTERS_FORMAT = '<timestamp> Surah <surah-number>, Verse <verse-number>';

const RANDOM_BACKGROUND_EXTENSIONS = new Set([
	'png',
	'jpg',
	'jpeg',
	'gif',
	'bmp',
	'webp',
	'mp4',
	'avi',
	'mov',
	'mkv',
	'flv',
	'webm'
]);

export type RandomBackgroundDirectoryEntry = Pick<DirEntry, 'name' | 'isFile' | 'isDirectory'>;

export type RandomBackgroundPreparationOptions = {
	readDirectory?: (folder: string) => Promise<readonly RandomBackgroundDirectoryEntry[]>;
	randomValue?: number;
	joinPath?: (folder: string, fileName: string) => Promise<string>;
};

/**
 * Returns compatible image and video files directly contained in a directory.
 * @param {readonly RandomBackgroundDirectoryEntry[]} entries Directory entries to filter.
 * @returns {string[]} Compatible file names.
 */
export function getRandomBackgroundCandidates(
	entries: readonly RandomBackgroundDirectoryEntry[]
): string[] {
	return entries
		.filter((entry) => entry.isFile && !entry.isDirectory)
		.map((entry) => entry.name)
		.filter((name) => {
			const extension = name.split('.').at(-1)?.toLowerCase();
			return extension !== undefined && RANDOM_BACKGROUND_EXTENSIONS.has(extension);
		});
}

/**
 * Selects one compatible background using a normalized random value.
 * @param {readonly RandomBackgroundDirectoryEntry[]} entries Directory entries to inspect.
 * @param {number} randomValue Value normally in the interval [0, 1).
 * @returns {string | null} Selected file name, or `null` when none is available.
 */
export function selectRandomBackgroundCandidate(
	entries: readonly RandomBackgroundDirectoryEntry[],
	randomValue: number = Math.random()
): string | null {
	const candidates = getRandomBackgroundCandidates(entries);
	if (candidates.length === 0) return null;

	const normalizedValue = Number.isFinite(randomValue)
		? Math.min(Math.max(randomValue, 0), 0.999999999)
		: 0;
	return candidates[Math.floor(normalizedValue * candidates.length)] ?? null;
}

/**
 * Creates the temporary background clip for the selected asset.
 * @param {number} assetId Asset identifier.
 * @param {AssetType.Image | AssetType.Video} assetType Selected media type.
 * @param {number} audioDurationMs Project audio duration in milliseconds.
 * @returns {AssetClip} Clip ready for the temporary video track.
 */
export function createRandomBackgroundClip(
	assetId: number,
	assetType: AssetType.Image | AssetType.Video,
	audioDurationMs: number
): AssetClip {
	if (assetType === AssetType.Image) return new AssetClip(0, 0, assetId);

	const clip = new AssetClip(0, Math.max(0, audioDurationMs), assetId);
	clip.loopUntilAudioEnd = true;
	return clip;
}

/**
 * Adds a random background to an export clone without changing the source project.
 * @param {Project} project Export clone to prepare.
 * @param {string} folder Folder containing the background pool.
 * @param {RandomBackgroundPreparationOptions} options Injectable dependencies for tests.
 * @returns {Promise<void>} Resolves without blocking export when the pool is unavailable.
 */
export async function prepareRandomBackgroundProject(
	project: Project,
	folder: string,
	options: RandomBackgroundPreparationOptions = {}
): Promise<void> {
	const exportState = project.projectEditorState.export;
	if (!exportState.addRandomBackground || exportState.exportWithoutBackground) return;

	const videoTrack = project.content.timeline.getFirstTrack(TrackType.Video);
	if (videoTrack.clips.length > 0) return;

	const folderPath = folder.trim();
	if (!folderPath) return;

	let entries: readonly RandomBackgroundDirectoryEntry[];
	try {
		const readDirectory = options.readDirectory ?? ((path: string) => readDir(path));
		entries = await readDirectory(folderPath);
	} catch {
		return;
	}

	const candidate = selectRandomBackgroundCandidate(entries, options.randomValue);
	if (!candidate) return;

	try {
		const joinPath = options.joinPath ?? ((path: string, fileName: string) => join(path, fileName));
		const assetPath = await joinPath(folderPath, candidate);
		const asset = project.content.addAssetHeadless(assetPath, undefined, SourceType.Local, {
			suppressUiEffects: true,
			skipConstantBitrateWarning: true
		});
		if (!asset || (asset.type !== AssetType.Image && asset.type !== AssetType.Video)) return;

		await asset.checkExistence();
		if (!asset.exists) return;
		if (asset.type === AssetType.Video) {
			await asset.ensureDurationLoaded();
			if (!asset.exists || asset.hasDurationLoadError()) return;
		}

		const audioDurationMs = project.content.timeline
			.getFirstTrack(TrackType.Audio)
			.getDuration().ms;
		videoTrack.clips = [createRandomBackgroundClip(asset.id, asset.type, audioDurationMs)];
	} catch {
		return;
	}
}

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
 * Retourne le texte d'une traduction tel qu'il est affichÃ©, avec les numÃ©ros
 * de verset optionnels pour les ancres Quran structurÃ©es.
 * @param {string} edition Nom de l'Ã©dition de traduction.
 * @param {SubtitleClip | PredefinedSubtitleClip} subtitle Sous-titre source.
 * @param {boolean} includeVerseNumbers Ajoute le prÃ©fixe `ss:vv. ` aux passages Quran.
 * @returns {string} Texte Ã  Ã©crire dans le fichier de sous-titres.
 */
function getSubtitleTranslationForExport(
	edition: string,
	subtitle: SubtitleClip | PredefinedSubtitleClip,
	includeVerseNumbers: boolean,
	includeAyahParentheses: boolean
): string {
	const translation = subtitle.getTranslation(edition);
	if (
		(!includeVerseNumbers && !includeAyahParentheses) ||
		!(subtitle instanceof SubtitleClip) ||
		!(translation instanceof VerseTranslation) ||
		!translation.isStructuredTranslation
	) {
		return subtitle instanceof SubtitleClip
			? translation.getText(edition, subtitle)
			: translation.getText();
	}

	const draft = getStructuredTranslationDraft(subtitle.text, translation.text);
	const editionTranslations = globalState.getProjectTranslation.versesTranslations[edition] ?? {};
	let text = '';
	for (let index = 0; index < draft.anchors.length; index++) {
		text += draft.freeTexts[index] ?? '';
		const anchor = draft.anchors[index];
		if (anchor.type === 'citation') {
			text += anchor.value;
			continue;
		}

		const reference = anchor.quranReference;
		if (!reference) continue;
		const original = editionTranslations[`${reference.surah}:${reference.verse}`] ?? '';
		const units = getTranslationTrimUnits(original);
		const settings = translation.quranSegments?.[anchor.id];
		const translationText = settings?.isBruteForce
			? settings.manualText
			: sliceTranslationTrimUnits(
					original,
					settings?.startUnitIndex ?? 0,
					settings?.endUnitIndex ?? Math.max(0, units.length - 1)
				);
		const verseText = `${includeVerseNumbers ? `${reference.surah}:${reference.verse}. ` : ''}${translationText}`;
		text += includeAyahParentheses ? `\uFD3F${verseText}\uFD3E` : verseText;
	}

	return text + (draft.freeTexts[draft.anchors.length] ?? '');
}

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
			includeArabicVerseNumbers: Boolean(es.exportVerseNumbers.arabic),
			includeArabicAyahParentheses: es.exportArabicAyahParentheses,
			includeTranslationVerseNumbers: es.exportTranslationVerseNumbers
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
					text +=
						subtitle instanceof SubtitleClip
							? await formatTranscriptReferencesForExport(
									subtitle.text,
									es.arabicTextFormat,
									settings.includeArabicVerseNumbers,
									settings.includeArabicAyahParentheses
								)
							: subtitle.text;
				} else {
					if (subtitle instanceof SubtitleClip)
						text += getSubtitleTranslationForExport(
							target,
							subtitle,
							settings.includeTranslationVerseNumbers,
							settings.includeArabicAyahParentheses
						);
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
			Object.fromEntries(
				settings.includedTargets.map((target) => [
					target,
					target === 'arabic'
						? settings.includeArabicVerseNumbers
						: settings.includeTranslationVerseNumbers
				])
			),
			subtitles.length
		);

		const projectName = ExportFileService.getProjectNameForFile();
		const extension = settings.format.toLowerCase();
		const customFileName = es.customFileName.trim().replace(/[/\\:*?"<>|]/g, '_');
		const fileName = customFileName
			? `${customFileName}.${extension}`
			: `minbarstudio_subtitles_${projectName}.${extension}`;
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
		const fileName = `minbarstudio_project_${projectName}.json`;
		await ExportFileService.saveTextFile(fileName, json, 'Project data');
	}

	/**
	 * Exporte un projet avec ses assets dans un paquet `.minbar`.
	 * @param {Project | null | undefined} project Projet à exporter.
	 * @returns {Promise<void>} Promesse résolue lorsque le paquet est enregistré.
	 */
	static async exportProjectPackage(project?: Project | null): Promise<void> {
		const projectData = project || globalState.currentProject;

		if (!projectData) {
			console.error('No project data available for package export.');
			return;
		}

		const projectName = ExportFileService.getProjectNameForFile(projectData);
		const fileName = `minbarstudio_project_${projectName}.minbar`;
		const exportFolder = await ExportService.getExportFolder();
		const filePath = await ExportService.constrainFilePathLength(
			await join(exportFolder, fileName)
		);

		await ProjectService.exportProjectPackage(projectData, filePath);
		await ExportFileService.trackExportedFile(filePath, get(LL).home.exportProject());
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
					speaker: projectData.detail.speaker
				},
				exportedAt: new Date().toISOString(),
				segmentCount: segments.length,
				segments
			},
			null,
			2
		);
		const projectName = ExportFileService.getProjectNameForFile();
		const fileName = `minbarstudio_subtitles_data_${projectName}.json`;
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

		await ExportFileService.saveTextFile(
			`minbarstudio_backup_${Date.now()}.json`,
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
			: `minbarstudio_chapters_${projectName}.txt`;
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
		const project = globalState.currentProject!.clone();
		await prepareRandomBackgroundProject(
			project,
			globalState.settings?.exportSettings.randomBackgroundFolder ?? ''
		);
		project.detail.id = Number(exportId); // L'ID du projet est l'ID d'export

		// Créer le fichier du projet dans le dossier Export afin que l'Exporter le récupère
		await ExportService.saveProject(project);

		// Ajoute à la liste des exports en cours
		await ExportService.addExport(project, shouldQueue ? 'recording' : 'stable');

		// Ouvre le popup de monitor d'export
		globalState.uiState.showExportMonitor = true;

		// Set-up l'écouteur d'évènement pour suivre
		// le progrès des projets en cours d'exportation
		Exporter.ensureBackgroundWorkersStarted();

		if (!shouldQueue) {
			await Exporter.openExportWindow(exportId);
		}
	}
}
