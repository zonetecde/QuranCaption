<script lang="ts">
	import { Project, ProjectContent, ProjectDetail, Edition, Utilities } from '$lib/classes';
	import { globalState } from '$lib/runes/main.svelte';
	import { discordService } from '$lib/services/DiscordService';
	import toast from 'svelte-5-french-toast';
	import AiVideoPromptField from './AiVideoPromptField.svelte';
	import AiVideoGenerationOptions from './AiVideoGenerationOptions.svelte';
	import AiVideoQuranSourceSettings from './AiVideoQuranSourceSettings.svelte';
	import AiVideoVerseRangePreview from './AiVideoVerseRangePreview.svelte';

	// Form state
	let prompt = $state('');
	let selectedModel = $state('Mock Provider / Cinematic Nature');
	let resolution = $state<'portrait' | 'landscape'>('portrait');
	let letAiChoose = $state(true);
	let selectedTranslation = $state<Edition | null>(null);

	// Manual Quran source state (when AI choice is disabled)
	let reciter = $state('');
	let selectedReciterOption = $state<{
		label: string;
		reciterName: string;
		moshaf: { id: number; name: string; server: string; surah_total: number; moshaf_type: number; surah_list: string };
		reciterId: number;
		surahSet: Set<number>;
	} | null>(null);
	let surah = $state(1);
	let ayahStart = $state(1);
	let ayahEnd = $state(7);
	let useLocalAudio = $state(false);
	let localAudioPath = $state('');

	let isGenerating = $state(false);

	function goBack() {
		globalState.currentPage = 'home';
	}

	async function handleGenerate() {
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

		isGenerating = true;

		try {
			// Step 1: Generate the AI plan using existing AI settings
			const plan = await generateAiPlan();

			// Step 2: Create mock background video
			// TODO: Replace with real prompt-to-video API call when integrating Luma/Runway/Veo/Replicate
			const mockVideoPath = ''; // Empty path = no video yet (mocked)

			// Step 3: Create the Quran Caption project
			const projectName = `AI: ${prompt.trim().slice(0, 40)}`;

			if (Utilities.isPathNotSafe(projectName)) {
				toast.error('Generated project name contains invalid characters.');
				isGenerating = false;
				return;
			}

			const projectDetail = new ProjectDetail(
				projectName,
				plan.reciter,
				undefined,
				undefined,
				'Others'
			);
			const content = await ProjectContent.getDefaultProjectContent();

			// TODO: Set project resolution based on portrait/landscape choice
			// This will be integrated when video dimensions are configurable on project creation

			const project = new Project(projectDetail, content);

			// TODO: Attach generated background video to the project video track
			// TODO: Attach Quran audio to the project audio track
			// TODO: Run subtitle segmentation pipeline (Hetchy's Universal Quran Aligner) if available
			// TODO: Connect style presets system here once implemented

			await project.save();

			// Open the project in the editor
			globalState.currentProject = project;
			globalState.currentPage = 'home';
			discordService.setEditingState();

			toast.success('AI video project created! You can now edit it in the project editor.');
		} catch (error) {
			console.error('AI video generation failed:', error);
			toast.error('Failed to generate AI video. Please check your AI settings and try again.');
		} finally {
			isGenerating = false;
		}
	}

	/**
	 * Uses the existing AI configuration to generate a structured generation plan.
	 * Returns the reciter, surah/ayah range, and video prompt.
	 */
	async function generateAiPlan(): Promise<{
		videoPrompt: string;
		reciter: string;
		surah: number;
		ayahStart: number;
		ayahEnd: number;
	}> {
		if (!letAiChoose) {
			// User manually selected everything
			return {
				videoPrompt: prompt,
				reciter: reciter,
				surah,
				ayahStart,
				ayahEnd
			};
		}

		// Use AI to generate the plan
		const aiSettings = globalState.settings?.aiTranslationSettings;
		if (!aiSettings?.openAiApiKey || !aiSettings?.textAiApiEndpoint) {
			toast.error('Please configure your AI API key and endpoint in Settings > AI Key first.');
			throw new Error('AI settings not configured');
		}

		const systemPrompt = `You are a Quran video planning assistant. Given a theme or topic, you must select the most relevant Quran verses and suggest a reciter.

Respond ONLY with valid JSON in this exact format:
{
  "videoPrompt": "A detailed visual description for AI video generation based on the theme",
  "reciter": "Name of a well-known Quran reciter (in Latin script)",
  "surah": <surah number 1-114>,
  "ayahStart": <starting verse number>,
  "ayahEnd": <ending verse number>
}

Choose verses that are most relevant to the given theme. Keep the verse range reasonable (2-15 verses).`;

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
					{ role: 'user', content: `Theme: ${prompt}` }
				]
			})
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`AI API returned ${response.status}: ${errorText}`);
		}

		const data = await response.json();

		// Extract text from OpenAI responses API format
		let text = '';
		if (data.output) {
			for (const item of data.output) {
				if (item.type === 'message' && item.content) {
					for (const content of item.content) {
						if (content.type === 'output_text') {
							text = content.text;
						}
					}
				}
			}
		}

		if (!text) {
			throw new Error('No text response from AI');
		}

		// Parse the JSON from the AI response (handle markdown code blocks)
		const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
		const plan = JSON.parse(jsonMatch[1]!.trim());

		return {
			videoPrompt: plan.videoPrompt || prompt,
			reciter: plan.reciter || 'Mishary Rashid Alafasy',
			surah: plan.surah || 1,
			ayahStart: plan.ayahStart || 1,
			ayahEnd: plan.ayahEnd || 7
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
				Back to Home
			</button>

			<div class="flex items-center gap-4">
				<div
					class="w-12 h-12 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center shadow-lg"
				>
					<span class="material-icons text-white text-xl">auto_awesome</span>
				</div>
				<div>
					<h1 class="text-3xl font-bold text-primary">AI Video</h1>
					<p class="text-sm text-secondary">Generate a Quran video with AI assistance</p>
				</div>
			</div>
		</div>

		<!-- Main form -->
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
					{reciter}
					{useLocalAudio}
					{localAudioPath}
					{selectedTranslation}
				/>
			{/if}

			<!-- Generate button -->
			<button
				type="button"
				class="w-full rounded-xl bg-accent-primary px-6 py-4 text-base font-semibold text-black shadow-lg hover:bg-blue-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2"
				disabled={isGenerating || prompt.trim() === ''}
				onclick={handleGenerate}
			>
				{#if isGenerating}
					<span class="material-icons animate-spin text-lg">autorenew</span>
					Generating...
				{:else}
					<span class="material-icons text-lg">movie_creation</span>
					Generate AI Video
				{/if}
			</button>

			<!-- Info note -->
			<p class="text-center text-xs text-thirdly">
				The video generation is currently mocked. A real AI-generated background will be added in a future update.
			</p>
		</div>
	</div>
</div>
