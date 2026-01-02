<script lang="ts">
	import toast from 'svelte-5-french-toast';
	import { invoke } from '@tauri-apps/api/core';
	import { ProjectService } from '$lib/services/ProjectService';
	import { globalState } from '$lib/runes/main.svelte';
	import { Asset, AssetType } from '$lib/classes';
	import Section from '$lib/components/projectEditor/Section.svelte';

	let url: string = $state('');
	let type: string = $state('audio'); // Default to audio

	async function downloadAssetFromYouTube() {
		try {
			if (!url.trim()) {
				toast.error('Please enter a valid YouTube video URL.');
				return;
			}

			const downloadPath = await ProjectService.getAssetFolderForProject(
				globalState.currentProject!.detail.id
			);

			const result: any = await toast.promise(
				invoke('download_from_youtube', {
					url: url.trim(),
					type: type,
					downloadPath: downloadPath
				}),
				{
					loading: 'Downloading from YouTube...',
					success: 'Download successful!',
					error: 'Download failed!'
				}
			);

			// Ajoute le fichier téléchargé à la liste des assets du projet
			globalState.currentProject!.content.addAsset(result, url);
		} catch (error) {
			toast.error('Error downloading from YouTube: ' + error);
		}
	}
</script>

<Section icon="cloud_download" name="Download from YouTube">
	<!-- URL Input with enhanced styling -->
	<div class="mt-4 space-y-4">
		<div class="relative">
			<input
				type="text"
				class="w-full bg-secondary border border-color rounded-lg py-3 px-4 text-sm text-primary
				       placeholder-[var(--text-placeholder)] focus:outline-none focus:ring-2
				       focus:ring-[var(--accent-primary)] focus:border-transparent transition-all duration-200
				       hover:border-[var(--accent-primary)]"
				placeholder="Enter YouTube video URL"
				bind:value={url}
			/>
			<div class="absolute inset-y-0 right-0 flex items-center pr-3">
				<span class="material-icons text-thirdly text-lg">link</span>
			</div>
		</div>

		<!-- Media Type Selection -->
		<div class="bg-accent border border-color rounded-lg p-4 space-y-3">
			<h4 class="text-sm font-medium text-secondary">Choose media type to download</h4>

			<div class="flex items-start flex-col gap-6">
				<label class="flex items-center gap-2 cursor-pointer group">
					<input
						type="radio"
						name="mediaType"
						value="audio"
						checked
						class="w-4 h-4 text-[var(--accent-primary)] bg-secondary border-2 border-[var(--accent-primary)]
						       focus:ring-2 focus:ring-[var(--accent-primary)]/50 transition-all duration-200"
						onchange={() => (type = 'audio')}
					/>
					<div class="flex items-center gap-2">
						<span
							class="material-icons text-lg text-accent group-hover:text-[var(--accent-primary)] transition-colors duration-200"
						>
							music_note
						</span>
						<span
							class="text-sm font-medium text-primary group-hover:text-white transition-colors duration-200"
						>
							Audio Only
						</span>
					</div>
				</label>

				<label class="flex items-center gap-2 cursor-pointer group">
					<input
						type="radio"
						name="mediaType"
						value="video"
						class="w-4 h-4 text-[var(--accent-primary)] bg-secondary border-2 border-[var(--accent-primary)]
						       focus:ring-2 focus:ring-[var(--accent-primary)]/50 transition-all duration-200"
						onchange={() => (type = 'video')}
					/>
					<div class="flex items-center gap-2">
						<span
							class="material-icons text-lg text-accent group-hover:text-[var(--accent-primary)] transition-colors duration-200"
						>
							videocam
						</span>
						<span
							class="text-sm font-medium text-primary group-hover:text-white transition-colors duration-200"
						>
							Video & Audio
						</span>
					</div>
				</label>
			</div>
		</div>

		<!-- Download Button -->
		<button
			class="w-full btn-accent flex items-center justify-center gap-2 py-3 px-4 rounded-lg
			       text-sm font-medium transition-all duration-200 hover:scale-[1.02]
			       disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100
			       shadow-lg hover:shadow-xl"
			type="button"
			onclick={downloadAssetFromYouTube}
			disabled={!url.trim()}
		>
			<span class="material-icons text-lg">download</span>
			Download from YouTube
		</button>

		<!-- Info hint -->
		<div class="flex items-start gap-2 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
			<span class="material-icons text-sm text-blue-400 mt-0.5">info</span>
			<p class="text-xs text-blue-300 leading-relaxed">
				The downloaded file will be automatically added to your project assets.
			</p>
		</div>
	</div>
	<br />
</Section>
