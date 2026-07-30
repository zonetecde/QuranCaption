<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import { downloadAndApply, likePreset } from '../actions/communityActions';
	import { getResolutionLabel } from '../actions/presetUtils';
	import type { CommunityStylePreset } from '$lib/services/StylePresetLibraryService';
	import LL from '$lib/i18n/i18n-svelte';

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

<article class="group min-w-0 overflow-hidden rounded-lg border border-color bg-primary/50">
	<button
		class="flex min-w-0 w-full text-left"
		type="button"
		onclick={() => downloadAndApply(preset)}
		disabled={downloadingPresetId !== null}
	>
		<div class="relative aspect-video w-28 shrink-0 self-stretch overflow-hidden bg-black/30">
			<img
				class="h-full w-full object-cover"
				src={preset.previewUrl}
				alt={preset.name}
				loading="lazy"
			/>
		</div>
		<div class="min-w-0 flex-1 space-y-1.5 p-2">
			<div class="min-w-0">
				<h4 class="truncate text-sm font-semibold text-primary">{preset.name}</h4>
				<p class="truncate text-[11px] text-secondary">
					{$LL.style.presetAuthor({ author: preset.authorName })}
				</p>
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
			{#if preset.description}
				<p class="line-clamp-2 text-[11px] leading-snug text-thirdly">{preset.description}</p>
			{:else if preset.tags.length > 0}
				<div class="flex gap-1 overflow-hidden">
					{#each preset.tags.slice(0, 2) as tag (tag)}
						<span class="truncate rounded bg-black/25 px-1.5 py-0.5 text-[10px] text-thirdly">
							#{tag}
						</span>
					{/each}
				</div>
			{/if}
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
				title={$LL.editor.likePreset()}
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
				title={$LL.editor.downloadAndApply()}
				disabled={downloadingPresetId !== null}
				onclick={handleDownload}
			>
				<span class="material-icons-outlined text-[27px]!">download</span>
			</button>
		</div>
	</div>
</article>
