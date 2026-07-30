<script lang="ts">
	import Timeline from '../../timeline/Timeline.svelte';
	import VideoPreview from '../../videoPreview/VideoPreview.svelte';
	import DiviseurRedimensionnable from '../DiviseurRedimensionnable.svelte';
	import ExportSettings from './ExportSettings.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { PROJECT_EDITOR_STYLE_SECTION_HEIGHTS } from '$lib/constants/projectEditor';
	import { TrackType } from '$lib/classes';

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
</script>

<div class="export-mobile-shell">
	<section class="export-preview" style={`flex-basis: ${previewHeight}%;`}>
		<VideoPreview showControls useSplitHeight={false} />
	</section>

	<DiviseurRedimensionnable
		orientation="horizontal"
		bind:value={globalState.settings!.persistentUiState.projectEditorLayout.stylePreviewHeight}
		displayedValue={previewHeight}
		min={PROJECT_EDITOR_STYLE_SECTION_HEIGHTS.preview.min}
		max={PROJECT_EDITOR_STYLE_SECTION_HEIGHTS.preview.max}
		unit="percent"
		dataTestId="export-preview-resizer"
	/>

	<section class="export-timeline" style={`flex-basis: ${timelineHeight}%;`}>
		<Timeline useSplitHeight={false} visibleTrackTypes={[TrackType.Subtitle]} fitTracksToHeight />
	</section>

	<DiviseurRedimensionnable
		orientation="horizontal"
		bind:value={globalState.settings!.persistentUiState.projectEditorLayout.styleTimelineHeight}
		displayedValue={timelineHeight}
		min={PROJECT_EDITOR_STYLE_SECTION_HEIGHTS.timeline.min}
		max={PROJECT_EDITOR_STYLE_SECTION_HEIGHTS.timeline.max}
		unit="percent"
		dataTestId="export-timeline-resizer"
	/>

	<section class="export-settings">
		<ExportSettings />
	</section>
</div>

<style>
	.export-mobile-shell {
		display: flex;
		height: 100%;
		min-height: 0;
		width: 100%;
		flex-direction: column;
		overflow: hidden;
		padding: 0.5rem;
	}

	.export-preview,
	.export-timeline,
	.export-settings {
		display: flex;
		min-height: 0;
		min-width: 0;
		overflow: hidden;
	}

	.export-preview,
	.export-timeline {
		flex-grow: 0;
		flex-shrink: 0;
		border: 1px solid var(--border-color);
		border-radius: 12px;
	}

	.export-preview {
		flex-direction: column;
		background: var(--bg-primary);
	}

	.export-timeline {
		background: var(--timeline-bg-primary);
	}

	.export-settings {
		flex: 1 1 0;
		width: 100%;
	}
</style>
