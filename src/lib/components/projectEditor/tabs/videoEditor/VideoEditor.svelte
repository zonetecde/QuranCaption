<script lang="ts">
	import Timeline from '../../timeline/Timeline.svelte';
	import VideoPreview from '../../videoPreview/VideoPreview.svelte';
	import DiviseurRedimensionnable from '../DiviseurRedimensionnable.svelte';
	import AssetsManager from './assetsManager/AssetsManager.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { TrackType } from '$lib/classes';
	import { get } from 'svelte/store';
	import {
		PROJECT_EDITOR_STYLE_SECTION_HEIGHTS,
		PROJECT_EDITOR_VIDEO_TIMELINE_HEIGHT
	} from '$lib/constants/projectEditor';

	let stockMediaOpen = $derived(globalState.stockMediaLibrary.libraryOpen);
	let assetImporterOpen = $state(false);
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
			PROJECT_EDITOR_VIDEO_TIMELINE_HEIGHT.min,
			Math.min(
				PROJECT_EDITOR_VIDEO_TIMELINE_HEIGHT.max,
				globalState.settings!.persistentUiState.projectEditorLayout.styleTimelineHeight
			)
		)
	);
</script>

<div class="video-editor-mobile-shell">
	<section class="video-editor-preview-shell" style={`flex-basis: ${previewHeight}%;`}>
		<VideoPreview showControls useSplitHeight={false} />
	</section>

	<DiviseurRedimensionnable
		orientation="horizontal"
		bind:value={globalState.settings!.persistentUiState.projectEditorLayout.stylePreviewHeight}
		displayedValue={previewHeight}
		min={PROJECT_EDITOR_STYLE_SECTION_HEIGHTS.preview.min}
		max={PROJECT_EDITOR_STYLE_SECTION_HEIGHTS.preview.max}
		unit="percent"
		dataTestId="video-preview-resizer"
	/>

	<section class="video-editor-timeline-shell" style={`flex-basis: ${timelineHeight}%;`}>
		<Timeline
			useSplitHeight={false}
			visibleTrackTypes={[TrackType.Video, TrackType.Audio]}
			fitTracksToHeight
		/>
	</section>

	<DiviseurRedimensionnable
		orientation="horizontal"
		bind:value={globalState.settings!.persistentUiState.projectEditorLayout.styleTimelineHeight}
		displayedValue={timelineHeight}
		min={PROJECT_EDITOR_VIDEO_TIMELINE_HEIGHT.min}
		max={PROJECT_EDITOR_VIDEO_TIMELINE_HEIGHT.max}
		unit="percent"
		dataTestId="video-timeline-resizer"
	/>

	<section class="video-editor-assets-tray" data-tour-id="assets-manager">
		<div class="video-editor-assets-header">
			<span class="video-editor-assets-header-title">
				<span class="material-icons text-[20px]">video_library</span>
				<span>{get(LL).editor.assets()}</span>
			</span>
			<button
				class="video-editor-assets-add"
				type="button"
				onclick={() => (assetImporterOpen = true)}
				aria-label={get(LL).editor.addAssetLabel()}
			>
				<span class="material-icons text-[18px]">add</span>
				<span>{get(LL).editor.addAssetLabel()}</span>
			</button>
		</div>

		<section class="video-editor-assets-content">
			<AssetsManager
				{stockMediaOpen}
				showHeader={false}
				embedded
				importOpen={assetImporterOpen}
				onCloseImport={() => (assetImporterOpen = false)}
			/>
		</section>
	</section>
</div>

<style>
	.video-editor-mobile-shell {
		display: flex;
		height: 100%;
		min-height: 0;
		width: 100%;
		flex-direction: column;
		padding: 0.5rem;
		overflow: hidden;
	}

	.video-editor-preview-shell,
	.video-editor-timeline-shell {
		display: flex;
		min-height: 0;
		overflow: hidden;
		border: 1px solid var(--border-color);
		border-radius: 12px;
	}

	.video-editor-preview-shell {
		flex-grow: 0;
		flex-shrink: 0;
		flex-direction: column;
		background: var(--bg-primary);
	}

	.video-editor-timeline-shell {
		flex-grow: 0;
		flex-shrink: 0;
		background: var(--timeline-bg-primary);
	}

	.video-editor-assets-tray {
		display: flex;
		flex: 1 1 0;
		min-height: 0;
		width: calc(100% + 1rem);
		flex-direction: column;
		overflow: hidden;
		margin-inline: -0.5rem;
		background: var(--bg-secondary);
	}

	.video-editor-assets-header {
		display: flex;
		min-height: 40px;
		width: 100%;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		border-bottom: 1px solid var(--border-color);
		padding: 0.45rem 0.8rem;
		color: var(--text-primary);
	}

	.video-editor-assets-header-title {
		display: inline-flex;
		min-width: 0;
		align-items: center;
		gap: 0.625rem;
		font-size: 0.8rem;
		font-weight: 600;
	}

	.video-editor-assets-add {
		display: inline-flex;
		height: 2rem;
		flex: 0 0 auto;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		border: 1px solid color-mix(in srgb, var(--accent-primary) 55%, var(--border-color));
		border-radius: 9999px;
		padding: 0 0.7rem 0 0.5rem;
		background: color-mix(in srgb, var(--accent-primary) 14%, var(--bg-secondary));
		color: var(--accent-primary);
		font-size: 0.7rem;
		font-weight: 700;
	}

	.video-editor-assets-content {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: 0.75rem;
	}

	@media (orientation: landscape) {
		.video-editor-mobile-shell {
			padding: 0.4rem;
		}

		.video-editor-assets-tray {
			width: calc(100% + 0.8rem);
			margin-inline: -0.4rem;
		}
	}
</style>
