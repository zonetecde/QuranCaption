<script lang="ts">
	import {
		getTranscriptReferenceInlineStyledSegments,
		getTranscriptReferenceRenderParts,
		getTranscriptReferenceWordOffset
	} from '$lib/components/projectEditor/videoPreview/helpers/transcriptReferences';
	import type { SubtitleClip } from '$lib/classes/Clip.svelte';
	import {
		getInlineStyleCss,
		getInlineStyleFlagsForWordIndex,
		tokenizeTranslationText
	} from '$lib/classes/Translation.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { prefetchTranscriptReferences } from '$lib/services/TranscriptReferenceService';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
	import TranslationWordSelector from './translation/TranslationWordSelector.svelte';

	let {
		subtitle,
		isPlaying = false,
		onPlaybackToggle
	}: {
		subtitle: SubtitleClip;
		isPlaying?: boolean;
		onPlaybackToggle?: () => void;
	} = $props();
	const translationsEditorState = $derived(
		() => globalState.currentProject!.projectEditorState.translationsEditor
	);
	const styledWords = $derived(() =>
		renderParts().flatMap((part) => {
			const offset = getTranscriptReferenceWordOffset(subtitle.text, part);
			// Une référence Quran reste une seule unité dans le texte source.
			const tokens = part.isQuran
				? [{ text: part.text, isWord: true, wordIndex: 0 }]
				: tokenizeTranslationText(part.text);
			return tokens
				.filter((token) => token.isWord && token.wordIndex !== null)
				.map((token) => {
					const wordIndex = offset + token.wordIndex!;
					const flags = getInlineStyleFlagsForWordIndex(subtitle.arabicInlineStyleRuns, wordIndex);
					return {
						text: token.text,
						wordIndex,
						lineBreak: flags.lineBreak,
						style: `${part.extraCss} ${getInlineStyleCss(flags)}`
					};
				});
		})
	);

	/**
	 * Applique les styles actifs à une plage de mots arabes avec historique.
	 * @param {number} start Index du premier mot sélectionné.
	 * @param {number} end Index du dernier mot sélectionné.
	 * @returns {void}
	 */
	function applyInlineStyles(start: number, end: number): void {
		const state = translationsEditorState();
		ProjectHistoryManager.track('style arabic words', () => {
			subtitle.toggleArabicInlineStyles(start, end, {
				bold: state.inlineStyleBoldEnabled,
				italic: state.inlineStyleItalicEnabled,
				underline: state.inlineStyleUnderlineEnabled,
				lineBreak: state.inlineStyleLineBreakEnabled,
				color: state.inlineStyleColorEnabled ? state.inlineStyleColorValue : null,
				glow: state.inlineStyleGlowEnabled ? state.inlineStyleGlowColorValue : null
			});
		});
		globalState.updateVideoPreviewUI();
	}

	let renderVersion = $state(0);
	const renderParts = $derived(() => {
		const _ = renderVersion;
		const mushafStyle = String(
			globalState.getStyle('arabic-quran', 'mushaf-style')?.value ?? 'Uthmani'
		);
		const fontFamily = String(globalState.getStyle('arabic-quran', 'font-family')?.value ?? 'QPC2');
		return (
			getTranscriptReferenceRenderParts(subtitle.text, mushafStyle, fontFamily) ?? [
				{
					text: subtitle.text,
					isQuran: false,
					isCitation: false,
					extraCss: ''
				}
			]
		);
	});
	$effect(() => {
		const text = subtitle.text;
		void prefetchTranscriptReferences([text]).then(() => {
			renderVersion += 1;
		});
	});
</script>

<div class="relative rounded-xl border border-color bg-accent/70 p-4">
	<div class="noto-sans-arabic text-right text-2xl leading-[1.9] text-primary" dir="rtl">
		{#if translationsEditorState().isInlineStyleMode}
			<TranslationWordSelector
				words={styledWords()}
				direction="rtl"
				onSelection={applyInlineStyles}
			/>
		{:else}
			{#each renderParts() as part, index (`${subtitle.id}-${index}-${part.text}`)}
				<span
					class={part.isQuran
						? 'rounded-md bg-emerald-500/10 px-1 text-emerald-100'
						: part.isCitation
							? 'rounded-md bg-amber-500/10 px-1 text-amber-100'
							: ''}
					style={part.extraCss}
					dir="rtl"
				>
					{#each getTranscriptReferenceInlineStyledSegments(subtitle.text, part, subtitle.arabicInlineStyleRuns) as segment}
						<span style={getInlineStyleCss(segment)}>{segment.text}</span>
					{/each}
				</span>
			{/each}
		{/if}
	</div>
	{#if onPlaybackToggle}
		<button
			type="button"
			class="absolute left-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-accent text-primary opacity-70 transition-opacity hover:opacity-100"
			aria-label={$LL.settings.shortcutAction.PLAY_PAUSE()}
			data-translation-playback-clip-id={subtitle.id}
			onclick={onPlaybackToggle}
		>
			<span class="material-icons text-lg">{isPlaying ? 'pause' : 'play_arrow'}</span>
		</button>
	{/if}
</div>

<style>
	.noto-sans-arabic {
		font-family: 'Noto Sans Arabic', sans-serif;
	}

	.noto-sans-arabic :global(.translation-style-flow),
	.noto-sans-arabic :global(.translation-word-style) {
		font-size: inherit;
		line-height: inherit;
	}
</style>
