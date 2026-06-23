<script lang="ts">
	import { Quran } from '$lib/classes/Quran';
	import { globalState } from '$lib/runes/main.svelte';
	import { onMount } from 'svelte';
	import { mouseDrag } from '$lib/services/verticalDrag';
	import CompositeText from './CompositeText.svelte';
	import { VerseRange } from '$lib/classes';
	import { getTimedOverlayOpacity } from '$lib/services/TimedOverlayVisibility';
	import { getChineseSurahTranslationLanguage } from '$lib/services/ChineseTranslationHelper';

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
