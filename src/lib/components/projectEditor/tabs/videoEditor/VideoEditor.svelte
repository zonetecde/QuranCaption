<script lang="ts">
	import Timeline from '../../timeline/Timeline.svelte';
	import VideoPreview from '../../videoPreview/VideoPreview.svelte';
	import DiviseurRedimensionnable from '../DiviseurRedimensionnable.svelte';
	import AssetsManager from './assetsManager/AssetsManager.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import {
		PROJECT_EDITOR_PANEL_WIDTHS,
		PROJECT_EDITOR_TIMELINE_HEIGHT
	} from '$lib/constants/projectEditor';

	const VIDEO_PANEL_WIDTHS = PROJECT_EDITOR_PANEL_WIDTHS.video;

	let stockMediaOpen = $derived(globalState.stockMediaLibrary.libraryOpen);
	let videoPanelWidth = $derived(
		globalState.settings?.persistentUiState.projectEditorLayout.videoEditorPanelWidth ??
			VIDEO_PANEL_WIDTHS.default
	);
	let displayedVideoPanelWidth = $derived(
		Math.max(
			stockMediaOpen ? VIDEO_PANEL_WIDTHS.expandedMin : VIDEO_PANEL_WIDTHS.min,
			Math.min(VIDEO_PANEL_WIDTHS.max, videoPanelWidth)
		)
	);
</script>

<div class="flex-grow w-full max-w-full flex overflow-hidden h-full min-h-0">
	<!-- Assets -->
	<section
		class="flex-shrink-0 divide-y-2 divide-color max-h-full overflow-hidden flex flex-col transition-[width] duration-200"
		style={`width: ${displayedVideoPanelWidth}px;`}
	>
		<AssetsManager {stockMediaOpen} />
	</section>
	<DiviseurRedimensionnable
		orientation="vertical"
		bind:value={globalState.settings!.persistentUiState.projectEditorLayout.videoEditorPanelWidth}
		displayedValue={displayedVideoPanelWidth}
		min={stockMediaOpen ? VIDEO_PANEL_WIDTHS.expandedMin : VIDEO_PANEL_WIDTHS.min}
		max={VIDEO_PANEL_WIDTHS.max}
		dataTestId="video-panel-resizer"
	/>
	<section class="flex-1 min-w-0 flex flex-row max-h-full min-h-0">
		<section class="w-full min-w-0 flex flex-col min-h-0">
			<!-- Video preview -->
			<VideoPreview showControls />

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
	<!-- <section
		class="w-[250px] flex-shrink-0 divide-y-2 divide-color max-h-full overflow-hidden flex flex-col border-l-2 border-color border-t-2"
	>
		<AssetsManager />
	</section> -->
</div>

<style>
</style>
