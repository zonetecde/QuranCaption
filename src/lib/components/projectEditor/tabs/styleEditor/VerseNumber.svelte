<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { untrack } from 'svelte';
	import { mouseDrag } from '$lib/services/verticalDrag';
	import CompositeText from './CompositeText.svelte';
	import { SubtitleClip, VerseRange } from '$lib/classes';

	let {
		currentSurah,
		currentVerse
	}: {
		currentSurah: number;
		currentVerse: number;
	} = $props();

	const fadeDuration = $derived(() => {
		return globalState.getStyle('global', 'fade-duration').value as number;
	});

	let getTimelineSettings = $derived(() => {
		return globalState.currentProject!.projectEditorState.timeline;
	});

	let currentSubtitle = $derived(() => {
		const _ = getTimelineSettings().cursorPosition;
		return untrack(() => {
			return globalState.getSubtitleTrack.getCurrentSubtitleToDisplay();
		});
	});

	let verseSubtitleRange = $derived(() => {
		const subtitle = currentSubtitle();
		if (!(subtitle instanceof SubtitleClip)) return null;

		// Les splits contigus du même verset partagent un seul cycle de fondu.
		const clips = globalState.getSubtitleTrack.clips;
		const currentIndex = clips.findIndex((clip) => clip.id === subtitle.id);
		let startTime = subtitle.startTime;
		let endTime = subtitle.endTime;

		for (let i = currentIndex - 1; i >= 0; i--) {
			const clip = clips[i];
			if (
				!(clip instanceof SubtitleClip) ||
				clip.surah !== currentSurah ||
				clip.verse !== currentVerse ||
				clip.endTime + 1 < startTime
			) {
				break;
			}
			startTime = clip.startTime;
		}

		for (let i = currentIndex + 1; i < clips.length; i++) {
			const clip = clips[i];
			if (
				!(clip instanceof SubtitleClip) ||
				clip.surah !== currentSurah ||
				clip.verse !== currentVerse ||
				clip.startTime > endTime + 1
			) {
				break;
			}
			endTime = clip.endTime;
		}

		return { startTime, endTime };
	});

	let verseNumberSettings = $derived(() => {
		return {
			show: Boolean(globalState.getStyle('global', 'show-verse-number')!.value),
			verticalPosition: globalState.getStyle('global', 'verse-number-vertical-position')!
				.value as number,
			horizontalPosition: globalState.getStyle('global', 'verse-number-horizontal-position')!
				.value as number,
			verseNumberFormat: globalState.getStyle('global', 'verse-number-format')!.value as string,
			opacity: globalState
				.getStyle('global', 'verse-number-text-style')!
				.getCompositeStyle('opacity')!.value as number
		};
	});

	let verseNumberSubtitleOpacity = $derived(() => {
		const range = verseSubtitleRange();
		if (!range || !verseNumberSettings().show) return 0;

		const maxOpacity = verseNumberSettings().opacity;
		const currentTime = getTimelineSettings().cursorPosition;
		const { startTime, endTime } = range;
		const halfFade = fadeDuration() / 2;

		// Fade out à la fin
		const timeLeft = endTime - currentTime;
		if (timeLeft <= halfFade) {
			return Math.max(0, (timeLeft / halfFade) * maxOpacity);
		}

		// Fade in au début
		const timeSinceStart = currentTime - startTime;
		if (timeSinceStart <= halfFade) {
			return Math.min(maxOpacity, (timeSinceStart / halfFade) * maxOpacity);
		}

		// Opacité maximale entre les fades
		return maxOpacity;
	});
</script>

{#if verseNumberSettings().show && currentSurah > 0 && currentVerse > 0 && verseNumberSubtitleOpacity() > 0}
	<div
		ondblclick={() => {
			globalState.getVideoStyle.highlightCategory('global', 'verse-number');
		}}
		use:mouseDrag={{
			target: 'global',
			verticalStyleId: 'verse-number-vertical-position',
			horizontalStyleId: 'verse-number-horizontal-position'
		}}
		class="w-[100px] absolute flex flex-col items-center cursor-move select-none z-10"
		style={`opacity: ${verseNumberSubtitleOpacity()}; transform: translateY(${verseNumberSettings().verticalPosition}px) translateX(${verseNumberSettings().horizontalPosition}px);`}
	>
		<div class="w-[700px] text-center">
			<CompositeText compositeStyle={globalState.getStyle('global', 'verse-number-text-style')!}>
				{verseNumberSettings()
					.verseNumberFormat.replace('<surah>', currentSurah.toString())
					.replace('<verse>', currentVerse.toString())
					.replace(
						'<min-range>',
						VerseRange.getExportVerseRange().getRangeForSurah(currentSurah).verseStart.toString()
					)
					.replace(
						'<max-range>',
						VerseRange.getExportVerseRange().getRangeForSurah(currentSurah).verseEnd.toString()
					)}
			</CompositeText>
		</div>
	</div>
{/if}
