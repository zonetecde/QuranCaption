import {
	Project,
	ProjectContent,
	ProjectDetail,
	type AssetClip,
	Utilities,
	SourceType
} from '$lib/classes';
import { Quran } from '$lib/classes/Quran';
import { globalState } from '$lib/runes/main.svelte';
import { discordService } from '$lib/services/DiscordService';
import { Mp3QuranService } from '$lib/services/Mp3QuranService';
import { ProjectService } from '$lib/services/ProjectService';
import { runAutoSegmentation } from '$lib/services/AutoSegmentation';
import {
	buildAdvancedTrimVerseCandidates,
	buildAdvancedTrimBatches,
	runAdvancedTrimBatchStreaming,
	validateAdvancedTrimBatchResult,
	applyAdvancedTrimValidationSuccess
} from '$lib/services/AdvancedAITrimming';
import { BACKGROUND_VIDEO_URLS } from './constants';
import toast from 'svelte-5-french-toast';
import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { copyFile } from '@tauri-apps/plugin-fs';
import type { Resolution } from './types';

/**
 * Retourne l'URL YouTube de la video de fond pour le modele et l'orientation choisis.
 * @param {string} modelLabel Libelle du modele selectionne.
 * @param {Resolution} selectedResolution Orientation choisie.
 * @returns {string} URL YouTube correspondante.
 */
function getBackgroundVideoUrl(modelLabel: string, selectedResolution: Resolution): string {
	const urls = BACKGROUND_VIDEO_URLS[modelLabel as keyof typeof BACKGROUND_VIDEO_URLS];
	if (!urls) {
		throw new Error(`Unsupported AI video model: ${modelLabel}`);
	}
	return urls[selectedResolution];
}

/**
 * Retourne les dimensions de projet associees a l'orientation choisie.
 * @param {Resolution} selectedResolution Orientation choisie.
 * @returns {{ width: number; height: number }} Dimensions video a appliquer.
 */
function getProjectDimensionsForResolution(selectedResolution: Resolution): {
	width: number;
	height: number;
} {
	return selectedResolution === 'portrait'
		? { width: 1080, height: 1920 }
		: { width: 1920, height: 1080 };
}

/**
 * Pipeline complet de creation d'un projet AI Video :
 * telechargement video → audio → trim → segmentation → traduction → trimming IA.
 *
 * Lit tout le state depuis globalState.aiVideo et snapshot les valeurs critiques
 * en debut de fonction pour eviter les race conditions si la page se demonte.
 *
 * @returns {Promise<void>}
 */
