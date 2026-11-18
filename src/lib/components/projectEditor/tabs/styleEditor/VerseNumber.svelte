<script lang="ts">
	import { getOverlayLayerZIndex } from '$lib/services/OverlayLayerService';
	import { globalState } from '$lib/runes/main.svelte';
	import { mouseDrag } from '$lib/services/verticalDrag';
	import CompositeText from './CompositeText.svelte';
	import { type Clip, SilenceClip, SubtitleClip, VerseRange } from '$lib/classes';
	import { resolveQuranTextTags } from '$lib/services/QuranTextTagResolver.svelte';
	import { resolveStyleVisibilityOpacity } from '$lib/services/StyleVisualResolver';
	import { getDisplayedVerseNumber } from '$lib/services/VerseNumberTimeline';

	const fadeDuration = $derived(() => {
		return globalState.getStyleValue('global', 'fade-duration') as number;
	});

	let verseSubtitleRange = $derived(() => {
		const track = globalState.getSubtitleTrack;
		const clip = track.getCurrentClip(globalState.getTimelineState.cursorPosition);
		if (!(clip instanceof SubtitleClip || clip instanceof SilenceClip)) return null;

		const clips = track.clips;
		const currentIndex = clips.findIndex((candidate) => candidate.id === clip.id);
		let anchorIndex = currentIndex;
		while (clips[anchorIndex] instanceof SilenceClip) anchorIndex--;
		const anchor = clips[anchorIndex];
		if (!(anchor instanceof SubtitleClip) || anchor.surah <= 0 || anchor.verse <= 0) return null;

		const verse = getDisplayedVerseNumber(anchor);
		const last = findVerseBoundary(clips, anchorIndex, 1, anchor.surah, verse);
		if (last < currentIndex) return null;

		const first = findVerseBoundary(clips, anchorIndex, -1, anchor.surah, verse);
		return {
			surah: anchor.surah,
			verse,
			startTime: clips[first].startTime,
			endTime: clips[last].endTime
		};
	});

	/**
	 * Cherche le dernier sous-titre du verset dans une direction en traversant les silences contigus.
	 * @param {Clip[]} clips Clips de la piste.
	 * @param {number} anchorIndex Index du sous-titre de depart.
	 * @param {-1 | 1} direction Sens de parcours.
	 * @param {number} surah Sourate du sous-titre de depart.
	 * @param {number | string} verse Numero affiche du verset.
	 * @returns {number} Index du dernier sous-titre compatible.
	 */
	function findVerseBoundary(
		clips: Clip[],
		anchorIndex: number,
		direction: -1 | 1,
		surah: number,
		verse: number | string
	): number {
		let boundary = anchorIndex;
		for (let index = anchorIndex + direction; clips[index]; index += direction) {
			const clip = clips[index];
			const adjacent = clips[index - direction];
			const gap =
				direction === 1 ? clip.startTime - adjacent.endTime : adjacent.startTime - clip.endTime;
			if (gap > 1) break;
			if (clip instanceof SilenceClip) continue;
			if (
				!(clip instanceof SubtitleClip) ||
				clip.surah !== surah ||
				getDisplayedVerseNumber(clip) !== verse
			) {
				break;
			}
			boundary = index;
		}
		return boundary;
	}

	let verseNumberSettings = $derived(() => {
		const showOpacity = resolveStyleVisibilityOpacity(
			globalState.getVideoStyle.getStylesOfTarget('global'),
			'show-verse-number'
		);
		return {
			show: showOpacity > 0,
			showOpacity,
			verticalPosition: globalState.getStyleValue(
				'global',
				'verse-number-vertical-position'
			) as number,
			horizontalPosition: globalState.getStyleValue(
				'global',
				'verse-number-horizontal-position'
			) as number,
			verseNumberFormat: globalState.getStyleValue('global', 'verse-number-format') as string,
			opacity: globalState
				.getStyle('global', 'verse-number-text-style')!
				.getCompositeStyle('opacity')!
				.getValueAt(globalState.getTimelineState.cursorPosition) as number
		};
	});

	let verseNumberSubtitleOpacity = $derived(() => {
		const range = verseSubtitleRange();
		if (!range || !verseNumberSettings().show) return 0;

		const maxOpacity = verseNumberSettings().opacity * verseNumberSettings().showOpacity;
		const currentTime = globalState.getTimelineState.cursorPosition;
		const halfFade = fadeDuration() / 2;
		if (halfFade <= 0) return maxOpacity;

		return (
			maxOpacity *
			Math.max(
				0,
				Math.min(
					1,
					(currentTime - range.startTime) / halfFade,
					(range.endTime - currentTime) / halfFade
				)
			)
		);
	});

	/**
	 * Remplace les balises du format de numéro de verset par leurs valeurs courantes.
	 * @returns {string} Format résolu pour le verset affiché.
	 */
	function formatVerseNumber(): string {
		const context = verseSubtitleRange();
		if (!context || context.verse === '') return '';
		const { surah, verse } = context;
		const range = VerseRange.getExportVerseRange().getRangeForSurah(surah);
		return resolveQuranTextTags(verseNumberSettings().verseNumberFormat, {
			number: verse,
			surah,
			verse,
			minRange: range.verseStart,
			maxRange: range.verseEnd
		});
	}
</script>

{#if verseNumberSubtitleOpacity() > 0}
	<div
		ondblclick={() => {
			globalState.getVideoStyle.highlightCategory('global', 'verse-number');
		}}
		use:mouseDrag={{
			target: 'global',
			verticalStyleId: 'verse-number-vertical-position',
			horizontalStyleId: 'verse-number-horizontal-position'
		}}
		data-overlay-layer="verse-number"
		style:z-index={getOverlayLayerZIndex('verse-number')}
		class="w-[100px] absolute flex flex-col items-center cursor-move select-none z-10"
		style={`opacity: ${verseNumberSubtitleOpacity()}; transform: translateY(${verseNumberSettings().verticalPosition}px) translateX(${verseNumberSettings().horizontalPosition}px);`}
	>
		<div class="w-[700px] text-center">
			<CompositeText compositeStyle={globalState.getStyle('global', 'verse-number-text-style')!}>
				{formatVerseNumber()}
			</CompositeText>
		</div>
	</div>
{/if}
