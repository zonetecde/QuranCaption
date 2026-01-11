<script lang="ts">
	import { ProjectEditorTabs } from '$lib/classes';
	import { globalState } from '$lib/runes/main.svelte';
	import ModalManager from '../modals/ModalManager';

	let showToolsMenu = $state(false);

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

	function toggleToolsMenu(event: MouseEvent) {
		event.stopPropagation();
		showToolsMenu = !showToolsMenu;
	}

	function handleClickOutside(event: MouseEvent) {
		if (showToolsMenu) {
			const toolsButton = document.getElementById('tools-menu-button');
			const toolsMenu = document.getElementById('tools-menu-popover');
			if (
				toolsButton &&
				toolsMenu &&
				!toolsButton.contains(event.target as Node) &&
				!toolsMenu.contains(event.target as Node)
			) {
				showToolsMenu = false;
			}
		}
	}
</script>

<svelte:window onclick={handleClickOutside} />

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

	<div class="relative">
		<button
			id="tools-menu-button"
			class="tab-button ring-0 outline-none flex items-center {showToolsMenu ? 'active' : ''}"
			type="button"
			onclick={toggleToolsMenu}
		>
			<span class="material-icons mr-2">construction</span>Tools
		</button>

		{#if showToolsMenu}
			<div
				id="tools-menu-popover"
				class="absolute right-0 mt-2 w-56 bg-secondary border border-color rounded-lg shadow-xl py-2 z-50 overflow-hidden"
			>
				<button
					class="w-full text-left px-4 py-2 text-sm text-secondary hover:bg-accent hover:text-primary transition-colors flex items-center gap-3"
					onclick={() => {
						showToolsMenu = false;
						ModalManager.shiftSubtitlesModal();
					}}
				>
					<span class="material-icons text-lg">move_down</span>
					Shift All Subtitles
				</button>
				<button
					class="w-full text-left px-4 py-2 text-sm text-secondary hover:bg-accent hover:text-primary transition-colors flex items-center gap-3"
					onclick={() => {
						showToolsMenu = false;
						ModalManager.audioCutterModal();
					}}
				>
					<span class="material-icons text-lg">content_cut</span>
					Audio Cutter
				</button>
				<button
					class="w-full text-left px-4 py-2 text-sm text-secondary hover:bg-accent hover:text-primary transition-colors flex items-center gap-3"
					onclick={() => {
						showToolsMenu = false;
						ModalManager.audioMergeModal();
					}}
				>
					<span class="material-icons text-lg">merge</span>
					Audio Merge
				</button>
				<!-- Add future tools here -->
			</div>
		{/if}
	</div>
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
