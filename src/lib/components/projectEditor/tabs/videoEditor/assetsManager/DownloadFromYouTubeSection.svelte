<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';
	import { listen } from '@tauri-apps/api/event';
	import { ProjectService } from '$lib/services/ProjectService';
	import { globalState } from '$lib/runes/main.svelte';
	import { SourceType } from '$lib/classes';
	import Section from '$lib/components/projectEditor/Section.svelte';
	import { onMount } from 'svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';

	let url: string = $state('');
	let type: string = $state('audio'); // Default to audio
	let startTime = $state('');
	let endTime = $state('');
	let audioBitrate = $state('');
	let maxHeight = $state('');
	let videoWithoutAudio = $state(false);
	let preciseCuts = $state(false);
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

	/**
	 * Convertit des secondes ou un horodatage MM:SS / HH:MM:SS en secondes.
	 * @param {string} value Valeur saisie ; une valeur vide laisse la borne libre.
	 * @returns {number | undefined | null} Secondes, borne absente ou valeur invalide.
	 */
	function parseDownloadTime(value: string): number | undefined | null {
		const trimmed = value.trim();
		if (!trimmed) return undefined;
		if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(trimmed)) return null;
		const parts = trimmed.split(':').map(Number);
		if (parts.slice(1).some((part) => part >= 60)) return null;
		const seconds = parts.reduce((total, part) => total * 60 + part, 0);
		return Number.isFinite(seconds) ? seconds : null;
	}

	/**
	 * Télécharge le média avec les options choisies, puis l'ajoute aux assets du projet.
	 * @returns {Promise<void>} Résolution après le téléchargement ou l'affichage de l'erreur.
	 */
	async function downloadAssetFromUrl(): Promise<void> {
		if (isDownloading) {
			return;
		}

		try {
			if (!url.trim()) {
				downloadError = get(LL).editor.enterValidMediaUrl();
				return;
			}
			const start = parseDownloadTime(startTime);
			const end = parseDownloadTime(endTime);
			if (start === null || end === null || (end !== undefined && end <= (start ?? 0))) {
				downloadError = get(LL).editor.invalidDownloadOptions();
				return;
			}

			downloadError = '';
			downloadProgress = 0;
			downloadStatus = 'starting';
			isDownloading = true;
			activeDownloadRequestId = createDownloadRequestId();
			const sourceUrl = url.trim();
			const downloadType = type === 'video' && videoWithoutAudio ? 'video_no_audio' : type;
			const options = {
				startTime: start,
				endTime: end,
				audioBitrate: type === 'audio' && audioBitrate ? Number(audioBitrate) : undefined,
				maxHeight: type === 'video' && maxHeight ? Number(maxHeight) : undefined,
				preciseCuts: type === 'video' && preciseCuts
			};

			const downloadPath = await ProjectService.getAssetFolderForProject(
				globalState.currentProject!.detail.id
			);

			const result = await invoke<string>('download_from_youtube', {
				url: sourceUrl,
				type: downloadType,
				downloadPath: downloadPath,
				downloadRequestId: activeDownloadRequestId,
				options
			});

			// Ajoute le fichier téléchargé à la liste des assets du projet
			globalState.currentProject!.content.addAsset(result, sourceUrl, SourceType.YouTube, {
				youtubeDownloadType: downloadType,
				youtubeDownloadOptions: options
			});

			downloadProgress = 100;
			downloadStatus = 'finished';
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			downloadError =
				errorMessage === 'invalid_download_options'
					? get(LL).editor.invalidDownloadOptions()
					: `${get(LL).editor.downloadErrorPrefix()} ${errorMessage}`;
			console.error(error);
		} finally {
			isDownloading = false;
			activeDownloadRequestId = null;
		}
	}
</script>

