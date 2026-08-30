<script lang="ts">
	import { ProjectEditorTabs } from '$lib/classes';
	import Settings from '$lib/classes/Settings.svelte';
	import ModalManager from '$lib/components/modals/ModalManager';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';

	type GuideCopy = {
		firstVideoGuide: () => string;
		guideStep: (args: { current: number; total: number }) => string;
		guideMedia: () => string;
		guideSubtitles: () => string;
		guideTranslations: () => string;
		guideStyle: () => string;
		guideExport: () => string;
		hideGuide: () => string;
		showGuideAgainQuestion: () => string;
		nextStep: (args: { step: string }) => string;
	};

	const copy = $derived($LL.editor as unknown as GuideCopy);
	const steps = $derived([
		{
			tab: ProjectEditorTabs.VideoEditor,
			label: $LL.status.videoEditor(),
			description: copy.guideMedia()
		},
		{
			tab: ProjectEditorTabs.SubtitlesEditor,
			label: $LL.status.subtitlesEditor(),
			description: copy.guideSubtitles()
		},
		{
			tab: ProjectEditorTabs.Translations,
			label: $LL.status.translations(),
			description: copy.guideTranslations()
		},
		{
			tab: ProjectEditorTabs.Style,
			label: $LL.status.style(),
			description: copy.guideStyle()
		},
		{
			tab: ProjectEditorTabs.Export,
			label: $LL.status.export(),
			description: copy.guideExport()
		}
	]);
	const currentStepIndex = $derived(
		Math.max(
			0,
			steps.findIndex(
				(step) => step.tab === globalState.currentProject!.projectEditorState.currentTab
			)
		)
	);
	const currentStep = $derived(steps[currentStepIndex]);
	const nextStep = $derived(steps[currentStepIndex + 1]);
	const hasMedia = $derived(
		globalState.getAudioTrack.clips.length > 0 || globalState.getVideoTrack.clips.length > 0
	);
	const captionProgress = $derived(globalState.currentProject!.detail.percentageCaptioned);
	const canContinue = $derived(
		(currentStepIndex === 0 && hasMedia) ||
			(currentStepIndex === 1 && captionProgress >= 100) ||
			currentStepIndex === 2 ||
			currentStepIndex === 3
	);

	/**
	 * Ferme le guide actuel et mémorise le choix pour les prochains projets.
	 *
	 * @returns {Promise<void>} Résolution après l'enregistrement éventuel du choix.
	 */
	async function dismissGuide(): Promise<void> {
		globalState.currentProject!.projectEditorState.onboardingGuideDismissed = true;
		const showAgain = await ModalManager.confirmModal(copy.showGuideAgainQuestion(), true);

		if (!showAgain && globalState.settings) {
			globalState.settings.persistentUiState.showFirstVideoGuide = false;
			await Settings.save();
		}
	}
</script>

<aside class="journey-guide" data-tour-id="editor-journey-guide">
	<div class="journey-heading">
		<div class="min-w-0 flex-1">
			<p class="journey-title">{copy.firstVideoGuide()}</p>
			<p class="journey-step">
				{copy.guideStep({ current: currentStepIndex + 1, total: steps.length })} · {currentStep.label}
			</p>
		</div>
		<button
			type="button"
			class="journey-close"
			aria-label={copy.hideGuide()}
			title={copy.hideGuide()}
			onclick={dismissGuide}
		>
			<span class="material-icons">close</span>
		</button>
	</div>

	<div class="journey-description-row">
		<p class="journey-description">{currentStep.description}</p>
		{#if nextStep && canContinue}
			<button
				type="button"
				class="journey-next"
				onclick={() => (globalState.currentProject!.projectEditorState.currentTab = nextStep.tab)}
			>
				{copy.nextStep({ step: nextStep.label })}
				<span class="material-icons">arrow_forward</span>
			</button>
		{/if}
	</div>
</aside>

<style>
	.journey-guide {
		position: relative;
		z-index: 50;
		display: flex;
		flex-shrink: 0;
		flex-direction: column;
		gap: 0.2rem;
		border-bottom: 1px solid var(--border-color);
		padding: 0.35rem 0.65rem 0.3rem;
		background: color-mix(in srgb, var(--accent-primary) 8%, var(--bg-secondary));
		color: var(--text-primary);
	}

	.journey-heading {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.journey-title {
		font-size: 0.75rem;
		font-weight: 700;
		line-height: 1.1;
	}

	.journey-step,
	.journey-description {
		color: var(--text-secondary);
		font-size: 0.65rem;
		line-height: 1.25;
	}

	.journey-description-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.journey-description {
		min-width: 0;
		flex: 1;
	}

	.journey-next {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		gap: 0.15rem;
		color: var(--accent-primary);
		font-size: 0.62rem;
		font-weight: 700;
	}

	.journey-next .material-icons {
		font-size: 0.8rem;
	}

	.journey-close {
		display: flex;
		height: 1.75rem;
		width: 1.75rem;
		align-items: center;
		justify-content: center;
		border-radius: 9999px;
		color: var(--text-secondary);
	}

	.journey-close .material-icons {
		font-size: 1rem;
	}
</style>
