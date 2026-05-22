<script lang="ts">
	import { Project, ProjectContent, ProjectDetail, Edition, Utilities } from '$lib/classes';
	import { Quran } from '$lib/classes/Quran';
	import { globalState } from '$lib/runes/main.svelte';
	import { discordService } from '$lib/services/DiscordService';
	import type { Mp3QuranMoshaf } from '$lib/services/Mp3QuranService';
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

	// ── Step 2: Review/recap state (editable) ──
	let reviewVideoPrompt = $state('');
	let reviewReciter = $state('');
	let reviewSurah = $state(1);
	let reviewAyahStart = $state(1);
	let reviewAyahEnd = $state(7);

	let isCreatingProject = $state(false);

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

		try {
			// TODO: Replace with real prompt-to-video API call when integrating Luma/Runway/Veo/Replicate
			// For now the video generation is mocked

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

			// TODO: Set project resolution based on portrait/landscape choice
			// TODO: Attach generated background video to the project video track
			// TODO: Attach Quran audio to the project audio track
			// TODO: Run subtitle segmentation pipeline (Hetchy's Universal Quran Aligner) if available
			// TODO: Connect style presets system here once implemented

			const project = new Project(projectDetail, content);
			await project.save();

			globalState.currentProject = project;
			globalState.currentPage = 'home';
			discordService.setEditingState();

			toast.success('AI video project created!');
		} catch (error) {
			console.error('Project creation failed:', error);
			toast.error('Failed to create project.');
		} finally {
			isCreatingProject = false;
		}
	}

	// ── AI plan generation ──
	async function generateAiPlan(): Promise<{
		videoPrompt: string;
		reciter: string;
		surah: number;
		ayahStart: number;
		ayahEnd: number;
	}> {
		if (!letAiChoose) {
			return {
				videoPrompt: prompt,
				reciter,
				surah,
				ayahStart,
				ayahEnd
			};
		}

		const aiSettings = globalState.settings?.aiTranslationSettings;
		if (!aiSettings?.openAiApiKey || !aiSettings?.textAiApiEndpoint) {
			toast.error('Please configure your AI API key and endpoint in Settings > AI Key first.');
			throw new Error('AI settings not configured');
		}

		const systemPrompt = `You are a Quran video planning assistant. Given a theme or topic, you must:
1. Select the most relevant Quran verses for this theme
2. Suggest a well-known Quran reciter
3. Write a detailed visual prompt that would be sent to an AI video generation model

Respond ONLY with valid JSON in this exact format:
{
  "videoPrompt": "A cinematic, detailed visual description for AI video generation. Describe the mood, colors, camera movement, scenery. Be very descriptive and visual.",
  "reciter": "Name of a well-known Quran reciter (in Latin/English script)",
  "surah": <surah number 1-114>,
  "ayahStart": <starting verse number>,
  "ayahEnd": <ending verse number>
}

Rules:
- Choose verses that are MOST relevant to the given theme
- Keep the verse range reasonable (3-15 verses)
- The videoPrompt should describe a beautiful, contemplative visual scene matching the theme
- Pick a reciter whose style matches the mood (e.g. emotional themes → emotional reciter)`;

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
			reciter: plan.reciter || 'Mishary Rashid Alafasy',
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
							Creating project...
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
