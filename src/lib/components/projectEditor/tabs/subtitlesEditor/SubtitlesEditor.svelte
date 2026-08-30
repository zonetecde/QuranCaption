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
	import AutoSegmentationModal from './modal/AutoSegmentationModal.svelte';
	import { fade } from 'svelte/transition';

	let unlistenDrop: (() => void) | null = null;
	let subtitleStartMode = $state<'choice' | 'manual'>('choice');
	let autoSegmentationModalVisible = $state(false);
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
		}
	);

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

<div class="flex-grow w-full max-w-full flex flex-col overflow-hidden h-full min-h-0">
	{#if !hasSubtitles && globalState.settings?.persistentUiState.showFirstVideoGuide !== false}
		<section class="subtitle-start-card">
			<div class="subtitle-start-heading">
				<div class="subtitle-start-icon" aria-hidden="true">
					<span class="material-icons-outlined">subtitles</span>
				</div>
				<div>
					<h2>{startCopy.chooseSubtitleMethod()}</h2>
					<p>
						{subtitleStartMode === 'manual'
							? startCopy.manualSubtitleSteps()
							: startCopy.chooseSubtitleMethodDescription()}
					</p>
				</div>
			</div>
			<div class="subtitle-start-actions">
				{#if subtitleStartMode === 'choice'}
					<button
						type="button"
						class="btn-accent"
						onclick={() => (autoSegmentationModalVisible = true)}
					>
						<span class="material-icons-outlined">auto_awesome</span>{startCopy.useAiRecommended()}
					</button>
					<button type="button" class="btn" onclick={() => (subtitleStartMode = 'manual')}>
						<span class="material-icons-outlined">keyboard</span>{startCopy.createManually()}
					</button>
				{:else}
					<button type="button" class="btn" onclick={() => (subtitleStartMode = 'choice')}>
						<span class="material-icons-outlined">arrow_back</span>{$LL.common.back()}
					</button>
				{/if}
				<button
					type="button"
					class="subtitle-example-link"
					onclick={() => (walkthroughOpen = true)}
				>
					<span class="material-icons-outlined">play_circle</span>{startCopy.viewExample()}
				</button>
			</div>
		</section>
	{/if}

	<div class="flex min-h-0 flex-1 overflow-hidden">
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
				<SubtitlesWorkspace showPlaybackControls />

				<DiviseurRedimensionnable
					orientation="horizontal"
					bind:value={
						globalState.settings!.persistentUiState.projectEditorLayout.upperSectionHeight
					}
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
</div>

{#if autoSegmentationModalVisible}
	<div class="modal-wrapper" transition:fade>
		<AutoSegmentationModal close={() => (autoSegmentationModalVisible = false)} />
	</div>
{/if}

{#if walkthroughOpen}
	<div class="modal-wrapper walkthrough-backdrop" transition:fade>
		<section class="walkthrough-dialog" aria-label={$LL.editor.subtitlesEditorWalkthrough()}>
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

<style>
	.subtitle-start-card {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		border-block: 1px solid color-mix(in srgb, var(--accent-primary) 35%, var(--border-color));
		padding: 0.65rem 1rem;
		background: color-mix(in srgb, var(--accent-primary) 8%, var(--bg-secondary));
	}

	.subtitle-start-heading,
	.subtitle-start-actions {
		display: flex;
		align-items: center;
		gap: 0.65rem;
	}
	.subtitle-start-icon {
		display: flex;
		height: 2.35rem;
		width: 2.35rem;
		align-items: center;
		justify-content: center;
		border-radius: 0.7rem;
		background: color-mix(in srgb, var(--accent-primary) 15%, transparent);
		color: var(--accent-primary);
	}
	.subtitle-start-card h2 {
		color: var(--text-primary);
		font-size: 0.8rem;
		font-weight: 700;
	}
	.subtitle-start-card p {
		margin-top: 0.1rem;
		color: var(--text-secondary);
		font-size: 0.67rem;
	}
	.subtitle-start-actions button {
		display: flex;
		min-height: 2.35rem;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		border-radius: 0.55rem;
		padding: 0.4rem 0.75rem;
		font-size: 0.68rem;
		font-weight: 700;
	}
	.subtitle-start-actions .material-icons-outlined {
		font-size: 1rem;
	}
	.subtitle-example-link {
		color: var(--accent-primary);
	}
	.walkthrough-backdrop {
		background: rgb(0 0 0 / 68%);
	}
	.walkthrough-dialog {
		display: flex;
		width: min(52rem, calc(100% - 3rem));
		flex-direction: column;
		gap: 1rem;
		border: 1px solid var(--border-color);
		border-radius: 1rem;
		padding: 1.2rem;
		background: var(--bg-secondary);
		box-shadow: 0 24px 80px rgb(0 0 0 / 45%);
	}
	.walkthrough-dialog header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}
	.walkthrough-dialog h2 {
		color: var(--text-primary);
		font-size: 1rem;
		font-weight: 700;
	}
	.walkthrough-dialog p {
		margin-top: 0.2rem;
		color: var(--text-secondary);
		font-size: 0.75rem;
	}
	.walkthrough-dialog header button {
		display: flex;
		height: 2.25rem;
		width: 2.25rem;
		align-items: center;
		justify-content: center;
		border-radius: 9999px;
		background: var(--bg-primary);
		color: var(--text-primary);
	}
	.walkthrough-dialog iframe {
		width: 100%;
		aspect-ratio: 16 / 9;
		border: 0;
		border-radius: 0.75rem;
	}
</style>
