<script lang="ts">
	import { fade } from 'svelte/transition';
	import MobileSideDrawers from '$lib/components/misc/MobileSideDrawers.svelte';
	import AddTranslationModal from './modal/AddTranslationModal.svelte';
	import TranslationInlineStylePanel from './TranslationInlineStylePanel.svelte';
	import TranslationsEditorSettings from './leftPanel/TranslationsEditorSettings.svelte';
	import Workspace from './workspace/Workspace.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import VideoPreview from '../../videoPreview/VideoPreview.svelte';

	let addTranslationModalVisibility = $state(false);
	let leftDrawerOpen = $state(false);
	let rightDrawerOpen = $state(false);
	let textSizeLevel = $state(-1);
	let panelScale = $derived(
		1 + (globalState.settings?.persistentUiState.editorPanelScalePercent ?? -15) / 100
	);
	let visibleEditions = $derived(
		globalState.currentProject!.content.projectTranslation.addedTranslationEditions.filter(
			(edition) => edition.showInTranslationsEditor
		)
	);
	let progressEdition = $derived(visibleEditions.length === 1 ? visibleEditions[0] : null);
	let reviewPercentage = $derived(
		progressEdition
			? Math.min(
					100,
					Math.max(0, globalState.currentProject!.detail.translations[progressEdition.author] ?? 0)
				)
			: 0
	);
	let guideCopy = $derived(
		$LL.editor as unknown as {
			translationGuideTitle: () => string;
			translationGuideDescription: () => string;
			reviewProgress: (args: { progress: number }) => string;
		}
	);
</script>

