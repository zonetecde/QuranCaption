<script lang="ts">
	import type { VisualMergeMode } from '$lib/classes/Clip.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import {
		canMergeArabicVisualModes,
		getActiveVisualMergeGroupId,
		getActiveVisualMergeMode
	} from './visualMergeStyleUtils';
	import type { StylePanel } from './styleEditorTypes';

	let {
		panels,
		openPresetLibrary,
		getPanelLabel,
		selectPanel,
		secondaryControlsVisible
	}: {
		panels: StylePanel[];
		openPresetLibrary: () => void;
		getPanelLabel: (panel: StylePanel) => string;
		selectPanel: (panelId: string) => void;
		secondaryControlsVisible: boolean;
	} = $props();

	const visualMergeSelection = $derived(
		globalState.getSubtitleTrack.getVisualMergeSelection(
			globalState.getStylesState.selectedSubtitles
		)
	);
	const activeVisualMergeMode = $derived(
		getActiveVisualMergeMode(
			globalState.getStylesState.selectedSubtitles,
			globalState.getSubtitleTrack
		)
	);
	const activeVisualMergeGroupId = $derived(
		getActiveVisualMergeGroupId(globalState.getStylesState.selectedSubtitles, activeVisualMergeMode)
	);
	const canMergeArabicModes = $derived(
		canMergeArabicVisualModes(visualMergeSelection, globalState.getSubtitleTrack)
	);

	/**
	 * Applique un merge visuel à la sélection courante.
	 * @param {VisualMergeMode} mode Mode de merge à appliquer.
	 * @returns {void}
	 */
	function applyVisualMerge(mode: VisualMergeMode): void {
		globalState.getSubtitleTrack.applyVisualMerge(
			globalState.getStylesState.selectedSubtitles,
			mode
		);
	}

	/**
	 * Retourne les classes du bouton correspondant au mode de merge.
	 * @param {VisualMergeMode} mode Mode représenté par le bouton.
	 * @returns {string} Classes CSS du bouton.
	 */
	function getMergeButtonClass(mode: VisualMergeMode): string {
		return (
			'py-1.5 2xl:text-sm text-xs 2xl:px-2 ' +
			(activeVisualMergeMode === mode ? 'btn-accent' : 'btn')
		);
	}

	/**
	 * Retire le merge visuel actuellement sélectionné.
	 * @returns {void}
	 */
	function unmergeSelectedVisualGroup(): void {
		if (activeVisualMergeGroupId) {
			globalState.getSubtitleTrack.unmergeVisualGroup(activeVisualMergeGroupId);
		}
	}
</script>

