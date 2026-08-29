<script lang="ts">
	import { Quran } from '$lib/classes/Quran';
	import { globalState } from '$lib/runes/main.svelte';
	import { onMount } from 'svelte';
	import { mouseDrag } from '$lib/services/verticalDrag';
	import CompositeText from './CompositeText.svelte';
	import { VerseRange } from '$lib/classes';
	import { getTimedOverlayOpacity } from '$lib/services/TimedOverlayVisibility';
	import { getChineseSurahTranslationLanguage } from '$lib/services/ChineseTranslationHelper';
	import { resolveStyleVisibilityOpacity } from '$lib/services/StyleVisualResolver';
	import { getTimedOverlayRanges } from '$lib/services/TimedOverlayRanges';

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
				globalState.getStyle('global', 'surah-name-time-ranges')?.value,
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

	const supportedTranslationLanguages = [
		'English',
		'Spanish',
		'French',
		'Bengali',
		'ChineseSimplified',
		'ChineseTraditional'
	] as const;
	type SupportedTranslationLanguage = (typeof supportedTranslationLanguages)[number];

	const supportedSurahTranslationUrls: Record<SupportedTranslationLanguage, string> = {
		English: '/translations/surahNames/en.json',
		Spanish: '/translations/surahNames/es.json',
		French: '/translations/surahNames/fr.json',
		Bengali: '/translations/surahNames/bn.json',
		ChineseSimplified: '/translations/surahNames/zh.json',
		ChineseTraditional: '/translations/surahNames/zh_hant.json'
	};

	const surahTranslationTagLanguages: Record<string, SupportedTranslationLanguage> = {
		en: 'English',
		es: 'Spanish',
		fr: 'French',
		bn: 'Bengali',
		zh: 'ChineseSimplified',
		zh_hant: 'ChineseTraditional',
		'zh-hant': 'ChineseTraditional'
	};

	let supportedSurahTranslations: Record<SupportedTranslationLanguage, string[]> = $state({
		English: [],
		Spanish: [],
		French: [],
		Bengali: [],
		ChineseSimplified: [],
		ChineseTraditional: []
	});

	onMount(() => {
		loadSurahNameTranslations();
	});

	async function loadSurahNameTranslations() {
		await Promise.all(
			supportedTranslationLanguages.map(async (language) => {
				const url = supportedSurahTranslationUrls[language];

				try {
					const response = await fetch(url);

					if (!response.ok) {
						throw new Error(`Failed to fetch surah names for ${language}: ${response.status}`);
					}

					const names: unknown = await response.json();

					if (Array.isArray(names)) {
						supportedSurahTranslations[language] = names as string[];
					} else {
						console.warn(`Unexpected surah name format for ${language}`, names);
						supportedSurahTranslations[language] = [];
					}
				} catch (error) {
					console.error(`Error loading surah names for ${language}:`, error);
					supportedSurahTranslations[language] = [];
				}
			})
		);
	}

	const defaultTranslationLanguage: SupportedTranslationLanguage = 'English';

	const isSupportedTranslationLanguage = (
		language: string
	): language is SupportedTranslationLanguage =>
		supportedTranslationLanguages.includes(language as SupportedTranslationLanguage);

	const preferredTranslationLanguage = $derived(() => {
		const editions = globalState.getProjectTranslation.addedTranslationEditions;

		if (!editions || editions.length === 0) {
			return defaultTranslationLanguage;
		}

		const chineseLanguage = getChineseSurahTranslationLanguage(editions);
		if (chineseLanguage) return chineseLanguage;

		for (let i = editions.length - 1; i >= 0; i--) {
			const language = editions[i].language;
			if (isSupportedTranslationLanguage(language)) {
				return language;
			}
		}

		return defaultTranslationLanguage;
	});

	/**
	 * Retourne le nom traduit de la sourate courante pour la langue demandée.
	 * @param {SupportedTranslationLanguage} language Langue de traduction des noms de sourates.
	 * @returns {string} Nom traduit, avec fallback anglais puis donnée Quran locale.
	 */
	function getSurahTranslatedName(language: SupportedTranslationLanguage): string {
		const surahIndex = currentSurah() - 1;
		if (surahIndex < 0 || surahIndex >= Quran.surahs.length) {
			return '';
		}

		const translations = supportedSurahTranslations[language];
		const translationFromPreferred = translations?.[surahIndex];

		if (translationFromPreferred && translationFromPreferred.trim().length > 0) {
			return translationFromPreferred;
		}

		const englishFallback = supportedSurahTranslations.English?.[surahIndex];
		if (englishFallback && englishFallback.trim().length > 0) {
			return englishFallback;
		}

		return Quran.surahs[surahIndex]?.translation ?? '';
	}

	const surahTranslatedName = $derived(() => {
		return getSurahTranslatedName(preferredTranslationLanguage());
	});

	/**
	 * Remplace les tags du format de nom de sourate par leurs valeurs courantes.
	 * @returns {string} Format résolu pour la sourate affichée.
	 */
	function formatSurahName(): string {
		return surahNameSettings()
			.surahNameFormat.replace(/<translation-([a-z_-]+)>/gi, (_match: string, code: string) => {
				const language = surahTranslationTagLanguages[code.toLowerCase()];
				return language ? getSurahTranslatedName(language) : '';
			})
			.replace('<number>', currentSurah().toString())
			.replace('<transliteration>', Quran.surahs[currentSurah() - 1].name)
			.replace('<translation>', surahTranslatedName())
			.replace(
				'<min-range>',
				VerseRange.getExportVerseRange().getRangeForSurah(currentSurah()).verseStart.toString()
			)
			.replace(
				'<max-range>',
				VerseRange.getExportVerseRange().getRangeForSurah(currentSurah()).verseEnd.toString()
			);
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