<Section icon="cloud_download" name={get(LL).editor.downloadFromSocialMedia()}>
	<!-- URL Input with enhanced styling -->
	<div class="mt-4 space-y-4">
		<div class="relative">
			<input
				type="text"
				class="w-full bg-secondary border border-color rounded-lg py-3 px-4 text-sm text-primary
				       placeholder-[var(--text-placeholder)] focus:outline-none focus:ring-2
				       focus:ring-[var(--accent-primary)] focus:border-transparent transition-all duration-200
				       hover:border-[var(--accent-primary)]"
				placeholder={get(LL).editor.pasteMediaUrlPlaceholder()}
				bind:value={url}
			/>
			<div class="absolute inset-y-0 end-0 flex items-center pe-3">
				<span class="material-icons text-thirdly text-lg">link</span>
			</div>
		</div>

		<!-- Media Type Selection -->
		<div class="bg-accent border border-color rounded-lg p-4 space-y-3">
			<h4 class="text-sm font-medium text-secondary">{get(LL).editor.chooseMediaType()}</h4>

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
							{get(LL).editor.audioOnly()}
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
							{get(LL).editor.videoAndAudio()}
						</span>
					</div>
				</label>
			</div>
		</div>

		<details class="group rounded-lg border border-color bg-accent">
			<summary
				class="flex cursor-pointer list-none items-center justify-between gap-2 p-3 text-xs text-secondary"
			>
				<span>{get(LL).editor.advancedOptions()}</span>
				<span
					aria-hidden="true"
					class="material-icons text-lg transition-transform group-open:rotate-180"
					>expand_more</span
				>
			</summary>
			<fieldset class="space-y-4 px-4 pb-4" disabled={isDownloading}>
				<div class="grid grid-cols-2 gap-3">
					<label class="space-y-1 text-xs text-secondary">
						<span>{get(LL).editor.startTime()}</span>
						<input
							type="text"
							dir="ltr"
							placeholder="00:00"
							bind:value={startTime}
							class="w-full rounded-lg border border-color bg-secondary px-3 py-2 text-sm text-primary"
						/>
					</label>
					<label class="space-y-1 text-xs text-secondary">
						<span>{get(LL).editor.endTime()}</span>
						<input
							type="text"
							dir="ltr"
							placeholder="00:00"
							bind:value={endTime}
							class="w-full rounded-lg border border-color bg-secondary px-3 py-2 text-sm text-primary"
						/>
					</label>
				</div>
				<p class="text-xs leading-relaxed text-thirdly">{get(LL).editor.downloadTimeRangeHint()}</p>
				<label class="block space-y-1 text-xs text-secondary">
					<span>{get(LL).export.quality()}</span>
					{#if type === 'audio'}
						<select
							bind:value={audioBitrate}
							class="w-full rounded-lg border border-color bg-secondary px-3 py-2 text-sm text-primary"
						>
							<option value="">{get(LL).common.default()}</option>
							{#each [320, 256, 192, 128, 96] as bitrate}
								<option value={String(bitrate)}
									>{get(LL).editor.downloadAudioBitrate({ bitrate })}</option
								>
							{/each}
						</select>
					{:else}
						<select
							bind:value={maxHeight}
							class="w-full rounded-lg border border-color bg-secondary px-3 py-2 text-sm text-primary"
						>
							<option value="">{get(LL).common.default()}</option>
							{#each [2160, 1440, 1080, 720, 480, 360] as height}
								<option value={String(height)}
									>{get(LL).editor.downloadMaxHeight({ height })}</option
								>
							{/each}
						</select>
					{/if}
				</label>
				{#if type === 'video'}
					<label class="flex items-center gap-2 text-xs text-secondary">
						<input type="checkbox" bind:checked={videoWithoutAudio} />
						{get(LL).editor.videoOnly()}
					</label>
					{#if startTime.trim() || endTime.trim()}
						<label class="flex items-start gap-2 text-xs text-secondary">
							<input type="checkbox" bind:checked={preciseCuts} class="mt-0.5" />
							<span
								>{get(LL).editor.downloadPreciseCuts()}<span class="mt-1 block text-thirdly"
									>{get(LL).editor.downloadPreciseCutsHint()}</span
								></span
							>
						</label>
					{/if}
				{/if}
			</fieldset>
		</details>

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
			{isDownloading ? get(LL).editor.downloadingMedia() : get(LL).editor.downloadFromLink()}
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
								{downloadStatus === 'finished'
									? get(LL).editor.finalizingDownload()
									: get(LL).editor.downloadingMedia()}
							{:else}
								{get(LL).editor.downloadFailed()}
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
				{get(LL).editor.supportedLinksHint()}
			</p>
		</div>
	</div>
	<br />
</Section>
