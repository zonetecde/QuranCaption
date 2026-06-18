<script lang="ts">
	import { TrackType, AssetClip, type Clip, type Track } from '$lib/classes';
	import { globalState } from '$lib/runes/main.svelte';
	import { convertFileSrc } from '@tauri-apps/api/core';
	import { onDestroy, onMount, untrack } from 'svelte';
	import WaveSurfer from 'wavesurfer.js';
	import ContextMenu, { Item, Divider } from 'svelte-contextmenu';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
	import { currentMenu } from 'svelte-contextmenu/stores';
	import { WaveformService } from '$lib/services/WaveformService.svelte.js';
	import ModalManager from '$lib/components/modals/ModalManager';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';

	let {
		clip = $bindable(),
		track = $bindable(),
		clipIndex
	}: {
		clip: Clip;
		track: Track;
		clipIndex: number;
	} = $props();

	onDestroy(() => {
		currentMenu.set(null);
	});

	let contextMenu: ContextMenu | undefined = $state(undefined); // Initialize context menu state

	let positionLeft = $derived(() => {
		return (track.getVisualClipStartTime(clipIndex) / 1000) * track.getPixelPerSecond();
	});

	const clipAssetId = (clip as AssetClip).assetId;
	const clipAsset = globalState.currentProject?.content.getAssetById(clipAssetId);
	if (!clipAsset) {
		throw new Error(`Missing asset ${clipAssetId} for clip ${clip.id}`);
	}
	const asset = clipAsset;
	let file = $derived(`${convertFileSrc(asset.filePath)}?v=${asset.mediaReloadToken}`);

	const isSelectedVideo = $derived(() => {
		return (
			track.type === TrackType.Video &&
			globalState.currentProject!.projectEditorState.currentTab === 'Style' &&
			globalState.getStylesState.isSelectedVideo(clip.id)
		);
	});

	const hasOverlayOverride = $derived(() => {
		if (track.type !== TrackType.Video) return false;
		return globalState.getVideoStyle.getStylesOfTarget('global').hasAnyOverrideForClip(clip.id);
	});

	let wavesurfer: WaveSurfer | undefined;

	/**
	 * Libère la waveform si son fichier doit être remplacé.
	 *
	 * @param {Event} event Événement global contenant le chemin du fichier.
	 * @returns {void}
	 */
	function releaseWaveformForAsset(event: Event): void {
		const filePath = (event as CustomEvent<{ filePath?: string }>).detail?.filePath;
		if (filePath !== asset.filePath || !wavesurfer) return;

		wavesurfer.destroy();
		wavesurfer = undefined;
	}

	onMount(() => {
		window.addEventListener('qurancaption-release-asset-media', releaseWaveformForAsset);
		return () => {
			window.removeEventListener('qurancaption-release-asset-media', releaseWaveformForAsset);
		};
	});

	$effect(() => {
		if (
			(asset.duration.ms < 45 * 60 * 1000 || clip.showWaveform) &&
			globalState.settings?.persistentUiState.showWaveforms &&
			track.type === TrackType.Audio
		) {
			// On dépend de refreshVersion pour forcer le recalcul si besoin
			const _v = WaveformService.refreshVersion;
			const _mediaReloadToken = asset.mediaReloadToken;

			untrack(async () => {
				if (wavesurfer) {
					wavesurfer.destroy();
					wavesurfer = undefined;
				}

				try {
					const peaks = await WaveformService.getPeaks(asset.filePath);

					wavesurfer = WaveSurfer.create({
						container: '#clip-' + clip.id,
						waveColor: '#9d99cc',
						progressColor: '#9d99cc',
						url: file,
						peaks: [peaks], // Pass peaks to avoid decoding
						duration: asset.duration.ms / 1000,
						height: 'auto'
					});
				} catch (e) {
					console.error('Failed to load waveform:', e);
					// Fallback to normal loading if backend fails
					wavesurfer = WaveSurfer.create({
						container: '#clip-' + clip.id,
						waveColor: '#9d99cc',
						progressColor: '#9d99cc',
						url: file,
						height: 'auto'
					});
				}
			});
		}

		return () => {
			if (wavesurfer) {
				wavesurfer.destroy();
				wavesurfer = undefined;
			}
		};
	});

	function removeClip() {
		setTimeout(() => {
			if (track.type === TrackType.Video && globalState.getStylesState.isSelectedVideo(clip.id)) {
				globalState.getStylesState.removeVideoSelection(clip.id);
			}
			track.removeClip(clip.id);
		});
	}

	function handleClipClick(event: MouseEvent) {
		if (globalState.getTimelineState.wasCursorDragged) {
			globalState.getTimelineState.wasCursorDragged = false;
			return;
		}

		if (
			track.type !== TrackType.Video ||
			globalState.currentProject!.projectEditorState.currentTab !== 'Style' ||
			!(clip instanceof AssetClip)
		) {
			return;
		}

		// click simple = sélection unique, Ctrl/Cmd+click = multi.
		const isMultiSelect = Boolean(event.ctrlKey || event.metaKey);
		if (isMultiSelect) {
			globalState.getStylesState.toggleVideoSelection(clip);
		} else {
			const alreadyOnlySelected =
				globalState.getStylesState.selectedVideos.length === 1 &&
				globalState.getStylesState.isSelectedVideo(clip.id);
			if (alreadyOnlySelected) {
				globalState.getStylesState.clearSelection();
			} else {
				globalState.getStylesState.selectOnlyVideo(clip);
			}
		}
	}
	function loopUntilTheEndClicked(): void {
		ProjectHistoryManager.begin('toggle looped video');
		try {
			const assetClip = clip as AssetClip;
			const willEnable = !assetClip.loopUntilAudioEnd;
			assetClip.loopUntilAudioEnd = willEnable;

			if (assetClip.loopUntilAudioEnd) {
				// If there are other clips in the track, the loop cannot be activated.
				if (track.clips.length > 1) {
					assetClip.loopUntilAudioEnd = false;
					ModalManager.errorModal(
						get(LL).editor.loopingError(),
						get(LL).editor.canOnlyEnableLoopIfOnlyClip()
					);
					return;
				}

				if (globalState.currentProject) {
					assetClip.setEndTime(
						globalState.currentProject.content.timeline.getLongestTrackDurationIgnoringLoopedVideo()
							.ms
					);
				}
			} else {
				const asset = globalState.currentProject?.content.getAssetById(assetClip.assetId);
				if (asset) {
					assetClip.setEndTime(assetClip.startTime + asset.duration.ms);
				}
			}
		} finally {
			ProjectHistoryManager.commit();
		}
	}
