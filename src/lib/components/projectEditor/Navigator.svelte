<script lang="ts">
	import { ProjectEditorTabs } from '$lib/classes';
	import { globalState } from '$lib/runes/main.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';

	let tabs = $state([
		{ name: get(LL).status.videoEditor(), icon: 'edit', value: ProjectEditorTabs.VideoEditor },
		{ name: get(LL).status.subtitlesEditor(), icon: 'subtitles', value: ProjectEditorTabs.SubtitlesEditor },
		{ name: get(LL).status.translations(), icon: 'translate', value: ProjectEditorTabs.Translations },
		{ name: get(LL).status.style(), icon: 'auto_fix_high', value: ProjectEditorTabs.Style },
		{ name: get(LL).status.export(), icon: 'upload_file', value: ProjectEditorTabs.Export }
	]);

	function setActiveTab(tabValue: ProjectEditorTabs) {
		globalState.getStylesState.clearSelection();
		if (globalState.shared.quickTimelineEditor.active) {
			globalState.closeQuickTimelineEditor();
		}
		globalState.currentProject!.projectEditorState.currentTab = tabValue;
	}
</script>

<div class="w-full h-11 flex items-center justify-center space-x-1 border-color flex-shrink-0">
	{#each tabs as tab (tab.value)}
		<button
			class="tab-button ring-0 outline-none flex items-center {globalState.currentProject!
				.projectEditorState.currentTab === tab.value
				? 'active'
				: ''}"
			type="button"
			onclick={() => setActiveTab(tab.value)}
			data-tour-id={tab.value === ProjectEditorTabs.SubtitlesEditor
				? 'nav-tab-subtitles'
				: tab.value === ProjectEditorTabs.Translations
					? 'nav-tab-translations'
					: tab.value === ProjectEditorTabs.Style
						? 'nav-tab-style'
						: tab.value === ProjectEditorTabs.Export
							? 'nav-tab-export'
							: undefined}
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
