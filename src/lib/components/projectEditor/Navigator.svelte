<script lang="ts">
	import { ProjectEditorTabs } from '$lib/classes';
	import { globalState } from '$lib/runes/main.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';

	let tabs = $state([
		{ name: get(LL).status.videoEditor(), icon: 'edit', value: ProjectEditorTabs.VideoEditor },
		{
			name: get(LL).status.subtitlesEditor(),
			icon: 'subtitles',
			value: ProjectEditorTabs.SubtitlesEditor
		},
		{
			name: get(LL).status.translations(),
			icon: 'translate',
			value: ProjectEditorTabs.Translations
		},
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

<nav
	class="editor-bottom-nav w-full shrink-0 border-t border-color bg-primary/95 backdrop-blur-md"
	aria-label="Project editor navigation"
>
	<div class="grid grid-cols-5 gap-1 px-2 py-1">
		{#each tabs as tab (tab.value)}
			<button
				class="tab-button ring-0 outline-none flex flex-col items-center justify-center gap-1 {globalState
					.currentProject!.projectEditorState.currentTab === tab.value
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
				<span class="material-icons tab-icon">{tab.icon}</span>
				<span class="tab-label">{tab.name}</span>
			</button>
		{/each}
	</div>
</nav>

<style>
	.editor-bottom-nav {
		padding-bottom: max(0.35rem, env(safe-area-inset-bottom));
	}

	.tab-button {
		padding: 0.25rem 0.35rem;
		border-radius: 0.85rem;
		border: 1px solid transparent;
		font-weight: 500;
		color: var(--text-thirdly);
		transition:
			color 200ms ease-in-out,
			background-color 200ms ease-in-out,
			border-color 200ms ease-in-out;
		background: transparent;
		cursor: pointer;
	}

	.tab-icon {
		font-size: 1.2rem;
		line-height: 1;
	}

	.tab-label {
		font-size: 0.68rem;
		line-height: 1.1;
		text-align: center;
	}

	.tab-button:hover:not(.active) {
		background-color: var(--bg-accent);
		color: var(--text-secondary);
	}
	.tab-button.active {
		border-color: color-mix(in srgb, var(--accent-primary) 30%, transparent);
		background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
		color: var(--accent-primary);
	}
</style>
