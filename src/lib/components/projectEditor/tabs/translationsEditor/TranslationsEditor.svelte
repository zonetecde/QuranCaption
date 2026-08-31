<script lang="ts">
	import { fade } from 'svelte/transition';
	import AddTranslationModal from './modal/AddTranslationModal.svelte';
	import TranslationInlineStylePanel from './TranslationInlineStylePanel.svelte';
	import MobileRightDrawer from '$lib/components/misc/MobileRightDrawer.svelte';
	import TranslationsEditorSettings from './leftPanel/TranslationsEditorSettings.svelte';
	import Workspace from './workspace/Workspace.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import DiviseurRedimensionnable from '../DiviseurRedimensionnable.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { PROJECT_EDITOR_PANEL_WIDTHS } from '$lib/constants/projectEditor';
	import VideoPreview from '../../videoPreview/VideoPreview.svelte';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';

	let addTranslationModalVisibility = $state(false);
	let guideCopy = $derived(
		$LL.editor as unknown as {
			translationGuideTitle: () => string;
			translationGuideDescription: () => string;
		}
	);

	/**
	 * Masque l'aide contextuelle des traductions pour le projet courant.
	 * @returns {void}
	 */
	function dismissTranslationGuide(): void {
		ProjectHistoryManager.track('dismiss translation guide', () => {
			globalState.currentProject!.projectEditorState.translationGuideDismissed = true;
		});
	}
</script>

<div class="relative flex-grow w-full max-w-full flex overflow-hidden h-full min-h-0">
	<!-- Assets -->
	<section
		class="flex-shrink-0 divide-y-2 divide-color h-full min-h-0 max-h-full overflow-hidden flex flex-col"
		style={`width: ${globalState.settings!.persistentUiState.projectEditorLayout.translationsEditorLeftPanelWidth}px;`}
	>
		<TranslationsEditorSettings
			setAddTranslationModalVisibility={(visible: boolean) =>
				(addTranslationModalVisibility = visible)}
		/>
	</section>
	<DiviseurRedimensionnable
		orientation="vertical"
		bind:value={
			globalState.settings!.persistentUiState.projectEditorLayout.translationsEditorLeftPanelWidth
		}
		min={PROJECT_EDITOR_PANEL_WIDTHS.translationsLeft.min}
		max={PROJECT_EDITOR_PANEL_WIDTHS.translationsLeft.max}
		dataTestId="translations-left-panel-resizer"
	/>
	<section class="flex-1 min-w-0 flex flex-row max-h-full min-h-0">
		<section class="w-full min-w-0 flex flex-col min-h-0">
			{#if globalState.settings?.persistentUiState.showFirstVideoGuide !== false && globalState.getProjectTranslation.addedTranslationEditions.length > 0 && !globalState.currentProject!.projectEditorState.translationGuideDismissed}
				<div class="translation-context-guide">
					<div class="translation-guide-icon" aria-hidden="true">
						<span class="material-icons-outlined">drag_indicator</span>
					</div>
					<div class="min-w-0 flex-1">
						<h2>{guideCopy.translationGuideTitle()}</h2>
						<p>{guideCopy.translationGuideDescription()}</p>
					</div>
					<button type="button" aria-label={$LL.common.close()} onclick={dismissTranslationGuide}>
						<span class="material-icons">close</span>
					</button>
				</div>
			{/if}
			<Workspace
				setAddTranslationModalVisibility={(visible: boolean) =>
					(addTranslationModalVisibility = visible)}
			/>
		</section>
	</section>

	<DiviseurRedimensionnable
		orientation="vertical"
		bind:value={
			globalState.settings!.persistentUiState.projectEditorLayout.translationsEditorRightPanelWidth
		}
		min={PROJECT_EDITOR_PANEL_WIDTHS.translationsRight.min}
		max={PROJECT_EDITOR_PANEL_WIDTHS.translationsRight.max}
		reverse
		class="hidden 2xl:block"
		dataTestId="translations-right-panel-resizer"
	/>
	<section
		class="hidden 2xl:flex flex-shrink-0 h-full min-h-0 max-h-full overflow-hidden flex-col border-l border-color border-t ml-1 rounded-lg bg-secondary"
		style={`width: ${globalState.settings!.persistentUiState.projectEditorLayout.translationsEditorRightPanelWidth}px;`}
	>
		<TranslationInlineStylePanel />
	</section>

	<MobileRightDrawer title={$LL.editor.wordStyles()} icon="tune" triggerTopClass="top-0">
		<TranslationInlineStylePanel />
	</MobileRightDrawer>
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
	.translation-context-guide {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		gap: 0.7rem;
		border-bottom: 1px solid color-mix(in srgb, var(--accent-primary) 35%, var(--border-color));
		padding: 0.65rem 0.8rem;
		background: color-mix(in srgb, var(--accent-primary) 8%, var(--bg-secondary));
	}
	.translation-guide-icon {
		display: flex;
		height: 2.2rem;
		width: 2.2rem;
		align-items: center;
		justify-content: center;
		border-radius: 0.65rem;
		background: color-mix(in srgb, var(--accent-primary) 15%, transparent);
		color: var(--accent-primary);
	}
	.translation-context-guide h2 {
		color: var(--text-primary);
		font-size: 0.75rem;
		font-weight: 700;
	}
	.translation-context-guide p {
		margin-top: 0.1rem;
		color: var(--text-secondary);
		font-size: 0.65rem;
		line-height: 1.35;
	}
	.translation-context-guide button {
		display: flex;
		height: 1.9rem;
		width: 1.9rem;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		border-radius: 9999px;
		color: var(--text-secondary);
	}
	.translation-context-guide button:hover {
		background: var(--bg-accent);
		color: var(--text-primary);
	}
	.translation-context-guide button .material-icons {
		font-size: 1rem;
	}
</style>
