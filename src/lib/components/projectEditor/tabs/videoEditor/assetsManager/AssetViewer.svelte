<script lang="ts">
	import { AssetType, SourceType, type Asset } from '$lib/classes';
	import { globalState } from '$lib/runes/main.svelte';
	import { convertFileSrc, invoke } from '@tauri-apps/api/core';
	import { onMount, tick } from 'svelte';
	import { slide } from 'svelte/transition';
	import ModalManager from '$lib/components/modals/ModalManager';
	import { join } from '@tauri-apps/api/path';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
	import toast from 'svelte-5-french-toast';
	import { open } from '@tauri-apps/plugin-dialog';
	import { ProjectService } from '$lib/services/ProjectService';
	import { listen, type UnlistenFn } from '@tauri-apps/api/event';

	type CbrConversionProgressEvent = {
		conversionRequestId: string;
		progress: number;
		currentTime: number;
		totalTime: number;
		status: string;
	};

	let {
		asset = $bindable()
	}: {
		asset: Asset;
	} = $props();

	let isHovered = $state(false);
	let isRedownloading = $state(false);
	let isConvertingToCBR = $state(false);
	let cbrProgress = $state(0);
	let cbrProgressStatus = $state('');
	let mediaKey = $state(0);
	let isExpanded = $derived(isHovered || isConvertingToCBR);

	function assetTypeLabel(type: string): string {
		const ll = get(LL);
		if (type === 'video') return ll.editor.videoAssetLabel();
		if (type === 'audio') return ll.editor.audioAssetLabel();
		return ll.editor.imageAssetLabel();
	}

	onMount(async () => {
		asset.checkExistence();
	});

	function trimAsset() {
		if (asset.type === AssetType.Image) {
			toast.error(get(LL).editor.trimAssetError());
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
		if (asset.type !== AssetType.Image && asset.isDurationLoading()) {
			toast(get(LL).editor.waitForAssetLoad(), {
				duration: 5000
			});
			return;
		}

		if (asset.type !== AssetType.Image && asset.hasDurationLoadError()) {
			toast.error(
				asset.getDurationLoadErrorMessage() ||
					get(LL).editor.unableToAnalyzeMedia(),
				{
					duration: 7000
				}
			);
			return;
		}

		if (asset.duration.isNull() && asset.type !== AssetType.Image) {
		toast.error(get(LL).editor.unableToLoadDuration(), {
			duration: 5000
		});
			return;
		}

		asset.addToTimeline(video, audio);
	}

	/**
	 * Contraint une progression CBR dans l'intervalle affichable.
	 *
	 * @param {number} value Progression brute envoyee par ffmpeg.
	 * @returns {number} Progression entre 0 et 100.
	 */
	function clampCbrProgress(value: number): number {
		return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
	}

	async function convertToCBR() {
		if (isConvertingToCBR) return;

		const conversionRequestId = `cbr-${asset.id}-${Date.now()}`;
		let unlisten: UnlistenFn | undefined;
		isConvertingToCBR = true;
		cbrProgress = 0;
		cbrProgressStatus = get(LL).editor.preparingLabel();

		try {
			unlisten = await listen<CbrConversionProgressEvent>('cbr-conversion-progress', (event) => {
				if (event.payload.conversionRequestId !== conversionRequestId) return;
				cbrProgress = clampCbrProgress(event.payload.progress);
				cbrProgressStatus = event.payload.status;
			});

			window.dispatchEvent(
				new CustomEvent('qurancaption-release-asset-media', {
					detail: { filePath: asset.filePath }
				})
			);
			mediaKey++;
			await tick();
			await new Promise((resolve) => setTimeout(resolve, 100));

			await invoke('convert_audio_to_cbr', {
				filePath: asset.filePath,
				conversionRequestId
			});

			asset.reloadMedia();
			mediaKey++;
			cbrProgress = 100;
			cbrProgressStatus = get(LL).editor.finishedLabel();
			toast.success(get(LL).editor.assetConvertedSuccess());
		} catch (error) {
			console.error('Error converting asset to CBR:', error);
			toast.error(get(LL).editor.errorConvertingAsset({ error: String(error) }));
		} finally {
			unlisten?.();
			isConvertingToCBR = false;
		}
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
				// Re-download from an online source using yt-dlp
				const type = asset.type === AssetType.Video ? 'video' : 'audio';

				toastId = toast.loading(get(LL).editor.redownloading());

				const result: string = await invoke('download_from_youtube', {
					url: asset.sourceUrl,
					type: type,
					downloadPath: downloadPath
				});

				asset.metadata.skipConstantBitrateWarning = true;
				asset.updateFilePath(result);
				mediaKey++; // Force re-render of audio/video element
				await convertToCBR();
			toast.success(get(LL).editor.redownloadSuccessful(), { id: toastId });
		} else if (
				asset.sourceType === SourceType.Mp3Quran ||
				asset.sourceType === SourceType.QuranFoundation
			) {
				// Re-download from a Quran audio catalog source.
				const fullPath = await join(downloadPath, asset.fileName);

				toastId = toast.loading(
					asset.sourceType === SourceType.QuranFoundation
						? get(LL).editor.redownloadingFromQuranCom()
						: get(LL).editor.redownloadingFromMp3Quran()
				);

				await invoke('download_file', {
					url: asset.sourceUrl,
					path: fullPath
				});

				asset.updateFilePath(fullPath);
				mediaKey++; // Force re-render of audio/video element
			toast.success(get(LL).editor.redownloadSuccessful(), { id: toastId });
		}
	} catch (error) {
			console.error('Re-download error:', error);
			toast.error(get(LL).editor.errorRedownloading({ error: String(error) }), { id: toastId, duration: 5000 });
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
				{assetTypeLabel(asset.type)}
			</p>
		</div>
		<!-- warning icon -->
		{#if !asset.exists}
			<div class="flex-shrink-0 p-1 rounded-full bg-red-500/20 border border-red-500/30">
				<span class="material-icons text-lg text-red-400" title={get(LL).editor.fileNotFoundOnDiskLabel()}
					>warning</span
				>
			</div>
		{/if}
	</div>
	{#if asset.type === AssetType.Audio}
		{#if isExpanded}
			<div transition:slide class="mt-4 p-3 bg-accent rounded-lg border border-color">
				{#key mediaKey}
					<audio class="w-full h-8 opacity-80" controls>
						<source
							src={`${convertFileSrc(asset.filePath)}?v=${asset.mediaReloadToken}`}
							type="audio/mp3"
						/>
						{get(LL).editor.browserNoAudioSupport()}
					</audio>
				{/key}
			</div>
		{/if}
	{:else if asset.type === AssetType.Video}
		{#if isExpanded}
			<div transition:slide class="mt-4 p-2 bg-accent rounded-lg border border-color">
				{#key mediaKey}
					<video class="w-full h-[180px] rounded-lg object-cover" controls>
						<track kind="captions" />
						<source
							src={`${convertFileSrc(asset.filePath)}?v=${asset.mediaReloadToken}`}
							type="video/mp4"
						/>
						{get(LL).editor.browserNoVideoSupport()}
					</video>
				{/key}
			</div>
		{/if}
	{:else if asset.type === AssetType.Image}
		{#if isExpanded}
			<div transition:slide class="mt-4 p-2 bg-accent rounded-lg border border-color">
				<img
					class="w-full h-[180px] object-contain rounded-lg"
					src={`${convertFileSrc(asset.filePath)}?v=${asset.mediaReloadToken}`}
					alt={asset.fileName}
				/>
			</div>
		{/if}
	{/if}
	{#if isExpanded}
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
						{get(LL).editor.openDirectoryLabel()}
					</button>
					<!-- turn into constant bitrate -->
					<button
						class="btn flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-lg
						       hover:scale-105 transition-all duration-200"
						onclick={convertToCBR}
						disabled={isConvertingToCBR}
					>
						{#if isConvertingToCBR}
							<span class="material-icons text-lg animate-spin">sync</span>
							{get(LL).editor.convertingLabel()}
						{:else}
							<span class="material-icons text-lg">speed</span>
							{get(LL).editor.convertToCbrLabel()}
						{/if}
					</button>

					{#if asset.type !== AssetType.Image}
						<button
							class="btn flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-lg
							       hover:scale-105 transition-all duration-200"
							onclick={trimAsset}
						>
							<span class="material-icons text-lg">content_cut</span>
							{get(LL).editor.trimLabel()}
						</button>
					{/if}
				{:else}
					<button
						class="btn flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-lg
						       hover:scale-105 transition-all duration-200"
						onclick={relocateAsset}
					>
						<span class="material-icons text-lg">folder_open</span>
							{get(LL).editor.relocateLabel()}
					</button>
					{#if asset.sourceUrl && (asset.sourceType === SourceType.YouTube || asset.sourceType === SourceType.Mp3Quran || asset.sourceType === SourceType.QuranFoundation)}
						<button
							class="btn flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-lg
							       hover:scale-105 transition-all duration-200 text-green-400 hover:text-green-300
							       hover:bg-green-500/10"
							onclick={redownloadAsset}
							disabled={isRedownloading}
						>
							{#if isRedownloading}
								<span class="material-icons text-lg animate-spin">sync</span>
								{get(LL).editor.downloadingLabel()}
							{:else}
								<span class="material-icons text-lg">cloud_download</span>
								{get(LL).editor.redownloadLabel()}
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
							get(LL).editor.removeAssetConfirm(),
							asset.sourceType !== SourceType.Local
						);
						if (result.confirmed) {
							if (result.deleteFile) {
								try {
									await invoke('delete_file', { path: asset.filePath });
								} catch (error) {
									const errorMessage = error instanceof Error ? error.message : String(error);
									toast.error(get(LL).editor.failedToDeleteFile({ error: errorMessage }));
								}
							}
							globalState.currentProject?.content.removeAsset(asset);
						}
					}}
				>
					<span class="material-icons text-lg">delete</span>
					{get(LL).common.remove()}
				</button>
			</div>
			{#if isConvertingToCBR}
				<div class="space-y-1">
					<div class="flex items-center justify-between text-xs text-thirdly">
						<span>{cbrProgressStatus || get(LL).editor.convertingToCbrProgress()}</span>
						<span>{Math.round(cbrProgress)}%</span>
					</div>
					<div class="h-2 overflow-hidden rounded-full bg-black/30">
						<div
							class="h-full rounded-full bg-[var(--accent-primary)] transition-all duration-200"
							style={`width: ${cbrProgress}%`}
						></div>
					</div>
					<p class="text-[11px] text-thirdly">
						{get(LL).editor.convertCbrProgressHint()}
					</p>
				</div>
			{/if}

			<!-- Timeline Actions -->
			{#if asset.exists}
				<div data-tour-id="asset-timeline-actions" class="space-y-2 pt-2 border-t border-color">
					<h4 class="text-xs font-medium text-thirdly uppercase tracking-wide">{get(LL).editor.addToTimelineLabel()}</h4>
					{#if asset.type === AssetType.Video}
						<div class="space-y-2">
							<button
								class="btn-accent w-full flex items-center justify-center gap-2 text-sm font-medium
								       py-3 px-4 rounded-lg hover:scale-[1.02] transition-all duration-200"
								onclick={() => addInTheTimelineButtonClick(true, true)}
							>
								<span class="material-icons text-lg">video_library</span>
								{get(LL).editor.videoAndAudio()}
							</button>
							<div class="grid grid-cols-2 gap-2">
								<button
									class="btn-accent flex items-center justify-center gap-2 text-xs font-medium
									       py-2 px-3 rounded-lg hover:scale-[1.02] transition-all duration-200"
									onclick={() => addInTheTimelineButtonClick(true, false)}
								>
									<span class="material-icons text-sm">videocam</span>
									{get(LL).editor.videoOnly()}
								</button>
								<button
									class="btn-accent flex items-center justify-center gap-2 text-xs font-medium
									       py-2 px-3 rounded-lg hover:scale-[1.02] transition-all duration-200"
									onclick={() => addInTheTimelineButtonClick(false, true)}
								>
									<span class="material-icons text-sm">music_note</span>
									{get(LL).editor.audioOnly()}
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
							{get(LL).editor.addToTimelineLabel()}
						</button>
					{:else if asset.type === AssetType.Image}
						<button
							class="btn-accent w-full flex items-center justify-center gap-2 text-sm font-medium
							       py-3 px-4 rounded-lg hover:scale-[1.02] transition-all duration-200"
							onclick={() => addInTheTimelineButtonClick(true, false)}
						>
							<span class="material-icons text-lg">image</span>
							{get(LL).editor.setAsBackground()}
						</button>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>
