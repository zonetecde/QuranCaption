<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import Timeline from '../../timeline/Timeline.svelte';
	import VideoPreview from '../../videoPreview/VideoPreview.svelte';
	import DiviseurRedimensionnable from '../DiviseurRedimensionnable.svelte';
	import StyleEditorSettings from './StyleEditorSettings.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { ProjectEditorTabs } from '$lib/classes';

	/** Ouverture de la librairie de presets (état géré dans globalState). */
	let presetLibraryOpen = $derived(globalState.presetLibrary.libraryOpen);

	/** Ouvre la librairie de presets. */
	function openPresetLibrary() {
		globalState.presetLibrary.libraryOpen = true;
	}

	/** Ferme la librairie de presets. */
	function closePresetLibrary() {
		globalState.presetLibrary.libraryOpen = false;
	}

	/**
	 * Handle the keyboard shortcut for selecting all subtitles.
	 * @param event The keyboard event
	 */
	function handleSelectAllSubtitlesShortcut(event: KeyboardEvent) {
		if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a') return;
		if (globalState.currentProject?.projectEditorState.currentTab !== ProjectEditorTabs.Style)
			return;

		// Vérifie qu'on ne cible pas un champ de saisie
		const target = event.target;
		if (
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLSelectElement ||
			(target instanceof HTMLElement && target.isContentEditable)
		) {
			return;
		}

		event.preventDefault();
		globalState.getStylesState.selectAllSubtitles();
	}

	onMount(() => {
		document.addEventListener('keydown', handleSelectAllSubtitlesShortcut, true);
	});

	onDestroy(() => {
		document.removeEventListener('keydown', handleSelectAllSubtitlesShortcut, true);
	});
</script>

<div class="flex-grow w-full max-w-full flex overflow-hidden h-full min-h-0">
	<!-- Assets -->
	<section
		class={(presetLibraryOpen ? '2xl:w-[700px] w-[600px]' : '2xl:w-[350px] w-[300px]') +
			' flex-shrink-0 divide-y-2 divide-color max-h-full overflow-hidden flex flex-col transition-[width] duration-200'}
	>
		<StyleEditorSettings {presetLibraryOpen} {openPresetLibrary} {closePresetLibrary} />
	</section>
	<section class="flex-1 min-w-0 flex flex-row max-h-full min-h-0">
		<section class="w-full min-w-0 flex flex-col min-h-0">
			<!-- Video preview -->
			<VideoPreview showControls />

			<DiviseurRedimensionnable />

			<!-- Timeline -->
			<Timeline />
		</section>
	</section>
</div>

<style>
</style>