export async function createAiVideoProject(): Promise<void> {
	const aiv = globalState.aiVideo;
	const snapshot = {
		translation: aiv.selectedTranslation,
		reciterOption: aiv.audio.reciter,
		useLocal: aiv.audio.useLocal,
		localPath: aiv.audio.localPath,
		surah: aiv.review.verseRange.surah,
		ayahStart: aiv.review.verseRange.startVerse,
		ayahEnd: aiv.review.verseRange.endVerse,
		reciterName: aiv.review.reciterName,
		prompt: aiv.video.prompt,
		title: aiv.review.title,
		reviewVideoPrompt: aiv.review.videoPrompt,
		selectedModel: aiv.video.model,
		resolution: aiv.video.resolution,
		sourceMode: aiv.video.sourceMode
	};

	const setStatus = (msg: string) => {
		aiv.generationStatus = msg;
		console.log(`[AiVideo] ${msg}`);
	};

	setStatus('Creating project...');

	try {
		const projectName = `AI - ${(snapshot.title || snapshot.prompt).trim().slice(0, 50)}`;

		if (Utilities.isPathNotSafe(projectName)) {
			toast.error('Generated project name contains invalid characters.');
			return;
		}

		const projectDetail = new ProjectDetail(
			projectName,
			snapshot.reciterName,
			undefined,
			undefined,
			'Others'
		);
		const content = await ProjectContent.getDefaultProjectContent();
		const project = new Project(projectDetail, content);
		await project.save();

		// Ouvre le projet en arriere-plan (l'overlay reste visible)
		globalState.currentProject = project;
		globalState.currentPage = 'home';
		discordService.setEditingState();

		const assetFolder = await ProjectService.getAssetFolderForProject(project.detail.id);
		const backgroundVideoUrl =
			snapshot.sourceMode === 'youtube'
				? snapshot.reviewVideoPrompt.trim()
				: getBackgroundVideoUrl(snapshot.selectedModel, snapshot.resolution);

		if (snapshot.sourceMode === 'ai') {
			content.videoStyle.getStylesOfTarget('global').findStyle('video-dimension')!.value =
				getProjectDimensionsForResolution(snapshot.resolution);
		}

		// ── 1. Background video ──
		setStatus('Downloading background video...');
		const backgroundVideoPath = await invoke<string>('download_from_youtube', {
			url: backgroundVideoUrl,
			type: 'video_no_audio',
			downloadPath: assetFolder
		});

		setStatus('Adding background video...');
		content.addAsset(backgroundVideoPath, backgroundVideoUrl, SourceType.YouTube, {
			skipConstantBitrateWarning: true
		});

		const normalizedBackgroundVideoPath = backgroundVideoPath
			.replace(/\\/g, '/')
			.replace(/\/+/g, '/');
		const backgroundVideoAsset = content.assets.find(
			(asset) => asset.filePath === normalizedBackgroundVideoPath
		);

		if (snapshot.sourceMode === 'youtube') {
			const backgroundVideoDimensions = (await invoke('get_video_dimensions', {
				filePath: backgroundVideoPath
			})) as { width: number; height: number };

			if (backgroundVideoDimensions.width > 0 && backgroundVideoDimensions.height > 0) {
				content.videoStyle.getStylesOfTarget('global').findStyle('video-dimension')!.value =
					backgroundVideoDimensions;
			}
		}

		if (backgroundVideoAsset) {
			await backgroundVideoAsset.addToTimeline(true, false);
		}

		// ── 2. Audio ──
		const audioFilePath = await prepareAudio(
			project,
			content,
			assetFolder,
			snapshot,
			setStatus
		);
		if (!audioFilePath) {
			toast.error('No audio source selected.');
			return;
		}

		// ── 3. Add audio to timeline ──
		setStatus('Adding audio to timeline...');
		const sourceType = snapshot.useLocal ? SourceType.Local : SourceType.Mp3Quran;
		const metadata: Record<string, unknown> = {};

		if (!snapshot.useLocal && snapshot.reciterOption) {
			metadata.mp3Quran = {
				reciterId: snapshot.reciterOption.reciterId,
				moshafId: snapshot.reciterOption.moshaf.id,
				surahId: snapshot.surah
			};
			metadata.nativeTiming = {
				provider: 'mp3quran',
				reciterId: snapshot.reciterOption.reciterId,
				moshafId: snapshot.reciterOption.moshaf.id,
				surahId: snapshot.surah
			};
		}

		content.addAsset(audioFilePath, undefined, sourceType, metadata);

		const normalizedPath = audioFilePath.replace(/\\/g, '/').replace(/\/+/g, '/');
		const addedAsset = content.assets.find((asset) => asset.filePath === normalizedPath);

		if (addedAsset) {
			await addedAsset.addToTimeline(false, true);
		}

		const backgroundVideoClip = globalState.getVideoTrack.clips.find(
			(clip) => (clip as AssetClip).assetId === backgroundVideoAsset?.id
		) as AssetClip | undefined;

		if (backgroundVideoClip) {
			backgroundVideoClip.loopUntilAudioEnd = true;
			backgroundVideoClip.setEndTime(
				globalState.currentProject!.content.timeline.getLongestTrackDurationIgnoringLoopedVideo()
					.ms
			);
		}

		await project.save();

		// ── 4. Auto-segmentation ──
		setStatus('Generating subtitles with AI...');
		const segResult = await runAutoSegmentation({}, 'api');
		console.log('[AiVideo] Segmentation result:', segResult);

		if (segResult && segResult.status === 'failed') {
			toast.error(`Subtitles failed: ${segResult.message}. Project created without subtitles.`);
			await project.save();
			return;
		}

		await project.save();

		// ── 5. Translation + AI Trimming ──
		if (snapshot.translation) {
			await addTranslationAndTrim(project, content, snapshot.translation, setStatus);
		} else {
			console.log('[AiVideo] No translation selected, skipping translation step.');
		}

		setStatus('Finalizing project...');
		toast.success('Project ready!');
	} catch (error) {
		console.error('[AiVideo] Project creation failed:', error);
		toast.error(`Failed to create project: ${error}`);
		throw error;
	}
}

