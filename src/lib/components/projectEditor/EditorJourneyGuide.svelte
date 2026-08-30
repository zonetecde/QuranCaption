<script lang="ts">
	import { ProjectEditorTabs } from '$lib/classes';
	import Settings from '$lib/classes/Settings.svelte';
	import ModalManager from '$lib/components/modals/ModalManager';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';

	type GuideCopy = {
		firstVideoGuide: () => string;
		guideStep: (args: { current: number; total: number }) => string;
		guideMedia: () => string;
		guideSubtitles: () => string;
		guideTranslations: () => string;
		guideStyle: () => string;
		guideExport: () => string;
		optional: () => string;
		hideGuide: () => string;
		showGuideAgainQuestion: () => string;
		nextStep: (args: { step: string }) => string;
	};

	const copy = $derived($LL.editor as unknown as GuideCopy);
	const steps = $derived([
		{
			tab: ProjectEditorTabs.VideoEditor,
			icon: 'perm_media',
			label: $LL.status.videoEditor(),
			description: copy.guideMedia()
		},
		{
			tab: ProjectEditorTabs.SubtitlesEditor,
			icon: 'subtitles',
			label: $LL.status.subtitlesEditor(),
			description: copy.guideSubtitles()
		},
		{
			tab: ProjectEditorTabs.Translations,
			icon: 'translate',
			label: $LL.status.translations(),
			description: copy.guideTranslations(),
			optional: true
		},
		{
			tab: ProjectEditorTabs.Style,
			icon: 'auto_fix_high',
			label: $LL.status.style(),
			description: copy.guideStyle()
		},
		{
			tab: ProjectEditorTabs.Export,
			icon: 'upload_file',
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
	const canContinue = $derived(
		(currentStepIndex === 0 && hasMedia) ||
			(currentStepIndex === 1 && globalState.getSubtitleClips.length > 0) ||
			currentStepIndex === 2 ||
			currentStepIndex === 3
	);

	/**
	 * Ouvre une étape du parcours depuis le guide desktop.
	 * @param {ProjectEditorTabs} tab Onglet correspondant à l'étape.
	 * @returns {void}
	 */
	function openStep(tab: ProjectEditorTabs): void {
		globalState.currentProject!.projectEditorState.currentTab = tab;
	}

	/**
	 * Ferme le guide actuel et mémorise le choix pour les prochains projets.
	 * @returns {Promise<void>} Résolution après l'enregistrement éventuel du choix.
	 */
	async function dismissGuide(): Promise<void> {
		ProjectHistoryManager.track('dismiss first video guide', () => {
			globalState.currentProject!.projectEditorState.onboardingGuideDismissed = true;
		});
		const showAgain = await ModalManager.confirmModal(copy.showGuideAgainQuestion(), true);
		if (!showAgain && globalState.settings) {
			globalState.settings.persistentUiState.showFirstVideoGuide = false;
			await Settings.save();
		}
	}
</script>

<aside class="journey-guide" data-tour-id="editor-journey-guide">
	<div class="journey-intro">
		<div class="journey-icon" aria-hidden="true">
			<span class="material-icons-outlined">route</span>
		</div>
		<div class="min-w-0">
			<p class="journey-title">{copy.firstVideoGuide()}</p>
			<p class="journey-count">
				{copy.guideStep({ current: currentStepIndex + 1, total: steps.length })}
			</p>
		</div>
	</div>

	<nav class="journey-steps" aria-label={copy.firstVideoGuide()}>
		{#each steps as step, index (step.tab)}
			<button
				type="button"
				class:active={index === currentStepIndex}
				class:completed={index < currentStepIndex}
				onclick={() => openStep(step.tab)}
				aria-current={index === currentStepIndex ? 'step' : undefined}
			>
				<span class="step-marker"
					><span class="material-icons-outlined"
						>{index < currentStepIndex ? 'check' : step.icon}</span
					></span
				>
				<span class="step-label">{step.label}</span>
				{#if step.optional}<span class="step-optional">{copy.optional()}</span>{/if}
			</button>
		{/each}
	</nav>

	<div class="journey-current">
		<div class="min-w-0 flex-1">
			<p class="current-label">{currentStep.label}</p>
			<p class="current-description">{currentStep.description}</p>
		</div>
		{#if nextStep && canContinue}
			<button type="button" class="journey-next" onclick={() => openStep(nextStep.tab)}>
				{copy.nextStep({ step: nextStep.label })}<span class="material-icons">arrow_forward</span>
			</button>
		{/if}
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
</aside>

<style>
	.journey-guide {
		position: relative;
		z-index: 40;
		display: grid;
		grid-template-columns: minmax(10rem, 0.75fr) minmax(28rem, 1.7fr) minmax(16rem, 1fr);
		flex-shrink: 0;
		align-items: center;
		gap: 1rem;
		border-block: 1px solid color-mix(in srgb, var(--accent-primary) 25%, var(--border-color));
		padding: 0.65rem 3rem 0.65rem 1rem;
		background:
			linear-gradient(
				90deg,
				color-mix(in srgb, var(--accent-primary) 12%, transparent),
				transparent 36%
			),
			var(--bg-secondary);
		box-shadow: 0 8px 24px rgb(0 0 0 / 12%);
	}
	.journey-intro,
	.journey-current {
		display: flex;
		align-items: center;
		gap: 0.7rem;
	}
	.journey-icon {
		display: flex;
		height: 2.5rem;
		width: 2.5rem;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		border: 1px solid color-mix(in srgb, var(--accent-primary) 40%, transparent);
		border-radius: 0.75rem;
		background: color-mix(in srgb, var(--accent-primary) 15%, transparent);
		color: var(--accent-primary);
	}
	.journey-title,
	.current-label {
		color: var(--text-primary);
		font-size: 0.78rem;
		font-weight: 700;
	}
	.journey-count,
	.current-description {
		margin-top: 0.12rem;
		color: var(--text-secondary);
		font-size: 0.68rem;
		line-height: 1.35;
	}
	.journey-steps {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		align-items: start;
	}
	.journey-steps button {
		position: relative;
		display: flex;
		min-width: 0;
		flex-direction: column;
		align-items: center;
		gap: 0.22rem;
		color: var(--text-thirdly);
		font-size: 0.62rem;
	}
	.journey-steps button:not(:last-child)::after {
		content: '';
		position: absolute;
		top: 0.85rem;
		left: calc(50% + 1rem);
		width: calc(100% - 2rem);
		height: 1px;
		background: var(--border-color);
	}
	.journey-steps button.completed:not(:last-child)::after {
		background: color-mix(in srgb, var(--accent-primary) 55%, var(--border-color));
	}
	.step-marker {
		display: flex;
		height: 1.7rem;
		width: 1.7rem;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--border-color);
		border-radius: 9999px;
		background: var(--bg-primary);
	}
	.step-marker .material-icons-outlined {
		font-size: 0.9rem;
	}
	.journey-steps button:hover,
	.journey-steps button.active,
	.journey-steps button.completed {
		color: var(--accent-primary);
	}
	.journey-steps button.active .step-marker {
		border-color: var(--accent-primary);
		background: var(--accent-primary);
		color: var(--text-on-accent);
		box-shadow: 0 0 0 0.2rem color-mix(in srgb, var(--accent-primary) 20%, transparent);
	}
	.step-label {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 650;
	}
	.step-optional {
		position: absolute;
		top: -0.18rem;
		left: calc(50% + 0.7rem);
		border-radius: 9999px;
		padding: 0.08rem 0.3rem;
		background: var(--bg-accent);
		font-size: 0.48rem;
	}
	.journey-next {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		gap: 0.25rem;
		border-radius: 0.5rem;
		padding: 0.42rem 0.65rem;
		background: color-mix(in srgb, var(--accent-primary) 15%, transparent);
		color: var(--accent-primary);
		font-size: 0.65rem;
		font-weight: 700;
	}
	.journey-next:hover {
		background: color-mix(in srgb, var(--accent-primary) 24%, transparent);
	}
	.journey-next .material-icons {
		font-size: 0.85rem;
	}
	.journey-close {
		position: absolute;
		top: 0.45rem;
		right: 0.6rem;
		display: flex;
		height: 1.8rem;
		width: 1.8rem;
		align-items: center;
		justify-content: center;
		border-radius: 9999px;
		color: var(--text-secondary);
	}
	.journey-close:hover {
		background: var(--bg-accent);
		color: var(--text-primary);
	}
	.journey-close .material-icons {
		font-size: 1rem;
	}
	@media (max-width: 1100px) {
		.journey-guide {
			grid-template-columns: minmax(9rem, 0.7fr) minmax(24rem, 1.6fr);
		}
		.journey-current {
			display: none;
		}
	}
</style>
