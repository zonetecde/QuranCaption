<script lang="ts">
	import { ProjectEditorTabs } from '$lib/classes';
	import { globalState } from '$lib/runes/main.svelte';

	let tabs = $state([
		{ name: 'Video editor', icon: 'edit', value: ProjectEditorTabs.VideoEditor },
		{ name: 'Subtitles editor', icon: 'subtitles', value: ProjectEditorTabs.SubtitlesEditor },
		{ name: 'Translations', icon: 'translate', value: ProjectEditorTabs.Translations },
		{ name: 'Style', icon: 'auto_fix_high', value: ProjectEditorTabs.Style },
		{ name: 'Export', icon: 'upload_file', value: ProjectEditorTabs.Export }
	]);

	function setActiveTab(tabValue: ProjectEditorTabs) {
		globalState.getStylesState.clearSelection();
		globalState.currentProject!.projectEditorState.currentTab = tabValue;
	}
</script>

<div class="w-full h-11 flex items-center justify-center space-x-1 border-color flex-shrink-0">
	{#each tabs as tab}
		<button
			class="tab-button ring-0 outline-none flex items-center {globalState.currentProject!
				.projectEditorState.currentTab === tab.value
				? 'active'
				: ''}"
			type="button"
			onclick={() => setActiveTab(tab.value)}
		>
			<span class="material-icons mr-2">{tab.icon}</span>{tab.name}
		</button>
	{/each}
</div>

<style>
	.tab-button {
		padding: 0.45rem 1rem;
		border-bottom: 2px solid transparent;
		font-size: 0.775rem;
		font-weight: 500;
		color: var(--text-thirdly);
		transition: colors 200ms ease-in-out;
		background: transparent;
		border-left: none;
		border-right: none;
		border-top: none;
		cursor: pointer;
	}
	.tab-button:hover:not(.active) {
		background-color: var(--bg-accent);
		color: var(--text-secondary);
	}
	.tab-button.active {
		border-bottom-color: var(--accent-primary);
		color: var(--accent-primary);
	}
</style>
