<script lang="ts">
	import { Quran } from '$lib/classes/Quran';
	import { globalState } from '$lib/runes/main.svelte';
	import { onMount } from 'svelte';
	import { mouseDrag } from '$lib/services/verticalDrag';
	import CompositeText from './CompositeText.svelte';
	import { VerseRange } from '$lib/classes';
	import { getTimedOverlayOpacity } from '$lib/services/TimedOverlayVisibility';
	import { getTimedOverlayRanges } from '$lib/services/TimedOverlayRanges';
	import { resolveStyleVisibilityOpacity } from '$lib/services/StyleVisualResolver';
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
		return globalState.getStyleValue('global', 'fade-duration') as number;
	});

	let surahNameSettings = $derived(() => {
		const styles = globalState.getVideoStyle.getStylesOfTarget('global');
		const showOpacity = resolveStyleVisibilityOpacity(styles, 'show-surah-name');
		return {
			show: showOpacity > 0,
			showOpacity,
			alwaysShow: Boolean(globalState.getStyleValue('global', 'surah-name-always-show')),
			startTime: globalState.getStyleValue('global', 'surah-name-time-appearance') as number,
			endTime: globalState.getStyleValue('global', 'surah-name-time-disappearance') as number,
			ranges: getTimedOverlayRanges(
				globalState.getStyleValue('global', 'surah-name-time-ranges'),
				globalState.getStyleValue('global', 'surah-name-time-appearance'),
				globalState.getStyleValue('global', 'surah-name-time-disappearance')
			),
			size: globalState.getStyleValue('global', 'surah-size'),
			showArabic: resolveStyleVisibilityOpacity(styles, 'surah-show-arabic'),
			showLatin: resolveStyleVisibilityOpacity(styles, 'surah-show-latin'),
			calligraphyFontFamily:
				globalState.getStyleValue('global', 'surah-calligraphy-style') === 'Calligraphy 2'
					? 'Surahs2'
					: 'Surahs',
			surahLatinSpacing: globalState.getStyleValue('global', 'surah-latin-spacing') as number,
			surahNameFormat: globalState.getStyleValue('global', 'surah-name-format') as string,
			verticalPosition: globalState.getStyleValue(
				'global',
				'surah-name-vertical-position'
			) as number,
			horizontalPosition: globalState.getStyleValue(
				'global',
				'surah-name-horizontal-position'
			) as number,
			opacity: globalState.getStyleValue('global', 'surah-opacity'),
			color: globalState
				.getStyle('global', 'surah-latin-text-style')!
				.getCompositeStyle('text-color')!
				.getValueAt(globalState.getTimelineState.cursorPosition),
			outlineWidth: globalState
				.getStyle('global', 'surah-latin-text-style')!
				.getCompositeStyle('text-outline')!
				.getValueAt(globalState.getTimelineState.cursorPosition),
			outlineColor: globalState
				.getStyle('global', 'surah-latin-text-style')!
				.getCompositeStyle('text-outline-color')!
				.getValueAt(globalState.getTimelineState.cursorPosition),
			enableOutline: globalState
				.getStyle('global', 'surah-latin-text-style')!
				.getCompositeStyle('outline-enable')!
				.getValueAt(globalState.getTimelineState.cursorPosition),
			glowEnable: globalState
				.getStyle('global', 'surah-latin-text-style')!
				.getCompositeStyle('text-glow-enable')!
				.getValueAt(globalState.getTimelineState.cursorPosition),
			glowColor: globalState
				.getStyle('global', 'surah-latin-text-style')!
				.getCompositeStyle('text-glow-color')!
				.getValueAt(globalState.getTimelineState.cursorPosition),
			glowBlur: globalState
				.getStyle('global', 'surah-latin-text-style')!
				.getCompositeStyle('text-glow-blur')!
				.getValueAt(globalState.getTimelineState.cursorPosition)
		};
	});

	const timedSurahOpacity = $derived(() => {
		return getTimedOverlayOpacity({
			alwaysShow: surahNameSettings().alwaysShow,
			maxOpacity: Number(surahNameSettings().opacity ?? 1) * surahNameSettings().showOpacity,
			currentTime: globalState.getTimelineState.cursorPosition,
			fadeDuration: fadeDuration(),
			ranges: surahNameSettings().ranges,
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
			style={`opacity: ${surahNameSettings().showArabic} !important; font-size: ${surahNameSettings().size}rem !important; ${globalState.getStyle('global', 'surah-latin-text-style')!.generateCSSForComposite()}; font-family: '${surahNameSettings().calligraphyFontFamily}' !important;`}
		>
			{currentSurah().toString().padStart(3, '0')}
		</p>
		<div
			class="w-[700px] text-center"
			style={`margin-top: ${-surahNameSettings().surahLatinSpacing}rem; opacity: ${surahNameSettings().showLatin};`}
		>
			<CompositeText compositeStyle={globalState.getStyle('global', 'surah-latin-text-style')!}>
				{formatSurahName()}
			</CompositeText>
		</div>
	</div>
{/if}
