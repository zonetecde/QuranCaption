<script lang="ts">
	import DownloadFromQuranicUniversalAudioSection from './DownloadFromQuranicUniversalAudioSection.svelte';
	import DownloadFromYouTubeSection from './DownloadFromYouTubeSection.svelte';
	import ProjectAssetSection from './ProjectAssetSection.svelte';
	import StockMediaLibrary from './StockMediaLibrary.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
	import { globalState } from '$lib/runes/main.svelte';

	let { stockMediaOpen = false }: { stockMediaOpen?: boolean } = $props();

	function openStockMedia() {
		globalState.stockMediaLibrary.libraryOpen = true;
	}

	function closeStockMedia() {
		globalState.stockMediaLibrary.libraryOpen = false;
	}
</script>

<div
	data-tour-id="assets-manager"
	class="bg-secondary h-full border border-color rounded-lg px-3 py-3 space-y-4 relative overflow-auto"
>
	{#if stockMediaOpen}
		<StockMediaLibrary onBack={closeStockMedia} />
	{:else}
		<!-- En-tête avec icône -->
		<div class="flex items-center gap-x-2">
			<span class="material-icons text-accent text-lg">movie</span>
			<h2 class="text-base font-semibold text-primary">{get(LL).editor.videoEditorLabel()}</h2>
		</div>

		<ProjectAssetSection />

		<div class="border-t border-color"></div>

		<button
			class="btn w-full flex items-center justify-center py-1.5 px-3 rounded-md text-sm mt-2 cursor-pointer transition-colors duration-200"
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
