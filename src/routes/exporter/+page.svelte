<script lang="ts">
	import type { AssetClip } from '$lib/classes';
	import Timeline from '$lib/components/projectEditor/timeline/Timeline.svelte';
	import VideoPreview from '$lib/components/projectEditor/videoPreview/VideoPreview.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
	import { listen } from '@tauri-apps/api/event';
	import { onMount } from 'svelte';
	import { exists, BaseDirectory, mkdir, writeFile, remove, readFile } from '@tauri-apps/plugin-fs';
	import { appDataDir, join } from '@tauri-apps/api/path';
	import ExportService, { type ExportProgress } from '$lib/services/ExportService';
	import { AnalyticsService } from '$lib/services/AnalyticsService';
	import { ProjectService } from '$lib/services/ProjectService';
	import {
		buildBlurSegmentsForRange,
		type BlurSegment,
		type TimeRange
	} from '$lib/services/OverlayBlurSegmentation';
	import {
		EXPORT_CAPTURE_MAX_ATTEMPTS,
		detectExportCapturePlatform,
		getCaptureAttemptTimeoutMs,
		shouldRetryCapture,
		shouldUseDataUrlFallback,
		type ScreenshotCaptureStage
	} from '$lib/services/ExportCapturePolicy';
	import QPCFontProvider from '$lib/services/FontProvider';
	import { getAllWindows } from '@tauri-apps/api/window';
	import Exportation, { ExportState } from '$lib/classes/Exportation.svelte';
	import toast from 'svelte-5-french-toast';
	import { createContext, destroyContext, domToCanvas } from 'modern-screenshot';
	import { ClipWithTranslation, CustomTextClip, SilenceClip } from '$lib/classes/Clip.svelte';

	async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		const timeoutPromise = new Promise<never>((_, reject) => {
			timeoutId = setTimeout(() => {
				reject(new Error(`${label} timed out after ${timeoutMs}ms`));
			}, timeoutMs);
		});

		try {
			return await Promise.race([promise, timeoutPromise]);
		} finally {
			if (timeoutId !== undefined) clearTimeout(timeoutId);
		}
	}

	// Contient l'ID de l'export
	let exportId = '';

	// VideoPreview
	let videoPreview: VideoPreview | undefined = $state(undefined);

	// Récupère les données d'export de la vidéo
	let exportData: Exportation | undefined;

	// Durée de chunk calculée dynamiquement basée sur chunkSize (1-200)
	// chunkSize = 1 -> 30s, chunkSize = 50 -> 2min30, chunkSize = 200 -> 10min
	let CHUNK_DURATION = 0; // Sera calculé dans onMount
	let activeVideoSegments: TimeRange[] = [];
	let isCleaningUp = false;
	let hasTerminalState = false;
	let heartbeatState: ExportState = ExportState.CapturingFrames;
	let heartbeatCurrentTime = 0;
	let exportTraceSequence = 0;
	let pendingProjectExportLogs: string[] = [];
	let isFlushingProjectExportLogs = false;
	const capturePlatform = detectExportCapturePlatform(
		typeof navigator === 'undefined' ? null : navigator.userAgent
	);

	type ScreenshotCaptureMetadata = {
		fileName: string;
		subfolder?: string | null;
		chunkIndex?: number;
		timing?: number;
		imageIndex?: string | number;
	};

	type ScreenshotAttemptFailure = {
		stage: ScreenshotCaptureStage;
		attempt: number;
		timeoutMs: number;
		usedDataUrlFallback: boolean;
		message: string;
	};

	class ScreenshotCaptureError extends Error {
		readonly exportId: string;
		readonly fileName: string;
		readonly chunkIndex?: number;
		readonly timing?: number;
		readonly imageIndex?: string | number;
		readonly stage: ScreenshotCaptureStage;
		readonly attempt: number;
		readonly timeoutMs: number;
		readonly platform = capturePlatform;
		readonly usedDataUrlFallback: boolean;

		constructor(metadata: ScreenshotCaptureMetadata, failure: ScreenshotAttemptFailure) {
			const payload = {
				error: 'screenshot_capture_failed',
				exportId,
				fileName: metadata.fileName,
				chunkIndex: metadata.chunkIndex,
				timing: metadata.timing,
				imageIndex: metadata.imageIndex ?? metadata.fileName,
				stage: failure.stage,
				attempt: failure.attempt,
				timeoutMs: failure.timeoutMs,
				platform: capturePlatform,
				usedDataUrlFallback: failure.usedDataUrlFallback,
				message: failure.message
			};
			super(JSON.stringify(payload));
			this.name = 'ScreenshotCaptureError';
			this.exportId = exportId;
			this.fileName = metadata.fileName;
			this.chunkIndex = metadata.chunkIndex;
			this.timing = metadata.timing;
			this.imageIndex = metadata.imageIndex ?? metadata.fileName;
			this.stage = failure.stage;
			this.attempt = failure.attempt;
			this.timeoutMs = failure.timeoutMs;
			this.usedDataUrlFallback = failure.usedDataUrlFallback;
		}
	}

	type ExportProgressEvent = {
		payload: {
			progress?: number;
			current_time: number;
			total_time?: number;
			export_id: string;
			chunk_index?: number;
		};
	};
	type ExportCompleteEvent = {
		payload: { filename: string; exportId: string; chunkIndex?: number };
	};
	type ExportErrorEvent = {
		payload: { error: string; export_id: string };
	};

	async function exportProgress(event: ExportProgressEvent) {
		const data = event.payload as {
			progress?: number;
			current_time: number;
			total_time?: number;
			export_id: string;
			chunk_index?: number;
		};

		// Vérifie que c'est bien pour cette exportation
		if (data.export_id !== exportId) return;
		await traceExportStep('rust_export_progress_event', {
			progress: data.progress ?? null,
			currentTimeSeconds: data.current_time,
			totalTimeSeconds: data.total_time ?? null,
			chunkIndex: data.chunk_index ?? null
		});

		if (data.progress !== null && data.progress !== undefined) {
			console.log(
				`Export Progress: ${data.progress.toFixed(1)}% (${data.current_time.toFixed(1)}s / ${data.total_time?.toFixed(1)}s)`
			);

			const chunkIndex = data.chunk_index ?? 0;
			const totalDuration = exportData!.videoEndTime - exportData!.videoStartTime;

			// Calculer le pourcentage global et le temps actuel global
			let globalProgress: number;
			let globalCurrentTime: number;

			if (data.chunk_index !== undefined) {
				// Mode segmenté: utiliser les bornes réelles des segments.
				const segment = activeVideoSegments[chunkIndex];
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
				// Mode export normal (sans chunks)
				globalProgress = data.progress;
				globalCurrentTime = data.current_time * 1000; // Convertir de secondes en millisecondes
			}

			emitProgress({
				exportId: Number(exportId),
				progress: globalProgress,
				currentState: ExportState.CreatingVideo,
				currentTime: globalCurrentTime
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
		await traceExportStep('export_complete', {
			filename: data.filename,
			chunkIndex: data.chunkIndex ?? null
		});

		// Si c'est un chunk, ne pas emettre 100% maintenant (ca sera fait a la fin de tous les chunks)
		if (data.chunkIndex === undefined) {
			// Export normal (sans chunks) - émettre 100%
			await emitProgress({
				exportId: Number(exportId),
				progress: 100,
				currentState: ExportState.Exported
			} as ExportProgress);
		} else {
			// Export en chunks - juste logger la completion du chunk
			console.log(`[OK] Chunk ${data.chunkIndex} completed`);
		}
	}

	async function exportError(event: ExportErrorEvent) {
		const error = event.payload;
		console.error(`[ERROR] Export failed: ${error}`);

		if (error.export_id !== exportId) return;

		await traceExportStep('export_error_event', {
			error: error.error
		});
		await failExport(error.error);
	}

	async function emitProgress(progress: ExportProgress) {
		heartbeatState = progress.currentState;
		heartbeatCurrentTime = progress.currentTime ?? heartbeatCurrentTime;
		await appendProjectExportLog('emit_progress', {
			state: progress.currentState,
			progress: progress.progress,
			currentTime: progress.currentTime ?? null,
			errorLog: progress.errorLog ?? null
		});
		(await getAllWindows()).find((w) => w.label === 'main')!.emit('export-progress-main', progress);
	}

	async function emitHeartbeat() {
		if (!exportId || hasTerminalState) return;

		await (
			await getAllWindows()
		)
			.find((w) => w.label === 'main')
			?.emit('export-heartbeat-main', {
				exportId: Number(exportId),
				currentState: heartbeatState,
				currentTime: heartbeatCurrentTime
			});
	}

	function stringifyError(error: unknown): string {
		if (error instanceof Error) return error.message;
		if (typeof error === 'string') return error;

		try {
			if (typeof error === 'object' && error !== null) {
				return JSON.stringify(error, Object.getOwnPropertyNames(error));
			}
			return JSON.stringify(error);
		} catch {
			return String(error ?? 'Unknown error');
		}
	}

	function createProjectExportLogEntry(
		event: string,
		payload: Record<string, unknown> = {}
	): string {
		return JSON.stringify({
			timestamp: new Date().toISOString(),
			event,
			exportId,
			platform: capturePlatform,
			...payload
		});
	}

	function getOriginalProjectId(): number | null {
		return globalState.currentProject?.projectEditorState.export.originalProjectId ?? null;
	}

	async function flushProjectExportLogs(): Promise<void> {
		if (isFlushingProjectExportLogs || pendingProjectExportLogs.length === 0) return;

		const originalProjectId = getOriginalProjectId();
		if (!originalProjectId) {
			pendingProjectExportLogs = [];
			return;
		}

		isFlushingProjectExportLogs = true;
		const logBatch = pendingProjectExportLogs.splice(0, pendingProjectExportLogs.length);

		try {
			await ProjectService.appendExportLogs(originalProjectId, logBatch);
			await (
				await getAllWindows()
			)
				.find((w) => w.label === 'main')
				?.emit('project-export-log-batch-main', {
					projectId: originalProjectId,
					logEntries: logBatch
				});
		} finally {
			isFlushingProjectExportLogs = false;
			if (pendingProjectExportLogs.length > 0) {
				await flushProjectExportLogs();
			}
		}
	}

	async function appendProjectExportLog(
		event: string,
		payload: Record<string, unknown> = {}
	): Promise<void> {
		const originalProjectId = getOriginalProjectId();
		if (!originalProjectId) return;

		const logEntry = createProjectExportLogEntry(event, payload);
		pendingProjectExportLogs.push(logEntry);
		if (pendingProjectExportLogs.length >= 25) {
			await flushProjectExportLogs();
		}
	}

	async function traceExportStep(
		event: string,
		payload: Record<string, unknown> = {}
	): Promise<void> {
		const sequence = ++exportTraceSequence;
		console.log(`[EXPORT_TRACE #${sequence}] ${event}`, payload);
		await appendProjectExportLog(event, {
			sequence,
			...payload
		});
	}

	async function failExport(error: unknown) {
		if (hasTerminalState) return;
		hasTerminalState = true;

		const errorLog = stringifyError(error);
		let analyticsProperties: Record<string, unknown> = {};

		try {
			const parsed = JSON.parse(errorLog);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				analyticsProperties = parsed as Record<string, unknown>;
			}
		} catch {
			analyticsProperties = {};
		}

		console.error('[ERROR] Export failed irrecoverably:', error);
		await traceExportStep('export_failed', {
			errorLog
		});
		toast.error('Error while exporting video: ' + errorLog);

		AnalyticsService.trackMacOSExportLog(errorLog, {
			export_id: exportId,
			platform: capturePlatform,
			...analyticsProperties
		});

		if (exportId) {
			await emitProgress({
				exportId: Number(exportId),
				progress: 100,
				currentState: ExportState.Error,
				errorLog
			} as ExportProgress);
		}

		await flushProjectExportLogs();
		await finalCleanup();
	}

	async function waitForRetryPause() {
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
		await new Promise((resolve) => setTimeout(resolve, 300));
	}

	async function blobToBytes(blob: Blob): Promise<Uint8Array> {
		return new Uint8Array(await blob.arrayBuffer());
	}

	async function encodeCanvasToPngBytesViaBlob(
		canvas: HTMLCanvasElement,
		timeoutMs: number,
		fileName: string
	): Promise<Uint8Array> {
		const blob = await withTimeout(
			new Promise<Blob | null>((resolve) => {
				canvas.toBlob((result) => resolve(result), 'image/png', 1);
			}),
			timeoutMs,
			`Screenshot encoding for ${fileName}`
		);

		if (!blob) throw new Error('Canvas.toBlob returned null');
		return blobToBytes(blob);
	}

	async function encodeCanvasToPngBytesViaDataUrl(
		canvas: HTMLCanvasElement,
		timeoutMs: number,
		fileName: string
	): Promise<Uint8Array> {
		const dataUrl = await withTimeout(
			Promise.resolve().then(() => canvas.toDataURL('image/png', 1)),
			timeoutMs,
			`Screenshot data URL encoding for ${fileName}`
		);
		const [, base64Payload = ''] = dataUrl.split(',', 2);
		if (!base64Payload) throw new Error('Canvas.toDataURL returned an empty payload');

		const binary = atob(base64Payload);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		return bytes;
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

	onMount(() => {
		// Ecoute les evenements de progression d'export donnes par Rust
		listen('export-progress', exportProgress);
		listen('export-complete', exportComplete);
		listen('export-error', exportError);

		const heartbeatIntervalId = window.setInterval(() => {
			void emitHeartbeat();
		}, 2000);
		const logFlushIntervalId = window.setInterval(() => {
			void flushProjectExportLogs();
		}, 500);

		void (async () => {
			await AnalyticsService.init();
			await traceExportStep('export_window_mount_initialized');

			// Récupère l'id de l'export, qui est en paramètre d'URL
			const id = new URLSearchParams(window.location.search).get('id');
			if (id) {
				try {
					exportId = id;
					await traceExportStep('export_window_id_detected', {
						exportId
					});

					// Recupere le projet correspondant a cet ID (dans le dossier export, parametre inExportFolder: true)
					globalState.currentProject = await ExportService.loadProject(Number(id));
					await traceExportStep('export_project_loaded', {
						loadedProjectId: globalState.currentProject.detail.id,
						originalProjectId: getOriginalProjectId()
					});
					removeHiddenTranslationsFromExportProject();
					await traceExportStep('hidden_translations_removed');

					// Créer le dossier d'export s'il n'existe pas
					await mkdir(await join(ExportService.exportFolder, exportId), {
						baseDir: BaseDirectory.AppData,
						recursive: true
					});
					await traceExportStep('export_temp_folder_ready');

					// Supprime le fichier projet JSON
					ExportService.deleteProjectFile(Number(id));
					await traceExportStep('export_project_file_delete_requested');

					// Récupère les données d'export
					exportData = ExportService.findExportById(Number(id))!;
					await traceExportStep('export_window_started', {
						originalProjectId: getOriginalProjectId()
					});

					// Prépare les paramètres pour exporter la vidéo
					globalState.getVideoPreviewState.isFullscreen = true; // Met la vidéo en plein écran
					globalState.getVideoPreviewState.isPlaying = false; // Met la vidéo en pause
					globalState.getVideoPreviewState.showVideosAndAudios = true; // Met la vidéo en sourdine
					// Met le curseur au début du startTime voulu pour l'export
					globalState.getTimelineState.cursorPosition = globalState.getExportState.videoStartTime;
					globalState.getTimelineState.movePreviewTo = globalState.getExportState.videoStartTime;
					// Hide waveform: consomme des ressources inutilement
					if (globalState.settings) globalState.settings.persistentUiState.showWaveforms = false;
					// Divise par 2 le fade duration pour l'export (car l'export le rallonge par deux, ne pas demander pourquoi)
					globalState.getStyle('global', 'fade-duration')!.value =
						(globalState.getStyle('global', 'fade-duration')!.value as number) / 2;

					// Calculer CHUNK_DURATION basé sur chunkSize (1-200)
					// Formule linéaire: chunkSize=1 -> 30s, chunkSize=50 -> 2min30, chunkSize=200 -> 10min
					const chunkSize = globalState.getExportState.chunkSize;
					const minDuration = 30 * 1000; // 30 secondes en ms
					const maxDuration = 10 * 60 * 1000; // 10 minutes en ms
					CHUNK_DURATION =
						minDuration + ((chunkSize - 1) / (200 - 1)) * (maxDuration - minDuration);

					await traceExportStep('export_chunk_duration_computed', {
						chunkSize,
						chunkDurationMs: CHUNK_DURATION
					});

					// Enlève tout les styles de position de la vidéo
					let videoElement: HTMLElement;
					// Attend que l'élément soit prêt
					do {
						await new Promise((resolve) => setTimeout(resolve, 100));
						videoElement = document.getElementById('video-preview-section') as HTMLElement;
						videoElement.style.objectFit = 'cover';
						videoElement.style.top = '0';
						videoElement.style.left = '0';
						videoElement.style.width = '100%';
						videoElement.style.height = '100%';
					} while (!videoElement);

					// Attend 2 secondes que tout soit prêt
					await new Promise((resolve) => setTimeout(resolve, 2000));
					await traceExportStep('export_window_ready_after_initial_wait');

					// Démarrer l'export
					await startExport();
				} catch (error) {
					await failExport(error);
				}
			}
		})();

		return () => {
			window.clearInterval(heartbeatIntervalId);
			window.clearInterval(logFlushIntervalId);
			void flushProjectExportLogs();
		};
	});

	async function startExport() {
		if (!exportData) return;

		const exportStart = Math.round(exportData.videoStartTime);
		const exportEnd = Math.round(exportData.videoEndTime);
		const totalDuration = exportEnd - exportStart;

		await traceExportStep('start_export', {
			exportStart,
			exportEnd,
			totalDuration,
			chunkDurationMs: CHUNK_DURATION
		});

		// Si la duree est superieure a 10 minutes, on decoupe en chunks
		if (totalDuration > CHUNK_DURATION) {
			const baseRanges = calculateChunksWithFadeOut(exportStart, exportEnd).chunks;
			const renderSegments = createBlurAwareRenderSegments(baseRanges);
			await traceExportStep('start_export_segmented_due_to_duration', {
				baseRangeCount: baseRanges.length,
				renderSegmentCount: renderSegments.length
			});
			await handleSegmentedExport(renderSegments, totalDuration);
			return;
		}

		const shortExportBlurSegments = getBlurSegmentsForRange(exportStart, exportEnd);
		if (shortExportBlurSegments.length > 1) {
			await traceExportStep('start_export_segmented_due_to_blur_segments', {
				renderSegmentCount: shortExportBlurSegments.length
			});
			await handleSegmentedExport(shortExportBlurSegments, totalDuration);
			return;
		}

		activeVideoSegments = [{ start: exportStart, end: exportEnd }];
		const blur = shortExportBlurSegments[0]?.blur ?? 0;
		await traceExportStep('start_export_normal', {
			blur
		});
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

	function createBlurAwareRenderSegments(baseRanges: TimeRange[]): BlurSegment[] {
		const renderSegments: BlurSegment[] = [];
		for (const range of baseRanges) {
			renderSegments.push(...getBlurSegmentsForRange(range.start, range.end));
		}
		return renderSegments;
	}

	async function handleSegmentedExport(renderSegments: BlurSegment[], totalDuration: number) {
		if (renderSegments.length === 0) return;
		await traceExportStep('handle_segmented_export_start', {
			renderSegmentCount: renderSegments.length,
			totalDuration
		});
		activeVideoSegments = renderSegments.map((segment) => ({
			start: segment.start,
			end: segment.end
		}));

		const generatedVideoFiles: string[] = [];
		for (let segmentIndex = 0; segmentIndex < renderSegments.length; segmentIndex++) {
			const segment = renderSegments[segmentIndex];
			const segmentImageFolder = `segment_${segmentIndex}`;
			await traceExportStep('handle_segmented_export_generate_images_for_segment_start', {
				segmentIndex,
				segmentStart: segment.start,
				segmentEnd: segment.end,
				blur: segment.blur
			});

			await createChunkImageFolder(segmentImageFolder);
			await generateImagesForChunk(
				segmentIndex,
				segment.start,
				segment.end,
				segmentImageFolder,
				renderSegments.length,
				0,
				100
			);
			await traceExportStep('handle_segmented_export_generate_images_for_segment_done', {
				segmentIndex
			});
		}

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
			await traceExportStep('handle_segmented_export_generate_video_for_segment_start', {
				segmentIndex,
				segmentDuration
			});

			const segmentVideoPath = await generateVideoForChunk(
				segmentIndex,
				segmentImageFolder,
				segment.start,
				segmentDuration,
				segment.blur
			);

			generatedVideoFiles.push(segmentVideoPath);
			await traceExportStep('handle_segmented_export_generate_video_for_segment_done', {
				segmentIndex,
				segmentVideoPath
			});
		}

		await traceExportStep('handle_segmented_export_concatenate_start', {
			videoFileCount: generatedVideoFiles.length
		});
		await concatenateVideos(generatedVideoFiles);
		await traceExportStep('handle_segmented_export_concatenate_done');
		await finalCleanup();

		emitProgress({
			exportId: Number(exportId),
			progress: 100,
			currentState: ExportState.Exported,
			currentTime: totalDuration,
			totalTime: totalDuration
		} as ExportProgress);
	}

	async function _handleChunkedExport(
		exportStart: number,
		exportEnd: number,
		totalDuration: number
	) {
		// Calculer les chunks en s'arrêtant au prochain fade-out après 10 minutes
		const chunkInfo = calculateChunksWithFadeOut(exportStart, exportEnd);
		const generatedVideoFiles: string[] = [];

		console.log(`Splitting into ${chunkInfo.chunks.length} chunks`);
		chunkInfo.chunks.forEach((chunk, i) => {
			console.log(`Chunk ${i + 1}: ${chunk.start} -> ${chunk.end} (${chunk.end - chunk.start}ms)`);
		});
		// PHASE 1: Generation de TOUS les screenshots (0 a 100% du progres total)
		console.log('=== PHASE 1: Génération de tous les screenshots ===');
		for (let chunkIndex = 0; chunkIndex < chunkInfo.chunks.length; chunkIndex++) {
			const chunk = chunkInfo.chunks[chunkIndex];
			const chunkImageFolder = `chunk_${chunkIndex}`;

			// Créer le dossier d'images pour ce chunk
			await createChunkImageFolder(chunkImageFolder);

			// Générer les images pour ce chunk
			await generateImagesForChunk(
				chunkIndex,
				chunk.start,
				chunk.end,
				chunkImageFolder,
				chunkInfo.chunks.length,
				0, // phase start (0%)
				100 // phase end (100%)
			);
		}

		// PHASE 2: Génération de TOUTES les vidéos
		console.log('=== PHASE 2: Génération de toutes les vidéos ===');

		// Initialiser l'état avant l'export vidéo
		emitProgress({
			exportId: Number(exportId),
			progress: 0,
			currentState: ExportState.Initializing,
			currentTime: 0,
			totalTime: totalDuration
		} as ExportProgress);

		let chunkFolders = [];

		for (let chunkIndex = 0; chunkIndex < chunkInfo.chunks.length; chunkIndex++) {
			const chunk = chunkInfo.chunks[chunkIndex];
			const chunkImageFolder = `chunk_${chunkIndex}`;
			chunkFolders.push(chunkImageFolder);
			const chunkActualDuration = chunk.end - chunk.start;

			// Générer la vidéo pour ce chunk
			const chunkVideoPath = await generateVideoForChunk(
				chunkIndex,
				chunkImageFolder,
				chunk.start,
				chunkActualDuration
			);

			generatedVideoFiles.push(chunkVideoPath);
		}

		// PHASE 3: Concaténation
		console.log('=== PHASE 3: Concaténation des vidéos ===');

		// Combiner toutes les vidéos en une seule
		console.log('Concatenating all chunk videos:', generatedVideoFiles);

		await concatenateVideos(generatedVideoFiles);

		// Nettoyage final
		await finalCleanup();

		emitProgress({
			exportId: Number(exportId),
			progress: 100,
			currentState: ExportState.Exported,
			currentTime: totalDuration,
			totalTime: totalDuration
		} as ExportProgress);
	}

	async function createChunkImageFolder(chunkImageFolder: string) {
		const chunkPath = await join(ExportService.exportFolder, exportId, chunkImageFolder);
		await mkdir(chunkPath, {
			baseDir: BaseDirectory.AppData,
			recursive: true
		});
		console.log(`Created chunk folder: ${chunkPath}`);
		await traceExportStep('create_chunk_image_folder_done', {
			chunkImageFolder,
			chunkPath
		});
	}

	async function generateImagesForChunk(
		chunkIndex: number,
		chunkStart: number,
		chunkEnd: number,
		chunkImageFolder: string,
		totalChunks: number,
		phaseStartProgress: number = 0,
		phaseEndProgress: number = 100
	) {
		await traceExportStep('generate_images_for_chunk_start', {
			chunkIndex,
			chunkStart,
			chunkEnd,
			chunkImageFolder,
			totalChunks
		});
		const fadeDuration = Math.round(
			globalState.getStyle('global', 'fade-duration')!.value as number
		);

		// Calculer les timings pour ce chunk spécifique
		const chunkTimings = calculateTimingsForRange(chunkStart, chunkEnd);

		console.log(`Chunk ${chunkIndex}: ${chunkTimings.uniqueSorted.length} screenshots to take`);

		let i = 0;
		let base = -fadeDuration; // Pour compenser le fade-in du début

		for (const timing of chunkTimings.uniqueSorted) {
			// Calculer l'index de l'image dans ce chunk (recommence a 0)
			const imageIndex = Math.max(Math.round(timing - chunkStart + base), 0);

			// Vérifie si ce timing doit être dupliqué depuis un autre
			const sourceTimingForDuplication = Array.from(chunkTimings.duplicableTimings.entries()).find(
				([target]) => target === timing // target = timing qui doit être dupliqué
			)?.[1];
			await traceExportStep('generate_images_for_chunk_iteration_start', {
				chunkIndex,
				timing,
				imageIndex,
				sourceTimingForDuplication: sourceTimingForDuplication ?? null
			});

			// Si c'est dupliquable
			if (sourceTimingForDuplication !== undefined) {
				// Ce timing peut être dupliqué depuis sourceTimingForDuplication
				const sourceIndex = Math.max(
					Math.round(sourceTimingForDuplication - chunkStart - fadeDuration),
					0
				);
				// Prend que un seul screenshot et le duplique
				await duplicateScreenshot(`${sourceIndex}`, imageIndex, chunkImageFolder, {
					chunkIndex,
					timing,
					imageIndex
				});
				await traceExportStep('generate_images_for_chunk_iteration_duplicate', {
					chunkIndex,
					timing,
					imageIndex,
					sourceIndex,
					duplicateType: 'frame'
				});
			} else if (
				hasTiming(chunkTimings.blankImgs, timing).hasIt &&
				hasBlankImg(
					chunkTimings.imgWithNothingShown,
					hasTiming(chunkTimings.blankImgs, timing).surah!
				)
			) {
				// Récupérer le numéro de sourate pour ce timing
				const surahInfo = hasTiming(chunkTimings.blankImgs, timing);
				console.log(`Duplicating blank image for surah ${surahInfo.surah} at timing ${timing}`);

				await duplicateScreenshot(`blank_${surahInfo.surah}`, imageIndex, chunkImageFolder, {
					chunkIndex,
					timing,
					imageIndex
				});
				await traceExportStep('generate_images_for_chunk_iteration_duplicate', {
					chunkIndex,
					timing,
					imageIndex,
					duplicateType: 'blank',
					surah: surahInfo.surah
				});
				console.log('Duplicating screenshot instead of taking new one at', timing);
			} else {
				// Important: le +1 sinon le svg de la sourate est le mauvais
				globalState.getTimelineState.movePreviewTo = timing;
				globalState.getTimelineState.cursorPosition = timing;

				// si la difference entre timing et celui juste avant est grand, attendre un peu plus
				await wait(timing);

				await takeScreenshot({
					fileName: `${imageIndex}`,
					subfolder: chunkImageFolder,
					chunkIndex,
					timing,
					imageIndex
				});
				await traceExportStep('generate_images_for_chunk_iteration_capture_done', {
					chunkIndex,
					timing,
					imageIndex
				});

				// Verifier si ce timing correspond a une image blank de reference pour une sourate
				for (const [surahStr, blankTiming] of Object.entries(chunkTimings.imgWithNothingShown)) {
					if (timing === blankTiming) {
						// monte de 1 le timing pour avoir le svg correct
						globalState.getTimelineState.movePreviewTo = timing - 1;
						globalState.getTimelineState.cursorPosition = timing - 1;
						await wait(timing - 1);
						const surahNum = Number(surahStr);
						console.log(`Creating blank image for surah ${surahNum} at timing ${timing}`);
						await takeScreenshot({
							fileName: `blank_${surahNum}`,
							chunkIndex,
							timing,
							imageIndex: `blank_${surahNum}`
						});
						await traceExportStep('generate_images_for_chunk_blank_capture_done', {
							chunkIndex,
							timing,
							surahNum
						});
						console.log(`Blank image created for surah ${surahNum} at timing ${timing}`);
						break; // Une seule sourate par timing
					}
				}

				console.log(
					`Chunk ${chunkIndex}: Screenshot taken at timing ${timing} -> image ${imageIndex}`
				);
			}

			base += fadeDuration;
			i++;

			// Toutes les 20 captures, laisser respirer le GC pour éviter l'OOM
			if (i % 20 === 0) {
				await new Promise((resolve) => setTimeout(resolve, 50));
			}

			// Progress pour ce chunk dans la phase spécifiée
			const chunkImageProgress = (i / chunkTimings.uniqueSorted.length) * 100;
			const chunkPhaseProgress = (chunkIndex * 100 + chunkImageProgress) / totalChunks;
			const globalProgress =
				phaseStartProgress + (chunkPhaseProgress * (phaseEndProgress - phaseStartProgress)) / 100;

			emitProgress({
				exportId: Number(exportId),
				progress: globalProgress,
				currentState: ExportState.CapturingFrames,
				currentTime: timing - exportData!.videoStartTime,
				totalTime: exportData!.videoEndTime - exportData!.videoStartTime
			} as ExportProgress);
		}
		await traceExportStep('generate_images_for_chunk_done', {
			chunkIndex,
			totalCapturedFrames: chunkTimings.uniqueSorted.length
		});
	}

	async function generateVideoForChunk(
		chunkIndex: number,
		chunkImageFolder: string,
		chunkStart: number,
		chunkDuration: number,
		blur: number = globalState.getStyle('global', 'overlay-blur')!.value as number
	): Promise<string> {
		await traceExportStep('generate_video_for_chunk_start', {
			chunkIndex,
			chunkImageFolder,
			chunkStart,
			chunkDuration,
			blur
		});
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

		const chunkVideoFileName = `chunk_${chunkIndex}_video.mp4`;
		const chunkFinalFilePath = await join(
			await appDataDir(),
			ExportService.exportFolder,
			exportId,
			chunkVideoFileName
		);

		console.log(`Generating video for chunk ${chunkIndex}: ${chunkFinalFilePath}`);

		try {
			await invoke('export_video', {
				exportId: exportId,
				imgsFolder: await join(
					await appDataDir(),
					ExportService.exportFolder,
					exportId,
					chunkImageFolder
				),
				finalFilePath: chunkFinalFilePath,
				fps: exportData!.fps,
				fadeDuration: fadeDuration,
				startTime: Math.round(chunkStart), // Le startTime pour l'audio/vidéo de fond
				duration: Math.round(chunkDuration),
				audios: audios,
				videos: videos,
				chunkIndex: chunkIndex,
				blur: blur,
				performanceProfile: globalState.getExportState.performanceProfile
			});

			console.log(`[OK] Chunk ${chunkIndex} video generated successfully`);
			await traceExportStep('generate_video_for_chunk_done', {
				chunkIndex,
				chunkFinalFilePath
			});
			return chunkFinalFilePath;
		} catch (e: unknown) {
			console.error(`[ERROR] Error generating chunk ${chunkIndex} video:`, e);
			await traceExportStep('generate_video_for_chunk_failed', {
				chunkIndex,
				error: stringifyError(e)
			});
			throw e;
		}
	}

	async function concatenateVideos(videoFilePaths: string[]) {
		console.log('Starting video concatenation...');
		await traceExportStep('concatenate_videos_start', {
			videoFileCount: videoFilePaths.length,
			videoFilePaths
		});

		try {
			const finalVideoPath = await invoke('concat_videos', {
				videoPaths: videoFilePaths,
				outputPath: exportData!.finalFilePath,
				performanceProfile: globalState.getExportState.performanceProfile
			});

			console.log('[OK] Videos concatenated successfully:', finalVideoPath);

			// Supprimer les vidéos de chunks individuelles
			for (const videoPath of videoFilePaths) {
				try {
					await remove(videoPath, { baseDir: BaseDirectory.AppData });
					console.log(`Deleted chunk video: ${videoPath}`);
				} catch (e) {
					console.warn(`Could not delete chunk video ${videoPath}:`, e);
				}
			}
			await traceExportStep('concatenate_videos_done', {
				videoFileCount: videoFilePaths.length
			});
		} catch (e: unknown) {
			console.error('[ERROR] Error concatenating videos:', e);
			await traceExportStep('concatenate_videos_failed', {
				error: stringifyError(e)
			});
			throw e;
		}
	}

	function hasTiming(
		blankImgs: { [surah: number]: number[] },
		t: number
	): {
		hasIt: boolean;
		surah: number | null;
	} {
		for (const [surahNumb, _timings] of Object.entries(blankImgs)) {
			if (_timings.includes(t)) return { hasIt: true, surah: Number(surahNumb) };
		}
		return { hasIt: false, surah: null };
	}

	function hasBlankImg(imgWithNothingShown: { [surah: number]: number }, surah: number): boolean {
		return imgWithNothingShown[surah] !== undefined;
	}

	async function handleNormalExport(
		exportStart: number,
		exportEnd: number,
		totalDuration: number,
		blur: number
	) {
		await traceExportStep('handle_normal_export_start', {
			exportStart,
			exportEnd,
			totalDuration,
			blur
		});
		const fadeDuration = Math.round(
			globalState.getStyle('global', 'fade-duration')!.value as number
		);

		// Calculer tous les timings nécessaires
		const timings = calculateTimingsForRange(exportStart, exportEnd);

		console.log('Normal export - Timings détectés:', timings.uniqueSorted);
		console.log(
			'Image(s) a dupliquer (blank):',
			timings.blankImgs,
			'Image choisie:',
			timings.imgWithNothingShown
		);

		let i = 0;
		let base = -fadeDuration;

		for (const timing of timings.uniqueSorted) {
			const imageIndex = Math.max(Math.round(timing - exportStart + base), 0);

			// Vérifier si ce timing peut être dupliqué depuis un autre
			const sourceTimingForDuplication = Array.from(timings.duplicableTimings.entries()).find(
				([target]) => target === timing
			)?.[1];
			await traceExportStep('handle_normal_export_iteration_start', {
				timing,
				imageIndex,
				sourceTimingForDuplication: sourceTimingForDuplication ?? null
			});

			if (sourceTimingForDuplication !== undefined) {
				// Ce timing peut être dupliqué depuis sourceTimingForDuplication
				const sourceIndex = Math.max(
					Math.round(sourceTimingForDuplication - exportStart - fadeDuration),
					0
				);
				await duplicateScreenshot(`${sourceIndex}`, imageIndex, null, {
					timing,
					imageIndex
				});
				await traceExportStep('handle_normal_export_iteration_duplicate', {
					timing,
					imageIndex,
					sourceIndex,
					duplicateType: 'frame'
				});
				console.log(
					`Optimisation - Duplicating screenshot from timing ${sourceTimingForDuplication} (image ${sourceIndex}) to timing ${timing} (image ${imageIndex})`
				);
			} else if (
				hasTiming(timings.blankImgs, timing).hasIt &&
				hasBlankImg(timings.imgWithNothingShown, hasTiming(timings.blankImgs, timing).surah ?? -1)
			) {
				// Récupérer le numéro de sourate pour ce timing
				const surahInfo = hasTiming(timings.blankImgs, timing);
				console.log(`Duplicating blank image for surah ${surahInfo.surah} at timing ${timing}`);

				await duplicateScreenshot(`blank_${surahInfo.surah}`, imageIndex, null, {
					timing,
					imageIndex
				});
				await traceExportStep('handle_normal_export_iteration_duplicate', {
					timing,
					imageIndex,
					duplicateType: 'blank',
					surah: surahInfo.surah
				});
				console.log('Duplicating screenshot instead of taking new one at', timing);
			} else {
				// Important: le +1 sinon le svg de la sourate est le mauvais
				globalState.getTimelineState.movePreviewTo = timing + 1;
				globalState.getTimelineState.cursorPosition = timing + 1;

				await wait(timing + 1);

				await takeScreenshot({
					fileName: `${imageIndex}`,
					timing,
					imageIndex
				});
				await traceExportStep('handle_normal_export_iteration_capture_done', {
					timing,
					imageIndex
				});

				// Verifier si ce timing correspond a une image blank de reference pour une sourate
				for (const [surahStr, blankTiming] of Object.entries(timings.imgWithNothingShown)) {
					if (timing === blankTiming) {
						const surahNum = Number(surahStr);
						console.log(`Creating blank image for surah ${surahNum} at timing ${timing}`);
						await takeScreenshot({
							fileName: `blank_${surahNum}`,
							timing,
							imageIndex: `blank_${surahNum}`
						});
						await traceExportStep('handle_normal_export_blank_capture_done', {
							timing,
							surahNum
						});
						console.log(`Blank image created for surah ${surahNum} at timing ${timing}`);
						break; // Une seule sourate par timing
					}
				}

				console.log(`Normal export: Screenshot taken at timing ${timing} -> image ${imageIndex}`);
			}

			base += fadeDuration;
			i++;

			// Toutes les 20 captures, laisser respirer le GC pour éviter l'OOM
			if (i % 20 === 0) {
				await new Promise((resolve) => setTimeout(resolve, 50));
			}

			emitProgress({
				exportId: Number(exportId),
				progress: (i / timings.uniqueSorted.length) * 100,
				currentState: ExportState.CapturingFrames,
				currentTime: timing - exportStart,
				totalTime: totalDuration
			} as ExportProgress);
		}

		await deleteBlankImages();
		await traceExportStep('handle_normal_export_blank_images_deleted');

		// Générer la vidéo normale
		await generateNormalVideo(exportStart, totalDuration, blur);
		await traceExportStep('handle_normal_export_video_generated');

		// Nettoyage
		await finalCleanup();
		await traceExportStep('handle_normal_export_done');
	}

	/**
	 * Analyser l'etat des custom clips a un moment donne
	 * Retourne un identifiant unique basé sur quels custom clips sont visibles
	 */
	function getCustomClipStateAt(timing: number): string {
		const visibleCustomClips: string[] = [];

		for (const ctClip of globalState.getCustomClipTrack?.clips || []) {
			const category = (ctClip as CustomTextClip).category;
			if (!category) continue;

			const alwaysShow = (category.getStyle('always-show')?.value as number) || 0;
			// Ignorer les custom texts always visible comme demandé
			if (alwaysShow) continue;

			const startTime = category.getStyle('time-appearance')?.value as number;
			const endTime = category.getStyle('time-disappearance')?.value as number;
			if (startTime == null || endTime == null) continue;

			// Vérifier si ce custom text est visible au timing donné (inclusive des bornes)
			if (timing >= startTime && timing <= endTime) {
				// Créer une clé unique basée sur l'ID du clip et ses propriétés temporelles
				const uniqueKey = `${ctClip.id}-${startTime}-${endTime}`;
				visibleCustomClips.push(uniqueKey);
			}
		}

		// Retourner un hash des custom texts visibles, triés pour la cohérence
		const stateSignature = visibleCustomClips.sort().join('|');
		return stateSignature;
	}

	function calculateTimingsForRange(rangeStart: number, rangeEnd: number) {
		const fadeDuration = Math.round(
			globalState.getStyle('global', 'fade-duration')!.value as number
		);

		let timingsToTakeScreenshots: number[] = [rangeStart, rangeEnd];
		let imgWithNothingShown: { [surah: number]: number } = {}; // Timing où rien n'est affiché (pour dupliquer)
		let blankImgs: {
			[surah: number]: number[];
		} = {};
		// Map pour stocker les timings qui peuvent être dupliqués
		let duplicableTimings: Map<number, number> = new Map(); // source -> target

		function add(t: number | undefined) {
			if (t === undefined) return;
			if (t < rangeStart || t > rangeEnd) return;
			timingsToTakeScreenshots.push(Math.round(t));
		}

		// --- Sous-titres ---
		for (const clip of globalState.getSubtitleTrack.clips) {
			const clipBounds = clip as { startTime?: number; endTime?: number };
			const { startTime, endTime } = clipBounds;
			if (startTime == null || endTime == null) continue;
			if (endTime < rangeStart || startTime > rangeEnd) continue;
			const duration = endTime - startTime;
			if (duration <= 0) continue;

			if (!(clip instanceof SilenceClip)) {
				console.log('Processing subtitle clip:', clip);
				const fadeInEnd = Math.min(startTime + fadeDuration, endTime);
				const fadeOutStart = endTime - fadeDuration;

				// Vérifier si on peut optimiser les captures pour ce sous-titre
				// L'idée : si les custom clips visibles sont identiques entre fadeInEnd et fadeOutStart,
				// on peut prendre une seule capture et la dupliquer, économisant du temps
				if (fadeOutStart > startTime && fadeInEnd !== fadeOutStart) {
					// Récupère les customs clips visibles aux deux timings pour voir si possibilité de duplication
					const customClipStateAtFadeInEnd = getCustomClipStateAt(fadeInEnd);
					const customClipStateAtFadeOutStart = getCustomClipStateAt(fadeOutStart);

					// Si l'état des custom clips est identique, on peut dupliquer
					if (customClipStateAtFadeInEnd === customClipStateAtFadeOutStart) {
						add(fadeInEnd);
						// Ajoute a la map de duplication
						duplicableTimings.set(Math.round(fadeOutStart), Math.round(fadeInEnd));
					} else {
						// Etats differents, prendre les deux captures
						add(fadeInEnd);
						add(fadeOutStart);
					}
				} else {
					add(fadeInEnd);
					if (fadeOutStart > startTime) add(fadeOutStart);
				}

				add(endTime);
			} else {
				console.log('Silence clip detected, skipping fade-in/out timings.');

				if (
					imgWithNothingShown[globalState.getSubtitleTrack.getCurrentSurah(clip.startTime)] ===
					undefined
				) {
					add(endTime);
				} else {
					if (!blankImgs[globalState.getSubtitleTrack.getCurrentSurah(clip.startTime)])
						blankImgs[globalState.getSubtitleTrack.getCurrentSurah(clip.startTime)] = [];

					blankImgs[globalState.getSubtitleTrack.getCurrentSurah(clip.startTime)].push(
						Math.round(endTime)
					);
				}
			}

			if (
				!globalState.getCustomClipTrack?.clips.find((ctClip) => {
					const clip = ctClip as CustomTextClip;
					const alwaysShow = clip.category!.getStyle('always-show')!.value as boolean;

					if (alwaysShow) {
						return false;
					}

					return clip.startTime! <= endTime && clip.endTime! >= endTime;
				})
			) {
				if (
					imgWithNothingShown[globalState.getSubtitleTrack.getCurrentSurah(clip.startTime)] ===
					undefined
				) {
					console.log(
						'Ajout de limage blank pour sourate ',
						globalState.getSubtitleTrack.getCurrentSurah(clip.startTime),
						' au timing ',
						Math.round(endTime)
					);

					imgWithNothingShown[globalState.getSubtitleTrack.getCurrentSurah(clip.startTime)] =
						Math.round(endTime);
				} else {
					if (!blankImgs[globalState.getSubtitleTrack.getCurrentSurah(clip.startTime)])
						blankImgs[globalState.getSubtitleTrack.getCurrentSurah(clip.startTime)] = [];

					blankImgs[globalState.getSubtitleTrack.getCurrentSurah(clip.startTime)].push(
						Math.round(endTime)
					);
				}
			}
		}

		// --- Custom Texts ---
		for (const ctClip of globalState.getCustomClipTrack?.clips || []) {
			const category = (ctClip as CustomTextClip).category;
			if (!category) continue;
			const alwaysShow = (category.getStyle('always-show')?.value as number) || 0;
			const startTime = category.getStyle('time-appearance')?.value as number;
			const endTime = category.getStyle('time-disappearance')?.value as number;
			if (startTime == null || endTime == null) continue;
			if (endTime < rangeStart || startTime > rangeEnd) continue;
			const duration = endTime - startTime;
			if (duration <= 0) continue;

			if (alwaysShow) {
				add(startTime);
				add(endTime);
				continue;
			}

			const ctFadeInEnd = Math.min(startTime + fadeDuration, endTime);
			add(ctFadeInEnd);

			const ctFadeOutStart = endTime - fadeDuration;
			if (ctFadeOutStart > startTime) add(ctFadeOutStart);

			add(endTime);
		}

		const uniqueSorted = Array.from(new Set(timingsToTakeScreenshots))
			.filter((t) => t >= rangeStart && t <= rangeEnd)
			.sort((a, b) => a - b);

		console.log(imgWithNothingShown, blankImgs);

		return { uniqueSorted, imgWithNothingShown, blankImgs, duplicableTimings };
	}

	async function generateNormalVideo(exportStart: number, duration: number, blur: number) {
		await traceExportStep('generate_normal_video_start', {
			exportStart,
			duration,
			blur
		});
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
		await traceExportStep('generate_normal_video_blank_images_deleted');

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
				performanceProfile: globalState.getExportState.performanceProfile
			});
			await traceExportStep('generate_normal_video_invoke_done');
		} catch (e: unknown) {
			await traceExportStep('generate_normal_video_failed', {
				error: stringifyError(e)
			});
			throw e;
		}
	}

	async function finalCleanup() {
		if (isCleaningUp) return;
		isCleaningUp = true;
		await traceExportStep('final_cleanup_start');

		try {
			// Supprime le dossier temporaire des images
			await remove(await join(ExportService.exportFolder, exportId), {
				baseDir: BaseDirectory.AppData,
				recursive: true
			});

			console.log('Temporary images folder removed.');
			await traceExportStep('final_cleanup_temp_folder_removed');
		} catch (e) {
			console.warn('Could not remove temporary folder:', e);
			await traceExportStep('final_cleanup_temp_folder_remove_failed', {
				error: stringifyError(e)
			});
		}

		// Ferme la fenêtre d'export
		try {
			await flushProjectExportLogs();
			await getCurrentWebviewWindow().close();
		} catch (error) {
			console.warn('Could not close export window:', error);
			await traceExportStep('final_cleanup_window_close_failed', {
				error: stringifyError(error)
			});
		}
	}

	async function takeScreenshot(metadata: ScreenshotCaptureMetadata) {
		const { fileName, subfolder = null } = metadata;
		await traceExportStep('take_screenshot_called', {
			fileName,
			subfolder,
			chunkIndex: metadata.chunkIndex ?? null,
			timing: metadata.timing ?? null,
			imageIndex: metadata.imageIndex ?? metadata.fileName
		});
		const node = document.getElementById('overlay');
		if (!node) {
			await traceExportStep('take_screenshot_overlay_missing', {
				fileName
			});
			throw new ScreenshotCaptureError(metadata, {
				stage: 'createContext',
				attempt: 1,
				timeoutMs: getCaptureAttemptTimeoutMs(capturePlatform, 1),
				usedDataUrlFallback: false,
				message: 'Overlay element not found.'
			});
		}

		// En sachant que node.clientWidth = 1920 et node.clientHeight = 1080,
		// je veux pouvoir avoir la dimension trouvée dans les paramètres d'export
		const targetWidth = exportData!.videoDimensions.width;
		const targetHeight = exportData!.videoDimensions.height;

		// Calcul du scale
		const scaleX = targetWidth / node.clientWidth;
		const scaleY = targetHeight / node.clientHeight;
		const scale = Math.min(scaleX, scaleY);
		await traceExportStep('take_screenshot_dimensions_ready', {
			fileName,
			targetWidth,
			targetHeight,
			nodeWidth: node.clientWidth,
			nodeHeight: node.clientHeight,
			scale
		});
		let previousFailureStage: ScreenshotCaptureStage | null = null;

		for (let attempt = 1; attempt <= EXPORT_CAPTURE_MAX_ATTEMPTS; attempt++) {
			let canvas: HTMLCanvasElement | null = null;
			let context: Awaited<
				ReturnType<typeof createContext<typeof node extends HTMLElement ? HTMLElement : Node>>
			> | null = null;
			const timeoutMs = getCaptureAttemptTimeoutMs(capturePlatform, attempt);
			const useDataUrlFallback = shouldUseDataUrlFallback(
				capturePlatform,
				attempt,
				previousFailureStage
			);
			let stage: ScreenshotCaptureStage = 'createContext';
			await traceExportStep('take_screenshot_attempt_start', {
				fileName,
				attempt,
				timeoutMs,
				useDataUrlFallback,
				previousFailureStage
			});

			try {
				await traceExportStep('take_screenshot_create_context_start', {
					fileName,
					attempt
				});
				context = await withTimeout(
					createContext(node, {
						width: node.clientWidth * scale,
						height: node.clientHeight * scale,
						style: {
							// Garder la logique historique de mise a l'echelle pour preserver le centrage.
							transform: 'scale(' + scale + ')',
							transformOrigin: 'top left'
						},
						quality: 1,
						autoDestruct: false
					}),
					timeoutMs,
					`Screenshot context creation for ${fileName}`
				);
				await traceExportStep('take_screenshot_create_context_done', {
					fileName,
					attempt
				});

				stage = 'domToCanvas';
				await traceExportStep('take_screenshot_dom_to_canvas_start', {
					fileName,
					attempt
				});
				canvas = await withTimeout(
					domToCanvas(context),
					timeoutMs,
					`Screenshot rendering for ${fileName}`
				);
				await traceExportStep('take_screenshot_dom_to_canvas_done', {
					fileName,
					attempt,
					canvasWidth: canvas.width,
					canvasHeight: canvas.height
				});

				stage = 'encode';
				await traceExportStep('take_screenshot_encode_start', {
					fileName,
					attempt,
					useDataUrlFallback
				});
				const bytes = useDataUrlFallback
					? await encodeCanvasToPngBytesViaDataUrl(canvas, timeoutMs, fileName)
					: await encodeCanvasToPngBytesViaBlob(canvas, timeoutMs, fileName);
				await traceExportStep('take_screenshot_encode_done', {
					fileName,
					attempt,
					byteLength: bytes.length,
					useDataUrlFallback
				});

				stage = 'writeFile';
				const pathComponents = [ExportService.exportFolder, exportId];
				if (subfolder) pathComponents.push(subfolder);
				pathComponents.push(fileName + '.png');

				const filePathWithName = await join(...pathComponents);

				await traceExportStep('take_screenshot_write_start', {
					fileName,
					attempt,
					filePathWithName
				});
				await withTimeout(
					writeFile(filePathWithName, bytes, { baseDir: BaseDirectory.AppData }),
					timeoutMs,
					`Screenshot write for ${fileName}`
				);
				await traceExportStep('take_screenshot_write_done', {
					fileName,
					attempt,
					filePathWithName
				});

				console.log(
					`Screenshot saved to: ${filePathWithName} (attempt ${attempt}, platform=${capturePlatform}, fallback=${useDataUrlFallback})`
				);
				await traceExportStep('take_screenshot_attempt_success', {
					fileName,
					attempt
				});
				return;
			} catch (error: unknown) {
				const message = stringifyError(error);
				previousFailureStage = stage;
				await appendProjectExportLog('screenshot_capture_attempt_failed', {
					fileName,
					chunkIndex: metadata.chunkIndex ?? null,
					timing: metadata.timing ?? null,
					imageIndex: metadata.imageIndex ?? metadata.fileName,
					stage,
					attempt,
					timeoutMs,
					platform: capturePlatform,
					usedDataUrlFallback: useDataUrlFallback,
					message
				});
				console.warn(
					`Screenshot capture attempt ${attempt}/${EXPORT_CAPTURE_MAX_ATTEMPTS} failed for ${fileName} at stage ${stage} on ${capturePlatform}: ${message}`
				);

				if (!shouldRetryCapture(attempt)) {
					throw new ScreenshotCaptureError(metadata, {
						stage,
						attempt,
						timeoutMs,
						usedDataUrlFallback: useDataUrlFallback,
						message
					});
				}

				await traceExportStep('take_screenshot_retry_pause_start', {
					fileName,
					attempt
				});
				await waitForRetryPause();
				await traceExportStep('take_screenshot_retry_pause_done', {
					fileName,
					attempt
				});
			} finally {
				if (context) {
					destroyContext(context);
				}
				if (canvas) {
					canvas.width = 0;
					canvas.height = 0;
				}
				canvas = null;
				context = null;
				await traceExportStep('take_screenshot_attempt_cleanup_done', {
					fileName,
					attempt
				});
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
		subfolder: string | null = null,
		metadata: Omit<ScreenshotCaptureMetadata, 'fileName' | 'subfolder'> | null = null
	) {
		await traceExportStep('duplicate_screenshot_start', {
			sourceFileName: String(sourceFileName),
			targetFileName,
			subfolder,
			chunkIndex: metadata?.chunkIndex ?? null,
			timing: metadata?.timing ?? null,
			imageIndex: metadata?.imageIndex ?? targetFileName
		});
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
			await traceExportStep('duplicate_screenshot_copy_file_done', {
				sourceFilePathWithName,
				targetFilePathWithName
			});
		} catch {
			await traceExportStep('duplicate_screenshot_copy_file_failed_fallback', {
				sourceFilePathWithName,
				targetFilePathWithName
			});
			// Fallback: lire et écrire si la commande Rust n'existe pas
			if (!(await exists(sourceFilePathWithName, { baseDir: BaseDirectory.AppData }))) {
				await traceExportStep('duplicate_screenshot_source_missing', {
					sourceFilePathWithName,
					targetFilePathWithName
				});
				throw new ScreenshotCaptureError(
					{
						fileName: String(targetFileName),
						subfolder,
						chunkIndex: metadata?.chunkIndex,
						timing: metadata?.timing,
						imageIndex: metadata?.imageIndex ?? targetFileName
					},
					{
						stage: 'writeFile',
						attempt: 1,
						timeoutMs: getCaptureAttemptTimeoutMs(capturePlatform, 1),
						usedDataUrlFallback: false,
						message: `Source screenshot does not exist: ${sourceFilePathWithName}`
					}
				);
			}
			const data = await readFile(sourceFilePathWithName, { baseDir: BaseDirectory.AppData });
			await writeFile(targetFilePathWithName, data, { baseDir: BaseDirectory.AppData });
			console.log('Duplicate screenshot saved to (fallback):', targetFilePathWithName);
			await traceExportStep('duplicate_screenshot_fallback_done', {
				sourceFilePathWithName,
				targetFilePathWithName,
				byteLength: data.length
			});
		}
	}

	/**
	 * Supprime toutes les images blanks (blank_xxx.png) du dossier spécifié
	 * @param subfolder Le sous-dossier où supprimer les images blanks (optionnel)
	 */
	async function deleteBlankImages() {
		await traceExportStep('delete_blank_images_start');
		try {
			// Construire le chemin du dossier
			const pathComponents = [ExportService.exportFolder, exportId];

			// Parcourir tous les fichiers pour trouver les images blank_
			// On utilise une approche simple en testant les numeros de sourate de 1 a 114
			for (let surahNum = 1; surahNum <= 114; surahNum++) {
				const blankFileName = `blank_${surahNum}.png`;
				const blankFilePath = await join(...pathComponents, blankFileName);

				// Vérifier si le fichier existe et le supprimer
				if (await exists(blankFilePath, { baseDir: BaseDirectory.AppData })) {
					await remove(blankFilePath, { baseDir: BaseDirectory.AppData });
					console.log(`Deleted blank image: ${blankFileName}`);
					await traceExportStep('delete_blank_image_removed', {
						blankFileName
					});
				}
			}
		} catch (error) {
			console.warn('Error deleting blank images:', error);
			await traceExportStep('delete_blank_images_failed', {
				error: stringifyError(error)
			});
		}
	}

	function calculateChunksWithFadeOut(exportStart: number, exportEnd: number) {
		// Collecter tous les moments de fin de fade-out
		const fadeOutEndTimes: number[] = [];

		// --- Sous-titres ---
		for (const clip of globalState.getSubtitleTrack.clips) {
			const clipBounds = clip as { startTime?: number; endTime?: number };
			const { startTime, endTime } = clipBounds;
			if (startTime == null || endTime == null) continue;
			if (endTime < exportStart || startTime > exportEnd) continue;

			if (!(clip instanceof SilenceClip)) {
				// Fin de fade-out = endTime (moment où le fade-out se termine)
				fadeOutEndTimes.push(endTime);
			}
		}

		// --- Custom Texts ---
		for (const ctClip of globalState.getCustomClipTrack?.clips || []) {
			const category = (ctClip as CustomTextClip).category;
			if (!category) continue;
			const alwaysShow = (category.getStyle('always-show')?.value as number) || 0;
			const startTime = category.getStyle('time-appearance')?.value as number;
			const endTime = category.getStyle('time-disappearance')?.value as number;
			if (startTime == null || endTime == null) continue;
			if (endTime < exportStart || startTime > exportEnd) continue;

			if (!alwaysShow) {
				// Fin de fade-out = endTime
				fadeOutEndTimes.push(endTime);
			}
		}

		// Trier les fins de fade-out et enlever les doublons
		const sortedFadeOutEnds = Array.from(new Set(fadeOutEndTimes))
			.filter((time) => time >= exportStart && time <= exportEnd)
			.sort((a, b) => a - b);

		console.log('Fins de fade-out détectées:', sortedFadeOutEnds);

		// Calculer les chunks
		const chunks: Array<{ start: number; end: number }> = [];
		let currentStart = exportStart;

		while (currentStart < exportEnd) {
			// Calculer la fin idéale du chunk (currentStart + 10 minutes)
			const idealChunkEnd = currentStart + CHUNK_DURATION;

			if (idealChunkEnd >= exportEnd) {
				// Le chunk final
				chunks.push({ start: currentStart, end: exportEnd });
				break;
			}

			// Trouver la prochaine fin de fade-out après idealChunkEnd
			const nextFadeOutEnd = sortedFadeOutEnds.find((time) => time >= idealChunkEnd);

			if (nextFadeOutEnd && nextFadeOutEnd <= exportEnd) {
				// S'arreter a cette fin de fade-out
				chunks.push({ start: currentStart, end: nextFadeOutEnd });
				currentStart = nextFadeOutEnd;
			} else {
				// Pas de fade-out trouve, s'arreter a la fin ideale ou a la fin totale
				const chunkEnd = Math.min(idealChunkEnd, exportEnd);
				chunks.push({ start: currentStart, end: chunkEnd });
				currentStart = chunkEnd;
			}
		}

		return { chunks, fadeOutEndTimes: sortedFadeOutEnds };
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
		await traceExportStep('wait_for_frame_start', {
			timing
		});

		// Attend que l'élément `subtitles-container` est une opacité de 1 (visible) (car il est caché pendant que max-height s'applique)
		let subtitlesContainer: HTMLElement;
		subtitlesContainer = document.getElementById('subtitles-container') as HTMLElement;

		if (!subtitlesContainer) {
			await new Promise((resolve) => setTimeout(resolve, 200));
			await traceExportStep('wait_for_frame_subtitles_container_missing', {
				timing
			});
			return;
		}

		const startTime = Date.now();
		const timeout = 1000; // 1000ms maximum timeout to avoid infinite hang

		do {
			if (Date.now() - startTime > timeout) {
				console.warn(`Timeout waiting for subtitles-container at ${timing}ms, proceeding anyway.`);
				await traceExportStep('wait_for_frame_opacity_timeout', {
					timing,
					timeout
				});
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 10));
		} while (subtitlesContainer.style.opacity !== '1');

		await traceExportStep('wait_for_frame_font_wait_start', {
			timing
		});
		await QPCFontProvider.waitForFontsInElement(subtitlesContainer.querySelector('.arabic'));
		await traceExportStep('wait_for_frame_done', {
			timing
		});
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
