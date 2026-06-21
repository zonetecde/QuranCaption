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
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';

	const AUTOSAVE_CHECK_INTERVAL_MS = 15000;
	const AUTOSAVE_RETRY_DELAY_MS = 3000;

	let saveInterval: ReturnType<typeof setInterval> | undefined;
	let saveRetryTimeout: ReturnType<typeof setTimeout> | undefined;
	let saveIdleHandle: number | undefined;
	let lastSavedSnapshot = '';
	let isAutosaveScheduled = false;
	let isAutosaving = false;
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

	$effect(() => {
		const openRequest = globalState.shared.projectSearch.openRequest;
		if (openRequest === 0) return;

		globalState.shared.projectSearch.openRequest = 0;
		void openProjectSearch();
	});

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

	/**
	 * Gère les raccourcis undo/redo du projet courant.
	 * @param {KeyboardEvent} event Événement clavier.
	 * @returns {void}
	 */
	function handleProjectHistoryShortcut(event: KeyboardEvent): void {
		if (!(event.ctrlKey || event.metaKey)) return;
		if (isTypingTarget(event.target)) return;

		const key = event.key.toLowerCase();
		const isUndo = key === 'z' && !event.shiftKey;
		const isRedo = (key === 'z' && event.shiftKey) || key === 'y';
		if (!isUndo && !isRedo) return;

		event.preventDefault();
		if (isUndo) {
			ProjectHistoryManager.undo();
			return;
		}

		ProjectHistoryManager.redo();
	}

	/**
	 * Sérialise le projet courant pour détecter une mutation réelle.
	 * @returns {string} Snapshot JSON compact du projet.
	 */
	function getProjectAutosaveSnapshot(): string {
		return JSON.stringify(globalState.currentProject?.toJSON() ?? null);
	}

	/**
	 * Marque le projet comme potentiellement modifié et planifie une sauvegarde idle.
	 * @returns {void}
	 */
	function markDirty(): void {
		scheduleSave();
	}

	/**
	 * Planifie la prochaine tentative d'autosave hors du hot path UI.
	 * @returns {void}
	 */
	function scheduleSave(): void {
		if (isAutosaveScheduled) return;
		isAutosaveScheduled = true;

		if ('requestIdleCallback' in window) {
			saveIdleHandle = window.requestIdleCallback(() => void flush(), {
				timeout: AUTOSAVE_RETRY_DELAY_MS
			});
			return;
		}

		saveRetryTimeout = setTimeout(() => void flush(), 0);
	}

	/**
	 * Annule une tentative d'autosave déjà planifiée.
	 * @returns {void}
	 */
	function clearScheduledSave(): void {
		if (saveIdleHandle !== undefined && 'cancelIdleCallback' in window) {
			window.cancelIdleCallback(saveIdleHandle);
			saveIdleHandle = undefined;
		}

		if (saveRetryTimeout !== undefined) {
			clearTimeout(saveRetryTimeout);
			saveRetryTimeout = undefined;
		}

		isAutosaveScheduled = false;
	}

	/**
	 * Exécute l'autosave si le projet a changé depuis la dernière sauvegarde.
	 * @returns {Promise<void>} Promesse résolue après la tentative de sauvegarde.
	 */
	async function flush(): Promise<void> {
		saveIdleHandle = undefined;
		saveRetryTimeout = undefined;
		isAutosaveScheduled = false;

		const project = globalState.currentProject;
		if (!project || isAutosaving) return;

		if (globalState.getVideoPreviewState.isPlaying) {
			saveRetryTimeout = setTimeout(markDirty, AUTOSAVE_RETRY_DELAY_MS);
			return;
		}

		const snapshot = getProjectAutosaveSnapshot();
		if (snapshot === lastSavedSnapshot) return;

		isAutosaving = true;
		try {
			await project.save();
			lastSavedSnapshot = getProjectAutosaveSnapshot();
		} finally {
			isAutosaving = false;
		}
	}

	onMount(() => {
		ProjectHistoryManager.resetForCurrentProject();
		lastSavedSnapshot = getProjectAutosaveSnapshot();

		// Sauvegarde automatique espacée et différée hors lecture.
		saveInterval = setInterval(markDirty, AUTOSAVE_CHECK_INTERVAL_MS);

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
		window.addEventListener('keydown', handleProjectHistoryShortcut, true);

		return () => {
			ProjectHistoryManager.clear();
			if (saveInterval !== undefined) {
				clearInterval(saveInterval);
			}
			clearScheduledSave();
			window.removeEventListener('mousedown', handleGlobalClick, true);
			window.removeEventListener('keydown', handleProjectSearchShortcut, true);
			window.removeEventListener('keydown', handleSubtitleNavigationShortcut, true);
			window.removeEventListener('keydown', handleProjectHistoryShortcut, true);
		};
	});
</script>

<div class="flex flex-col h-full bg-secondary min-h-0 overflow-hidden">
	<div class="min-h-0 flex-1 overflow-hidden">
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

	<Navigator />

	{#if searchOverlayVisible}
		<ProjectSearchOverlay bind:this={searchOverlay} onClose={closeProjectSearch} />
	{/if}
</div>
