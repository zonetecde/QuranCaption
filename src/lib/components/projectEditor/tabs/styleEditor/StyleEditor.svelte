<script lang="ts">
	import { onMount } from 'svelte';
	import Timeline from '../../timeline/Timeline.svelte';
	import VideoPreview from '../../videoPreview/VideoPreview.svelte';
	import DiviseurRedimensionnable from '../DiviseurRedimensionnable.svelte';
	import StyleEditorSettings from './StyleEditorSettings.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { TrackType } from '$lib/classes';
	import { PROJECT_EDITOR_STYLE_SECTION_HEIGHTS } from '$lib/constants/projectEditor';
	import { getTimelineCustomClips } from '../../timeline/track/timelineCustomClip';

	/** Ouverture de la librairie de presets (état géré dans globalState). */
	let presetLibraryOpen = $derived(globalState.presetLibrary.libraryOpen);
	let searchFocused = $state(false);
	let expandedViewportHeight = 0;
	let visibleStyleTrackTypes = $derived([
		TrackType.Subtitle,
		...(getTimelineCustomClips().some((clip) => !clip.getAlwaysShow())
			? [TrackType.CustomClip]
			: [])
	]);
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
	 * Compacte les zones visuelles tant que le clavier de recherche est ouvert.
	 * @param {boolean} focused Indique si la recherche possède le focus.
	 * @returns {void}
	 */
	function handleSearchFocusChange(focused: boolean): void {
		searchFocused = focused;
	}

	/**
	 * Restaure les zones visuelles quand le clavier Android libère le viewport sans déclencher blur.
	 * @returns {void}
	 */
	function handleViewportResize(): void {
		const viewportHeight = window.visualViewport?.height ?? window.innerHeight;

		if (!searchFocused) {
			expandedViewportHeight = viewportHeight;
		} else if (viewportHeight >= expandedViewportHeight - 1) {
			searchFocused = false;
		}
	}

	/**
	 * Redimensionne le contenu de la preview une fois sa section arrivée à sa hauteur finale.
	 * @param {TransitionEvent} event Événement de fin de transition de la section.
	 * @returns {void}
	 */
	function handlePreviewTransitionEnd(event: TransitionEvent): void {
		if (event.propertyName === 'flex-basis') window.dispatchEvent(new Event('resize'));
	}

	onMount(() => {
		expandedViewportHeight = window.visualViewport?.height ?? window.innerHeight;
		window.visualViewport?.addEventListener('resize', handleViewportResize);

		return () => window.visualViewport?.removeEventListener('resize', handleViewportResize);
	});
</script>

<div class="style-editor-mobile-shell">
	<section
		class="style-editor-preview"
		style={`flex-basis: ${searchFocused ? 12 : previewHeight}%;`}
		ontransitionend={handlePreviewTransitionEnd}
	>
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

	<section
		class="style-editor-timeline"
		style={`flex-basis: ${searchFocused ? 5 : timelineHeight}%;`}
	>
		<Timeline useSplitHeight={false} visibleTrackTypes={visibleStyleTrackTypes} fitTracksToHeight />
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
		<StyleEditorSettings
			{presetLibraryOpen}
			{openPresetLibrary}
			{closePresetLibrary}
			onSearchFocusChange={handleSearchFocusChange}
		/>
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
		transition: flex-basis 160ms ease;
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
		width: calc(100% + 1rem);
		min-width: 0;
		margin-inline: -0.5rem;
	}
</style>
