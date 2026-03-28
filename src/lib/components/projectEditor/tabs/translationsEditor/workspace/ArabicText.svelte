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
		{#each words as word, i}
			{@const wordIndex = subtitle.startWordIndex + i}
			{@const isOverlapWord = overlapEndWordIndex !== null && wordIndex <= overlapEndWordIndex}
			<div
				class="word group flex flex-col items-center gap-y-2 relative {isOverlapWord
					? 'text-purple-200 decoration-purple-400/60 underline underline-offset-4'
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

	<p class="text-sm text-thirdly text-left mt-1">
		{#each subtitle.wbwTranslation as word, i}
			{@const wordIndex = subtitle.startWordIndex + i}
			<span
				class={overlapEndWordIndex !== null && wordIndex <= overlapEndWordIndex
					? 'text-purple-200 decoration-purple-400/60 underline underline-offset-2'
					: ''}
			>
				{word}
			</span>{' '}
		{/each}
	</p>
{:else if subtitle instanceof PredefinedSubtitleClip}
	<p class="text-3xl arabic text-right" dir="rtl">{subtitle.text}</p>
{/if}
