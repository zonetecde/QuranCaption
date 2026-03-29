	<script lang="ts">
	import Timeline from '../../timeline/Timeline.svelte';
	import VideoPreview from '../../videoPreview/VideoPreview.svelte';
	import DiviseurRedimensionnable from '../DiviseurRedimensionnable.svelte';
	import StyleEditorSettings from './StyleEditorSettings.svelte';
</script>

<div class="flex-grow w-full max-w-full flex overflow-hidden h-full min-h-0">
	<!-- Assets -->
	<section
		class="2xl:w-[350px] w-[300px] flex-shrink-0 divide-y-2 divide-color max-h-full overflow-hidden flex flex-col"
	>
		<StyleEditorSettings />
	</section>
	<section class="flex-1 min-w-0 flex flex-row max-h-full min-h-0">
		<section class="w-full min-w-0 flex flex-col min-h-0">
			<!-- Video preview -->
			<VideoPreview showControls />

			<DiviseurRedimensionnable />

			<!-- Timeline -->
			<Timeline />
		</section>
	</section>
</div>

<style>
</style>
