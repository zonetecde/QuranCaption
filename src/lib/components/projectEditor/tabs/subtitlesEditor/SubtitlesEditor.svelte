<script lang="ts">
	import { getCurrentWebview } from '@tauri-apps/api/webview';
	import { readTextFile } from '@tauri-apps/plugin-fs';
	import { globalState } from '$lib/runes/main.svelte';
	import { mount, onDestroy, onMount } from 'svelte';
	import { get } from 'svelte/store';
	import toast from 'svelte-5-french-toast';
	import Timeline from '../../timeline/Timeline.svelte';
	import VideoPreview from '../../videoPreview/VideoPreview.svelte';
	import DiviseurRedimensionnable from '../DiviseurRedimensionnable.svelte';
	import DropOverlay from '../videoEditor/assetsManager/DropOverlay.svelte';
	import SubtitlesEditorSettings from './SubtitlesEditorSettings.svelte';
	import SubtitlesList from './SubtitlesList.svelte';
	import SubtitlesWorkspace from './SubtitlesWorkspace.svelte';
	import { getDroppedJsonPath } from './drop';
	import {
		PROJECT_EDITOR_PANEL_WIDTHS,
		PROJECT_EDITOR_TIMELINE_HEIGHT
	} from '$lib/constants/projectEditor';
	import LL from '$lib/i18n/i18n-svelte';
	import { runAutoSegmentationFromImportedJson } from '$lib/services/AutoSegmentation';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';

	let unlistenDrop: (() => void) | null = null;

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

<div class="flex-grow w-full max-w-full flex overflow-hidden h-full min-h-0">
	<!-- Assets -->
	<section
		class="flex-shrink-0 divide-y-2 divide-color max-h-full overflow-hidden flex flex-col"
		style={`width: ${globalState.settings!.persistentUiState.projectEditorLayout.subtitlesEditorLeftPanelWidth}px;`}
	>
		<SubtitlesEditorSettings />
	</section>
	<DiviseurRedimensionnable
		orientation="vertical"
		bind:value={
			globalState.settings!.persistentUiState.projectEditorLayout.subtitlesEditorLeftPanelWidth
		}
		min={PROJECT_EDITOR_PANEL_WIDTHS.subtitlesLeft.min}
		max={PROJECT_EDITOR_PANEL_WIDTHS.subtitlesLeft.max}
		dataTestId="subtitles-left-panel-resizer"
	/>
	<section class="flex-1 min-w-0 flex flex-row max-h-full min-h-0">
		<section class="w-full min-w-0 flex flex-col min-h-0">
			<!-- Video preview -->
			<SubtitlesWorkspace />

			<DiviseurRedimensionnable
				orientation="horizontal"
				bind:value={globalState.settings!.persistentUiState.projectEditorLayout.upperSectionHeight}
				min={PROJECT_EDITOR_TIMELINE_HEIGHT.min}
				max={PROJECT_EDITOR_TIMELINE_HEIGHT.max}
				unit="percent"
			/>

			<!-- Timeline -->
			<Timeline />
		</section>
	</section>
	<!-- Settings -->
	<DiviseurRedimensionnable
		orientation="vertical"
		bind:value={
			globalState.settings!.persistentUiState.projectEditorLayout.subtitlesEditorRightPanelWidth
		}
		min={PROJECT_EDITOR_PANEL_WIDTHS.subtitlesRight.min}
		max={PROJECT_EDITOR_PANEL_WIDTHS.subtitlesRight.max}
		reverse
		dataTestId="subtitles-right-panel-resizer"
	/>
	<section
		class="flex-shrink-0 divide-y-2 divide-color max-h-full overflow-hidden flex flex-col border border-color rounded-lg border-l-0 relative"
		style={`width: ${globalState.settings!.persistentUiState.projectEditorLayout.subtitlesEditorRightPanelWidth}px;`}
	>
		<VideoPreview showControls={false} />

		<button
			class="flex items-center justify-center w-8 h-8 text-[var(--text-on-hover)] bg-accent/20 hover:bg-accent rounded-full transition-colors cursor-pointer duration-200 absolute top-2 right-2 z-20 border-2 border-color"
			onclick={() => {
				globalState.getVideoPreviewState.togglePlayPause();
			}}
		>
			<span class="material-icons text-xl pt-0.25">
				{globalState.getVideoPreviewState.isPlaying ? 'pause' : 'play_arrow'}
			</span>
		</button>

		<div class="flex-1 min-h-0 overflow-hidden z-15">
			<SubtitlesList />
		</div>
	</section>
</div>

<style>
</style>
