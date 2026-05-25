<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { downloadAndApply, likePreset } from '../actions/communityActions';
	import { getResolutionLabel } from '../actions/presetUtils';
	import type { CommunityStylePreset } from '$lib/services/StylePresetLibraryService';

	let { preset }: { preset: CommunityStylePreset } = $props();

	let downloadingPresetId = $derived(globalState.presetLibrary.downloadingPresetId);
	let likingPresetId = $derived(globalState.presetLibrary.likingPresetId);
	let likedPresetIds = $derived(globalState.presetLibrary.likedPresetIds);

	function handleDownload(e: MouseEvent) {
		e.stopPropagation();
		downloadAndApply(preset);
	}

	function handleLike() {
		likePreset(preset);
	}
</script>

<article class="group overflow-hidden rounded-lg border border-color bg-primary/50">
	<button
		class="block w-full text-left"
		type="button"
		onclick={() => downloadAndApply(preset)}
		disabled={downloadingPresetId !== null}
	>
		<div class="relative aspect-video w-full overflow-hidden bg-black/30">
			<img
				class="h-full w-full object-cover"
				src={preset.previewUrl}
				alt={preset.name}
				loading="lazy"
			/>
			{#if preset.description}
				<div
					class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/40 to-transparent px-2 pb-1.5 pt-6 opacity-0 transition-opacity group-hover:opacity-100"
				>
					<p class="line-clamp-2 text-[11px] leading-tight text-white/90">
						{preset.description}
					</p>
				</div>
			{/if}
		</div>
		<div class="space-y-2 p-2">
			<div class="min-w-0">
				<h4 class="truncate text-sm font-semibold text-primary">{preset.name}</h4>
				<p class="truncate text-xs text-secondary">by {preset.authorName}</p>
			</div>
			<div class="flex flex-wrap gap-1">
				<span
					class="rounded border border-color bg-accent px-1.5 py-0.5 text-[10px] text-secondary"
				>
					{preset.orientation}
				</span>
				<span
					class="rounded border border-color bg-accent px-1.5 py-0.5 text-[10px] text-secondary"
				>
					{getResolutionLabel(preset.resolution)}
				</span>
			</div>
			<div class="min-h-[18px]">
				{#if preset.tags.length > 0}
					<div class="flex gap-1 overflow-hidden">
						{#each preset.tags.slice(0, 3) as tag (tag)}
							<span class="truncate rounded bg-black/25 px-1.5 py-0.5 text-[10px] text-thirdly">
								#{tag}
							</span>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</button>
	<div
		class="flex items-center justify-between border-t border-color px-2 py-1.5 text-xs text-secondary"
	>
		<div class="flex items-center gap-2">
			<span class="inline-flex items-center gap-1">
				<span class="material-icons-outlined text-sm">download</span>
				{preset.downloadCount}
			</span>
			<span class="inline-flex items-center gap-1">
				<span class="material-icons-outlined text-sm">favorite</span>
				{preset.likeCount}
			</span>
		</div>
		<div class="flex items-center gap-0.5">
			<button
				class={(likedPresetIds.has(preset.id)
					? 'text-red-400'
					: 'text-thirdly hover:text-red-400') +
					' flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-red-500/10 disabled:opacity-60'}
				type="button"
				title="Like preset"
				disabled={likingPresetId !== null || likedPresetIds.has(preset.id)}
				onclick={handleLike}
			>
				<span class="material-icons-outlined text-base">
					{likingPresetId === preset.id ? 'hourglass_empty' : 'favorite'}
				</span>
			</button>

			<button
				class="flex h-7 w-7 items-center justify-center rounded text-thirdly transition-colors hover:bg-primary hover:text-primary disabled:opacity-60"
				type="button"
				title="Download and apply"
				disabled={downloadingPresetId !== null}
				onclick={handleDownload}
			>
				<span class="material-icons-outlined text-[27px]!">download</span>
			</button>
		</div>
	</div>
</article>
