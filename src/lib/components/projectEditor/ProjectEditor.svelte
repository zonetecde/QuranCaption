	<script lang="ts">
	import { onMount } from 'svelte';
	import Navigator from './Navigator.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { ProjectEditorTabs } from '$lib/classes';
	import VideoEditor from './tabs/videoEditor/VideoEditor.svelte';
	import SubtitlesEditor from './tabs/subtitlesEditor/SubtitlesEditor.svelte';
	import TranslationsEditor from './tabs/translationsEditor/TranslationsEditor.svelte';
	import StyleEditor from './tabs/styleEditor/StyleEditor.svelte';
	import Export from './tabs/export/Export.svelte';

	let saveInterval: ReturnType<typeof setInterval> | undefined;

	onMount(() => {
		// Sauvegarde automatique du projet toutes les 5 secondes
		saveInterval = setInterval(() => {
			globalState.currentProject?.save();
		}, 5000);

		// Fermer les menus contextuels lors d'un clic en dehors
		const handleGlobalClick = (e: MouseEvent) => {
			const portal = document.getElementById('context-menu-portal');
			if (portal && portal.contains(e.target as Node)) {
				return;
			}
			globalState.closeAllMenus();
		};
		window.addEventListener('mousedown', handleGlobalClick, true);

		return () => {
			if (saveInterval !== undefined) {
				clearInterval(saveInterval);
			}
			window.removeEventListener('mousedown', handleGlobalClick, true);
		};
	});
</script>

<div class="flex flex-col h-full bg-secondary min-h-0 overflow-hidden">
	<Navigator />

	{#if globalState.currentProject!.projectEditorState.currentTab === ProjectEditorTabs.VideoEditor}
		<VideoEditor />
	{:else if globalState.currentProject!.projectEditorState.currentTab === ProjectEditorTabs.SubtitlesEditor}
		<SubtitlesEditor />
	{:else if globalState.currentProject!.projectEditorState.currentTab === ProjectEditorTabs.Translations}
		<TranslationsEditor />
	{:else if globalState.currentProject!.projectEditorState.currentTab === ProjectEditorTabs.Style}
		<StyleEditor />
	{:else if globalState.currentProject!.projectEditorState.currentTab === ProjectEditorTabs.Export}
		<Export />
	{/if}
</div>
