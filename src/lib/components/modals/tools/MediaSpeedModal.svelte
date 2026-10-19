<script lang="ts">
	import {
		Asset,
		AssetClip,
		AssetType,
		TrackType,
		SubtitleClip,
		PredefinedSubtitleClip
	} from '$lib/classes';
	import { mobileModalSheet } from '$lib/services/mobileModalSheet';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
	import { refreshSegmentationContextFromTrack } from '$lib/services/autoSegmentation/context';
	import { invoke } from '@tauri-apps/api/core';
	import { exists } from '@tauri-apps/plugin-fs';
	import { get } from 'svelte/store';
	import toast from 'svelte-5-french-toast';

	type Props = { close: () => void; initialClipId?: number };
	type MediaSpeedCopy = {
		mediaSpeed: () => string;
		mediaSpeedDescription: () => string;
		mediaSpeedScale: () => string;
		mediaSpeedHint: () => string;
		mediaSpeedAdaptSubtitles: () => string;
		mediaSpeedSuccess: () => string;
		mediaSpeedFailed: (args: { error: string }) => string;
	};
	let { close, initialClipId = 0 }: Props = $props();
	let selection = $state('');
	let speed = $state(0);
	let isProcessing = $state(false);
	let adaptSubtitles = $state(false);
	let copy = $derived(get(LL).tools as unknown as MediaSpeedCopy);
	let rate = $derived(3 ** (speed / 3));
	let assets = $derived(
		globalState.currentProject?.content.assets.filter(
			(asset) => asset.type === AssetType.Audio || asset.type === AssetType.Video
		) ?? []
	);
	let clipOptions = $derived(
		globalState.currentProject?.content.timeline.tracks.flatMap((track) =>
			track.clips.flatMap((clip, index) => {
				if (!(clip instanceof AssetClip)) return [];
				const asset = assets.find((asset) => asset.id === clip.assetId);
				return asset ? [{ clip, asset, index, trackType: track.type }] : [];
			})
		) ?? []
	);
	let selectedOption = $derived(clipOptions.find(({ clip }) => selection === `clip:${clip.id}`));
	let selectedClip = $derived(selectedOption?.clip);
	let subtitleClips = $derived(
		globalState.currentProject?.content.timeline.tracks
			.filter((track) => track.type === TrackType.Subtitle)
			.flatMap((track) => track.clips) ?? []
	);
	let canAdaptSubtitles = $derived(
		selectedOption?.trackType === TrackType.Audio &&
			subtitleClips.length > 0 &&
			selectedOption.clip.duration >=
				0.9 *
					(globalState.currentProject?.content.timeline.getLongestTrackDurationIgnoringLoopedVideo()
						.ms ?? Infinity)
	);
	let selectedAsset = $derived(
		assets.find((asset) =>
			selectedClip ? asset.id === selectedClip.assetId : selection === `asset:${asset.id}`
		)
	);

	$effect(() => {
		if (initialClipId) selection = `clip:${initialClipId}`;
	});
	$effect(() => {
		if (!canAdaptSubtitles) adaptSubtitles = false;
	});

	/**
	 * Génère une nouvelle source à la vitesse choisie et adapte le clip sélectionné.
	 * @returns {Promise<void>} Fin du traitement ou de la gestion d'erreur.
	 */
	async function applySpeed(): Promise<void> {
		const project = globalState.currentProject;
		const source = selectedAsset;
		const clip = selectedClip;
		const speedRate = rate;
		const shouldAdaptSubtitles = canAdaptSubtitles && adaptSubtitles;
		if (!project || !source || isProcessing || speedRate === 1) return;
		isProcessing = true;
		try {
			const isVideo = source.type === AssetType.Video;
			const base = source.filePath.replace(/\.[^./\\]+$/, '');
			const extension = isVideo ? 'mp4' : 'wav';
			let suffix = 1;
			let outputPath = `${base}_speed_${suffix}.${extension}`;
			while (await exists(outputPath)) {
				suffix += 1;
				outputPath = `${base}_speed_${suffix}.${extension}`;
			}
			await invoke('change_media_speed', {
				sourcePath: source.filePath,
				outputPath,
				rate: speedRate,
				isVideo
			});
			const newAsset = new Asset(outputPath);
			await newAsset.ensureDurationLoaded();
			if (globalState.currentProject !== project) return;
			if (clip && !project.content.timeline.tracks.some((track) => track.clips.includes(clip)))
				return;

			ProjectHistoryManager.track(copy.mediaSpeed(), () => {
				project.content.assets.unshift(newAsset);
				if (clip) {
					const previousEndTime = clip.endTime;
					clip.assetId = newAsset.id;
					clip.sourceStartTime = Math.round(clip.sourceStartTime / speedRate);
					clip.duration = Math.max(1, Math.round((clip.endTime - clip.startTime) / speedRate));
					clip.endTime = clip.startTime + clip.duration;
					if (shouldAdaptSubtitles) {
						/**
						 * Recale un instant autour de la portion audio modifiée.
						 * @param {number} timeMs Instant initial en millisecondes.
						 * @returns {number} Instant recalé, arrondi à la milliseconde.
						 */
						const retime = (timeMs: number): number =>
							Math.round(
								timeMs <= clip.startTime
									? timeMs
									: timeMs >= previousEndTime
										? timeMs + clip.endTime - previousEndTime
										: clip.startTime + (timeMs - clip.startTime) / speedRate
							);
						for (const subtitle of subtitleClips) {
							subtitle.startTime = retime(subtitle.startTime);
							subtitle.endTime = retime(subtitle.endTime);
							subtitle.duration = subtitle.endTime - subtitle.startTime;
							if (!(subtitle instanceof SubtitleClip || subtitle instanceof PredefinedSubtitleClip))
								continue;
							const metadata = subtitle.alignmentMetadata;
							if (!metadata) continue;
							const timeFromMs = retime(metadata.timeFrom * 1000);
							subtitle.alignmentMetadata = {
								...metadata,
								timeFrom: timeFromMs / 1000,
								timeTo: retime(metadata.timeTo * 1000) / 1000,
								words: metadata.words.map((word) => ({
									...word,
									start: (retime((metadata.timeFrom + word.start) * 1000) - timeFromMs) / 1000,
									end: (retime((metadata.timeFrom + word.end) * 1000) - timeFromMs) / 1000
								}))
							};
						}
						refreshSegmentationContextFromTrack(false);
					}
					project.detail.updateVideoDetailAttributes();
				}
			});
			globalState.updateVideoPreviewUI();
			toast.success(copy.mediaSpeedSuccess());
			close();
		} catch (error) {
			console.error('Media speed change failed:', error);
			toast.error(copy.mediaSpeedFailed({ error: String(error) }));
		} finally {
			isProcessing = false;
		}
	}
