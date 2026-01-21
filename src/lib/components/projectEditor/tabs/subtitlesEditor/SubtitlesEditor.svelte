<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import Timeline from '../../timeline/Timeline.svelte';
	import VideoPreview from '../../videoPreview/VideoPreview.svelte';
	import DiviseurRedimensionnable from '../DiviseurRedimensionnable.svelte';
	import SubtitlesEditorSettings from './SubtitlesEditorSettings.svelte';
	import SubtitlesList from './SubtitlesList.svelte';
	import SubtitlesWorkspace from './SubtitlesWorkspace.svelte';
</script>

<div class="flex-grow w-full max-w-full flex overflow-hidden h-full min-h-0">
	<!-- Assets -->
	<section
		class="w-[225px] 2xl:w-[300px] flex-shrink-0 divide-y-2 divide-color max-h-full overflow-hidden flex flex-col"
	>
		<SubtitlesEditorSettings />
	</section>
	<section class="flex-1 min-w-0 flex flex-row max-h-full min-h-0">
		<section class="w-full min-w-0 flex flex-col min-h-0">
			<!-- Video preview -->
			<SubtitlesWorkspace />

			<DiviseurRedimensionnable />

			<!-- Timeline -->
			<Timeline />
		</section>
	</section>
	<!-- Settings -->
	<section
		class="w-[200px] 2xl:w-[300px] flex-shrink-0 divide-y-2 divide-color max-h-full overflow-hidden flex flex-col border border-color rounded-lg border-l-0 relative"
	>
		<VideoPreview showControls={false} />

		<button
			class="flex items-center justify-center w-8 h-8 text-[var(--text-on-hover)] bg-accent/20 hover:bg-accent rounded-full transition-colors cursor-pointer duration-200 absolute top-2 right-2 z-20 border-2 border-color"
			onclick={() => {
				globalState.getVideoPreviewState.togglePlayPause();
			}}
		>
			<span class="material-icons text-xl pt-0.25">
				{globalState.getVideoPreviewState.isPlaying ? 'pause' : 'play_arrow'}
			</span>
		</button>

		<div class="flex-1 min-h-0 overflow-hidden z-15">
			<SubtitlesList />
		</div>
	</section>
</div>

<style>
</style>
