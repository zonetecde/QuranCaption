<script lang="ts">
	import { PredefinedSubtitleClip, VerseRange, type AssetClip } from '$lib/classes';
	import Timeline from '$lib/components/projectEditor/timeline/Timeline.svelte';
	import VideoPreview from '$lib/components/projectEditor/videoPreview/VideoPreview.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { ProjectService } from '$lib/services/ProjectService';
	import { invoke } from '@tauri-apps/api/core';
	import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
	import { listen } from '@tauri-apps/api/event';
	import { onMount } from 'svelte';
	import { exists, BaseDirectory, mkdir, writeFile, remove, readFile } from '@tauri-apps/plugin-fs';
	import { LogicalPosition } from '@tauri-apps/api/dpi';
	import { getCurrentWebview } from '@tauri-apps/api/webview';
	import { appDataDir, join } from '@tauri-apps/api/path';
	import ExportService, { type ExportProgress } from '$lib/services/ExportService';
	import { getAllWindows } from '@tauri-apps/api/window';
	import Exportation, { ExportState } from '$lib/classes/Exportation.svelte';
	import toast from 'svelte-5-french-toast';
	import DomToImage from 'dom-to-image';
	import SubtitleClip from '$lib/components/projectEditor/timeline/track/SubtitleClip.svelte';
	import { ClipWithTranslation, CustomTextClip, SilenceClip } from '$lib/classes/Clip.svelte';

	// Indique si l'enregistrement a commencé
	let readyToExport = $state(false);

	// Contient l'ID de l'export
	let exportId = '';

	// VideoPreview
	let videoPreview: VideoPreview | undefined = $state(undefined);

	// Récupère les données d'export de la vidéo
	let exportData: Exportation | undefined;

	// Durée de chunk calculée dynamiquement basée sur chunkSize (1-200)
	// chunkSize = 1 -> 30s, chunkSize = 50 -> 2min30, chunkSize = 200 -> 10min
	let CHUNK_DURATION = 0; // Sera calculé dans onMount

	async function exportProgress(event: any) {
		const data = event.payload as {
			progress?: number;
			current_time: number;
			total_time?: number;
			export_id: string;
			chunk_index?: number;
		};

		// Vérifie que c'est bien pour cette exportation
		if (data.export_id !== exportId) return;

		if (data.progress !== null && data.progress !== undefined) {
			console.log(
				`Export Progress: ${data.progress.toFixed(1)}% (${data.current_time.toFixed(1)}s / ${data.total_time?.toFixed(1)}s)`
			);

			const chunkIndex = data.chunk_index || 0;
			const totalDuration = exportData!.videoEndTime - exportData!.videoStartTime;
			const totalChunks = Math.ceil(totalDuration / CHUNK_DURATION);

			// Calculer le pourcentage global et le temps actuel global
			let globalProgress: number;
			let globalCurrentTime: number;

			if (data.chunk_index !== undefined) {
				// Mode chunked export
				// Chaque chunk représente une portion égale du pourcentage total
				// Calcul donc le pourcentage global basé sur le chunk actuel et son progrès
				const chunkProgressWeight = 100 / totalChunks;
				const baseProgress = chunkIndex * chunkProgressWeight;
				const chunkLocalProgress = (data.progress / 100) * chunkProgressWeight;
				globalProgress = baseProgress + chunkLocalProgress;

				// Calculer le temps global basé sur la position du chunk et son progrès
				const chunkDuration = Math.min(CHUNK_DURATION, totalDuration - chunkIndex * CHUNK_DURATION);
				const chunkLocalTime = (data.current_time / (data.total_time || 1)) * chunkDuration;
				globalCurrentTime = chunkIndex * CHUNK_DURATION + chunkLocalTime;
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

	async function exportComplete(event: any) {
		const data = event.payload as { filename: string; exportId: string; chunkIndex?: number };

		// Vérifie que c'est bien pour cette exportation
		if (data.exportId !== exportId) return;

		console.log(`✅ Export complete! File saved as: ${data.filename}`);

		// Si c'est un chunk, ne pas émettre 100% maintenant (ça sera fait à la fin de tous les chunks)
		if (data.chunkIndex === undefined) {
			// Export normal (sans chunks) - émettre 100%
			await emitProgress({
				exportId: Number(exportId),
				progress: 100,
				currentState: ExportState.Exported
			} as ExportProgress);
		} else {
			// Export en chunks - juste logger la completion du chunk
			console.log(`✅ Chunk ${data.chunkIndex} completed`);
		}
	}

	async function exportError(event: any) {
		const error = event.payload as { error: string; export_id: string };
		console.error(`❌ Export failed: ${error}`);

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

	onMount(async () => {
		// Écoute les événements de progression d'export donné par Rust
		listen('export-progress', exportProgress);
		listen('export-complete', exportComplete);
		listen('export-error', exportError);

		// Récupère l'id de l'export, qui est en paramètre d'URL
		const id = new URLSearchParams(window.location.search).get('id');
		if (id) {
			exportId = id;

			// Récupère le projet correspondant à cette ID (dans le dossier export, paramètre inExportFolder: true)
			globalState.currentProject = await ExportService.loadProject(Number(id));

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

			const chunkSize = globalState.getExportState.chunkSize;
			// Formule linéaire: chunkSize=1 -> 10s, chunkSize=200 -> 20s
			// Ces valeurs sont réduites pour éviter la saturation mémoire (crash FFmpeg)
			const minDuration = 10 * 1000; // 10 secondes en ms
			const maxDuration = 20 * 1000; // 20 secondes en ms
			CHUNK_DURATION = minDuration + ((chunkSize - 1) / (200 - 1)) * (maxDuration - minDuration);

			console.log(
				`Chunk size: ${chunkSize}, Chunk duration: ${CHUNK_DURATION}ms (${CHUNK_DURATION / 1000}s)`
			);

			// Enlève tout les styles de position de la vidéo
			let videoElement: HTMLElement;
			// Attend que l'élément soit prêt
			do {
				await new Promise((resolve) => setTimeout(resolve, 100));
				videoElement = document.getElementById('video-preview-section') as HTMLElement;
				videoElement.style.objectFit = 'contain';
				videoElement.style.top = '0';
				videoElement.style.left = '0';
				videoElement.style.width = '100%';
				videoElement.style.height = '100%';
			} while (!videoElement);

			// Attend 2 secondes que tout soit prêt
			await new Promise((resolve) => setTimeout(resolve, 2000));

			readyToExport = true;

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

		// Si la durée est supérieure à 10 minutes, on découpe en chunks
		if (totalDuration > CHUNK_DURATION) {
			console.log('Duration > 10 minutes, using chunked export');
			await handleChunkedExport(exportStart, exportEnd, totalDuration);
		} else {
			console.log('Duration <= 10 minutes, using normal export');
			await handleNormalExport(exportStart, exportEnd, totalDuration);
		}
	}

	async function handleChunkedExport(
		exportStart: number,
		exportEnd: number,
		totalDuration: number
	) {
		// Calculer les chunks en s'arrêtant au prochain fade-out après la durée max
		const chunkInfo = calculateChunksWithFadeOut(exportStart, exportEnd);
		const generatedVideoFiles: string[] = [];

		console.log(`Splitting into ${chunkInfo.chunks.length} chunks`);
		chunkInfo.chunks.forEach((chunk, i) => {
			console.log(`Chunk ${i + 1}: ${chunk.start} -> ${chunk.end} (${chunk.end - chunk.start}ms)`);
		});

		// Initialiser l'état
		emitProgress({
			exportId: Number(exportId),
			progress: 0,
			currentState: ExportState.Initializing,
			currentTime: 0,
			totalTime: totalDuration
		} as ExportProgress);

		// BOUCLE PIPELINE : On encode le chunk N pendant qu'on génère les images du chunk N+1
		console.log('=== STARTING PIPELINED CHUNK PROCESSING ===');

		// 1. Initialiser le pipeline avec le premier chunk (génération d'images uniquement)
		let currentChunkIndex = 0;
		console.log(`Pipeline Init: Generating images for Chunk ${currentChunkIndex}...`);
		await createChunkImageFolder(`chunk_${currentChunkIndex}`);

		const firstChunk = chunkInfo.chunks[currentChunkIndex];
		const firstChunkProgressWeight = 100 / chunkInfo.chunks.length;

		await generateImagesForChunk(
			currentChunkIndex,
			firstChunk.start,
			firstChunk.end,
			`chunk_${currentChunkIndex}`,
			chunkInfo.chunks.length,
			0,
			firstChunkProgressWeight,
			false // silent=false pour le tout premier chunk (on veut voir le démarrage)
		);

		// 2. Boucle principale du pipeline
		// À chaque itération i :
		// - On lance l'encodage vidéo du chunk i
		// - EN MÊME TEMPS, on lance la génération d'images du chunk i+1 (si existe)
		// - On attend que les DEUX soient finis
		// - On nettoie les images du chunk i

		for (let i = 0; i < chunkInfo.chunks.length; i++) {
			console.log(`Pipeline Step ${i}: Encoding Video ${i} + Generating Images ${i + 1}`);

			const chunkI = chunkInfo.chunks[i];
			const chunkImageFolderI = `chunk_${i}`;
			const chunkActualDurationI = chunkI.end - chunkI.start;

			// Tâche 1: Encodage vidéo du chunk actuel (Backend)
			const videoTask = (async () => {
				// On laisse le backend émettre la progression via les events 'export-progress'
				const path = await generateVideoForChunk(
					i,
					chunkImageFolderI,
					chunkI.start,
					chunkActualDurationI
				);
				return path;
			})();

			// Tâche 2: Génération images du chunk suivant (Frontend)
			const nextChunkIndex = i + 1;
			let imageTask = Promise.resolve();

			if (nextChunkIndex < chunkInfo.chunks.length) {
				imageTask = (async () => {
					const chunkNext = chunkInfo.chunks[nextChunkIndex];
					const chunkImageFolderNext = `chunk_${nextChunkIndex}`;
					const nextProgressWeight = 100 / chunkInfo.chunks.length;
					const nextBaseProgress = nextChunkIndex * nextProgressWeight;

					await createChunkImageFolder(chunkImageFolderNext);
					await generateImagesForChunk(
						nextChunkIndex,
						chunkNext.start,
						chunkNext.end,
						chunkImageFolderNext,
						chunkInfo.chunks.length,
						nextBaseProgress,
						nextBaseProgress + nextProgressWeight,
						true // silent=true : on génère en background, donc pas de mise à jour de la barre de progression (évite le jitter)
					);
				})();
			}

			// Attendre que les deux tâches soient finies
			const [videoPath, _] = await Promise.all([videoTask, imageTask]);

			generatedVideoFiles.push(videoPath);

			// Nettoyer les images du chunk terminé (i) pour libérer la place
			// C'est safe car la vidéo i est finie, et on a fini de générer les images i+1
			await removeChunkImageFolder(chunkImageFolderI);
		}

		// PHASE FINALE: Concaténation
		console.log('=== FINAL PHASE: Concatenation ===');

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

	async function removeChunkImageFolder(chunkImageFolder: string) {
		try {
			const chunkPath = await join(ExportService.exportFolder, exportId, chunkImageFolder);
			await remove(chunkPath, {
				baseDir: BaseDirectory.AppData,
				recursive: true
			});
			console.log(`Deleted chunk folder: ${chunkPath}`);
		} catch (e) {
			console.warn(`Could not delete chunk folder ${chunkImageFolder}:`, e);
		}
	}

	async function createChunkImageFolder(chunkImageFolder: string) {
		const chunkPath = await join(ExportService.exportFolder, exportId, chunkImageFolder);
		await mkdir(chunkPath, {
			baseDir: BaseDirectory.AppData,
			recursive: true
		});
		console.log(`Created chunk folder: ${chunkPath}`);
	}

	async function generateImagesForChunk(
		chunkIndex: number,
		chunkStart: number,
		chunkEnd: number,
		chunkImageFolder: string,
		totalChunks: number,
		phaseStartProgress: number = 0,
		phaseEndProgress: number = 100,
		silent: boolean = false
	) {
		const fadeDuration = Math.round(
			globalState.getStyle('global', 'fade-duration')!.value as number
		);

		// Calculer les timings pour ce chunk spécifique
		const chunkTimings = calculateTimingsForRange(chunkStart, chunkEnd);

		console.log(`Chunk ${chunkIndex}: ${chunkTimings.uniqueSorted.length} screenshots to take`);

		let i = 0;
		let base = -fadeDuration; // Pour compenser le fade-in du début

		for (const timing of chunkTimings.uniqueSorted) {
			// Calculer l'index de l'image dans ce chunk (recommence à 0)
			const imageIndex = Math.max(Math.round(timing - chunkStart + base), 0);

			// Vérifie si ce timing doit être dupliqué depuis un autre
			const sourceTimingForDuplication = Array.from(chunkTimings.duplicableTimings.entries()).find(
				([target, source]) => target === timing // target = timing qui doit être dupliqué
			)?.[1];

			// Si c'est dupliquable
			if (sourceTimingForDuplication !== undefined) {
				// Ce timing peut être dupliqué depuis sourceTimingForDuplication
				const sourceIndex = Math.max(
					Math.round(sourceTimingForDuplication - chunkStart - fadeDuration),
					0
				);
				// Prend que un seul screenshot et le duplique
				await duplicateScreenshot(`${sourceIndex}`, imageIndex, chunkImageFolder);
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

				await duplicateScreenshot(`blank_${surahInfo.surah}`, imageIndex, chunkImageFolder);
				console.log('Duplicating screenshot instead of taking new one at', timing);
			} else {
				// Important: le +1 sinon le svg de la sourate est le mauvais
				globalState.getTimelineState.movePreviewTo = timing;
				globalState.getTimelineState.cursorPosition = timing;

				// si la difference entre timing et celui juste avant est grand, attendre un peu plus
				await wait(timing);

				await takeScreenshot(`${imageIndex}`, chunkImageFolder);

				// Vérifier si ce timing correspond à une image blank de référence pour une sourate
				for (const [surahStr, blankTiming] of Object.entries(chunkTimings.imgWithNothingShown)) {
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
					`Chunk ${chunkIndex}: Screenshot taken at timing ${timing} -> image ${imageIndex}`
				);
			}

			base += fadeDuration;
			i++;

			// Progress pour ce chunk dans la phase spécifiée
			const chunkImageProgress = (i / chunkTimings.uniqueSorted.length) * 100;
			// Map local 0-100 to [phaseStart, phaseEnd]
			const globalProgress =
				phaseStartProgress + (chunkImageProgress * (phaseEndProgress - phaseStartProgress)) / 100;

			if (!silent) {
				emitProgress({
					exportId: Number(exportId),
					progress: globalProgress,
					currentState: ExportState.CapturingFrames,
					currentTime: timing - exportData!.videoStartTime,
					totalTime: exportData!.videoEndTime - exportData!.videoStartTime
				} as ExportProgress);
			}
		}
	}

	async function generateVideoForChunk(
		chunkIndex: number,
		chunkImageFolder: string,
		chunkStart: number,
		chunkDuration: number
	): Promise<string> {
		const fadeDuration = Math.round(
			globalState.getStyle('global', 'fade-duration')!.value as number
		);

		// Récupère le chemin de fichier de tous les audios du projet
		const audios: string[] = globalState.getAudioTrack.clips.map(
			(clip: any) => globalState.currentProject!.content.getAssetById(clip.assetId).filePath
		);

		// Récupère le chemin de fichier de toutes les vidéos du projet
		const videos = globalState.getVideoTrack.clips.map(
			(clip: any) => globalState.currentProject!.content.getAssetById(clip.assetId).filePath
		);

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
				blur: globalState.getStyle('global', 'overlay-blur')!.value as number
			});

			console.log(`✅ Chunk ${chunkIndex} video generated successfully`);
			return chunkFinalFilePath;
		} catch (e: any) {
			console.error(`❌ Error generating chunk ${chunkIndex} video:`, e);
			throw e;
		}
	}

	async function concatenateVideos(videoFilePaths: string[]) {
		console.log('Starting video concatenation...');

		try {
			const finalVideoPath = await invoke('concat_videos', {
				videoPaths: videoFilePaths,
				outputPath: exportData!.finalFilePath
			});

			console.log('✅ Videos concatenated successfully:', finalVideoPath);

			// Supprimer les vidéos de chunks individuelles
			for (const videoPath of videoFilePaths) {
				try {
					await remove(videoPath, { baseDir: BaseDirectory.AppData });
					console.log(`Deleted chunk video: ${videoPath}`);
				} catch (e) {
					console.warn(`Could not delete chunk video ${videoPath}:`, e);
				}
			}
		} catch (e: any) {
			console.error('❌ Error concatenating videos:', e);
			emitProgress({
				exportId: Number(exportId),
				progress: 100,
				currentState: ExportState.Error,
				errorLog: JSON.stringify(e, Object.getOwnPropertyNames(e))
			} as ExportProgress);
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

	async function handleNormalExport(exportStart: number, exportEnd: number, totalDuration: number) {
		const fadeDuration = Math.round(
			globalState.getStyle('global', 'fade-duration')!.value as number
		);

		// Calculer tous les timings nécessaires
		const timings = calculateTimingsForRange(exportStart, exportEnd);

		console.log('Normal export - Timings détectés:', timings.uniqueSorted);
		console.log(
			'Image(s) à dupliquer (blank):',
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
				([target, source]) => target === timing
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
				hasBlankImg(timings.imgWithNothingShown, hasTiming(timings.blankImgs, timing).surah!)
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

				// Vérifier si ce timing correspond à une image blank de référence pour une sourate
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
		await generateNormalVideo(exportStart, totalDuration);

		// Nettoyage
		await finalCleanup();
	}

	/**
	 * Analyser l'état des custom clips à un moment donné
	 * Retourne un identifiant unique basé sur quels custom clips sont visibles
	 */
	function getCustomClipStateAt(timing: number): string {
		const visibleCustomClips: string[] = [];

		for (const ctClip of globalState.getCustomClipTrack?.clips || []) {
			// @ts-ignore
			const category = ctClip.category;
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
			const { startTime, endTime } = clip as any;
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
						// Ajoute à la map de duplication
						duplicableTimings.set(Math.round(fadeOutStart), Math.round(fadeInEnd));
					} else {
						// États différents, prendre les deux captures
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
					// @ts-ignore
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
			// @ts-ignore
			const category = ctClip.category;
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

	async function generateNormalVideo(exportStart: number, duration: number) {
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
			(clip: any) => globalState.currentProject!.content.getAssetById(clip.assetId).filePath
		);

		// Récupère le chemin de fichier de toutes les vidéos du projet
		const videos = globalState.getVideoTrack.clips.map(
			(clip: any) => globalState.currentProject!.content.getAssetById(clip.assetId).filePath
		);

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
				blur: globalState.getStyle('global', 'overlay-blur')!.value as number
			});
		} catch (e: any) {
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
		// L'élément à transformer en image
		let node = document.getElementById('overlay')!;

		// Qualité de l'image
		let scale = 1.0;

		// En sachant que node.clientWidth = 1920 et node.clientHeight = 1080,
		// je veux pouvoir avoir la dimension trouvée dans les paramètres d'export
		const targetWidth = exportData!.videoDimensions.width;
		const targetHeight = exportData!.videoDimensions.height;

		// Calcul du scale
		const scaleX = targetWidth / node.clientWidth;
		const scaleY = targetHeight / node.clientHeight;
		scale = Math.min(scaleX, scaleY);

		// Utilisation de DomToImage pour transformer la div en image
		try {
			const dataUrl = await DomToImage.toPng(node, {
				width: node.clientWidth * scale,
				height: node.clientHeight * scale,
				style: {
					// Set de la qualité
					transform: 'scale(' + scale + ')',
					transformOrigin: 'top left'
				},
				quality: 1
			});

			// Si on est en mode portrait, on crop pour avoir un ratio 9:16
			let finalDataUrl = dataUrl;

			// Déterminer le chemin du fichier
			const pathComponents = [ExportService.exportFolder, exportId];
			if (subfolder) pathComponents.push(subfolder);
			pathComponents.push(fileName + '.png');

			const filePathWithName = await join(...pathComponents);

			// Convertir dataUrl base64 en ArrayBuffer sans utiliser fetch
			const base64Data = finalDataUrl.replace(/^data:image\/png;base64,/, '');
			const binaryString = window.atob(base64Data);
			const bytes = new Uint8Array(binaryString.length);
			for (let i = 0; i < binaryString.length; i++) {
				bytes[i] = binaryString.charCodeAt(i);
			}

			await writeFile(filePathWithName, bytes, { baseDir: BaseDirectory.AppData });
			console.log('Screenshot saved to:', filePathWithName);
		} catch (error: any) {
			console.error('Error while taking screenshot: ', error);
			toast.error('Error while taking screenshot: ' + error.message);
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

		// Vérifie que le fichier source existe
		if (!(await exists(sourceFilePathWithName, { baseDir: BaseDirectory.AppData }))) {
			console.error('Source screenshot does not exist:', sourceFilePathWithName);
			return;
		}

		// Lit le fichier source
		const data = await readFile(sourceFilePathWithName, { baseDir: BaseDirectory.AppData });
		// Écrit le fichier cible
		await writeFile(targetFilePathWithName, data, { baseDir: BaseDirectory.AppData });
		console.log('Duplicate screenshot saved to:', targetFilePathWithName);
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
			// On utilise une approche simple en testant les numéros de sourate de 1 à 114
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

	function calculateChunksWithFadeOut(exportStart: number, exportEnd: number) {
		const fadeDuration = Math.round(
			globalState.getStyle('global', 'fade-duration')!.value as number
		);

		// Collecter tous les moments de fin de fade-out
		const fadeOutEndTimes: number[] = [];

		// --- Sous-titres ---
		for (const clip of globalState.getSubtitleTrack.clips) {
			// @ts-ignore
			const { startTime, endTime } = clip as any;
			if (startTime == null || endTime == null) continue;
			if (endTime < exportStart || startTime > exportEnd) continue;

			if (!(clip instanceof SilenceClip)) {
				// Fin de fade-out = endTime (moment où le fade-out se termine)
				fadeOutEndTimes.push(endTime);
			}
		}

		// --- Custom Texts ---
		for (const ctClip of globalState.getCustomClipTrack?.clips || []) {
			// @ts-ignore
			const category = ctClip.category;
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
				// S'arrêter à cette fin de fade-out
				chunks.push({ start: currentStart, end: nextFadeOutEnd });
				currentStart = nextFadeOutEnd;
			} else {
				// Pas de fade-out trouvé, s'arrêter à la fin idéale ou à la fin totale
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

		// Attend que l'élément `subtitles-container` est une opacité de 1 (visible) (car il est caché pendant que max-height s'applique)
		let subtitlesContainer: HTMLElement;
		subtitlesContainer = document.getElementById('subtitles-container') as HTMLElement;

		if (!subtitlesContainer) {
			await new Promise((resolve) => setTimeout(resolve, 200));
			return;
		}

		const startTime = Date.now();
		const timeout = 1000; // 1000ms maximum timeout to avoid infinite hang

		do {
			if (Date.now() - startTime > timeout) {
				console.warn(`Timeout waiting for subtitles-container at ${timing}ms, proceeding anyway.`);
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 10));
		} while (subtitlesContainer.style.opacity !== '1');
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
