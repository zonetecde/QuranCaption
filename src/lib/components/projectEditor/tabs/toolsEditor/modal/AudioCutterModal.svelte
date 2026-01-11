<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { Asset } from '$lib/classes';
	import { AssetType } from '$lib/classes/enums';
	import { invoke } from '@tauri-apps/api/core';
	import { exists } from '@tauri-apps/plugin-fs';
	import toast from 'svelte-5-french-toast';

	interface Props {
		close: () => void;
	}

	let { close }: Props = $props();

	let selectedAssetId = $state(0);
	let startMin = $state(0);
	let startSec = $state(0);
	let startMs = $state(0);
	let endMin = $state(0);
	let endSec = $state(0);
	let endMs = $state(0);

	let isProcessing = $state(false);

	let audioAssets = $derived(
		globalState.currentProject?.content.assets.filter((a) => a.type === AssetType.Audio) || []
	);

	let selectedAsset = $derived(audioAssets.find((a) => a.id === selectedAssetId));

	// Initialize times when asset changes
	$effect(() => {
		if (selectedAsset && selectedAssetId !== 0) {
			const totalMs = selectedAsset.duration.ms;
			endMin = Math.floor(totalMs / 60000);
			endSec = Math.floor((totalMs % 60000) / 1000);
			endMs = Math.floor(totalMs % 1000);
		}
	});

	async function getUniqueFilePath(originalPath: string): Promise<string> {
		const lastDot = originalPath.lastIndexOf('.');
		const base = originalPath.substring(0, lastDot);
		const ext = originalPath.substring(lastDot);
		
		let counter = 1;
		let newPath = `${base}_cut_${counter}${ext}`;
		
		while (await exists(newPath)) {
			counter++;
			newPath = `${base}_cut_${counter}${ext}`;
		}
		
		return newPath;
	}

	async function handleProcess() {
		if (!selectedAsset) {
			toast.error('Please select an audio asset');
			return;
		}

		const startTimeTotal = startMin * 60000 + startSec * 1000 + startMs;
		const endTimeTotal = endMin * 60000 + endSec * 1000 + endMs;

		if (startTimeTotal >= endTimeTotal) {
			toast.error('Start time must be less than end time');
			return;
		}

		if (endTimeTotal > selectedAsset.duration.ms) {
			toast.error('End time exceeds audio duration');
			return;
		}

		isProcessing = true;
		try {
			const output_path = await getUniqueFilePath(selectedAsset.filePath);
			
			await invoke('cut_audio', {
				sourcePath: selectedAsset.filePath,
				startMs: startTimeTotal,
				endMs: endTimeTotal,
				outputPath: output_path
			});

			// Add new asset to project
			const newAsset = new Asset(output_path);
			globalState.currentProject?.content.assets.push(newAsset);

			toast.success('Audio cut successfully!');
			close();
		} catch (error) {
			console.error(error);
			toast.error('Failed to cut audio: ' + error);
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
				<span class="material-icons text-accent-primary text-3xl">content_cut</span>
			</div>
			<div>
				<h2 class="text-2xl font-bold text-primary tracking-tight">Audio Cutter</h2>
				<p class="text-secondary text-sm">Trim your audio assets without affecting the original</p>
			</div>
		</div>
		<button class="absolute top-4 right-4 text-thirdly hover:text-primary transition-colors cursor-pointer" onclick={close}>
			<span class="material-icons">close</span>
		</button>
	</div>

	<!-- Body -->
	<div class="p-8 space-y-8">
		<!-- Asset Selection -->
		<div class="space-y-3">
			<label class="text-sm font-semibold text-secondary flex items-center gap-2" for="asset-select">
				<span class="material-icons text-xs">audiotrack</span>
				SELECT AUDIO ASSET
			</label>
			<select 
				id="asset-select"
				bind:value={selectedAssetId}
				class="w-full bg-accent border border-color rounded-lg px-4 py-3 text-primary focus:ring-2 focus:ring-accent-primary/50 outline-none transition-all cursor-pointer"
			>
				<option value={0} disabled>Choose an audio file...</option>
				{#each audioAssets as asset}
					<option value={asset.id}>{asset.fileName}</option>
				{/each}
			</select>
		</div>

		{#if selectedAsset}
			<div class="grid grid-cols-2 gap-8 animate-in slide-in-from-top-4 duration-300">
				<!-- Start Time -->
				<div class="space-y-4">
					<span class="text-sm font-semibold text-secondary flex items-center gap-2">
						<span class="material-icons text-xs text-green-500">play_circle</span>
						START TIME
					</span>
					<div class="flex gap-2 items-center">
						<div class="flex-1 space-y-1">
							<input type="number" bind:value={startMin} min="0" class="bg-accent border border-color rounded-lg px-2 py-2 text-sm font-mono text-primary outline-none focus:ring-2 focus:ring-accent-primary/50 transition-all w-full text-center" placeholder="Min" aria-label="Start minutes" />
							<span class="text-[10px] text-thirdly block text-center uppercase">Min</span>
						</div>
						<span class="text-secondary font-bold mb-4">:</span>
						<div class="flex-1 space-y-1">
							<input type="number" bind:value={startSec} min="0" max="59" class="bg-accent border border-color rounded-lg px-2 py-2 text-sm font-mono text-primary outline-none focus:ring-2 focus:ring-accent-primary/50 transition-all w-full text-center" placeholder="Sec" aria-label="Start seconds" />
							<span class="text-[10px] text-thirdly block text-center uppercase">Sec</span>
						</div>
						<span class="text-secondary font-bold mb-4">.</span>
						<div class="flex-1 space-y-1">
							<input type="number" bind:value={startMs} min="0" max="999" class="bg-accent border border-color rounded-lg px-2 py-2 text-sm font-mono text-primary outline-none focus:ring-2 focus:ring-accent-primary/50 transition-all w-full text-center" placeholder="Ms" aria-label="Start milliseconds" />
							<span class="text-[10px] text-thirdly block text-center uppercase">Ms</span>
						</div>
					</div>
				</div>

				<!-- End Time -->
				<div class="space-y-4">
					<span class="text-sm font-semibold text-secondary flex items-center gap-2">
						<span class="material-icons text-xs text-red-500">stop_circle</span>
						END TIME
					</span>
					<div class="flex gap-2 items-center">
						<div class="flex-1 space-y-1">
							<input type="number" bind:value={endMin} min="0" class="bg-accent border border-color rounded-lg px-2 py-2 text-sm font-mono text-primary outline-none focus:ring-2 focus:ring-accent-primary/50 transition-all w-full text-center" placeholder="Min" aria-label="End minutes" />
							<span class="text-[10px] text-thirdly block text-center uppercase">Min</span>
						</div>
						<span class="text-secondary font-bold mb-4">:</span>
						<div class="flex-1 space-y-1">
							<input type="number" bind:value={endSec} min="0" max="59" class="bg-accent border border-color rounded-lg px-2 py-2 text-sm font-mono text-primary outline-none focus:ring-2 focus:ring-accent-primary/50 transition-all w-full text-center" placeholder="Sec" aria-label="End seconds" />
							<span class="text-[10px] text-thirdly block text-center uppercase">Sec</span>
						</div>
						<span class="text-secondary font-bold mb-4">.</span>
						<div class="flex-1 space-y-1">
							<input type="number" bind:value={endMs} min="0" max="999" class="bg-accent border border-color rounded-lg px-2 py-2 text-sm font-mono text-primary outline-none focus:ring-2 focus:ring-accent-primary/50 transition-all w-full text-center" placeholder="Ms" aria-label="End milliseconds" />
							<span class="text-[10px] text-thirdly block text-center uppercase">Ms</span>
						</div>
					</div>
				</div>
			</div>

			<div class="bg-accent/50 rounded-lg p-3 border border-color/50 flex items-center gap-3">
				<span class="material-icons text-thirdly text-sm">info</span>
				<p class="text-[11px] text-secondary leading-tight">
					Total duration to cut: 
					<span class="text-primary font-mono">
						{Math.max(0, (endMin*60000 + endSec*1000 + endMs) - (startMin*60000 + startSec*1000 + startMs)) / 1000}s
					</span>
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
			disabled={isProcessing || !selectedAsset}
		>
			{#if isProcessing}
				<span class="material-icons animate-spin text-base">sync</span>
				Processing...
			{:else}
				<span class="material-icons text-base">content_cut</span>
				Cut Audio
			{/if}
		</button>
	</div>
</div>

<style>
	input[type='number'] {
		-moz-appearance: textfield;
		appearance: textfield;
	}
	input::-webkit-outer-spin-button,
	input::-webkit-inner-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}
</style>