<div class="style-editor-header">
	<div data-tour-id="style-subtabs" class="style-target-tabs grid grid-cols-3 gap-1.5">
		{#each ['global', 'arabic', 'translation'] as selection (selection)}
			<button
				type="button"
				aria-pressed={globalState.getStylesState.currentSelection === selection}
				onclick={() => {
					globalState.getStylesState.currentSelection = selection as
						| 'global'
						| 'arabic'
						| 'translation';
				}}
				class={'style-target-tab ' +
					(globalState.getStylesState.currentSelection === selection
						? 'style-target-tab-active'
						: '')}
				title={selection === 'arabic'
					? $LL.editor.arabic()
					: selection === 'translation'
						? $LL.editor.translation()
						: $LL.status.video()}
			>
				<span class="material-icons-outlined text-[16px]!">
					{selection === 'global' ? 'movie' : selection === 'arabic' ? 'text_fields' : 'translate'}
				</span>
				<span>
					{selection === 'arabic'
						? $LL.editor.arabic()
						: selection === 'translation'
							? $LL.editor.translation()
							: $LL.status.video()}
				</span>
			</button>
		{/each}
	</div>

	<div class="style-secondary-shell" class:style-secondary-shell-hidden={!secondaryControlsVisible}>
		<div class="style-secondary-controls">
			{#if globalState.getStylesState.currentSelection === 'translation'}
				{#if globalState.getProjectTranslation.addedTranslationEditions.length > 0}
					<label class="flex items-center gap-2">
						<span class="material-icons-outlined text-sm text-secondary">translate</span>
						<select
							class="flex-1 text-sm"
							aria-label={$LL.editor.selectTranslation()}
							bind:value={globalState.getStylesState.currentSelectionTranslation}
						>
							{#each globalState.getProjectTranslation.addedTranslationEditions as translation (translation.name)}
								<option value={translation.name}>{translation.author}</option>
							{/each}
						</select>
					</label>
				{:else}
					<p class="py-1 text-center text-xs text-secondary">{$LL.editor.noTranslationsYet()}</p>
				{/if}
			{/if}

			<div class="style-tools-row">
				<div class="relative min-w-0 flex-1">
					<span
						class="material-icons-outlined absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-secondary"
						>search</span
					>
					<input
						type="text"
						role="searchbox"
						placeholder={$LL.style.searchStyles()}
						aria-label={$LL.style.searchStyles()}
						class="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] py-1 pr-8 pl-9! text-xs focus:ring-1 focus:ring-white/20"
						bind:value={globalState.getStylesState.searchQuery}
					/>
					{#if globalState.getStylesState.searchQuery}
						<button
							type="button"
							title={$LL.editor.clearSearch()}
							aria-label={$LL.editor.clearSearch()}
							onclick={() => (globalState.getStylesState.searchQuery = '')}
							class="absolute top-1/2 right-2 -translate-y-1/2 text-secondary hover:text-primary"
						>
							<span class="material-icons-outlined text-sm">close</span>
						</button>
					{/if}
				</div>
				<button
					type="button"
					class="btn-accent style-presets-button"
					onclick={openPresetLibrary}
					title={$LL.editor.saveStylesTooltip()}
				>
					<span class="material-icons-outlined text-[16px]!">style</span>
					<span>{$LL.editor.presetsLabel()}</span>
				</button>
			</div>

			{#if globalState.getStylesState.selectedSubtitles.length > 0}
				<div class="style-selection-context">
					<span class="material-icons-outlined text-base">select_all</span>
					<p class="min-w-0 flex-1 text-xs leading-snug">
						{$LL.editor.subtitlesSelected({
							count: globalState.getStylesState.selectedSubtitles.length,
							plural: globalState.getStylesState.selectedSubtitles.length > 1 ? 's' : ''
						})}
					</p>
					<button
						type="button"
						class="text-secondary hover:text-primary"
						title={$LL.editor.clearSelection()}
						aria-label={$LL.editor.clearSelection()}
						onclick={() => globalState.getStylesState.clearSelection()}
					>
						<span class="material-icons-outlined text-base">close</span>
					</button>
				</div>

				{#if visualMergeSelection && canMergeArabicModes}
					<div class="rounded-lg border border-emerald-400/30 bg-emerald-500/8 px-2.5 py-2">
						<div class="flex items-start gap-2 text-xs text-[var(--text-primary)]">
							<span class="material-icons-outlined mt-0.5 text-base">merge_type</span>
							<div class="min-w-0">
								<p class="font-medium">{$LL.editor.visualMerge()}</p>
								<p class="mt-0.5 leading-relaxed text-secondary">
									{$LL.editor.visualMergeDescription()}
								</p>
							</div>
						</div>
						<div class="mt-2 grid grid-cols-3 gap-1.5">
							<button
								type="button"
								data-testid="Merge Arabic"
								class={getMergeButtonClass('arabic')}
								onclick={() => applyVisualMerge('arabic')}
							>
								{$LL.editor.arabic()}
							</button>
							<button
								type="button"
								data-testid="Merge Translation"
								class={getMergeButtonClass('translation')}
								onclick={() => applyVisualMerge('translation')}
							>
								{$LL.editor.translation()}
							</button>
							<button
								type="button"
								data-testid="Merge Both"
								class={getMergeButtonClass('both')}
								onclick={() => applyVisualMerge('both')}
							>
								{$LL.editor.both()}
							</button>
						</div>
						{#if activeVisualMergeGroupId}
							<button
								type="button"
								class="btn mt-2 w-full py-1.5 text-xs"
								onclick={unmergeSelectedVisualGroup}
							>
								{$LL.editor.unmergeGroup()}
							</button>
						{/if}
					</div>
				{/if}
			{:else if globalState.getStylesState.selectedVideos.length > 0}
				<div class="style-selection-context">
					<span class="material-icons-outlined text-base">movie</span>
					<p class="min-w-0 flex-1 text-xs leading-snug">
						{$LL.editor.videoClipsSelected({
							count: globalState.getStylesState.selectedVideos.length,
							plural: globalState.getStylesState.selectedVideos.length > 1 ? 's' : ''
						})}
					</p>
					<button
						type="button"
						class="text-secondary hover:text-primary"
						title={$LL.editor.clearSelection()}
						aria-label={$LL.editor.clearSelection()}
						onclick={() => globalState.getStylesState.clearSelection()}
					>
						<span class="material-icons-outlined text-base">close</span>
					</button>
				</div>
			{:else}
				<!-- <div
			class="flex items-start gap-2 rounded-lg border border-sky-400/25 bg-sky-500/7 px-2.5 py-1.5 text-[var(--text-primary)]"
		>
			<span class="material-icons-outlined mt-0.5 text-sm">info</span>
			<p class="text-[11px] leading-relaxed">{$LL.editor.clickToSelect()}</p>
		</div> -->
			{/if}

			{#if !(globalState.getStylesState.getCurrentSelection() === 'global' && globalState.getStylesState.selectedSubtitles.length > 0) && !(globalState.getStylesState.currentSelection === 'translation' && globalState.getProjectTranslation.addedTranslationEditions.length === 0)}
				<div class="style-panel-tabs" aria-label={$LL.style.styleEditor()}>
					{#each panels as panel (panel.id)}
						<button
							type="button"
							aria-pressed={globalState.getStylesState.currentPanel === panel.id}
							class={'style-panel-tab ' +
								(globalState.getStylesState.currentPanel === panel.id
									? 'style-panel-tab-active'
									: '')}
							onclick={() => selectPanel(panel.id)}
						>
							<span class="material-icons-outlined text-[16px]!">{panel.icon}</span>
							<span>{getPanelLabel(panel)}</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.style-editor-header {
		display: contents;
	}
	.style-target-tabs {
		position: sticky;
		top: 0;
		z-index: 20;
		padding: 0.5rem;
		background: var(--bg-secondary);
	}
	.style-secondary-shell {
		position: sticky;
		top: 2.75rem;
		z-index: 19;
		display: grid;
		grid-template-rows: 1fr;
		background: var(--bg-secondary);
		opacity: 1;
		transition:
			grid-template-rows 180ms ease,
			opacity 140ms ease;
	}
	.style-secondary-shell-hidden {
		grid-template-rows: 0fr;
		opacity: 0;
		pointer-events: none;
	}
	.style-secondary-controls {
		display: flex;
		min-height: 0;
		flex-direction: column;
		gap: 0.4rem;
		overflow: hidden;
		padding: 0 0.5rem;
	}
	.style-secondary-controls > :last-child {
		margin-bottom: 0.5rem;
	}
	.style-target-tab {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		min-width: 0;
		border: 1px solid var(--border-color);
		border-radius: 0.55rem;
		padding: 0.38rem 0.25rem;
		background: color-mix(in srgb, var(--bg-secondary) 85%, transparent);
		color: var(--text-secondary);
		font-size: 0.68rem;
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
		transition: 150ms ease;
	}
	.style-target-tab:hover {
		background: var(--bg-accent);
		color: var(--text-primary);
	}
	.style-target-tab-active {
		border-color: color-mix(in srgb, var(--accent-primary) 70%, var(--border-color));
		background: color-mix(in srgb, var(--accent-primary) 18%, var(--bg-secondary));
		color: var(--accent-primary);
	}
	.style-tools-row {
		display: flex;
		align-items: stretch;
		gap: 0.4rem;
	}
	.style-presets-button {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		padding: 0.25rem 0.5rem;
		font-size: 0.68rem;
	}
	.style-selection-context {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		border: 1px solid color-mix(in srgb, var(--accent-primary) 35%, var(--border-color));
		border-radius: 0.55rem;
		padding: 0.4rem 0.5rem;
		background: color-mix(in srgb, var(--accent-primary) 8%, transparent);
		color: var(--text-secondary);
	}
	.style-panel-tabs {
		display: flex;
		gap: 0.35rem;
		overflow-x: auto;
		padding-bottom: 0.4rem;
		border-bottom: 1px solid var(--border-color);
		scrollbar-width: none;
	}
	.style-panel-tabs::-webkit-scrollbar {
		display: none;
	}
	.style-panel-tab {
		display: flex;
		flex: 0 0 auto;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		border: 1px solid transparent;
		border-radius: 0.6rem;
		padding: 0.38rem 0.55rem;
		background: var(--bg-accent);
		color: var(--text-secondary);
		font-size: 0.7rem;
		font-weight: 600;
		line-height: 1.2;
		text-align: left;
		cursor: pointer;
		transition: 150ms ease;
	}
	.style-panel-tab > span:last-child {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.style-panel-tab:hover {
		color: var(--text-primary);
		border-color: var(--border-color);
	}
	.style-panel-tab-active {
		background: color-mix(in srgb, var(--accent-primary) 28%, var(--bg-secondary));
		border-color: var(--accent-primary);
		color: var(--text-primary);
	}
	.style-panel-tab-active:hover {
		border-color: var(--accent-primary);
		color: var(--text-primary);
	}
</style>
