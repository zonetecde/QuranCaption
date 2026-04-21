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
	import {
		buildBlurSegmentsForRange,
		type BlurSegment,
		type TimeRange
	} from '$lib/services/OverlayBlurSegmentation';
	import {
		calculateCaptureTimingsForRange,
		hasBlankImg,
		hasTiming,
		type ExportTimedOverlayCaptureClip,
		type ExportSubtitleCaptureClip
	} from '$lib/services/ExportCaptureTiming';
	import type { ExportFadeSettings } from '$lib/components/projectEditor/tabs/subtitlesEditor/modal/autoSegmentation/types';
	import QPCFontProvider from '$lib/services/FontProvider';
	import { getAllWindows } from '@tauri-apps/api/window';
	import Exportation, { ExportState } from '$lib/classes/Exportation.svelte';
	import toast from 'svelte-5-french-toast';
	import { domToBlob } from 'modern-screenshot';
	import {
		ClipWithTranslation,
		CustomClip,
		SilenceClip
	} from '$lib/classes/Clip.svelte';

	// Contient l'ID de l'export
	let exportId = '';

	// VideoPreview
	let videoPreview: VideoPreview | undefined = $state(undefined);

	// Récupère les données d'export de la vidéo
	let exportData: Exportation | undefined;

	let activeVideoSegments: TimeRange[] = [];
	let currentRenderingSegmentIndex = 0;
	let isSegmentedVideoExport = false;

	type ExportProgressEvent = {
		payload: {
			progress?: number;
			current_time: number;
			total_time?: number;
			export_id: string;
		};
	};
	type ExportCompleteEvent = { payload: { filename: string; exportId: string } };
	type ExportErrorEvent = {
		payload: { error: string; export_id: string };
	};

	function getExportFadeSettings(): ExportFadeSettings {
		return globalState.getStyle('global', 'video-and-audio-fade')!.value as ExportFadeSettings;
	}

	async function exportProgress(event: ExportProgressEvent) {
		const data = event.payload as {
			progress?: number;
			current_time: number;
			total_time?: number;
			export_id: string;
		};

		// Vérifie que c'est bien pour cette exportation
		if (data.export_id !== exportId) return;

		if (data.progress !== null && data.progress !== undefined) {
			console.log(
				`Export Progress: ${data.progress.toFixed(1)}% (${data.current_time.toFixed(1)}s / ${data.total_time?.toFixed(1)}s)`
			);

			const totalDuration = exportData!.videoEndTime - exportData!.videoStartTime;

			// Calculer le pourcentage global et le temps actuel global
			let globalProgress: number;
			let globalCurrentTime: number;

			if (isSegmentedVideoExport && activeVideoSegments.length > 1) {
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
		(await getAllWindows()).find((w) => w.label === 'main')!.emit('export-progress-main', progress);
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

	onMount(async () => {
		// Ecoute les evenements de progression d'export donnes par Rust
		listen('export-progress', exportProgress);
		listen('export-complete', exportComplete);
		listen('export-error', exportError);

		// Récupère l'id de l'export, qui est en paramètre d'URL
		const id = new URLSearchParams(window.location.search).get('id');
		if (id) {
			exportId = id;

			// Recupere le projet correspondant a cet ID (dans le dossier export, parametre inExportFolder: true)
			globalState.currentProject = await ExportService.loadProject(Number(id));
			removeHiddenTranslationsFromExportProject();

			// Créer le dossier d'export s'il n'existe pas
			await mkdir(await join(ExportService.exportFolder, exportId), {
				baseDir: BaseDirectory.AppData,
				recursive: true
			});

			// Supprime le fichier projet JSON
			ExportService.deleteProjectFile(Number(id));

			// Récupère les données d'export
			exportData = ExportService.findExportById(Number(id))!;

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

			// Démarrer l'export
			await startExport();
		}
	});

	async function startExport() {
		if (!exportData) return;

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

		const generatedVideoFiles: string[] = [];
		for (let segmentIndex = 0; segmentIndex < renderSegments.length; segmentIndex++) {
			const segment = renderSegments[segmentIndex];
			const segmentImageFolder = `segment_${segmentIndex}`;

			await createSegmentImageFolder(segmentImageFolder);
			await generateImagesForSegment(
				segmentIndex,
				segment.start,
				segment.end,
				segmentImageFolder,
				renderSegments.length,
				0,
				100
			);
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
			currentRenderingSegmentIndex = segmentIndex;

			const segmentVideoPath = await generateVideoForSegment(
				segmentIndex,
				segmentImageFolder,
				segment.start,
				segmentDuration,
				segment.blur
			);

			generatedVideoFiles.push(segmentVideoPath);
		}

		await concatenateVideos(generatedVideoFiles);
		await finalCleanup();
		isSegmentedVideoExport = false;

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

	async function generateImagesForSegment(
		segmentIndex: number,
		segmentStart: number,
		segmentEnd: number,
		segmentImageFolder: string,
		totalSegments: number,
		phaseStartProgress: number = 0,
		phaseEndProgress: number = 100
	) {
		const fadeDuration = Math.round(
			globalState.getStyle('global', 'fade-duration')!.value as number
		);

		// Calculer les timings pour ce segment spécifique
		const segmentTimings = calculateTimingsForRange(segmentStart, segmentEnd);

		console.log(
			`Segment ${segmentIndex}: ${segmentTimings.uniqueSorted.length} screenshots to take`
		);

		let i = 0;
		let base = -fadeDuration; // Pour compenser le fade-in du début

		for (const timing of segmentTimings.uniqueSorted) {
			// Calculer l'index de l'image dans ce segment (recommence a 0)
			const imageIndex = Math.max(Math.round(timing - segmentStart + base), 0);

			// Vérifie si ce timing doit être dupliqué depuis un autre
			const sourceTimingForDuplication = Array.from(
				segmentTimings.duplicableTimings.entries()
			).find(
				([target]) => target === timing // target = timing qui doit être dupliqué
			)?.[1];

			// Si c'est dupliquable
			if (sourceTimingForDuplication !== undefined) {
				// Ce timing peut être dupliqué depuis sourceTimingForDuplication
				const sourceIndex = Math.max(
					Math.round(sourceTimingForDuplication - segmentStart - fadeDuration),
					0
				);
				// Prend que un seul screenshot et le duplique
				await duplicateScreenshot(`${sourceIndex}`, imageIndex, segmentImageFolder);
			} else if (
				hasTiming(segmentTimings.blankImgs, timing).hasIt &&
				hasBlankImg(
					segmentTimings.imgWithNothingShown,
					hasTiming(segmentTimings.blankImgs, timing).surah!
				)
			) {
				// Récupérer le numéro de sourate pour ce timing
				const surahInfo = hasTiming(segmentTimings.blankImgs, timing);
				console.log(`Duplicating blank image for surah ${surahInfo.surah} at timing ${timing}`);

				await duplicateScreenshot(`blank_${surahInfo.surah}`, imageIndex, segmentImageFolder);
				console.log('Duplicating screenshot instead of taking new one at', timing);
			} else {
				// Important: le +1 sinon le svg de la sourate est le mauvais
				globalState.getTimelineState.movePreviewTo = timing;
				globalState.getTimelineState.cursorPosition = timing;

				// si la difference entre timing et celui juste avant est grand, attendre un peu plus
				await wait(timing);

				await takeScreenshot(`${imageIndex}`, segmentImageFolder);

				// Verifier si ce timing correspond a une image blank de reference pour une sourate
				for (const [surahStr, blankTiming] of Object.entries(segmentTimings.imgWithNothingShown)) {
					if (timing === blankTiming) {
						// monte de 1 le timing pour avoir le svg correct
						globalState.getTimelineState.movePreviewTo = timing - 1;
						globalState.getTimelineState.cursorPosition = timing - 1;
						await wait(timing - 1);
						const surahNum = Number(surahStr);
						console.log(`Creating blank image for surah ${surahNum} at timing ${timing}`);
						await takeScreenshot(`blank_${surahNum}`);
						console.log(`Blank image created for surah ${surahNum} at timing ${timing}`);
						break; // Une seule sourate par timing
					}
				}

				console.log(
					`Segment ${segmentIndex}: Screenshot taken at timing ${timing} -> image ${imageIndex}`
				);
			}

			base += fadeDuration;
			i++;

			// Toutes les 20 captures, laisser respirer le GC pour éviter l'OOM
			if (i % 20 === 0) {
				await new Promise((resolve) => setTimeout(resolve, 50));
			}

			// Progress pour ce segment dans la phase spécifiée
			const segmentImageProgress = (i / segmentTimings.uniqueSorted.length) * 100;
			const segmentPhaseProgress = (segmentIndex * 100 + segmentImageProgress) / totalSegments;
			const globalProgress =
				phaseStartProgress + (segmentPhaseProgress * (phaseEndProgress - phaseStartProgress)) / 100;

			emitProgress({
				exportId: Number(exportId),
				progress: globalProgress,
				currentState: ExportState.CapturingFrames,
				currentTime: timing - exportData!.videoStartTime,
				totalTime: exportData!.videoEndTime - exportData!.videoStartTime
			} as ExportProgress);
		}
	}

	async function generateVideoForSegment(
		segmentIndex: number,
		segmentImageFolder: string,
		segmentStart: number,
		segmentDuration: number,
		blur: number = globalState.getStyle('global', 'overlay-blur')!.value as number
	): Promise<string> {
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
			(globalState.getExportState.exportWithoutBackground ?? false) ? 'webm' : 'mp4';
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
				batchSize: globalState.settings?.exportSettings.batchSize ?? 12,
				exportWithoutBackground: globalState.getExportState.exportWithoutBackground ?? false
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

		try {
			const finalVideoPath = await invoke('concat_videos', {
				videoPaths: videoFilePaths,
				outputPath: exportData!.finalFilePath,
				videoFadeInEnabled: exportFadeSettings.videoFadeInEnabled,
				videoFadeOutEnabled: exportFadeSettings.videoFadeOutEnabled,
				audioFadeInEnabled: exportFadeSettings.audioFadeInEnabled,
				audioFadeOutEnabled: exportFadeSettings.audioFadeOutEnabled,
				exportFadeDurationMs: Math.max(0, exportFadeSettings.fadeDurationMs || 0),
				performanceProfile: globalState.getExportState.performanceProfile,
				exportWithoutBackground: globalState.getExportState.exportWithoutBackground ?? false
			});

			console.log('[OK] Videos concatenated successfully:', finalVideoPath);

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

			if (sourceTimingForDuplication !== undefined) {
				// Ce timing peut être dupliqué depuis sourceTimingForDuplication
				const sourceIndex = Math.max(
					Math.round(sourceTimingForDuplication - exportStart - fadeDuration),
					0
				);
				await duplicateScreenshot(`${sourceIndex}`, imageIndex);
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

				await duplicateScreenshot(`blank_${surahInfo.surah}`, imageIndex);
				console.log('Duplicating screenshot instead of taking new one at', timing);
			} else {
				// Important: le +1 sinon le svg de la sourate est le mauvais
				globalState.getTimelineState.movePreviewTo = timing + 1;
				globalState.getTimelineState.cursorPosition = timing + 1;

				await wait(timing + 1);

				await takeScreenshot(`${imageIndex}`);

				// Verifier si ce timing correspond a une image blank de reference pour une sourate
				for (const [surahStr, blankTiming] of Object.entries(timings.imgWithNothingShown)) {
					if (timing === blankTiming) {
						const surahNum = Number(surahStr);
						console.log(`Creating blank image for surah ${surahNum} at timing ${timing}`);
						await takeScreenshot(`blank_${surahNum}`);
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

		// Générer la vidéo normale
		await generateNormalVideo(exportStart, totalDuration, blur);

		// Nettoyage
		await finalCleanup();
	}

	function calculateTimingsForRange(rangeStart: number, rangeEnd: number) {
		const subtitleClips: ExportSubtitleCaptureClip[] = globalState.getSubtitleTrack.clips.map(
			(clip) => ({
				startTime: clip.startTime,
				endTime: clip.endTime,
				kind: clip instanceof SilenceClip ? 'silence' : 'subtitle',
				surah: 'surah' in clip && typeof clip.surah === 'number' ? clip.surah : undefined
			})
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

	async function generateNormalVideo(exportStart: number, duration: number, blur: number) {
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
				batchSize: globalState.settings?.exportSettings.batchSize ?? 12,
				exportWithoutBackground: globalState.getExportState.exportWithoutBackground ?? false
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

	async function takeScreenshot(fileName: string, subfolder: string | null = null) {
		// L'element a transformer en image
		let node = document.getElementById('overlay')!;

		// En sachant que node.clientWidth = 1920 et node.clientHeight = 1080,
		// je veux pouvoir avoir la dimension trouvée dans les paramètres d'export
		const targetWidth = exportData!.videoDimensions.width;
		const targetHeight = exportData!.videoDimensions.height;

		// Calcul du scale
		const scaleX = targetWidth / node.clientWidth;
		const scaleY = targetHeight / node.clientHeight;
		const scale = Math.min(scaleX, scaleY);

		try {
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

			// Convertir le blob directement en Uint8Array (une seule copie en mémoire)
			const buffer = await blob.arrayBuffer();
			const bytes = new Uint8Array(buffer);

			// Déterminer le chemin du fichier
			const pathComponents = [ExportService.exportFolder, exportId];
			if (subfolder) pathComponents.push(subfolder);
			pathComponents.push(fileName + '.png');

			const filePathWithName = await join(...pathComponents);

			await writeFile(filePathWithName, bytes, { baseDir: BaseDirectory.AppData });
			console.log('Screenshot saved to:', filePathWithName);
		} catch (error: unknown) {
			console.error('Error while taking screenshot: ', error);
			const message =
				error && typeof error === 'object' && 'message' in error
					? String((error as { message?: unknown }).message ?? '')
					: String(error ?? 'Unknown error');
			toast.error('Error while taking screenshot: ' + message);
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
		} catch {
			// Fallback: lire et écrire si la commande Rust n'existe pas
			if (!(await exists(sourceFilePathWithName, { baseDir: BaseDirectory.AppData }))) {
				console.error('Source screenshot does not exist:', sourceFilePathWithName);
				return;
			}
			const data = await readFile(sourceFilePathWithName, { baseDir: BaseDirectory.AppData });
			await writeFile(targetFilePathWithName, data, { baseDir: BaseDirectory.AppData });
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

			// Parcourir tous les fichiers pour trouver les images blank_
			// On utilise une approche simple en testant les numeros de sourate de 1 a 114
			for (let surahNum = 1; surahNum <= 114; surahNum++) {
				const blankFileName = `blank_${surahNum}.png`;
				const blankFilePath = await join(...pathComponents, blankFileName);

				// Vérifier si le fichier existe et le supprimer
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
