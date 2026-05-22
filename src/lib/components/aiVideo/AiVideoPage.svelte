<script lang="ts">
	import { onMount } from 'svelte';
	import {
		Project,
		ProjectContent,
		ProjectDetail,
		type AssetClip,
		Edition,
		Utilities,
		SourceType
	} from '$lib/classes';
	import { Quran } from '$lib/classes/Quran';
	import { globalState } from '$lib/runes/main.svelte';
	import { discordService } from '$lib/services/DiscordService';
	import {
		isFullHafsMoshaf,
		isFullHafsReciterId,
		Mp3QuranService,
		type Mp3QuranMoshaf
	} from '$lib/services/Mp3QuranService';
	import { ProjectService } from '$lib/services/ProjectService';
	import { runAutoSegmentation } from '$lib/services/AutoSegmentation';
	import {
		buildAdvancedTrimVerseCandidates,
		buildAdvancedTrimBatches,
		runAdvancedTrimBatchStreaming,
		validateAdvancedTrimBatchResult,
		applyAdvancedTrimValidationSuccess
	} from '$lib/services/AdvancedAITrimming';
	import { invoke } from '@tauri-apps/api/core';
	import { join } from '@tauri-apps/api/path';
	import { copyFile } from '@tauri-apps/plugin-fs';
	import toast from 'svelte-5-french-toast';
	import AiVideoPromptField from './AiVideoPromptField.svelte';
	import AiVideoGenerationOptions from './AiVideoGenerationOptions.svelte';
	import AiVideoQuranSourceSettings from './AiVideoQuranSourceSettings.svelte';
	import AiVideoVerseRangePreview from './AiVideoVerseRangePreview.svelte';
	import SearchableSelect from '$lib/components/misc/SearchableSelect.svelte';

	// ── Debug mode: set to true to skip real AI calls and use mocked responses ──
	const AI_VIDEO_DEBUG = true;

	const MOCK_AI_PLAN = {
		title: 'Al-Fatiha — The Opening',
		videoPrompt:
			'A serene and contemplative visual scene unfolds in a beautiful, tranquil landscape, where lush greenery meets gentle rolling hills under a soft sunset. The colors are warm and inviting, featuring shades of gold and orange mixing with soft pastels. A slow, sweeping camera movement glides through the scene, capturing a babbling brook that flows gracefully, symbolizing peace and the passage of time.',
		reciterId: 54,
		reciter: 'Abdulrahman Alsudaes',
		surah: 1,
		ayahStart: 3,
		ayahEnd: 7
	};

	type ReciterOption = {
		label: string;
		reciterName: string;
		moshaf: Mp3QuranMoshaf;
		reciterId: number;
		surahSet: Set<number>;
	};
	type BackgroundSourceMode = 'ai' | 'youtube';

	// ── Step management ──
	type Step = 'input' | 'review';
	let currentStep = $state<Step>('input');

	// ── Step 1: Input form state ──
	let backgroundSourceMode = $state<BackgroundSourceMode>('ai');
	let prompt = $state('');
	let youtubeVideoUrl = $state('');
	let selectedModel = $state('Mock Provider / Cinematic Nature');
	let resolution = $state<'portrait' | 'landscape'>('portrait');
	let letAiChoose = $state(true);
	let selectedTranslation = $state<Edition | null>(null);

	// Manual Quran source (when "let AI choose" is off)
	let reciter = $state('');
	let selectedReciterOption = $state<ReciterOption | null>(null);
	let surah = $state(1);
	let ayahStart = $state(1);
	let ayahEnd = $state(7);
	let useLocalAudio = $state(false);
	let localAudioPath = $state('');

	let isGeneratingPlan = $state(false);

	const BACKGROUND_VIDEO_URLS = {
		'Mock Provider / Cinematic Nature': {
			landscape: 'https://www.youtube.com/watch?v=JUkNddtZ564',
			portrait: 'https://www.youtube.com/shorts/uDOLjJ3DDQs?feature=share'
		},
		'Mock Provider / Abstract Light': {
			landscape: 'https://www.youtube.com/watch?v=-qq9onL_3WQ',
			portrait: 'https://www.youtube.com/shorts/7U8yeMKPCG0'
		},
		'Mock Provider / Rainy Sky': {
			landscape: 'https://www.youtube.com/watch?v=8npvhQPUXSU',
			portrait: 'https://www.youtube.com/shorts/YL1jtKaZSmc'
		}
	} as const;

	// ── MP3Quran reciters (loaded once, shared for AI prompt + manual selection) ──
	let allReciterOptions = $state<ReciterOption[]>([]);

	onMount(async () => {
		try {
			const mp3Reciters = await Mp3QuranService.getReciters();
			const options: ReciterOption[] = [];
			for (const rec of mp3Reciters) {
				for (const moshaf of rec.moshaf) {
					if (!isFullHafsReciterId(rec.id) || !isFullHafsMoshaf(moshaf)) continue;
					options.push({
						label: `${rec.name} — ${moshaf.name}`,
						reciterName: rec.name,
						moshaf,
						reciterId: rec.id,
						surahSet: new Set(moshaf.surah_list.split(',').map(Number))
					});
				}
			}
			allReciterOptions = options.sort((a, b) => a.label.localeCompare(b.label));
		} catch (error) {
			console.error('Failed to load mp3quran reciters:', error);
		}
	});

	// ── Step 2: Review/recap state (editable) ──
	let reviewTitle = $state('');
	let reviewVideoPrompt = $state('');
	let reviewReciter = $state('');
	let reviewSurah = $state(1);
	let reviewAyahStart = $state(1);
	let reviewAyahEnd = $state(7);

	let isCreatingProject = $state(false);
	let generationStatus = $state('');

	// Surah helpers for review step
	let reviewMaxAyah = $derived(Quran.getVerseCount(reviewSurah) || 1);
	let surahOptions = $derived(
		Quran.getSurahsNames().map((s) => ({
			value: s.id.toString(),
			label: `${s.id}. ${s.transliteration}`
		}))
	);
	let reviewSurahKey = $state('1');
	let reviewReciterKey = $state('');

	$effect(() => {
		const max = Quran.getVerseCount(reviewSurah) || 1;
		if (reviewAyahStart > max) reviewAyahStart = 1;
		if (reviewAyahEnd > max) reviewAyahEnd = max;
		if (reviewAyahEnd < reviewAyahStart) reviewAyahEnd = reviewAyahStart;
	});

	/**
	 * Retourne l'URL de la video de fond pour le modele et le format choisis.
	 * @param {string} modelLabel Libelle du modele selectionne.
	 * @param {'portrait' | 'landscape'} selectedResolution Orientation choisie.
	 * @returns {string} URL YouTube correspondante.
	 */
	function getBackgroundVideoUrl(
		modelLabel: string,
		selectedResolution: 'portrait' | 'landscape'
	): string {
		const urls = BACKGROUND_VIDEO_URLS[modelLabel as keyof typeof BACKGROUND_VIDEO_URLS];
		if (!urls) {
			throw new Error(`Unsupported AI video model: ${modelLabel}`);
		}

		return urls[selectedResolution];
	}

	/**
	 * Retourne les dimensions de projet associees a l'orientation choisie.
	 * @param {'portrait' | 'landscape'} selectedResolution Orientation choisie.
	 * @returns {{ width: number; height: number }} Dimensions video a appliquer.
	 */
	function getProjectDimensionsForResolution(selectedResolution: 'portrait' | 'landscape'): {
		width: number;
		height: number;
	} {
		return selectedResolution === 'portrait'
			? { width: 1080, height: 1920 }
			: { width: 1920, height: 1080 };
	}

	let reviewSurahName = $derived(() => {
		const names = Quran.getSurahsNames();
		const found = names.find((s) => s.id === reviewSurah);
		return found ? `${found.id}. ${found.transliteration}` : `${reviewSurah}`;
	});

	// ── Navigation ──
	let reviewReciterOptions = $derived(
		allReciterOptions.map((option) => ({
			value: getReciterOptionKey(option),
			label: option.label
		}))
	);

	/**
	 * Retourne la cle stable utilisee par le select recitateur de review.
	 * @param {ReciterOption} option Option de recitateur MP3Quran.
	 * @returns {string} Cle unique recitateur/moshaf.
	 */
	function getReciterOptionKey(option: ReciterOption): string {
		return `${option.reciterId}:${option.moshaf.id}`;
	}

	/**
	 * Applique le recitateur choisi a l'etape de review.
	 * @returns {void}
	 */
	function handleReviewReciterChange() {
		const option = allReciterOptions.find((item) => getReciterOptionKey(item) === reviewReciterKey);
		selectedReciterOption = option ?? null;
		reviewReciter = option?.reciterName ?? '';
		reciter = option?.reciterName ?? '';
	}

	$effect(() => {
		reviewReciterKey = selectedReciterOption ? getReciterOptionKey(selectedReciterOption) : '';
	});

	$effect(() => {
		reviewSurahKey = reviewSurah.toString();
	});

	/**
	 * Applique la sourate choisie dans le select de review.
	 * @returns {void}
	 */
	function handleReviewSurahChange() {
		reviewSurah = parseInt(reviewSurahKey);
		reviewAyahStart = 1;
		reviewAyahEnd = Quran.getVerseCount(reviewSurah) || 1;
	}

	function goBack() {
		if (currentStep === 'review') {
			currentStep = 'input';
		} else {
			globalState.currentPage = 'home';
		}
	}

	// ── Step 1 → Step 2: Generate AI plan then show review ──
	async function handleGeneratePlan() {
		const requiresThemePrompt = backgroundSourceMode === 'ai' || letAiChoose;

		if (requiresThemePrompt && prompt.trim() === '') {
			toast.error('Please enter a video theme or topic.');
			return;
		}

		if (backgroundSourceMode === 'youtube' && youtubeVideoUrl.trim() === '') {
			toast.error('Please enter a YouTube video URL.');
			return;
		}

		if (!letAiChoose && !useLocalAudio && reciter.trim() === '') {
			toast.error('Please select a reciter or choose a local audio file.');
			return;
		}

		if (!letAiChoose && useLocalAudio && !localAudioPath) {
			toast.error('Please select a local audio file.');
			return;
		}

		isGeneratingPlan = true;

		try {
			const plan = await generateAiPlan();

			// Populate review state
			reviewTitle = plan.title;
			reviewVideoPrompt = backgroundSourceMode === 'youtube' ? youtubeVideoUrl : plan.videoPrompt;
			reviewReciter = plan.reciter;
			reviewSurah = plan.surah;
			reviewAyahStart = plan.ayahStart;
			reviewAyahEnd = plan.ayahEnd;

			// Resolve AI-chosen reciter to a real ReciterOption for downloading
			if (letAiChoose && plan.reciterId) {
				const resolved = resolveAiReciterOption(plan.reciterId);
				if (resolved) {
					selectedReciterOption = resolved;
					reciter = resolved.reciterName;
					reviewReciter = resolved.reciterName;
				} else {
					toast.error(
						'AI selected a reciter that could not be resolved. Please pick one manually in the review.'
					);
				}
			}

			currentStep = 'review';
		} catch (error) {
			console.error('AI plan generation failed:', error);
			// Error toast already shown in generateAiPlan
		} finally {
			isGeneratingPlan = false;
		}
	}

	// ── Step 2 → Create project ──
	// Captures step-1 values before navigating away (component may unmount)
	async function handleCreateProject() {
		isCreatingProject = true;

		// Snapshot values before the component unmounts
		const snapshotTranslation = selectedTranslation;
		const snapshotReciterOption = selectedReciterOption;
		const snapshotUseLocal = useLocalAudio;
		const snapshotLocalPath = localAudioPath;
		const snapshotSurah = reviewSurah;
		const snapshotAyahStart = reviewAyahStart;
		const snapshotAyahEnd = reviewAyahEnd;
		const snapshotReciterName = reviewReciter;
		const snapshotPrompt = prompt;
		const snapshotTitle = reviewTitle;
		const snapshotReviewVideoPrompt = reviewVideoPrompt;
		const snapshotSelectedModel = selectedModel;
		const snapshotResolution = resolution;
		const snapshotBackgroundSourceMode = backgroundSourceMode;

		const setStatus = (msg: string) => {
			generationStatus = msg;
			globalState.aiVideoGenerationStatus = msg;
			console.log(`[AiVideo] ${msg}`);
		};

		setStatus('Creating project...');

		try {
			const projectName = `AI - ${(snapshotTitle || snapshotPrompt).trim().slice(0, 50)}`;

			if (Utilities.isPathNotSafe(projectName)) {
				toast.error('Generated project name contains invalid characters.');
				return;
			}

			const projectDetail = new ProjectDetail(
				projectName,
				snapshotReciterName,
				undefined,
				undefined,
				'Others'
			);
			const content = await ProjectContent.getDefaultProjectContent();
			const project = new Project(projectDetail, content);
			await project.save();

			// Open the project (editor renders underneath the overlay)
			globalState.currentProject = project;
			globalState.currentPage = 'home';
			discordService.setEditingState();

			const assetFolder = await ProjectService.getAssetFolderForProject(project.detail.id);
			const backgroundVideoUrl =
				snapshotBackgroundSourceMode === 'youtube'
					? snapshotReviewVideoPrompt.trim()
					: getBackgroundVideoUrl(snapshotSelectedModel, snapshotResolution);

			if (snapshotBackgroundSourceMode === 'ai') {
				content.videoStyle.getStylesOfTarget('global').findStyle('video-dimension')!.value =
					getProjectDimensionsForResolution(snapshotResolution);
			}

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

			if (snapshotBackgroundSourceMode === 'youtube') {
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

			// ── 1. Get audio file into the project ──
			let audioFilePath: string;

			if (snapshotUseLocal && snapshotLocalPath) {
				setStatus('Copying audio file...');
				const ext = snapshotLocalPath.split('.').pop() || 'mp3';
				const destFileName = `local-audio.${ext}`;
				audioFilePath = await join(assetFolder, destFileName);
				await copyFile(snapshotLocalPath, audioFilePath);
			} else if (snapshotReciterOption) {
				setStatus('Downloading recitation...');
				const formattedSurahId = snapshotSurah.toString().padStart(3, '0');
				const audioUrl = `${snapshotReciterOption.moshaf.server}${formattedSurahId}.mp3`;
				const fullSurahPath = await join(assetFolder, `full-surah-${formattedSurahId}.mp3`);

				await invoke('download_file', {
					url: audioUrl,
					path: fullSurahPath
				});

				// ── 2. Trim to verse range using timing data ──
				const surahVerseCount = Quran.getVerseCount(snapshotSurah) || 1;
				const needsTrim = snapshotAyahStart > 1 || snapshotAyahEnd < surahVerseCount;

				if (needsTrim) {
					setStatus('Trimming audio to verse range...');
					try {
						const timings = await Mp3QuranService.getSurahTiming(
							snapshotReciterOption.moshaf.id,
							snapshotSurah
						);

						if (timings && timings.length > 0) {
							const startTiming = timings.find((t) => t.ayah === snapshotAyahStart);
							const endTiming = timings.find((t) => t.ayah === snapshotAyahEnd);

							if (startTiming && endTiming) {
								const trimmedFileName = `${snapshotReciterName.replace(/[<>:"/\\|?*]/g, '').trim() || 'reciter'}-${snapshotSurah}-${snapshotAyahStart}-${snapshotAyahEnd}.mp3`;
								audioFilePath = await join(assetFolder, trimmedFileName);

								await invoke('cut_audio', {
									sourcePath: fullSurahPath,
									startMs: startTiming.start_time,
									endMs: endTiming.end_time,
									outputPath: audioFilePath
								});
							} else {
								audioFilePath = fullSurahPath;
							}
						} else {
							audioFilePath = fullSurahPath;
						}
					} catch (trimError) {
						console.warn('[AiVideo] Trimming failed, using full surah:', trimError);
						audioFilePath = fullSurahPath;
					}
				} else {
					audioFilePath = fullSurahPath;
				}
			} else {
				toast.error('No audio source selected.');
				return;
			}

			// ── 3. Add audio to project and timeline ──
			setStatus('Adding audio to timeline...');
			const sourceType = snapshotUseLocal ? SourceType.Local : SourceType.Mp3Quran;
			const metadata: Record<string, unknown> = {};

			if (!snapshotUseLocal && snapshotReciterOption) {
				metadata.mp3Quran = {
					reciterId: snapshotReciterOption.reciterId,
					moshafId: snapshotReciterOption.moshaf.id,
					surahId: snapshotSurah
				};
				metadata.nativeTiming = {
					provider: 'mp3quran',
					reciterId: snapshotReciterOption.reciterId,
					moshafId: snapshotReciterOption.moshaf.id,
					surahId: snapshotSurah
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

			// ── 4. Run auto-segmentation (cloud) ──
			setStatus('Generating subtitles with AI...');

			const segResult = await runAutoSegmentation({}, 'api');
			console.log('[AiVideo] Segmentation result:', segResult);

			if (segResult && segResult.status === 'failed') {
				toast.error(`Subtitles failed: ${segResult.message}. Project created without subtitles.`);
				await project.save();
				return;
			}

			await project.save();

			// ── 5. Add translation to the project ──
			if (snapshotTranslation) {
				setStatus('Loading translation...');
				console.log(
					'[AiVideo] Adding translation:',
					snapshotTranslation.name,
					snapshotTranslation.author
				);
				const pt = content.projectTranslation;
				const downloadedTranslations =
					await pt.getAllProjectSubtitlesTranslations(snapshotTranslation);
				console.log(
					'[AiVideo] Downloaded translations count:',
					Object.keys(downloadedTranslations).length
				);
				await pt.addTranslation(snapshotTranslation, downloadedTranslations);
				await project.save();

				// ── 6. Run Advanced AI Translation Trimmer v2 ──
				const aiSettings = globalState.settings?.aiTranslationSettings;
				console.log(
					'[AiVideo] AI settings available:',
					!!aiSettings?.openAiApiKey,
					!!aiSettings?.textAiApiEndpoint
				);

				if (aiSettings?.openAiApiKey && aiSettings?.textAiApiEndpoint) {
					setStatus('Trimming translations with AI...');
					try {
						const candidates = buildAdvancedTrimVerseCandidates(snapshotTranslation, false);
						console.log('[AiVideo] Trim candidates:', candidates.length);

						if (candidates.length > 0) {
							const trimModel = aiSettings.advancedTrimModel || 'gpt-5.4';
							const trimReasoning = aiSettings.advancedTrimReasoningEffort || 'none';
							const batches = buildAdvancedTrimBatches(
								candidates,
								trimModel,
								trimReasoning,
								0,
								Infinity
							);
							console.log('[AiVideo] Trim batches:', batches.length);

							let trimmedSegments = 0;
							let erroredSegments = 0;

							for (let i = 0; i < batches.length; i++) {
								setStatus(`Trimming translations with AI... (batch ${i + 1}/${batches.length})`);
								const batch = batches[i];

								console.log(
									`[AiVideo] Trim batch ${i + 1} REQUEST payload:`,
									JSON.stringify(batch.request, null, 2)
								);
								console.log(
									`[AiVideo] Trim batch ${i + 1} calling runAdvancedTrimBatchStreaming with model=${trimModel} endpoint=${aiSettings.textAiApiEndpoint}`
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
										snapshotTranslation,
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
						} else {
							console.log('[AiVideo] No candidates need AI trimming (all full-verse segments).');
						}
					} catch (trimError) {
						console.warn('[AiVideo] AI translation trimming failed:', trimError);
					}
				} else {
					console.log('[AiVideo] Skipping AI trim — no API key or endpoint configured.');
				}

				await project.save();
			} else {
				console.log('[AiVideo] No translation selected, skipping translation step.');
			}

			setStatus('Finalizing project...');
			toast.success('Project ready!');
		} catch (error) {
			console.error('[AiVideo] Project creation failed:', error);
			toast.error(`Failed to create project: ${error}`);
		} finally {
			isCreatingProject = false;
			generationStatus = '';
			globalState.aiVideoGenerationStatus = '';
		}
	}

	// ── Build condensed reciter list for AI prompt ──
	/**
	 * Indique si un moshaf MP3Quran est Hafs A'n Assem et contient les 114 sourates.
	 * @param {Mp3QuranMoshaf} moshaf Moshaf MP3Quran a verifier.
	 * @returns {boolean} True si le moshaf est eligible pour le choix IA.
	 */
	/**
	 * Retourne le moshaf complet Hafs A'n Assem associe a un recitateur autorise par l'IA.
	 * @param {number} reciterId Identifiant MP3Quran du recitateur.
	 * @returns {ReciterOption | null} Option MP3Quran resolue.
	 */
	function resolveAiReciterOption(reciterId: number): ReciterOption | null {
		if (!isFullHafsReciterId(reciterId)) return null;
		return allReciterOptions.find((option) => option.reciterId === reciterId) ?? null;
	}

	function buildReciterListForAi(): string {
		const seen = new Set<number>();
		const lines: string[] = [];
		for (const opt of allReciterOptions) {
			if (!resolveAiReciterOption(opt.reciterId)) continue;
			if (seen.has(opt.reciterId)) continue;
			seen.add(opt.reciterId);
			lines.push(`{ "reciterId": ${opt.reciterId}, "name": "${opt.reciterName}" }`);
		}
		return lines.join('\n');
	}

	// ── AI plan generation ──
	async function generateAiPlan(): Promise<{
		title: string;
		videoPrompt: string;
		reciter: string;
		reciterId: number;
		surah: number;
		ayahStart: number;
		ayahEnd: number;
	}> {
		if (!letAiChoose) {
			return {
				title:
					backgroundSourceMode === 'youtube'
						? 'YouTube Video Project'
						: prompt.trim().slice(0, 50) || 'AI Video Project',
				videoPrompt: backgroundSourceMode === 'youtube' ? youtubeVideoUrl : prompt,
				reciter,
				reciterId: selectedReciterOption?.reciterId ?? 0,
				surah,
				ayahStart,
				ayahEnd
			};
		}

		// Debug mode: return mock plan instantly
		if (AI_VIDEO_DEBUG) {
			console.log('[AiVideo] DEBUG MODE — returning mock AI plan');
			return { ...MOCK_AI_PLAN };
		}

		if (allReciterOptions.length === 0) {
			toast.error('Reciters are still loading. Please wait a moment and try again.');
			throw new Error('Reciters not loaded yet');
		}

		const aiSettings = globalState.settings?.aiTranslationSettings;
		if (!aiSettings?.openAiApiKey || !aiSettings?.textAiApiEndpoint) {
			toast.error('Please configure your AI API key and endpoint in Settings > AI Key first.');
			throw new Error('AI settings not configured');
		}

		const reciterList = buildReciterListForAi();
		const shouldAskForVideoPrompt = backgroundSourceMode === 'ai';
		const forcedReciterOption =
			selectedReciterOption && !useLocalAudio
				? resolveAiReciterOption(selectedReciterOption.reciterId)
				: null;
		const forcedReciterInstruction =
			forcedReciterOption
				? `\nThe user already selected this reciter. You MUST use reciterId = ${forcedReciterOption.reciterId}, reciter = "${forcedReciterOption.reciterName}".`
				: '';

		const systemPrompt = `You are a Quran video planning assistant. Given a theme or topic, you must:
1. Select the most relevant Quran verses for this theme
2. Choose a reciter from the available list below
${shouldAskForVideoPrompt ? '3. Write a detailed visual prompt that would be sent to an AI video generation model' : ''}

AVAILABLE RECITERS (you MUST pick from this list using exact IDs):
${reciterList}

Respond ONLY with valid JSON in this exact format:
{
  "title": "A short project title (max 50 characters) summarizing the theme and verses",
  "videoPrompt": "${shouldAskForVideoPrompt ? 'A cinematic, detailed visual description for AI video generation. Describe the mood, colors, camera movement, scenery. Be very descriptive and visual.' : ''}",
  "reciterId": <reciter ID from the list above>,
  "reciter": "Name of the selected reciter",
  "surah": <surah number 1-114>,
  "ayahStart": <starting verse number>,
  "ayahEnd": <ending verse number>
}

Rules:
- Choose verses that are MOST relevant to the given theme
- Keep the verse range reasonable (3-15 verses)
- ${shouldAskForVideoPrompt ? 'The videoPrompt should describe a beautiful, contemplative visual scene matching the theme' : 'Leave videoPrompt as an empty string'}
- Pick a reciter whose style matches the mood (e.g. emotional themes → emotional reciter)
- You MUST use reciterId from the available reciters list${forcedReciterInstruction}`;

		const response = await fetch(aiSettings.textAiApiEndpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${aiSettings.openAiApiKey}`
			},
			body: JSON.stringify({
				model: aiSettings.advancedTrimModel || 'gpt-4o-mini',
				input: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: `Theme: "${prompt}"` }
				]
			})
		});

		if (!response.ok) {
			const errorText = await response.text();
			toast.error(`AI API error: ${response.status}`);
			throw new Error(`AI API returned ${response.status}: ${errorText}`);
		}

		const data = await response.json();
		console.log('[AiVideo] AI plan raw response:', JSON.stringify(data, null, 2));

		// Extract text from OpenAI responses API format
		let text = '';
		if (data.output) {
			for (const item of data.output) {
				if (item.type === 'message' && item.content) {
					for (const block of item.content) {
						if (block.type === 'output_text') {
							text = block.text;
						}
					}
				}
			}
		}

		console.log('[AiVideo] AI plan extracted text:', text);

		if (!text) {
			toast.error('AI returned an empty response.');
			throw new Error('No text response from AI');
		}

		// Parse JSON (handle markdown code blocks)
		const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
		const plan = JSON.parse(jsonMatch[1]!.trim());
		console.log('[AiVideo] AI plan parsed:', plan);

		return {
			title: plan.title || prompt.trim().slice(0, 50),
			videoPrompt:
				backgroundSourceMode === 'youtube' ? youtubeVideoUrl : plan.videoPrompt || prompt,
			reciter: plan.reciter || 'Unknown',
			reciterId: plan.reciterId || 0,
			surah: Math.max(1, Math.min(114, plan.surah || 1)),
			ayahStart: Math.max(1, plan.ayahStart || 1),
			ayahEnd: Math.max(1, plan.ayahEnd || 7)
		};
	}
</script>

<div class="flex min-h-full flex-col overflow-auto">
	<div class="mx-auto w-full max-w-2xl px-4 py-8 xl:py-14">
		<!-- Header -->
		<div class="mb-8">
			<button
				type="button"
				class="flex items-center gap-1 text-sm text-secondary hover:text-primary transition-colors mb-4 cursor-pointer"
				onclick={goBack}
			>
				<span class="material-icons text-base">arrow_back</span>
				{currentStep === 'review' ? 'Back to options' : 'Back to Home'}
			</button>

			<div class="flex items-center gap-4">
				<div
					class="w-12 h-12 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center shadow-lg"
				>
					<span class="material-icons text-white text-xl">auto_awesome</span>
				</div>
				<div>
					<h1 class="text-3xl font-bold text-primary">AI Video</h1>
					<p class="text-sm text-secondary">
						{currentStep === 'input'
							? 'Describe your video theme and choose your options'
							: 'Review and adjust before creating the project'}
					</p>
				</div>
			</div>

			<!-- Step indicator -->
			<div class="flex items-center gap-3 mt-6">
				<div class="flex items-center gap-2">
					<div
						class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold {currentStep ===
						'input'
							? 'bg-accent-primary text-black'
							: 'bg-accent-primary/20 text-accent-primary'}"
					>
						1
					</div>
					<span
						class="text-sm {currentStep === 'input' ? 'text-primary font-medium' : 'text-thirdly'}"
					>
						Options
					</span>
				</div>
				<div class="flex-1 h-px bg-[var(--border-color)]"></div>
				<div class="flex items-center gap-2">
					<div
						class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold {currentStep ===
						'review'
							? 'bg-accent-primary text-black'
							: 'bg-[var(--bg-secondary)] text-thirdly border border-color'}"
					>
						2
					</div>
					<span
						class="text-sm {currentStep === 'review' ? 'text-primary font-medium' : 'text-thirdly'}"
					>
						Review & Create
					</span>
				</div>
			</div>
		</div>

		<!-- ═══════════════════════ STEP 1: Input ═══════════════════════ -->
		{#if currentStep === 'input'}
			<div class="space-y-6">
				<AiVideoPromptField
					bind:value={prompt}
					bind:youtubeUrl={youtubeVideoUrl}
					bind:sourceMode={backgroundSourceMode}
				/>

				<AiVideoGenerationOptions
					bind:sourceMode={backgroundSourceMode}
					bind:selectedModel
					bind:resolution
					bind:letAiChoose
					bind:selectedTranslation
				/>

				<AiVideoQuranSourceSettings
					bind:letAiChoose
					bind:reciter
					bind:selectedReciterOption
					bind:surah
					bind:ayahStart
					bind:ayahEnd
					bind:useLocalAudio
					bind:localAudioPath
				/>

				{#if !letAiChoose && !useLocalAudio}
					<AiVideoVerseRangePreview {surah} {ayahStart} {ayahEnd} {selectedTranslation} />
				{/if}

				<!-- Next / Generate Plan button -->
				<button
					type="button"
					class="w-full rounded-xl bg-accent-primary px-6 py-4 text-base font-semibold text-black shadow-lg hover:bg-blue-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2"
					disabled={isGeneratingPlan ||
						((backgroundSourceMode === 'ai' || letAiChoose) && prompt.trim() === '') ||
						(backgroundSourceMode === 'youtube' && youtubeVideoUrl.trim() === '')}
					onclick={handleGeneratePlan}
				>
					{#if isGeneratingPlan}
						<span class="material-icons animate-spin text-lg">autorenew</span>
						{letAiChoose ? 'AI is planning your video...' : 'Preparing review...'}
					{:else}
						<span class="material-icons text-lg">arrow_forward</span>
						{letAiChoose ? 'Generate AI Plan' : 'Review & Continue'}
					{/if}
				</button>

				{#if letAiChoose}
					<p class="text-center text-xs text-thirdly">
						AI will use your configured API to select a verse range and, if needed, a reciter.
					</p>
				{/if}
			</div>

			<!-- ═══════════════════════ STEP 2: Review ═══════════════════════ -->
		{:else}
			<div class="space-y-6">
				<!-- Video Generation Prompt -->
				<div class="space-y-2">
					<span class="flex items-center gap-2 text-sm font-semibold text-primary">
						<span class="material-icons text-accent-primary text-base">movie_creation</span>
						{backgroundSourceMode === 'youtube' ? 'YouTube Video URL' : 'Video Generation Prompt'}
					</span>
					{#if backgroundSourceMode === 'youtube'}
						<input
							type="text"
							bind:value={reviewVideoPrompt}
							class="w-full rounded-xl border border-color bg-bg-secondary px-4 py-3 text-primary placeholder:text-thirdly focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary transition-all text-sm"
							placeholder="https://www.youtube.com/watch?v=..."
						/>
						<p class="text-xs text-thirdly">
							The downloaded video's own orientation will be used automatically.
						</p>
					{:else}
						<textarea
							bind:value={reviewVideoPrompt}
							rows={4}
							class="w-full rounded-xl border border-color bg-bg-secondary px-4 py-3 text-primary placeholder:text-thirdly resize-none focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary transition-all text-sm leading-relaxed"
							placeholder="Visual description for the AI video generator..."
						></textarea>
						<p class="text-xs text-thirdly">
							This prompt will be sent to the video generation API. Edit it to adjust the visual
							style.
						</p>
					{/if}
				</div>

				<!-- Reciter -->
				<div class="space-y-2">
					<span class="flex items-center gap-2 text-sm font-semibold text-primary">
						<span class="material-icons text-accent-primary text-base">record_voice_over</span>
						Reciter
					</span>
					<SearchableSelect
						id="review-reciter-select"
						bind:value={reviewReciterKey}
						options={reviewReciterOptions}
						placeholder="Select a reciter"
						searchPlaceholder="Search reciters..."
						emptyMessage="No reciters found"
						onChange={handleReviewReciterChange}
					/>
				</div>

				{#if !useLocalAudio || letAiChoose}
					<!-- Verse Range -->
					<div class="space-y-3">
						<span class="flex items-center gap-2 text-sm font-semibold text-primary">
							<span class="material-icons text-accent-primary text-base">menu_book</span>
							Verse Range
						</span>

						<SearchableSelect
							id="review-surah-select"
							bind:value={reviewSurahKey}
							options={surahOptions}
							placeholder="Select surah"
							searchPlaceholder="Search surah..."
							emptyMessage="No surah found"
							onChange={handleReviewSurahChange}
						/>

						<div class="flex gap-3">
							<div class="flex-1 space-y-1">
								<label for="review-ayah-start" class="text-xs text-thirdly">From Ayah</label>
								<input
									id="review-ayah-start"
									type="number"
									bind:value={reviewAyahStart}
									min={1}
									max={reviewMaxAyah}
									class="w-full rounded-xl border border-color bg-bg-secondary px-4 py-2.5 text-primary text-sm"
								/>
							</div>
							<div class="flex-1 space-y-1">
								<label for="review-ayah-end" class="text-xs text-thirdly">To Ayah</label>
								<input
									id="review-ayah-end"
									type="number"
									bind:value={reviewAyahEnd}
									min={reviewAyahStart}
									max={reviewMaxAyah}
									class="w-full rounded-xl border border-color bg-bg-secondary px-4 py-2.5 text-primary text-sm"
								/>
							</div>
						</div>
					</div>

					<!-- Verse preview -->
					<AiVideoVerseRangePreview
						surah={reviewSurah}
						ayahStart={reviewAyahStart}
						ayahEnd={reviewAyahEnd}
						{selectedTranslation}
					/>
				{/if}

				<!-- Summary card -->
				<div class="rounded-xl border border-color bg-bg-secondary/50 p-5 space-y-3">
					<h4
						class="flex items-center gap-2 text-xs font-semibold text-thirdly uppercase tracking-wide"
					>
						<span class="material-icons text-accent-primary text-sm">summarize</span>
						Summary
					</h4>
					<div class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
						<div>
							<span class="text-thirdly text-xs">
								{backgroundSourceMode === 'youtube' ? 'Background Video' : 'Theme'}
							</span>
							<p class="text-primary font-medium truncate">
								{backgroundSourceMode === 'youtube' ? reviewVideoPrompt : prompt}
							</p>
						</div>
						{#if backgroundSourceMode === 'ai'}
							<div>
								<span class="text-thirdly text-xs">Model</span>
								<p class="text-primary font-medium">{selectedModel}</p>
							</div>
						{/if}
						{#if !useLocalAudio || letAiChoose}<div>
								<span class="text-thirdly text-xs">Surah</span>
								<p class="text-primary font-medium">{reviewSurahName()}</p>
							</div>{/if}
						<div>
							<span class="text-thirdly text-xs">Verses</span>
							<p class="text-primary font-medium">{reviewAyahStart} – {reviewAyahEnd}</p>
						</div>
						<div>
							<span class="text-thirdly text-xs">Reciter</span>
							<p class="text-primary font-medium truncate">{reviewReciter}</p>
						</div>
						{#if backgroundSourceMode === 'ai'}
							<div>
								<span class="text-thirdly text-xs">Resolution</span>
								<p class="text-primary font-medium">
									{resolution === 'portrait' ? 'Portrait (9:16)' : 'Landscape (16:9)'}
								</p>
							</div>
						{/if}
						{#if selectedTranslation}
							<div class="col-span-2">
								<span class="text-thirdly text-xs">Translation</span>
								<p class="text-primary font-medium">
									{selectedTranslation.author} ({selectedTranslation.language})
								</p>
							</div>
						{/if}
					</div>
				</div>

				<!-- Action buttons -->
				<div class="flex gap-3">
					<button
						type="button"
						class="flex-1 rounded-xl border border-color bg-bg-secondary px-6 py-4 text-sm font-medium text-primary hover:border-accent-primary/50 transition-all cursor-pointer flex items-center justify-center gap-2"
						disabled={isCreatingProject}
						onclick={() => (currentStep = 'input')}
					>
						<span class="material-icons text-base">arrow_back</span>
						Back
					</button>
					<button
						type="button"
						class="flex-[2] rounded-xl bg-accent-primary px-6 py-4 text-base font-semibold text-black shadow-lg hover:bg-blue-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2"
						disabled={isCreatingProject || reviewVideoPrompt.trim() === ''}
						onclick={handleCreateProject}
					>
						{#if isCreatingProject}
							<span class="material-icons animate-spin text-lg">autorenew</span>
							{generationStatus || 'Creating project...'}
						{:else}
							<span class="material-icons text-lg">movie_creation</span>
							Create Project
						{/if}
					</button>
				</div>

				<p class="text-center text-xs text-thirdly">
					{backgroundSourceMode === 'youtube'
						? 'The YouTube video will be downloaded and used as the background during project creation.'
						: 'Video generation is currently mocked. A real AI-generated background will be added later.'}
				</p>
			</div>
		{/if}
	</div>
</div>
