<script lang="ts">
	import DownloadFromQuranicUniversalAudioSection from './DownloadFromQuranicUniversalAudioSection.svelte';
	import DownloadFromYouTubeSection from './DownloadFromYouTubeSection.svelte';
	import ProjectAssetSection from './ProjectAssetSection.svelte';
	import StockMediaLibrary from './StockMediaLibrary.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
	import { globalState } from '$lib/runes/main.svelte';

	let {
		stockMediaOpen = false,
		showHeader = true,
		embedded = false
	}: {
		stockMediaOpen?: boolean;
		showHeader?: boolean;
		embedded?: boolean;
	} = $props();

	function openStockMedia() {
		globalState.stockMediaLibrary.libraryOpen = true;
	}

	function closeStockMedia() {
		globalState.stockMediaLibrary.libraryOpen = false;
	}
</script>

<div
	data-tour-id="assets-manager"
	class={`bg-secondary h-full relative overflow-auto ${
		embedded ? 'space-y-4 px-0 py-0' : 'border border-color rounded-lg py-6 px-2 space-y-6'
	}`}
>
	{#if stockMediaOpen}
		<StockMediaLibrary onBack={closeStockMedia} />
	{:else}
		{#if showHeader}
			<div class="flex gap-x-2 items-center justify-center mb-6">
				<span class="material-icons text-accent text-xl">movie</span>
				<h2 class="text-xl font-bold text-primary">{get(LL).editor.videoEditorLabel()}</h2>
			</div>
		{/if}

		<ProjectAssetSection />

		<div class="border-t border-color"></div>

		<button
			class="btn-accent w-full flex items-center justify-center py-2 px-3 rounded-md text-sm mt-4 cursor-pointer transition-colors duration-200"
			type="button"
			onclick={openStockMedia}
		>
			<span class="material-icons mr-2 text-base">public</span>
			{get(LL).editor.stockMedia()}
		</button>

		<DownloadFromQuranicUniversalAudioSection />
		<DownloadFromYouTubeSection />
	{/if}
</div>
