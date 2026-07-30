<script lang="ts">
	import { getCurrentWebview } from '@tauri-apps/api/webview';
	import { readTextFile } from '@tauri-apps/plugin-fs';
	import { globalState } from '$lib/runes/main.svelte';
	import { mount, onDestroy, onMount } from 'svelte';
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

	let unlistenDrop: (() => void) | null = null;
	let leftDrawerOpen = $state(false);
	let rightDrawerOpen = $state(false);
	let presetPickerOpen = $state(false);
	let lastEditedSubtitleId: number | null = null;
	let leftDrawerElement: HTMLElement | null = $state(null);
	let rightDrawerElement: HTMLElement | null = $state(null);
	let gestureSide: 'left' | 'right' | null = $state(null);
	let gestureStartedOpen = false;
	let gestureDragging = $state(false);
	let gestureStartX = 0;
	let gestureStartY = 0;
	let gestureProgress = $state(0);

	const EDGE_SWIPE_WIDTH_PX = 28;
	const GESTURE_DIRECTION_THRESHOLD_PX = 6;
	const GESTURE_COMMIT_DISTANCE_PX = 48;
	const WORKSPACE_HEIGHT_MIN = 35;
	const WORKSPACE_HEIGHT_MAX = 80;

	let leftDrawerProgress = $derived(
		gestureSide === 'left' ? gestureProgress : leftDrawerOpen ? 1 : 0
	);
	let rightDrawerProgress = $derived(
		gestureSide === 'right' ? gestureProgress : rightDrawerOpen ? 1 : 0
	);
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
	 * Démarre le suivi d'un geste horizontal sur un tiroir.
	 *
	 * @param {'left' | 'right'} side Côté du tiroir manipulé.
	 * @param {PointerEvent} event Événement pointeur initial.
	 * @param {boolean} startedOpen Indique si le tiroir était ouvert au début du geste.
	 * @returns {void}
	 */
	function startDrawerGesture(
		side: 'left' | 'right',
		event: PointerEvent,
		startedOpen: boolean
	): void {
		if (!event.isPrimary || gestureSide) return;
		if (
			startedOpen &&
			event.target instanceof Element &&
			event.target.closest('button, input, select, textarea, a, label, [contenteditable="true"]')
		) {
			return;
		}

		gestureSide = side;
		gestureStartedOpen = startedOpen;
		gestureDragging = false;
		gestureStartX = event.clientX;
		gestureStartY = event.clientY;
		gestureProgress = startedOpen ? 1 : 0;
	}

	/**
	 * Met à jour progressivement la position du tiroir pendant le swipe.
	 *
	 * @param {PointerEvent} event Événement de déplacement du pointeur.
	 * @returns {void}
	 */
	function updateDrawerGesture(event: PointerEvent): void {
		if (!gestureSide) return;

		const deltaX = event.clientX - gestureStartX;
		const deltaY = event.clientY - gestureStartY;
		if (!gestureDragging) {
			if (
				Math.abs(deltaX) < GESTURE_DIRECTION_THRESHOLD_PX &&
				Math.abs(deltaY) < GESTURE_DIRECTION_THRESHOLD_PX
			) {
				return;
			}
			if (Math.abs(deltaY) > Math.abs(deltaX)) {
				cancelDrawerGesture();
				return;
			}
			gestureDragging = true;
		}

		event.preventDefault();
		const drawer = gestureSide === 'left' ? leftDrawerElement : rightDrawerElement;
		const drawerWidth = drawer?.getBoundingClientRect().width || 1;
		const direction = gestureSide === 'left' ? 1 : -1;
		const initialProgress = gestureStartedOpen ? 1 : 0;
		gestureProgress = Math.min(
			1,
			Math.max(0, initialProgress + (deltaX * direction) / drawerWidth)
		);
	}

	/**
	 * Termine le swipe et ouvre ou ferme le tiroir selon la distance parcourue.
	 *
	 * @param {PointerEvent} event Événement de fin du pointeur.
	 * @returns {void}
	 */
	function finishDrawerGesture(event: PointerEvent): void {
		if (!gestureSide) return;

		const side = gestureSide;
		const direction = side === 'left' ? 1 : -1;
		const directedDistance = (event.clientX - gestureStartX) * direction;
		const passedDistance = gestureStartedOpen
			? directedDistance <= -GESTURE_COMMIT_DISTANCE_PX
			: directedDistance >= GESTURE_COMMIT_DISTANCE_PX;
		const shouldOpen = gestureDragging
			? gestureStartedOpen
				? !passedDistance && gestureProgress >= 0.5
				: passedDistance || gestureProgress >= 0.5
			: gestureStartedOpen;

		if (side === 'left') {
			leftDrawerOpen = shouldOpen;
			if (shouldOpen) rightDrawerOpen = false;
		} else {
			rightDrawerOpen = shouldOpen;
			if (shouldOpen) leftDrawerOpen = false;
		}
		resetDrawerGesture();
	}

	/**
	 * Annule le geste courant sans modifier l'état du tiroir.
	 * @returns {void}
	 */
	function cancelDrawerGesture(): void {
		resetDrawerGesture();
	}

	/**
	 * Réinitialise les données temporaires du geste.
	 * @returns {void}
	 */
	function resetDrawerGesture(): void {
		gestureSide = null;
		gestureDragging = false;
		gestureProgress = 0;
	}

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

