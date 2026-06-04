<script lang="ts">
	import { onMount } from 'svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import {
		loadHafsReciters,
		buildReciterListForAi,
		resolveAiReciterOption,
		getReciterOptionKey
	} from './reciterLoader';
	import { generateAiPlan } from './aiPlanGenerator';
	import { Quran } from '$lib/classes/Quran';
	import toast from 'svelte-5-french-toast';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
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
			toast.error(get(LL).aiVideo.pleaseEnterTheme());
			return;
		}

		if (aiv.video.sourceMode === 'youtube' && aiv.video.youtubeUrl.trim() === '') {
			toast.error(get(LL).aiVideo.pleaseEnterYoutubeUrl());
			return;
		}

		if (!aiv.ai.letAiChoose && !aiv.audio.useLocal && aiv.audio.reciterName.trim() === '') {
			toast.error(get(LL).aiVideo.pleaseSelectReciter());
			return;
		}

		if (!aiv.ai.letAiChoose && aiv.audio.useLocal && !aiv.audio.localPath) {
			toast.error(get(LL).aiVideo.pleaseSelectLocalAudio());
			return;
		}

		aiv.ai.isGeneratingPlan = true;

		try {
			const reciterList = buildReciterListForAi();
			const plan = await generateAiPlan(reciterList);

			// Remplit l'etat de review avec le plan genere
			aiv.review.title = plan.title;
			aiv.review.videoPrompt =
				aiv.video.sourceMode === 'youtube'
					? aiv.video.youtubeUrl
					: aiv.video.sourceMode === 'none'
						? ''
						: plan.videoPrompt;
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
					toast.error(get(LL).aiVideo.aiSelectedReciterError());
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
				{aiv.step === 'review' ? $LL.aiVideo.backToOptions() : $LL.aiVideo.backToHome()}
			</button>

			<div class="flex items-center gap-4">
				<div
					class="w-12 h-12 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center shadow-lg"
				>
					<span class="material-icons text-white text-xl">auto_awesome</span>
				</div>
				<div>
					<h1 class="text-3xl font-bold text-primary">{$LL.aiVideo.aiVideo()}</h1>
					<p class="text-sm text-secondary">
						{aiv.step === 'input'
							? $LL.aiVideo.inputStepDescription()
							: $LL.aiVideo.reviewStepDescription()}
					</p>
				</div>
			</div>

			<AiVideoStepIndicator />
		</div>

		<!-- ═══════════════════════ STEP 1: Input ═══════════════════════ -->
		<div class="bg-[var(--bg-secondary)] rounded-2xl border border-color p-6 shadow-lg space-y-6">
			{#if aiv.step === 'input'}
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
						((aiv.video.sourceMode === 'ai' || aiv.ai.letAiChoose) &&
							aiv.video.prompt.trim() === '') ||
						(aiv.video.sourceMode === 'youtube' && aiv.video.youtubeUrl.trim() === '')}
					onclick={handleGeneratePlan}
				>
					{#if aiv.ai.isGeneratingPlan}
						<span class="material-icons animate-spin text-lg">autorenew</span>
						{aiv.ai.letAiChoose ? $LL.aiVideo.aiIsPlanning() : $LL.aiVideo.preparingReview()}
					{:else}
						<span class="material-icons text-lg">arrow_forward</span>
						{aiv.ai.letAiChoose ? $LL.aiVideo.generateAiPlan() : $LL.aiVideo.reviewContinue()}
					{/if}
				</button>

				{#if aiv.ai.letAiChoose}
					<p class="text-center text-xs text-thirdly">
						{$LL.aiVideo.aiWillChoose()}
					</p>
				{/if}

				<!-- ═══════════════════════ STEP 2: Review ═══════════════════════ -->
			{:else}
				<AiVideoReviewStep />
			{/if}
		</div>
	</div>
</div>
