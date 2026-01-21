<script lang="ts">
	import { AssetType, SourceType, type Asset } from '$lib/classes';
	import { globalState } from '$lib/runes/main.svelte';
	import { convertFileSrc, invoke } from '@tauri-apps/api/core';
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import ModalManager from '$lib/components/modals/ModalManager';
	import { join } from '@tauri-apps/api/path';
	import toast from 'svelte-5-french-toast';
	import { open } from '@tauri-apps/plugin-dialog';
	import { ProjectService } from '$lib/services/ProjectService';

	let {
		asset = $bindable()
	}: {
		asset: Asset;
	} = $props();

	let isHovered = $state(false);
	let isRedownloading = $state(false);
	let mediaKey = $state(0);

	onMount(async () => {
		asset.checkExistence();
	});

	function trimAsset() {
		if (asset.type === AssetType.Image) {
			toast.error('Trim is only available for audio and video assets.');
			return;
		}
		ModalManager.audioCutterModal(asset.id);
	}

	async function relocateAsset() {
		// Open a dialog
		const file = await open({
			directory: false
		});

		if (!file) return;

		const element = file;
		asset.updateFilePath(element);
	}

	function addInTheTimelineButtonClick(video: boolean, audio: boolean) {
		if (asset.duration.isNull() && asset.type !== AssetType.Image) {
			toast(
				'Please wait for the asset to be loaded before adding it to the timeline. If this is recurrent and you are on MacOS or Linux, please install ffmpeg and ffprobe through Homebrew and re-import the asset.',
				{
					duration: 5000
				}
			);

			return;
		}

		// Ajoute l'asset à la timeline
		asset.addToTimeline(video, audio);
	}

	async function convertToCBR() {
		// Convertir l'asset en CBR
		toast.promise(
			invoke('convert_audio_to_cbr', { filePath: asset.filePath }),
			{
				loading: 'Converting to CBR...',
				success:
					'Asset converted to CBR successfully! Please restart Quran Caption to see the changes.',
				error: 'Error converting asset to CBR.'
			},
			{
				duration: 4000
			}
		);
	}

	async function redownloadAsset() {
		if (!asset.sourceUrl) return;

		isRedownloading = true;
		let toastId: string | undefined;

		try {
			const downloadPath = await ProjectService.getAssetFolderForProject(
				globalState.currentProject!.detail.id
			);

			if (asset.sourceType === SourceType.YouTube) {
				// Re-download from YouTube using yt-dlp
				const type = asset.type === AssetType.Video ? 'video' : 'audio';

				toastId = toast.loading('Re-downloading from YouTube...');

				const result: string = await invoke('download_from_youtube', {
					url: asset.sourceUrl,
					type: type,
					downloadPath: downloadPath
				});

				asset.updateFilePath(result);
				mediaKey++; // Force re-render of audio/video element
				toast.success('Re-download successful!', { id: toastId });
			} else if (asset.sourceType === SourceType.Mp3Quran) {
				// Re-download from MP3Quran
				const fullPath = await join(downloadPath, asset.fileName);

				toastId = toast.loading('Re-downloading from MP3Quran...');

				await invoke('download_file', {
					url: asset.sourceUrl,
					path: fullPath
				});

				asset.updateFilePath(fullPath);
				mediaKey++; // Force re-render of audio/video element
				toast.success('Re-download successful!', { id: toastId });
			}
		} catch (error) {
			console.error('Re-download error:', error);
			toast.error(`Error re-downloading: ${error}`, { id: toastId, duration: 5000 });
		} finally {
			isRedownloading = false;
		}
	}
</script>

<div
	class="flex flex-col p-4 bg-secondary border border-color rounded-xl shadow-lg transition-all duration-300 select-none
	       bg-accent hover:border-[var(--accent-primary)] hover:shadow-xl hover:shadow-blue-500/10 hover:scale-[1.02] group"
	role="button"
	tabindex="0"
	onmouseenter={() => (isHovered = true)}
	onmouseleave={() => (isHovered = false)}
