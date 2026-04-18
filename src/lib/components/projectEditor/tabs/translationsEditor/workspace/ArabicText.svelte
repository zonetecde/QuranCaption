<script lang="ts">
	import {
		ClipWithTranslation,
		PredefinedSubtitleClip,
		SubtitleClip
	} from '$lib/classes/Clip.svelte';
	import type { TranslationInlineStyleFlags } from '$lib/classes/Translation.svelte';
	import { globalState } from '$lib/runes/main.svelte';
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
	const EMPTY_INLINE_FLAGS: TranslationInlineStyleFlags = {
		bold: false,
		italic: false,
		underline: false,
		color: null
	};

	let isInlineDragging = $state(false);
	let inlineDragStartIndex = $state(-1);
	let inlineSelectionStart = $state(-1);
	let inlineSelectionEnd = $state(-1);

	let arabicDisplayParts = $derived(() => subtitle.getArabicRenderParts());
	let words = $derived(() => arabicDisplayParts().text.split(' ').filter(Boolean));
	let activeInlineFlags = $derived(() => ({
		bold: translationsEditorState().inlineStyleBoldEnabled,
		italic: translationsEditorState().inlineStyleItalicEnabled,
		underline: translationsEditorState().inlineStyleUnderlineEnabled,
		color: translationsEditorState().inlineStyleColorEnabled
			? translationsEditorState().inlineStyleColorValue
			: null
	}));

	/**
	 * Convertit l'état de style d'un mot en CSS inline pour l'affichage.
	 */
	function getInlineStyleCss(flags: TranslationInlineStyleFlags): string {
		const parts: string[] = [];
		if (flags.bold) parts.push('font-weight: 700;');
		if (flags.italic) parts.push('font-style: italic;');
		if (flags.underline) parts.push('text-decoration: underline;');
		if (flags.color) parts.push(`color: ${flags.color};`);
		return parts.join(' ');
	}

	/**
	 * Retourne les styles actuellement posés sur un mot arabe.
	 */
	function getWordFlags(wordIndex: number): TranslationInlineStyleFlags {
		for (const run of subtitle.arabicInlineStyleRuns) {
			if (run.startWordIndex <= wordIndex && wordIndex <= run.endWordIndex) {
				return {
					bold: run.bold,
					italic: run.italic,
					underline: run.underline,
					color: run.color ?? null
				};
			}
		}

		return EMPTY_INLINE_FLAGS;
	}

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
			{@const absoluteWordIndex = subtitle instanceof SubtitleClip ? subtitle.startWordIndex + i : i}
			{@const isOverlapWord =
				subtitle instanceof SubtitleClip &&
				overlapEndWordIndex !== null &&
				absoluteWordIndex <= overlapEndWordIndex}
			{@const isInlineSelected =
				isInlineStyleMode() &&
				inlineSelectionStart !== -1 &&
				inlineSelectionStart <= i &&
				i <= inlineSelectionEnd}
			{@const flags = getWordFlags(i)}
			<button
				type="button"
				class="word group relative flex flex-col items-center gap-y-2 rounded-md p-0 ring-1 ring-transparent transition-colors {isOverlapWord
					? 'overlap-arabic-word'
					: ''} {isInlineSelected ? 'arabic-inline-selected' : ''} {isInlineStyleMode()
					? 'cursor-pointer'
					: 'cursor-default'}"
				onmousedown={(event) => handleInlineMouseDown(i, event)}
				onmouseenter={() => handleInlineMouseEnter(i)}
			>
				<span style={getInlineStyleCss(flags)}>{word}</span>

				<span
					class="word-translation-tooltip group-hover:block hidden text-sm absolute top-10 w-max px-1.5 border-2 rounded-lg text-center z-20"
					dir="ltr"
				>
					{subtitle instanceof SubtitleClip
						? subtitle.wbwTranslation[absoluteWordIndex - subtitle.startWordIndex] || ''
						: ''}
				</span>
			</button>
		{/each}

		{#if arabicDisplayParts().suffix}
			<span style={arabicDisplayParts().suffixFontFamily ? `font-family: ${arabicDisplayParts().suffixFontFamily};` : ''}>
				{arabicDisplayParts().suffix}
			</span>
		{/if}
	</div>

	{#if subtitle instanceof SubtitleClip && !isInlineStyleMode()}
		<p class="text-sm text-thirdly text-left mt-1 space-x-1">
			{#each subtitle.wbwTranslation as word, i (`${subtitle.id}-wbw-${i}`)}
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
</style>
