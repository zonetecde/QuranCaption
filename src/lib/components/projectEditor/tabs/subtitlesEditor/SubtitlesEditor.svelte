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
		if (editedSubtitleId !== null && editedSubtitleId !== lastEditedSubtitleId) {
			presetPickerOpen = true;
		}
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
				type="button"
				aria-label={$LL.editor.playbackControls()}
				aria-expanded={controlHelpOpen}
				onclick={() => (controlHelpOpen = true)}
			>
				<span class="material-icons">help_outline</span>
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
				onCloseControlHelp={() => (controlHelpOpen = false)}
				onTogglePresetPicker={() => (presetPickerOpen = !presetPickerOpen)}
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

		<section
			class="subtitles-content-scale subtitles-editor-timeline"
			style={`--editor-panel-scale: ${panelScale};`}
		>
			<Timeline
				useSplitHeight={false}
				visibleTrackTypes={[TrackType.Audio, TrackType.Subtitle]}
				fitTracksToHeight
			/>
			{#if presetPickerOpen}
				<div class="preset-picker-overlay">
					<SubtitlePresetPicker
						onClose={() => (presetPickerOpen = false)}
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

	@media (orientation: landscape) {
		.subtitles-editor-mobile-shell {
			gap: 0.4rem;
			padding: 0.4rem;
		}
	}
</style>
