<script lang="ts">
	import { onMount } from 'svelte';
	import { Project, ProjectContent, ProjectDetail, Edition, Utilities, SourceType } from '$lib/classes';
	import { Quran } from '$lib/classes/Quran';
	import { globalState } from '$lib/runes/main.svelte';
	import { discordService } from '$lib/services/DiscordService';
	import {
		Mp3QuranService,
		type Mp3QuranMoshaf,
		type Mp3QuranReciter
	} from '$lib/services/Mp3QuranService';
	import { ProjectService } from '$lib/services/ProjectService';
	import { runAutoSegmentation } from '$lib/services/AutoSegmentation';
	import { invoke } from '@tauri-apps/api/core';
	import { join } from '@tauri-apps/api/path';
	import { copyFile } from '@tauri-apps/plugin-fs';
	import toast from 'svelte-5-french-toast';
	import AiVideoPromptField from './AiVideoPromptField.svelte';
	import AiVideoGenerationOptions from './AiVideoGenerationOptions.svelte';
	import AiVideoQuranSourceSettings from './AiVideoQuranSourceSettings.svelte';
	import AiVideoVerseRangePreview from './AiVideoVerseRangePreview.svelte';
	import AutocompleteInput from '$lib/components/misc/AutocompleteInput.svelte';

	type ReciterOption = {
		label: string;
		reciterName: string;
		moshaf: Mp3QuranMoshaf;
		reciterId: number;
		surahSet: Set<number>;
	};

	// ── Step management ──
	type Step = 'input' | 'review';
	let currentStep = $state<Step>('input');

	// ── Step 1: Input form state ──
	let prompt = $state('');
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

	// ── MP3Quran reciters (loaded once, shared for AI prompt + manual selection) ──
	let allReciterOptions = $state<ReciterOption[]>([]);

	onMount(async () => {
		try {
			const mp3Reciters = await Mp3QuranService.getReciters();
			const options: ReciterOption[] = [];
			for (const rec of mp3Reciters) {
				for (const moshaf of rec.moshaf) {
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
	let reviewVideoPrompt = $state('');
	let reviewReciter = $state('');
	let reviewSurah = $state(1);
	let reviewAyahStart = $state(1);
	let reviewAyahEnd = $state(7);

	let isCreatingProject = $state(false);
	let generationStatus = $state('');

	// Surah helpers for review step
	let reviewMaxAyah = $derived(Quran.getVerseCount(reviewSurah) || 1);
	let surahSuggestions = $derived(
		Quran.getSurahsNames().map((s) => `${s.id}. ${s.transliteration}`)
	);
	let reviewSurahSearchValue = $state('');

	$effect(() => {
		const max = Quran.getVerseCount(reviewSurah) || 1;
		if (reviewAyahStart > max) reviewAyahStart = 1;
		if (reviewAyahEnd > max) reviewAyahEnd = max;
		if (reviewAyahEnd < reviewAyahStart) reviewAyahEnd = reviewAyahStart;
	});

	function handleReviewSurahSelection(value: string) {
		const match = value.match(/^(\d+)\./);
		if (match) {
			reviewSurah = parseInt(match[1]);
			reviewAyahStart = 1;
			reviewAyahEnd = Quran.getVerseCount(reviewSurah) || 1;
		}
	}

	let reviewSurahName = $derived(() => {
		const names = Quran.getSurahsNames();
		const found = names.find((s) => s.id === reviewSurah);
		return found ? `${found.id}. ${found.transliteration}` : `${reviewSurah}`;
	});

	// ── Navigation ──
	function goBack() {
		if (currentStep === 'review') {
			currentStep = 'input';
		} else {
			globalState.currentPage = 'home';
		}
	}

	// ── Step 1 → Step 2: Generate AI plan then show review ──
	async function handleGeneratePlan() {
		if (prompt.trim() === '') {
			toast.error('Please enter a video theme or topic.');
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
			reviewVideoPrompt = plan.videoPrompt;
			reviewReciter = plan.reciter;
			reviewSurah = plan.surah;
			reviewAyahStart = plan.ayahStart;
			reviewAyahEnd = plan.ayahEnd;

			// Resolve AI-chosen reciter to a real ReciterOption for downloading
			if (letAiChoose && plan.reciterId) {
				const resolved = resolveReciterOption(plan.reciterId, plan.moshafId, plan.surah);
				if (resolved) {
					selectedReciterOption = resolved;
					reciter = resolved.reciterName;
				} else {
					toast.error('AI selected a reciter that could not be resolved. Please pick one manually in the review.');
				}
			}

			// Set the surah search value for the autocomplete
			const surahNames = Quran.getSurahsNames();
			const found = surahNames.find((s) => s.id === plan.surah);
			reviewSurahSearchValue = found ? `${found.id}. ${found.transliteration}` : `${plan.surah}`;

			currentStep = 'review';
		} catch (error) {
			console.error('AI plan generation failed:', error);
			// Error toast already shown in generateAiPlan
		} finally {
			isGeneratingPlan = false;
		}
	}

	// ── Step 2 → Create project ──
	async function handleCreateProject() {
		isCreatingProject = true;
		generationStatus = 'Creating project...';

		try {
			const projectName = `AI - ${prompt.trim().slice(0, 40)}`;

			if (Utilities.isPathNotSafe(projectName)) {
				toast.error('Generated project name contains invalid characters.');
				return;
			}

			const projectDetail = new ProjectDetail(
				projectName,
				reviewReciter,
				undefined,
				undefined,
				'Others'
			);
			const content = await ProjectContent.getDefaultProjectContent();
			const project = new Project(projectDetail, content);
			await project.save();

			// Set as current project so segmentation functions can access tracks
			globalState.currentProject = project;
			discordService.setEditingState();

			const assetFolder = await ProjectService.getAssetFolderForProject(project.detail.id);

			// ── 1. Get audio file into the project ──
			let audioFilePath: string;

			if (useLocalAudio && localAudioPath) {
				// Copy local audio file to project assets
				generationStatus = 'Copying audio file...';
				const ext = localAudioPath.split('.').pop() || 'mp3';
				const destFileName = `local-audio.${ext}`;
				audioFilePath = await join(assetFolder, destFileName);
				await copyFile(localAudioPath, audioFilePath);
			} else if (selectedReciterOption) {
				// Download full surah from MP3Quran
				generationStatus = 'Downloading recitation...';
				const formattedSurahId = reviewSurah.toString().padStart(3, '0');
				const audioUrl = `${selectedReciterOption.moshaf.server}${formattedSurahId}.mp3`;
				const fullSurahPath = await join(assetFolder, `full-surah-${formattedSurahId}.mp3`);

				await invoke('download_file', {
					url: audioUrl,
					path: fullSurahPath
				});

				// ── 2. Trim to verse range using timing data ──
				const surahVerseCount = Quran.getVerseCount(reviewSurah) || 1;
				const needsTrim = reviewAyahStart > 1 || reviewAyahEnd < surahVerseCount;

				if (needsTrim) {
					generationStatus = 'Trimming audio to verse range...';
					try {
						const timings = await Mp3QuranService.getSurahTiming(
							selectedReciterOption.moshaf.id,
							reviewSurah
						);

						if (timings && timings.length > 0) {
							const startTiming = timings.find((t) => t.ayah === reviewAyahStart);
							const endTiming = timings.find((t) => t.ayah === reviewAyahEnd);

							if (startTiming && endTiming) {
								const trimmedFileName = `${reviewReciter.replace(/[<>:"/\\|?*]/g, '').trim() || 'reciter'}-${reviewSurah}-${reviewAyahStart}-${reviewAyahEnd}.mp3`;
								audioFilePath = await join(assetFolder, trimmedFileName);

								await invoke('cut_audio', {
									sourcePath: fullSurahPath,
									startMs: startTiming.start_time,
									endMs: endTiming.end_time,
									outputPath: audioFilePath
								});
							} else {
								// Timings not found for specific verses, use full file
								audioFilePath = fullSurahPath;
							}
						} else {
							audioFilePath = fullSurahPath;
						}
					} catch (trimError) {
						console.warn('Trimming failed, using full surah:', trimError);
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
			generationStatus = 'Adding audio to timeline...';
			const sourceType = useLocalAudio ? SourceType.Local : SourceType.Mp3Quran;
			const metadata: Record<string, unknown> = {};

			if (!useLocalAudio && selectedReciterOption) {
				metadata.mp3Quran = {
					reciterId: selectedReciterOption.reciterId,
					moshafId: selectedReciterOption.moshaf.id,
					surahId: reviewSurah
				};
				metadata.nativeTiming = {
					provider: 'mp3quran',
					reciterId: selectedReciterOption.reciterId,
					moshafId: selectedReciterOption.moshaf.id,
					surahId: reviewSurah
				};
			}

			content.addAsset(audioFilePath, undefined, sourceType, metadata);

			const normalizedPath = audioFilePath.replace(/\\/g, '/').replace(/\/+/g, '/');
			const addedAsset = content.assets.find(
				(asset) => asset.filePath === normalizedPath
			);

			if (addedAsset) {
				await addedAsset.addToTimeline(false, true);
			}

			await project.save();

			// ── 4. Run auto-segmentation (cloud) ──
			generationStatus = 'Generating subtitles with AI...';

			const segResult = await runAutoSegmentation({}, 'api');

			if (segResult && segResult.status === 'completed') {
				toast.success(
					`Project created with ${segResult.segmentsApplied} subtitle segments!`
				);
			} else if (segResult && segResult.status === 'failed') {
				toast.error(`Subtitles failed: ${segResult.message}. Project created without subtitles.`);
			} else {
				toast.success('Project created! Subtitles may need manual setup.');
			}

			await project.save();
			globalState.currentPage = 'home';
		} catch (error) {
			console.error('Project creation failed:', error);
			toast.error(`Failed to create project: ${error}`);
		} finally {
			isCreatingProject = false;
			generationStatus = '';
		}
	}

	// ── Build condensed reciter list for AI prompt ──
	function buildReciterListForAi(): string {
		// Deduplicate by reciterId — pick the first moshaf for each reciter
		const seen = new Set<number>();
		const lines: string[] = [];
		for (const opt of allReciterOptions) {
			if (seen.has(opt.reciterId)) continue;
			seen.add(opt.reciterId);
			lines.push(`{ "reciterId": ${opt.reciterId}, "name": "${opt.reciterName}", "moshafId": ${opt.moshaf.id} }`);
		}
		return lines.join('\n');
	}

	// ── Resolve AI-returned reciter/moshaf IDs to a ReciterOption ──
	function resolveReciterOption(reciterId: number, moshafId: number, surahId: number): ReciterOption | null {
		// Try exact match first
		let match = allReciterOptions.find(
			(o) => o.reciterId === reciterId && o.moshaf.id === moshafId && o.surahSet.has(surahId)
		);
		if (match) return match;

		// Fallback: same reciter, any moshaf that has the surah
		match = allReciterOptions.find(
			(o) => o.reciterId === reciterId && o.surahSet.has(surahId)
		);
		if (match) return match;

		// Fallback: same reciter, any moshaf
		match = allReciterOptions.find((o) => o.reciterId === reciterId);
		return match ?? null;
	}

	// ── AI plan generation ──
	async function generateAiPlan(): Promise<{
		videoPrompt: string;
		reciter: string;
		reciterId: number;
		moshafId: number;
		surah: number;
		ayahStart: number;
		ayahEnd: number;
	}> {
		if (!letAiChoose) {
			return {
				videoPrompt: prompt,
				reciter,
				reciterId: selectedReciterOption?.reciterId ?? 0,
				moshafId: selectedReciterOption?.moshaf.id ?? 0,
				surah,
				ayahStart,
				ayahEnd
			};
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

		const systemPrompt = `You are a Quran video planning assistant. Given a theme or topic, you must:
1. Select the most relevant Quran verses for this theme
2. Choose a reciter from the available list below
3. Write a detailed visual prompt that would be sent to an AI video generation model

AVAILABLE RECITERS (you MUST pick from this list using exact IDs):
${reciterList}

Respond ONLY with valid JSON in this exact format:
{
  "videoPrompt": "A cinematic, detailed visual description for AI video generation. Describe the mood, colors, camera movement, scenery. Be very descriptive and visual.",
  "reciterId": <reciter ID from the list above>,
  "moshafId": <moshaf ID from the list above>,
  "reciter": "Name of the selected reciter",
  "surah": <surah number 1-114>,
  "ayahStart": <starting verse number>,
  "ayahEnd": <ending verse number>
}

Rules:
- Choose verses that are MOST relevant to the given theme
- Keep the verse range reasonable (3-15 verses)
- The videoPrompt should describe a beautiful, contemplative visual scene matching the theme
- Pick a reciter whose style matches the mood (e.g. emotional themes → emotional reciter)
- You MUST use reciterId and moshafId from the available reciters list`;

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

		if (!text) {
			toast.error('AI returned an empty response.');
			throw new Error('No text response from AI');
		}

		// Parse JSON (handle markdown code blocks)
		const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
		const plan = JSON.parse(jsonMatch[1]!.trim());

		return {
			videoPrompt: plan.videoPrompt || prompt,
			reciter: plan.reciter || 'Unknown',
			reciterId: plan.reciterId || 0,
			moshafId: plan.moshafId || 0,
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
						class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold {currentStep === 'input'
							? 'bg-accent-primary text-black'
							: 'bg-accent-primary/20 text-accent-primary'}"
					>
						1
					</div>
					<span class="text-sm {currentStep === 'input' ? 'text-primary font-medium' : 'text-thirdly'}">
						Options
					</span>
				</div>
				<div class="flex-1 h-px bg-[var(--border-color)]"></div>
				<div class="flex items-center gap-2">
					<div
						class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold {currentStep === 'review'
							? 'bg-accent-primary text-black'
							: 'bg-[var(--bg-secondary)] text-thirdly border border-color'}"
					>
						2
					</div>
					<span class="text-sm {currentStep === 'review' ? 'text-primary font-medium' : 'text-thirdly'}">
						Review & Create
					</span>
				</div>
			</div>
		</div>

		<!-- ═══════════════════════ STEP 1: Input ═══════════════════════ -->
		{#if currentStep === 'input'}
			<div class="space-y-6">
				<AiVideoPromptField bind:value={prompt} />

				<AiVideoGenerationOptions
					bind:selectedModel
					bind:resolution
					bind:letAiChoose
					bind:selectedTranslation
				/>

				{#if !letAiChoose}
					<AiVideoQuranSourceSettings
						bind:reciter
						bind:selectedReciterOption
						bind:surah
						bind:ayahStart
						bind:ayahEnd
						bind:useLocalAudio
						bind:localAudioPath
					/>

					<AiVideoVerseRangePreview
						{surah}
						{ayahStart}
						{ayahEnd}
						{selectedTranslation}
					/>
				{/if}

				<!-- Next / Generate Plan button -->
				<button
					type="button"
					class="w-full rounded-xl bg-accent-primary px-6 py-4 text-base font-semibold text-black shadow-lg hover:bg-blue-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2"
					disabled={isGeneratingPlan || prompt.trim() === ''}
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
						AI will use your configured API to select verses, reciter, and generate a video prompt.
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
						Video Generation Prompt
					</span>
					<textarea
						bind:value={reviewVideoPrompt}
						rows={4}
						class="w-full rounded-xl border border-color bg-bg-secondary px-4 py-3 text-primary placeholder:text-thirdly resize-none focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary transition-all text-sm leading-relaxed"
						placeholder="Visual description for the AI video generator..."
					></textarea>
					<p class="text-xs text-thirdly">
						This prompt will be sent to the video generation API. Edit it to adjust the visual style.
					</p>
				</div>

				<!-- Reciter -->
				<div class="space-y-2">
					<span class="flex items-center gap-2 text-sm font-semibold text-primary">
						<span class="material-icons text-accent-primary text-base">record_voice_over</span>
						Reciter
					</span>
					<input
						type="text"
						bind:value={reviewReciter}
						class="w-full rounded-xl border border-color bg-bg-secondary px-4 py-3 text-primary text-sm"
						placeholder="Reciter name"
					/>
				</div>

				<!-- Verse Range -->
				<div class="space-y-3">
					<span class="flex items-center gap-2 text-sm font-semibold text-primary">
						<span class="material-icons text-accent-primary text-base">menu_book</span>
						Verse Range
					</span>

					<div style="position: relative; z-index: 90;">
						<AutocompleteInput
							bind:value={reviewSurahSearchValue}
							suggestions={surahSuggestions}
							placeholder="Search surah..."
							icon="search"
							label=""
							onSelect={handleReviewSurahSelection}
						/>
					</div>

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

				<!-- Summary card -->
				<div class="rounded-xl border border-color bg-bg-secondary/50 p-5 space-y-3">
					<h4 class="flex items-center gap-2 text-xs font-semibold text-thirdly uppercase tracking-wide">
						<span class="material-icons text-accent-primary text-sm">summarize</span>
						Summary
					</h4>
					<div class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
						<div>
							<span class="text-thirdly text-xs">Theme</span>
							<p class="text-primary font-medium truncate">{prompt}</p>
						</div>
						<div>
							<span class="text-thirdly text-xs">Model</span>
							<p class="text-primary font-medium">{selectedModel}</p>
						</div>
						<div>
							<span class="text-thirdly text-xs">Surah</span>
							<p class="text-primary font-medium">{reviewSurahName()}</p>
						</div>
						<div>
							<span class="text-thirdly text-xs">Verses</span>
							<p class="text-primary font-medium">{reviewAyahStart} – {reviewAyahEnd}</p>
						</div>
						<div>
							<span class="text-thirdly text-xs">Reciter</span>
							<p class="text-primary font-medium truncate">{reviewReciter}</p>
						</div>
						<div>
							<span class="text-thirdly text-xs">Resolution</span>
							<p class="text-primary font-medium">{resolution === 'portrait' ? 'Portrait (9:16)' : 'Landscape (16:9)'}</p>
						</div>
						{#if selectedTranslation}
							<div class="col-span-2">
								<span class="text-thirdly text-xs">Translation</span>
								<p class="text-primary font-medium">{selectedTranslation.author} ({selectedTranslation.language})</p>
							</div>
						{/if}
					</div>
				</div>

				<!-- Action buttons -->
				<div class="flex gap-3">
					<button
						type="button"
						class="flex-1 rounded-xl border border-color bg-bg-secondary px-6 py-4 text-sm font-medium text-primary hover:border-accent-primary/50 transition-all cursor-pointer flex items-center justify-center gap-2"
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
					Video generation is currently mocked. A real AI-generated background will be added later.
				</p>
			</div>
		{/if}
	</div>
</div>