>
	<div class="flex flex-row gap-3 items-center relative">
		<div
			class="flex-shrink-0 p-2 rounded-lg bg-accent transition-colors duration-300
		            group-hover:bg-[var(--accent-primary)] group-hover:text-black"
		>
			<span
				class="material-icons text-3xl text-accent transition-colors duration-300
			             group-hover:text-black"
			>
				{asset.type === 'video' ? 'video_library' : asset.type === 'audio' ? 'music_note' : 'image'}
			</span>
		</div>
		<div class="flex-1 min-w-0">
			<p
				class="text-sm font-semibold text-primary truncate group-hover:text-[var(--text-on-hover)] transition-colors duration-300"
			>
				{asset.fileName}
			</p>
			<p
				class="text-xs text-thirdly mt-1 group-hover:text-[var(--text-secondary-on-hover)] transition-colors duration-300"
			>
				{asset.type.charAt(0).toUpperCase() + asset.type.slice(1)} Asset
			</p>
		</div>
		<!-- warning icon -->
		{#if !asset.exists}
			<div class="flex-shrink-0 p-1 rounded-full bg-red-500/20 border border-red-500/30">
				<span class="material-icons text-lg text-red-400" title="File not found on disk"
					>warning</span
				>
			</div>
		{/if}
	</div>
	{#if asset.type === AssetType.Audio}
		{#if isHovered}
			<div transition:slide class="mt-4 p-3 bg-accent rounded-lg border border-color">
				{#key mediaKey}
					<audio class="w-full h-8 opacity-80" controls>
						<source src={convertFileSrc(asset.filePath)} type="audio/mp3" />
						Your browser does not support the audio element.
					</audio>
				{/key}
			</div>
		{/if}
	{:else if asset.type === AssetType.Video}
		{#if isHovered}
			<div transition:slide class="mt-4 p-2 bg-accent rounded-lg border border-color">
				{#key mediaKey}
					<video class="w-full h-[180px] rounded-lg object-cover" controls>
						<track kind="captions" />
						<source src={convertFileSrc(asset.filePath)} type="video/mp4" />
						Your browser does not support the video tag.
					</video>
				{/key}
			</div>
		{/if}
	{:else if asset.type === AssetType.Image}
		{#if isHovered}
			<div transition:slide class="mt-4 p-2 bg-accent rounded-lg border border-color">
				<img
					class="w-full h-[180px] object-contain rounded-lg"
					src={convertFileSrc(asset.filePath)}
					alt={asset.fileName}
				/>
			</div>
		{/if}
	{/if}
	{#if isHovered}
		<div class="mt-4 space-y-3" transition:slide>
			<!-- Action Buttons -->
			<div class="flex flex-wrap gap-2">
				{#if asset.exists}
					<button
						class="btn flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-lg
						       hover:scale-105 transition-all duration-200"
						onclick={async () => {
							await asset.openParentDirectory();
						}}
					>
						<span class="material-icons text-lg">folder_open</span>
						Open Directory
					</button>
					<!-- turn into constant bitrate -->
					<button
						class="btn flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-lg
						       hover:scale-105 transition-all duration-200"
						onclick={convertToCBR}
					>
						<span class="material-icons text-lg">speed</span>
						Convert to CBR
					</button>

					{#if asset.type !== AssetType.Image}
						<button
							class="btn flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-lg
							       hover:scale-105 transition-all duration-200"
							onclick={trimAsset}
						>
							<span class="material-icons text-lg">content_cut</span>
							Trim
						</button>
					{/if}
				{:else}
					<button
						class="btn flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-lg
						       hover:scale-105 transition-all duration-200"
						onclick={relocateAsset}
					>
						<span class="material-icons text-lg">folder_open</span>
						Relocate
					</button>
					{#if asset.sourceUrl && (asset.sourceType === SourceType.YouTube || asset.sourceType === SourceType.Mp3Quran)}
						<button
							class="btn flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-lg
							       hover:scale-105 transition-all duration-200 text-green-400 hover:text-green-300
							       hover:bg-green-500/10"
							onclick={redownloadAsset}
							disabled={isRedownloading}
						>
							{#if isRedownloading}
								<span class="material-icons text-lg animate-spin">sync</span>
								Downloading...
							{:else}
								<span class="material-icons text-lg">cloud_download</span>
								Re-download
							{/if}
						</button>
					{/if}
				{/if}

				<button
					class="btn flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-lg
					       hover:scale-105 transition-all duration-200 text-red-400 hover:text-red-300
					       hover:bg-red-500/10"
					onclick={async () => {
						const result = await ModalManager.deleteConfirmationModal(
							'Are you sure you want to remove this asset from the project?'
						);
						if (result.confirmed) {
							if (result.deleteFile) {
								try {
									await invoke('delete_file', { path: asset.filePath });
								} catch (error) {
									const errorMessage = error instanceof Error ? error.message : String(error);
									toast.error('Failed to delete file from disk: ' + errorMessage);
								}
							}
							globalState.currentProject?.content.removeAsset(asset);
						}
					}}
				>
					<span class="material-icons text-lg">delete</span>
					Remove
				</button>
			</div>

			<!-- Timeline Actions -->
			{#if asset.exists}
				<div class="space-y-2 pt-2 border-t border-color">
					<h4 class="text-xs font-medium text-thirdly uppercase tracking-wide">Add to Timeline</h4>
					{#if asset.type === AssetType.Video}
						<div class="space-y-2">
							<button
								class="btn-accent w-full flex items-center justify-center gap-2 text-sm font-medium
								       py-3 px-4 rounded-lg hover:scale-[1.02] transition-all duration-200"
								onclick={() => addInTheTimelineButtonClick(true, true)}
							>
								<span class="material-icons text-lg">video_library</span>
								Video & Audio
							</button>
							<div class="grid grid-cols-2 gap-2">
								<button
									class="btn-accent flex items-center justify-center gap-2 text-xs font-medium
									       py-2 px-3 rounded-lg hover:scale-[1.02] transition-all duration-200"
									onclick={() => addInTheTimelineButtonClick(true, false)}
								>
									<span class="material-icons text-sm">videocam</span>
									Video Only
								</button>
								<button
									class="btn-accent flex items-center justify-center gap-2 text-xs font-medium
									       py-2 px-3 rounded-lg hover:scale-[1.02] transition-all duration-200"
									onclick={() => addInTheTimelineButtonClick(false, true)}
								>
									<span class="material-icons text-sm">music_note</span>
									Audio Only
								</button>
							</div>
						</div>
					{:else if asset.type === AssetType.Audio}
						<button
							class="btn-accent w-full flex items-center justify-center gap-2 text-sm font-medium
							       py-3 px-4 rounded-lg hover:scale-[1.02] transition-all duration-200"
							onclick={() => addInTheTimelineButtonClick(false, true)}
						>
							<span class="material-icons text-lg">music_note</span>
							Add to Timeline
						</button>
					{:else if asset.type === AssetType.Image}
						<button
							class="btn-accent w-full flex items-center justify-center gap-2 text-sm font-medium
							       py-3 px-4 rounded-lg hover:scale-[1.02] transition-all duration-200"
							onclick={() => addInTheTimelineButtonClick(true, false)}
						>
							<span class="material-icons text-lg">image</span>
							Set as Background
						</button>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>
