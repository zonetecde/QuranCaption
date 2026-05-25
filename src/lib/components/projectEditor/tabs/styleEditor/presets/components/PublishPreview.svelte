<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { generatePublishPreview } from '../actions/publishActions';

	let publishPreviewUrl = $derived(globalState.presetLibrary.publishPreviewUrl);
	let publishPreviewBlob = $derived(globalState.presetLibrary.publishPreviewBlob);
	let isGeneratingPreview = $derived(globalState.presetLibrary.isGeneratingPreview);
</script>

<div class="overflow-hidden rounded-lg border border-color bg-primary/50">
	<div class="aspect-video bg-black/40">
		{#if publishPreviewUrl}
			<img
				class="h-full w-full object-cover"
				src={publishPreviewUrl}
				alt="Community preset preview"
			/>
		{:else}
			<div class="flex h-full flex-col items-center justify-center gap-2 text-center">
				<span class="material-icons-outlined text-2xl text-thirdly"> add_photo_alternate </span>
				<p class="px-4 text-xs text-thirdly">
					Generate a preview from a random subtitle in the video preview.
				</p>
			</div>
		{/if}
	</div>
	<div class="flex items-center justify-between gap-3 border-t border-color p-3">
		<p class="min-w-0 text-xs text-secondary">
			{publishPreviewBlob
				? 'Preview ready. Regenerate to try another subtitle moment.'
				: 'A subtitle is required to generate a preview.'}
		</p>
		<button
			class="btn shrink-0 px-3 py-1.5 text-xs"
			type="button"
			onclick={generatePublishPreview}
			disabled={isGeneratingPreview}
		>
			{isGeneratingPreview ? 'Generating...' : 'Regenerate'}
		</button>
	</div>
</div>
