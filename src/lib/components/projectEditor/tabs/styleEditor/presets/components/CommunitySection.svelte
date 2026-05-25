<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { loadCommunity } from '../actions/communityActions';
	import PresetFilters from './PresetFilters.svelte';
	import PresetCard from './PresetCard.svelte';

	let communityPresets = $derived(globalState.presetLibrary.communityPresets);
	let communityError = $derived(globalState.presetLibrary.communityError);
	let isLoadingCommunity = $derived(globalState.presetLibrary.isLoadingCommunity);
</script>

<section class="space-y-3 border-t border-color pt-4">
	<div>
		<h3 class="text-sm font-semibold text-primary">Community presets</h3>
		<p class="text-xs text-secondary">Download a shared style to save and apply it locally.</p>
	</div>

	<PresetFilters />

	{#if communityError}
		<div class="rounded-lg border border-red-400/35 bg-red-500/10 px-3 py-3 text-sm text-red-100">
			<div class="flex items-start gap-2">
				<span class="material-icons-outlined text-base">error</span>
				<div class="min-w-0 flex-1">
					<p class="font-medium">Unable to load community presets</p>
					<p class="mt-0.5 text-xs text-red-100/80">{communityError}</p>
				</div>
				<button class="btn px-2 py-1 text-xs" type="button" onclick={() => loadCommunity()}>
					Retry
				</button>
			</div>
		</div>
	{:else if isLoadingCommunity}
		<div class="grid grid-cols-2 gap-3">
			{#each Array(4) as _, index (index)}
				<div class="h-44 animate-pulse rounded-lg border border-color bg-primary/50"></div>
			{/each}
		</div>
	{:else if communityPresets.length === 0}
		<div
			class="flex flex-col items-center justify-center gap-2 rounded-lg border border-color bg-primary/40 px-4 py-10 text-center"
		>
			<span class="material-icons-outlined text-2xl text-thirdly">travel_explore</span>
			<p class="text-sm font-medium text-primary">No community presets found</p>
			<p class="text-xs text-thirdly">Try another search, tag, or orientation.</p>
		</div>
	{:else}
		<div class="grid grid-cols-2 gap-3">
			{#each communityPresets as preset (preset.id)}
				<PresetCard {preset} />
			{/each}
		</div>
	{/if}
</section>
