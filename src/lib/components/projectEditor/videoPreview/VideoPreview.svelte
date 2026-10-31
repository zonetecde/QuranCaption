<script lang="ts">
	import VideoPreviewWorkspace from './VideoPreviewWorkspace.svelte';

	let { showControls = false }: { showControls?: boolean } = $props();
	let workspace: VideoPreviewWorkspace | undefined;

	/** Bascule la lecture depuis la façade publique de la preview. */
	export function togglePlayPause(): void {
		workspace?.togglePlayPause();
	}

	/**
	 * Attend le fond courant pour l'export d'images.
	 * @returns {Promise<void>} Promesse résolue lorsque le fond est prêt.
	 */
	export async function waitForBackgroundMedia(): Promise<void> {
		await workspace?.waitForBackgroundMedia();
	}
</script>

<VideoPreviewWorkspace bind:this={workspace} {showControls} />
