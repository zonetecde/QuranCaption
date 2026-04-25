<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { listen } from '@tauri-apps/api/event';
	import { ProjectService } from '$lib/services/ProjectService';
	import { globalState } from '$lib/runes/main.svelte';
	import { SourceType } from '$lib/classes';
	import Section from '$lib/components/projectEditor/Section.svelte';
	import { AnalyticsService } from '$lib/services/AnalyticsService';
	import { onMount } from 'svelte';

	let url: string = $state('');
	let type: string = $state('audio'); // Default to audio
	let isDownloading: boolean = $state(false);
	let downloadProgress: number = $state(0);
	let downloadStatus: string = $state('');
	let downloadError: string = $state('');
	let activeDownloadRequestId: string | null = $state(null);

	interface YoutubeDownloadProgressEvent {
		downloadRequestId: string;
		progress: number;
		status?: string;
	}

	/**
	 * Cree un identifiant local pour relier le download courant aux evenements backend.
	 * @returns Identifiant unique de telechargement.
	 */
	function createDownloadRequestId(): string {
		return globalThis.crypto?.randomUUID?.() ?? `download-${Date.now()}-${Math.random()}`;
	}

	/**
	 * Met à jour la progression si l'événement concerne le téléchargement courant.
	 * @param event événement Tauri émis par le backend.
	 */
	function handleDownloadProgress(event: { payload: YoutubeDownloadProgressEvent }) {
		if (!activeDownloadRequestId || event.payload.downloadRequestId !== activeDownloadRequestId) {
			return;
		}

		downloadProgress = Math.max(0, Math.min(100, event.payload.progress));
		downloadStatus = event.payload.status ?? 'downloading';
	}

	onMount(() => {
		const unlistenPromise = listen<YoutubeDownloadProgressEvent>(
			'youtube-download-progress',
			handleDownloadProgress
		);

		return () => {
			void unlistenPromise.then((unlisten) => unlisten());
		};
	});

	async function downloadAssetFromUrl() {
		if (isDownloading) {
			return;
		}

		try {
			if (!url.trim()) {
				downloadError = 'Please enter a valid public media URL.';
				return;
			}

			downloadError = '';
			downloadProgress = 0;
			downloadStatus = 'starting';
			isDownloading = true;
			activeDownloadRequestId = createDownloadRequestId();

			const downloadPath = await ProjectService.getAssetFolderForProject(
				globalState.currentProject!.detail.id
			);

			const result = await invoke<string>('download_from_youtube', {
				url: url.trim(),
				type: type,
				downloadPath: downloadPath,
				downloadRequestId: activeDownloadRequestId
			});

			// Ajoute le fichier téléchargé à la liste des assets du projet
			globalState.currentProject!.content.addAsset(result, url, SourceType.YouTube);

			// Telemetry
			AnalyticsService.downloadFromYouTube(url, type);

			downloadProgress = 100;
			downloadStatus = 'finished';
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			downloadError = `Error downloading media from link: ${errorMessage}`;
			console.error(error);
		} finally {
			isDownloading = false;
			activeDownloadRequestId = null;
		}
	}
</script>

<Section icon="cloud_download" name="Download from Social Media">
	<!-- URL Input with enhanced styling -->
	<div class="mt-4 space-y-4">
		<div class="relative">
			<input
				type="text"
				class="w-full bg-secondary border border-color rounded-lg py-3 px-4 text-sm text-primary
				       placeholder-[var(--text-placeholder)] focus:outline-none focus:ring-2
				       focus:ring-[var(--accent-primary)] focus:border-transparent transition-all duration-200
				       hover:border-[var(--accent-primary)]"
				placeholder="Paste a public media URL"
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
			onclick={downloadAssetFromUrl}
			disabled={!url.trim() || isDownloading}
		>
			<span class="material-icons text-lg">{isDownloading ? 'sync' : 'download'}</span>
			{isDownloading ? 'Downloading...' : 'Download from Link'}
		</button>

		{#if isDownloading || downloadError}
			<div class="bg-accent border border-color rounded-lg p-4 space-y-3">
				<div class="flex items-center justify-between gap-3">
					<div class="flex items-center gap-2 min-w-0">
						<span class="material-icons text-lg text-[var(--accent-primary)]">
							{isDownloading ? 'cloud_download' : 'error'}
						</span>
						<p class="text-sm font-medium text-primary truncate">
							{#if isDownloading}
								{downloadStatus === 'finished' ? 'Finalizing download...' : 'Downloading media...'}
							{:else}
								Download failed
							{/if}
						</p>
					</div>
					<span class="text-xs text-thirdly whitespace-nowrap">
						{Math.round(downloadProgress)}%
					</span>
				</div>

				<div class="h-2 w-full overflow-hidden rounded-full bg-secondary">
					<div
						class="h-full rounded-full bg-gradient-to-r from-[var(--accent-primary)] to-cyan-400 transition-all duration-200"
						style={`width: ${downloadProgress}%`}
					></div>
				</div>

				<p class={`text-xs leading-relaxed ${downloadError ? 'text-red-300' : 'text-thirdly'}`}>
					{#if downloadError}
						{downloadError}
					{/if}
				</p>
			</div>
		{/if}

		<!-- Info hint -->
		<div class="flex items-start gap-2 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
			<span class="material-icons text-sm text-blue-400 mt-0.5">info</span>
			<p class="text-xs text-blue-300 leading-relaxed">
				Supported public links include YouTube, full surah or mushaf uploads on SoundCloud, Internet
				Archive collections, public Google Drive links, and short recitation clips from Facebook,
				Instagram, TikTok, or X/Twitter.
			</p>
		</div>
	</div>
	<br />
</Section>
