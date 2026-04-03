<script lang="ts">
	import { PredefinedSubtitleClip, SubtitleClip } from '$lib/classes/Clip.svelte';

	let {
		subtitle,
		overlapEndWordIndex = null
	}: {
		subtitle: SubtitleClip | PredefinedSubtitleClip;
		overlapEndWordIndex?: number | null;
	} = $props();
</script>

{#if subtitle instanceof SubtitleClip}
	{@const words = subtitle.getTextWithVerseNumber().split(' ')}

	<div class="text-3xl flex flex-row arabic text-right gap-x-2 flex-wrap gap-y-2" dir="rtl">
		{#each words as word, i (`${subtitle.id}-${i}-${word}`)}
			{@const wordIndex = subtitle.startWordIndex + i}
			{@const isOverlapWord = overlapEndWordIndex !== null && wordIndex <= overlapEndWordIndex}
			<div
				class="word group flex flex-col items-center gap-y-2 relative {isOverlapWord
					? 'overlap-arabic-word'
					: ''}"
				role="button"
				tabindex="0"
			>
				<span>{word + ' '}</span>

				<!-- Si ce n'est pas le numéro de verset -->
				{#if i !== words.length - 1 || !subtitle.isLastWordsOfVerse}
					<span
						class="word-translation-tooltip group-hover:block hidden text-sm absolute top-10 w-max px-1.5 border-2 rounded-lg text-center z-20"
						dir="ltr"
					>
						{subtitle.wbwTranslation[wordIndex - subtitle.startWordIndex] || ''}
					</span>
				{/if}
			</div>
		{/each}
	</div>

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
{:else if subtitle instanceof PredefinedSubtitleClip}
	<p class="text-3xl arabic text-right" dir="rtl">{subtitle.text}</p>
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
</style>
