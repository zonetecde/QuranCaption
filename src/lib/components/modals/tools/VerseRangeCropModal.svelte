<script lang="ts">
	import { AssetClip, Clip, SilenceClip, SubtitleClip } from '$lib/classes';
	import { CustomClip } from '$lib/classes/Clip.svelte';
	import VerseRangeSlider from '$lib/components/projectEditor/tabs/export/VerseRangeSlider.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
	import { syncTimedOverlayLegacyRange } from '$lib/services/TimedOverlayRanges';
	import { get } from 'svelte/store';
	import { slide } from 'svelte/transition';
	import toast from 'svelte-5-french-toast';
	import ModalManager from '../ModalManager';

	type AyahOption = {
		key: string;
		surah: number;
		startTime: number;
		endTime: number;
		clipIds: number[];
	};

	let { close } = $props<{ close: () => void }>();

	const quranClips = globalState.currentProject
		? globalState.getSubtitleTrack.clips.filter(
				(clip): clip is SubtitleClip => clip instanceof SubtitleClip
			)
		: [];
	const ayahOptions = buildAyahOptions(quranClips);

	let startVerseIndex = $state(0);
	let endVerseIndex = $state(Math.max(0, ayahOptions.length - 1));

	const selectedRangeLabel = $derived(
		ayahOptions.length > 0
			? `${ayahOptions[startVerseIndex].key} – ${ayahOptions[endVerseIndex].key}`
			: ''
	);
	const selectedQuranClips = $derived.by(() => {
		const selectedClipIds = new Set(
			ayahOptions.slice(startVerseIndex, endVerseIndex + 1).flatMap((option) => option.clipIds)
		);
		return quranClips.filter((clip) => selectedClipIds.has(clip.id));
	});

	/**
	 * Regroupe les clips Quran consécutifs appartenant au même verset.
	 *
	 * @param {SubtitleClip[]} clips Clips Quran à regrouper dans l'ordre de la timeline.
	 * @returns {AyahOption[]} Options de versets utilisables par le slider.
	 */
	function buildAyahOptions(clips: SubtitleClip[]): AyahOption[] {
		const options: AyahOption[] = [];

		for (const clip of [...clips].sort((first, second) => first.startTime - second.startTime)) {
			const key = `${clip.surah}:${clip.verse}`;
			const previous = options.at(-1);
			if (previous?.key === key) {
				previous.startTime = Math.min(previous.startTime, clip.startTime);
				previous.endTime = Math.max(previous.endTime, clip.endTime);
				previous.clipIds.push(clip.id);
				continue;
			}

			options.push({
				key,
				surah: clip.surah,
				startTime: clip.startTime,
				endTime: clip.endTime,
				clipIds: [clip.id]
			});
		}

		return options;
	}

	/**
	 * Déplace la borne de début vers le verset choisi.
	 *
	 * @param {number} index Index du premier verset à conserver.
	 * @returns {void}
	 */
	function handleVerseStartInput(index: number): void {
		startVerseIndex = Math.max(0, Math.min(index, endVerseIndex));
	}

	/**
	 * Déplace la borne de fin vers le verset choisi.
	 *
	 * @param {number} index Index du dernier verset à conserver.
	 * @returns {void}
	 */
	function handleVerseEndInput(index: number): void {
		endVerseIndex = Math.min(ayahOptions.length - 1, Math.max(index, startVerseIndex));
	}

	/**
	 * Ignore les limites de transaction pendant la sélection locale de la modale.
	 *
	 * @returns {void}
	 */
	function handleRangeDrag(): void {
		return;
	}

	/**
	 * Rogne un clip à une fenêtre temporelle puis décale son début à zéro.
	 *
	 * @param {Clip} clip Clip à rogner.
	 * @param {number} cropStartMs Début exact du rognage.
	 * @param {number} cropEndMs Fin exacte du rognage.
	 * @returns {boolean} `true` lorsque le clip chevauche encore la fenêtre.
	 */
	function cropClipToRange(clip: Clip, cropStartMs: number, cropEndMs: number): boolean {
		if (clip instanceof CustomClip && clip.category?.getStyle('time-ranges')) {
			const ranges = clip.getTimedOverlayRanges();
			if (!ranges.some((range) => range.endTime > cropStartMs && range.startTime < cropEndMs)) {
				return false;
			}

			const croppedRanges = ranges
				.map((range) => ({
					startTime: Math.max(range.startTime, cropStartMs) - cropStartMs,
					endTime: Math.min(range.endTime, cropEndMs) - cropStartMs
				}))
				.filter((range) => range.endTime > range.startTime);
			const firstRange = croppedRanges[0];
			if (!firstRange) return false;

			clip.category.getStyle('time-ranges')!.value = croppedRanges;
			syncTimedOverlayLegacyRange(clip.category.styles, firstRange);
			clip.startTime = firstRange.startTime;
			clip.endTime = firstRange.endTime;
			clip.duration = firstRange.endTime - firstRange.startTime;
			return clip.duration > 0;
		}

		if (clip.endTime <= cropStartMs || clip.startTime >= cropEndMs) return false;

		const originalStartTime = clip.startTime;
		const nextStartTime = Math.max(originalStartTime, cropStartMs) - cropStartMs;
		const nextEndTime = Math.min(clip.endTime, cropEndMs) - cropStartMs;

		if (clip instanceof AssetClip) {
			clip.sourceStartTime += Math.max(0, cropStartMs - originalStartTime);
		}

		clip.startTime = nextStartTime;
		clip.endTime = nextEndTime;
		clip.duration = nextEndTime - nextStartTime;

		if (clip instanceof SubtitleClip && clip.alignmentMetadata) {
			const offsetSeconds = cropStartMs / 1000;
			clip.alignmentMetadata = {
				...clip.alignmentMetadata,
				timeFrom: clip.alignmentMetadata.timeFrom - offsetSeconds,
				timeTo: clip.alignmentMetadata.timeTo - offsetSeconds
			};
		}

		if (clip instanceof CustomClip && clip.category) {
			const appearance = clip.category.getStyle('time-appearance');
			const disappearance = clip.category.getStyle('time-disappearance');
			if (appearance) appearance.value = nextStartTime;
			if (disappearance) disappearance.value = nextEndTime;
		}

		return clip.duration > 0;
	}

	/**
	 * Retire les métadonnées d'une fusion visuelle devenue partielle après le rognage.
	 *
	 * @param {SubtitleClip[]} originalClips Clips Quran avant le rognage.
	 * @param {SubtitleClip[]} retainedClips Clips Quran conservés.
	 * @returns {void}
	 */
	function clearPartialVisualMerges(
		originalClips: SubtitleClip[],
		retainedClips: SubtitleClip[]
	): void {
		const originalCounts = new Map<string, number>();
		const retainedCounts = new Map<string, number>();

		for (const clip of originalClips) {
			if (!clip.visualMergeGroupId) continue;
			originalCounts.set(
				clip.visualMergeGroupId,
				(originalCounts.get(clip.visualMergeGroupId) ?? 0) + 1
			);
		}

		for (const clip of retainedClips) {
			if (!clip.visualMergeGroupId) continue;
			retainedCounts.set(
				clip.visualMergeGroupId,
				(retainedCounts.get(clip.visualMergeGroupId) ?? 0) + 1
			);
		}

		for (const clip of retainedClips) {
			const groupId = clip.visualMergeGroupId;
			if (groupId && retainedCounts.get(groupId) !== originalCounts.get(groupId)) {
				clip.clearVisualMerge();
			}
		}
	}

	/**
	 * Confirme puis applique le rognage non destructif du projet à la plage d'Ayahs choisie.
	 *
	 * @returns {Promise<void>} Résolution après application ou annulation.
	 */
	async function applyCrop(): Promise<void> {
		const project = globalState.currentProject;
		if (!project || quranClips.length === 0) {
			toast.error(get(LL).tools.noQuranSubtitlesToCrop());
			return;
		}

		if (selectedQuranClips.length === 0) {
			toast.error(get(LL).tools.noAyahRangeSelected());
			return;
		}

		const cropStartMs = Math.min(...selectedQuranClips.map((clip) => clip.startTime));
		const cropEndMs = Math.max(...selectedQuranClips.map((clip) => clip.endTime));
		const croppedDurationMs = cropEndMs - cropStartMs;
		const confirmed = await ModalManager.confirmModal(
			get(LL).tools.cropToAyahRangeConfirm({ range: selectedRangeLabel }),
			true
		);
		if (!confirmed) return;

		const selectedClipIds = new Set(selectedQuranClips.map((clip) => clip.id));
		if (globalState.getVideoPreviewState.isPlaying) {
			globalState.getVideoPreviewState.togglePlayPause();
		}

		ProjectHistoryManager.track('crop project to ayah range', () => {
			const audioTrack = globalState.getAudioTrack;
			const videoTrack = globalState.getVideoTrack;
			const subtitleTrack = globalState.getSubtitleTrack;
			const customTrack = globalState.getCustomClipTrack;
			const backgroundClipId =
				videoTrack.clips.length === 1 &&
				videoTrack.clips[0] instanceof AssetClip &&
				videoTrack.clips[0].endTime === 0
					? videoTrack.clips[0].id
					: null;

			audioTrack.clips = audioTrack.clips.filter(
				(clip) => clip instanceof AssetClip && cropClipToRange(clip, cropStartMs, cropEndMs)
			);
			videoTrack.clips = videoTrack.clips.filter(
				(clip) =>
					clip.id === backgroundClipId ||
					(clip instanceof AssetClip && cropClipToRange(clip, cropStartMs, cropEndMs))
			);

			subtitleTrack.clips = subtitleTrack.clips.filter((clip) => {
				if (clip instanceof SubtitleClip) {
					return selectedClipIds.has(clip.id) && cropClipToRange(clip, cropStartMs, cropEndMs);
				}
				return clip instanceof SilenceClip && cropClipToRange(clip, cropStartMs, cropEndMs);
			});

			const retainedQuranClips = subtitleTrack.clips.filter(
				(clip): clip is SubtitleClip => clip instanceof SubtitleClip
			);
			clearPartialVisualMerges(quranClips, retainedQuranClips);

			customTrack.clips = customTrack.clips.filter((clip) => {
				if (!(clip instanceof CustomClip)) return false;
				return clip.getAlwaysShow() || cropClipToRange(clip, cropStartMs, cropEndMs);
			});

			const keptSubtitleIds = new Set(retainedQuranClips.map((clip) => clip.id));
			const subtitlesState = globalState.getSubtitlesEditorState;
			const context = subtitlesState.segmentationContext;
			subtitlesState.segmentationContext = {
				...context,
				alignedSegments: context.alignedSegments
					.filter((segment) => keptSubtitleIds.has(segment.clipId))
					.map((segment) => ({
						...segment,
						startMs: segment.startMs - cropStartMs,
						endMs: segment.endMs - cropStartMs
					}))
			};

			const exportState = globalState.getExportState;
			exportState.videoStartTime = 0;
			exportState.videoEndTime = croppedDurationMs;
			exportState.skipRanges = [];

			globalState.getStylesState.clearSelection();
			subtitlesState.pendingSplitEditNextId = null;
			globalState.getTimelineState.cursorPosition = 0;
			globalState.getTimelineState.movePreviewTo = 0;
			project.detail.updateVideoDetailAttributesForTracks(audioTrack, subtitleTrack);
			globalState.updateVideoPreviewUI();
		});

		toast.success(get(LL).tools.ayahRangeCropSuccess());
		close();
	}
