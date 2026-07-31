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
	import AndroidMediaService from '$lib/services/AndroidMediaService';
	import ContextMenu, { Item } from 'svelte-contextmenu';
	import { showContextMenuInViewport } from '$lib/services/ContextMenuService';
	import { playableLocalVideo } from '$lib/services/PlayableLocalVideo';

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

	let isRedownloading = $state(false);
	let isConvertingToCBR = $state(false);
	let cbrProgress = $state(0);
	let cbrProgressStatus = $state('');
	let mediaKey = $state(0);
	let isPreviewOpen = $state(false);
	let isActionsOpen = $state(false);
	let timelineContextMenu: ContextMenu | undefined = $state(undefined);

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

		const element = await AndroidMediaService.materializeSelectedFile(
			String(file),
			globalState.currentProject?.detail.id ?? 0
		);
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
			toast.error(asset.getDurationLoadErrorMessage() || get(LL).editor.unableToAnalyzeMedia(), {
				duration: 7000
			});
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
					downloadType: type,
					downloadPath: downloadPath
				});

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
			toast.error(get(LL).editor.errorRedownloading({ error: String(error) }), {
				id: toastId,
				duration: 5000
			});
		} finally {
			isRedownloading = false;
		}
	}
</script>

<div
	class="group select-none overflow-hidden rounded-md border border-color bg-secondary transition-colors hover:border-[var(--accent-primary)]/50 hover:bg-black/10"
>
	<div class="flex min-w-0 items-center gap-1 p-1.5">
		<button
			class="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-1.5 py-1 text-left outline-none transition-colors hover:bg-white/5 focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]"
			type="button"
			title={asset.fileName}
			onclick={() => (isPreviewOpen = !isPreviewOpen)}
		>
			<span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-black/20">
				<span class="material-icons text-lg! text-thirdly">
					{asset.type === AssetType.Video
						? 'video_library'
						: asset.type === AssetType.Audio
							? 'music_note'
							: 'image'}
				</span>
			</span>
			<span class="min-w-0 flex-1">
				<span class="block truncate text-sm font-medium text-primary">{asset.fileName}</span>
				<span class="mt-0.5 flex items-center gap-1 truncate text-[11px] text-thirdly">
					{assetTypeLabel(asset.type)}
					{#if !asset.exists}
						<span
							class="material-icons text-sm text-red-400"
							title={get(LL).editor.fileNotFoundOnDiskLabel()}>warning</span
						>
					{/if}
				</span>
			</span>
		</button>
		<button
			data-tour-id="asset-timeline-actions"
			class="btn-accent flex h-10 w-10 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-40"
			type="button"
			aria-label={get(LL).editor.addToTimelineLabel()}
			disabled={!asset.exists}
			onclick={(event) =>
				asset.type === AssetType.Video
					? void showContextMenuInViewport(timelineContextMenu, event)
					: asset.type === AssetType.Audio
						? addInTheTimelineButtonClick(false, true)
						: void showContextMenuInViewport(timelineContextMenu, event)}
		>
			<span class="material-icons text-lg!">add_to_queue</span>
		</button>
		<button
			class="btn flex h-10 w-10 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]"
			class:text-accent={isActionsOpen}
			type="button"
			title={get(LL).common.actions()}
			aria-label={get(LL).common.actions()}
			aria-expanded={isActionsOpen}
			onclick={() => (isActionsOpen = !isActionsOpen)}
		>
			<span class="material-icons text-lg!">more_horiz</span>
		</button>
	</div>
	{#if asset.type === AssetType.Audio}
		{#if isPreviewOpen && asset.exists}
			<div transition:slide class="border-t border-color p-1.5">
				{#key mediaKey}
					<audio class="h-8 w-full opacity-80" controls>
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
		{#if isPreviewOpen && asset.exists}
			<div transition:slide class="border-t border-color p-1.5">
				{#key mediaKey}
					<video
						class="h-44 w-full rounded-sm object-cover"
						controls
						playsinline
						preload="auto"
						use:playableLocalVideo={{
							filePath: asset.filePath,
							reloadToken: asset.mediaReloadToken
						}}
					>
						<track kind="captions" />
						{get(LL).editor.browserNoVideoSupport()}
					</video>
				{/key}
			</div>
		{/if}
	{:else if asset.type === AssetType.Image}
		{#if isPreviewOpen && asset.exists}
			<div transition:slide class="border-t border-color p-1.5">
				<img
					class="h-32 w-full rounded-sm object-contain"
					src={`${convertFileSrc(asset.filePath)}?v=${asset.mediaReloadToken}`}
					alt={asset.fileName}
				/>
			</div>
		{/if}
	{/if}
	{#if isActionsOpen}
		<div class="space-y-3 border-t border-color p-2" transition:slide>
			<!-- Action Buttons -->
			<div class="flex flex-wrap gap-2">
				{#if asset.exists}
					<!-- <button
						class="btn flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-lg
						       hover:scale-105 transition-all duration-200"
						onclick={async () => {
							await asset.openParentDirectory();
						}}
					>
						<span class="material-icons text-lg">folder_open</span>
						{get(LL).editor.openDirectoryLabel()}
					</button> -->
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

					<!-- {#if asset.type !== AssetType.Image}
						<button
							class="btn flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-lg
							       hover:scale-105 transition-all duration-200"
							onclick={trimAsset}
						>
							<span class="material-icons text-lg">content_cut</span>
							{get(LL).editor.trimLabel()}
						</button>
					{/if} -->
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
		</div>
	{/if}
</div>

<ContextMenu bind:this={timelineContextMenu}>
	<li class="pointer-events-none px-2 py-1 text-xs font-medium text-thirdly" role="presentation">
		{get(LL).editor.addToTimelineLabel()}
	</li>
	{#if asset.type === AssetType.Video}
		<Item on:click={() => addInTheTimelineButtonClick(true, true)}>
			<div class="btn-icon">
				<span class="material-icons-outlined mr-1 text-sm">video_library</span>
				{get(LL).editor.videoAndAudio()}
			</div>
		</Item>
		<Item on:click={() => addInTheTimelineButtonClick(true, false)}>
			<div class="btn-icon">
				<span class="material-icons-outlined mr-1 text-sm">videocam</span>
				{get(LL).editor.videoOnly()}
			</div>
		</Item>
		<Item on:click={() => addInTheTimelineButtonClick(false, true)}>
			<div class="btn-icon">
				<span class="material-icons-outlined mr-1 text-sm">music_note</span>
				{get(LL).editor.audioOnly()}
			</div>
		</Item>
	{:else if asset.type === AssetType.Image}
		<Item on:click={() => addInTheTimelineButtonClick(true, false)}>
			<div class="btn-icon">
				<span class="material-icons-outlined mr-1 text-sm">image</span>
				{get(LL).editor.setAsBackground()}
			</div>
		</Item>
	{/if}
</ContextMenu>
