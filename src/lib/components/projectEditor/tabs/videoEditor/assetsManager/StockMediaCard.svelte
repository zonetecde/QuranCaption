<script lang="ts">
	import type { StockMediaResult } from './stockMediaTypes';
	import { openUrl } from '@tauri-apps/plugin-opener';

	let {
		result,
		onDownload,
		isDownloading = false
	}: {
		result: StockMediaResult;
		onDownload: (result: StockMediaResult) => void;
		isDownloading?: boolean;
	} = $props();

	let isHovering = $state(false);
	let videoEl: HTMLVideoElement | undefined = $state();

	$effect(() => {
		if (!videoEl) return;
		if (isHovering && result.previewVideoUrl) {
			videoEl.currentTime = 0;
			videoEl.play().catch(() => {});
		} else if (!isHovering && videoEl) {
			videoEl.pause();
			videoEl.currentTime = 0;
		}
	});

	/**
	 * Formate une duree en secondes vers un affichage mm:ss ou m:ss.
	 * @param seconds Duree en secondes.
	 * @returns Chaine formatee.
	 */
	function formatDuration(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}
</script>

<button
	class="block w-full text-left rounded-lg border border-color bg-primary/30 overflow-hidden hover:border-[var(--accent-primary)]/50 transition-colors group"
	type="button"
	onclick={() => onDownload(result)}
	disabled={isDownloading}
	onmouseenter={() => (isHovering = true)}
	onmouseleave={() => (isHovering = false)}
>
	<div class="relative aspect-video bg-black overflow-hidden">
		{#if result.previewVideoUrl && isHovering}
			<video
				bind:this={videoEl}
				src={result.previewVideoUrl}
				muted
				loop
				playsinline
				class="w-full h-full object-contain"
			></video>
		{:else}
			<img
				src={result.thumbnailUrl || result.previewUrl}
				alt=""
				class="w-full h-full object-contain"
				loading="lazy"
			/>
		{/if}

		<span
			class="absolute top-1 right-1 bg-black/50 hover:bg-black/80 text-white rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
			onclick={(e: MouseEvent) => {
				e.stopPropagation();
				openUrl(result.pageUrl);
			}}
			title={result.authorName}
		>
			<span class="material-icons text-[12px]">open_in_new</span>
		</span>

		{#if result.type === 'video'}
			<div
				class="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] px-1 py-0.5 rounded flex items-center gap-1"
			>
				<span class="material-icons text-[10px]">videocam</span>
				{#if result.duration}
					<span>{formatDuration(result.duration)}</span>
				{/if}
			</div>
		{/if}

		{#if isDownloading}
			<div class="absolute inset-0 bg-black/50 flex items-center justify-center">
				<span class="material-icons animate-spin text-white text-lg">download</span>
			</div>
		{/if}
	</div>
	<div class="p-1.5 flex items-center justify-between gap-1">
		<p class="text-[10px] text-thirdly truncate min-w-0">
			{result.authorName}
		</p>
		<span class="text-[10px] text-fourthly whitespace-nowrap shrink-0"
			>{result.width}×{result.height}</span
		>
	</div>
</button>
