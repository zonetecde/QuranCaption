<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import Timeline from '../../timeline/Timeline.svelte';
	import VideoPreview from '../../videoPreview/VideoPreview.svelte';
	import DiviseurRedimensionnable from '../DiviseurRedimensionnable.svelte';
	import StyleEditorSettings from './StyleEditorSettings.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { ProjectEditorTabs } from '$lib/classes';
	import { DEFAULT_STYLE_PANEL_WIDTH } from '$lib/constants/projectEditor';

	const MIN_STYLE_PANEL_WIDTH = 280;
	const PRESET_LIBRARY_MIN_WIDTH = 600;
	const MAX_STYLE_PANEL_WIDTH = 720;
	const STYLE_PANEL_RESIZE_STEP = 20;

	/** Ouverture de la librairie de presets (état géré dans globalState). */
	let presetLibraryOpen = $derived(globalState.presetLibrary.libraryOpen);
	let isResizingStylePanel = $state(false);
	let resizeStartX = 0;
	let resizeStartWidth = DEFAULT_STYLE_PANEL_WIDTH;
	let previousBodyCursor = '';
	let previousBodyUserSelect = '';
	let stylePanelWidth = $derived(
		globalState.currentProject?.projectEditorState.stylePanelWidth ?? DEFAULT_STYLE_PANEL_WIDTH
	);
	let displayedStylePanelWidth = $derived(
		clampStylePanelWidth(
			presetLibraryOpen ? Math.max(stylePanelWidth, PRESET_LIBRARY_MIN_WIDTH) : stylePanelWidth
		)
	);

	/**
	 * Retourne la largeur maximale du panneau de style.
	 * @returns {number} La largeur maximale en pixels.
	 */
	function getMaxStylePanelWidth(): number {
		return MAX_STYLE_PANEL_WIDTH;
	}

	/**
	 * Retourne la largeur minimale du panneau en fonction de la vue affichée.
	 * @returns {number} La largeur minimale en pixels.
	 */
	function getMinStylePanelWidth(): number {
		const minWidth = presetLibraryOpen ? PRESET_LIBRARY_MIN_WIDTH : MIN_STYLE_PANEL_WIDTH;
		return Math.min(minWidth, getMaxStylePanelWidth());
	}

	/**
	 * Maintient une largeur de panneau entre les bornes de l'éditeur.
	 * @param {number} width Largeur demandée en pixels.
	 * @returns {number} Largeur utilisable en pixels.
	 */
	function clampStylePanelWidth(width: number): number {
		return Math.max(getMinStylePanelWidth(), Math.min(getMaxStylePanelWidth(), width));
	}

	/**
	 * Met à jour la largeur enregistrée du panneau de style.
	 * @param {number} width Largeur demandée en pixels.
	 * @returns {void}
	 */
	function setStylePanelWidth(width: number): void {
		if (!globalState.currentProject) return;
		globalState.currentProject.projectEditorState.stylePanelWidth = clampStylePanelWidth(width);
	}

	/**
	 * Démarre le redimensionnement horizontal du panneau de style.
	 * @param {PointerEvent} event Événement de début de glissement.
	 * @returns {void}
	 */
	function startStylePanelResize(event: PointerEvent): void {
		if (event.button !== 0 || !globalState.currentProject) return;

		isResizingStylePanel = true;
		resizeStartX = event.clientX;
		resizeStartWidth = displayedStylePanelWidth;
		previousBodyCursor = document.body.style.cursor;
		previousBodyUserSelect = document.body.style.userSelect;
		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';
		document.addEventListener('pointermove', resizeStylePanel);
		document.addEventListener('pointerup', stopStylePanelResize);
		document.addEventListener('pointercancel', stopStylePanelResize);
		event.preventDefault();
	}

	/**
	 * Ajuste la largeur du panneau pendant le glissement.
	 * @param {PointerEvent} event Événement de déplacement du pointeur.
	 * @returns {void}
	 */
	function resizeStylePanel(event: PointerEvent): void {
		if (!isResizingStylePanel) return;
		setStylePanelWidth(resizeStartWidth + event.clientX - resizeStartX);
	}

	/**
	 * Termine le redimensionnement horizontal du panneau de style.
	 * @returns {void}
	 */
	function stopStylePanelResize(): void {
		if (!isResizingStylePanel) return;

		isResizingStylePanel = false;
		document.body.style.cursor = previousBodyCursor;
		document.body.style.userSelect = previousBodyUserSelect;
		document.removeEventListener('pointermove', resizeStylePanel);
		document.removeEventListener('pointerup', stopStylePanelResize);
		document.removeEventListener('pointercancel', stopStylePanelResize);
	}

	/**
	 * Ajuste la largeur du panneau avec le clavier lorsque la poignée est focalisée.
	 * @param {KeyboardEvent} event Événement clavier reçu par la poignée.
	 * @returns {void}
	 */
	function handleStylePanelResizeKeydown(event: KeyboardEvent): void {
		if (event.key === 'ArrowLeft') {
			event.preventDefault();
			setStylePanelWidth(displayedStylePanelWidth - STYLE_PANEL_RESIZE_STEP);
		} else if (event.key === 'ArrowRight') {
			event.preventDefault();
			setStylePanelWidth(displayedStylePanelWidth + STYLE_PANEL_RESIZE_STEP);
		} else if (event.key === 'Home') {
			event.preventDefault();
			setStylePanelWidth(getMinStylePanelWidth());
		} else if (event.key === 'End') {
			event.preventDefault();
			setStylePanelWidth(getMaxStylePanelWidth());
		}
	}

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
		stopStylePanelResize();
	});
</script>

<div class="flex-grow w-full max-w-full flex overflow-hidden h-full min-h-0">
	<!-- Assets -->
	<section
		class="flex-shrink-0 divide-y-2 divide-color max-h-full overflow-hidden flex flex-col transition-[width] duration-200"
		style={`width: ${displayedStylePanelWidth}px;`}
	>
		<StyleEditorSettings {presetLibraryOpen} {openPresetLibrary} {closePresetLibrary} />
	</section>
	<div
		class="style-panel-resizer"
		class:style-panel-resizer-active={isResizingStylePanel}
		role="separator"
		aria-orientation="vertical"
		aria-valuemin={getMinStylePanelWidth()}
		aria-valuemax={getMaxStylePanelWidth()}
		aria-valuenow={Math.round(displayedStylePanelWidth)}
		tabindex="0"
		data-testid="style-panel-resizer"
		onpointerdown={startStylePanelResize}
		onkeydown={handleStylePanelResizeKeydown}
	></div>
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
	.style-panel-resizer {
		position: relative;
		z-index: 10;
		width: 8px;
		flex-shrink: 0;
		cursor: col-resize;
		touch-action: none;
	}

	.style-panel-resizer::after {
		position: absolute;
		top: 0.75rem;
		bottom: 0.75rem;
		left: 50%;
		width: 2px;
		border-radius: 999px;
		background: var(--border-color);
		content: '';
		transform: translateX(-50%);
		transition:
			background-color 150ms ease,
			box-shadow 150ms ease;
	}

	.style-panel-resizer:hover::after,
	.style-panel-resizer:focus-visible::after,
	.style-panel-resizer-active::after {
		background: var(--accent-primary);
		box-shadow: 0 0 8px color-mix(in srgb, var(--accent-primary) 70%, transparent);
	}
</style>
