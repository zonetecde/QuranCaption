<script lang="ts">
	import { AssetType, TrackType, type AssetClip, type Clip, type Track } from '$lib/classes';
	import { globalState } from '$lib/runes/main.svelte';
	import { convertFileSrc, invoke } from '@tauri-apps/api/core';
	import { onDestroy, onMount, untrack } from 'svelte';
	import { fade, slide } from 'svelte/transition';
	import WaveSurfer from 'wavesurfer.js';
	import ContextMenu, { Item, Divider, Settings } from 'svelte-contextmenu';
	import { currentMenu } from 'svelte-contextmenu/stores';

	let {
		clip = $bindable(),
		track = $bindable()
	}: {
		clip: Clip;
		track: Track;
	} = $props();

	onDestroy(() => {
		currentMenu.set(null);
	});

	let contextMenu: ContextMenu | undefined = $state(undefined); // Initialize context menu state

	let positionLeft = $derived(() => {
		return (clip.startTime / 1000) * track.getPixelPerSecond();
	});

	let asset = globalState.currentProject?.content.getAssetById((clip as AssetClip).assetId)!;
	let file = $state(convertFileSrc(asset.filePath));
	let showWaveform = $state(false);

	$effect(() => {
		if (
			(asset.duration.ms < 45 * 60 * 1000 || showWaveform) &&
			globalState.settings?.persistentUiState.showWaveforms &&
			track.type === TrackType.Audio
		) {
			untrack(async () => {
				try {
					const peaks = await invoke<number[]>('get_audio_waveform', {
						filePath: asset.filePath
					});

					const wavesurfer = WaveSurfer.create({
						container: '#clip-' + clip.id,
						waveColor: '#9d99cc',
						progressColor: '#9d99cc',
						url: file,
						peaks: [peaks], // Pass peaks to avoid decoding
						duration: asset.duration.ms / 1000,
						height: 'auto'
					});
				} catch (e) {
					console.error('Failed to load waveform:', e);
					// Fallback to normal loading if backend fails
					const wavesurfer = WaveSurfer.create({
						container: '#clip-' + clip.id,
						waveColor: '#9d99cc',
						progressColor: '#9d99cc',
						url: file,
						height: 'auto'
					});
				}
			});
		}
	});

	function removeClip() {
		setTimeout(() => {
			track.removeClip(clip.id);
		});
	}
</script>

<div
	class={'absolute inset-0 z-10 border rounded-md group ' +
		(track.type === TrackType.Audio
			? 'border-[var(--timeline-audio-clip-border)] bg-[var(--timeline-audio-clip-color)]'
			: 'border-[var(--timeline-video-clip-border)] bg-[var(--timeline-video-clip-color)]')}
	style="width: {clip.getWidth()}px; left: {positionLeft()}px;"
	transition:slide={{ duration: 500, axis: 'x' }}
	oncontextmenu={(e) => {
		e.preventDefault();
		contextMenu!.show(e);
	}}
>
	{#if (asset.duration.ms < 45 * 60 * 1000 || showWaveform) && globalState.settings?.persistentUiState.showWaveforms && track.type === TrackType.Audio}
		<div class="h-full w-full" id={'clip-' + clip.id}></div>
	{:else if asset.duration.ms >= 45 * 60 * 1000 && globalState.settings?.persistentUiState.showWaveforms && track.type === TrackType.Audio}
		<div class="h-full w-full" onclick={() => (showWaveform = true)}>
			Click to generate waveform (disabled by default for long audio to save memory)
		</div>
	{:else}
		<div class="absolute inset-0 z-5 flex overflow-hidden px-2 py-2">
			<span class="text-xs text-[var(--text-secondary)] font-medium">{asset.fileName}</span>
		</div>
	{/if}

	<section class="absolute bottom-0.5 left-0.5 z-5">
		<!-- delete clip -->
		<button
			class="text-[var(--text-secondary)] text-sm cursor-pointer opacity-0 group-hover:opacity-100"
			onclick={removeClip}
		>
			<span class="material-icons">delete</span>
		</button>
	</section>
</div>

<ContextMenu bind:this={contextMenu}>
	<Item on:click={removeClip}
		><div class="btn-icon">
			<span class="material-icons-outlined text-sm mr-1">remove</span>Remove clip
		</div></Item
	>
</ContextMenu>
