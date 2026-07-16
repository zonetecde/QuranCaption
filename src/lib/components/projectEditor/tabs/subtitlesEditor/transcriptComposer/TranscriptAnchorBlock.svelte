<script lang="ts">
	import { Quran } from '$lib/classes/Quran';
	import LL from '$lib/i18n/i18n-svelte';
	import type { StructuredTranslationAnchor } from '$lib/services/StructuredTranslationService';
	import type { QuranTranscriptReference } from '$lib/services/TranscriptReferenceService';
	import TranscriptPartInput from './TranscriptPartInput.svelte';

	type Props = {
		anchor: StructuredTranslationAnchor;
		index: number;
		inputStyle: string;
		blockStyle: string;
		fontStyle: string;
		onOpenQuran: (index: number) => void;
		onUpdateQuotation: (index: number, value: string) => void;
		onRemove: (index: number) => void;
		onKeydown: (event: KeyboardEvent) => void;
	};

	let {
		anchor,
		index,
		inputStyle,
		blockStyle,
		fontStyle,
		onOpenQuran,
		onUpdateQuotation,
		onRemove,
		onKeydown
	}: Props = $props();

	/**
	 * Retourne le texte arabe couvert par une référence Quran.
	 * @param {QuranTranscriptReference | null} reference Référence du passage à afficher.
	 * @returns {Promise<string>} Texte arabe du passage.
	 */
	async function getQuranText(reference: QuranTranscriptReference | null): Promise<string> {
		if (!reference) return '';
		await Quran.load();
		const verse = await Quran.getVerse(reference.surah, reference.verse);
		if (!verse?.words.length) return '';
		return verse.getArabicTextBetweenTwoIndexes(
			reference.startWord === null ? 0 : reference.startWord - 1,
			reference.endWord === null ? verse.words.length - 1 : reference.endWord - 1
		);
	}
</script>

<div class="group/transcript-block relative w-fit max-w-full shrink-0" dir="ltr" style={blockStyle}>
	{#if anchor.type === 'quran'}
		<button
			type="button"
			class="transcript-block-main flex w-fit max-w-full cursor-pointer items-center rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-left"
			style={blockStyle}
			onclick={() => onOpenQuran(index)}
		>
			<span
				class="arabic block text-right text-xl leading-normal text-primary"
				dir="rtl"
				style={fontStyle}
			>
				{#await getQuranText(anchor.quranReference)}
					{$LL.common.loading()}
				{:then arabicText}
					{arabicText}
				{/await}
			</span>
		</button>
	{:else}
		<TranscriptPartInput
			value={anchor.value}
			variant="quotation"
			{inputStyle}
			placeholder={$LL.common.enterTextHere()}
			onInput={(value) => onUpdateQuotation(index, value)}
			{onKeydown}
		/>
	{/if}

	<button
		type="button"
		class="pointer-events-none absolute left-0 top-full z-10 flex h-4 w-full cursor-pointer items-center justify-center rounded-b-lg bg-red-500 text-white opacity-0 transition hover:bg-red-700 group-hover/transcript-block:pointer-events-auto group-hover/transcript-block:opacity-100"
		onclick={() => onRemove(index)}
		aria-label={$LL.common.remove()}
	>
		<span class="material-icons text-base!">close</span>
	</button>
</div>

<style>
	.group\/transcript-block:hover > :global(.transcript-block-main) {
		border-bottom-right-radius: 0;
		border-bottom-left-radius: 0;
	}
</style>
