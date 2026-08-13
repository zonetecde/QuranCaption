<script lang="ts">
	import type { AssetClip } from '$lib/classes';
	import Timeline from '$lib/components/projectEditor/timeline/Timeline.svelte';
	import VideoPreview from '$lib/components/projectEditor/videoPreview/VideoPreview.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
	import { emit } from '@tauri-apps/api/event';
	import { onDestroy, onMount } from 'svelte';
	import {
		exists,
		BaseDirectory,
		mkdir,
		writeFile,
		remove,
		readFile,
		readDir,
		stat
	} from '@tauri-apps/plugin-fs';
	import { appDataDir, join } from '@tauri-apps/api/path';
	import ExportService, { type ExportProgress } from '$lib/services/ExportService';
	import {
		buildBlurSegmentsForRange,
		excludeTimeRanges,
		getRecitationRangesForExport,
		type BlurSegment,
		type TimeRange
	} from '$lib/services/OverlayBlurSegmentation';
	import {
		calculateCaptureTimingsForRange,
		getExportWordByWordHighlightTimings as getExportWordByWordHighlightTimingsUtil,
		getExportWordByWordHiddenArabicTimings as getExportWordByWordHiddenArabicTimingsUtil,
		getBlankImageFileName,
		getBlankVisualStateKey,
		hasTiming,
		buildExportCaptureJobPlan,
		type ExportTimedOverlayCaptureClip,
		type ExportSubtitleCaptureClip,
		type ExportSubtitleWbwSourceClip,
		type ExportSubtitleWbwTimingOptions,
		type ExportCaptureTimingResult,
		type ExportFrameCaptureJob,
		type ExportFrameCopyJob,
		type ExportBlankSourceJob
	} from '$lib/services/ExportCaptureTiming';
	import type { ExportFadeSettings } from '$lib/components/projectEditor/tabs/subtitlesEditor/modal/autoSegmentation/types';
	import QPCFontProvider from '$lib/services/FontProvider';
	import SoosiProvider from '$lib/services/SoosiProvider';
	import WarshProvider from '$lib/services/WarshProvider';
	import MinimalQuranProvider from '$lib/services/MinimalQuranProvider';
	import Exportation, { ExportState, type ExportLogLevel } from '$lib/classes/Exportation.svelte';
	import toast from 'svelte-5-french-toast';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
	import {
		createContext,
		destroyContext,
		domToCanvas,
		type Context as ScreenshotContext
	} from 'modern-screenshot';
	import { captureMacOsOverlayPngBytes, shouldRedrawExportTextWithCanvas } from './MacOSExport';
	import {
		ClipWithTranslation,
		CustomClip,
		PredefinedSubtitleClip,
		SilenceClip,
		SubtitleClip
	} from '$lib/classes/Clip.svelte';
	import { VerseTranslation } from '$lib/classes/Translation.svelte';
	import {
		isWordByWordVisualEnabled,
		resolveOverlayVisualState,
		resolveTimedVisualState
	} from '$lib/services/StyleVisualResolver';
	import type { StyleName } from '$lib/classes/VideoStyle.svelte';

	// Contient l'ID de l'export
	let exportId = '';

	// VideoPreview
	let videoPreview: VideoPreview | undefined = $state(undefined);

	// Récupère les données d'export de la vidéo
	let exportData: Exportation | undefined;

	const CAPTURE_WORKER_MODE = 'capture-worker';
	const WORKER_READY_EVENT = 'export-capture-worker-ready';
	const WORKER_START_EVENT = 'export-capture-worker-start';
	const WORKER_PROGRESS_EVENT = 'export-capture-worker-progress';
	const WORKER_COMPLETE_EVENT = 'export-capture-worker-complete';
	const WORKER_ERROR_EVENT = 'export-capture-worker-error';
	const EXPORT_LOG_EVENT = 'export-log-main';
	const WORKER_READY_TIMEOUT_MS = 45_000;
	const SCREENSHOT_TIMEOUT_MS = 60_000;
	let activeVideoSegments: TimeRange[] = [];
	let currentRenderingSegmentIndex = 0;
	let isSegmentedVideoExport = false;
	let currentVideoExportState: ExportState = ExportState.AddingSubtitles;
	let subtitleMainProgress = 0;
	let hasCompletedCapturingFrames = false;
	let hasSecondarySegmentProgress = false;
	let processingBackgroundProgress = 0;
	let captureWorkerIds: number[] = [];
	let configuredParallelCaptureWorkers = 1;
	let currentCaptureWorkerId: number | null = null;
	let cancellationRequested = false;
	let cleanupStarted = false;
	let exporterUnlisteners: Array<() => void> = [];
	let exportForegroundServiceStarted = false;
	let exportBackgroundReady = false;
	let notificationUpdateRunning = false;
	let notificationCancellationCheckRunning = false;
	let pendingNotificationUpdate: { progress: number; state: ExportState } | null = null;
	type ExportVideoInput = {
		path: string;
		loop_until_audio_end: boolean;
		source_start_ms?: number;
		timeline_start_ms?: number;
		duration_ms?: number;
	};
	type ExportAudioClipInput = {
		path: string;
		source_start_ms: number;
		timeline_start_ms: number;
		duration_ms: number;
	};
	type PngEncoderWorkerResponse = {
		requestId: number;
		blob?: Blob;
		durationMs?: number;
		error?: string;
	};
	let reusableScreenshotContext: ScreenshotContext<HTMLElement> | null = null;
	let reusableScreenshotContextKey = '';
	let pngEncoderWorker: Worker | null = null;
	let pngEncoderWorkerUnavailable = false;
	let pngEncoderWorkerFallbackReason: string | null = null;
	let pngEncoderRequestSequence = 0;
	let pendingPngEncodings = new Map<
		number,
		{
			resolve: (result: { blob: Blob; durationMs: number }) => void;
			reject: (error: Error) => void;
		}
	>();
	let lastPngEncodingMode: 'worker' | 'main-thread' = 'main-thread';
	let lastImageBitmapMs = 0;
	let lastWorkerEncodeMs = 0;
	let screenshotDomPhases = {
		startedAt: 0,
		cloneMs: 0,
		embedMs: 0,
		foreignObjectMs: 0
	};
	let screenshotPerformance = {
		count: 0,
		totalMs: 0,
		maxMs: 0,
		contextMs: 0,
		fontSubsetMs: 0,
		cloneMs: 0,
		embedMs: 0,
		rasterMs: 0,
		pngEncodeMs: 0,
		domCaptureMs: 0,
		blobReadMs: 0,
		writeMs: 0,
		bytes: 0
	};

	/**
	 * Indique si la piste nécessite des métadonnées temporelles explicites à l'export.
	 * @param {AssetClip[]} clips Clips à inspecter.
	 * @returns {boolean} true si un clip est trimé ou séparé de ses voisins.
	 */
	function requiresTimedAssetExport(clips: AssetClip[]): boolean {
		let expectedStartTime = 0;
		return clips.some((clip) => {
			const asset = globalState.currentProject!.content.getAssetById(clip.assetId);
			const requiresTiming =
				clip.startTime !== expectedStartTime ||
				(clip.sourceStartTime ?? 0) > 0 ||
				clip.duration < asset.duration.ms;
			expectedStartTime = clip.endTime + 1;
			return requiresTiming;
		});
	}

	/**
	 * Construit les entrées audio avec les offsets nécessaires aux clips trimés.
	 * @returns {{ audios: string[]; audioClips?: ExportAudioClipInput[] }} Entrées pour Tauri.
	 */
	function getAudioExportInputs(): {
		audios: string[];
		audioClips?: ExportAudioClipInput[];
	} {
		const clips = globalState.getAudioTrack.clips as AssetClip[];
		const audios = clips.map(
			(clip) => globalState.currentProject!.content.getAssetById(clip.assetId).filePath
		);
		if (!requiresTimedAssetExport(clips)) return { audios };

		return {
			audios,
			audioClips: clips.map((clip) => ({
				path: globalState.currentProject!.content.getAssetById(clip.assetId).filePath,
				source_start_ms: clip.sourceStartTime ?? 0,
				timeline_start_ms: clip.startTime,
				duration_ms: clip.duration
			}))
		};
	}

	/**
	 * Construit les entrées vidéo avec les offsets nécessaires aux clips trimés.
	 * @returns {ExportVideoInput[]} Entrées vidéo pour Tauri.
	 */
	function getVideoExportInputs(): ExportVideoInput[] {
		const clips = globalState.getVideoTrack.clips as AssetClip[];
		const requiresTiming = requiresTimedAssetExport(clips);

		return clips.map((clip) => {
			const input: ExportVideoInput = {
				path: globalState.currentProject!.content.getAssetById(clip.assetId).filePath,
				loop_until_audio_end: clip.loopUntilAudioEnd
			};
			if (requiresTiming) {
				input.source_start_ms = clip.sourceStartTime ?? 0;
				input.timeline_start_ms = clip.startTime;
				input.duration_ms = clip.duration;
			}
			return input;
		});
	}

	/**
	 * Retourne le nom du blank deja planifie pour la sourate courante.
	 * @param {Record<string, number>} imgWithNothingShown Blanks sources par etat visuel.
	 * @param {number} timing Timing courant.
	 * @param {ExportTimedOverlayCaptureClip[]} timedOverlayClips Overlays qui changent l'etat visuel.
	 * @returns {string | null} Nom du fichier blank sans extension.
	 */
	function getReusableBlankFileName(
		imgWithNothingShown: Record<string, number>,
		timing: number,
		timedOverlayClips: ExportTimedOverlayCaptureClip[]
	): string | null {
		const currentSurah = globalState.getSubtitleTrack.getCurrentSurah(timing);
		const key = getBlankVisualStateKey(currentSurah, timing, timedOverlayClips);

		return imgWithNothingShown[key] !== undefined ? getBlankImageFileName(key) : null;
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
			current_segment_index?: number;
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
	type ExportLogPayload = {
		exportId: number;
		timestamp: string;
		source: string;
		level: ExportLogLevel;
		message: string;
	};
	type CancelExportRendererPayload = {
		exportId: string;
	};
	type ExportRendererNativeEventMessage = {
		type?: 'export-renderer-native-event-main';
		eventName?: string;
		payload?: unknown;
	};
	type CaptureWorkerEventMessage = {
		type?: 'export-renderer-worker-event-renderer';
		eventName?: string;
		payload?: unknown;
	};
	type CaptureWorkerCommandMessage = {
		type?: 'export-renderer-worker-command-renderer';
		eventName?: string;
		payload?: unknown;
	};
	type EmbeddedTauriBridgeWindow = Window & {
		__QURAN_CAPTION_INVOKE_BRIDGE__?: (
			command: string,
			args?: unknown,
			options?: unknown
		) => Promise<unknown>;
	};

	function getExportFadeSettings(): ExportFadeSettings {
		return globalState.getStyle('global', 'video-and-audio-fade')!.value as ExportFadeSettings;
	}

	/**
	 * Retourne le mode de transition entre clips vidéo de fond.
	 *
	 * @returns {string} Mode de transition exporté vers Tauri.
	 */
	function getVideoClipTransitionMode(): string {
		return String(globalState.getStyle('global', 'video-clip-transition')?.value ?? 'none');
	}

	/**
	 * Retourne la durée des transitions entre clips vidéo de fond.
	 *
	 * @returns {number} Durée en millisecondes.
	 */
	function getVideoClipTransitionDurationMs(): number {
		return Math.max(
			0,
			Number(globalState.getStyle('global', 'video-clip-transition-duration')?.value ?? 0)
		);
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
			current_segment_index?: number;
		};

		// Vérifie que c'est bien pour cette exportation
		if (data.export_id !== exportId) return;
		if (data.current_segment_index !== undefined) {
			currentRenderingSegmentIndex = data.current_segment_index;
		}

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
		queueAndroidExportNotificationUpdate(payload.progress, payload.currentState);
		if (window.parent !== window) {
			window.parent.postMessage({ type: 'export-renderer-progress-main', payload }, '*');
			return;
		}
		await emit('export-progress-main', payload);
	}

	/**
	 * Retourne les textes localisés transmis une seule fois au service Android.
	 * @returns {Record<string, string>} Libellés de notification et des états d'export.
	 */
	function getAndroidExportNotificationCopy(): Record<string, string> {
		const monitor = get(LL).exporterMonitor as unknown as Record<string, () => string>;
		return {
			channelName: monitor.exportNotificationChannel(),
			capturingHint: monitor.exportKeepOpenCapturing(),
			backgroundHint: monitor.exportCanRunInBackground(),
			completionHint: monitor.exportCompletedTapToView(),
			cancelLabel: monitor.cancelExport(),
			cancellingLabel: monitor.exportCancelling(),
			[ExportState.WaitingForRecord]: monitor.statePending(),
			[ExportState.Recording]: monitor.stateRecording(),
			[ExportState.AddingAudio]: monitor.stateAddingAudio(),
			[ExportState.ProcessingBackground]: monitor.stateProcessingBackground(),
			[ExportState.AddingSubtitles]: monitor.stateRendering(),
			[ExportState.CreatingVideo]: monitor.stateRendering(),
			[ExportState.MergingFiles]: monitor.stateMerging(),
			[ExportState.CapturingFrames]: monitor.stateCapturing(),
			[ExportState.Initializing]: monitor.stateInitializing(),
			[ExportState.Exported]: monitor.stateExported(),
			[ExportState.Error]: monitor.stateError(),
			[ExportState.Canceled]: monitor.stateCanceled()
		};
	}

	/**
	 * Démarre le service au premier plan avant toute capture dépendante de la WebView.
	 * @returns {Promise<void>}
	 */
	async function startAndroidExportForegroundService(): Promise<void> {
		if (!exportData || currentCaptureWorkerId !== null || exportForegroundServiceStarted) return;
		const copy = getAndroidExportNotificationCopy();
		const stateLabels = Object.fromEntries(
			Object.values(ExportState).map((state) => [state, copy[state]])
		);
		try {
			await invoke('start_android_export_foreground_service', {
				exportId,
				fileName: exportData.finalFileName,
				state: ExportState.Initializing,
				stateLabels: JSON.stringify(stateLabels),
				capturingHint: copy.capturingHint,
				backgroundHint: copy.backgroundHint,
				completionHint: copy.completionHint,
				cancelLabel: copy.cancelLabel,
				cancellingLabel: copy.cancellingLabel,
				channelName: copy.channelName
			});
			exportForegroundServiceStarted = true;
			const cancellationPoll = window.setInterval(() => {
				void syncAndroidExportNotificationCancellation();
			}, 750);
			exporterUnlisteners.push(() => window.clearInterval(cancellationPoll));
		} catch (error) {
			console.warn('Unable to start Android export foreground service:', error);
		}
	}

	/**
	 * Relève l'action Annuler même lorsqu'aucune frame ne vient de publier de progression.
	 * @returns {Promise<void>}
	 */
	async function syncAndroidExportNotificationCancellation(): Promise<void> {
		if (
			!exportForegroundServiceStarted ||
			cancellationRequested ||
			notificationCancellationCheckRunning
		) {
			return;
		}
		notificationCancellationCheckRunning = true;
		try {
			const cancelled = await invoke<boolean>('is_android_export_notification_cancelled', {
				exportId
			});
			if (cancelled) {
				cancellationRequested = true;
				await invoke('cancel_export', { exportId });
			}
		} catch (error) {
			console.warn('Unable to read Android export cancellation:', error);
		} finally {
			notificationCancellationCheckRunning = false;
		}
	}

	/**
	 * Coalesce les mises à jour rapides de capture avant de les envoyer au service Android.
	 * @param {number} progress Pourcentage de la phase courante.
	 * @param {ExportState} state État brut de l'export.
	 * @returns {void}
	 */
	function queueAndroidExportNotificationUpdate(progress: number, state: ExportState): void {
		if (!exportForegroundServiceStarted || currentCaptureWorkerId !== null) return;
		pendingNotificationUpdate = {
			progress: Math.round(Math.min(100, Math.max(0, progress))),
			state
		};
		if (!notificationUpdateRunning) void flushAndroidExportNotificationUpdates();
	}

	/**
	 * Envoie la dernière progression disponible et relaie une annulation système au moteur Rust.
	 * @returns {Promise<void>}
	 */
	async function flushAndroidExportNotificationUpdates(): Promise<void> {
		notificationUpdateRunning = true;
		try {
			while (pendingNotificationUpdate && exportForegroundServiceStarted) {
				const update = pendingNotificationUpdate;
				pendingNotificationUpdate = null;
				const cancelled = await invoke<boolean>('update_android_export_foreground_service', {
					exportId,
					progress: update.progress,
					state: update.state
				});
				if (cancelled && !cancellationRequested) {
					cancellationRequested = true;
					await invoke('cancel_export', { exportId });
				}
			}
		} catch (error) {
			console.warn('Unable to update Android export notification:', error);
		} finally {
			notificationUpdateRunning = false;
			if (pendingNotificationUpdate && exportForegroundServiceStarted) {
				void flushAndroidExportNotificationUpdates();
			}
		}
	}

	/**
	 * Autorise l'arrière-plan après le démarrage du premier traitement FFmpeg natif.
	 * @returns {Promise<void>}
	 */
	async function markAndroidExportBackgroundReady(): Promise<void> {
		if (!exportForegroundServiceStarted || exportBackgroundReady) return;
		try {
			await invoke('mark_android_export_background_ready', { exportId });
			exportBackgroundReady = true;
			await setExportScreenAwake(false);
		} catch (error) {
			console.warn('Unable to mark Android export as background-ready:', error);
		}
	}

	/**
	 * Arrête le service lorsque le workflow d'export est entièrement terminé.
	 * @returns {Promise<void>}
	 */
	async function stopAndroidExportForegroundService(): Promise<void> {
		if (!exportForegroundServiceStarted) return;
		exportForegroundServiceStarted = false;
		pendingNotificationUpdate = null;
		try {
			await invoke('stop_android_export_foreground_service', { exportId });
		} catch (error) {
			console.warn('Unable to stop Android export foreground service:', error);
		}
	}

	/**
	 * Envoie une ligne de log d'export au monitor principal.
	 * @param {ExportLogLevel} level Niveau de log.
	 * @param {string} message Message court.
	 * @param {Record<string, unknown>} context Contexte serialisable.
	 * @returns {Promise<void>}
	 */
	async function emitExportLog(
		level: ExportLogLevel,
		message: string,
		context: Record<string, unknown> = {}
	): Promise<void> {
		if (!exportId) return;

		const contextSuffix = Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : '';
		const fullMessage = `${message}${contextSuffix}`;
		const source =
			window.parent !== window
				? currentCaptureWorkerId === null
					? 'android-renderer'
					: `android-capture-${currentCaptureWorkerId}`
				: getCurrentWebviewWindow().label;

		if (level === 'error') {
			console.error(`[export:${exportId}:${source}] ${fullMessage}`);
		} else if (level === 'warn') {
			console.warn(`[export:${exportId}:${source}] ${fullMessage}`);
		} else {
			console.log(`[export:${exportId}:${source}] ${fullMessage}`);
		}

		const payload: ExportLogPayload = {
			exportId: Number(exportId),
			timestamp: new Date().toISOString(),
			source,
			level,
			message: fullMessage
		};

		if (window.parent !== window) {
			window.parent.postMessage({ type: 'export-renderer-log-main', payload }, '*');
			return;
		}
		await emit(EXPORT_LOG_EVENT, payload);
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
	 * Envoie un événement du renderer de capture au coordinateur via la page Android.
	 * @param {string} eventName Nom de l'événement.
	 * @param {unknown} payload Donnees a transmettre.
	 * @returns {Promise<void>}
	 */
	async function emitToCoordinator(eventName: string, payload: unknown): Promise<void> {
		window.parent.postMessage(
			{
				type: 'export-renderer-worker-event-main',
				exportId,
				workerId: currentCaptureWorkerId,
				eventName,
				payload
			},
			'*'
		);
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
		if (globalState.getStyle('arabic', 'mushaf-style')?.value === 'Warsh') {
			await WarshProvider.prefetch();
		}
		if (globalState.getStyle('arabic', 'mushaf-style')?.value === 'Minimal Quran') {
			await MinimalQuranProvider.prefetch();
		}

		await ExportService.loadExports();
		exportData = ExportService.findExportById(Number(id));
		if (!exportData) throw new Error(`Export ${id} is missing from the persisted queue`);
	}

	/**
	 * Interrompt les boucles de capture dès que l'annulation Android est demandée.
	 * @returns {void}
	 */
	function ensureCaptureNotCancelled(): void {
		if (cancellationRequested) throw new Error('EXPORT_CANCELLED');
	}

	/**
	 * Demande à Android de garder l'écran actif pendant le rendu.
	 * @param {boolean} enabled État souhaité.
	 * @returns {Promise<void>}
	 */
	async function setExportScreenAwake(enabled: boolean): Promise<void> {
		try {
			await invoke('set_android_export_keep_screen_on', { enabled });
		} catch (error) {
			console.warn('Unable to update Android screen flag:', error);
		}
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
		const previewDeadline = Date.now() + 30_000;
		do {
			ensureCaptureNotCancelled();
			if (Date.now() >= previewDeadline) throw new Error('EXPORT_PREVIEW_NOT_READY');
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
	 * Execute le mode worker et traite successivement les lots envoyés par le coordinator.
	 * @param {number} workerId Index du worker courant.
	 * @returns {Promise<void>}
	 */
	async function runCaptureWorker(workerId: number): Promise<void> {
		/**
		 * Traite une commande de capture relayée par la page Android.
		 * @param {MessageEvent<CaptureWorkerCommandMessage>} event Commande du coordinateur.
		 * @returns {Promise<void>}
		 */
		const handleWorkerCommand = async (
			event: MessageEvent<CaptureWorkerCommandMessage>
		): Promise<void> => {
			if (
				event.source !== window.parent ||
				event.data?.type !== 'export-renderer-worker-command-renderer' ||
				event.data.eventName !== WORKER_START_EVENT
			) {
				return;
			}
			const data = event.data.payload as CaptureWorkerStartPayload;
			if (data.exportId !== exportId || data.workerId !== workerId) return;

			try {
				await emitExportLog('info', 'Capture worker started', {
					workerId,
					jobs: data.jobs.length,
					subfolder: data.subfolder
				});
				let completed = 0;
				const retryJobs: ExportFrameCaptureJob[] = [];
				for (const job of data.jobs) {
					if (await captureFrameJob(job, data.subfolder)) retryJobs.push(job);
					completed += 1;
					await emitToCoordinator(WORKER_PROGRESS_EVENT, {
						exportId,
						workerId,
						completed,
						total: data.jobs.length
					} satisfies CaptureWorkerProgressPayload);
				}
				if (retryJobs.length > 0) {
					await emitExportLog('warn', 'Capture worker retrying layout timeouts', {
						workerId,
						jobs: retryJobs.length
					});
					for (const job of retryJobs) {
						await captureFrameJob(job, data.subfolder);
					}
				}

				await emitToCoordinator(WORKER_COMPLETE_EVENT, {
					exportId,
					workerId
				} satisfies CaptureWorkerLifecyclePayload);
				await emitExportLog('info', 'Capture worker completed', {
					workerId,
					jobs: data.jobs.length
				});
			} catch (error) {
				await emitExportLog('error', 'Capture worker failed', {
					workerId,
					error: error instanceof Error ? error.message : String(error)
				});
				await emitToCoordinator(WORKER_ERROR_EVENT, {
					exportId,
					workerId,
					error: error instanceof Error ? error.message : String(error)
				} satisfies CaptureWorkerErrorPayload);
			}
		};
		window.addEventListener('message', handleWorkerCommand);
		exporterUnlisteners.push(() => window.removeEventListener('message', handleWorkerCommand));

		await emitToCoordinator(WORKER_READY_EVENT, {
			exportId,
			workerId
		} satisfies CaptureWorkerLifecyclePayload);
		await emitExportLog('info', 'Capture worker ready', { workerId });
	}

	onMount(async () => {
		const params = new URLSearchParams(window.location.search);
		const id = params.get('id');
		if (!id) return;

		exportId = id;
		const isWorker = params.get('mode') === CAPTURE_WORKER_MODE;
		const workerId = Number(params.get('worker') ?? '0');
		const requestedWorkerCount = Number(params.get('workers') ?? '1');
		configuredParallelCaptureWorkers = Math.max(
			1,
			Math.min(4, Number.isFinite(requestedWorkerCount) ? Math.round(requestedWorkerCount) : 1)
		);
		currentCaptureWorkerId = isWorker ? workerId : null;
		const bridgeWindow = window as EmbeddedTauriBridgeWindow;

		try {
			await emitExportLog('info', 'Export renderer mounted', {
				embedded: window.parent !== window,
				hasInvokeBridge: Boolean(bridgeWindow.__QURAN_CAPTION_INVOKE_BRIDGE__)
			});
			/**
			 * Reçoit les événements natifs relayés par la frame principale Android.
			 * @param {MessageEvent<ExportRendererNativeEventMessage>} event Message du parent.
			 * @returns {void}
			 */
			const handleNativeEvent = (event: MessageEvent<ExportRendererNativeEventMessage>) => {
				if (event.source !== window.parent) return;
				const data = event.data;
				if (data?.type !== 'export-renderer-native-event-main') return;
				if (!isWorker && data.eventName === 'export-progress') {
					void exportProgress({ payload: data.payload } as ExportProgressEvent);
				} else if (!isWorker && data.eventName === 'export-complete') {
					void exportComplete({ payload: data.payload } as ExportCompleteEvent);
				} else if (!isWorker && data.eventName === 'export-error') {
					void exportError({ payload: data.payload } as ExportErrorEvent);
				} else if (
					data.eventName === 'cancel-export-renderer' &&
					(data.payload as CancelExportRendererPayload | undefined)?.exportId === exportId
				) {
					cancellationRequested = true;
				}
			};
			window.addEventListener('message', handleNativeEvent);
			exporterUnlisteners.push(() => window.removeEventListener('message', handleNativeEvent));
			await emitExportLog('info', 'Native event relay installed');

			if (!isWorker) {
				await emitExportLog('info', 'Checking native cancellation marker', { exportId });
				cancellationRequested = await invoke<boolean>('is_export_cancelled', { exportId });
				await emitExportLog('info', 'Native cancellation marker checked', {
					exportId,
					cancellationRequested
				});
				ensureCaptureNotCancelled();
				await emitExportLog('info', 'Enabling Android keep-screen-on');
				await setExportScreenAwake(true);
				await emitExportLog('info', 'Android keep-screen-on requested');
			}

			await emitExportLog('info', 'Export window initialized', {
				mode: isWorker ? 'worker' : 'coordinator',
				workerId: isWorker ? workerId : undefined,
				parallelCaptureWorkers: isWorker ? undefined : configuredParallelCaptureWorkers
			});

			await emitExportLog('info', 'Loading export project JSON', { exportId: id });
			await loadExportProject(id);
			await emitExportLog('info', 'Export project loaded', {
				file: exportData?.finalFileName,
				start: exportData?.videoStartTime,
				end: exportData?.videoEndTime
			});
			if (!isWorker) {
				await startAndroidExportForegroundService();
				await emitExportLog('info', 'Android foreground export service requested');
			}

			await mkdir(await join(ExportService.exportFolder, exportId), {
				baseDir: BaseDirectory.AppData,
				recursive: true
			});
			await emitExportLog('info', 'Export image folder ready');

			await prepareVideoPreviewForExport();
			await emitExportLog('info', 'Video preview ready');

			if (isWorker) {
				await runCaptureWorker(workerId);
				return;
			}

			await emitExportLog('info', 'Export started');
			await startExport();
		} catch (error) {
			await closeCaptureWorkerRenderers();
			if (!isWorker && !cancellationRequested) {
				try {
					cancellationRequested = await invoke<boolean>(
						'is_android_export_notification_cancelled',
						{ exportId }
					);
				} catch {
					// Le marqueur Rust reste la source de secours si le service Android est indisponible.
				}
			}
			console.error('Export failed:', error);
			await emitExportLog('error', 'Export failed', {
				error: error instanceof Error ? error.message : String(error)
			});
			if (isWorker) {
				await emitToCoordinator(WORKER_ERROR_EVENT, {
					exportId,
					workerId,
					error: error instanceof Error ? error.message : String(error)
				} satisfies CaptureWorkerErrorPayload);
				return;
			}
			await emitProgress({
				exportId: Number(exportId),
				progress: 100,
				currentState: cancellationRequested ? ExportState.Canceled : ExportState.Error,
				errorLog: cancellationRequested
					? undefined
					: JSON.stringify(error, Object.getOwnPropertyNames(error))
			} as ExportProgress);
			await finalCleanup();
		}
	});

	onDestroy(() => {
		for (const unlisten of exporterUnlisteners) unlisten();
		exporterUnlisteners = [];
		destroyReusableScreenshotContext();
		destroyPngEncoderWorker();
		if (currentCaptureWorkerId === null) void setExportScreenAwake(false);
	});

	async function startExport() {
		if (!exportData) return;
		resetSegmentProgressTracking();

		const exportStart = Math.round(exportData.videoStartTime);
		const exportEnd = Math.round(exportData.videoEndTime);
		const recitationRanges = globalState.getExportState.exportOnlyRecitation
			? getRecitationRangesForExport(
					globalState.getSubtitleTrack.clips,
					exportStart,
					exportEnd,
					globalState.getExportState.recitationMinimumSilenceMs ?? 3000,
					globalState.getExportState.recitationCutMarginMs ?? 350
				)
			: [{ start: exportStart, end: exportEnd }];
		if (recitationRanges.length === 0) {
			throw new Error(get(LL).export.noRecitationInExportRange());
		}
		const exportRanges = excludeTimeRanges(
			recitationRanges,
			(globalState.getExportState.skipRanges ?? []).map((range) => ({
				start: range.startTime,
				end: range.endTime
			}))
		);
		if (exportRanges.length === 0) {
			const exportCopy = get(LL).export as unknown as { noContentAfterSkips: () => string };
			throw new Error(exportCopy.noContentAfterSkips());
		}
		const totalDuration = exportRanges.reduce(
			(duration, range) => duration + range.end - range.start,
			0
		);

		console.log(`Export duration: ${totalDuration}ms (${totalDuration / 1000 / 60} minutes)`);
		await emitExportLog('info', 'Export duration computed', {
			start: exportStart,
			end: exportEnd,
			duration: totalDuration
		});

		const blurSegments = exportRanges.flatMap((range) =>
			getBlurSegmentsForRange(range.start, range.end)
		);
		await emitExportLog('info', 'Blur segments computed', {
			segments: blurSegments.length
		});
		const hasCuts =
			exportRanges.length !== 1 ||
			exportRanges[0].start !== exportStart ||
			exportRanges[0].end !== exportEnd;
		if (hasCuts || blurSegments.length > 1) {
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
		return resolveOverlayVisualState(globalState.getVideoStyle.getStylesOfTarget('global'), clipId)
			.blur;
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
		await closeCaptureWorkerRenderers();

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

		const publishedFilePath = await generateSegmentedVideo(
			renderSegments,
			segmentBlankImageIndexes
		);
		const fileSizeBytes = await getGeneratedFileSizeBytes();
		isSegmentedVideoExport = false;
		refreshSecondarySegmentProgressVisibility();

		await emitProgress({
			exportId: Number(exportId),
			progress: 100,
			currentState: ExportState.Exported,
			currentTime: totalDuration,
			totalTime: totalDuration,
			finalFilePath: publishedFilePath,
			fileSizeBytes,
			nativeNotificationCompleted: true
		} as ExportProgress);
		await finalCleanup();
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
	 * Retourne le nombre de renderers iframe configuré pour la capture PNG.
	 * @returns {number} Nombre de workers borné entre 1 et 4.
	 */
	function getParallelCaptureWorkerCount(): number {
		return configuredParallelCaptureWorkers;
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
		const timedOverlayClips = getTimedOverlayCaptureClips();

		return buildExportCaptureJobPlan({
			timings,
			rangeStart,
			rangeEnd,
			fadeDuration,
			workerCount: getParallelCaptureWorkerCount(),
			isBlankCaptureTiming: (timing) =>
				isBlankCaptureTiming(timing, timings.blankImgs, timings.imgWithNothingShown),
			getReusableBlankFileName: (timing) =>
				getReusableBlankFileName(timings.imgWithNothingShown, timing, timedOverlayClips),
			getBlankSourceCaptureTiming: (timing) => (isSegment ? timing - 1 : timing)
		});
	}

	/**
	 * Capture une image blank source partagee entre les workers.
	 * @param {ExportBlankSourceJob} job Job blank source.
	 * @returns {Promise<boolean>} true si la capture a continue apres un timeout de layout.
	 */
	async function captureBlankSourceJob(job: ExportBlankSourceJob): Promise<boolean> {
		ensureCaptureNotCancelled();
		await emitExportLog('info', 'Blank source capture waiting', {
			timing: job.timing,
			captureTiming: job.captureTiming,
			file: job.fileName
		});
		globalState.getTimelineState.movePreviewTo = job.captureTiming;
		globalState.getTimelineState.cursorPosition = job.captureTiming;
		globalState.updateVideoPreviewUI();
		const layoutTimedOut = await wait(job.captureTiming);
		ensureCaptureNotCancelled();
		await emitExportLog(layoutTimedOut ? 'warn' : 'info', 'Blank source layout wait completed', {
			timing: job.timing,
			captureTiming: job.captureTiming,
			file: job.fileName
		});
		await takeScreenshot(job.fileName);
		await emitExportLog('info', 'Blank source captured', {
			timing: job.timing,
			captureTiming: job.captureTiming,
			file: job.fileName
		});
		return layoutTimedOut;
	}

	/**
	 * Capture une frame numerotee avec la preview du renderer courant.
	 * @param {ExportFrameCaptureJob} job Job de capture.
	 * @param {string | null} subfolder Sous-dossier de sortie, ou null.
	 * @returns {Promise<boolean>} true si la capture a continue apres un timeout de layout.
	 */
	async function captureFrameJob(
		job: ExportFrameCaptureJob,
		subfolder: string | null
	): Promise<boolean> {
		const jobStartedAt = performance.now();
		ensureCaptureNotCancelled();
		await emitExportLog('info', 'Frame capture waiting', {
			timing: job.timing,
			captureTiming: job.captureTiming,
			file: job.fileName,
			subfolder,
			reusableBlank: job.reusableBlankFileName,
			hideArabicText: job.hideArabicText
		});
		globalState.getTimelineState.movePreviewTo = job.captureTiming;
		globalState.getTimelineState.cursorPosition = job.captureTiming;
		globalState.updateVideoPreviewUI();
		const waitStartedAt = performance.now();
		const layoutTimedOut = await wait(job.captureTiming);
		const waitMs = performance.now() - waitStartedAt;
		ensureCaptureNotCancelled();
		await emitExportLog(layoutTimedOut ? 'warn' : 'info', 'Frame layout wait completed', {
			timing: job.timing,
			captureTiming: job.captureTiming,
			file: job.fileName
		});
		const screenshotStartedAt = performance.now();
		await takeScreenshot(job.fileName, subfolder, job.reusableBlankFileName, job.hideArabicText);
		await emitExportLog('info', 'Frame captured', {
			timing: job.timing,
			captureTiming: job.captureTiming,
			file: job.fileName,
			waitMs: Math.round(waitMs),
			screenshotMs: Math.round(performance.now() - screenshotStartedAt),
			totalMs: Math.round(performance.now() - jobStartedAt)
		});
		return layoutTimedOut;
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
		const performanceBefore = { ...screenshotPerformance };
		await emitExportLog('info', 'Serial capture started', {
			jobs: jobs.length,
			subfolder
		});
		const retryJobs: ExportFrameCaptureJob[] = [];
		for (let index = 0; index < jobs.length; index++) {
			ensureCaptureNotCancelled();
			const job = jobs[index];
			if (await captureFrameJob(job, subfolder)) retryJobs.push(job);
			onProgress(index + 1, job.timing);

			if ((index + 1) % 20 === 0) {
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
		}
		if (retryJobs.length > 0) {
			await emitExportLog('warn', 'Serial capture retrying layout timeouts', {
				jobs: retryJobs.length,
				subfolder
			});
			for (const job of retryJobs) {
				await captureFrameJob(job, subfolder);
			}
		}
		const capturedScreenshots = screenshotPerformance.count - performanceBefore.count;
		const totalScreenshotMs = screenshotPerformance.totalMs - performanceBefore.totalMs;
		await emitExportLog('info', 'Serial capture completed', {
			jobs: jobs.length,
			subfolder,
			performance:
				capturedScreenshots > 0
					? {
							screenshots: capturedScreenshots,
							averageMs: Math.round(totalScreenshotMs / capturedScreenshots),
							exportMaxMs: Math.round(screenshotPerformance.maxMs),
							contextAverageMs: Math.round(
								(screenshotPerformance.contextMs - performanceBefore.contextMs) /
									capturedScreenshots
							),
							fontSubsetAverageMs: Math.round(
								(screenshotPerformance.fontSubsetMs - performanceBefore.fontSubsetMs) /
									capturedScreenshots
							),
							cloneAverageMs: Math.round(
								(screenshotPerformance.cloneMs - performanceBefore.cloneMs) / capturedScreenshots
							),
							embedAverageMs: Math.round(
								(screenshotPerformance.embedMs - performanceBefore.embedMs) / capturedScreenshots
							),
							rasterAverageMs: Math.round(
								(screenshotPerformance.rasterMs - performanceBefore.rasterMs) / capturedScreenshots
							),
							pngEncodeAverageMs: Math.round(
								(screenshotPerformance.pngEncodeMs - performanceBefore.pngEncodeMs) /
									capturedScreenshots
							),
							domCaptureAverageMs: Math.round(
								(screenshotPerformance.domCaptureMs - performanceBefore.domCaptureMs) /
									capturedScreenshots
							),
							blobReadAverageMs: Math.round(
								(screenshotPerformance.blobReadMs - performanceBefore.blobReadMs) /
									capturedScreenshots
							),
							writeAverageMs: Math.round(
								(screenshotPerformance.writeMs - performanceBefore.writeMs) / capturedScreenshots
							),
							averageBytes: Math.round(
								(screenshotPerformance.bytes - performanceBefore.bytes) / capturedScreenshots
							)
						}
					: null
		});
	}

	/**
	 * Demande à la page Android de monter les iframes de capture parallèle.
	 * @param {ExportFrameCaptureJob[][]} buckets Jobs assignes a chaque worker.
	 * @returns {Promise<number[]>} Identifiants des renderers créés.
	 */
	async function openCaptureWorkerRenderers(buckets: ExportFrameCaptureJob[][]): Promise<number[]> {
		const workerIds = buckets.map((_, workerId) => workerId);
		for (let workerId = 0; workerId < buckets.length; workerId++) {
			await emitExportLog('info', 'Opening capture renderer', {
				workerId,
				jobs: buckets[workerId].length
			});
		}
		window.parent.postMessage(
			{
				type: 'export-renderer-workers-create-main',
				exportId,
				count: workerIds.length
			},
			'*'
		);
		return workerIds;
	}

	/**
	 * Demande à la page Android de démonter tous les renderers de capture.
	 * @returns {Promise<void>}
	 */
	async function closeCaptureWorkerRenderers(): Promise<void> {
		captureWorkerIds = [];
		window.parent.postMessage(
			{
				type: 'export-renderer-workers-close-main',
				exportId
			},
			'*'
		);
	}

	/**
	 * Écoute un événement de capture relayé par la page Android.
	 * @param {string} eventName Nom de l'événement attendu.
	 * @param {(payload: T) => void} handler Gestionnaire du payload reçu.
	 * @returns {() => void} Fonction de désinscription.
	 */
	function listenToCaptureWorkerEvent<T>(
		eventName: string,
		handler: (payload: T) => void
	): () => void {
		/**
		 * Filtre les messages du parent avant de transmettre leur payload.
		 * @param {MessageEvent<CaptureWorkerEventMessage>} event Message relayé.
		 * @returns {void}
		 */
		const listener = (event: MessageEvent<CaptureWorkerEventMessage>): void => {
			if (
				event.source !== window.parent ||
				event.data?.type !== 'export-renderer-worker-event-renderer' ||
				event.data.eventName !== eventName
			) {
				return;
			}
			handler(event.data.payload as T);
		};
		window.addEventListener('message', listener);
		return () => window.removeEventListener('message', listener);
	}

	/**
	 * Execute les captures avec plusieurs iframes renderer independantes.
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
		await emitExportLog('info', 'Parallel capture started', {
			workers: buckets.length,
			jobs: buckets.reduce((sum, bucket) => sum + bucket.length, 0),
			subfolder
		});
		const workerProgress = Array.from({ length: buckets.length }, () => 0);
		const readyWorkers = new Set<number>();
		const completeWorkers = new Set<number>();
		const unlisteners: Array<() => void> = [];
		const canReuseWorkers =
			captureWorkerIds.length === buckets.length &&
			captureWorkerIds.every((workerId, index) => workerId === index);
		if (canReuseWorkers) {
			for (let workerId = 0; workerId < buckets.length; workerId++) readyWorkers.add(workerId);
		}
		let readyTimeout: ReturnType<typeof setTimeout> | undefined;
		let resolveReady: () => void = () => {};
		let rejectReady: (error: Error) => void = () => {};
		let resolveComplete: () => void = () => {};
		let rejectComplete: (error: Error) => void = () => {};

		const readyPromise = new Promise<void>((resolve, reject) => {
			resolveReady = resolve;
			rejectReady = reject;
			if (canReuseWorkers) {
				resolve();
				return;
			}
			readyTimeout = setTimeout(() => {
				void emitExportLog('error', 'Timeout waiting for capture workers', {
					ready: readyWorkers.size,
					total: buckets.length
				});
				reject(new Error('Timeout waiting for capture workers'));
			}, WORKER_READY_TIMEOUT_MS);
		});

		const completePromise = new Promise<void>((resolve, reject) => {
			resolveComplete = resolve;
			rejectComplete = reject;
		});

		unlisteners.push(
			listenToCaptureWorkerEvent<CaptureWorkerLifecyclePayload>(WORKER_READY_EVENT, (data) => {
				if (data.exportId !== exportId) return;
				readyWorkers.add(data.workerId);
				void emitExportLog('info', 'Capture worker reported ready', {
					workerId: data.workerId,
					ready: readyWorkers.size,
					total: buckets.length
				});
				if (readyWorkers.size === buckets.length) {
					if (readyTimeout) clearTimeout(readyTimeout);
					resolveReady();
				}
			})
		);

		unlisteners.push(
			listenToCaptureWorkerEvent<CaptureWorkerProgressPayload>(WORKER_PROGRESS_EVENT, (data) => {
				if (data.exportId !== exportId) return;
				workerProgress[data.workerId] = data.completed;
				onProgress(workerProgress.reduce((sum, value) => sum + value, 0));
			})
		);

		unlisteners.push(
			listenToCaptureWorkerEvent<CaptureWorkerLifecyclePayload>(WORKER_COMPLETE_EVENT, (data) => {
				if (data.exportId !== exportId) return;
				completeWorkers.add(data.workerId);
				workerProgress[data.workerId] = buckets[data.workerId]?.length ?? 0;
				onProgress(workerProgress.reduce((sum, value) => sum + value, 0));
				void emitExportLog('info', 'Capture worker reported complete', {
					workerId: data.workerId,
					completedWorkers: completeWorkers.size,
					totalWorkers: buckets.length
				});
				if (completeWorkers.size === buckets.length) resolveComplete();
			})
		);

		unlisteners.push(
			listenToCaptureWorkerEvent<CaptureWorkerErrorPayload>(WORKER_ERROR_EVENT, (data) => {
				if (data.exportId !== exportId) return;
				const error = new Error(`Capture worker ${data.workerId} failed: ${data.error}`);
				void emitExportLog('error', 'Capture worker reported error', {
					workerId: data.workerId,
					error: data.error
				});
				if (readyWorkers.size < buckets.length) {
					rejectReady(error);
				} else {
					rejectComplete(error);
				}
			})
		);

		if (!canReuseWorkers) {
			await closeCaptureWorkerRenderers();
			captureWorkerIds = await openCaptureWorkerRenderers(buckets);
		} else {
			await emitExportLog('info', 'Reusing capture workers', { workers: buckets.length });
		}
		try {
			await readyPromise;
			await emitExportLog('info', 'All capture workers ready', { workers: buckets.length });
			for (const workerId of captureWorkerIds) {
				window.parent.postMessage(
					{
						type: 'export-renderer-worker-command-main',
						exportId,
						workerId,
						eventName: WORKER_START_EVENT,
						payload: {
							exportId,
							workerId,
							jobs: buckets[workerId],
							subfolder
						} satisfies CaptureWorkerStartPayload
					},
					'*'
				);
			}
			await emitExportLog('info', 'Capture jobs sent to workers', { workers: buckets.length });
			await completePromise;
			await emitExportLog('info', 'Parallel capture completed', { workers: buckets.length });
		} finally {
			if (readyTimeout) clearTimeout(readyTimeout);
			for (const unlisten of unlisteners) unlisten();
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
		await emitExportLog('info', 'Copy jobs started', { jobs: jobs.length, subfolder });
		for (let index = 0; index < jobs.length; index++) {
			ensureCaptureNotCancelled();
			const job = jobs[index];
			await duplicateScreenshot(job.sourceFileName, job.targetFileName, subfolder);
			onProgress(index + 1, job.timing);
		}
		await emitExportLog('info', 'Copy jobs completed', { jobs: jobs.length, subfolder });
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
		let lastReportedCompleted = 0;
		await emitExportLog('info', 'Image capture plan started', {
			totalJobs,
			blankSources: plan.blankSourceJobs.length,
			captures: plan.captureJobs.length,
			copies: plan.copyJobs.length,
			workers: plan.workerBuckets.length,
			subfolder
		});

		/**
		 * Publie une progression monotone pour éviter un recul visuel après un fallback.
		 * @param {number} nextCompleted Nombre de jobs terminés.
		 * @param {number | undefined} timing Timing associé au job courant.
		 * @returns {void}
		 */
		const reportProgress = (nextCompleted: number, timing?: number) => {
			lastReportedCompleted = Math.max(lastReportedCompleted, nextCompleted);
			onProgress(lastReportedCompleted, totalJobs, timing);
		};

		const retryBlankSourceJobs: ExportBlankSourceJob[] = [];
		for (const job of plan.blankSourceJobs) {
			ensureCaptureNotCancelled();
			if (await captureBlankSourceJob(job)) retryBlankSourceJobs.push(job);
			completed += 1;
			reportProgress(completed, job.timing);
		}
		if (retryBlankSourceJobs.length > 0) {
			await emitExportLog('warn', 'Retrying blank source layout timeouts', {
				jobs: retryBlankSourceJobs.length,
				subfolder
			});
			for (const job of retryBlankSourceJobs) {
				await captureBlankSourceJob(job);
			}
		}

		const completedBeforeCaptures = completed;
		if (plan.captureJobs.length > 0) {
			if (plan.workerBuckets.length <= 1) {
				await closeCaptureWorkerRenderers();
				await runSerialCaptureJobs(plan.captureJobs, subfolder, (captureCompleted, timing) => {
					reportProgress(completedBeforeCaptures + captureCompleted, timing);
				});
			} else {
				try {
					await runParallelCaptureJobs(plan.workerBuckets, subfolder, (captureCompleted) => {
						reportProgress(completedBeforeCaptures + captureCompleted);
					});
				} catch (error) {
					console.error('Parallel capture failed, retrying serial capture:', error);
					await emitExportLog('warn', 'Parallel capture failed, retrying serial capture', {
						error: error instanceof Error ? error.message : String(error)
					});
					await closeCaptureWorkerRenderers();
					await runSerialCaptureJobs(plan.captureJobs, subfolder, (captureCompleted, timing) => {
						reportProgress(completedBeforeCaptures + captureCompleted, timing);
					});
				}
			}
			completed = completedBeforeCaptures + plan.captureJobs.length;
		}

		const completedBeforeCopies = completed;
		await runCopyJobs(plan.copyJobs, subfolder, (copyCompleted, timing) => {
			reportProgress(completedBeforeCopies + copyCompleted, timing);
		});
		await emitExportLog('info', 'Image capture plan completed', { totalJobs, subfolder });
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

	/**
	 * Rend et concatène tous les segments dans une seule commande native résistante à la suspension.
	 * @param {BlurSegment[]} renderSegments Segments visuels déjà capturés.
	 * @param {Map<number, number[]>} blankImageIndexes Images sans sous-titres par segment.
	 * @returns {Promise<string>} URI Android du fichier final publié.
	 */
	async function generateSegmentedVideo(
		renderSegments: BlurSegment[],
		blankImageIndexes: Map<number, number[]>
	): Promise<string> {
		if (!exportData?.destinationUri) throw new Error('ANDROID_EXPORT_DESTINATION_MISSING');
		currentVideoExportState = ExportState.AddingSubtitles;
		const exportFadeSettings = getExportFadeSettings();
		const fadeDuration = Math.round(
			globalState.getStyle('global', 'fade-duration')!.value as number
		);
		const { audios, audioClips } = getAudioExportInputs();
		const videos = getVideoExportInputs();
		const extension = globalState.getExportState.exportWithoutBackground
			? globalState.getExportState.transparentExportFormat === 'webm_vp9_alpha'
				? 'webm'
				: 'mov'
			: 'mp4';
		const exportRoot = await join(await appDataDir(), ExportService.exportFolder, exportId);
		const segments = await Promise.all(
			renderSegments.map(async (segment, index) => ({
				imgsFolder: await join(exportRoot, `segment_${index}`),
				finalFilePath: await join(exportRoot, `segment_${index}_video.${extension}`),
				startTime: Math.round(segment.start),
				duration: Math.round(segment.end - segment.start),
				blur: segment.blur,
				blankTimings: blankImageIndexes.get(index) ?? []
			}))
		);
		const nativeExport = invoke<string>('export_segmented_video', {
			exportId,
			segments,
			outputPath: exportData!.finalFilePath,
			destinationUri: exportData!.destinationUri,
			fps: exportData!.fps,
			fadeDuration,
			audios,
			audioClips,
			audioVolume: globalState.getAudioTrack.volumePercent,
			videos,
			mediaFill: Boolean(globalState.getStyle('global', 'media-fill')?.value),
			mediaScale: Number(globalState.getStyle('global', 'media-scale')?.value ?? 100),
			mediaPositionX: Number(globalState.getStyle('global', 'media-position-x')?.value ?? 0),
			mediaPositionY: Number(globalState.getStyle('global', 'media-position-y')?.value ?? 0),
			videoFadeInEnabled: exportFadeSettings.videoFadeInEnabled,
			videoFadeOutEnabled: exportFadeSettings.videoFadeOutEnabled,
			audioFadeInEnabled: exportFadeSettings.audioFadeInEnabled,
			audioFadeOutEnabled: exportFadeSettings.audioFadeOutEnabled,
			exportFadeDurationMs: Math.max(0, exportFadeSettings.fadeDurationMs || 0),
			performanceProfile: globalState.settings?.exportSettings.performanceProfile ?? 'balanced',
			videoCodec: globalState.settings?.exportSettings.videoCodec ?? 'h264',
			videoClipTransitionMode: getVideoClipTransitionMode(),
			videoClipTransitionDurationMs: getVideoClipTransitionDurationMs(),
			exportWithoutBackground: globalState.getExportState.exportWithoutBackground ?? false,
			transparentExportFormat: globalState.getExportState.transparentExportFormat
		});
		await markAndroidExportBackgroundReady();
		const publishedPath = await nativeExport;
		exportForegroundServiceStarted = false;
		pendingNotificationUpdate = null;
		return publishedPath;
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
		await closeCaptureWorkerRenderers();

		const normalizedBlankTimings = plan.blankImageIndexes;

		await ExportService.deleteProjectFile(Number(exportId));
		await deleteBlankImages();

		// Générer la vidéo normale
		const publishedFilePath = await generateNormalVideo(
			exportStart,
			totalDuration,
			blur,
			normalizedBlankTimings
		);
		const fileSizeBytes = await getGeneratedFileSizeBytes();

		await emitProgress({
			exportId: Number(exportId),
			progress: 100,
			currentState: ExportState.Exported,
			currentTime: totalDuration,
			totalTime: totalDuration,
			finalFilePath: publishedFilePath,
			fileSizeBytes,
			nativeNotificationCompleted: true
		} as ExportProgress);

		// Nettoyage
		await finalCleanup();
	}

	/**
	 * Retourne les overlays temporises qui peuvent changer l'etat visuel d'une capture.
	 * @returns {ExportTimedOverlayCaptureClip[]} Clips d'overlays pris en compte pendant l'export.
	 */
	function getTimedOverlayCaptureClips(): ExportTimedOverlayCaptureClip[] {
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

		const globalStyles = globalState.getVideoStyle.getStylesOfTarget('global');
		const surahName = resolveTimedVisualState(globalStyles, {
			enabled: 'show-surah-name',
			alwaysShow: 'surah-name-always-show',
			startTime: 'surah-name-time-appearance',
			endTime: 'surah-name-time-disappearance'
		});
		if (surahName.enabled) {
			timedOverlayClips.push({
				id: 'surah-name',
				startTime: surahName.startTime,
				endTime: surahName.endTime,
				alwaysShow: surahName.alwaysShow
			});
		}

		const reciterName = resolveTimedVisualState(globalStyles, {
			enabled: 'show-reciter-name',
			alwaysShow: 'reciter-name-always-show',
			startTime: 'reciter-name-time-appearance',
			endTime: 'reciter-name-time-disappearance'
		});
		if (reciterName.enabled && globalState.currentProject?.detail.reciter !== 'not set') {
			timedOverlayClips.push({
				id: 'reciter-name',
				startTime: reciterName.startTime,
				endTime: reciterName.endTime,
				alwaysShow: reciterName.alwaysShow
			});
		}

		if (globalState.getStyle('global', 'ayah-container-image')?.value) {
			timedOverlayClips.push({
				id: 'ayah-container',
				startTime: globalState.getStyle('global', 'time-appearance')!.value as number,
				endTime: globalState.getStyle('global', 'time-disappearance')!.value as number,
				alwaysShow: Boolean(globalState.getStyle('global', 'always-show')!.value)
			});
		}

		for (const stylesData of globalState.getVideoStyle.styles) {
			if (stylesData.target === 'global') continue;
			if (stylesData.findStyle('background-enable')?.value !== true) continue;
			if (stylesData.findStyle('always-show')?.value === true) continue;

			timedOverlayClips.push({
				id: `${stylesData.target}-background-container`,
				startTime: stylesData.findStyle('time-appearance')?.value as number,
				endTime: stylesData.findStyle('time-disappearance')?.value as number,
				alwaysShow: false,
				preventBlankReuse: true
			});
		}

		return timedOverlayClips;
	}

	function calculateTimingsForRange(rangeStart: number, rangeEnd: number) {
		const subtitleClips: ExportSubtitleCaptureClip[] = globalState.getSubtitleTrack.clips.map(
			(clip) => {
				const wbwHighlightTimings =
					clip instanceof SubtitleClip ? getExportWordByWordHighlightTimings(clip) : undefined;
				const wbwHiddenArabicTimings =
					clip instanceof SubtitleClip ? getExportWordByWordHiddenArabicTimings(clip) : undefined;

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
					verse: 'verse' in clip && typeof clip.verse === 'number' ? clip.verse : undefined,
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
					wbwHighlightTimings,
					wbwHiddenArabicTimings
				};
			}
		);

		return calculateCaptureTimingsForRange({
			rangeStart,
			rangeEnd,
			fadeDuration: Math.round(globalState.getStyle('global', 'fade-duration')!.value as number),
			subtitleClips,
			timedOverlayClips: getTimedOverlayCaptureClips(),
			getCurrentSurah: (time) => globalState.getSubtitleTrack.getCurrentSurah(time),
			showVerseNumber: Boolean(globalState.getStyle('global', 'show-verse-number')!.value)
		});
	}

	/**
	 * Prépare les options communes pour les helpers WBW d'export.
	 * @param {SubtitleClip} clip Clip Quran à inspecter.
	 * @returns {ExportSubtitleWbwTimingOptions} Options prêtes pour les helpers de timing.
	 */
	function getExportWordByWordTimingOptions(clip: SubtitleClip): ExportSubtitleWbwTimingOptions {
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

		return {
			clip: exportClip,
			subtitleClips: exportSubtitleClips,
			isWbwEnabledForClipId: (clipId) =>
				isWordByWordVisualEnabled((styleId) =>
					globalState.getVideoStyle
						.getStylesOfTarget('arabic')
						.getEffectiveValue(styleId as StyleName, clipId)
				),
			isShowCurrentWordOnlyEnabledForClipId: (clipId) =>
				Boolean(
					globalState.getVideoStyle
						.getStylesOfTarget('arabic')
						.getEffectiveValue('wbw-show-current-word-only', clipId)
				)
		};
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

		const arabicTimings = getExportWordByWordHighlightTimingsUtil(
			getExportWordByWordTimingOptions(clip)
		);

		const translationTimings = getExportTranslationWordByWordHighlightTimings(clip, subtitleClips);
		const timings = [...(arabicTimings ?? []), ...(translationTimings ?? [])];
		return timings.length > 0 ? Array.from(new Set(timings)).sort((a, b) => a - b) : undefined;
	}

	/**
	 * Retourne les timings WBW ou le texte arabe doit être forcé invisible pendant l'export.
	 * @param {SubtitleClip} clip Clip Quran à inspecter.
	 * @returns {number[] | undefined} Timings absolus en millisecondes, ou `undefined`.
	 */
	function getExportWordByWordHiddenArabicTimings(clip: SubtitleClip): number[] | undefined {
		const timings = getExportWordByWordHiddenArabicTimingsUtil(
			getExportWordByWordTimingOptions(clip)
		);
		return timings.length > 0 ? timings : undefined;
	}

	/**
	 * Retourne les timings WBW issus des mappings de traduction visibles.
	 *
	 * @param {SubtitleClip} clip Clip Quran à inspecter.
	 * @param {SubtitleClip[]} subtitleClips Clips Quran du projet.
	 * @returns {number[] | undefined} Timings absolus en millisecondes, ou `undefined`.
	 */
	function getExportTranslationWordByWordHighlightTimings(
		clip: SubtitleClip,
		subtitleClips: SubtitleClip[]
	): number[] | undefined {
		const sourceClips =
			clip.visualMergeGroupId &&
			(clip.visualMergeMode === 'translation' || clip.visualMergeMode === 'both')
				? subtitleClips.filter(
						(candidate) =>
							candidate.visualMergeGroupId === clip.visualMergeGroupId &&
							candidate.visualMergeMode === clip.visualMergeMode
					)
				: [clip];
		const mergedClips = sourceClips.length > 0 ? sourceClips : [clip];

		const timings = mergedClips.flatMap((sourceClip) => {
			if ((sourceClip.alignmentMetadata?.words.length ?? 0) === 0) return [];
			const arabicWordCount = sourceClip
				.getArabicRenderParts()
				.text.split(' ')
				.filter(Boolean).length;
			const baseTimeS = sourceClip.alignmentMetadata?.timeFrom ?? sourceClip.startTime / 1000;

			return globalState.getProjectTranslation.addedTranslationEditions.flatMap((edition) => {
				if (!globalState.getVideoStyle.doesTargetStyleExist(edition.name)) return [];

				const styles = globalState.getVideoStyle.getStylesOfTarget(edition.name);
				const isVisible = Boolean(styles.getEffectiveValue('show-subtitles', sourceClip.id));
				const isWbwEnabled = isWordByWordVisualEnabled((styleId) =>
					styles.getEffectiveValue(styleId as StyleName, sourceClip.id)
				);
				if (!isVisible || !isWbwEnabled) return [];

				const translation = sourceClip.translations[edition.name];
				if (!(translation instanceof VerseTranslation)) return [];

				const ranges = translation.getNormalizedWbwRanges(arabicWordCount);
				if (ranges.length === 0) return [];

				return ranges
					.map((range) => sourceClip.alignmentMetadata?.words[range.arabicWordIndex])
					.filter((word): word is NonNullable<typeof word> => word !== undefined)
					.map((word) => Math.round((baseTimeS + word.start) * 1000))
					.filter((timing) => timing >= sourceClip.startTime && timing <= sourceClip.endTime);
			});
		});

		return timings.length > 0
			? Array.from(new Set<number>(timings)).sort((a, b) => a - b)
			: undefined;
	}

	async function generateNormalVideo(
		exportStart: number,
		duration: number,
		blur: number,
		blankTimings: number[] = []
	): Promise<string> {
		if (!exportData?.destinationUri) throw new Error('ANDROID_EXPORT_DESTINATION_MISSING');
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

		const { audios, audioClips } = getAudioExportInputs();
		const videos = getVideoExportInputs();

		console.log(exportData!.finalFilePath);

		// Supprimer les images blanks avant l'export vidéo
		await deleteBlankImages();

		try {
			const nativeExport = invoke<string>('export_video', {
				exportId: exportId,
				imgsFolder: await join(await appDataDir(), ExportService.exportFolder, exportId),
				finalFilePath: exportData!.finalFilePath,
				destinationUri: exportData!.destinationUri,
				fps: exportData!.fps,
				fadeDuration: fadeDuration,
				startTime: exportStart,
				duration: Math.round(duration),
				audios: audios,
				audioClips,
				audioVolume: globalState.getAudioTrack.volumePercent,
				videos: videos,
				mediaFill: Boolean(globalState.getStyle('global', 'media-fill')?.value),
				mediaScale: Number(globalState.getStyle('global', 'media-scale')?.value ?? 100),
				mediaPositionX: Number(globalState.getStyle('global', 'media-position-x')?.value ?? 0),
				mediaPositionY: Number(globalState.getStyle('global', 'media-position-y')?.value ?? 0),
				blur: blur,
				videoFadeInEnabled: exportFadeSettings.videoFadeInEnabled,
				videoFadeOutEnabled: exportFadeSettings.videoFadeOutEnabled,
				audioFadeInEnabled: exportFadeSettings.audioFadeInEnabled,
				audioFadeOutEnabled: exportFadeSettings.audioFadeOutEnabled,
				exportFadeDurationMs: Math.max(0, exportFadeSettings.fadeDurationMs || 0),
				performanceProfile: globalState.settings?.exportSettings.performanceProfile ?? 'balanced',
				videoCodec: globalState.settings?.exportSettings.videoCodec ?? 'h264',
				videoClipTransitionMode: getVideoClipTransitionMode(),
				videoClipTransitionDurationMs: getVideoClipTransitionDurationMs(),
				blankTimings,
				exportWithoutBackground: globalState.getExportState.exportWithoutBackground ?? false,
				transparentExportFormat: globalState.getExportState.transparentExportFormat
			});
			await markAndroidExportBackgroundReady();
			const publishedPath = await nativeExport;
			exportForegroundServiceStarted = false;
			pendingNotificationUpdate = null;
			return publishedPath;
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
		if (cleanupStarted) return;
		cleanupStarted = true;
		destroyReusableScreenshotContext();
		destroyPngEncoderWorker();
		try {
			await closeCaptureWorkerRenderers();
		} catch (error) {
			console.warn('Could not close capture workers:', error);
		}
		await setExportScreenAwake(false);
		await stopAndroidExportForegroundService();
		await ExportService.deleteProjectFile(Number(exportId));
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

		try {
			await emit('export-renderer-finished-main', { exportId });
		} catch (error) {
			console.warn('Could not emit renderer completion:', error);
		}
		if (window.parent !== window) {
			window.parent.postMessage({ type: 'export-renderer-finished-main', exportId }, '*');
		}
	}

	/**
	 * Lit la taille du rendu local avant la suppression du dossier temporaire.
	 * @returns {Promise<number | undefined>} Taille du fichier en octets, si disponible.
	 */
	async function getGeneratedFileSizeBytes(): Promise<number | undefined> {
		try {
			return (await stat(exportData!.finalFilePath)).size;
		} catch (error) {
			console.warn('Could not read generated file size:', error);
			return undefined;
		}
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

	/**
	 * Détruit le contexte de capture DOM partagé par le renderer courant.
	 * @returns {void}
	 */
	function destroyReusableScreenshotContext(): void {
		if (!reusableScreenshotContext) return;
		destroyContext(reusableScreenshotContext);
		reusableScreenshotContext = null;
		reusableScreenshotContextKey = '';
	}

	/**
	 * Retourne un contexte modern-screenshot réutilisable pour les dimensions demandées.
	 * @param {HTMLElement} node Racine DOM à capturer.
	 * @param {number} width Largeur finale de capture.
	 * @param {number} height Hauteur finale de capture.
	 * @param {number} scale Échelle appliquée à la racine.
	 * @returns {Promise<ScreenshotContext<HTMLElement>>} Contexte prêt pour la prochaine capture.
	 */
	async function getReusableScreenshotContext(
		node: HTMLElement,
		width: number,
		height: number,
		scale: number
	): Promise<ScreenshotContext<HTMLElement>> {
		const contextKey = `${node.clientWidth}:${node.clientHeight}:${width}:${height}:${scale}`;
		if (reusableScreenshotContext && reusableScreenshotContextKey === contextKey) {
			return reusableScreenshotContext;
		}

		destroyReusableScreenshotContext();
		reusableScreenshotContext = await createContext(node, {
			width,
			height,
			style: {
				// Garder la logique historique de mise a l'echelle pour preserver le centrage.
				transform: 'scale(' + scale + ')',
				transformOrigin: 'top left'
			},
			quality: 1,
			autoDestruct: false,
			onCloneNode: () => {
				const now = performance.now();
				screenshotDomPhases.cloneMs = now - screenshotDomPhases.startedAt;
			},
			onEmbedNode: () => {
				const now = performance.now();
				screenshotDomPhases.embedMs =
					now - screenshotDomPhases.startedAt - screenshotDomPhases.cloneMs;
			},
			onCreateForeignObjectSvg: () => {
				const now = performance.now();
				screenshotDomPhases.foreignObjectMs =
					now -
					screenshotDomPhases.startedAt -
					screenshotDomPhases.cloneMs -
					screenshotDomPhases.embedMs;
			}
		});
		reusableScreenshotContextKey = contextKey;
		return reusableScreenshotContext;
	}

	/**
	 * Résout une réponse de l'encodeur PNG exécuté dans le Web Worker.
	 * @param {MessageEvent<PngEncoderWorkerResponse>} event Réponse du worker.
	 * @returns {void}
	 */
	function handlePngEncoderWorkerMessage(event: MessageEvent<PngEncoderWorkerResponse>): void {
		const pending = pendingPngEncodings.get(event.data.requestId);
		if (!pending) return;
		pendingPngEncodings.delete(event.data.requestId);

		if (event.data.error || !event.data.blob) {
			pending.reject(new Error(event.data.error || 'ANDROID_PNG_WORKER_EMPTY_RESULT'));
			return;
		}

		pending.resolve({
			blob: event.data.blob,
			durationMs: event.data.durationMs ?? 0
		});
	}

	/**
	 * Désactive l'encodeur PNG worker après une erreur d'exécution.
	 * @param {ErrorEvent} event Erreur remontée par le worker.
	 * @returns {void}
	 */
	function handlePngEncoderWorkerError(event: ErrorEvent): void {
		pngEncoderWorkerUnavailable = true;
		pngEncoderWorkerFallbackReason = event.message || 'ANDROID_PNG_WORKER_FAILED';
		const error = new Error(event.message || 'ANDROID_PNG_WORKER_FAILED');
		for (const pending of pendingPngEncodings.values()) pending.reject(error);
		pendingPngEncodings.clear();
		pngEncoderWorker?.terminate();
		pngEncoderWorker = null;
	}

	/**
	 * Retourne l'encodeur PNG worker lorsqu'il est supporté par la WebView.
	 * @returns {Worker | null} Worker partagé ou null lorsque le fallback est requis.
	 */
	function getPngEncoderWorker(): Worker | null {
		if (pngEncoderWorkerUnavailable) return null;
		if (
			typeof Worker === 'undefined' ||
			typeof OffscreenCanvas === 'undefined' ||
			typeof createImageBitmap === 'undefined'
		) {
			pngEncoderWorkerUnavailable = true;
			pngEncoderWorkerFallbackReason = 'ANDROID_PNG_WORKER_UNSUPPORTED';
			return null;
		}
		if (pngEncoderWorker) return pngEncoderWorker;

		try {
			pngEncoderWorker = new Worker(new URL('./PngEncoder.worker.ts', import.meta.url), {
				type: 'module'
			});
			pngEncoderWorker.addEventListener('message', handlePngEncoderWorkerMessage);
			pngEncoderWorker.addEventListener('error', handlePngEncoderWorkerError);
			return pngEncoderWorker;
		} catch (error) {
			console.warn('Unable to create Android PNG encoder worker:', error);
			pngEncoderWorkerUnavailable = true;
			pngEncoderWorkerFallbackReason = error instanceof Error ? error.message : String(error);
			return null;
		}
	}

	/**
	 * Arrête l'encodeur PNG worker et rejette ses requêtes encore actives.
	 * @returns {void}
	 */
	function destroyPngEncoderWorker(): void {
		const error = new Error('ANDROID_PNG_WORKER_DESTROYED');
		for (const pending of pendingPngEncodings.values()) pending.reject(error);
		pendingPngEncodings.clear();
		pngEncoderWorker?.terminate();
		pngEncoderWorker = null;
	}

	/**
	 * Encode un canvas en PNG sur le thread principal en solution de repli.
	 * @param {HTMLCanvasElement} canvas Canvas final à encoder.
	 * @returns {Promise<Blob>} Image PNG encodée.
	 */
	async function encodeScreenshotCanvasAsPngOnMainThread(canvas: HTMLCanvasElement): Promise<Blob> {
		return await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob((blob) => {
				if (blob) resolve(blob);
				else reject(new Error('EXPORT_SCREENSHOT_PNG_ENCODING_FAILED'));
			}, 'image/png');
		});
	}

	/**
	 * Encode un canvas en PNG dans un worker pour éviter l'attente idle de Chromium Android.
	 * @param {HTMLCanvasElement} canvas Canvas final à encoder.
	 * @returns {Promise<Blob>} Image PNG encodée.
	 */
	async function encodeScreenshotCanvasAsPng(canvas: HTMLCanvasElement): Promise<Blob> {
		lastPngEncodingMode = 'main-thread';
		lastImageBitmapMs = 0;
		lastWorkerEncodeMs = 0;
		const worker = getPngEncoderWorker();
		if (!worker) return await encodeScreenshotCanvasAsPngOnMainThread(canvas);

		let bitmap: ImageBitmap | null = null;
		const requestId = pngEncoderRequestSequence++;
		try {
			const imageBitmapStartedAt = performance.now();
			bitmap = await createImageBitmap(canvas);
			lastImageBitmapMs = performance.now() - imageBitmapStartedAt;
			const resultPromise = new Promise<{ blob: Blob; durationMs: number }>((resolve, reject) => {
				pendingPngEncodings.set(requestId, { resolve, reject });
			});

			try {
				worker.postMessage({ requestId, bitmap }, [bitmap]);
				bitmap = null;
			} catch (error) {
				pendingPngEncodings.delete(requestId);
				throw error;
			}

			const result = await resultPromise;
			lastPngEncodingMode = 'worker';
			lastWorkerEncodeMs = result.durationMs;
			return result.blob;
		} catch (error) {
			bitmap?.close();
			console.warn('Android PNG worker failed, using main-thread fallback:', error);
			pngEncoderWorkerUnavailable = true;
			pngEncoderWorkerFallbackReason = error instanceof Error ? error.message : String(error);
			destroyPngEncoderWorker();
			return await encodeScreenshotCanvasAsPngOnMainThread(canvas);
		}
	}

	async function takeScreenshot(
		fileName: string,
		subfolder: string | null = null,
		reusableBlankFileName: string | null = null,
		hideArabicText: boolean = false
	) {
		const screenshotStartedAt = performance.now();
		// L'element a transformer en image
		const node = document.getElementById('overlay')!;

		// Pour les blanks, forcer les overlays (surahName, reciterName, customText) à leur opacité max
		// afin d'éviter une capture en cours de fade-in, et masquer les sous-titres (arabe/traduction).
		const isBlankScreenshot = fileName.startsWith('blank_');
		const forcedOverlayElements: { el: HTMLElement; prev: string }[] = [];
		const forcedArabicTextElements: { el: HTMLElement; prev: string }[] = [];
		if (isBlankScreenshot) {
			const keepSubtitleBackgrounds = hasVisibleSubtitleBackground(node);
			node.querySelectorAll<HTMLElement>('[data-overlay-max-opacity]').forEach((el) => {
				forcedOverlayElements.push({ el, prev: el.style.opacity });
				el.style.opacity = el.dataset.overlayMaxOpacity!;
			});
			for (const id of [
				'subtitles-container',
				...(keepSubtitleBackgrounds ? [] : ['subtitles-backgrounds'])
			]) {
				const el = node.querySelector<HTMLElement>(`#${id}`);
				if (el) forcedOverlayElements.push({ el, prev: el.style.opacity });
				if (el) el.style.opacity = '0';
			}
		}
		if (hideArabicText) {
			node.querySelectorAll<HTMLElement>('#subtitles-container .arabic *').forEach((el) => {
				forcedArabicTextElements.push({ el, prev: el.style.visibility });
				el.style.visibility = 'hidden';
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

		try {
			const pathComponents = [ExportService.exportFolder, exportId];
			if (subfolder) pathComponents.push(subfolder);
			pathComponents.push(fileName + '.png');

			const filePathWithName = await join(...pathComponents);

			const isMacOS = shouldRedrawExportTextWithCanvas();

			const useLiveTextCanvasCapture = isMacOS;
			await emitExportLog('info', 'Screenshot started', {
				file: fileName,
				subfolder,
				isMacOS,
				width: targetWidth,
				height: targetHeight,
				scale
			});
			if (!useLiveTextCanvasCapture) {
				const fontSubsetStartedAt = performance.now();
				const restoreSystemFonts = await QPCFontProvider.applySystemFontSubsetsForScreenshot(node);
				const fontSubsetMs = performance.now() - fontSubsetStartedAt;
				let blob: Blob | null = null;
				let contextMs = 0;
				let domCaptureMs = 0;
				let cloneMs = 0;
				let embedMs = 0;
				let rasterMs = 0;
				let pngEncodeMs = 0;
				try {
					const contextStartedAt = performance.now();
					const context = await getReusableScreenshotContext(
						node,
						node.clientWidth * scale,
						node.clientHeight * scale,
						scale
					);
					contextMs = performance.now() - contextStartedAt;
					context.fontFamilies.clear();
					context.shadowRoots.length = 0;
					screenshotDomPhases = {
						startedAt: performance.now(),
						cloneMs: 0,
						embedMs: 0,
						foreignObjectMs: 0
					};
					const domCaptureStartedAt = performance.now();
					const rasterStartedAt = performance.now();
					const canvas = await withScreenshotTimeout(domToCanvas(context));
					rasterMs = performance.now() - rasterStartedAt;
					const pngEncodeStartedAt = performance.now();
					blob = await withScreenshotTimeout(encodeScreenshotCanvasAsPng(canvas));
					pngEncodeMs = performance.now() - pngEncodeStartedAt;
					domCaptureMs = performance.now() - domCaptureStartedAt;
					cloneMs = screenshotDomPhases.cloneMs;
					embedMs = screenshotDomPhases.embedMs;
				} finally {
					restoreSystemFonts();
				}

				const blobReadStartedAt = performance.now();
				const buffer = await blob.arrayBuffer();
				const bytes = new Uint8Array(buffer);
				const byteLength = bytes.byteLength;
				const blobReadMs = performance.now() - blobReadStartedAt;

				const writeStartedAt = performance.now();
				await writeFile(filePathWithName, bytes, { baseDir: BaseDirectory.AppData });
				const writeMs = performance.now() - writeStartedAt;
				const totalMs = performance.now() - screenshotStartedAt;
				screenshotPerformance.count += 1;
				screenshotPerformance.totalMs += totalMs;
				screenshotPerformance.maxMs = Math.max(screenshotPerformance.maxMs, totalMs);
				screenshotPerformance.contextMs += contextMs;
				screenshotPerformance.fontSubsetMs += fontSubsetMs;
				screenshotPerformance.cloneMs += cloneMs;
				screenshotPerformance.embedMs += embedMs;
				screenshotPerformance.rasterMs += rasterMs;
				screenshotPerformance.pngEncodeMs += pngEncodeMs;
				screenshotPerformance.domCaptureMs += domCaptureMs;
				screenshotPerformance.blobReadMs += blobReadMs;
				screenshotPerformance.writeMs += writeMs;
				screenshotPerformance.bytes += byteLength;
				console.log('Screenshot saved to:', filePathWithName);
				await emitExportLog('info', 'Screenshot performance', {
					file: fileName,
					totalMs: Math.round(totalMs),
					contextMs: Math.round(contextMs),
					fontSubsetMs: Math.round(fontSubsetMs),
					cloneMs: Math.round(cloneMs),
					embedMs: Math.round(embedMs),
					rasterMs: Math.round(rasterMs),
					pngEncodeMs: Math.round(pngEncodeMs),
					pngEncodingMode: lastPngEncodingMode,
					pngWorkerFallbackReason: pngEncoderWorkerFallbackReason,
					imageBitmapMs: Math.round(lastImageBitmapMs),
					workerEncodeMs: Math.round(lastWorkerEncodeMs),
					domCaptureMs: Math.round(domCaptureMs),
					blobReadMs: Math.round(blobReadMs),
					writeMs: Math.round(writeMs),
					bytes: byteLength
				});
				await emitExportLog('info', 'Screenshot saved', {
					file: fileName,
					path: filePathWithName
				});
			} else {
				const backgroundBlob = hasVisibleSubtitleBackground(node)
					? null
					: await readReusableBlankBlob(reusableBlankFileName);
				await emitExportLog('info', 'macOS canvas capture started', {
					file: fileName,
					reusableBlank: reusableBlankFileName,
					backgroundReused: Boolean(backgroundBlob)
				});
				const bytes = await captureMacOsOverlayPngBytes(node, scale, targetWidth, targetHeight, {
					backgroundBlob,
					compensateTextWeight: isMacOS,
					textRootSelector: backgroundBlob ? '#subtitles-container' : undefined
				});

				await writeFile(filePathWithName, bytes, { baseDir: BaseDirectory.AppData });
				console.log('Screenshot saved to:', filePathWithName);
				await emitExportLog('info', 'Screenshot saved', {
					file: fileName,
					path: filePathWithName
				});
			}
		} catch (error: unknown) {
			console.error('Error while taking screenshot: ', error);
			const message =
				error && typeof error === 'object' && 'message' in error
					? String((error as { message?: unknown }).message ?? '')
					: String(error ?? 'Unknown error');
			await emitExportLog('error', 'Screenshot failed', {
				file: fileName,
				error: message
			});
			toast.error(get(LL).editor.exportScreenshotError({ error: message }));
			throw error;
		} finally {
			// Restaurer l'opacité originale des overlays forcés
			for (const { el, prev } of forcedOverlayElements) {
				el.style.opacity = prev;
			}
			for (const { el, prev } of forcedArabicTextElements) {
				el.style.visibility = prev;
			}
		}
	}

	/**
	 * Empêche une capture DOM Android de laisser l'export bloqué indéfiniment.
	 * @param {Promise<T>} capture Étape de capture en cours.
	 * @returns {Promise<T>} Résultat de l'étape avant expiration.
	 */
	async function withScreenshotTimeout<T>(capture: Promise<T>): Promise<T> {
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				capture,
				new Promise<never>((_, reject) => {
					timeoutId = setTimeout(
						() => reject(new Error('EXPORT_SCREENSHOT_TIMEOUT')),
						SCREENSHOT_TIMEOUT_MS
					);
				})
			]);
		} finally {
			if (timeoutId !== undefined) clearTimeout(timeoutId);
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
	 * Attend la prochaine frame navigateur.
	 * @returns {Promise<void>} Promise resolue apres un repaint.
	 */
	async function waitForAnimationFrame(): Promise<void> {
		await new Promise<void>((resolve) => {
			// En WebView d'export macOS, requestAnimationFrame peut etre suspendu.
			const fallback = window.setTimeout(resolve, 50);
			requestAnimationFrame(() => {
				window.clearTimeout(fallback);
				resolve();
			});
		});
	}

	/**
	 * Indique si le conteneur de sous-titres est pret pour un timing d'export.
	 * @param {HTMLElement} subtitlesContainer Conteneur de sous-titres.
	 * @param {string} timingKey Timing attendu.
	 * @returns {boolean} true si le layout async est termine pour ce timing.
	 */
	function isSubtitleLayoutReady(subtitlesContainer: HTMLElement, timingKey: string): boolean {
		// Ne pas vérifier l'opacité ici: macOS peut ne jamais exposer exactement "1".
		return (
			subtitlesContainer.dataset.exportLayoutTiming === timingKey &&
			subtitlesContainer.dataset.exportLayoutState === 'ready'
		);
	}

	/**
	 * Attend que le layout de sous-titres soit stable avant une capture.
	 * @param {number} timing Timing capture courant.
	 * @returns {Promise<boolean>} true si l'attente a atteint le timeout.
	 */
	async function wait(timing: number): Promise<boolean> {
		// globalState.updateVideoPreviewUI();
		console.log(`Waiting for frame at ${timing}ms...`);

		await waitForAnimationFrame();

		const timingKey = String(Math.round(timing));
		const expectsSubtitle = Boolean(globalState.getSubtitleTrack.getCurrentSubtitleToDisplay());
		const startTime = Date.now();
		const timeout = 10_000;
		await emitExportLog('info', 'Layout wait started', {
			timing,
			timingKey,
			expectsSubtitle
		});

		while (Date.now() - startTime <= timeout) {
			ensureCaptureNotCancelled();
			const subtitlesContainer = document.getElementById(
				'subtitles-container'
			) as HTMLElement | null;

			if (!expectsSubtitle) {
				if (!subtitlesContainer || isSubtitleLayoutReady(subtitlesContainer, timingKey)) break;
			} else if (subtitlesContainer && isSubtitleLayoutReady(subtitlesContainer, timingKey)) {
				break;
			}

			await new Promise((resolve) => setTimeout(resolve, 20));
		}

		const subtitlesContainer = document.getElementById('subtitles-container') as HTMLElement | null;
		let layoutTimedOut = false;
		if (
			expectsSubtitle &&
			(!subtitlesContainer || !isSubtitleLayoutReady(subtitlesContainer, timingKey))
		) {
			layoutTimedOut = true;
			await emitExportLog('warn', 'Layout wait timed out, continuing capture', {
				timing,
				timingKey,
				expectsSubtitle,
				hasContainer: Boolean(subtitlesContainer),
				layoutTiming: subtitlesContainer?.dataset.exportLayoutTiming,
				layoutState: subtitlesContainer?.dataset.exportLayoutState
			});
		}
		if (
			!expectsSubtitle &&
			subtitlesContainer &&
			!isSubtitleLayoutReady(subtitlesContainer, timingKey)
		) {
			layoutTimedOut = true;
			await emitExportLog('warn', 'Layout clear wait timed out, continuing capture', {
				timing,
				timingKey,
				expectsSubtitle,
				hasContainer: true,
				layoutTiming: subtitlesContainer.dataset.exportLayoutTiming,
				layoutState: subtitlesContainer.dataset.exportLayoutState
			});
		}
		await emitExportLog(layoutTimedOut ? 'warn' : 'info', 'Layout wait completed', {
			timing,
			timingKey,
			expectsSubtitle,
			elapsedMs: Date.now() - startTime,
			hasContainer: Boolean(subtitlesContainer),
			layoutTiming: subtitlesContainer?.dataset.exportLayoutTiming,
			layoutState: subtitlesContainer?.dataset.exportLayoutState
		});

		await waitForAnimationFrame();
		ensureCaptureNotCancelled();
		await emitExportLog('info', 'Waiting for capture fonts', { timing });
		const fontWaitStartedAt = performance.now();
		await QPCFontProvider.waitForFontsInElement(document.getElementById('overlay'));
		ensureCaptureNotCancelled();
		await emitExportLog('info', 'Fonts ready for capture', {
			timing,
			elapsedMs: Math.round(performance.now() - fontWaitStartedAt)
		});
		return layoutTimedOut;
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
