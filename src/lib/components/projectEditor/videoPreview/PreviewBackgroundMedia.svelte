<script lang="ts">
	import type { Asset } from '$lib/classes';
	import { convertFileSrc } from '@tauri-apps/api/core';

	let {
		videoElement = $bindable(null),
		video,
		image,
		loop,
		style,
		opacity,
		showCrossfadeNotice,
		crossfadeNotice,
		onVideoEnded
	}: {
		videoElement?: HTMLVideoElement | null;
		video: Asset | null | undefined;
		image: Asset | null | undefined;
		loop: boolean;
		style: string;
		opacity: number;
		showCrossfadeNotice: boolean;
		crossfadeNotice: string;
		onVideoEnded: () => void;
	} = $props();
</script>

{#if video}
	<video
		bind:this={videoElement}
		src={`${convertFileSrc(video.filePath)}?v=${video.mediaReloadToken}`}
		muted
		{loop}
		onended={onVideoEnded}
		style={`${style} opacity: ${opacity};`}
	></video>
	{#if showCrossfadeNotice}
		<div class="crossfade-preview-notice">{crossfadeNotice}</div>
	{/if}
{:else if image}
	<img src={`${convertFileSrc(image.filePath)}?v=${image.mediaReloadToken}`} {style} alt="" />
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
