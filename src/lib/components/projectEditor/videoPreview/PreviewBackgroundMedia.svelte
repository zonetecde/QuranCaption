<script lang="ts">
	import type { Asset } from '$lib/classes';
	import { convertFileSrc } from '@tauri-apps/api/core';

	let {
		videoElement = $bindable(null),
		enabled = true,
		crossOrigin,
		video,
		image,
		loop,
		style,
		zoom = 1,
		opacity,
		showCrossfadeNotice,
		crossfadeNotice,
		onVideoEnded
	}: {
		videoElement?: HTMLVideoElement | null;
		enabled?: boolean;
		crossOrigin?: 'anonymous';
		video: Asset | null | undefined;
		image: Asset | null | undefined;
		loop: boolean;
		style: string;
		zoom?: number;
		opacity: number;
		showCrossfadeNotice: boolean;
		crossfadeNotice: string;
		onVideoEnded: () => void;
	} = $props();

	$effect(() => {
		const video = videoElement;
		/** Libère le décodeur lorsque la vidéo quitte l'aperçu. @returns {void} */
		return () => {
			if (!video) return;
			video.pause();
			video.removeAttribute('src');
			video.load();
		};
	});
</script>

{#if enabled && video}
	<video
		bind:this={videoElement}
		crossorigin={crossOrigin}
		src={`${convertFileSrc(video.filePath)}?v=${video.mediaReloadToken}`}
		muted
		{loop}
		onended={onVideoEnded}
		style={`${style} opacity: ${opacity};`}
	></video>
{:else if enabled && image}
	<div style={`position: absolute; inset: 0; overflow: hidden; transform: scale(${zoom});`}>
		<img
			src={`${convertFileSrc(image.filePath)}?v=${image.mediaReloadToken}`}
			style={`${style} opacity: ${opacity};`}
			alt=""
		/>
	</div>
{/if}
{#if enabled && (video || image) && showCrossfadeNotice}
	<div class="crossfade-preview-notice">{crossfadeNotice}</div>
{/if}

<style>
	video {
		height: 100% !important;
		width: 100% !important;
		min-height: 0 !important;
		display: block;
	}
	.crossfade-preview-notice {
		position: absolute;
		left: 50%;
		bottom: 18px;
		z-index: 20;
		max-width: min(90%, 720px);
		transform: translateX(-50%);
		border-radius: 4px;
		background: rgba(0, 0, 0, 0.82);
		color: #ffffff;
		padding: 7px 12px;
		text-align: center;
		font-size: 20px;
		line-height: 1.35;
	}
</style>
