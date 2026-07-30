<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import Timeline from '../../timeline/Timeline.svelte';
	import VideoPreview from '../../videoPreview/VideoPreview.svelte';
	import DiviseurRedimensionnable from '../DiviseurRedimensionnable.svelte';
	import StyleEditorSettings from './StyleEditorSettings.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { ProjectEditorTabs, TrackType } from '$lib/classes';
	import { PROJECT_EDITOR_STYLE_SECTION_HEIGHTS } from '$lib/constants/projectEditor';

	/** Ouverture de la librairie de presets (état géré dans globalState). */
	let presetLibraryOpen = $derived(globalState.presetLibrary.libraryOpen);
	let previewHeight = $derived(
		Math.max(
			PROJECT_EDITOR_STYLE_SECTION_HEIGHTS.preview.min,
			Math.min(
				PROJECT_EDITOR_STYLE_SECTION_HEIGHTS.preview.max,
				globalState.settings!.persistentUiState.projectEditorLayout.stylePreviewHeight
			)
		)
	);
	let timelineHeight = $derived(
		Math.max(
			PROJECT_EDITOR_STYLE_SECTION_HEIGHTS.timeline.min,
			Math.min(
				PROJECT_EDITOR_STYLE_SECTION_HEIGHTS.timeline.max,
				globalState.settings!.persistentUiState.projectEditorLayout.styleTimelineHeight
			)
		)
	);

	/** Ouvre la librairie de presets. */
	function openPresetLibrary() {
		globalState.presetLibrary.libraryOpen = true;
	}

	/** Ferme la librairie de presets. */
	function closePresetLibrary() {
		globalState.presetLibrary.libraryOpen = false;
	}

	/**
	 * Handle the keyboard shortcut for selecting all subtitles.
	 * @param event The keyboard event
	 */
	function handleSelectAllSubtitlesShortcut(event: KeyboardEvent) {
		if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a') return;
		if (globalState.currentProject?.projectEditorState.currentTab !== ProjectEditorTabs.Style)
			return;

		// Vérifie qu'on ne cible pas un champ de saisie
		const target = event.target;
		if (
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLSelectElement ||
			(target instanceof HTMLElement && target.isContentEditable)
		) {
			return;
		}

		event.preventDefault();
		globalState.getStylesState.selectAllSubtitles();
	}

	onMount(() => {
		document.addEventListener('keydown', handleSelectAllSubtitlesShortcut, true);
	});

	onDestroy(() => {
		document.removeEventListener('keydown', handleSelectAllSubtitlesShortcut, true);
	});
</script>

<div class="style-editor-mobile-shell">
	<section class="style-editor-preview" style={`flex-basis: ${previewHeight}%;`}>
		<VideoPreview showControls useSplitHeight={false} />
	</section>

	<DiviseurRedimensionnable
		orientation="horizontal"
		bind:value={globalState.settings!.persistentUiState.projectEditorLayout.stylePreviewHeight}
		displayedValue={previewHeight}
		min={PROJECT_EDITOR_STYLE_SECTION_HEIGHTS.preview.min}
		max={PROJECT_EDITOR_STYLE_SECTION_HEIGHTS.preview.max}
		unit="percent"
		dataTestId="style-preview-resizer"
	/>

	<section class="style-editor-timeline" style={`flex-basis: ${timelineHeight}%;`}>
		<Timeline useSplitHeight={false} visibleTrackTypes={[TrackType.Subtitle]} fitTracksToHeight />
	</section>

	<DiviseurRedimensionnable
		orientation="horizontal"
		bind:value={globalState.settings!.persistentUiState.projectEditorLayout.styleTimelineHeight}
		displayedValue={timelineHeight}
		min={PROJECT_EDITOR_STYLE_SECTION_HEIGHTS.timeline.min}
		max={PROJECT_EDITOR_STYLE_SECTION_HEIGHTS.timeline.max}
		unit="percent"
		dataTestId="style-timeline-resizer"
	/>

	<section class="style-editor-settings">
		<StyleEditorSettings {presetLibraryOpen} {openPresetLibrary} {closePresetLibrary} />
	</section>
</div>

<style>
	.style-editor-mobile-shell {
		display: flex;
		height: 100%;
		min-height: 0;
		width: 100%;
		flex-direction: column;
		overflow: hidden;
		padding: 0.5rem;
	}

	.style-editor-preview,
	.style-editor-timeline,
	.style-editor-settings {
		display: flex;
		min-height: 0;
		overflow: hidden;
	}

	.style-editor-preview,
	.style-editor-timeline {
		flex-grow: 0;
		flex-shrink: 0;
		border: 1px solid var(--border-color);
		border-radius: 12px;
	}

	.style-editor-preview {
		flex-direction: column;
		background: var(--bg-primary);
	}

	.style-editor-timeline {
		background: var(--timeline-bg-primary);
	}

	.style-editor-settings {
		flex: 1 1 0;
	}
</style>
