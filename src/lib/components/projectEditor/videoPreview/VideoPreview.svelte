<script lang="ts">
	import VideoPreviewWorkspace from './VideoPreviewWorkspace.svelte';

	let {
		showControls = false,
		useSplitHeight = true
	}: {
		showControls?: boolean;
		useSplitHeight?: boolean;
	} = $props();
	let workspace: VideoPreviewWorkspace | undefined;

	/** Bascule la lecture depuis la façade publique de la preview. */
	export function togglePlayPause(): void {
		workspace?.togglePlayPause();
	}
</script>

<VideoPreviewWorkspace bind:this={workspace} {showControls} {useSplitHeight} />
