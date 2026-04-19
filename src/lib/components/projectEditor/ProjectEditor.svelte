<script lang="ts">
	import { onMount } from 'svelte';
	import Navigator from './Navigator.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { ProjectEditorTabs } from '$lib/classes';
	import { goToAdjacentSubtitleFromCursor } from '$lib/services/SubtitleNavigation';
	import VideoEditor from './tabs/videoEditor/VideoEditor.svelte';
	import SubtitlesEditor from './tabs/subtitlesEditor/SubtitlesEditor.svelte';
	import TranslationsEditor from './tabs/translationsEditor/TranslationsEditor.svelte';
	import StyleEditor from './tabs/styleEditor/StyleEditor.svelte';
	import Export from './tabs/export/Export.svelte';

	let saveInterval: ReturnType<typeof setInterval> | undefined;

	function isTypingTarget(target: EventTarget | null): boolean {
		return (
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLSelectElement ||
			(target instanceof HTMLElement && target.isContentEditable)
		);
	}

	/**
	 * Navigation sous-titres via ArrowUp / ArrowDown
	 * active seulement dans Video editor, Style et Export.
	 */
	function handleSubtitleNavigationShortcut(event: KeyboardEvent): void {
		const tab = globalState.currentProject?.projectEditorState.currentTab;
		const isTabAllowed =
			tab === ProjectEditorTabs.VideoEditor ||
			tab === ProjectEditorTabs.Style ||
			tab === ProjectEditorTabs.Export;
		if (!isTabAllowed) return;
		if (isTypingTarget(event.target)) return;

		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;

		event.preventDefault();
		goToAdjacentSubtitleFromCursor(event.key === 'ArrowUp' ? 'next' : 'previous');
	}

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
		window.addEventListener('keydown', handleSubtitleNavigationShortcut, true);

		return () => {
			if (saveInterval !== undefined) {
				clearInterval(saveInterval);
			}
			window.removeEventListener('mousedown', handleGlobalClick, true);
			window.removeEventListener('keydown', handleSubtitleNavigationShortcut, true);
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
