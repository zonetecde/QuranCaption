<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { Asset, AssetClip } from '$lib/classes';
	import { invoke } from '@tauri-apps/api/core';
	import { exists } from '@tauri-apps/plugin-fs';
	import toast from 'svelte-5-french-toast';

	interface Props {
		close: () => void;
	}

	let { close }: Props = $props();

	let isProcessing = $state(false);

	let audioTrack = $derived(globalState.getAudioTrack);
	let audioClips = $derived(audioTrack?.clips || []);
	
	let assetsToMerge = $derived(audioClips.map(clip => {
		if (clip instanceof AssetClip) {
			return globalState.currentProject?.content.getAssetById(clip.assetId);
		}
		return null;
	}).filter(Boolean) as Asset[]);

	let totalDurationMs = $derived(assetsToMerge.reduce((acc, asset) => acc + asset.duration.ms, 0));

	async function getUniqueMergePath(baseDir: string): Promise<string> {
		let counter = 1;
		let fileName = `Merged_Audio_${counter}.mp3`;
		let newPath = `${baseDir}/${fileName}`;
		
		while (await exists(newPath)) {
			counter++;
			fileName = `Merged_Audio_${counter}.mp3`;
			newPath = `${baseDir}/${fileName}`;
		}
		
		return newPath;
	}

	async function handleProcess() {
		if (assetsToMerge.length < 2) {
			toast.error('At least two audio clips are required to merge.');
			return;
		}

		isProcessing = true;
		try {
			// Get base directory from the first asset
			const firstAssetPath = assetsToMerge[0].filePath;
			const lastSlash = Math.max(firstAssetPath.lastIndexOf('/'), firstAssetPath.lastIndexOf('\\'));
			const baseDir = firstAssetPath.substring(0, lastSlash);
			
			const outputPath = await getUniqueMergePath(baseDir);
			const sourcePaths = assetsToMerge.map(a => a.filePath);
			
			await invoke('concat_audio', {
				sourcePaths,
				outputPath
			});

			// Add new asset to project
			const newAsset = new Asset(outputPath);
			globalState.currentProject?.content.assets.push(newAsset);

			toast.success('Audio merged successfully!');
			setTimeout(() => {
				close();
			}, 500);
		} catch (error) {
			console.error(error);
			toast.error('Failed to merge audio: ' + error);
		} finally {
			isProcessing = false;
		}
	}
</script>

<div class="bg-secondary w-[500px] rounded-xl shadow-2xl overflow-hidden border border-color animate-in fade-in zoom-in duration-200">
	<!-- Header -->
	<div class="bg-gradient-to-r from-accent-primary/20 to-accent-secondary/20 p-6 border-b border-color relative">
		<div class="flex items-center gap-4">
			<div class="bg-accent-primary/20 p-3 rounded-xl">
				<span class="material-icons text-accent-primary text-3xl">library_music</span>
			</div>
			<div>
				<h2 class="text-2xl font-bold text-primary tracking-tight">Audio Merge</h2>
				<p class="text-secondary text-sm">Combine all timeline audio clips into one file</p>
			</div>
		</div>
		<button class="absolute top-4 right-4 text-thirdly hover:text-primary transition-colors cursor-pointer" onclick={close}>
			<span class="material-icons">close</span>
		</button>
	</div>

	<!-- Body -->
	<div class="p-8 space-y-6">
		<div class="space-y-4">
			<div class="flex justify-between items-center p-4 bg-accent/30 rounded-xl border border-color">
				<div class="flex items-center gap-3">
					<span class="material-icons text-accent-primary">queue_music</span>
					<span class="text-secondary font-semibold">Clips to merge</span>
				</div>
				<span class="text-primary font-bold text-lg">{assetsToMerge.length}</span>
			</div>

			<div class="flex justify-between items-center p-4 bg-accent/30 rounded-xl border border-color">
				<div class="flex items-center gap-3">
					<span class="material-icons text-accent-primary">timer</span>
					<span class="text-secondary font-semibold">Total duration</span>
				</div>
				<span class="text-primary font-mono text-lg">{ (totalDurationMs / 1000).toFixed(2) }s</span>
			</div>
		</div>

		{#if assetsToMerge.length < 2}
			<div class="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-start gap-3">
				<span class="material-icons text-red-500 text-sm mt-0.5">warning</span>
				<p class="text-xs text-red-500/90 leading-relaxed">
					You need at least two audio clips on the timeline to perform a merge.
				</p>
			</div>
		{:else}
			<div class="bg-accent/50 rounded-lg p-4 border border-color/50 flex items-start gap-3">
				<span class="material-icons text-thirdly text-sm mt-0.5">info</span>
				<p class="text-xs text-secondary leading-relaxed">
					All audio clips currently on your timeline will be merged in their order. 
					The result will be saved as a new MP3 asset in your library.
				</p>
			</div>
		{/if}
	</div>

	<!-- Footer -->
	<div class="bg-accent/30 p-6 flex justify-end items-center gap-4 border-t border-color">
		<button 
			class="btn px-6 py-2.5 text-sm font-medium hover:bg-accent transition-colors"
			onclick={close}
			disabled={isProcessing}
		>
			Cancel
		</button>
		<button 
			class="btn-accent px-8 py-2.5 text-sm font-bold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-accent-primary/20"
			onclick={handleProcess}
			disabled={isProcessing || assetsToMerge.length < 2}
		>
			{#if isProcessing}
				<span class="material-icons animate-spin text-base">sync</span>
				Merging...
			{:else}
				<span class="material-icons text-base">merge</span>
				Merge Audio
			{/if}
		</button>
	</div>
</div>