<div class="translations-editor-mobile-shell">
	<section class="translations-editor-toolbar" style={`--editor-panel-scale: ${panelScale};`}>
		<button
			class="drawer-toggle"
			class:drawer-open={leftDrawerOpen}
			type="button"
			aria-label={$LL.editor.translations()}
			aria-expanded={leftDrawerOpen}
			onclick={() => {
				leftDrawerOpen = !leftDrawerOpen;
				rightDrawerOpen = false;
			}}
		>
			<span class="material-icons">tune</span>
		</button>
		<div class="text-size-controls">
			<button
				type="button"
				title={$LL.editor.zoomOut()}
				aria-label={$LL.editor.zoomOut()}
				disabled={textSizeLevel === -5}
				onclick={() => (textSizeLevel = Math.max(-5, textSizeLevel - 1))}
			>
				−
			</button>
			<button
				type="button"
				title={$LL.editor.zoomIn()}
				aria-label={$LL.editor.zoomIn()}
				disabled={textSizeLevel === 3}
				onclick={() => (textSizeLevel = Math.min(3, textSizeLevel + 1))}
			>
				+
			</button>
		</div>

		<h2 class="translations-editor-title">{$LL.editor.translations()}</h2>

		<button
			class="drawer-toggle"
			class:drawer-open={rightDrawerOpen}
			type="button"
			aria-label={$LL.editor.wordStyles()}
			aria-expanded={rightDrawerOpen}
			onclick={() => {
				rightDrawerOpen = !rightDrawerOpen;
				leftDrawerOpen = false;
			}}
		>
			<span class="material-icons">format_paint</span>
		</button>
	</section>

	{#if visibleEditions.length > 0 && !globalState.currentProject!.projectEditorState.translationGuideDismissed}
		<section class="translation-context-guide">
			<span class="material-icons-outlined">swipe</span>
			<div class="min-w-0 flex-1">
				<h3>{guideCopy.translationGuideTitle()}</h3>
				<p>{guideCopy.translationGuideDescription()}</p>
			</div>
			<button
				type="button"
				aria-label={$LL.common.close()}
				onclick={() =>
					(globalState.currentProject!.projectEditorState.translationGuideDismissed = true)}
			>
				<span class="material-icons">close</span>
			</button>
		</section>
	{/if}

	<section
		class="translations-editor-workspace"
		style={`--translation-text-scale: ${1 + textSizeLevel * 0.1}; --translation-text-spacing-scale: ${textSizeLevel >= -1 ? 1 : 1 + (textSizeLevel + 1) * 0.2};`}
	>
		<div
			class="editor-ui-scale"
			style={`--editor-panel-scale: ${panelScale}; --editor-panel-height: ${100 / panelScale}%;`}
		>
			<Workspace
				setAddTranslationModalVisibility={(visible: boolean) =>
					(addTranslationModalVisibility = visible)}
			/>
		</div>
	</section>

	{#if progressEdition}
		<section class="translation-review-progress">
			<p>{guideCopy.reviewProgress({ progress: reviewPercentage })}</p>
			<div
				class="translation-review-track"
				role="progressbar"
				aria-label={$LL.editor.percentageReviewed()}
				aria-valuemin="0"
				aria-valuemax="100"
				aria-valuenow={reviewPercentage}
			>
				<div class="translation-review-bar" style={`width: ${reviewPercentage}%;`}></div>
			</div>
		</section>
	{/if}

	<MobileSideDrawers bind:leftOpen={leftDrawerOpen} bind:rightOpen={rightDrawerOpen}>
		{#snippet leftContent()}
			<div
				class="editor-ui-scale h-full min-h-0 overflow-y-auto"
				style={`--editor-panel-scale: ${panelScale}; --editor-panel-height: ${100 / panelScale}%;`}
			>
				<TranslationsEditorSettings
					setAddTranslationModalVisibility={(visible: boolean) =>
						(addTranslationModalVisibility = visible)}
				/>
			</div>
		{/snippet}
		{#snippet rightContent()}
			<div
				class="editor-ui-scale h-full min-h-0 overflow-hidden pb-36"
				style={`--editor-panel-scale: ${panelScale}; --editor-panel-height: ${100 / panelScale}%;`}
			>
				<TranslationInlineStylePanel />
			</div>
		{/snippet}
	</MobileSideDrawers>
</div>

<div class="hidden" aria-hidden="true">
	<VideoPreview showControls={false} />
</div>

{#if addTranslationModalVisibility}
	<div class="modal-wrapper" transition:fade>
		<AddTranslationModal close={() => (addTranslationModalVisibility = false)} />
	</div>
{/if}

<style>
	.translations-editor-mobile-shell {
		position: relative;
		display: flex;
		height: 100%;
		min-height: 0;
		width: 100%;
		flex-direction: column;
		gap: 0.5rem;
		overflow: hidden;
		padding: 0.5rem;
	}

	.translations-editor-toolbar {
		position: relative;
		display: flex;
		flex-shrink: 0;
		align-items: center;
		gap: 0.5rem;
		zoom: var(--editor-panel-scale);
	}

	.translations-editor-title {
		position: absolute;
		left: 50%;
		max-width: calc(100% - 13rem);
		overflow: hidden;
		transform: translateX(-50%);
		text-align: center;
		font-size: 1rem;
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text-primary);
	}

	.translations-editor-toolbar > .drawer-toggle:last-child {
		margin-left: auto;
	}

	.translations-editor-workspace {
		display: flex;
		flex: 1 1 0;
		min-height: 0;
		overflow: hidden;
	}

	.editor-ui-scale {
		display: flex;
		min-width: 0;
		max-width: 100%;
		height: var(--editor-panel-height);
		flex: 1;
		flex-direction: column;
		zoom: var(--editor-panel-scale);
	}

	.translation-review-progress {
		position: relative;
		width: calc(100% + 1rem);
		flex-shrink: 0;
		margin: 0 -0.5rem -0.5rem;
	}

	.translation-review-progress p {
		position: absolute;
		right: 0.5rem;
		bottom: 0.45rem;
		border-radius: 9999px;
		padding: 0.15rem 0.45rem;
		background: var(--bg-primary);
		color: var(--text-secondary);
		font-size: 0.58rem;
		font-weight: 700;
	}

	.translation-review-track {
		height: 0.35rem;
		overflow: hidden;
		background: var(--border-color);
	}

	.translation-review-bar {
		height: 100%;
		background: var(--accent-primary);
		transition: width 0.3s ease-in-out;
	}

	.drawer-toggle {
		z-index: 40;
		display: flex;
		flex-shrink: 0;
		height: 2.5rem;
		width: 2.5rem;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--border-color);
		border-radius: 9999px;
		background: var(--bg-secondary);
		color: var(--text-primary);
		box-shadow: 0 4px 14px rgb(0 0 0 / 30%);
	}

	.drawer-toggle.drawer-open {
		color: var(--accent-primary);
	}

	.translation-context-guide {
		display: flex;
		flex-shrink: 0;
		align-items: flex-start;
		gap: 0.55rem;
		border: 1px solid color-mix(in srgb, var(--accent-primary) 40%, var(--border-color));
		border-radius: 0.75rem;
		padding: 0.55rem 0.65rem;
		background: color-mix(in srgb, var(--accent-primary) 9%, var(--bg-secondary));
	}

	.translation-context-guide > .material-icons-outlined {
		font-size: 1.1rem;
		color: var(--accent-primary);
	}

	.translation-context-guide h3 {
		font-size: 0.72rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.translation-context-guide p {
		margin-top: 0.1rem;
		font-size: 0.62rem;
		line-height: 1.3;
		color: var(--text-secondary);
	}

	.translation-context-guide button {
		display: flex;
		height: 1.75rem;
		width: 1.75rem;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		border-radius: 9999px;
		color: var(--text-secondary);
	}

	.translation-context-guide button .material-icons {
		font-size: 1rem;
	}

	.text-size-controls {
		display: flex;
		overflow: hidden;
		border: 1px solid var(--border-color);
		border-radius: 0.375rem;
		background: color-mix(in srgb, var(--bg-primary) 85%, transparent);
		box-shadow: 0 1px 3px rgb(0 0 0 / 20%);
	}

	.text-size-controls button {
		display: flex;
		height: 1.5rem;
		width: 1.75rem;
		align-items: center;
		justify-content: center;
		color: var(--text-secondary);
		font-size: 0.875rem;
	}

	.text-size-controls button + button {
		border-left: 1px solid var(--border-color);
	}

	.text-size-controls button:disabled {
		opacity: 0.3;
	}

	@media (orientation: landscape) {
		.translations-editor-mobile-shell {
			gap: 0.4rem;
			padding: 0.4rem;
		}

		.translation-review-progress {
			width: calc(100% + 0.8rem);
			margin: 0 -0.4rem -0.4rem;
		}
	}
</style>
