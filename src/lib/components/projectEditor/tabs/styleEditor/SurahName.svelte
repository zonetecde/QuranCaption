<script lang="ts">
	import { Quran } from '$lib/classes/Quran';
	import { globalState } from '$lib/runes/main.svelte';
import { onMount } from 'svelte';
import { mouseDrag } from '$lib/services/verticalDrag';
import { draw, fade } from 'svelte/transition';
import CompositeText from './CompositeText.svelte';
import { VerseRange } from '$lib/classes';

const currentSurah = $derived(() => {
	return globalState.getSubtitleTrack.getCurrentSurah();
});

	let surahNameSettings = $derived(() => {
		return {
			show: globalState.getStyle('global', 'show-surah-name')!.value,
			size: globalState.getStyle('global', 'surah-size')!.value,
			showArabic: globalState.getStyle('global', 'surah-show-arabic')!.value,
			showLatin: globalState.getStyle('global', 'surah-show-latin')!.value,
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

const supportedTranslationLanguages = ['English', 'Spanish', 'French'] as const;
type SupportedTranslationLanguage = (typeof supportedTranslationLanguages)[number];

const supportedSurahTranslationUrls: Record<SupportedTranslationLanguage, string> = {
	English: '/translations/surahNames/en.json',
	Spanish: '/translations/surahNames/es.json',
	French: '/translations/surahNames/fr.json'
};

let supportedSurahTranslations: Record<SupportedTranslationLanguage, string[]> = $state({
	English: [],
	Spanish: [],
	French: []
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

		for (let i = editions.length - 1; i >= 0; i--) {
			const language = editions[i].language;
			if (isSupportedTranslationLanguage(language)) {
				return language;
			}
		}

		return defaultTranslationLanguage;
	});

	const surahTranslatedName = $derived(() => {
		const surahIndex = currentSurah() - 1;
		if (surahIndex < 0 || surahIndex >= Quran.surahs.length) {
			return '';
		}

		const language = preferredTranslationLanguage();
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
	});
</script>

{#if surahNameSettings().show && currentSurah() >= 1 && currentSurah() <= 114}
	<div
		ondblclick={() => {
			globalState.getVideoStyle.highlightCategory('global', 'surah-name');
		}}
		use:mouseDrag={{
			target: 'global',
			verticalStyleId: 'surah-name-vertical-position',
			horizontalStyleId: 'surah-name-horizontal-position'
		}}
		class="w-[100px] absolute flex flex-col items-center cursor-move select-none"
		style={`transform: translateY(${surahNameSettings().verticalPosition}px) translateX(${surahNameSettings().horizontalPosition}px); opacity: ${surahNameSettings().opacity}; `}
	>
		<p
			class="surahs-font"
			style={`opacity: ${surahNameSettings().showArabic ? 1 : 0} !important; font-size: ${surahNameSettings().size}rem !important; ${globalState.getStyle('global', 'surah-latin-text-style')!.generateCSSForComposite()}; font-family: 'Surahs' !important;`}
		>
			{currentSurah().toString().padStart(3, '0')}
		</p>
		<div
			class="w-[700px] text-center"
			style={`margin-top: ${-surahNameSettings().surahLatinSpacing}rem; opacity: ${surahNameSettings().showLatin ? 1 : 0};`}
		>
			<CompositeText compositeStyle={globalState.getStyle('global', 'surah-latin-text-style')!}>
				{surahNameSettings()
					.surahNameFormat.replace('<number>', currentSurah().toString())
					.replace('<transliteration>', Quran.surahs[currentSurah() - 1].name)
					.replace('<translation>', surahTranslatedName())
					.replace(
						'<min-range>',
						VerseRange.getExportVerseRange().getRangeForSurah(currentSurah()).verseStart.toString()
					)
					.replace(
						'<max-range>',
						VerseRange.getExportVerseRange().getRangeForSurah(currentSurah()).verseEnd.toString()
					)}
			</CompositeText>
		</div>
	</div>
{/if}
