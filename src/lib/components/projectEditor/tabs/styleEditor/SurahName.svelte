<script lang="ts">
	import { Quran } from '$lib/classes/Quran';
	import { globalState } from '$lib/runes/main.svelte';
	import { onMount } from 'svelte';
	import { mouseDrag } from '$lib/services/verticalDrag';
	import CompositeText from './CompositeText.svelte';
	import { VerseRange } from '$lib/classes';
	import { getTimedOverlayOpacity } from '$lib/services/TimedOverlayVisibility';
	import {
		getPreferredSurahTranslationLanguage,
		getSurahTranslatedName,
		getSurahTranslationTagValues,
		loadSurahNameTranslations,
		resolveQuranTextTags
	} from '$lib/services/QuranTextTagResolver.svelte';

	const currentSurah = $derived(() => {
		return globalState.getSubtitleTrack.getCurrentSurah();
	});

	const fadeDuration = $derived(() => {
		return globalState.getStyle('global', 'fade-duration').value as number;
	});

	let surahNameSettings = $derived(() => {
		return {
			show: Boolean(globalState.getStyle('global', 'show-surah-name')!.value),
			alwaysShow: Boolean(globalState.getStyle('global', 'surah-name-always-show')!.value),
			startTime: globalState.getStyle('global', 'surah-name-time-appearance')!.value as number,
			endTime: globalState.getStyle('global', 'surah-name-time-disappearance')!.value as number,
			size: globalState.getStyle('global', 'surah-size')!.value,
			showArabic: globalState.getStyle('global', 'surah-show-arabic')!.value,
			showLatin: globalState.getStyle('global', 'surah-show-latin')!.value,
			calligraphyFontFamily:
				globalState.getStyle('global', 'surah-calligraphy-style')!.value === 'Calligraphy 2'
					? 'Surahs2'
					: 'Surahs',
			surahLatinSpacing: globalState.getStyle('global', 'surah-latin-spacing')!.value as number,
			surahNameFormat: globalState.getStyle('global', 'surah-name-format')!.value as string,
			verticalPosition: globalState.getStyle('global', 'surah-name-vertical-position')!
				.value as number,
			horizontalPosition: globalState.getStyle('global', 'surah-name-horizontal-position')!
				.value as number,
			opacity: globalState.getStyle('global', 'surah-opacity')!.value,
			color: globalState
				.getStyle('global', 'surah-latin-text-style')!
				.getCompositeStyle('text-color')!.value,
			outlineWidth: globalState
				.getStyle('global', 'surah-latin-text-style')!
				.getCompositeStyle('text-outline')!.value,
			outlineColor: globalState
				.getStyle('global', 'surah-latin-text-style')!
				.getCompositeStyle('text-outline-color')!.value,
			enableOutline: globalState
				.getStyle('global', 'surah-latin-text-style')!
				.getCompositeStyle('outline-enable')!.value,
			glowEnable: globalState
				.getStyle('global', 'surah-latin-text-style')!
				.getCompositeStyle('text-glow-enable')!.value,
			glowColor: globalState
				.getStyle('global', 'surah-latin-text-style')!
				.getCompositeStyle('text-glow-color')!.value,
			glowBlur: globalState
				.getStyle('global', 'surah-latin-text-style')!
				.getCompositeStyle('text-glow-blur')!.value
		};
	});

	const timedSurahOpacity = $derived(() => {
		return getTimedOverlayOpacity({
			alwaysShow: surahNameSettings().alwaysShow,
			maxOpacity: Number(surahNameSettings().opacity ?? 1),
			currentTime: globalState.getTimelineState.cursorPosition,
			fadeDuration: fadeDuration(),
			startTime: surahNameSettings().startTime,
			endTime: surahNameSettings().endTime
		});
	});

	onMount(() => {
		void loadSurahNameTranslations();
	});

	const preferredTranslationLanguage = $derived(() => {
		const editions = globalState.getProjectTranslation.addedTranslationEditions;
		return getPreferredSurahTranslationLanguage(editions);
	});

	const surahTranslatedName = $derived(() => {
		return getSurahTranslatedName(currentSurah(), preferredTranslationLanguage());
	});

	/**
	 * Remplace les tags du format de nom de sourate par leurs valeurs courantes.
	 * @returns {string} Format résolu pour la sourate affichée.
	 */
	function formatSurahName(): string {
		const surah = currentSurah();
		const range = VerseRange.getExportVerseRange().getRangeForSurah(surah);
		return resolveQuranTextTags(surahNameSettings().surahNameFormat, {
			number: surah,
			surah,
			minRange: range.verseStart,
			maxRange: range.verseEnd,
			transliteration: Quran.surahs[surah - 1]?.name,
			translation: surahTranslatedName(),
			translations: getSurahTranslationTagValues(surah)
		});
	}
</script>

{#if surahNameSettings().show && currentSurah() >= 1 && currentSurah() <= 114 && timedSurahOpacity() > 0}
	<div
		ondblclick={() => {
			globalState.getVideoStyle.highlightCategory('global', 'surah-name');
		}}
		use:mouseDrag={{
			target: 'global',
			verticalStyleId: 'surah-name-vertical-position',
			horizontalStyleId: 'surah-name-horizontal-position'
		}}
		class="w-[100px] absolute flex flex-col items-center cursor-move select- z-10"
		data-overlay-max-opacity={surahNameSettings().opacity}
		style={`transform: translateY(${surahNameSettings().verticalPosition}px) translateX(${surahNameSettings().horizontalPosition}px); opacity: ${timedSurahOpacity()}; `}
	>
		<p
			class="surahs-font"
			style={`opacity: ${surahNameSettings().showArabic ? 1 : 0} !important; font-size: ${surahNameSettings().size}rem !important; ${globalState.getStyle('global', 'surah-latin-text-style')!.generateCSSForComposite()}; font-family: '${surahNameSettings().calligraphyFontFamily}' !important;`}
		>
			{currentSurah().toString().padStart(3, '0')}
		</p>
		<div
			class="w-[700px] text-center"
			style={`margin-top: ${-surahNameSettings().surahLatinSpacing}rem; opacity: ${surahNameSettings().showLatin ? 1 : 0};`}
		>
			<CompositeText compositeStyle={globalState.getStyle('global', 'surah-latin-text-style')!}>
				{formatSurahName()}
			</CompositeText>
		</div>
	</div>
{/if}
