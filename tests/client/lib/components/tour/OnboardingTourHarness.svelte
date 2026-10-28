<script lang="ts">
	import { onMount } from 'svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { ProjectEditorTabs } from '$lib/classes/enums';
	import Navigator from '$lib/components/projectEditor/Navigator.svelte';
	import OnboardingTour from '$lib/components/tour/OnboardingTour.svelte';
	import VideoPreview from '$lib/components/projectEditor/videoPreview/VideoPreview.svelte';

	let {
		close,
		targetDelay = 0,
		showVideoPreview = false
	}: { close: () => void; targetDelay?: number; showVideoPreview?: boolean } = $props();
	let tourVisible = $state(true);
	let targetsReady = $state(false);
	onMount(() => {
		const timer = setTimeout(() => (targetsReady = true), targetDelay);
		return () => clearTimeout(timer);
	});

	/** @returns {void} Close and unmount the tour as TourManager does. */
	function closeTour(): void {
		tourVisible = false;
		globalState.uiState.isTourActive = false;
		close();
	}
</script>

<div style="padding: 60px 20px;">
	{#if globalState.currentProject}
		<Navigator />
		{#if showVideoPreview}
			<VideoPreview showControls={false} />
		{/if}
		{#if targetsReady}
			<div style="margin-top: 50px; width: 600px; height: 250px;">
				{#if globalState.currentProject.projectEditorState.currentTab === ProjectEditorTabs.VideoEditor}
					<div data-tour-id="assets-manager" style="height: 100%;">Media</div>
				{:else if globalState.currentProject.projectEditorState.currentTab === ProjectEditorTabs.Transcription}
					<div data-tour-id="transcription-composer-area">Transcription</div>
					<button data-tour-id="transcription-help-button">?</button>
				{:else if globalState.currentProject.projectEditorState.currentTab === ProjectEditorTabs.Translations}
					<div data-tour-id="translations-workspace">Translations</div>
				{:else if globalState.currentProject.projectEditorState.currentTab === ProjectEditorTabs.Style}
					<div data-tour-id="style-subtabs">Style</div>
				{:else if globalState.currentProject.projectEditorState.currentTab === ProjectEditorTabs.Export}
					<div data-tour-id="export-range">Export</div>
				{/if}
			</div>
		{/if}
	{:else}
		<button data-tour-id="new-project-button">New Project</button>
	{/if}
</div>
{#if tourVisible}
	<OnboardingTour close={closeTour} />
{/if}
