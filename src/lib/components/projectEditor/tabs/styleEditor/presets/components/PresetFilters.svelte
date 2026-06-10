<script lang="ts">
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import type {
		CommunityPresetOrientation,
		CommunityPresetSort
	} from '$lib/services/StylePresetLibraryService';

	let communitySearchQuery = $derived(globalState.presetLibrary.communitySearchQuery);
	let selectedSort = $derived(globalState.presetLibrary.selectedSort);
	let selectedOrientation = $derived(globalState.presetLibrary.selectedOrientation);
	let selectedTag = $derived(globalState.presetLibrary.selectedTag);
	let popularTags = $derived(globalState.presetLibrary.popularTags);

	function setSort(value: CommunityPresetSort) {
		globalState.presetLibrary.selectedSort = value;
	}

	function setOrientation(value: CommunityPresetOrientation | 'all') {
		globalState.presetLibrary.selectedOrientation = value;
	}

	function setTag(value: string) {
		globalState.presetLibrary.selectedTag = value;
	}
</script>

<div class="grid grid-cols-2 gap-2">
	<label class="relative col-span-2 block">
		<span
			class="material-icons-outlined pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-thirdly"
		>
			search
		</span>
		<input
			bind:value={globalState.presetLibrary.communitySearchQuery}
			class="h-9 w-full rounded-md border border-color bg-primary py-1 pl-8 pr-2 text-xs text-primary outline-none transition-colors placeholder:text-thirdly focus:border-[var(--accent-primary)]"
			type="search"
			placeholder={$LL.style.searchCommunityPresets()}
		/>
	</label>
	<select
		value={selectedSort}
		onchange={(e) => setSort(e.currentTarget.value as CommunityPresetSort)}
		class="h-9 text-xs"
	>
		<option value="newest">{$LL.style.sortNewest()}</option>
		<option value="most_downloaded">{$LL.style.sortMostDownloaded()}</option>
		<option value="most_liked">{$LL.style.sortMostLiked()}</option>
	</select>
	<select
		value={selectedOrientation}
		onchange={(e) => setOrientation(e.currentTarget.value as CommunityPresetOrientation | 'all')}
		class="h-9 text-xs"
	>
		<option value="all">{$LL.style.allOrientations()}</option>
		<option value="landscape">{$LL.style.orientationLandscape()}</option>
		<option value="portrait">{$LL.style.orientationPortrait()}</option>
		<option value="square">{$LL.style.orientationSquare()}</option>
	</select>
</div>

{#if popularTags.length > 0}
	<div class="flex gap-1.5 overflow-x-auto pb-1">
		<button
			class={(selectedTag === '' ? 'btn-accent' : 'btn') + ' shrink-0 px-2 py-1 text-xs'}
			type="button"
			onclick={() => setTag('')}
		>
			{$LL.style.allTags()}
		</button>
		{#each popularTags as tag (tag.name)}
			<button
				class={(selectedTag === tag.name ? 'btn-accent' : 'btn') + ' shrink-0 px-2 py-1 text-xs'}
				type="button"
				onclick={() => setTag(tag.name)}
			>
				{tag.name} ({tag.count})
			</button>
		{/each}
	</div>
{/if}
