<script lang="ts">
	import type { Category } from '$lib/classes/VideoStyle.svelte';
	import { SubtitleClip } from '$lib/classes/Clip.svelte';
	import { Quran } from '$lib/classes/Quran';
	import { VerseRange } from '$lib/classes/VerseRange.svelte';
	import RecitersManager from '$lib/classes/Reciter';
	import { globalState } from '$lib/runes/main.svelte';
	import { onMount } from 'svelte';
	import CompositeText from './CompositeText.svelte';
	import { mouseDrag } from '$lib/services/verticalDrag';
	import { getTimedOverlayOpacity } from '$lib/services/TimedOverlayVisibility';
	import { getTimedOverlayRangesFromStyles } from '$lib/services/TimedOverlayRanges';
	import {
		getPreferredSurahTranslationLanguage,
		getSurahTranslatedName,
		getSurahTranslationTagValues,
		loadSurahNameTranslations,
		resolveQuranTextTags
	} from '$lib/services/QuranTextTagResolver.svelte';

	let { customText, clipId }: { customText: Category; clipId: number } = $props();

	let customTextSettings = $derived(() => {
		return {
			verticalPosition: customText.getStyle('vertical-position')?.value as number,
			horizontalPosition: customText.getStyle('horizontal-position')?.value as number,
			width: Number(customText.getStyle('width')?.value ?? 80),
			text: customText.getStyle('text')?.value as string,

			opacity: () =>
				getTimedOverlayOpacity({
					alwaysShow: Boolean(customText.getStyle('always-show')?.value),
					maxOpacity: Number(customText.getStyle('opacity')?.value ?? 1),
					currentTime: globalState.getTimelineState.cursorPosition,
					fadeDuration: globalState.getStyle('global', 'fade-duration')!.value as number,
					ranges: getTimedOverlayRangesFromStyles(customText.styles),
					startTime: customText.getStyle('time-appearance')?.value as number,
					endTime: customText.getStyle('time-disappearance')?.value as number
				})
		};
	});

	onMount(() => {
		void loadSurahNameTranslations();
	});

	/**
	 * Remplace les balises Quran du texte personnalisé par les valeurs du curseur courant.
	 * @param {string} text Texte configuré par l'utilisateur.
	 * @returns {string} Texte prêt à être affiché dans l'overlay.
	 */
	function formatCustomText(text: string): string {
		const currentSurah = globalState.getSubtitleTrack.getCurrentSurah();
		const currentSubtitle = globalState.getSubtitleTrack.getCurrentSubtitleToDisplay();
		const currentVerse =
			currentSubtitle instanceof SubtitleClip ? currentSubtitle.verse : undefined;
		const range =
			currentSurah > 0
				? VerseRange.getExportVerseRange().getRangeForSurah(currentSurah)
				: undefined;
		const surah = Quran.surahs[currentSurah - 1];
		const reciter = RecitersManager.getReciterObject(
			globalState.currentProject?.detail.reciter ?? ''
		);
		const editions =
			globalState.currentProject?.content.projectTranslation.addedTranslationEditions ?? [];
		const preferredTranslationLanguage = getPreferredSurahTranslationLanguage(editions);

		return resolveQuranTextTags(text, {
			number: currentVerse,
			surah: currentSurah > 0 ? currentSurah : undefined,
			verse: currentVerse,
			minRange: range?.verseStart,
			maxRange: range?.verseEnd,
			transliteration: surah?.name,
			translation: getSurahTranslatedName(currentSurah, preferredTranslationLanguage),
			arabic: reciter.arabic,
			translations: getSurahTranslationTagValues(currentSurah)
		});
	}

	let displayedText = $derived(() => {
		const _ = globalState.getTimelineState.cursorPosition;
		return formatCustomText(customTextSettings().text);
	});

	const verticalStyle = $derived(customText.getStyle('vertical-position')!);
	const horizontalStyle = $derived(customText.getStyle('horizontal-position')!);
</script>

<div
	use:mouseDrag={{
		getInitialVertical: () => Number(verticalStyle.value),
		applyVertical: (v: number) => (verticalStyle.value = v),
		applyHorizontal: (v: number) => (horizontalStyle.value = v),
		getInitialHorizontal: () => Number(horizontalStyle.value),
		verticalMin: verticalStyle.valueMin,
		verticalMax: verticalStyle.valueMax,
		horizontalMax: horizontalStyle.valueMax,
		horizontalMin: horizontalStyle.valueMin
	}}
	class="absolute customtext cursor-move select-none z-10 text-center"
	data-clip-id={clipId}
	data-overlay-max-opacity={Number(customText.getStyle('opacity')?.value ?? 1)}
	style={`width: ${customTextSettings().width}% ; transform: translateY(${customTextSettings().verticalPosition}px) translateX(${customTextSettings().horizontalPosition}px); opacity: ${customTextSettings().opacity()}; `}
>
	<CompositeText compositeStyle={customText.getCompositeStyle()!}>
		{displayedText()}
	</CompositeText>
</div>
