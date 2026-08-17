<script lang="ts">
	import {
		ClipWithTranslation,
		PredefinedSubtitleClip,
		SubtitleClip
	} from '$lib/classes/Clip.svelte';
	import {
		EMPTY_INLINE_STYLE_FLAGS,
		getInlineStyleCss,
		getInlineStyleFlagsForWordIndex,
		VerseTranslation,
		type TranslationInlineStyleFlags
	} from '$lib/classes/Translation.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
	import { WbwTranslationService } from '$lib/services/WbwTranslationService';
	import { onMount } from 'svelte';
	import LL from '$lib/i18n/i18n-svelte';

	let {
		subtitle,
		overlapEndWordIndex = null,
		isPlaying = false,
		onPlaybackToggle
	}: {
		subtitle: SubtitleClip | PredefinedSubtitleClip;
		overlapEndWordIndex?: number | null;
		isPlaying?: boolean;
		onPlaybackToggle?: () => void;
	} = $props();

	let translationsEditorState = $derived(
		() => globalState.currentProject!.projectEditorState.translationsEditor
	);
	let isInlineStyleMode = $derived(() => translationsEditorState().isInlineStyleMode);
	let isTranslationWbwMappingMode = $derived(
		() => translationsEditorState().isTranslationWbwMappingMode
	);
	let isInlineDragging = $state(false);
	let inlineDragStartIndex = $state(-1);
	let inlineSelectionStart = $state(-1);
	let inlineSelectionEnd = $state(-1);
	let openTooltipWordIndex: number | null = $state(null);

	let arabicDisplayParts = $derived(() => subtitle.getArabicRenderParts());
	let words = $derived(() => arabicDisplayParts().text.split(' ').filter(Boolean));
	let arabicVerseNumberSuffix = $derived(() => {
		if (arabicDisplayParts().suffix) return arabicDisplayParts().suffix;
		if (!(subtitle instanceof SubtitleClip) || !subtitle.isLastWordsOfVerse) return '';

		return ` ${String(subtitle.verse).replace(/\d/g, (digit) => '٠١٢٣٤٥٦٧٨٩'[Number(digit)])}`;
	});
	let wbwTranslationWords = $state<string[]>([]);
	let wbwTranslationRequestId = 0;
	let activeInlineFlags = $derived(() => ({
		bold: translationsEditorState().inlineStyleBoldEnabled,
		italic: translationsEditorState().inlineStyleItalicEnabled,
		underline: translationsEditorState().inlineStyleUnderlineEnabled,
		lineBreak: translationsEditorState().inlineStyleLineBreakEnabled,
		color: translationsEditorState().inlineStyleColorEnabled
			? translationsEditorState().inlineStyleColorValue
			: null
	}));
	let wbwTranslationDirection = $derived(() =>
		WbwTranslationService.getLanguageDirection(
			globalState.settings?.persistentUiState.wbwTranslationLanguage ?? 'en'
		)
	);

	$effect(() => {
		const language = globalState.settings?.persistentUiState.wbwTranslationLanguage ?? 'en';
		const currentSubtitle = subtitle;
		const requestId = ++wbwTranslationRequestId;

		if (!(currentSubtitle instanceof SubtitleClip)) {
			wbwTranslationWords = [];
			return;
		}

		void WbwTranslationService.getWordsForRange(
			language,
			currentSubtitle.surah,
			currentSubtitle.verse,
			currentSubtitle.startWordIndex,
			currentSubtitle.endWordIndex
		)
			.then((translatedWords) => {
				if (requestId === wbwTranslationRequestId) {
					wbwTranslationWords = translatedWords;
				}
			})
			.catch(() => {
				if (requestId === wbwTranslationRequestId) {
					wbwTranslationWords = [];
				}
			});
	});

	/**
	 * Termine le drag en appliquant les styles actifs sur la plage sélectionnée.
	 */
	function finishInlineDrag(): void {
		if (
			subtitle instanceof ClipWithTranslation &&
			isInlineDragging &&
			isInlineStyleMode() &&
			inlineSelectionStart !== -1 &&
			inlineSelectionEnd !== -1 &&
			(activeInlineFlags().bold ||
				activeInlineFlags().italic ||
				activeInlineFlags().underline ||
				Boolean(activeInlineFlags().lineBreak) ||
				Boolean(activeInlineFlags().color))
		) {
			// Comme pour les traductions, un drag applique/toggle les styles actifs sur toute la plage.
			ProjectHistoryManager.track('style arabic words', () => {
				subtitle.toggleArabicInlineStyles(
					inlineSelectionStart,
					inlineSelectionEnd,
					activeInlineFlags()
				);
			});
		}

		isInlineDragging = false;
		inlineDragStartIndex = -1;
		inlineSelectionStart = -1;
		inlineSelectionEnd = -1;
	}

	/**
	 * Démarre une sélection par drag sur les mots arabes.
	 */
	function handleInlineMouseDown(wordIndex: number, event: MouseEvent): void {
		if (!(subtitle instanceof ClipWithTranslation) || !isInlineStyleMode()) return;
		event.preventDefault();
		isInlineDragging = true;
		inlineDragStartIndex = wordIndex;
		inlineSelectionStart = wordIndex;
		inlineSelectionEnd = wordIndex;
	}

	function handleInlineMouseEnter(wordIndex: number): void {
		if (!(subtitle instanceof ClipWithTranslation) || !isInlineDragging || !isInlineStyleMode())
			return;

		inlineSelectionStart = Math.min(inlineDragStartIndex, wordIndex);
		inlineSelectionEnd = Math.max(inlineDragStartIndex, wordIndex);
	}

	/**
	 * Indique si un mot arabe possède déjà un mapping WBW sur une traduction du sous-titre.
	 *
	 * @param {number} wordIndex Index local du mot arabe.
	 * @returns {boolean} `true` si au moins une traduction le mappe.
	 */
	function isArabicWordMapped(wordIndex: number): boolean {
		if (!(subtitle instanceof ClipWithTranslation)) return false;

		const wordCount = words().length;
		return Object.values(subtitle.translations ?? {}).some(
			(translation) =>
				translation instanceof VerseTranslation &&
				translation
					.getNormalizedWbwRanges(wordCount)
					.some((range) => range.arabicWordIndex === wordIndex)
		);
	}

	onMount(() => {
		// Le mouseup peut arriver hors du composant pendant le drag.
		window.addEventListener('mouseup', finishInlineDrag);

		return () => {
			window.removeEventListener('mouseup', finishInlineDrag);
		};
	});
