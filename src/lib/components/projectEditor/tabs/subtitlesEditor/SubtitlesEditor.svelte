<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import Timeline from '../../timeline/Timeline.svelte';
	import VideoPreview from '../../videoPreview/VideoPreview.svelte';
	import DiviseurRedimensionnable from '../DiviseurRedimensionnable.svelte';
	import SubtitlesEditorSettings from './SubtitlesEditorSettings.svelte';
	import SubtitlesList from './SubtitlesList.svelte';
	import SubtitlesWorkspace from './SubtitlesWorkspace.svelte';
	import {
		PROJECT_EDITOR_PANEL_WIDTHS,
		PROJECT_EDITOR_SUBTITLES_PREVIEW_HEIGHT,
		PROJECT_EDITOR_TIMELINE_HEIGHT
	} from '$lib/constants/projectEditor';
</script>

<div class="flex-grow w-full max-w-full flex overflow-hidden h-full min-h-0">
	<!-- Assets -->
	<section
		class="flex-shrink-0 divide-y-2 divide-color h-full min-h-0 max-h-full overflow-hidden flex flex-col"
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
		class="flex-shrink-0 h-full min-h-0 max-h-full overflow-hidden flex flex-col border border-color rounded-lg border-s-0 relative"
		style={`width: ${globalState.settings!.persistentUiState.projectEditorLayout.subtitlesEditorRightPanelWidth}px;`}
	>
		<div
			class="subtitles-preview relative shrink-0 overflow-hidden"
			style={`height: ${globalState.settings!.persistentUiState.projectEditorLayout.subtitlesEditorPreviewHeight}%;`}
		>
			<VideoPreview showControls={false} />

			<button
				class="flex items-center justify-center w-8 h-8 text-[var(--text-on-hover)] bg-accent/20 hover:bg-accent rounded-full transition-colors cursor-pointer duration-200 absolute top-2 end-2 z-20 border-2 border-color"
				onclick={() => {
					globalState.getVideoPreviewState.togglePlayPause();
				}}
			>
				<span class="material-icons text-xl pt-0.25">
					{globalState.getVideoPreviewState.isPlaying ? 'pause' : 'play_arrow'}
				</span>
			</button>
		</div>

		<DiviseurRedimensionnable
			orientation="horizontal"
			bind:value={
				globalState.settings!.persistentUiState.projectEditorLayout.subtitlesEditorPreviewHeight
			}
			min={PROJECT_EDITOR_SUBTITLES_PREVIEW_HEIGHT.min}
			max={PROJECT_EDITOR_SUBTITLES_PREVIEW_HEIGHT.max}
			unit="percent"
			dataTestId="subtitles-preview-resizer"
		/>

		<div class="flex-1 min-h-0 overflow-hidden z-15">
			<SubtitlesList />
		</div>
	</section>
</div>

<style>
	:global(.subtitles-preview > #video-preview-section) {
		height: 100%;
	}
</style>
