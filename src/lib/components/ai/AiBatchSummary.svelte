<script lang="ts">
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { getAiBatchEnd, getAiBatchLimits, type AiBatchCopy } from '$lib/services/AiBatchSettings';

	let {
		subtitles,
		feature,
		total = null
	}: {
		subtitles: readonly { text: string }[];
		feature: 'correction' | 'references' | 'rearrangement' | 'translation';
		total?: number | null;
	} = $props();
	const copy = $derived(($LL.settings as unknown as { aiBatches: AiBatchCopy }).aiBatches);
	const count = $derived.by(() => {
		const limits = getAiBatchLimits(
			globalState.settings?.aiTranslationSettings,
			feature === 'translation'
		);
		const entries =
			feature === 'correction'
				? subtitles
				: subtitles.flatMap(({ text }) => (text.match(/\S+/gu) ?? []).map((text) => ({ text })));
		const size =
			feature === 'correction'
				? limits.items
				: feature === 'rearrangement'
					? Math.max(1, limits.words - 50)
					: limits.words;
		let batches = 0;
		for (let offset = 0; offset < entries.length; batches++)
			offset = getAiBatchEnd(entries, offset, size, limits.characters);
		return batches;
	});
</script>

<div class="space-y-1 rounded-lg border border-color bg-secondary p-3">
	<p class="text-sm text-primary">
		{total === null ? copy.preview() : copy.total()} :
		<strong>{total === null ? `≈ ${count}` : total}</strong>
	</p>
	{#if total === null}<p class="text-xs leading-relaxed text-thirdly">{copy.estimate()}</p>{/if}
</div>
