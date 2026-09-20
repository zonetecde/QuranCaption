<script lang="ts">
	import { Asset, AssetClip, AssetType } from '$lib/classes';
	import { globalState } from '$lib/runes/main.svelte';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
	import { invoke } from '@tauri-apps/api/core';
	import { exists } from '@tauri-apps/plugin-fs';
	import toast from 'svelte-5-french-toast';
	import LL from '$lib/i18n/i18n-svelte';

	type NoiseReductionCopy = {
		noiseReduction: () => string;
		noiseReductionDescription: () => string;
		selectTimelineAudio: () => string;
		chooseTimelineAudio: () => string;
		noTimelineAudio: () => string;
		noiseReductionResultHint: () => string;
		applyNoiseReduction: () => string;
		pleaseSelectTimelineAudio: () => string;
		noiseReductionSuccess: () => string;
		noiseReductionFailed: (args: { error: string }) => string;
	};

	let { close }: { close: () => void } = $props();
	let selectedClipId = $state(0);
	let isProcessing = $state(false);
	let toolsCopy = $derived($LL.tools as unknown as NoiseReductionCopy);

	let audioClipOptions = $derived(
		globalState.getAudioTrack.clips.flatMap((clip, index) => {
			if (!(clip instanceof AssetClip)) return [];
			const asset = globalState.currentProject?.content.assets.find(
				(projectAsset) => projectAsset.id === clip.assetId
			);
			if (!asset || (asset.type !== AssetType.Audio && asset.type !== AssetType.Video)) return [];
			return [{ clip, asset, index }];
		})
	);
	let selectedOption = $derived(audioClipOptions.find(({ clip }) => clip.id === selectedClipId));

	/** Retourne un chemin WAV disponible à côté de la source. @param {string} sourcePath Chemin source. @returns {Promise<string>} Chemin de sortie unique. */
	async function getUniqueOutputPath(sourcePath: string): Promise<string> {
		const basePath = sourcePath.replace(/\.[^./\\]+$/, '');
		let suffix = 1;
		let outputPath = `${basePath}_noise_reduced_${suffix}.wav`;
		while (await exists(outputPath)) {
			suffix += 1;
			outputPath = `${basePath}_noise_reduced_${suffix}.wav`;
		}
		return outputPath;
	}

	/** Réduit le bruit de la source sélectionnée puis remplace la source du clip. @returns {Promise<void>} Fin du traitement. */
	async function applyNoiseReduction(): Promise<void> {
		if (!selectedOption) {
			toast.error(toolsCopy.pleaseSelectTimelineAudio());
			return;
		}

		isProcessing = true;
		const clipId = selectedOption.clip.id;
		const sourceAsset = selectedOption.asset;
		try {
			const outputPath = await getUniqueOutputPath(sourceAsset.filePath);
			await invoke('reduce_audio_noise', {
				sourcePath: sourceAsset.filePath,
				outputPath
			});

			const newAsset = new Asset(outputPath);
			await newAsset.ensureDurationLoaded();
			const targetClip = globalState.getAudioTrack.clips.find((clip) => clip.id === clipId);
			if (!(targetClip instanceof AssetClip)) {
				throw new Error(toolsCopy.pleaseSelectTimelineAudio());
			}

			ProjectHistoryManager.track(toolsCopy.noiseReduction(), () => {
				globalState.currentProject!.content.assets.unshift(newAsset);
				targetClip.assetId = newAsset.id;
			});
			globalState.updateVideoPreviewUI();
			toast.success(toolsCopy.noiseReductionSuccess());
			close();
		} catch (error) {
			console.error('Audio noise reduction failed:', error);
			toast.error(toolsCopy.noiseReductionFailed({ error: String(error) }));
		} finally {
			isProcessing = false;
		}
	}
</script>

<div
	class="bg-secondary w-[500px] rounded-xl shadow-2xl overflow-hidden border border-color animate-in fade-in zoom-in duration-200"
>
	<div
		class="bg-gradient-to-r from-accent-primary/20 to-accent-secondary/20 p-6 border-b border-color relative"
	>
		<div class="flex items-center gap-4">
			<div class="bg-accent-primary/20 p-3 rounded-xl">
				<span class="material-icons text-accent-primary text-3xl">hearing</span>
			</div>
			<div>
				<h2 class="text-2xl font-bold text-primary tracking-tight">
					{toolsCopy.noiseReduction()}
				</h2>
				<p class="text-secondary text-sm">{toolsCopy.noiseReductionDescription()}</p>
			</div>
		</div>
		<button
			class="absolute top-4 right-4 text-thirdly hover:text-primary transition-colors cursor-pointer"
			onclick={close}
			disabled={isProcessing}
			aria-label={$LL.common.close()}
		>
			<span class="material-icons">close</span>
		</button>
	</div>

	<div class="p-8 space-y-4">
		<label class="text-sm font-semibold text-secondary" for="noise-reduction-audio">
			{toolsCopy.selectTimelineAudio()}
		</label>
		<select
			id="noise-reduction-audio"
			bind:value={selectedClipId}
			disabled={isProcessing || audioClipOptions.length === 0}
			class="w-full bg-accent border border-color rounded-lg px-4 py-3 text-primary focus:ring-2 focus:ring-accent-primary/50 outline-none transition-all cursor-pointer disabled:opacity-50"
		>
			<option value={0} disabled>{toolsCopy.chooseTimelineAudio()}</option>
			{#each audioClipOptions as option (option.clip.id)}
				<option value={option.clip.id}>
					#{option.index + 1} · {option.asset.fileName}
				</option>
			{/each}
		</select>

		{#if audioClipOptions.length === 0}
			<p class="text-sm text-thirdly">{toolsCopy.noTimelineAudio()}</p>
		{:else}
			<p class="text-xs text-thirdly leading-relaxed">
				{toolsCopy.noiseReductionResultHint()}
			</p>
		{/if}
	</div>

	<div class="bg-accent/30 p-6 flex justify-end items-center gap-4 border-t border-color">
		<button class="btn px-6 py-2.5 text-sm font-medium" onclick={close} disabled={isProcessing}>
			{$LL.common.cancel()}
		</button>
		<button
			class="btn-accent px-8 py-2.5 text-sm font-bold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
			onclick={applyNoiseReduction}
			disabled={isProcessing || !selectedOption}
		>
			{#if isProcessing}
				<span class="material-icons animate-spin text-base">sync</span>
				{$LL.common.processing()}
			{:else}
				<span class="material-icons text-base">hearing</span>
				{toolsCopy.applyNoiseReduction()}
			{/if}
		</button>
	</div>
</div>