/**
 * Prepare le fichier audio (local copie ou telechargement MP3Quran + trim eventuel).
 * @param {Project} project Projet en cours de creation.
 * @param {ProjectContent} content Contenu du projet.
 * @param {string} assetFolder Dossier assets du projet.
 * @param {object} snapshot Snapshot des valeurs critiques.
 * @param {Function} setStatus Callback pour le status affiche.
 * @returns {Promise<string | null>} Chemin du fichier audio, ou null si erreur.
 */
async function prepareAudio(
	project: Project,
	content: ProjectContent,
	assetFolder: string,
	snapshot: {
		useLocal: boolean;
		localPath: string;
		reciterOption: import('./types').ReciterOption | null;
		reciterName: string;
		surah: number;
		ayahStart: number;
		ayahEnd: number;
	},
	setStatus: (msg: string) => void
): Promise<string | null> {
	if (snapshot.useLocal && snapshot.localPath) {
		setStatus('Copying audio file...');
		const ext = snapshot.localPath.split('.').pop() || 'mp3';
		const destFileName = `local-audio.${ext}`;
		const destPath = await join(assetFolder, destFileName);
		await copyFile(snapshot.localPath, destPath);
		return destPath;
	}

	if (snapshot.reciterOption) {
		setStatus('Downloading recitation...');
		const formattedSurahId = snapshot.surah.toString().padStart(3, '0');
		const audioUrl = `${snapshot.reciterOption.moshaf.server}${formattedSurahId}.mp3`;
		const fullSurahPath = await join(assetFolder, `full-surah-${formattedSurahId}.mp3`);

		await invoke('download_file', {
			url: audioUrl,
			path: fullSurahPath
		});

		const surahVerseCount = Quran.getVerseCount(snapshot.surah) || 1;
		const needsTrim = snapshot.ayahStart > 1 || snapshot.ayahEnd < surahVerseCount;

		if (!needsTrim) return fullSurahPath;

		// Trim l'audio a la plage de versets demandee
		setStatus('Trimming audio to verse range...');
		try {
			const timings = await Mp3QuranService.getSurahTiming(
				snapshot.reciterOption.moshaf.id,
				snapshot.surah
			);

			if (timings && timings.length > 0) {
				const startTiming = timings.find((t) => t.ayah === snapshot.ayahStart);
				const endTiming = timings.find((t) => t.ayah === snapshot.ayahEnd);

				if (startTiming && endTiming) {
					const trimmedFileName = `${snapshot.reciterName.replace(/[<>:"/\\|?*]/g, '').trim() || 'reciter'}-${snapshot.surah}-${snapshot.ayahStart}-${snapshot.ayahEnd}.mp3`;
					const trimmedPath = await join(assetFolder, trimmedFileName);

					await invoke('cut_audio', {
						sourcePath: fullSurahPath,
						startMs: startTiming.start_time,
						endMs: endTiming.end_time,
						outputPath: trimmedPath
					});
					return trimmedPath;
				}
			}
		} catch (trimError) {
			console.warn('[AiVideo] Trimming failed, using full surah:', trimError);
		}

		return fullSurahPath;
	}

	return null;
}

/**
 * Ajoute la traduction au projet et lance le trimming IA si configure.
 * @param {Project} project Projet cree.
 * @param {ProjectContent} content Contenu du projet.
 * @param {Edition} translation Edition de traduction selectionnee.
 * @param {Function} setStatus Callback pour le status affiche.
 * @returns {Promise<void>}
 */
