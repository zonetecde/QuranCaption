<script lang="ts">
	import { onMount } from 'svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { loadHafsReciters, buildReciterListForAi, resolveAiReciterOption, getReciterOptionKey } from './reciterLoader';
	import { generateAiPlan } from './aiPlanGenerator';
	import { Quran } from '$lib/classes/Quran';
	import toast from 'svelte-5-french-toast';
	import AiVideoPromptField from './components/AiVideoPromptField.svelte';
	import AiVideoGenerationOptions from './components/AiVideoGenerationOptions.svelte';
	import AiVideoQuranSourceSettings from './components/AiVideoQuranSourceSettings.svelte';
	import AiVideoVerseRangePreview from './components/AiVideoVerseRangePreview.svelte';
	import AiVideoReviewStep from './components/AiVideoReviewStep.svelte';
	import AiVideoStepIndicator from './components/AiVideoStepIndicator.svelte';

	const aiv = globalState.aiVideo;

	// ── Chargement unique des recitateurs au mount ──
	onMount(() => {
		loadHafsReciters();
	});

	/**
	 * Retour au Home ou a l'etape precedente.
	 * @returns {void}
	 */
	function goBack() {
		if (aiv.step === 'review') {
			aiv.step = 'input';
		} else {
			globalState.currentPage = 'home';
		}
	}

	// ── Step 1 → Step 2: validation + generation du plan ──
	async function handleGeneratePlan() {
		const requiresThemePrompt = aiv.video.sourceMode === 'ai' || aiv.ai.letAiChoose;

		if (requiresThemePrompt && aiv.video.prompt.trim() === '') {
			toast.error('Please enter a video theme or topic.');
			return;
		}

		if (aiv.video.sourceMode === 'youtube' && aiv.video.youtubeUrl.trim() === '') {
			toast.error('Please enter a YouTube video URL.');
			return;
		}

		if (!aiv.ai.letAiChoose && !aiv.audio.useLocal && aiv.audio.reciterName.trim() === '') {
			toast.error('Please select a reciter or choose a local audio file.');
			return;
		}

		if (!aiv.ai.letAiChoose && aiv.audio.useLocal && !aiv.audio.localPath) {
			toast.error('Please select a local audio file.');
			return;
		}

		aiv.ai.isGeneratingPlan = true;

		try {
			const reciterList = buildReciterListForAi();
			const plan = await generateAiPlan(reciterList);

			// Remplit l'etat de review avec le plan genere
			aiv.review.title = plan.title;
			aiv.review.videoPrompt =
				aiv.video.sourceMode === 'youtube' ? aiv.video.youtubeUrl : plan.videoPrompt;
			aiv.review.reciterName = plan.reciter;
			aiv.review.verseRange.surah = plan.surah;
			aiv.review.verseRange.startVerse = plan.ayahStart;
			aiv.review.verseRange.endVerse = plan.ayahEnd;

			// Resout le recitateur choisi par l'IA vers une ReciterOption reelle
			if (aiv.ai.letAiChoose && plan.reciterId) {
				const resolved = resolveAiReciterOption(plan.reciterId);
				if (resolved) {
					aiv.audio.reciter = resolved;
					aiv.audio.reciterName = resolved.reciterName;
					aiv.review.reciterName = resolved.reciterName;
				} else {
					toast.error(
						'AI selected a reciter that could not be resolved. Please pick one manually in the review.'
					);
				}
			}

			aiv.step = 'review';
		} catch (error) {
			console.error('AI plan generation failed:', error);
		} finally {
			aiv.ai.isGeneratingPlan = false;
		}
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
				{aiv.step === 'review' ? 'Back to options' : 'Back to Home'}
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
						{aiv.step === 'input'
							? 'Describe your video theme and choose your options'
							: 'Review and adjust before creating the project'}
					</p>
				</div>
			</div>

			<AiVideoStepIndicator />
		</div>

		<!-- ═══════════════════════ STEP 1: Input ═══════════════════════ -->
		{#if aiv.step === 'input'}
			<div class="space-y-6">
				<AiVideoPromptField />
				<AiVideoGenerationOptions />
				<AiVideoQuranSourceSettings />

				{#if !aiv.ai.letAiChoose && !aiv.audio.useLocal}
					<AiVideoVerseRangePreview
						surah={aiv.selectedVerseRange.surah}
						ayahStart={aiv.selectedVerseRange.startVerse}
						ayahEnd={aiv.selectedVerseRange.endVerse}
						selectedTranslation={aiv.selectedTranslation}
					/>
				{/if}

				<button
					type="button"
					class="w-full rounded-xl bg-accent-primary px-6 py-4 text-base font-semibold text-black shadow-lg hover:bg-blue-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2"
					disabled={aiv.ai.isGeneratingPlan ||
						((aiv.video.sourceMode === 'ai' || aiv.ai.letAiChoose) && aiv.video.prompt.trim() === '') ||
						(aiv.video.sourceMode === 'youtube' && aiv.video.youtubeUrl.trim() === '')}
					onclick={handleGeneratePlan}
				>
					{#if aiv.ai.isGeneratingPlan}
						<span class="material-icons animate-spin text-lg">autorenew</span>
						{aiv.ai.letAiChoose ? 'AI is planning your video...' : 'Preparing review...'}
					{:else}
						<span class="material-icons text-lg">arrow_forward</span>
						{aiv.ai.letAiChoose ? 'Generate AI Plan' : 'Review & Continue'}
					{/if}
				</button>

				{#if aiv.ai.letAiChoose}
					<p class="text-center text-xs text-thirdly">
						AI will use your configured API to select a verse range and, if needed, a reciter.
					</p>
				{/if}
			</div>

			<!-- ═══════════════════════ STEP 2: Review ═══════════════════════ -->
		{:else}
			<AiVideoReviewStep />
		{/if}
	</div>
</div>
