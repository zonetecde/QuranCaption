<script lang="ts">
	import type { AssetClip } from '$lib/classes';
	import Timeline from '$lib/components/projectEditor/timeline/Timeline.svelte';
	import VideoPreview from '$lib/components/projectEditor/videoPreview/VideoPreview.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { getCurrentWebviewWindow, WebviewWindow } from '@tauri-apps/api/webviewWindow';
	import { LogicalPosition } from '@tauri-apps/api/dpi';
	import { listen } from '@tauri-apps/api/event';
	import { onMount } from 'svelte';
	import {
		exists,
		BaseDirectory,
		mkdir,
		writeFile,
		remove,
		readFile,
		readDir
	} from '@tauri-apps/plugin-fs';
	import { appDataDir, join } from '@tauri-apps/api/path';
	import ExportService, { type ExportProgress } from '$lib/services/ExportService';
	import {
		buildBlurSegmentsForRange,
		type BlurSegment,
		type TimeRange
	} from '$lib/services/OverlayBlurSegmentation';
	import {
		calculateCaptureTimingsForRange,
		getExportWordByWordHighlightTimings as getExportWordByWordHighlightTimingsUtil,
		getBlankImageFileName,
		hasTiming,
		buildExportCaptureJobPlan,
		type ExportTimedOverlayCaptureClip,
		type ExportSubtitleCaptureClip,
		type ExportSubtitleWbwSourceClip,
		type ExportCaptureTimingResult,
		type ExportFrameCaptureJob,
		type ExportFrameCopyJob,
		type ExportBlankSourceJob
	} from '$lib/services/ExportCaptureTiming';
	import type { ExportFadeSettings } from '$lib/components/projectEditor/tabs/subtitlesEditor/modal/autoSegmentation/types';
	import QPCFontProvider from '$lib/services/FontProvider';
	import SoosiProvider from '$lib/services/SoosiProvider';
	import { getAllWindows, type BackgroundThrottlingPolicy } from '@tauri-apps/api/window';
	import Exportation, { ExportState } from '$lib/classes/Exportation.svelte';
	import toast from 'svelte-5-french-toast';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
	import { domToBlob } from 'modern-screenshot';
	import { captureMacOsOverlayPngBytes, shouldRedrawExportTextWithCanvas } from './MacOSExport';
	import {
		ClipWithTranslation,
		CustomClip,
		PredefinedSubtitleClip,
		SilenceClip,
		SubtitleClip
	} from '$lib/classes/Clip.svelte';
	import { isWordByWordHighlightEnabled } from '$lib/components/projectEditor/videoPreview/wordByWordHighlightUtils';
	import type { StyleName } from '$lib/classes/VideoStyle.svelte';

	// Affichage ou non des fenêtres
	const DEBUG_EXPORT_MODE = false;

	// Contient l'ID de l'export
	let exportId = '';

	// VideoPreview
	let videoPreview: VideoPreview | undefined = $state(undefined);

	// Récupère les données d'export de la vidéo
	let exportData: Exportation | undefined;

	const DEFAULT_PARALLEL_CAPTURE_WORKERS = 4;
	const CAPTURE_WORKER_MODE = 'capture-worker';
	const WORKER_READY_EVENT = 'export-capture-worker-ready';
	const WORKER_START_EVENT = 'export-capture-worker-start';
	const WORKER_PROGRESS_EVENT = 'export-capture-worker-progress';
	const WORKER_COMPLETE_EVENT = 'export-capture-worker-complete';
	const WORKER_ERROR_EVENT = 'export-capture-worker-error';
	const WORKER_READY_TIMEOUT_MS = 45_000;

	let activeVideoSegments: TimeRange[] = [];
	let currentRenderingSegmentIndex = 0;
	let isSegmentedVideoExport = false;
	let currentVideoExportState: ExportState = ExportState.AddingSubtitles;
	let subtitleMainProgress = 0;
	let hasCompletedCapturingFrames = false;
	let hasSecondarySegmentProgress = false;
	let processingBackgroundProgress = 0;

	/**
	 * Retourne le nom du blank deja planifie pour la sourate courante.
	 * @param {Record<string, number>} imgWithNothingShown Blanks sources par etat visuel.
	 * @param {number} timing Timing courant.
	 * @returns {string | null} Nom du fichier blank sans extension.
	 */
	function getReusableBlankFileName(
		imgWithNothingShown: Record<string, number>,
		timing: number
	): string | null {
		const currentSurah = globalState.getSubtitleTrack.getCurrentSurah(timing);
		const key = Object.keys(imgWithNothingShown).find((blankVisualStateKey) =>
			blankVisualStateKey.startsWith(`surah:${currentSurah}|`)
		);

		return key ? getBlankImageFileName(key) : null;
	}

	/**
	 * Indique si l'overlay contient un fond ou une bordure de sous-titre visible.
	 * @param {HTMLElement} node Racine de l'overlay à capturer.
	 * @returns {boolean} true si le blank réutilisable ne peut pas servir de fond.
	 */
	function hasVisibleSubtitleBackground(node: HTMLElement): boolean {
		const backgrounds = node.querySelector<HTMLElement>('#subtitles-backgrounds');
		if (!backgrounds) return false;

		const backgroundStyle = getComputedStyle(backgrounds);
		if (
			backgroundStyle.display === 'none' ||
			backgroundStyle.visibility === 'hidden' ||
			Number(backgroundStyle.opacity) <= 0
		) {
			return false;
		}

		return Array.from(backgrounds.querySelectorAll<HTMLElement>('.subtitle')).some((element) => {
			const style = getComputedStyle(element);
			const hasBackground =
				(style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)') ||
				(style.backgroundImage && style.backgroundImage !== 'none');
			const hasBorder =
				Number.parseFloat(style.borderTopWidth) > 0 ||
				Number.parseFloat(style.borderRightWidth) > 0 ||
				Number.parseFloat(style.borderBottomWidth) > 0 ||
				Number.parseFloat(style.borderLeftWidth) > 0;

			return (
				style.display !== 'none' &&
				style.visibility !== 'hidden' &&
				Number(style.opacity) > 0 &&
				(hasBackground || hasBorder || style.boxShadow !== 'none')
			);
		});
	}
	let processingBackgroundCurrentSegment = 0;
	let processingBackgroundTotalSegments = 0;
	let mergingFilesProgress = 0;
	let mergingFilesCurrentSegment = 0;
	let mergingFilesTotalSegments = 0;
	let previousDetailedState: ExportState | null = null;

	type ExportProgressEvent = {
		payload: {
			progress?: number;
			current_time: number;
			total_time?: number;
			export_id: string;
			current_state?: string;
			current_batch_size?: number;
		};
	};
	type ExportCompleteEvent = { payload: { filename: string; exportId: string } };
	type ExportErrorEvent = {
		payload: { error: string; export_id: string };
	};
	type CaptureWorkerStartPayload = {
		exportId: string;
		workerId: number;
		jobs: ExportFrameCaptureJob[];
		subfolder: string | null;
	};
	type CaptureWorkerLifecyclePayload = {
		exportId: string;
		workerId: number;
	};
	type CaptureWorkerProgressPayload = CaptureWorkerLifecyclePayload & {
		completed: number;
		total: number;
	};
	type CaptureWorkerErrorPayload = CaptureWorkerLifecyclePayload & {
		error: string;
	};

	function getExportFadeSettings(): ExportFadeSettings {
		return globalState.getStyle('global', 'video-and-audio-fade')!.value as ExportFadeSettings;
	}

	/**
	 * Contraint une progression dans l'intervalle [0, 100].
	 * Évite les débordements visuels côté monitor.
	 */
	function clampProgress(progress: number): number {
		return Math.max(0, Math.min(100, progress));
	}

	/**
	 * Indique si l'état courant correspond à l'étape principale "adding subtitles".
	 * On utilise cette info pour stabiliser la barre de progression principale.
	 */
	function isSubtitlesState(state: ExportState): boolean {
		return state === ExportState.AddingSubtitles || state === ExportState.CreatingVideo;
	}

	/**
	 * Active les barres secondaires seulement:
	 * - en mode export segmenté (plusieurs segments),
	 * - et après la fin du "capturing frames".
	 */
	function refreshSecondarySegmentProgressVisibility() {
		hasSecondarySegmentProgress =
			isSegmentedVideoExport && activeVideoSegments.length > 1 && hasCompletedCapturingFrames;
	}

	/**
	 * Réinitialise tous les compteurs/progressions liés aux étapes secondaires
	 * pour éviter de polluer un nouvel export avec l'état du précédent.
	 */
	function resetSegmentProgressTracking() {
		subtitleMainProgress = 0;
		hasCompletedCapturingFrames = false;
		hasSecondarySegmentProgress = false;
		processingBackgroundProgress = 0;
		processingBackgroundCurrentSegment = 0;
		processingBackgroundTotalSegments = 0;
		mergingFilesProgress = 0;
		mergingFilesCurrentSegment = 0;
		mergingFilesTotalSegments = 0;
		previousDetailedState = null;
	}

	async function exportProgress(event: ExportProgressEvent) {
		const data = event.payload as {
			progress?: number;
			current_time: number;
			total_time?: number;
			export_id: string;
			current_state?: string;
			current_batch_size?: number;
		};

		// Vérifie que c'est bien pour cette exportation
		if (data.export_id !== exportId) return;

		if (
			data.current_state &&
			Object.values(ExportState).includes(data.current_state as ExportState)
		) {
			currentVideoExportState = data.current_state as ExportState;
		}

		if (currentVideoExportState !== previousDetailedState) {
			// Incrémente l'index de segment seulement quand l'état change,
			// pour éviter de compter plusieurs fois le même segment.
			if (currentVideoExportState === ExportState.ProcessingBackground) {
				processingBackgroundCurrentSegment += 1;
				if (processingBackgroundTotalSegments > 0) {
					processingBackgroundCurrentSegment = Math.min(
						processingBackgroundCurrentSegment,
						processingBackgroundTotalSegments
					);
				}
			}

			if (currentVideoExportState === ExportState.MergingFiles) {
				mergingFilesCurrentSegment += 1;
				if (mergingFilesTotalSegments > 0) {
					mergingFilesCurrentSegment = Math.min(
						mergingFilesCurrentSegment,
						mergingFilesTotalSegments
					);
				}
			}

			previousDetailedState = currentVideoExportState;
		}

		if (data.progress !== null && data.progress !== undefined) {
			console.log(
				`Export Progress: ${data.progress.toFixed(1)}% (${data.current_time.toFixed(1)}s / ${data.total_time?.toFixed(1)}s)`
			);

			const totalDuration = exportData!.videoEndTime - exportData!.videoStartTime;

			// Calculer le pourcentage global et le temps actuel global
			let globalProgress: number;
			let globalCurrentTime: number;

			if (
				(currentVideoExportState === ExportState.AddingSubtitles ||
					currentVideoExportState === ExportState.CreatingVideo) &&
				isSegmentedVideoExport &&
				activeVideoSegments.length > 1
			) {
				// Mode segmenté: utiliser les bornes réelles du segment actuellement rendu.
				const segment = activeVideoSegments[currentRenderingSegmentIndex];
				const segmentStart = segment?.start ?? exportData!.videoStartTime;
				const segmentEnd = segment?.end ?? exportData!.videoEndTime;
				const segmentDuration = Math.max(0, segmentEnd - segmentStart);
				const baseElapsed = Math.max(0, segmentStart - exportData!.videoStartTime);

				let segmentElapsed = 0;
				if (data.total_time && data.total_time > 0) {
					segmentElapsed = (data.current_time / data.total_time) * segmentDuration;
				} else if (data.progress > 0) {
					segmentElapsed = (data.progress / 100) * segmentDuration;
				} else {
					segmentElapsed = data.current_time * 1000;
				}

				segmentElapsed = Math.min(Math.max(segmentElapsed, 0), segmentDuration);
				globalCurrentTime = Math.min(baseElapsed + segmentElapsed, totalDuration);
				globalProgress =
					totalDuration > 0
						? Math.min(100, Math.max(0, (globalCurrentTime / totalDuration) * 100))
						: 100;
			} else {
				// Mode export normal
				globalProgress = data.progress;
				globalCurrentTime = data.current_time * 1000; // Convertir de secondes en millisecondes
			}

			const clampedProgress = clampProgress(globalProgress);
			if (isSubtitlesState(currentVideoExportState)) {
				subtitleMainProgress = clampedProgress;
			}
			if (currentVideoExportState === ExportState.ProcessingBackground) {
				processingBackgroundProgress = clampProgress(data.progress);
			}
			if (currentVideoExportState === ExportState.MergingFiles) {
				mergingFilesProgress = clampProgress(data.progress);
			}

			refreshSecondarySegmentProgressVisibility();

			// En mode segmenté, la barre principale reste dédiée à "Adding Subtitles".
			// Les états BG/Merging alimentent les barres secondaires.
			const mainProgressForMonitor =
				hasSecondarySegmentProgress && !isSubtitlesState(currentVideoExportState)
					? subtitleMainProgress
					: clampedProgress;

			emitProgress({
				exportId: Number(exportId),
				progress: mainProgressForMonitor,
				currentState: currentVideoExportState,
				currentTime: globalCurrentTime,
				currentBatchSize: data.current_batch_size
			} as ExportProgress);
		} else {
			console.log(`Export Processing: ${data.current_time.toFixed(1)}s elapsed`);
		}
	}

	async function exportComplete(event: ExportCompleteEvent) {
		const data = event.payload;

		// Vérifie que c'est bien pour cette exportation
		if (data.exportId !== exportId) return;

		console.log(`[OK] Export complete! File saved as: ${data.filename}`);

		if (!isSegmentedVideoExport) {
			await emitProgress({
				exportId: Number(exportId),
				progress: 100,
				currentState: ExportState.Exported
			} as ExportProgress);
		}
	}

	async function exportError(event: ExportErrorEvent) {
		const error = event.payload;
		console.error(`[ERROR] Export failed: ${error}`);

		if (error.export_id !== exportId) return;

		emitProgress({
			exportId: Number(exportId),
			progress: 100,
			currentState: ExportState.Error,
			errorLog: error.error
		} as ExportProgress);
	}

	async function emitProgress(progress: ExportProgress) {
		// Étend le payload standard avec les infos secondaires consommées par ExportMonitor.
		const payload: ExportProgress = {
			...progress,
			hasSecondarySegmentProgress,
			processingBackgroundProgress,
			processingBackgroundCurrentSegment,
			processingBackgroundTotalSegments,
			mergingFilesProgress,
			mergingFilesCurrentSegment,
			mergingFilesTotalSegments
		};
		(await getAllWindows()).find((w) => w.label === 'main')!.emit('export-progress-main', payload);
	}

	/**
	 * Supprime les traductions cachées du projet d'exportation.
	 * C'est nécessaire car sinon on va attendre trop longtemps avant de capturer une frame.
	 */
	function removeHiddenTranslationsFromExportProject() {
		const project = globalState.currentProject;
		if (!project) return;

		const hiddenEditions = project.content.projectTranslation.addedTranslationEditions.filter(
			(edition) =>
				project.content.videoStyle.getStylesOfTarget(edition.name).findStyle('show-subtitles')
					?.value === false
		);

		if (hiddenEditions.length === 0) return;

		const hiddenEditionNames = new Set(hiddenEditions.map((edition) => edition.name));

		project.content.projectTranslation.addedTranslationEditions =
			project.content.projectTranslation.addedTranslationEditions.filter(
				(edition) => !hiddenEditionNames.has(edition.name)
			);

		for (const edition of hiddenEditions) {
			delete project.content.projectTranslation.versesTranslations[edition.name];
			delete project.detail.translations[edition.author];
		}

		for (const track of project.content.timeline.tracks) {
			for (const clip of track.clips) {
				if (!(clip instanceof ClipWithTranslation)) continue;

				for (const editionName of hiddenEditionNames) {
					delete clip.translations[editionName];
				}
			}
		}

		project.content.videoStyle.styles = project.content.videoStyle.styles.filter(
			(stylesData) => !hiddenEditionNames.has(stylesData.target)
		);

		console.log(
			`Removed hidden export translations: ${hiddenEditions.map((edition) => edition.name).join(', ')}`
		);
	}

	/**
	 * Retourne le label stable d'une fenetre worker de capture.
	 * @param {number} workerId Index du worker.
	 * @returns {string} Label de fenetre Tauri.
	 */
	function getCaptureWorkerLabel(workerId: number): string {
		return `${exportId}-capture-${workerId}`;
	}

	/**
	 * Envoie un evenement a la fenetre coordinator de l'export.
	 * @param {string} eventName Nom de l'evenement Tauri.
	 * @param {unknown} payload Donnees a transmettre.
	 * @returns {Promise<void>}
	 */
	async function emitToCoordinator(eventName: string, payload: unknown): Promise<void> {
		const coordinator = (await getAllWindows()).find((w) => w.label === exportId);
		await coordinator?.emit(eventName, payload);
	}

	/**
	 * Charge le projet d'export et applique les optimisations communes aux renderers.
	 * @param {string} id Identifiant d'export.
	 * @returns {Promise<void>}
	 */
	async function loadExportProject(id: string): Promise<void> {
		globalState.currentProject = await ExportService.loadProject(Number(id));
		removeHiddenTranslationsFromExportProject();
		if (globalState.getStyle('arabic', 'mushaf-style')?.value === 'Soosi') {
			await SoosiProvider.prefetch();
		}

		exportData = ExportService.findExportById(Number(id))!;
	}

	/**
	 * Prepare la preview video pour rendre l'overlay en plein ecran export.
	 * @returns {Promise<void>}
	 */
	async function prepareVideoPreviewForExport(): Promise<void> {
		globalState.getVideoPreviewState.isFullscreen = true;
		globalState.getVideoPreviewState.isPlaying = false;
		globalState.getVideoPreviewState.showVideosAndAudios = true;
		globalState.getTimelineState.cursorPosition = globalState.getExportState.videoStartTime;
		globalState.getTimelineState.movePreviewTo = globalState.getExportState.videoStartTime;
		if (globalState.settings) globalState.settings.persistentUiState.showWaveforms = false;
		globalState.getStyle('global', 'fade-duration')!.value =
			(globalState.getStyle('global', 'fade-duration')!.value as number) / 2;

		let videoElement: HTMLElement | null = null;
		do {
			await new Promise((resolve) => setTimeout(resolve, 100));
			videoElement = document.getElementById('video-preview-section') as HTMLElement | null;
			if (!videoElement) continue;
			videoElement.style.objectFit = 'cover';
			videoElement.style.top = '0';
			videoElement.style.left = '0';
			videoElement.style.width = '100%';
			videoElement.style.height = '100%';
		} while (!videoElement);

		await new Promise((resolve) => setTimeout(resolve, 2000));
	}

	/**
	 * Execute le mode worker: attendre les jobs du coordinator, capturer, puis fermer.
	 * @param {number} workerId Index du worker courant.
	 * @returns {Promise<void>}
	 */
	async function runCaptureWorker(workerId: number): Promise<void> {
		const unlisten = await listen<CaptureWorkerStartPayload>(WORKER_START_EVENT, async (event) => {
			const data = event.payload;
			if (data.exportId !== exportId || data.workerId !== workerId) return;
			unlisten();

			try {
				let completed = 0;
				for (const job of data.jobs) {
					await captureFrameJob(job, data.subfolder);
					completed += 1;
					await emitToCoordinator(WORKER_PROGRESS_EVENT, {
						exportId,
						workerId,
						completed,
						total: data.jobs.length
					} satisfies CaptureWorkerProgressPayload);
				}

				await emitToCoordinator(WORKER_COMPLETE_EVENT, {
					exportId,
					workerId
				} satisfies CaptureWorkerLifecyclePayload);
			} catch (error) {
				await emitToCoordinator(WORKER_ERROR_EVENT, {
					exportId,
					workerId,
					error: error instanceof Error ? error.message : String(error)
				} satisfies CaptureWorkerErrorPayload);
			} finally {
				await getCurrentWebviewWindow().close();
			}
		});

		await emitToCoordinator(WORKER_READY_EVENT, {
			exportId,
			workerId
		} satisfies CaptureWorkerLifecyclePayload);
	}

	onMount(async () => {
		const params = new URLSearchParams(window.location.search);
		const id = params.get('id');
		if (!id) return;

		exportId = id;
		const isWorker = params.get('mode') === CAPTURE_WORKER_MODE;
		const workerId = Number(params.get('worker') ?? '0');

		if (!isWorker) {
			// Ecoute les evenements de progression d'export donnes par Rust
			listen('export-progress', exportProgress);
			listen('export-complete', exportComplete);
			listen('export-error', exportError);
		}

		await loadExportProject(id);

		await mkdir(await join(ExportService.exportFolder, exportId), {
			baseDir: BaseDirectory.AppData,
			recursive: true
		});

		await prepareVideoPreviewForExport();

		if (isWorker) {
			await runCaptureWorker(workerId);
			return;
		}

		await startExport();
	});

	async function startExport() {
		if (!exportData) return;
		resetSegmentProgressTracking();

		const exportStart = Math.round(exportData.videoStartTime);
		const exportEnd = Math.round(exportData.videoEndTime);
		const totalDuration = exportEnd - exportStart;

		console.log(`Export duration: ${totalDuration}ms (${totalDuration / 1000 / 60} minutes)`);

		const blurSegments = getBlurSegmentsForRange(exportStart, exportEnd);
		if (blurSegments.length > 1) {
			await handleSegmentedExport(blurSegments, totalDuration);
			return;
		}

		activeVideoSegments = [{ start: exportStart, end: exportEnd }];
		const blur = blurSegments[0]?.blur ?? 0;
		await handleNormalExport(exportStart, exportEnd, totalDuration, blur);
	}

	function getOverlayBlurAt(time: number): number {
		const roundedTime = Math.round(time);
		const clip = globalState.getVideoTrack.getCurrentClip(roundedTime);
		const clipId = clip?.id;
		return Number(
			globalState.getVideoStyle
				.getStylesOfTarget('global')
				.getEffectiveValue('overlay-blur', clipId)
		);
	}

	function getVideoBlurBoundaries(rangeStart: number, rangeEnd: number): number[] {
		const boundaries: number[] = [];
		for (const clip of globalState.getVideoTrack.clips) {
			if (clip.endTime < rangeStart || clip.startTime > rangeEnd) continue;
			boundaries.push(clip.startTime);
			// Clips are inclusive [start, end], next segment starts at end + 1.
			boundaries.push(clip.endTime + 1);
		}
		return boundaries;
	}

	function getBlurSegmentsForRange(rangeStart: number, rangeEnd: number): BlurSegment[] {
		const boundaries = getVideoBlurBoundaries(rangeStart, rangeEnd);
		return buildBlurSegmentsForRange(
			{ start: rangeStart, end: rangeEnd },
			boundaries,
			getOverlayBlurAt
		);
	}

	async function handleSegmentedExport(renderSegments: BlurSegment[], totalDuration: number) {
		if (renderSegments.length === 0) return;
		isSegmentedVideoExport = true;
		activeVideoSegments = renderSegments.map((segment) => ({
			start: segment.start,
			end: segment.end
		}));
		processingBackgroundTotalSegments = activeVideoSegments.length;
		mergingFilesTotalSegments = activeVideoSegments.length + 1;
		refreshSecondarySegmentProgressVisibility();

		const generatedVideoFiles: string[] = [];
		const segmentBlankImageIndexes = new Map<number, number[]>();
		for (let segmentIndex = 0; segmentIndex < renderSegments.length; segmentIndex++) {
			const segment = renderSegments[segmentIndex];
			const segmentImageFolder = `segment_${segmentIndex}`;

			await createSegmentImageFolder(segmentImageFolder);
			const blankTimings = await generateImagesForSegment(
				segmentIndex,
				segment.start,
				segment.end,
				segmentImageFolder,
				renderSegments.length,
				0,
				100
			);
			segmentBlankImageIndexes.set(segmentIndex, blankTimings);
		}

		hasCompletedCapturingFrames = true;
		refreshSecondarySegmentProgressVisibility();
		await ExportService.deleteProjectFile(Number(exportId));

		emitProgress({
			exportId: Number(exportId),
			progress: 0,
			currentState: ExportState.Initializing,
			currentTime: 0,
			totalTime: totalDuration
		} as ExportProgress);

		for (let segmentIndex = 0; segmentIndex < renderSegments.length; segmentIndex++) {
			const segment = renderSegments[segmentIndex];
			const segmentImageFolder = `segment_${segmentIndex}`;
			const segmentDuration = segment.end - segment.start;
			currentRenderingSegmentIndex = segmentIndex;

			const segmentVideoPath = await generateVideoForSegment(
				segmentIndex,
				segmentImageFolder,
				segment.start,
				segmentDuration,
				segment.blur,
				segmentBlankImageIndexes.get(segmentIndex) ?? []
			);

			generatedVideoFiles.push(segmentVideoPath);
		}

		await concatenateVideos(generatedVideoFiles);
		await finalCleanup();
		isSegmentedVideoExport = false;
		refreshSecondarySegmentProgressVisibility();

		emitProgress({
			exportId: Number(exportId),
			progress: 100,
			currentState: ExportState.Exported,
			currentTime: totalDuration,
			totalTime: totalDuration
		} as ExportProgress);
	}

	async function createSegmentImageFolder(segmentImageFolder: string) {
		const segmentPath = await join(ExportService.exportFolder, exportId, segmentImageFolder);
		await mkdir(segmentPath, {
			baseDir: BaseDirectory.AppData,
			recursive: true
		});
		console.log(`Created segment folder: ${segmentPath}`);
	}

	function isBlankCaptureTiming(
		timing: number,
		blankImgs: Record<string, number[]>,
		imgWithNothingShown: Record<string, number>
	): boolean {
		if (hasTiming(blankImgs, timing).hasIt) return true;
		if (Object.values(imgWithNothingShown).some((blankTiming) => blankTiming === timing)) {
			return true;
		}

		const currentSubtitleClip = globalState.getSubtitleTrack.getCurrentClip(timing);
		return currentSubtitleClip === null || currentSubtitleClip instanceof SilenceClip;
	}

	/**
	 * Retourne le nombre de WebViews workers configure pour la capture PNG.
	 * @returns {number} Nombre de workers borne entre 1 et 8.
	 */
	function getParallelCaptureWorkerCount(): number {
		const configured = globalState.settings?.exportSettings?.parallelCaptureWorkers;
		if (typeof configured !== 'number' || Number.isNaN(configured)) {
			return DEFAULT_PARALLEL_CAPTURE_WORKERS;
		}

		return Math.max(1, Math.min(8, Math.round(configured)));
	}

	/**
	 * Construit le plan de jobs d'images a partir des timings existants.
	 * @param {ExportCaptureTimingResult} timings Resultat du calcul de timings.
	 * @param {number} rangeStart Debut de la plage exportee.
	 * @param {number} rangeEnd Fin de la plage exportee.
	 * @param {boolean} isSegment Indique si le plan cible un sous-dossier de segment.
	 * @returns {ReturnType<typeof buildExportCaptureJobPlan>} Plan de jobs pret a executer.
	 */
	function buildImageCapturePlan(
		timings: ExportCaptureTimingResult,
		rangeStart: number,
		rangeEnd: number,
		isSegment: boolean
	): ReturnType<typeof buildExportCaptureJobPlan> {
		const fadeDuration = Math.round(
			globalState.getStyle('global', 'fade-duration')!.value as number
		);

		return buildExportCaptureJobPlan({
			timings,
			rangeStart,
			rangeEnd,
			fadeDuration,
			workerCount: getParallelCaptureWorkerCount(),
			isBlankCaptureTiming: (timing) =>
				isBlankCaptureTiming(timing, timings.blankImgs, timings.imgWithNothingShown),
			getReusableBlankFileName: (timing) =>
				getReusableBlankFileName(timings.imgWithNothingShown, timing),
			getBlankSourceCaptureTiming: (timing) => (isSegment ? timing - 1 : timing)
		});
	}

	/**
	 * Capture une image blank source partagee entre les workers.
	 * @param {ExportBlankSourceJob} job Job blank source.
	 * @returns {Promise<void>}
	 */
	async function captureBlankSourceJob(job: ExportBlankSourceJob): Promise<void> {
		globalState.getTimelineState.movePreviewTo = job.captureTiming;
		globalState.getTimelineState.cursorPosition = job.captureTiming;
		await wait(job.captureTiming);
		await takeScreenshot(job.fileName);
	}

	/**
	 * Capture une frame numerotee avec la preview du renderer courant.
	 * @param {ExportFrameCaptureJob} job Job de capture.
	 * @param {string | null} subfolder Sous-dossier de sortie, ou null.
	 * @returns {Promise<void>}
	 */
	async function captureFrameJob(
		job: ExportFrameCaptureJob,
		subfolder: string | null
	): Promise<void> {
		globalState.getTimelineState.movePreviewTo = job.captureTiming;
		globalState.getTimelineState.cursorPosition = job.captureTiming;
		await wait(job.captureTiming);
		await takeScreenshot(job.fileName, subfolder, job.reusableBlankFileName);
	}

	/**
	 * Execute les captures dans la fenetre courante, sans workers.
	 * @param {ExportFrameCaptureJob[]} jobs Jobs a capturer.
	 * @param {string | null} subfolder Sous-dossier de sortie, ou null.
	 * @param {(completed: number, timing?: number) => void} onProgress Callback de progression.
	 * @returns {Promise<void>}
	 */
	async function runSerialCaptureJobs(
		jobs: ExportFrameCaptureJob[],
		subfolder: string | null,
		onProgress: (completed: number, timing?: number) => void
	): Promise<void> {
		for (let index = 0; index < jobs.length; index++) {
			const job = jobs[index];
			await captureFrameJob(job, subfolder);
			onProgress(index + 1, job.timing);

			if ((index + 1) % 20 === 0) {
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
		}
	}

	/**
	 * Ouvre les fenetres workers offscreen pour la capture parallele.
	 * @param {ExportFrameCaptureJob[][]} buckets Jobs assignes a chaque worker.
	 * @returns {Promise<WebviewWindow[]>} Fenetres workers creees.
	 */
	async function openCaptureWorkerWindows(
		buckets: ExportFrameCaptureJob[][]
	): Promise<WebviewWindow[]> {
		const windows: WebviewWindow[] = [];
		for (let workerId = 0; workerId < buckets.length; workerId++) {
			const label = getCaptureWorkerLabel(workerId);
			const w = new WebviewWindow(label, {
				center: false,
				decorations: false,
				visible: true,
				focus: false,
				skipTaskbar: true,
				preventOverflow: false,
				x: DEBUG_EXPORT_MODE ? workerId * 100 : -10000,
				y: DEBUG_EXPORT_MODE ? workerId * 100 : -10000,
				backgroundThrottling: 'disabled' as BackgroundThrottlingPolicy,
				alwaysOnTop: false,
				alwaysOnBottom: DEBUG_EXPORT_MODE ? false : true,
				title: 'QC Capture - ' + label,
				url:
					'/exporter?' +
					new URLSearchParams({
						id: exportId,
						mode: CAPTURE_WORKER_MODE,
						worker: workerId.toString()
					})
			});

			w.once('tauri://created', async () => {
				try {
					if (!DEBUG_EXPORT_MODE) await w.setPosition(new LogicalPosition(-10000, -10000));
				} catch (error) {
					console.warn('Unable to move capture worker off-screen:', error);
				}
			});

			windows.push(w);
		}

		return windows;
	}

	/**
	 * Ferme toutes les fenetres workers de l'export courant.
	 * @returns {Promise<void>}
	 */
	async function closeCaptureWorkerWindows(): Promise<void> {
		const windows = await getAllWindows();
		await Promise.all(
			windows
				.filter((w) => w.label.startsWith(`${exportId}-capture-`))
				.map(async (w) => {
					try {
						await w.close();
					} catch (error) {
						console.warn('Unable to close capture worker:', error);
					}
				})
		);
	}

	/**
	 * Execute les captures avec plusieurs WebViews Tauri independantes.
	 * @param {ExportFrameCaptureJob[][]} buckets Jobs decoupes par worker.
	 * @param {string | null} subfolder Sous-dossier de sortie, ou null.
	 * @param {(completed: number) => void} onProgress Callback de progression agregée.
	 * @returns {Promise<void>}
	 */
	async function runParallelCaptureJobs(
		buckets: ExportFrameCaptureJob[][],
		subfolder: string | null,
		onProgress: (completed: number) => void
	): Promise<void> {
		const workerProgress = Array.from({ length: buckets.length }, () => 0);
		const readyWorkers = new Set<number>();
		const completeWorkers = new Set<number>();
		const unlisteners: Array<() => void> = [];
		let readyTimeout: ReturnType<typeof setTimeout> | undefined;
		let resolveReady: () => void = () => {};
		let rejectReady: (error: Error) => void = () => {};
		let resolveComplete: () => void = () => {};
		let rejectComplete: (error: Error) => void = () => {};

		const readyPromise = new Promise<void>((resolve, reject) => {
			resolveReady = resolve;
			rejectReady = reject;
			readyTimeout = setTimeout(() => {
				reject(new Error('Timeout waiting for capture workers'));
			}, WORKER_READY_TIMEOUT_MS);
		});

		const completePromise = new Promise<void>((resolve, reject) => {
			resolveComplete = resolve;
			rejectComplete = reject;
		});

		unlisteners.push(
			await listen<CaptureWorkerLifecyclePayload>(WORKER_READY_EVENT, (event) => {
				const data = event.payload;
				if (data.exportId !== exportId) return;
				readyWorkers.add(data.workerId);
				if (readyWorkers.size === buckets.length) {
					if (readyTimeout) clearTimeout(readyTimeout);
					resolveReady();
				}
			})
		);

		unlisteners.push(
			await listen<CaptureWorkerProgressPayload>(WORKER_PROGRESS_EVENT, (event) => {
				const data = event.payload;
				if (data.exportId !== exportId) return;
				workerProgress[data.workerId] = data.completed;
				onProgress(workerProgress.reduce((sum, value) => sum + value, 0));
			})
		);

		unlisteners.push(
			await listen<CaptureWorkerLifecyclePayload>(WORKER_COMPLETE_EVENT, (event) => {
				const data = event.payload;
				if (data.exportId !== exportId) return;
				completeWorkers.add(data.workerId);
				workerProgress[data.workerId] = buckets[data.workerId]?.length ?? 0;
				onProgress(workerProgress.reduce((sum, value) => sum + value, 0));
				if (completeWorkers.size === buckets.length) resolveComplete();
			})
		);

		unlisteners.push(
			await listen<CaptureWorkerErrorPayload>(WORKER_ERROR_EVENT, (event) => {
				const data = event.payload;
				if (data.exportId !== exportId) return;
				const error = new Error(`Capture worker ${data.workerId} failed: ${data.error}`);
				if (readyWorkers.size < buckets.length) {
					rejectReady(error);
				} else {
					rejectComplete(error);
				}
			})
		);

		await closeCaptureWorkerWindows();
		const workerWindows = await openCaptureWorkerWindows(buckets);
		try {
			await readyPromise;
			await Promise.all(
				workerWindows.map((w, workerId) =>
					w.emit(WORKER_START_EVENT, {
						exportId,
						workerId,
						jobs: buckets[workerId],
						subfolder
					} satisfies CaptureWorkerStartPayload)
				)
			);
			await completePromise;
		} finally {
			if (readyTimeout) clearTimeout(readyTimeout);
			for (const unlisten of unlisteners) unlisten();
			await closeCaptureWorkerWindows();
		}
	}

	/**
	 * Execute les copies planifiees apres disponibilite de toutes les sources.
	 * @param {ExportFrameCopyJob[]} jobs Jobs de copie.
	 * @param {string | null} subfolder Sous-dossier de sortie, ou null.
	 * @param {(completed: number, timing?: number) => void} onProgress Callback de progression.
	 * @returns {Promise<void>}
	 */
	async function runCopyJobs(
		jobs: ExportFrameCopyJob[],
		subfolder: string | null,
		onProgress: (completed: number, timing?: number) => void
	): Promise<void> {
		for (let index = 0; index < jobs.length; index++) {
			const job = jobs[index];
			await duplicateScreenshot(job.sourceFileName, job.targetFileName, subfolder);
			onProgress(index + 1, job.timing);
		}
	}

	/**
	 * Execute un plan complet: blanks sources, captures paralleles puis copies.
	 * @param {ReturnType<typeof buildExportCaptureJobPlan>} plan Plan de jobs.
	 * @param {string | null} subfolder Sous-dossier de sortie, ou null.
	 * @param {(completed: number, total: number, timing?: number) => void} onProgress Callback global.
	 * @returns {Promise<void>}
	 */
	async function executeImageCapturePlan(
		plan: ReturnType<typeof buildExportCaptureJobPlan>,
		subfolder: string | null,
		onProgress: (completed: number, total: number, timing?: number) => void
	): Promise<void> {
		const totalJobs = Math.max(1, plan.totalJobs);
		let completed = 0;

		for (const job of plan.blankSourceJobs) {
			await captureBlankSourceJob(job);
			completed += 1;
			onProgress(completed, totalJobs, job.timing);
		}

		const completedBeforeCaptures = completed;
		if (plan.captureJobs.length > 0) {
			if (plan.workerBuckets.length <= 1) {
				await closeCaptureWorkerWindows();
				await runSerialCaptureJobs(plan.captureJobs, subfolder, (captureCompleted, timing) => {
					onProgress(completedBeforeCaptures + captureCompleted, totalJobs, timing);
				});
			} else {
				try {
					await runParallelCaptureJobs(plan.workerBuckets, subfolder, (captureCompleted) => {
						onProgress(completedBeforeCaptures + captureCompleted, totalJobs);
					});
				} catch (error) {
					console.error('Parallel capture failed, retrying serial capture:', error);
					await closeCaptureWorkerWindows();
					await runSerialCaptureJobs(plan.captureJobs, subfolder, (captureCompleted, timing) => {
						onProgress(completedBeforeCaptures + captureCompleted, totalJobs, timing);
					});
				}
			}
			completed = completedBeforeCaptures + plan.captureJobs.length;
		}

		const completedBeforeCopies = completed;
		await runCopyJobs(plan.copyJobs, subfolder, (copyCompleted, timing) => {
			onProgress(completedBeforeCopies + copyCompleted, totalJobs, timing);
		});
	}

	async function generateImagesForSegment(
		segmentIndex: number,
		segmentStart: number,
		segmentEnd: number,
		segmentImageFolder: string,
		totalSegments: number,
		phaseStartProgress: number = 0,
		phaseEndProgress: number = 100
	): Promise<number[]> {
		// Calculer les timings pour ce segment spécifique
		const segmentTimings = calculateTimingsForRange(segmentStart, segmentEnd);

		console.log(
			`Segment ${segmentIndex}: ${segmentTimings.uniqueSorted.length} screenshots to take`
		);

		const plan = buildImageCapturePlan(segmentTimings, segmentStart, segmentEnd, true);
		const totalDuration = exportData!.videoEndTime - exportData!.videoStartTime;

		await executeImageCapturePlan(plan, segmentImageFolder, (completed, total) => {
			const segmentImageProgress = (completed / total) * 100;
			const segmentPhaseProgress = (segmentIndex * 100 + segmentImageProgress) / totalSegments;
			const globalProgress =
				phaseStartProgress + (segmentPhaseProgress * (phaseEndProgress - phaseStartProgress)) / 100;

			emitProgress({
				exportId: Number(exportId),
				progress: globalProgress,
				currentState: ExportState.CapturingFrames,
				currentTime: (globalProgress / 100) * totalDuration,
				totalTime: totalDuration
			} as ExportProgress);
		});

		return plan.blankImageIndexes;
	}

	async function generateVideoForSegment(
		segmentIndex: number,
		segmentImageFolder: string,
		segmentStart: number,
		segmentDuration: number,
		blur: number = globalState.getStyle('global', 'overlay-blur')!.value as number,
		blankTimings: number[] = []
	): Promise<string> {
		currentVideoExportState = ExportState.AddingSubtitles;

		const fadeDuration = Math.round(
			globalState.getStyle('global', 'fade-duration')!.value as number
		);

		// Récupère le chemin de fichier de tous les audios du projet
		const audios: string[] = globalState.getAudioTrack.clips.map(
			(clip) =>
				globalState.currentProject!.content.getAssetById((clip as AssetClip).assetId).filePath
		);

		// Récupère le chemin de fichier de toutes les vidéos du projet
		const videos = globalState.getVideoTrack.clips.map((clip) => ({
			path: globalState.currentProject!.content.getAssetById((clip as AssetClip).assetId).filePath,
			loop_until_audio_end: (clip as AssetClip).loopUntilAudioEnd
		}));

		const segmentVideoExtension =
			(globalState.getExportState.exportWithoutBackground ?? false)
				? globalState.getExportState.transparentExportFormat === 'webm_vp9_alpha'
					? 'webm'
					: 'mov'
				: 'mp4';
		const segmentVideoFileName = `segment_${segmentIndex}_video.${segmentVideoExtension}`;
		const segmentFinalFilePath = await join(
			await appDataDir(),
			ExportService.exportFolder,
			exportId,
			segmentVideoFileName
		);

		console.log(`Generating video for segment ${segmentIndex}: ${segmentFinalFilePath}`);

		try {
			await invoke('export_video', {
				exportId: exportId,
				imgsFolder: await join(
					await appDataDir(),
					ExportService.exportFolder,
					exportId,
					segmentImageFolder
				),
				finalFilePath: segmentFinalFilePath,
				fps: exportData!.fps,
				fadeDuration: fadeDuration,
				startTime: Math.round(segmentStart), // Le startTime pour l'audio/vidéo de fond
				duration: Math.round(segmentDuration),
				audios: audios,
				videos: videos,
				blur: blur,
				videoFadeInEnabled: false,
				videoFadeOutEnabled: false,
				audioFadeInEnabled: false,
				audioFadeOutEnabled: false,
				exportFadeDurationMs: 0,
				performanceProfile: globalState.getExportState.performanceProfile,
				blankTimings,
				exportWithoutBackground: globalState.getExportState.exportWithoutBackground ?? false,
				transparentExportFormat: globalState.getExportState.transparentExportFormat
			});

			console.log(`[OK] Segment ${segmentIndex} video generated successfully`);
			return segmentFinalFilePath;
		} catch (e: unknown) {
			console.error(`[ERROR] Error generating segment ${segmentIndex} video:`, e);
			throw e;
		}
	}

	async function concatenateVideos(videoFilePaths: string[]) {
		console.log('Starting video concatenation...');
		const exportFadeSettings = getExportFadeSettings();
		currentVideoExportState = ExportState.MergingFiles;

		emitProgress({
			exportId: Number(exportId),
			progress: 0,
			currentState: ExportState.MergingFiles,
			currentTime: 0
		} as ExportProgress);

		try {
			const finalVideoPath = await invoke('concat_videos', {
				exportId: exportId,
				videoPaths: videoFilePaths,
				outputPath: exportData!.finalFilePath,
				videoFadeInEnabled: exportFadeSettings.videoFadeInEnabled,
				videoFadeOutEnabled: exportFadeSettings.videoFadeOutEnabled,
				audioFadeInEnabled: exportFadeSettings.audioFadeInEnabled,
				audioFadeOutEnabled: exportFadeSettings.audioFadeOutEnabled,
				exportFadeDurationMs: Math.max(0, exportFadeSettings.fadeDurationMs || 0),
				performanceProfile: globalState.getExportState.performanceProfile,
				exportWithoutBackground: globalState.getExportState.exportWithoutBackground ?? false,
				transparentExportFormat: globalState.getExportState.transparentExportFormat
			});

			console.log('[OK] Videos concatenated successfully:', finalVideoPath);

			emitProgress({
				exportId: Number(exportId),
				progress: 100,
				currentState: ExportState.MergingFiles,
				currentTime: exportData!.videoEndTime - exportData!.videoStartTime
			} as ExportProgress);

			// Supprimer les vidéos de segments individuelles
			for (const videoPath of videoFilePaths) {
				try {
					await remove(videoPath, { baseDir: BaseDirectory.AppData });
					console.log(`Deleted segment video: ${videoPath}`);
				} catch (e) {
					console.warn(`Could not delete segment video ${videoPath}:`, e);
				}
			}
		} catch (e: unknown) {
			console.error('[ERROR] Error concatenating videos:', e);
			emitProgress({
				exportId: Number(exportId),
				progress: 100,
				currentState: ExportState.Error,
				errorLog: JSON.stringify(e, Object.getOwnPropertyNames(e))
			} as ExportProgress);
			throw e;
		}
	}

	async function handleNormalExport(
		exportStart: number,
		exportEnd: number,
		totalDuration: number,
		blur: number
	) {
		// Calculer tous les timings nécessaires
		const timings = calculateTimingsForRange(exportStart, exportEnd);

		console.log('Normal export - Timings détectés:', timings.uniqueSorted);
		console.log(
			'Image(s) a dupliquer (blank):',
			timings.blankImgs,
			'Image choisie:',
			timings.imgWithNothingShown
		);

		const plan = buildImageCapturePlan(timings, exportStart, exportEnd, false);

		await executeImageCapturePlan(plan, null, (completed, total) => {
			const progress = (completed / total) * 100;
			emitProgress({
				exportId: Number(exportId),
				progress,
				currentState: ExportState.CapturingFrames,
				currentTime: (progress / 100) * totalDuration,
				totalTime: totalDuration
			} as ExportProgress);
		});

		const normalizedBlankTimings = plan.blankImageIndexes;

		await ExportService.deleteProjectFile(Number(exportId));
		await deleteBlankImages();

		// Générer la vidéo normale
		await generateNormalVideo(exportStart, totalDuration, blur, normalizedBlankTimings);

		// Nettoyage
		await finalCleanup();
	}

	function calculateTimingsForRange(rangeStart: number, rangeEnd: number) {
		const subtitleClips: ExportSubtitleCaptureClip[] = globalState.getSubtitleTrack.clips.map(
			(clip) => {
				const wbwHighlightTimings =
					clip instanceof SubtitleClip ? getExportWordByWordHighlightTimings(clip) : undefined;

				return {
					id: clip.id,
					startTime: clip.startTime,
					endTime: clip.endTime,
					kind:
						clip instanceof SilenceClip
							? 'silence'
							: clip instanceof PredefinedSubtitleClip
								? 'predefined'
								: 'subtitle',
					surah: 'surah' in clip && typeof clip.surah === 'number' ? clip.surah : undefined,
					visualMergeGroupId:
						'visualMergeGroupId' in clip &&
						(typeof clip.visualMergeGroupId === 'string' || clip.visualMergeGroupId === null)
							? clip.visualMergeGroupId
							: undefined,
					visualMergeMode:
						'visualMergeMode' in clip &&
						(clip.visualMergeMode === 'arabic' ||
							clip.visualMergeMode === 'translation' ||
							clip.visualMergeMode === 'both' ||
							clip.visualMergeMode === null)
							? clip.visualMergeMode
							: undefined,
					wbwHighlightTimings
				};
			}
		);

		const timedOverlayClips: ExportTimedOverlayCaptureClip[] = (
			(globalState.getCustomClipTrack?.clips || []) as CustomClip[]
		).map((clip) => {
			return {
				id: clip.id,
				startTime: clip.startTime,
				endTime: clip.endTime,
				alwaysShow: Boolean(clip.category?.getStyle('always-show')?.value),
				captureBoundariesWhenAlwaysShow: true
			};
		});

		if (globalState.getStyle('global', 'show-surah-name')!.value === true) {
			timedOverlayClips.push({
				id: 'surah-name',
				startTime: globalState.getStyle('global', 'surah-name-time-appearance')!.value as number,
				endTime: globalState.getStyle('global', 'surah-name-time-disappearance')!.value as number,
				alwaysShow: Boolean(globalState.getStyle('global', 'surah-name-always-show')!.value)
			});
		}

		if (
			globalState.getStyle('global', 'show-reciter-name')!.value === true &&
			globalState.currentProject?.detail.reciter !== 'not set'
		) {
			timedOverlayClips.push({
				id: 'reciter-name',
				startTime: globalState.getStyle('global', 'reciter-name-time-appearance')!.value as number,
				endTime: globalState.getStyle('global', 'reciter-name-time-disappearance')!.value as number,
				alwaysShow: Boolean(globalState.getStyle('global', 'reciter-name-always-show')!.value)
			});
		}

		return calculateCaptureTimingsForRange({
			rangeStart,
			rangeEnd,
			fadeDuration: Math.round(globalState.getStyle('global', 'fade-duration')!.value as number),
			subtitleClips,
			timedOverlayClips,
			getCurrentSurah: (time) => globalState.getSubtitleTrack.getCurrentSurah(time)
		});
	}

	/**
	 * Retourne les timings WBW à capturer pour l'export d'un clip.
	 *
	 * Pour un merge visuel arabe, la résolution finale est faite dans
	 * `ExportCaptureTiming.getExportWordByWordHighlightTimings()`: le helper agrège les timings
	 * de tout le groupe afin que les mots partagés puissent être recapturés sur chaque clip.
	 *
	 * @param {SubtitleClip} clip Clip Quran à inspecter.
	 * @returns {number[] | undefined} Timings absolus en millisecondes, ou `undefined`.
	 */
	function getExportWordByWordHighlightTimings(clip: SubtitleClip): number[] | undefined {
		const subtitleClips = globalState.getSubtitleTrack.clips.filter(
			(candidate): candidate is SubtitleClip => candidate instanceof SubtitleClip
		);

		const exportClip: ExportSubtitleWbwSourceClip = {
			id: clip.id,
			startTime: clip.startTime,
			endTime: clip.endTime,
			visualMergeGroupId: clip.visualMergeGroupId,
			visualMergeMode: clip.visualMergeMode,
			alignmentMetadata: clip.alignmentMetadata
		};

		const exportSubtitleClips: ExportSubtitleWbwSourceClip[] = subtitleClips.map((candidate) => ({
			id: candidate.id,
			startTime: candidate.startTime,
			endTime: candidate.endTime,
			visualMergeGroupId: candidate.visualMergeGroupId,
			visualMergeMode: candidate.visualMergeMode,
			alignmentMetadata: candidate.alignmentMetadata
		}));

		return getExportWordByWordHighlightTimingsUtil({
			clip: exportClip,
			subtitleClips: exportSubtitleClips,
			isWbwEnabledForClipId: (clipId) =>
				isWordByWordHighlightEnabled((styleId) =>
					globalState.getVideoStyle
						.getStylesOfTarget('arabic')
						.getEffectiveValue(styleId as StyleName, clipId)
				)
		});
	}

	async function generateNormalVideo(
		exportStart: number,
		duration: number,
		blur: number,
		blankTimings: number[] = []
	) {
		currentVideoExportState = ExportState.AddingSubtitles;

		emitProgress({
			exportId: Number(exportId),
			progress: 0,
			currentState: ExportState.Initializing,
			currentTime: 0,
			totalTime: duration
		} as ExportProgress);

		const fadeDuration = Math.round(
			globalState.getStyle('global', 'fade-duration')!.value as number
		);
		const exportFadeSettings = getExportFadeSettings();

		// Récupère le chemin de fichier de tous les audios du projet
		const audios: string[] = globalState.getAudioTrack.clips.map(
			(clip) =>
				globalState.currentProject!.content.getAssetById((clip as AssetClip).assetId).filePath
		);

		// Récupère le chemin de fichier de toutes les vidéos du projet
		const videos = globalState.getVideoTrack.clips.map((clip) => ({
			path: globalState.currentProject!.content.getAssetById((clip as AssetClip).assetId).filePath,
			loop_until_audio_end: (clip as AssetClip).loopUntilAudioEnd
		}));

		console.log(exportData!.finalFilePath);

		// Supprimer les images blanks avant l'export vidéo
		await deleteBlankImages();

		try {
			await invoke('export_video', {
				exportId: exportId,
				imgsFolder: await join(await appDataDir(), ExportService.exportFolder, exportId),
				finalFilePath: exportData!.finalFilePath,
				fps: exportData!.fps,
				fadeDuration: fadeDuration,
				startTime: exportStart,
				duration: Math.round(duration),
				audios: audios,
				videos: videos,
				blur: blur,
				videoFadeInEnabled: exportFadeSettings.videoFadeInEnabled,
				videoFadeOutEnabled: exportFadeSettings.videoFadeOutEnabled,
				audioFadeInEnabled: exportFadeSettings.audioFadeInEnabled,
				audioFadeOutEnabled: exportFadeSettings.audioFadeOutEnabled,
				exportFadeDurationMs: Math.max(0, exportFadeSettings.fadeDurationMs || 0),
				performanceProfile: globalState.getExportState.performanceProfile,
				blankTimings,
				exportWithoutBackground: globalState.getExportState.exportWithoutBackground ?? false,
				transparentExportFormat: globalState.getExportState.transparentExportFormat
			});
		} catch (e: unknown) {
			emitProgress({
				exportId: Number(exportId),
				progress: 100,
				currentState: ExportState.Error,
				errorLog: JSON.stringify(e, Object.getOwnPropertyNames(e))
			} as ExportProgress);
			throw e;
		}
	}

	async function finalCleanup() {
		try {
			// Supprime le dossier temporaire des images
			await remove(await join(ExportService.exportFolder, exportId), {
				baseDir: BaseDirectory.AppData,
				recursive: true
			});

			console.log('Temporary images folder removed.');
		} catch (e) {
			console.warn('Could not remove temporary folder:', e);
		}

		// Ferme la fenêtre d'export
		getCurrentWebviewWindow().close();
	}

	/**
	 * Lit un PNG blank deja capture pour servir de fond sans sous-titres.
	 * @param {string | null} fileName Nom du fichier sans extension.
	 * @returns {Promise<Blob | null>} Blob PNG ou null si indisponible.
	 */
	async function readReusableBlankBlob(fileName: string | null): Promise<Blob | null> {
		if (!fileName) return null;

		const filePath = await join(ExportService.exportFolder, exportId, fileName + '.png');
		if (!(await exists(filePath, { baseDir: BaseDirectory.AppData }))) return null;

		const bytes = await readFile(filePath, { baseDir: BaseDirectory.AppData });
		return new Blob([bytes], { type: 'image/png' });
	}

	async function takeScreenshot(
		fileName: string,
		subfolder: string | null = null,
		reusableBlankFileName: string | null = null
	) {
		// L'element a transformer en image
		const node = document.getElementById('overlay')!;

		// Pour les blanks, forcer les overlays (surahName, reciterName, customText) à leur opacité max
		// afin d'éviter une capture en cours de fade-in, et masquer les sous-titres (arabe/traduction).
		const isBlankScreenshot = fileName.startsWith('blank_');
		const forcedOverlayElements: { el: HTMLElement; prev: string }[] = [];
		if (isBlankScreenshot) {
			node.querySelectorAll<HTMLElement>('[data-overlay-max-opacity]').forEach((el) => {
				forcedOverlayElements.push({ el, prev: el.style.opacity });
				el.style.opacity = el.dataset.overlayMaxOpacity!;
			});
			for (const id of ['subtitles-container', 'subtitles-backgrounds']) {
				const el = node.querySelector<HTMLElement>(`#${id}`);
				if (el) forcedOverlayElements.push({ el, prev: el.style.opacity });
				if (el) el.style.opacity = '0';
			}
		}

		// En sachant que node.clientWidth = 1920 et node.clientHeight = 1080,
		// je veux pouvoir avoir la dimension trouvée dans les paramètres d'export
		const targetWidth = exportData!.videoDimensions.width;
		const targetHeight = exportData!.videoDimensions.height;

		// Calcul du scale
		const scaleX = targetWidth / node.clientWidth;
		const scaleY = targetHeight / node.clientHeight;
		const scale = Math.min(scaleX, scaleY);

		try {
			const pathComponents = [ExportService.exportFolder, exportId];
			if (subfolder) pathComponents.push(subfolder);
			pathComponents.push(fileName + '.png');

			const filePathWithName = await join(...pathComponents);

			const isMacOS = shouldRedrawExportTextWithCanvas();
			const useLiveTextCanvasCapture = isMacOS;
			if (!useLiveTextCanvasCapture) {
				const blob: Blob | null = await domToBlob(node, {
					width: node.clientWidth * scale,
					height: node.clientHeight * scale,
					style: {
						// Garder la logique historique de mise a l'echelle pour preserver le centrage.
						transform: 'scale(' + scale + ')',
						transformOrigin: 'top left'
					},
					quality: 1
				});

				if (!blob) throw new Error('domToBlob returned null');

				const buffer = await blob.arrayBuffer();
				const bytes = new Uint8Array(buffer);

				await writeFile(filePathWithName, bytes, { baseDir: BaseDirectory.AppData });
				console.log('Screenshot saved to:', filePathWithName);
			} else {
				const backgroundBlob = hasVisibleSubtitleBackground(node)
					? null
					: await readReusableBlankBlob(reusableBlankFileName);
				const bytes = await captureMacOsOverlayPngBytes(node, scale, targetWidth, targetHeight, {
					backgroundBlob,
					compensateTextWeight: isMacOS,
					textRootSelector: backgroundBlob ? '#subtitles-container' : undefined
				});

				await writeFile(filePathWithName, bytes, { baseDir: BaseDirectory.AppData });
				console.log('Screenshot saved to:', filePathWithName);
			}
		} catch (error: unknown) {
			console.error('Error while taking screenshot: ', error);
			const message =
				error && typeof error === 'object' && 'message' in error
					? String((error as { message?: unknown }).message ?? '')
					: String(error ?? 'Unknown error');
			toast.error(get(LL).editor.exportScreenshotError({ error: message }));
			throw error;
		} finally {
			// Restaurer l'opacité originale des overlays forcés
			for (const { el, prev } of forcedOverlayElements) {
				el.style.opacity = prev;
			}
		}
	}

	/**
	 * Duplique un screenshot existant vers un nouveau fichier
	 * @param sourceFileName Le nom du fichier source (sans extension)
	 * @param targetFileName Le nom du fichier cible (sans extension)
	 * @param subfolder Le sous-dossier où se trouvent les fichiers (optionnel)
	 */
	async function duplicateScreenshot(
		sourceFileName: string | number,
		targetFileName: number,
		subfolder: string | null = null
	) {
		// Construire les chemins source et cible
		const sourcePathComponents = [ExportService.exportFolder, exportId];
		const targetPathComponents = [ExportService.exportFolder, exportId];

		if (subfolder) {
			if (!sourceFileName.toString().includes('blank')) sourcePathComponents.push(subfolder);
			targetPathComponents.push(subfolder);
		}

		sourcePathComponents.push(sourceFileName + '.png');
		targetPathComponents.push(targetFileName + '.png');

		const sourceFilePathWithName = await join(...sourcePathComponents);
		const targetFilePathWithName = await join(...targetPathComponents);

		// Utiliser la commande Rust pour copier le fichier côté backend,
		// évitant de charger tout le contenu du fichier en mémoire JS
		try {
			await invoke('copy_file', {
				source: await join(await appDataDir(), sourceFilePathWithName),
				destination: await join(await appDataDir(), targetFilePathWithName)
			});
			console.log('Duplicate screenshot saved to:', targetFilePathWithName);
		} catch (error) {
			// Fallback: lire et écrire si la commande Rust n'existe pas
			if (!(await exists(sourceFilePathWithName, { baseDir: BaseDirectory.AppData }))) {
				console.error('Source screenshot does not exist:', sourceFilePathWithName);
				throw new Error(`Source screenshot does not exist: ${sourceFilePathWithName}`);
			}
			const data = await readFile(sourceFilePathWithName, { baseDir: BaseDirectory.AppData });
			await writeFile(targetFilePathWithName, data, { baseDir: BaseDirectory.AppData });
			console.warn('copy_file failed, fallback copy used:', error);
			console.log('Duplicate screenshot saved to (fallback):', targetFilePathWithName);
		}
	}

	/**
	 * Supprime toutes les images blanks (blank_xxx.png) du dossier spécifié
	 * @param subfolder Le sous-dossier où supprimer les images blanks (optionnel)
	 */
	async function deleteBlankImages() {
		try {
			// Construire le chemin du dossier
			const pathComponents = [ExportService.exportFolder, exportId];
			const exportPath = await join(...pathComponents);

			for (const entry of await readDir(exportPath, { baseDir: BaseDirectory.AppData })) {
				if (!entry.name.startsWith('blank_') || !entry.name.endsWith('.png')) continue;
				const blankFileName = entry.name;
				const blankFilePath = await join(...pathComponents, blankFileName);

				if (await exists(blankFilePath, { baseDir: BaseDirectory.AppData })) {
					await remove(blankFilePath, { baseDir: BaseDirectory.AppData });
					console.log(`Deleted blank image: ${blankFileName}`);
				}
			}
		} catch (error) {
			console.warn('Error deleting blank images:', error);
		}
	}

	/**
	 * Attendre un peu plus longtemps si le timing est très espacé du précédent (sous-titre long)
	 * @param timing
	 * @param i
	 * @param uniqueSorted
	 */
	async function wait(timing: number) {
		// globalState.updateVideoPreviewUI();
		console.log(`Waiting for frame at ${timing}ms...`);

		// Attend que l'élément `subtitles-container` est une opacité de 1 (visible) (car il est caché pendant que max-height s'applique)
		const subtitlesContainer = document.getElementById('subtitles-container') as HTMLElement | null;

		if (!subtitlesContainer) {
			await new Promise((resolve) => setTimeout(resolve, 200));
		} else {
			const startTime = Date.now();
			const timeout = 1000; // 1000ms maximum timeout to avoid infinite hang

			do {
				if (Date.now() - startTime > timeout) {
					console.warn(
						`Timeout waiting for subtitles-container at ${timing}ms, proceeding anyway.`
					);
					break;
				}
				await new Promise((resolve) => setTimeout(resolve, 10));
			} while (subtitlesContainer.style.opacity !== '1');
		}

		await QPCFontProvider.waitForFontsInElement(document.getElementById('overlay'));
	}
</script>

{#if globalState.currentProject}
	<div class="absolute inset-0 w-screen h-screen">
		<VideoPreview bind:this={videoPreview} showControls={false} />
		<div class="hidden">
			<Timeline />
		</div>

		<!-- affiche le current timing -->
		<!-- <div
			id="export-timing-indicator"
			class="absolute top-2 left-1/2 -translate-x-1/2 bg-black bg-opacity-50 text-white px-3 py-1 rounded-md text-sm select-none z-[99999]"
		>
			{globalState.getTimelineState.cursorPosition}
		</div> -->
	</div>
{/if}
