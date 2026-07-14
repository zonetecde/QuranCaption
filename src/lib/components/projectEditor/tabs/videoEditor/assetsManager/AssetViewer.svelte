<script lang="ts">
	import { AssetType, SourceType, type Asset } from '$lib/classes';
	import { globalState } from '$lib/runes/main.svelte';
	import { convertFileSrc, invoke } from '@tauri-apps/api/core';
	import { onDestroy, onMount, tick } from 'svelte';
	import ModalManager from '$lib/components/modals/ModalManager';
	import { join } from '@tauri-apps/api/path';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
	import toast from 'svelte-5-french-toast';
	import { open } from '@tauri-apps/plugin-dialog';
	import { ProjectService } from '$lib/services/ProjectService';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
	import { listen, type UnlistenFn } from '@tauri-apps/api/event';
	import ContextMenu, { Divider, Item } from 'svelte-contextmenu';
	import { currentMenu } from 'svelte-contextmenu/stores';

	type CbrConversionProgressEvent = {
		conversionRequestId: string;
		progress: number;
		currentTime: number;
		totalTime: number;
		status: string;
	};

	let {
		asset = $bindable(),
		selected = false,
		onToggleSelection
	}: {
		asset: Asset;
		selected?: boolean;
		onToggleSelection: () => void;
	} = $props();

	let contextMenu: ContextMenu | undefined = $state(undefined);
	let timelineContextMenu: ContextMenu | undefined = $state(undefined);
	let contextMenuElement: HTMLElement | null = null;
	let timelineContextMenuElement: HTMLElement | null = null;
	let wasContextMenuOpenOnPointerDown = false;
	let wasTimelineContextMenuOpenOnPointerDown = false;
	let isPreviewOpen = $state(false);
	let isRedownloading = $state(false);
	let isConvertingToCBR = $state(false);
	let cbrProgress = $state(0);
	let cbrProgressStatus = $state('');
	let mediaKey = $state(0);

	function assetTypeLabel(type: string): string {
		const ll = get(LL);
		if (type === 'video') return ll.editor.videoAssetLabel();
		if (type === 'audio') return ll.editor.audioAssetLabel();
		return ll.editor.imageAssetLabel();
	}

	onMount(async () => {
		asset.checkExistence();
	});

	onDestroy(() => {
		currentMenu.set(null);
	});

	/**
	 * Sélectionne l'asset avec Ctrl/Cmd ou ouvre son aperçu avec un clic simple.
	 * @param {MouseEvent} event Clic sur la zone principale de l'asset.
	 * @returns {void}
	 */
	function handlePrimaryClick(event: MouseEvent): void {
		if (event.ctrlKey || event.metaKey) {
			onToggleSelection();
			return;
		}
		isPreviewOpen = !isPreviewOpen;
	}

	/**
	 * Ouvre ou ferme le menu d'actions de l'asset.
	 * @param {MouseEvent} event Événement utilisé pour positionner le menu.
	 * @returns {void}
	 */
	function openContextMenu(event: MouseEvent): void {
		event.preventDefault();
		event.stopPropagation();
		const shouldClose =
			wasContextMenuOpenOnPointerDown ||
			(contextMenuElement !== null && get(currentMenu) === contextMenuElement);
		wasContextMenuOpenOnPointerDown = false;
		if (shouldClose) {
			currentMenu.set(null);
			return;
		}
		contextMenu?.show(event);
		contextMenuElement = get(currentMenu) as HTMLElement | null;
	}

	/**
	 * Ouvre ou ferme les modes d'ajout à la timeline de l'asset.
	 * @param {MouseEvent} event Événement utilisé pour positionner le menu.
	 * @returns {void}
	 */
	function openTimelineContextMenu(event: MouseEvent): void {
		event.preventDefault();
		event.stopPropagation();
		const shouldClose =
			wasTimelineContextMenuOpenOnPointerDown ||
			(timelineContextMenuElement !== null && get(currentMenu) === timelineContextMenuElement);
		wasTimelineContextMenuOpenOnPointerDown = false;
		if (shouldClose) {
			currentMenu.set(null);
			return;
		}
		timelineContextMenu?.show(event);
		timelineContextMenuElement = get(currentMenu) as HTMLElement | null;
	}

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

			ProjectHistoryManager.track('mark asset as constant bitrate', () => {
				asset.metadata.skipConstantBitrateWarning = true;
				asset.reloadMedia();
			});
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

	/**
	 * Confirme puis retire l'asset du projet et éventuellement du disque.
	 * @returns {Promise<void>}
	 */
	async function removeAsset(): Promise<void> {
		const result = await ModalManager.deleteConfirmationModal(
			get(LL).editor.removeAssetConfirm(),
			asset.sourceType !== SourceType.Local
		);
		if (!result.confirmed) return;

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
</script>

<div
	class={`select-none rounded-md border bg-secondary transition-colors ${
		selected
			? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10 shadow-[0_0_0_1px_var(--accent-primary)]'
			: 'border-color hover:border-[var(--accent-primary)]/50 hover:bg-black/10'
	}`}
	oncontextmenu={openContextMenu}
>
	<div class="flex min-w-0 items-center gap-1 p-1.5">
		<button
			class="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-1.5 py-1 text-left outline-none transition-colors hover:bg-white/5 focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]"
			type="button"
			title={asset.fileName}
			onclick={handlePrimaryClick}
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
			{#if selected}
				<span class="material-icons shrink-0 text-lg! text-accent">check_circle</span>
			{/if}
		</button>
		<button
			data-tour-id="asset-timeline-actions"
			class="btn flex h-8 w-8 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-40"
			type="button"
			title={get(LL).editor.addToTimelineLabel()}
			aria-label={get(LL).editor.addToTimelineLabel()}
			disabled={!asset.exists}
			onpointerdown={() =>
				(wasTimelineContextMenuOpenOnPointerDown =
					timelineContextMenuElement !== null && get(currentMenu) === timelineContextMenuElement)}
			onclick={openTimelineContextMenu}
		>
			<span class="material-icons text-lg!">add_to_queue</span>
		</button>
		<button
			class="btn flex h-8 w-8 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]"
			type="button"
			title={get(LL).common.actions()}
			aria-label={get(LL).common.actions()}
			onpointerdown={() =>
				(wasContextMenuOpenOnPointerDown =
					contextMenuElement !== null && get(currentMenu) === contextMenuElement)}
			onclick={openContextMenu}
		>
			<span class="material-icons text-lg!">more_horiz</span>
		</button>
	</div>

	{#if isPreviewOpen && asset.exists}
		<div class="border-t border-color p-1.5">
			{#if asset.type === AssetType.Audio}
				{#key mediaKey}
					<audio class="h-8 w-full opacity-80" controls>
						<source
							src={`${convertFileSrc(asset.filePath)}?v=${asset.mediaReloadToken}`}
							type="audio/mp3"
						/>
						{get(LL).editor.browserNoAudioSupport()}
					</audio>
				{/key}
			{:else if asset.type === AssetType.Video}
				{#key mediaKey}
					<video class="h-[350px] w-full rounded-sm object-cover" controls>
						<track kind="captions" />
						<source
							src={`${convertFileSrc(asset.filePath)}?v=${asset.mediaReloadToken}`}
							type="video/mp4"
						/>
						{get(LL).editor.browserNoVideoSupport()}
					</video>
				{/key}
			{:else}
				<img
					class="h-32 w-full rounded-sm object-contain"
					src={`${convertFileSrc(asset.filePath)}?v=${asset.mediaReloadToken}`}
					alt={asset.fileName}
				/>
			{/if}
		</div>
	{/if}

	{#if isConvertingToCBR}
		<div class="space-y-1 border-t border-color px-2 py-2">
			<div class="flex items-center justify-between gap-2 text-[11px] text-thirdly">
				<span class="truncate">{cbrProgressStatus || get(LL).editor.convertingToCbrProgress()}</span
				>
				<span>{Math.round(cbrProgress)}%</span>
			</div>
			<div class="h-1.5 overflow-hidden rounded-full bg-black/30">
				<div
					class="h-full rounded-full bg-[var(--accent-primary)] transition-all duration-200"
					style={`width: ${cbrProgress}%`}
				></div>
			</div>
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
	{:else if asset.type === AssetType.Audio}
		<Item on:click={() => addInTheTimelineButtonClick(false, true)}>
			<div class="btn-icon">
				<span class="material-icons-outlined mr-1 text-sm">music_note</span>
				{get(LL).editor.audioOnly()}
			</div>
		</Item>
	{:else}
		<Item on:click={() => addInTheTimelineButtonClick(true, false)}>
			<div class="btn-icon">
				<span class="material-icons-outlined mr-1 text-sm">image</span>
				{get(LL).editor.setAsBackground()}
			</div>
		</Item>
	{/if}
</ContextMenu>

<ContextMenu bind:this={contextMenu}>
	{#if asset.exists}
		<Item on:click={() => asset.openParentDirectory()}>
			<div class="btn-icon">
				<span class="material-icons-outlined mr-1 text-sm">folder_open</span>
				{get(LL).editor.openDirectoryLabel()}
			</div>
		</Item>
		{#if asset.type !== AssetType.Image}
			<Item on:click={trimAsset}>
				<div class="btn-icon">
					<span class="material-icons-outlined mr-1 text-sm">content_cut</span>
					{get(LL).editor.trimLabel()}
				</div>
			</Item>
			<Item on:click={convertToCBR}>
				<div class="btn-icon">
					<span class="material-icons-outlined mr-1 text-sm">speed</span>
					{isConvertingToCBR
						? get(LL).editor.convertingLabel()
						: get(LL).editor.convertToCbrLabel()}
				</div>
			</Item>
		{/if}
	{:else}
		<Item on:click={relocateAsset}>
			<div class="btn-icon">
				<span class="material-icons-outlined mr-1 text-sm">folder_open</span>
				{get(LL).editor.relocateLabel()}
			</div>
		</Item>
		{#if asset.sourceUrl && (asset.sourceType === SourceType.YouTube || asset.sourceType === SourceType.Mp3Quran || asset.sourceType === SourceType.QuranFoundation)}
			<Item on:click={redownloadAsset}>
				<div class="btn-icon">
					<span class="material-icons-outlined mr-1 text-sm">cloud_download</span>
					{isRedownloading ? get(LL).editor.downloadingLabel() : get(LL).editor.redownloadLabel()}
				</div>
			</Item>
		{/if}
	{/if}
	<Divider />
	<Item on:click={removeAsset}>
		<div class="btn-icon danger-color">
			<span class="material-icons-outlined mr-1 text-sm">delete</span>
			{get(LL).common.remove()}
		</div>
	</Item>
</ContextMenu>
