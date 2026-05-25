<script lang="ts">
	import { onMount, tick } from 'svelte';
	import Navigator from './Navigator.svelte';
	import ProjectSearchOverlay from './ProjectSearchOverlay.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { ProjectEditorTabs } from '$lib/classes';
	import { goToAdjacentSubtitleFromCursor } from '$lib/services/SubtitleNavigation';
	import VideoEditor from './tabs/videoEditor/VideoEditor.svelte';
	import SubtitlesEditor from './tabs/subtitlesEditor/SubtitlesEditor.svelte';
	import TranslationsEditor from './tabs/translationsEditor/TranslationsEditor.svelte';
	import StyleEditor from './tabs/styleEditor/StyleEditor.svelte';
	import Export from './tabs/export/Export.svelte';

	let saveInterval: ReturnType<typeof setInterval> | undefined;
	let searchOverlayVisible = $state(false);
	let searchOverlay: { focusInput: () => Promise<void>; containsFocus: () => boolean } | null =
		$state(null);

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

	/**
	 * Ouvre la recherche projet et focalise son champ.
	 * @returns {Promise<void>} Promesse résolue après la mise au focus.
	 */
	async function openProjectSearch(): Promise<void> {
		searchOverlayVisible = true;
		await tick();
		await searchOverlay?.focusInput();
	}

	/**
	 * Ferme la recherche projet.
	 * @returns {void}
	 */
	function closeProjectSearch(): void {
		searchOverlayVisible = false;
	}

	/**
	 * Gère le raccourci Ctrl/Cmd+F du projet.
	 * @param {KeyboardEvent} event Événement clavier.
	 * @returns {void}
	 */
	function handleProjectSearchShortcut(event: KeyboardEvent): void {
		if (event.key === 'Escape' && searchOverlayVisible) {
			event.preventDefault();
			closeProjectSearch();
			return;
		}

		if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'f') return;

		if (searchOverlayVisible && searchOverlay?.containsFocus()) {
			return;
		}

		if (isTypingTarget(event.target)) return;

		event.preventDefault();
		void openProjectSearch();
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
		window.addEventListener('keydown', handleProjectSearchShortcut, true);
		window.addEventListener('keydown', handleSubtitleNavigationShortcut, true);

		return () => {
			if (saveInterval !== undefined) {
				clearInterval(saveInterval);
			}
			window.removeEventListener('mousedown', handleGlobalClick, true);
			window.removeEventListener('keydown', handleProjectSearchShortcut, true);
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

	{#if searchOverlayVisible}
		<ProjectSearchOverlay bind:this={searchOverlay} onClose={closeProjectSearch} />
	{/if}
</div>