</script>

{#if subtitle instanceof ClipWithTranslation}
	<div
		class="flex flex-row arabic text-right flex-wrap"
		style="font-size: calc(1.75rem * var(--translation-text-scale)); column-gap: calc(0.5rem * var(--translation-text-spacing-scale)); row-gap: calc(0.5rem * var(--translation-text-spacing-scale));"
		dir="rtl"
		onmouseleave={finishInlineDrag}
	>
		{#each words() as word, i (`${subtitle.id}-${i}-${word}`)}
			{@const absoluteWordIndex =
				subtitle instanceof SubtitleClip ? subtitle.startWordIndex + i : i}
			{@const isOverlapWord =
				subtitle instanceof SubtitleClip &&
				overlapEndWordIndex !== null &&
				absoluteWordIndex <= overlapEndWordIndex}
			{@const isInlineSelected =
				isInlineStyleMode() &&
				inlineSelectionStart !== -1 &&
				inlineSelectionStart <= i &&
				i <= inlineSelectionEnd}
			{@const isWbwMappingActive =
				isTranslationWbwMappingMode() &&
				translationsEditorState().translationWbwActiveArabicWordIndex === i}
			{@const isWbwMappingMapped = isTranslationWbwMappingMode() && isArabicWordMapped(i)}
			{@const flags = getInlineStyleFlagsForWordIndex(subtitle.arabicInlineStyleRuns, i)}
			<button
				type="button"
				class="word relative flex flex-col items-center rounded-md p-0 ring-1 ring-transparent transition-colors {isOverlapWord
					? 'overlap-arabic-word'
					: ''} {isInlineSelected ? 'arabic-inline-selected' : ''} {isWbwMappingActive
					? 'arabic-wbw-active'
					: isWbwMappingMapped
						? 'arabic-wbw-mapped'
						: ''} {isInlineStyleMode() || isTranslationWbwMappingMode()
					? 'cursor-pointer'
					: 'cursor-default'}"
				onmousedown={(event) => handleInlineMouseDown(i, event)}
				onmouseenter={() => handleInlineMouseEnter(i)}
				style={`row-gap: calc(0.5rem * var(--translation-text-spacing-scale));`}
				onclick={() => {
					if (isTranslationWbwMappingMode()) {
						translationsEditorState().translationWbwActiveArabicWordIndex = i;
						return;
					}
					if (!isInlineStyleMode()) {
						openTooltipWordIndex = openTooltipWordIndex === i ? null : i;
					}
				}}
			>
				<span style={getInlineStyleCss(flags)}>
					{word}
					{#if flags.lineBreak}
						<span class="material-icons arabic-inline-line-break" aria-hidden="true">
							keyboard_return
						</span>
					{/if}
				</span>

				<span
					class="word-translation-tooltip absolute top-10 z-20 w-max rounded-lg border-2 px-1.5 text-center {openTooltipWordIndex ===
					i
						? 'block'
						: 'hidden'}"
					style="font-size: calc(0.875rem * var(--translation-text-scale));"
					dir={wbwTranslationDirection()}
				>
					{subtitle instanceof SubtitleClip
						? wbwTranslationWords[absoluteWordIndex - subtitle.startWordIndex] || ''
						: ''}
				</span>
			</button>
		{/each}

		{#if arabicVerseNumberSuffix()}
			<span
				style={arabicDisplayParts().suffixFontFamily
					? `font-family: ${arabicDisplayParts().suffixFontFamily};`
					: ''}
			>
				{arabicVerseNumberSuffix()}
			</span>
		{/if}

		{#if onPlaybackToggle}
			<button
				type="button"
				class="flex h-7 w-7 shrink-0 items-center justify-center self-center rounded-full bg-accent text-primary opacity-30 transition-opacity duration-200 group-hover/translation-card:opacity-100 mr-4"
				aria-label={$LL.settings.shortcutAction.PLAY_PAUSE()}
				data-translation-playback-clip-id={subtitle.id}
				onclick={onPlaybackToggle}
			>
				<span class="material-icons text-lg">{isPlaying ? 'pause' : 'play_arrow'}</span>
			</button>
		{/if}
	</div>

	{#if subtitle instanceof SubtitleClip && !isInlineStyleMode() && !isTranslationWbwMappingMode()}
		<p
			class="text-thirdly mt-1 {wbwTranslationDirection() === 'rtl' ? 'text-right' : 'text-left'}"
			style="font-size: calc(0.875rem * var(--translation-text-scale));"
			dir={wbwTranslationDirection()}
		>
			{#each wbwTranslationWords as word, i (`${subtitle.id}-wbw-${i}`)}
				{@const wordIndex = subtitle.startWordIndex + i}
				<span
					class="wbw-word {overlapEndWordIndex !== null && wordIndex <= overlapEndWordIndex
						? 'overlap-wbw-word'
						: ''}"
				>
					{word}
				</span>
			{/each}
		</p>
	{/if}
{/if}

<style>
	.overlap-arabic-word {
		color: var(--translation-overlap-text);
		text-decoration-line: underline;
		text-decoration-color: var(--translation-overlap-decoration);
		text-decoration-thickness: 1px;
		text-underline-offset: 0.35rem;
	}

	.overlap-wbw-word {
		color: var(--translation-overlap-text);
		text-decoration-line: underline;
		text-decoration-color: var(--translation-overlap-decoration);
		text-decoration-thickness: 1px;
		text-underline-offset: 0.2rem;
	}

	.wbw-word {
		margin-inline-end: calc(0.25rem * var(--translation-text-spacing-scale));
	}

	.arabic-inline-selected {
		background: color-mix(in srgb, var(--accent-primary) 18%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-primary) 38%, transparent);
	}

	.arabic-wbw-active {
		background: color-mix(in srgb, var(--accent-primary) 24%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-primary) 60%, transparent);
	}

	.arabic-wbw-mapped {
		background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
	}

	.arabic-inline-line-break {
		margin-inline-start: 0.1em;
		font-size: 0.55em;
		vertical-align: 0.05em;
		color: var(--accent-primary);
	}

	@media (hover: hover) {
		.word:hover .word-translation-tooltip {
			display: block;
		}
	}
</style>
