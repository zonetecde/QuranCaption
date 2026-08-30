<script lang="ts">
	import { getCurrentWebview } from '@tauri-apps/api/webview';
	import { readTextFile } from '@tauri-apps/plugin-fs';
	import { globalState } from '$lib/runes/main.svelte';
	import { mount, onDestroy, onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { get } from 'svelte/store';
	import toast from 'svelte-5-french-toast';
	import Timeline from '../../timeline/Timeline.svelte';
	import VideoPreview from '../../videoPreview/VideoPreview.svelte';
	import DropOverlay from '../videoEditor/assetsManager/DropOverlay.svelte';
	import SubtitlesEditorSettings from './SubtitlesEditorSettings.svelte';
	import SubtitlesList from './SubtitlesList.svelte';
	import SubtitlePresetPicker from './SubtitlePresetPicker.svelte';
	import SubtitlesWorkspace from './SubtitlesWorkspace.svelte';
	import VersePicker from './VersePicker.svelte';
	import { getDroppedJsonPath } from './drop';
	import LL from '$lib/i18n/i18n-svelte';
	import { runAutoSegmentationFromImportedJson } from '$lib/services/AutoSegmentation';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
	import { TrackType } from '$lib/classes';
	import DiviseurRedimensionnable from '../DiviseurRedimensionnable.svelte';
	import MobileSideDrawers from '$lib/components/misc/MobileSideDrawers.svelte';
	import AutoSegmentationModal from './modal/AutoSegmentationModal.svelte';

	let unlistenDrop: (() => void) | null = null;
	let leftDrawerOpen = $state(false);
	let rightDrawerOpen = $state(false);
	let presetPickerOpen = $state(false);
	let autoSegmentationModalOpen = $state(false);
	let controlHelpOpen = $state(false);
	let subtitleStartMode = $state<'choice' | 'manual'>('choice');
	let walkthroughOpen = $state(false);
	let hasSubtitles = $derived(globalState.getSubtitleClips.length > 0);
	let startCopy = $derived(
		$LL.editor as unknown as {
			chooseSubtitleMethod: () => string;
			chooseSubtitleMethodDescription: () => string;
			useAiRecommended: () => string;
			createManually: () => string;
			manualSubtitleSteps: () => string;
			viewExample: () => string;
			controlsGuide: () => string;
		}
	);
	let panelScale = $derived(
		1 + (globalState.settings?.persistentUiState.editorPanelScalePercent ?? -15) / 100
	);
	let lastEditedSubtitleId: number | null = null;
	let subtitlesWorkspace: { addSubtitle: () => Promise<void> } | null = $state(null);

	const WORKSPACE_HEIGHT_MIN = 35;
	const WORKSPACE_HEIGHT_MAX = 80;

	let workspaceHeight = $derived(
		Math.max(
			WORKSPACE_HEIGHT_MIN,
			Math.min(
				WORKSPACE_HEIGHT_MAX,
				globalState.settings!.persistentUiState.projectEditorLayout.upperSectionHeight
			)
		)
	);

	$effect(() => {
		const editedSubtitleId = globalState.getSubtitlesEditorState.editSubtitle?.id ?? null;
		lastEditedSubtitleId = editedSubtitleId;
	});

	/**
	 * Applique au projet un export JSON Quranic Universal Aligner déposé.
	 *
	 * @param {string[]} paths Chemins déposés dans la fenêtre Tauri.
	 * @returns {Promise<void>} Promise résolue après le traitement du dépôt.
	 */
	async function importDroppedJson(paths: string[]): Promise<void> {
		const filePath = getDroppedJsonPath(paths, Boolean(globalState.shared.autoSegmentationWizard));
		if (!filePath) {
			if (globalState.shared.autoSegmentationWizard) return;
			toast.error(get(LL).editor.dragAndDropJsonFile());
			return;
		}

		try {
			const settings = globalState.settings!.autoSegmentationSettings;
			const payload = await readTextFile(filePath);
			const response = await ProjectHistoryManager.trackAsync('import subtitle segmentation', () =>
				runAutoSegmentationFromImportedJson(payload, {
					fillBySilence: settings.fillBySilence,
					extendBeforeSilence: settings.extendBeforeSilence,
					extendBeforeSilenceMs: settings.extendBeforeSilenceMs
				})
			);
			if (response?.status === 'completed') {
				toast.success(get(LL).editor.aiSegmentationFinished());
			} else if (response?.status === 'failed') {
				toast.error(response.message);
			}
		} catch (error) {
			toast.error(error instanceof Error ? error.message : String(error));
		}
	}

	/**
	 * Enregistre la gestion du glisser-déposer du Subtitles Editor.
	 *
	 * @returns {Promise<void>} Promise résolue quand l'écouteur Tauri est enregistré.
	 */
	async function setupDragDrop(): Promise<void> {
		unlistenDrop = await getCurrentWebview().onDragDropEvent((event) => {
			if (globalState.shared.autoSegmentationWizard) return;
			if (event.payload.type === 'over') {
				globalState.currentProject!.projectEditorState.showDropScreen = true;
				return;
			}

			globalState.currentProject!.projectEditorState.showDropScreen = false;
			if (event.payload.type === 'drop') void importDroppedJson(event.payload.paths);
		});
	}

	/**
	 * Retire la gestion du glisser-déposer du Subtitles Editor.
	 *
	 * @returns {void}
	 */
	function cleanupDragDrop(): void {
		unlistenDrop?.();
		unlistenDrop = null;
		if (globalState.currentProject) {
			globalState.currentProject.projectEditorState.showDropScreen = false;
		}
	}

	onMount(() => void setupDragDrop());
	onDestroy(cleanupDragDrop);

	$effect(() => {
		if (globalState.currentProject!.projectEditorState.showDropScreen) {
			const container = document.createElement('div');
			container.id = 'drop-overlay-container';
			document.body.appendChild(container);
			mount(DropOverlay, {
				target: container,
				props: {
					title: get(LL).editor.importMultiAlignerJson(),
					subtitle: get(LL).editor.dragAndDropJsonFile()
				}
			});

			return () => container.remove();
		}
	});
</script>

<div class="subtitles-editor-mobile-shell">
	<div class="playback-engine" aria-hidden="true">
		<VideoPreview showControls={false} useSplitHeight={false} />
	</div>

	<section
		class="subtitles-content-scale subtitles-editor-toolbar"
		style={`--editor-panel-scale: ${panelScale};`}
	>
		<div class="toolbar-actions">
			<button
				class="drawer-toggle"
				class:drawer-open={leftDrawerOpen}
				type="button"
				aria-label={$LL.editor.subtitlesEditor()}
				aria-expanded={leftDrawerOpen}
				onclick={() => {
					leftDrawerOpen = !leftDrawerOpen;
					rightDrawerOpen = false;
				}}
			>
				<span class="material-icons">tune</span>
			</button>
			<button
				class="drawer-toggle"
				class:drawer-toggle-labeled={!hasSubtitles}
				type="button"
				aria-label={$LL.editor.playbackControls()}
				aria-expanded={controlHelpOpen}
				onclick={() => (controlHelpOpen = true)}
			>
				<span class="material-icons">help_outline</span>
				{#if !hasSubtitles}<span class="drawer-toggle-label">{startCopy.controlsGuide()}</span>{/if}
			</button>
		</div>

		<div class="subtitles-editor-verse-picker">
			<VersePicker />
		</div>

		<button
			class="drawer-toggle"
			class:drawer-open={rightDrawerOpen}
			type="button"
			aria-label={$LL.editor.subtitles()}
			aria-expanded={rightDrawerOpen}
			onclick={() => {
				rightDrawerOpen = !rightDrawerOpen;
				leftDrawerOpen = false;
			}}
		>
			<span class="material-icons">view_list</span>
		</button>
	</section>

	{#if !hasSubtitles && subtitleStartMode === 'choice'}
		<section class="subtitle-start-card">
			<div class="min-w-0 flex-1">
				<h2>{startCopy.chooseSubtitleMethod()}</h2>
				<p>{startCopy.chooseSubtitleMethodDescription()}</p>
			</div>
			<div class="subtitle-start-actions">
				<button type="button" class="btn-accent" onclick={() => (autoSegmentationModalOpen = true)}>
					<span class="material-icons-outlined">auto_awesome</span>
					{startCopy.useAiRecommended()}
				</button>
				<button type="button" class="btn" onclick={() => (subtitleStartMode = 'manual')}>
					<span class="material-icons-outlined">touch_app</span>
					{startCopy.createManually()}
				</button>
			</div>
			<button type="button" class="subtitle-example-link" onclick={() => (walkthroughOpen = true)}>
				<span class="material-icons-outlined">play_circle</span>
				{startCopy.viewExample()}
			</button>
		</section>
	{:else if !hasSubtitles && subtitleStartMode === 'manual'}
		<section class="subtitle-manual-guide">
			<span class="material-icons-outlined">school</span>
			<p>{startCopy.manualSubtitleSteps()}</p>
			<button
				type="button"
				aria-label={$LL.common.close()}
				onclick={() => (subtitleStartMode = 'choice')}
			>
				<span class="material-icons">close</span>
			</button>
		</section>
	{/if}

	<div class="subtitles-editor-content" class:control-help-open={controlHelpOpen}>
		<section
			class="subtitles-editor-workspace"
			class:control-help-open={controlHelpOpen}
			style={`flex-basis: ${workspaceHeight}%;`}
		>
			<SubtitlesWorkspace
				bind:this={subtitlesWorkspace}
				useSplitHeight={false}
				showVersePicker={false}
				showPlaybackControls
				showControlHelp={controlHelpOpen}
				showManualGuide={!hasSubtitles && subtitleStartMode === 'manual'}
				onCloseControlHelp={() => (controlHelpOpen = false)}
				onTogglePresetPicker={() => (presetPickerOpen = !presetPickerOpen)}
				onClosePresetPicker={() => {
					presetPickerOpen = false;
				}}
				onOpenAutoSegmentation={() => (autoSegmentationModalOpen = true)}
			/>
		</section>

		<DiviseurRedimensionnable
			orientation="horizontal"
			bind:value={globalState.settings!.persistentUiState.projectEditorLayout.upperSectionHeight}
			displayedValue={workspaceHeight}
			min={WORKSPACE_HEIGHT_MIN}
			max={WORKSPACE_HEIGHT_MAX}
			unit="percent"
			dataTestId="subtitles-timeline-resizer"
		/>

		<section class="subtitles-editor-timeline" style={`--editor-panel-scale: ${panelScale};`}>
			<Timeline
				useSplitHeight={false}
				visibleTrackTypes={[TrackType.Audio, TrackType.Subtitle]}
				fitTracksToHeight
			/>
			{#if presetPickerOpen}
				<div class="preset-picker-overlay">
					<SubtitlePresetPicker
						onClose={() => {
							presetPickerOpen = false;
						}}
						onAddQuranSubtitle={() => subtitlesWorkspace?.addSubtitle()}
					/>
				</div>
			{/if}
		</section>
	</div>

	<MobileSideDrawers bind:leftOpen={leftDrawerOpen} bind:rightOpen={rightDrawerOpen}>
		{#snippet leftContent()}
			<div
				class="editor-ui-scale h-full min-h-0 overflow-y-auto"
				style={`--editor-panel-scale: ${panelScale}; --editor-panel-height: ${100 / panelScale}%;`}
			>
				<SubtitlesEditorSettings />
			</div>
		{/snippet}
		{#snippet rightContent()}
			<div
				class="editor-ui-scale h-full min-h-0 overflow-hidden"
				style={`--editor-panel-scale: ${panelScale}; --editor-panel-height: ${100 / panelScale}%;`}
			>
				<SubtitlesList autoScrollEnabled={rightDrawerOpen} />
			</div>
		{/snippet}
	</MobileSideDrawers>

	{#if autoSegmentationModalOpen}
		<div class="modal-wrapper" transition:fade>
			<AutoSegmentationModal close={() => (autoSegmentationModalOpen = false)} />
		</div>
	{/if}

	{#if walkthroughOpen}
		<div class="modal-wrapper walkthrough-backdrop" transition:fade>
			<section class="walkthrough-sheet" aria-label={$LL.editor.subtitlesEditorWalkthrough()}>
				<header>
					<div>
						<h2>{$LL.editor.needVisualWalkthrough()}</h2>
						<p>{$LL.editor.walkthroughDescription()}</p>
					</div>
					<button
						type="button"
						aria-label={$LL.common.close()}
						onclick={() => (walkthroughOpen = false)}
					>
						<span class="material-icons">close</span>
					</button>
				</header>
				<iframe
					src="https://www.youtube.com/embed/vCRUjzATRDk?start=35"
					title={$LL.editor.subtitlesEditorWalkthrough()}
					allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
					allowfullscreen
				></iframe>
			</section>
		</div>
	{/if}
</div>

<style>
	.subtitles-editor-mobile-shell {
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

	.subtitles-editor-workspace,
	.subtitles-editor-timeline {
		display: flex;
		min-height: 0;
		overflow: hidden;
	}

	.subtitles-editor-content {
		display: flex;
		flex: 1 1 0;
		min-height: 0;
		flex-direction: column;
		overflow: hidden;
	}

	.subtitles-editor-content.control-help-open {
		overflow: visible;
	}

	.subtitles-content-scale {
		min-width: 0;
		max-width: 100%;
		zoom: var(--editor-panel-scale);
	}

	.editor-ui-scale {
		min-width: 0;
		max-width: 100%;
		height: var(--editor-panel-height);
		zoom: var(--editor-panel-scale);
	}

	.subtitles-editor-workspace {
		flex-grow: 0;
		flex-shrink: 0;
	}

	.subtitles-editor-workspace.control-help-open {
		overflow: visible;
	}

	.playback-engine {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		opacity: 0;
		pointer-events: none;
	}

	.subtitles-editor-toolbar {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		gap: 0.5rem;
	}

	.toolbar-actions {
		display: flex;
		gap: 0.35rem;
	}

	.subtitles-editor-verse-picker {
		min-width: 0;
		flex: 1;
	}

	.subtitles-editor-timeline {
		position: relative;
		flex: 1 1 0;
		border: 1px solid var(--border-color);
		border-radius: 12px;
		background: var(--timeline-bg-primary);
	}

	.preset-picker-overlay {
		position: absolute;
		inset: 0;
		z-index: 120;
		overflow: hidden;
		border-radius: inherit;
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

	.drawer-toggle-labeled {
		width: auto;
		gap: 0.25rem;
		padding: 0 0.65rem;
	}

	.drawer-toggle-label {
		font-size: 0.65rem;
		font-weight: 700;
	}

	.subtitle-start-card,
	.subtitle-manual-guide {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		gap: 0.6rem;
		border: 1px solid color-mix(in srgb, var(--accent-primary) 45%, var(--border-color));
		border-radius: 0.75rem;
		padding: 0.55rem 0.65rem;
		background: color-mix(in srgb, var(--accent-primary) 9%, var(--bg-secondary));
	}

	.subtitle-start-card h2 {
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.subtitle-start-card p,
	.subtitle-manual-guide p {
		font-size: 0.62rem;
		line-height: 1.25;
		color: var(--text-secondary);
	}

	.subtitle-start-actions {
		display: grid;
		flex: 0 0 auto;
		grid-template-columns: 1fr 1fr;
		gap: 0.35rem;
	}

	.subtitle-start-actions button {
		display: flex;
		min-height: 2.35rem;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		border-radius: 0.55rem;
		padding: 0.3rem 0.5rem;
		font-size: 0.62rem;
		font-weight: 700;
	}

	.subtitle-start-actions .material-icons-outlined,
	.subtitle-example-link .material-icons-outlined {
		font-size: 1rem;
	}

	.subtitle-example-link {
		display: flex;
		flex: 0 0 auto;
		align-items: center;
		gap: 0.2rem;
		color: var(--accent-primary);
		font-size: 0.6rem;
		font-weight: 700;
	}

	.subtitle-manual-guide > .material-icons-outlined {
		font-size: 1.1rem;
		color: var(--accent-primary);
	}

	.subtitle-manual-guide p {
		flex: 1;
		font-weight: 600;
	}

	.subtitle-manual-guide button {
		display: flex;
		height: 1.75rem;
		width: 1.75rem;
		align-items: center;
		justify-content: center;
		border-radius: 9999px;
		color: var(--text-secondary);
	}

	.subtitle-manual-guide button .material-icons {
		font-size: 1rem;
	}

	.walkthrough-backdrop {
		background: rgb(0 0 0 / 65%);
	}

	.walkthrough-sheet {
		display: flex;
		width: calc(100% - 1.5rem);
		max-width: 32rem;
		flex-direction: column;
		gap: 0.75rem;
		border: 1px solid var(--border-color);
		border-radius: 1rem;
		padding: 1rem;
		background: var(--bg-secondary);
	}

	.walkthrough-sheet header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.walkthrough-sheet h2 {
		font-size: 1rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.walkthrough-sheet p {
		margin-top: 0.2rem;
		font-size: 0.75rem;
		color: var(--text-secondary);
	}

	.walkthrough-sheet header button {
		display: flex;
		height: 2.25rem;
		width: 2.25rem;
		align-items: center;
		justify-content: center;
		border-radius: 9999px;
		background: var(--bg-primary);
		color: var(--text-primary);
	}

	.walkthrough-sheet iframe {
		width: 100%;
		aspect-ratio: 16 / 9;
		border: 0;
		border-radius: 0.75rem;
	}

	@media (max-width: 420px) {
		.subtitle-start-card {
			align-items: stretch;
			flex-direction: column;
		}

		.subtitle-start-actions {
			width: 100%;
		}

		.subtitle-example-link {
			justify-content: center;
		}
	}

	@media (orientation: landscape) {
		.subtitles-editor-mobile-shell {
			gap: 0.4rem;
			padding: 0.4rem;
		}
	}
</style>
