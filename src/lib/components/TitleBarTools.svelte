<script lang="ts">
	import { slide } from 'svelte/transition';
	import { globalState } from '$lib/runes/main.svelte';
	import ModalManager from './modals/ModalManager';
	import { WaveformService } from '$lib/services/WaveformService.svelte.js';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';

	let showToolsPopover = $state(false);
	let audioEffectsLabel = $derived((Reflect.get(get(LL).tools, 'audioEffects') as () => string)());

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

	async function removeAllSubtitles() {
		if (!globalState.currentProject) return;

		const subtitleCount = globalState.getSubtitleTrack.clips.length;
		if (subtitleCount === 0) {
			await ModalManager.errorModal(
				get(LL).editor.noSubtitlesToRemove(),
				get(LL).editor.noSubtitlesError()
			);
			return;
		}

		const confirmed = await ModalManager.confirmModal(
			get(LL).editor.removeAllSubtitlesConfirm({ count: subtitleCount }),
			true
		);

		if (!confirmed) return;

		globalState.getSubtitleTrack.clips = [];
		globalState.getStylesState.clearSelection();
		globalState.getSubtitlesEditorState.editSubtitle = null;
		globalState.updateVideoPreviewUI();
	}
</script>

<svelte:window on:click={handleClickOutside} />

<button
	id="tools-popover-button"
	class="relative h-11 w-11 shrink-0 cursor-pointer rounded-xl hover:bg-gray-700"
	type="button"
	disabled={globalState.uiState.isTourActive}
	aria-label={$LL.editor.advancedOptions()}
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
			class="absolute end-0 mt-2 w-56 bg-primary border border-color rounded-lg shadow-xl py-2 z-50 overflow-hidden"
			transition:slide
		>
			<div class="px-4 py-2">
				<div class="mb-2 flex items-center gap-3 text-start text-sm text-secondary">
					<span class="material-icons text-lg text-accent">speed</span>
					{$LL.editor.playbackSpeed()}
				</div>
				<div class="grid grid-cols-5 gap-1">
					{#each [0.75, 1, 1.5, 1.75, 2] as speed (speed)}
						<!-- svelte-ignore node_invalid_placement_ssr -->
						<button
							class="rounded py-1 text-xs transition-colors {globalState.getVideoPreviewState
								.playbackSpeed === speed
								? 'bg-accent-primary text-black'
								: 'bg-secondary text-secondary hover:bg-accent'}"
							onclick={(event) => {
								event.stopPropagation();
								globalState.getVideoPreviewState.playbackSpeed = speed;
								globalState.getSubtitlesEditorState.playbackSpeed = speed;
							}}
						>
							{speed}x
						</button>
					{/each}
				</div>
			</div>
			<!-- svelte-ignore node_invalid_placement_ssr -->
			<button
				class="w-full text-start px-4 py-2 text-sm text-secondary transition-colors flex items-center gap-3"
				onclick={(event) => {
					event.stopPropagation();
					runAction(() => ModalManager.shiftSubtitlesModal());
				}}
			>
				<span class="material-icons text-lg text-accent">move_down</span>
				{$LL.editor.shiftAllSubtitles()}
			</button>
			<!-- svelte-ignore node_invalid_placement_ssr -->
			<button
				class="w-full text-start px-4 py-2 text-sm text-secondary transition-colors flex items-center gap-3"
				onclick={(event) => {
					event.stopPropagation();
					runAction(() => ModalManager.hifzRepetitionModal());
				}}
			>
				<span class="material-icons text-lg text-accent">repeat</span>
				{$LL.editor.hifzRepetition()}
			</button>
			<!-- svelte-ignore node_invalid_placement_ssr -->
			<button
				class="w-full text-start px-4 py-2 text-sm text-secondary transition-colors flex items-center gap-3"
				onclick={(event) => {
					event.stopPropagation();
					runAction(() => ModalManager.audioCutterModal());
				}}
			>
				<span class="material-icons text-lg text-accent">content_cut</span>
				{$LL.editor.assetTrimmer()}
			</button>
			<!-- svelte-ignore node_invalid_placement_ssr -->
			<button
				class="w-full text-start px-4 py-2 text-sm text-secondary transition-colors flex items-center gap-3"
				onclick={(event) => {
					event.stopPropagation();
					runAction(() => ModalManager.audioEffectsModal());
				}}
			>
				<span class="material-icons text-lg text-accent">spatial_audio</span>
				{audioEffectsLabel}
			</button>
			<!-- svelte-ignore node_invalid_placement_ssr -->
			<button
				class="w-full text-start px-4 py-2 text-sm text-secondary transition-colors flex items-center gap-3"
				onclick={(event) => {
					event.stopPropagation();
					runAction(() => ModalManager.verseRangeCropModal());
				}}
			>
				<span class="material-icons text-lg text-accent">crop</span>
				{$LL.tools.selectAyahRange()}
			</button>

			<!-- svelte-ignore node_invalid_placement_ssr -->
			<button
				class="w-full text-start px-4 py-2 text-sm text-secondary transition-colors flex items-center gap-3"
				onclick={(event) => {
					event.stopPropagation();
					runAction(() => WaveformService.clearAllCache());
				}}
			>
				<span class="material-icons text-lg text-accent">graphic_eq</span>
				{$LL.editor.regenerateWaveforms()}
			</button>
			<!-- svelte-ignore node_invalid_placement_ssr -->
			<button
				class="w-full text-start px-4 py-2 text-sm text-red-300 transition-colors flex items-center gap-3"
				onclick={(event) => {
					event.stopPropagation();
					runAction(() => {
						void removeAllSubtitles();
					});
				}}
			>
				<span class="material-icons text-lg text-red-400">delete_sweep</span>
				{$LL.editor.removeAllSubtitles()}
			</button>
		</div>
	{/if}
</button>