</script>

<div
	class="bg-secondary flex flex-col rounded-xl shadow-2xl overflow-hidden border border-color"
	use:mobileModalSheet={close}
>
	<div class="bg-accent-primary/10 p-6 border-b border-color flex items-start gap-3">
		<span class="material-icons text-accent-primary text-3xl">speed</span>
		<div class="flex-1">
			<h2 class="text-xl font-bold text-primary">{copy.mediaSpeed()}</h2>
			<p class="text-secondary text-sm mt-1">{copy.mediaSpeedDescription()}</p>
		</div>
		<button
			onclick={close}
			disabled={isProcessing}
			aria-label={$LL.common.close()}
			class="text-thirdly hover:text-primary"
		>
			<span class="material-icons">close</span>
		</button>
	</div>
	<div class="p-6 space-y-5 overflow-y-auto min-h-0 flex-1">
		<label class="block space-y-2">
			<span class="text-sm font-semibold text-secondary">{$LL.tools.selectAsset()}</span>
			<select
				bind:value={selection}
				disabled={isProcessing}
				class="w-full bg-accent border border-color rounded-lg px-3 py-2 text-primary"
			>
				<option value="" disabled>{$LL.tools.chooseAudioOrVideo()}</option>
				<optgroup label={$LL.editor.timeline()}>
					{#each clipOptions as { clip, asset, index, trackType } (clip.id)}
						<option value={`clip:${clip.id}`}>
							{trackType === TrackType.Audio ? $LL.status.audio() : $LL.status.video()}
							#{index + 1} · {asset.fileName}
						</option>
					{/each}
				</optgroup>
				<optgroup label={$LL.editor.assets()}>
					{#each assets as asset (asset.id)}
						<option value={`asset:${asset.id}`}>{asset.fileName}</option>
					{/each}
				</optgroup>
			</select>
		</label>
		<label class="block space-y-3" for="media-speed-rate">
			<span class="flex justify-between text-sm text-secondary">
				<span>{copy.mediaSpeed()}</span><output class="font-mono text-primary"
					>{rate.toFixed(2)}×</output
				>
			</span>
			<input
				id="media-speed-rate"
				type="range"
				min="-3"
				max="3"
				step="0.1"
				bind:value={speed}
				aria-valuetext={`${rate.toFixed(2)}×`}
				disabled={isProcessing}
				class="w-full accent-accent-primary"
			/>
			<span class="block text-xs text-thirdly">{copy.mediaSpeedScale()}</span>
		</label>
		<div class="grid grid-cols-4 gap-2" dir="ltr">
			{#each [-2, -1.75, -1.5, -1.25, 1.25, 1.5, 1.75, 2] as preset (preset)}
				{@const presetRate = preset < 0 ? 1 / Math.abs(preset) : preset}
				{@const selected = Math.abs(rate - presetRate) < 1e-9}
				<button
					type="button"
					class="rounded-lg py-2 text-sm font-mono {selected
						? 'bg-accent-primary text-black'
						: 'bg-accent text-secondary'} disabled:opacity-50"
					disabled={isProcessing}
					aria-pressed={selected}
					onclick={() => {
						speed = (3 * Math.log(presetRate)) / Math.log(3);
					}}
				>
					{preset < 0 ? '−' : '+'}{Math.abs(preset)}×
				</button>
			{/each}
		</div>
		<p class="text-xs text-thirdly leading-relaxed">{copy.mediaSpeedHint()}</p>
		{#if canAdaptSubtitles}
			<label class="flex items-center gap-3 text-sm text-secondary">
				<input
					type="checkbox"
					bind:checked={adaptSubtitles}
					disabled={isProcessing}
					class="accent-accent-primary"
				/>
				{copy.mediaSpeedAdaptSubtitles()}
			</label>
		{/if}
	</div>
	<div class="p-6 border-t border-color flex justify-end gap-3">
		<button class="btn px-5 py-2" onclick={close} disabled={isProcessing}
			>{$LL.common.cancel()}</button
		>
		<button
			type="submit"
			class="btn-accent px-5 py-2 disabled:opacity-50"
			onclick={applySpeed}
			disabled={isProcessing || !selectedAsset || speed === 0}
		>
			{isProcessing ? $LL.common.processing() : $LL.common.apply()}
		</button>
	</div>
</div>