<svelte:window
	onpointermove={updateDrawerGesture}
	onpointerup={finishDrawerGesture}
	onpointercancel={cancelDrawerGesture}
/>

<div class="subtitles-editor-mobile-shell">
	<div class="playback-engine" aria-hidden="true">
		<VideoPreview showControls={false} useSplitHeight={false} />
	</div>

	<section class="subtitles-editor-toolbar">
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

	<div class="subtitles-editor-content">
		<section
			class="subtitles-editor-workspace"
			style={`flex-basis: ${workspaceHeight}%;`}
		>
			<SubtitlesWorkspace
				useSplitHeight={false}
				showVersePicker={false}
				showPlaybackControls
				onTogglePresetPicker={() => (presetPickerOpen = !presetPickerOpen)}
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

		<section class="subtitles-editor-timeline">
			<Timeline
				useSplitHeight={false}
				visibleTrackTypes={[TrackType.Audio, TrackType.Subtitle]}
				fitTracksToHeight
			/>
			{#if presetPickerOpen}
				<div class="preset-picker-overlay">
					<SubtitlePresetPicker onClose={() => (presetPickerOpen = false)} />
				</div>
			{/if}
		</section>
	</div>

	{#if !leftDrawerOpen && !rightDrawerOpen}
		<div
			class="edge-swipe-zone edge-swipe-zone-left"
			style={`width: ${EDGE_SWIPE_WIDTH_PX}px;`}
			onpointerdown={(event) => startDrawerGesture('left', event, false)}
		></div>
		<div
			class="edge-swipe-zone edge-swipe-zone-right"
			style={`width: ${EDGE_SWIPE_WIDTH_PX}px;`}
			onpointerdown={(event) => startDrawerGesture('right', event, false)}
		></div>
	{/if}

	{#if leftDrawerProgress > 0 || rightDrawerProgress > 0}
		<button
			class="drawer-backdrop"
			type="button"
			aria-label={$LL.common.close()}
			style:opacity={Math.max(leftDrawerProgress, rightDrawerProgress) * 0.45}
			onclick={() => {
				leftDrawerOpen = false;
				rightDrawerOpen = false;
			}}
		></button>
	{/if}

	<aside
		class="mobile-drawer mobile-drawer-left"
		class:open={leftDrawerOpen}
		class:dragging={gestureSide === 'left' && gestureDragging}
		style:transform={`translateX(${(leftDrawerProgress - 1) * 100}%)`}
		bind:this={leftDrawerElement}
		onpointerdown={(event) => startDrawerGesture('left', event, true)}
	>
		<SubtitlesEditorSettings />
	</aside>

	<aside
		class="mobile-drawer mobile-drawer-right"
		class:open={rightDrawerOpen}
		class:dragging={gestureSide === 'right' && gestureDragging}
		style:transform={`translateX(${(1 - rightDrawerProgress) * 100}%)`}
		bind:this={rightDrawerElement}
		onpointerdown={(event) => startDrawerGesture('right', event, true)}
	>
		<div class="h-full min-h-0 overflow-hidden">
			<SubtitlesList autoScrollEnabled={rightDrawerOpen} />
		</div>
	</aside>
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

	.subtitles-editor-workspace {
		flex-grow: 0;
		flex-shrink: 0;
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

	.drawer-backdrop {
		position: absolute;
		inset: 0;
		z-index: 145;
		background: rgb(0 0 0);
	}

	.edge-swipe-zone {
		position: absolute;
		top: 0;
		bottom: 0;
		z-index: 35;
		touch-action: none;
	}

	.edge-swipe-zone-left {
		left: 0;
	}

	.edge-swipe-zone-right {
		right: 0;
	}

	.mobile-drawer {
		position: absolute;
		top: 0;
		bottom: 0;
		z-index: 150;
		width: min(88vw, 360px);
		overflow: hidden;
		pointer-events: none;
		touch-action: pan-y;
		background: var(--bg-secondary);
		box-shadow: 0 0 24px rgb(0 0 0 / 45%);
		transition: transform 0.2s ease;
	}

	.mobile-drawer-left {
		left: 0;
	}

	.mobile-drawer-right {
		right: 0;
	}

	.mobile-drawer.open {
		pointer-events: auto;
	}

	.mobile-drawer.dragging {
		pointer-events: auto;
		transition: none;
	}

	.mobile-drawer :global(*) {
		touch-action: pan-y;
	}

	@media (orientation: landscape) {
		.subtitles-editor-mobile-shell {
			gap: 0.4rem;
			padding: 0.4rem;
		}
	}
</style>