</script>

<div
	class={'absolute inset-0 z-10 border rounded-md group ' +
		(track.type === TrackType.Audio
			? 'border-[var(--timeline-audio-clip-border)] bg-[var(--timeline-audio-clip-color)]'
			: 'border-[var(--timeline-video-clip-border)] bg-[var(--timeline-video-clip-color)]') +
		(isSelectedVideo()
			? ' bg-[var(--video-clip-selection)]! ring-1 ring-[var(--video-clip-selection)]/60'
			: '')}
	style="width: {clip.getWidth()}px; left: {positionLeft()}px;"
	onclick={handleClipClick}
	oncontextmenu={(e) => {
		e.preventDefault();
		contextMenu!.show(e);
	}}
>
	{#if track.type === TrackType.Video && hasOverlayOverride()}
		<div class="absolute top-0.5 left-0.5 z-20 flex items-center gap-1">
			<span
				class="material-icons-outlined text-[10px] opacity-80"
				title={get(LL).editor.overlayIndividualApplied()}
			>
				auto_fix_high
			</span>
		</div>
	{/if}

	{#if (asset.duration.ms < 45 * 60 * 1000 || clip.showWaveform) && globalState.settings?.persistentUiState.showWaveforms && track.type === TrackType.Audio}
		<div class="h-full w-full" id={'clip-' + clip.id}></div>
	{:else if asset.duration.ms >= 45 * 60 * 1000 && globalState.settings?.persistentUiState.showWaveforms && track.type === TrackType.Audio}
		<div class="h-full w-full" onclick={() => (clip.showWaveform = true)}>
			{get(LL).editor.clickToGenerateWaveform()}
		</div>
	{:else}
		<div class="absolute inset-0 z-5 flex overflow-hidden px-2 py-2">
			<span class="text-xs text-[var(--text-secondary)] font-medium">{asset.fileName}</span>
		</div>
	{/if}

	<section class="absolute bottom-0.5 left-0.5 z-5">
		<!-- delete clip -->
		<button
			class="text-[var(--text-secondary)] text-sm cursor-pointer opacity-0 group-hover:opacity-100"
			onclick={(e) => {
				e.stopPropagation();
				removeClip();
			}}
		>
			<span class="material-icons">delete</span>
		</button>
	</section>
</div>

<ContextMenu bind:this={contextMenu}>
	{#if track.type === TrackType.Video && clip instanceof AssetClip}
		<Item on:click={loopUntilTheEndClicked}>
			<div class="btn-icon">
				<span class="material-icons-outlined text-sm mr-1">
					{(clip as AssetClip).loopUntilAudioEnd ? 'check_box' : 'check_box_outline_blank'}
				</span>
				{get(LL).editor.loopUntilTheEnd()}
			</div>
		</Item>
		<Divider />
	{/if}
	<Item on:click={removeClip}
		><div class="btn-icon">
			<span class="material-icons-outlined text-sm mr-1">remove</span>{get(LL).editor.removeClip()}
		</div></Item
	>
</ContextMenu>
