<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { untrack } from 'svelte';
	import { mouseDrag } from '$lib/services/verticalDrag';
	import CompositeText from './CompositeText.svelte';
	import { SubtitleClip, VerseRange } from '$lib/classes';
	import { resolveQuranTextTags } from '$lib/services/QuranTextTagResolver.svelte';
	import { resolveStyleVisibilityOpacity } from '$lib/services/StyleVisualResolver';
	import { isNonHafsRiwayah, RiwayahProvider } from '$lib/services/RiwayahProvider';

	let {
		currentSurah,
		currentVerse
	}: {
		currentSurah: number;
		currentVerse: number;
	} = $props();

	const fadeDuration = $derived(() => {
		return globalState.getStyleValue('global', 'fade-duration') as number;
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
		const verse = getVerseNumber(subtitle);

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
				getVerseNumber(clip) !== verse ||
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
				getVerseNumber(clip) !== verse ||
				clip.startTime > endTime + 1
			) {
				break;
			}
			endTime = clip.endTime;
		}

		return { startTime, endTime };
	});

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

	/**
	 * Résout le numéro ou la plage de versets selon la riwayah effective du clip.
	 * @param {SubtitleClip} subtitle Sous-titre à résoudre.
	 * @returns {number | string} Numéro affiché, ou une chaîne vide sans numéro disponible.
	 */
	function getVerseNumber(subtitle: SubtitleClip): number | string {
		const riwayah = globalState.getVideoStyle
			.getStylesOfTarget('arabic')
			.getEffectiveValue('riwayah', subtitle.id);
		if (isNonHafsRiwayah(riwayah)) {
			const slice = RiwayahProvider.getVerseSlice(
				riwayah,
				subtitle.surah,
				subtitle.verse,
				subtitle.startWordIndex,
				subtitle.endWordIndex,
				false
			);
			return slice?.targetAyahs.join('-') ?? '';
		}
		return subtitle.verse;
	}

	/**
	 * Remplace les balises du format de numéro de verset par leurs valeurs courantes.
	 * @returns {string} Format résolu pour le verset affiché.
	 */
	function formatVerseNumber(): string {
		const range = VerseRange.getExportVerseRange().getRangeForSurah(currentSurah);
		const subtitle = currentSubtitle();
		const verse = subtitle instanceof SubtitleClip ? getVerseNumber(subtitle) : currentVerse;
		if (verse === '') return '';
		return resolveQuranTextTags(verseNumberSettings().verseNumberFormat, {
			number: verse,
			surah: currentSurah,
			verse,
			minRange: range.verseStart,
			maxRange: range.verseEnd
		});
	}
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
				{formatVerseNumber()}
			</CompositeText>
		</div>
	</div>
{/if}
