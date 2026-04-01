<script lang="ts">
	import { slide } from 'svelte/transition';
	import { globalState } from '$lib/runes/main.svelte';
	import ModalManager from './modals/ModalManager';
	import { WaveformService } from '$lib/services/WaveformService.svelte.js';

	let showToolsPopover = $state(false);

	function handleClickOutside(event: Event) {
		if (!showToolsPopover) return;

		const toolsButton = document.getElementById('tools-popover-button');
		const toolsPopover = document.getElementById('tools-popover');

		if (
			toolsButton &&
			toolsPopover &&
			!toolsButton.contains(event.target as Node) &&
			!toolsPopover.contains(event.target as Node)
		) {
			showToolsPopover = false;
		}
	}

	function runAction(action: () => void) {
		showToolsPopover = false;
		action();
	}
</script>

<svelte:window on:click={handleClickOutside} />

<button
	id="tools-popover-button"
	class="w-10 cursor-pointer rounded-full hover:bg-gray-700 relative"
	type="button"
	disabled={globalState.uiState.isTourActive}
	onclick={(event) => {
		event.stopPropagation();
		showToolsPopover = !showToolsPopover;
	}}
	aria-haspopup="dialog"
	aria-expanded={showToolsPopover}
>
	<span class="material-icons pt-2">construction</span>
	{#if showToolsPopover}
		<div
			id="tools-popover"
			class="absolute right-0 mt-2 w-56 bg-primary border border-color rounded-lg shadow-xl py-2 z-50 overflow-hidden"
			transition:slide
		>
			<!-- svelte-ignore node_invalid_placement_ssr -->
			<button
				class="w-full text-left px-4 py-2 text-sm text-secondary transition-colors flex items-center gap-3"
				onclick={(event) => {
					event.stopPropagation();
					runAction(() => ModalManager.shiftSubtitlesModal());
				}}
			>
				<span class="material-icons text-lg text-accent">move_down</span>
				Shift All Subtitles
			</button>
			<!-- svelte-ignore node_invalid_placement_ssr -->
			<button
				class="w-full text-left px-4 py-2 text-sm text-secondary transition-colors flex items-center gap-3"
				onclick={(event) => {
					event.stopPropagation();
					runAction(() => ModalManager.audioCutterModal());
				}}
			>
				<span class="material-icons text-lg text-accent">content_cut</span>
				Asset Trimmer
			</button>
			<!-- svelte-ignore node_invalid_placement_ssr -->
			<button
				class="w-full text-left px-4 py-2 text-sm text-secondary transition-colors flex items-center gap-3"
				onclick={(event) => {
					event.stopPropagation();
					runAction(() => WaveformService.clearAllCache());
				}}
			>
				<span class="material-icons text-lg text-accent">graphic_eq</span>
				Regenerate Waveforms
			</button>
		</div>
	{/if}
</button>