async function addTranslationAndTrim(
	project: Project,
	content: ProjectContent,
	translation: import('$lib/classes').Edition,
	setStatus: (msg: string) => void
): Promise<void> {
	setStatus('Loading translation...');
	console.log('[AiVideo] Adding translation:', translation.name, translation.author);

	const pt = content.projectTranslation;
	const downloadedTranslations = await pt.getAllProjectSubtitlesTranslations(translation);
	console.log('[AiVideo] Downloaded translations count:', Object.keys(downloadedTranslations).length);

	await pt.addTranslation(translation, downloadedTranslations);
	await project.save();

	const aiSettings = globalState.settings?.aiTranslationSettings;
	console.log(
		'[AiVideo] AI settings available:',
		!!aiSettings?.openAiApiKey,
		!!aiSettings?.textAiApiEndpoint
	);

	if (!aiSettings?.openAiApiKey || !aiSettings?.textAiApiEndpoint) {
		console.log('[AiVideo] Skipping AI trim — no API key or endpoint configured.');
		return;
	}

	setStatus('Trimming translations with AI...');
	try {
		const candidates = buildAdvancedTrimVerseCandidates(translation, false);
		console.log('[AiVideo] Trim candidates:', candidates.length);

		if (candidates.length === 0) {
			console.log('[AiVideo] No candidates need AI trimming (all full-verse segments).');
			return;
		}

		const trimModel = aiSettings.advancedTrimModel || 'gpt-5.4';
		const trimReasoning = aiSettings.advancedTrimReasoningEffort || 'none';
		const batches = buildAdvancedTrimBatches(candidates, trimModel, trimReasoning, 0, Infinity);
		console.log('[AiVideo] Trim batches:', batches.length);

		let trimmedSegments = 0;
		let erroredSegments = 0;

		for (let i = 0; i < batches.length; i++) {
			const batch = batches[i];
			setStatus(`Trimming translations with AI... (batch ${i + 1}/${batches.length})`);

			console.log(
				`[AiVideo] Trim batch ${i + 1} REQUEST payload:`,
				JSON.stringify(batch.request, null, 2)
			);

			try {
				const response = await runAdvancedTrimBatchStreaming({
					apiKey: aiSettings.openAiApiKey,
					endpoint: aiSettings.textAiApiEndpoint,
					model: trimModel,
					reasoningEffort: trimReasoning,
					batchId: batch.batchId,
					batch: batch.request
				});
				console.log(`[AiVideo] Trim batch ${i + 1} raw response:`, response.rawText);
				console.log(`[AiVideo] Trim batch ${i + 1} parsed:`, response.parsed);

				const validation = validateAdvancedTrimBatchResult(batch, response.parsed);
				console.log(`[AiVideo] Trim batch ${i + 1} validation:`, {
					valid: validation.validVerses.length,
					errors: validation.errors
				});

				const applyReport = applyAdvancedTrimValidationSuccess(
					translation,
					validation.validVerses
				);
				console.log(`[AiVideo] Trim batch ${i + 1} applied:`, applyReport);

				trimmedSegments += applyReport.appliedSegments;
				erroredSegments += applyReport.erroredSegments;
			} catch (batchError) {
				console.error(`[AiVideo] ❌ AI trim batch ${i + 1} FAILED:`, batchError);
				toast.error(
					`AI trim batch ${i + 1} failed: ${batchError instanceof Error ? batchError.message : String(batchError)}`
				);
				const msg = batchError instanceof Error ? batchError.message : String(batchError);
				if (/\b(401|402|403|429|500|502|503|504)\b/.test(msg)) break;
			}
		}

		if (trimmedSegments > 0) {
			toast.success(`AI trimmed ${trimmedSegments} translation segments.`);
		}
		if (erroredSegments > 0) {
			toast(`${erroredSegments} segments need manual review.`, { duration: 4000 });
		}
	} catch (trimError) {
		console.warn('[AiVideo] AI translation trimming failed:', trimError);
	}

	await project.save();
}
