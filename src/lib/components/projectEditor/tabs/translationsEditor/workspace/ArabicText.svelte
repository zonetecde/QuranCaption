<script lang="ts">
	import type { SubtitleClip } from '$lib/classes/Clip.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import {
		getTranscriptReferenceRenderParts,
		prefetchTranscriptReferences
	} from '$lib/services/TranscriptReferenceService';

	let { subtitle }: { subtitle: SubtitleClip } = $props();
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

<div class="rounded-xl border border-color bg-accent/70 p-4">
	<div class="noto-sans-arabic text-right text-2xl leading-[1.9] text-primary" dir="rtl">
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
				{part.text}
			</span>
		{/each}
	</div>
</div>

<style>
	.noto-sans-arabic {
		font-family: 'Noto Sans Arabic', sans-serif;
	}
</style>
