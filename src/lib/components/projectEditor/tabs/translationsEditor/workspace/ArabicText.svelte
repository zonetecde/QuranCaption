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
	import { WbwTranslationService } from '$lib/services/WbwTranslationService';
	import { onMount } from 'svelte';

	let {
		subtitle,
		overlapEndWordIndex = null
	}: {
		subtitle: SubtitleClip | PredefinedSubtitleClip;
		overlapEndWordIndex?: number | null;
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

	let arabicDisplayParts = $derived(() => subtitle.getArabicRenderParts());
	let words = $derived(() => arabicDisplayParts().text.split(' ').filter(Boolean));
	let wbwTranslationWords = $state<string[]>([]);
	let wbwTranslationRequestId = 0;
	let activeInlineFlags = $derived(() => ({
		bold: translationsEditorState().inlineStyleBoldEnabled,
		italic: translationsEditorState().inlineStyleItalicEnabled,
		underline: translationsEditorState().inlineStyleUnderlineEnabled,
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
				Boolean(activeInlineFlags().color))
		) {
			// Comme pour les traductions, un drag applique/toggle les styles actifs sur toute la plage.
			subtitle.toggleArabicInlineStyles(
				inlineSelectionStart,
				inlineSelectionEnd,
				activeInlineFlags()
			);
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
		class="text-3xl flex flex-row arabic text-right gap-x-2 flex-wrap gap-y-2"
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
				class="word group relative flex flex-col items-center gap-y-2 rounded-md p-0 ring-1 ring-transparent transition-colors {isOverlapWord
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
				onclick={() => {
					if (isTranslationWbwMappingMode()) {
						translationsEditorState().translationWbwActiveArabicWordIndex = i;
					}
				}}
			>
				<span style={getInlineStyleCss(flags)}>{word}</span>

				<span
					class="word-translation-tooltip group-hover:block hidden text-sm absolute top-10 w-max px-1.5 border-2 rounded-lg text-center z-20"
					dir={wbwTranslationDirection()}
				>
					{subtitle instanceof SubtitleClip
						? wbwTranslationWords[absoluteWordIndex - subtitle.startWordIndex] || ''
						: ''}
				</span>
			</button>
		{/each}

		{#if arabicDisplayParts().suffix}
			<span
				style={arabicDisplayParts().suffixFontFamily
					? `font-family: ${arabicDisplayParts().suffixFontFamily};`
					: ''}
			>
				{arabicDisplayParts().suffix}
			</span>
		{/if}
	</div>

	{#if subtitle instanceof SubtitleClip && !isInlineStyleMode() && !isTranslationWbwMappingMode()}
		<p
			class="text-sm text-thirdly mt-1 space-x-1 {wbwTranslationDirection() === 'rtl'
				? 'text-right'
				: 'text-left'}"
			dir={wbwTranslationDirection()}
		>
			{#each wbwTranslationWords as word, i (`${subtitle.id}-wbw-${i}`)}
				{@const wordIndex = subtitle.startWordIndex + i}
				<span
					class={overlapEndWordIndex !== null && wordIndex <= overlapEndWordIndex
						? 'overlap-wbw-word'
						: ''}
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
</style>
