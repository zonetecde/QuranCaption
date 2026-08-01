<script lang="ts">
	import { fade } from 'svelte/transition';
	import MobileSideDrawers from '$lib/components/misc/MobileSideDrawers.svelte';
	import AddTranslationModal from './modal/AddTranslationModal.svelte';
	import TranslationInlineStylePanel from './TranslationInlineStylePanel.svelte';
	import TranslationsEditorSettings from './leftPanel/TranslationsEditorSettings.svelte';
	import Workspace from './workspace/Workspace.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';

	let addTranslationModalVisibility = $state(false);
	let leftDrawerOpen = $state(false);
	let rightDrawerOpen = $state(false);
	let textSizeLevel = $state(-1);
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
</script>

<div class="translations-editor-mobile-shell">
	<section class="translations-editor-toolbar">
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

	<section
		class="translations-editor-workspace"
		style={`--translation-text-scale: ${1 + textSizeLevel * 0.1}; --translation-text-spacing-scale: ${textSizeLevel >= -1 ? 1 : 1 + (textSizeLevel + 1) * 0.2};`}
	>
		<Workspace
			setAddTranslationModalVisibility={(visible: boolean) =>
				(addTranslationModalVisibility = visible)}
		/>
	</section>

	{#if progressEdition}
		<section class="translation-review-progress">
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
			<TranslationsEditorSettings
				setAddTranslationModalVisibility={(visible: boolean) =>
					(addTranslationModalVisibility = visible)}
			/>
		{/snippet}
		{#snippet rightContent()}
			<div class="h-full min-h-0 overflow-y-auto">
				<TranslationInlineStylePanel />
			</div>
		{/snippet}
	</MobileSideDrawers>
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

	.translation-review-progress {
		width: calc(100% + 1rem);
		flex-shrink: 0;
		margin: 0 -0.5rem -0.5rem;
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
