<script lang="ts">
	import Timeline from '../../timeline/Timeline.svelte';
	import VideoPreview from '../../videoPreview/VideoPreview.svelte';
	import DiviseurRedimensionnable from '../DiviseurRedimensionnable.svelte';
	import ExportSettings from './ExportSettings.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import {
		PROJECT_EDITOR_PANEL_WIDTHS,
		PROJECT_EDITOR_TIMELINE_HEIGHT
	} from '$lib/constants/projectEditor';
</script>

<div class="flex-grow w-full max-w-full flex overflow-hidden h-full min-h-0">
	<section
		class="flex-shrink-0 divide-y-2 divide-color max-h-full overflow-hidden flex flex-col"
		style={`width: ${globalState.settings!.persistentUiState.projectEditorLayout.exportPanelWidth}px;`}
	>
		<ExportSettings />
	</section>
	<DiviseurRedimensionnable
		orientation="vertical"
		bind:value={globalState.settings!.persistentUiState.projectEditorLayout.exportPanelWidth}
		min={PROJECT_EDITOR_PANEL_WIDTHS.export.min}
		max={PROJECT_EDITOR_PANEL_WIDTHS.export.max}
		dataTestId="export-panel-resizer"
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
</div>

<style>
</style>