</script>

<div
	class="bg-secondary border-color border rounded-2xl w-[720px] max-w-[94vw] max-h-[85vh] shadow-2xl shadow-black flex flex-col relative overflow-hidden"
	transition:slide
>
	<div class="bg-gradient-to-r from-accent to-bg-accent px-6 py-4 border-b border-color shrink-0">
		<div class="flex items-center justify-between gap-4">
			<div class="flex items-center gap-3">
				<div class="w-8 h-8 bg-accent-primary rounded-full flex items-center justify-center">
					<span class="material-icons text-black text-lg">crop</span>
				</div>
				<div>
					<h2 class="text-xl font-bold text-primary">{$LL.tools.selectAyahRange()}</h2>
					<p class="text-sm text-thirdly">{$LL.tools.selectAyahRangeDescription()}</p>
				</div>
			</div>

			<button
				type="button"
				class="w-8 h-8 rounded-full hover:bg-[rgba(255,255,255,0.1)] flex items-center justify-center transition-all duration-200 text-secondary hover:text-primary cursor-pointer"
				onclick={close}
			>
				<span class="material-icons text-lg">close</span>
			</button>
		</div>
	</div>

	<div class="px-6 py-5 overflow-y-auto min-h-0">
		{#if quranClips.length === 0}
			<div class="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
				{$LL.tools.noQuranSubtitlesToCrop()}
			</div>
		{:else}
			<div class="space-y-4">
				<div class="flex items-center justify-between gap-4">
					<p class="text-sm text-secondary">{$LL.tools.selectAyahRangeHint()}</p>
					<span class="rounded-md bg-accent px-2 py-1 text-xs font-semibold text-primary">
						{ayahOptions.length}{$LL.tools.ayahsAvailable()}
					</span>
				</div>
				<div class="rounded-lg border border-color bg-accent px-4 py-5">
					<div class="mb-5 text-center font-mono text-sm font-medium text-accent-primary">
						{selectedRangeLabel}
					</div>
					<VerseRangeSlider
						verses={ayahOptions}
						startIndex={startVerseIndex}
						endIndex={endVerseIndex}
						startLabel={$LL.aiVideo.fromAyah()}
						endLabel={$LL.aiVideo.toAyah()}
						onStartInput={handleVerseStartInput}
						onEndInput={handleVerseEndInput}
						onDragStart={handleRangeDrag}
						onDragEnd={handleRangeDrag}
					/>
				</div>
			</div>
		{/if}
	</div>

	<div class="border-t border-color bg-primary px-6 py-4 shrink-0">
		<div class="flex justify-end gap-3">
			<button type="button" class="btn px-5 py-2 text-sm" onclick={close}>
				{$LL.common.cancel()}
			</button>
			<button
				type="button"
				class="btn-accent px-5 py-2 text-sm flex items-center gap-2"
				onclick={applyCrop}
				disabled={quranClips.length === 0}
			>
				<span class="material-icons text-base">crop</span>
				{$LL.tools.cropToAyahRange()}
			</button>
		</div>
	</div>
</div>
