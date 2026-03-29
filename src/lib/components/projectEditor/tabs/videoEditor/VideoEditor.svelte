	<script lang="ts">
	import Timeline from '../../timeline/Timeline.svelte';
	import VideoPreview from '../../videoPreview/VideoPreview.svelte';
	import DiviseurRedimensionnable from '../DiviseurRedimensionnable.svelte';
	import AssetsManager from './assetsManager/AssetsManager.svelte';
</script>

<div class="flex-grow w-full max-w-full flex overflow-hidden h-full min-h-0">
	<!-- Assets -->
	<section
		class="w-[300px] flex-shrink-0 divide-y-2 divide-color max-h-full overflow-hidden flex flex-col"
	>
		<AssetsManager />
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
	<!-- Settings -->
	<!-- <section
		class="w-[250px] flex-shrink-0 divide-y-2 divide-color max-h-full overflow-hidden flex flex-col border-l-2 border-color border-t-2"
	>
		<AssetsManager />
	</section> -->
</div>

<style>
</style>
