<script lang="ts">
	import { SubtitleClip } from '$lib/classes';
	import Settings from '$lib/classes/Settings.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import {
		moveManualWordByWordSelectedWordEndToCursor,
		moveManualWordByWordSelectedWordStartToCursor
	} from '$lib/services/WbwHelper';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
	import { get } from 'svelte/store';
	import { fade } from 'svelte/transition';
	import AutoSegmentationModal from './modal/AutoSegmentationModal.svelte';
	import SubtitlePresetPicker from './SubtitlePresetPicker.svelte';
	import VersePicker from './VersePicker.svelte';
	import WordsSelector from './WordsSelector.svelte';

	let { showPlaybackControls = false }: { showPlaybackControls?: boolean } = $props();
	let wordsSelector: {
		goNextVerse: () => void;
		goPreviousVerse: () => Promise<void>;
		selectNextWord: () => Promise<void>;
		selectPreviousWord: () => Promise<void>;
		addSubtitle: () => Promise<void>;
		removeLastSubtitle: () => void;
		editCurrentOrLastSubtitle: () => void;
	} | null = $state(null);
	let presetPickerOpen = $state(false);
	let autoSegmentationModalOpen = $state(false);
	let controlHelpOpen = $state(false);
	let hoveredControlHelp = $state<string | null>(null);
	let controlsCollapsed = $derived(
		globalState.settings?.persistentUiState.subtitlesPlaybackControlsCollapsed ?? false
	);
	let controlsVisible = $derived(!controlsCollapsed || controlHelpOpen);
	let isWbwEditActive = $derived(globalState.shared.wbwEdit.active);

	/**
	 * Valide la sélection de mots courante depuis les contrôles du player.
	 *
	 * @returns {Promise<void>} Promesse résolue après l'ajout du sous-titre.
	 */
	export async function addSubtitle(): Promise<void> {
		await wordsSelector?.addSubtitle();
		presetPickerOpen = false;
	}

	/**
	 * Déplace le curseur de lecture de quelques secondes et synchronise l'aperçu.
	 *
	 * @param {number} offsetMs Décalage en millisecondes.
	 * @returns {void}
	 */
	function movePlaybackCursor(offsetMs: number): void {
		const currentPosition = globalState.getTimelineState.cursorPosition;
		const newPosition = Math.max(1, currentPosition + offsetMs);
		globalState.getTimelineState.cursorPosition = newPosition;
		globalState.getTimelineState.movePreviewTo = newPosition;
		globalState.getVideoPreviewState.scrollTimelineToCursor();
	}

	/**
	 * Définit la fin du sous-titre sous le curseur, ou celle du dernier sous-titre.
	 *
	 * @returns {void}
	 */
	function setSubtitleEndTime(): void {
		if (isWbwEditActive) {
			moveManualWordByWordSelectedWordEndToCursor();
			return;
		}

		const subtitleTrack = globalState.getSubtitleTrack;
		const cursorPosition = globalState.getTimelineState.cursorPosition;
		const currentClip = subtitleTrack.getCurrentClip(cursorPosition);

		ProjectHistoryManager.track('set subtitle end', () => {
			if (currentClip) {
				if (cursorPosition <= currentClip.startTime + 50) return;
				currentClip.setEndTime(cursorPosition);
				subtitleTrack.getClipAfter(currentClip.id)?.setStartTime(cursorPosition + 1);
			} else {
				subtitleTrack.getLastClip()?.setEndTime(cursorPosition);
			}
		});

		globalState.currentProject?.detail.updateVideoDetailAttributes();
		globalState.updateVideoPreviewUI();
	}

	/**
	 * Définit le début du sous-titre sous le curseur et recale le sous-titre précédent.
	 *
	 * @returns {void}
	 */
	function setSubtitleStartTime(): void {
		if (isWbwEditActive) {
			moveManualWordByWordSelectedWordStartToCursor();
			return;
		}

		const subtitleTrack = globalState.getSubtitleTrack;
		const cursorPosition = globalState.getTimelineState.cursorPosition;
		const currentClip = subtitleTrack.getCurrentClip(cursorPosition);
		if (!currentClip || cursorPosition >= currentClip.endTime - 50) return;

		ProjectHistoryManager.track('set subtitle start', () => {
			currentClip.setStartTime(cursorPosition);
			subtitleTrack.getClipBefore(currentClip.id)?.setEndTime(cursorPosition - 1);
		});

		globalState.currentProject?.detail.updateVideoDetailAttributes();
		globalState.updateVideoPreviewUI();
	}

	/**
	 * Divise le sous-titre sous le curseur et prépare l'édition séquentielle des deux parties.
	 *
	 * @returns {Promise<void>}
	 */
	async function splitSubtitleAtCursor(): Promise<void> {
		const subtitleTrack = globalState.getSubtitleTrack;
		const currentClip = subtitleTrack.getCurrentClip(globalState.getTimelineState.cursorPosition);
		if (!currentClip) return;

		const leftClipIndex = subtitleTrack.clips.findIndex((clip) => clip.id === currentClip.id);
		const didSplit = await subtitleTrack.splitSubtitle(currentClip.id, { forceExactCursor: true });
		if (!didSplit) return;

		globalState.currentProject?.detail.updateVideoDetailAttributes();
		globalState.updateVideoPreviewUI();
		if (!(currentClip instanceof SubtitleClip)) return;

		const rightClip = subtitleTrack.clips[leftClipIndex + 1];
		if (!(rightClip instanceof SubtitleClip)) return;
		globalState.getSubtitlesEditorState.editSubtitle = currentClip;
		globalState.getSubtitlesEditorState.pendingSplitEditNextId = rightClip.id;
	}

	/**
	 * Ajoute rapidement un silence à la position courante.
	 *
	 * @returns {void}
	 */
	function addQuickSilence(): void {
		const success = globalState.getSubtitleTrack.addSilence();
		if (success) globalState.currentProject!.detail.updateVideoDetailAttributes();
	}

	/**
	 * Replie ou déplie les contrôles et sauvegarde ce choix dans les réglages globaux.
	 *
	 * @returns {void}
	 */
	function togglePlaybackControls(): void {
		const settings = globalState.settings;
		if (!settings) return;

		settings.persistentUiState.subtitlesPlaybackControlsCollapsed = !controlsCollapsed;
		presetPickerOpen = false;
		void Settings.save();
	}

	/**
	 * Construit l'aide d'un contrôle avec son raccourci configuré et sa description.
	 *
	 * @param {string} label Nom traduit de l'action.
	 * @param {string} description Description traduite de l'action.
	 * @param {string[]} keys Touches associées à l'action.
	 * @returns {string} Texte affiché dans l'infobulle.
	 */
	function getControlHelp(label: string, description: string, keys: string[] = []): string {
		const specialKeys: Record<string, string> = {
			' ': get(LL).settings.space(),
			arrowleft: '←',
			arrowright: '→',
			arrowup: '↑',
			arrowdown: '↓',
			enter: get(LL).settings.enter(),
			backspace: get(LL).settings.backspace()
		};
		const shortcut = keys
			.map((key) => specialKeys[key.toLowerCase()] ?? key.toUpperCase())
			.join(' / ');
		const title = shortcut ? `${label} · ${shortcut}` : label;
		return description ? `${title}\n${description}` : title;
	}

	/**
	 * Met à jour le texte d’aide à partir du contrôle actuellement survolé.
	 *
	 * @param {EventTarget | null} target Élément situé sous le pointeur.
	 * @returns {void}
	 */
	function updateHoveredControlHelp(target: EventTarget | null): void {
		const button =
			target instanceof Element ? target.closest<HTMLButtonElement>('[data-help]') : null;
		hoveredControlHelp = button?.dataset.help ?? null;
	}
</script>

<section
	data-tour-id="verse-picker-area"
	class="subtitles-workspace overflow-hidden min-h-0 bg-primary border border-color rounded-lg shadow-lg"
	class:control-help-active={controlHelpOpen && showPlaybackControls}
	style="height: {globalState.settings!.persistentUiState.projectEditorLayout.upperSectionHeight}%;"
>
	<div class="w-full h-full flex flex-col p-4">
		<div class="flex-shrink-0 mb-4">
			<VersePicker
				{controlHelpOpen}
				onHelpChange={(isOpen) => {
					controlHelpOpen = showPlaybackControls && isOpen;
				}}
			/>
		</div>

		<div class="words-selector-container flex-1 min-h-0">
			<WordsSelector
				bind:this={wordsSelector}
				playbackControlsExpanded={showPlaybackControls && controlsVisible}
			/>

			{#if showPlaybackControls}
				<div class="controls-notch" class:collapsed={!controlsVisible}>
					<button
						class="controls-notch-handle"
						type="button"
						aria-label={controlsCollapsed ? $LL.home.expand() : $LL.home.collapse()}
						aria-expanded={controlsVisible}
						title={controlsCollapsed ? $LL.home.expand() : $LL.home.collapse()}
						onclick={togglePlaybackControls}
					>
						<span class="material-icons -mt-1">
							{controlsCollapsed ? 'expand_less' : 'expand_more'}
						</span>
					</button>

					{#if controlsVisible}
						<div
							class="playback-controls"
							onpointerover={(event) => updateHoveredControlHelp(event.target)}
							onpointerout={(event) => updateHoveredControlHelp(event.relatedTarget)}
							onfocusin={(event) => updateHoveredControlHelp(event.target)}
							onfocusout={(event) => updateHoveredControlHelp(event.relatedTarget)}
							onpointerleave={() => (hoveredControlHelp = null)}
						>
							<div
								class="playback-control-side playback-control-side-left"
								class:controls-disabled={isWbwEditActive}
							>
								<button
									class="playback-control-button playback-control-button-accent playback-control-button-predefined"
									type="button"
									disabled={isWbwEditActive}
									aria-label={$LL.editor.predefinedLabel()}
									data-help={getControlHelp(
										$LL.editor.predefinedLabel(),
										$LL.settings.shortcutCatDesc.PREDEFINED_SUBTITLES()
									)}
									onclick={() => (presetPickerOpen = !presetPickerOpen)}
								>
									<span class="material-icons">dashboard_customize</span>
								</button>
								<button
									class="playback-control-button playback-control-button-accent playback-control-button-ai"
									type="button"
									disabled={isWbwEditActive}
									data-tour-id="auto-segment-button"
									aria-label={$LL.editor.aiAssistedSegmentation()}
									data-help={getControlHelp(
										$LL.editor.aiAssistedSegmentation(),
										$LL.editor.autoSegmentButton()
									)}
									onclick={() => (autoSegmentationModalOpen = true)}
								>
									<span class="material-icons">auto_awesome</span>
								</button>
								<button
									class="playback-control-button playback-control-button-delete"
									type="button"
									disabled={isWbwEditActive}
									aria-label={$LL.settings.shortcutAction.REMOVE_LAST_SUBTITLE()}
									data-help={getControlHelp(
										$LL.settings.shortcutAction.REMOVE_LAST_SUBTITLE(),
										$LL.settings.shortcutActionDesc.REMOVE_LAST_SUBTITLE(),
										globalState.settings!.shortcuts.SUBTITLES_EDITOR.REMOVE_LAST_SUBTITLE.keys
									)}
									onclick={() => wordsSelector?.removeLastSubtitle()}
								>
									<span class="material-icons text-[20px]!">backspace</span>
								</button>
								<button
									class="playback-control-button playback-control-button-edit"
									type="button"
									disabled={isWbwEditActive}
									aria-label={$LL.settings.shortcutAction.EDIT_LAST_SUBTITLE()}
									data-help={getControlHelp(
										$LL.settings.shortcutAction.EDIT_LAST_SUBTITLE(),
										$LL.settings.shortcutActionDesc.EDIT_LAST_SUBTITLE(),
										globalState.settings!.shortcuts.SUBTITLES_EDITOR.EDIT_LAST_SUBTITLE.keys
									)}
									onclick={() => wordsSelector?.editCurrentOrLastSubtitle()}
								>
									<span class="material-icons">edit</span>
								</button>
							</div>

							<div class="playback-control-center">
								<button
									class="playback-control-button playback-control-button-verse-previous"
									type="button"
									disabled={isWbwEditActive}
									aria-label={$LL.common.back()}
									data-help={getControlHelp($LL.common.back(), $LL.editor.verseLabel())}
									onclick={() => void wordsSelector?.goPreviousVerse()}
								>
									−
								</button>
								<button
									class="playback-control-button playback-control-button-up"
									type="button"
									disabled={isWbwEditActive}
									aria-label={$LL.settings.shortcutAction.SELECT_NEXT_WORD()}
									data-help={getControlHelp(
										$LL.settings.shortcutAction.SELECT_NEXT_WORD(),
										$LL.settings.shortcutActionDesc.SELECT_NEXT_WORD(),
										globalState.settings!.shortcuts.SUBTITLES_EDITOR.SELECT_NEXT_WORD.keys
									)}
									onclick={() => void wordsSelector?.selectNextWord()}
								>
									<span class="material-icons">keyboard_arrow_up</span>
								</button>
								<button
									class="playback-control-button playback-control-button-verse-next"
									type="button"
									disabled={isWbwEditActive}
									aria-label={$LL.common.next()}
									data-help={getControlHelp($LL.common.next(), $LL.editor.verseLabel())}
									onclick={() => wordsSelector?.goNextVerse()}
								>
									+
								</button>

								<div class="playback-control-horizontal">
									<button
										class="playback-control-button playback-control-button-backward"
										type="button"
										disabled={isWbwEditActive}
										aria-label={$LL.settings.shortcutAction.MOVE_BACKWARD()}
										data-help={getControlHelp(
											$LL.settings.shortcutAction.MOVE_BACKWARD(),
											$LL.settings.shortcutActionDesc.MOVE_BACKWARD(),
											globalState.settings!.shortcuts.VIDEO_PREVIEW.MOVE_BACKWARD.keys
										)}
										onclick={() => movePlaybackCursor(-2000)}
									>
										<span class="material-icons">chevron_left</span>
									</button>
									<button
										class="playback-control-button playback-control-button-primary"
										type="button"
										aria-label={$LL.settings.shortcutAction.PLAY_PAUSE()}
										data-help={getControlHelp(
											$LL.settings.shortcutAction.PLAY_PAUSE(),
											$LL.settings.shortcutActionDesc.PLAY_PAUSE(),
											globalState.settings!.shortcuts.VIDEO_PREVIEW.PLAY_PAUSE.keys
										)}
										onclick={() => globalState.getVideoPreviewState.togglePlayPause()}
									>
										<span class="material-icons">
											{globalState.getVideoPreviewState.isPlaying ? 'pause' : 'play_arrow'}
										</span>
									</button>
									<button
										class="playback-control-button playback-control-button-forward"
										type="button"
										disabled={isWbwEditActive}
										aria-label={$LL.settings.shortcutAction.MOVE_FORWARD()}
										data-help={getControlHelp(
											$LL.settings.shortcutAction.MOVE_FORWARD(),
											$LL.settings.shortcutActionDesc.MOVE_FORWARD(),
											globalState.settings!.shortcuts.VIDEO_PREVIEW.MOVE_FORWARD.keys
										)}
										onclick={() => movePlaybackCursor(2000)}
									>
										<span class="material-icons">chevron_right</span>
									</button>
								</div>

								<button
									class="playback-control-button playback-control-button-down"
									type="button"
									disabled={isWbwEditActive}
									aria-label={$LL.settings.shortcutAction.SELECT_PREVIOUS_WORD()}
									data-help={getControlHelp(
										$LL.settings.shortcutAction.SELECT_PREVIOUS_WORD(),
										$LL.settings.shortcutActionDesc.SELECT_PREVIOUS_WORD(),
										globalState.settings!.shortcuts.SUBTITLES_EDITOR.SELECT_PREVIOUS_WORD.keys
									)}
									onclick={() => void wordsSelector?.selectPreviousWord()}
								>
									<span class="material-icons">keyboard_arrow_down</span>
								</button>
								<button
									class="playback-control-button playback-control-button-quick-split"
									type="button"
									disabled={isWbwEditActive}
									aria-label={$LL.settings.shortcutAction.SPLIT_SUBTITLE()}
									data-help={getControlHelp(
										$LL.settings.shortcutAction.SPLIT_SUBTITLE(),
										$LL.settings.shortcutActionDesc.SPLIT_SUBTITLE(),
										globalState.settings!.shortcuts.SUBTITLES_EDITOR.SPLIT_SUBTITLE.keys
									)}
									onclick={() => void splitSubtitleAtCursor()}
								>
									<span class="material-icons text-[14px]!">call_split</span>
								</button>
								<button
									class="playback-control-button playback-control-button-quick-silence"
									type="button"
									disabled={isWbwEditActive}
									aria-label={$LL.settings.shortcutAction.ADD_SILENCE()}
									data-help={getControlHelp(
										$LL.settings.shortcutAction.ADD_SILENCE(),
										$LL.settings.shortcutActionDesc.ADD_SILENCE(),
										globalState.settings!.shortcuts.SUBTITLES_EDITOR.ADD_SILENCE.keys
									)}
									onclick={addQuickSilence}
								>
									<span class="material-icons text-[14px]!">space_bar</span>
								</button>
							</div>

							<div class="playback-control-side playback-control-side-right">
								<button
									class="playback-control-button playback-control-button-set-end"
									type="button"
									disabled={isWbwEditActive}
									aria-label={$LL.settings.shortcutAction.SET_LAST_SUBTITLE_END()}
									data-help={getControlHelp(
										$LL.settings.shortcutAction.SET_LAST_SUBTITLE_END(),
										$LL.settings.shortcutActionDesc.SET_LAST_SUBTITLE_END(),
										globalState.settings!.shortcuts.SUBTITLES_EDITOR.SET_LAST_SUBTITLE_END.keys
									)}
									onclick={setSubtitleEndTime}
								>
									<span class="material-icons">vertical_align_bottom</span>
								</button>
								<button
									class="playback-control-button playback-control-button-set-start"
									type="button"
									disabled={isWbwEditActive}
									aria-label={$LL.settings.shortcutAction.SET_LAST_SUBTITLE_START()}
									data-help={getControlHelp(
										$LL.settings.shortcutAction.SET_LAST_SUBTITLE_START(),
										$LL.settings.shortcutActionDesc.SET_LAST_SUBTITLE_START(),
										globalState.settings!.shortcuts.SUBTITLES_EDITOR.SET_LAST_SUBTITLE_START.keys
									)}
									onclick={setSubtitleStartTime}
								>
									<span class="material-icons">vertical_align_top</span>
								</button>
								<button
									class="playback-control-button playback-control-button-accent playback-control-button-confirm"
									type="button"
									aria-label={$LL.settings.shortcutAction.ADD_SUBTITLE()}
									data-help={getControlHelp(
										$LL.settings.shortcutAction.ADD_SUBTITLE(),
										$LL.settings.shortcutActionDesc.ADD_SUBTITLE(),
										globalState.settings!.shortcuts.SUBTITLES_EDITOR.ADD_SUBTITLE.keys
									)}
									onclick={() => void addSubtitle()}
								>
									<span class="material-icons">check</span>
								</button>
							</div>
						</div>
						<div
							class="playback-control-description"
							class:active={hoveredControlHelp}
							data-tour-id="subtitles-control-description"
						>
							{hoveredControlHelp?.replaceAll('\n', ' -- ') ?? ''}
						</div>

						{#if presetPickerOpen}
							<div class="preset-picker-overlay">
								<SubtitlePresetPicker
									onClose={() => (presetPickerOpen = false)}
									onAddQuranSubtitle={() => addSubtitle()}
								/>
							</div>
						{/if}
					{/if}
				</div>
			{/if}
		</div>
	</div>
</section>

{#if autoSegmentationModalOpen}
	<div class="modal-wrapper" transition:fade>
		<AutoSegmentationModal close={() => (autoSegmentationModalOpen = false)} />
	</div>
{/if}

<style>
	.words-selector-container {
		position: relative;
	}

	.controls-notch {
		position: absolute;
		z-index: 120;
		bottom: -1px;
		left: 50%;
		box-sizing: border-box;
		width: 350px;
		padding: 1rem 0.75rem 0.65rem;
		border: 1px solid var(--border-color);
		border-bottom: 0;
		border-radius: 1rem 1rem 0 0;
		background: color-mix(in srgb, var(--bg-primary) 96%, transparent);
		box-shadow: 0 -8px 24px rgb(0 0 0 / 24%);
		transform: translateX(-50%);
		transition:
			width 160ms ease,
			padding 160ms ease;
		backdrop-filter: blur(12px);
	}

	.controls-notch.collapsed {
		width: 7rem;
		min-height: 1.15rem;
		padding: 0.75rem 0 0;
	}

	.controls-notch-handle {
		position: absolute;
		top: -2px;
		left: 50%;
		display: flex;
		height: 1rem;
		width: 100%;
		align-items: center;
		justify-content: center;
		border-top: 2px solid color-mix(in srgb, var(--accent-primary) 25%, var(--border-color));
		border-radius: 1rem 1rem 0 0;
		color: var(--text-secondary);
		cursor: pointer;
		transform: translateX(-50%);
	}

	.controls-notch-handle:hover {
		border-top-color: var(--accent-primary);
		color: var(--accent-primary);
	}

	.controls-notch-handle:hover .material-icons {
		background: var(--accent-primary);
		color: var(--text-on-accent);
	}

	.controls-notch-handle .material-icons {
		font-size: 0.8rem;
		background: color-mix(in srgb, var(--accent-primary) 25%, var(--border-color));
		border-radius: 0 0 6px 6px;
		padding: 0rem 0.45rem 0rem;
	}

	.playback-controls {
		display: grid;
		height: 6.5rem;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
		grid-template-rows: repeat(2, minmax(0, 1fr));
		align-items: center;
		gap: 0.75rem;
	}

	.playback-control-description {
		position: absolute;
		bottom: -0.9rem;
		left: 50%;
		width: max-content;
		color: var(--text-secondary);
		font-size: 0.65rem;
		font-weight: 500;
		line-height: 1.2;
		opacity: 0;
		pointer-events: none;
		text-align: center;
		transform: translateX(-50%);
		white-space: pre-line;
		transition: opacity 100ms ease;
	}

	.playback-control-description.active {
		opacity: 0.75;
	}

	.playback-control-center {
		position: relative;
		display: flex;
		grid-row: 1 / span 2;
		align-self: stretch;
		align-items: center;
		justify-content: center;
	}

	.playback-control-side {
		display: grid;
		min-width: 0;
		grid-row: 1 / span 2;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		grid-template-rows: repeat(2, minmax(0, 1fr));
		align-self: stretch;
		gap: 0.5rem;
	}

	.controls-disabled {
		opacity: 0.2;
	}

	.playback-control-button {
		position: relative;
		display: flex;
		height: 2.25rem;
		width: 2.25rem;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--border-color);
		border-radius: 9999px;
		background: var(--bg-secondary);
		color: var(--text-primary);
		transform-origin: center;
		transition:
			border-color 120ms ease,
			filter 120ms ease,
			transform 120ms ease;
	}

	.playback-control-button:hover:not(:disabled) {
		border-color: var(--accent-primary);
		filter: brightness(1.12);
	}

	.playback-control-button:active:not(:disabled) {
		transform: scale(0.95);
	}

	.playback-control-button:disabled {
		cursor: default;
	}

	.playback-control-button-primary {
		height: 2.75rem;
		width: 2.75rem;
		border-color: transparent;
		background: var(--accent-primary);
		color: var(--text-on-accent);
	}

	.playback-control-button-accent {
		width: 100%;
		height: 100%;
		border-color: transparent;
		background: var(--accent-primary);
		color: var(--text-on-accent);
		box-shadow: 0 4px 12px color-mix(in srgb, var(--accent-primary) 35%, transparent);
	}

	.playback-control-button-confirm {
		grid-row: 1 / span 2;
		grid-column: 2;
	}

	.playback-control-button-predefined {
		grid-row: 1;
		grid-column: 1;
	}

	.playback-control-button-ai {
		grid-row: 2;
		grid-column: 1;
	}

	.playback-control-button-delete,
	.playback-control-button-edit {
		grid-column: 2;
	}

	.playback-control-button-delete,
	.playback-control-button-set-end {
		grid-row: 1;
	}

	.playback-control-button-edit,
	.playback-control-button-set-start {
		grid-row: 2;
	}

	.playback-control-button-set-end,
	.playback-control-button-set-start {
		grid-column: 1;
	}

	.playback-control-button-set-end > span,
	.playback-control-button-set-start > span {
		transform: rotate(-90deg);
	}

	.playback-control-horizontal {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.playback-control-button-up,
	.playback-control-button-down {
		position: absolute;
		left: 50%;
		height: 1.45rem;
		width: 1.45rem;
		transform: translateX(-50%);
	}

	.playback-control-button-up:active:not(:disabled),
	.playback-control-button-down:active:not(:disabled) {
		transform: translateX(-50%) scale(0.95);
	}

	.playback-control-button-verse-previous,
	.playback-control-button-verse-next,
	.playback-control-button-quick-split,
	.playback-control-button-quick-silence {
		position: absolute;
		height: 1.45rem;
		font-size: 1.25rem;
		font-weight: 600;
	}

	.playback-control-button-verse-previous,
	.playback-control-button-verse-next,
	.playback-control-button-up {
		top: 0;
	}

	.playback-control-button-down,
	.playback-control-button-quick-split,
	.playback-control-button-quick-silence {
		bottom: 0;
	}

	.playback-control-button-verse-previous,
	.playback-control-button-quick-split {
		left: 0;
	}

	.playback-control-button-verse-next,
	.playback-control-button-quick-silence {
		right: 0;
	}

	.playback-control-button::before,
	.playback-control-button::after {
		position: absolute;
		z-index: 900;
		left: 50%;
		pointer-events: none;
		opacity: 0;
		transition: opacity 120ms ease;
	}

	.playback-control-button::before {
		bottom: calc(100% + 0.15rem);
		width: 0.4rem;
		height: 0.55rem;
		background: var(--text-primary);
		clip-path: polygon(45% 0, 55% 0, 55% 72%, 100% 72%, 50% 100%, 0 72%, 45% 72%);
		content: '';
		transform: translateX(-50%);
	}

	.playback-control-button::after {
		bottom: calc(100% + 0.7rem);
		width: max-content;
		max-width: 13rem;
		padding: 0.4rem 0.55rem;
		border: 1px solid rgb(255 255 255 / 30%);
		border-radius: 0.5rem;
		background: rgb(20 27 36 / 97%);
		color: white;
		content: attr(data-help);
		font-size: 0.68rem;
		font-weight: 500;
		line-height: 1.25;
		text-align: center;
		white-space: pre-line;
		transform: translateX(-50%);
	}

	.playback-control-button-predefined::after,
	.playback-control-button-ai::after {
		left: 0;
		transform: none;
	}

	.playback-control-button-confirm::after,
	.playback-control-button-set-end::after,
	.playback-control-button-set-start::after {
		right: 0;
		left: auto;
		transform: none;
	}

	.control-help-active {
		overflow: visible;
	}

	.control-help-active .controls-notch {
		z-index: 120;
		box-shadow:
			0 0 0 0.35rem var(--bg-primary),
			0 0 2rem rgb(0 0 0 / 65%);
	}

	.control-help-active .playback-control-button::before,
	.control-help-active .playback-control-button::after {
		opacity: 1;
		transition-delay: 650ms;
	}

	.control-help-active .playback-control-button-delete::before,
	.control-help-active .playback-control-button-verse-previous::before,
	.control-help-active .playback-control-button-up::before,
	.control-help-active .playback-control-button-verse-next::before,
	.control-help-active .playback-control-button-confirm::before {
		bottom: calc(100% + 0.2rem);
		height: var(--help-distance);
	}

	.control-help-active .playback-control-button-delete::after,
	.control-help-active .playback-control-button-verse-previous::after,
	.control-help-active .playback-control-button-up::after,
	.control-help-active .playback-control-button-verse-next::after,
	.control-help-active .playback-control-button-confirm::after {
		bottom: calc(100% + var(--help-distance));
	}

	.control-help-active .playback-control-button-edit::before,
	.control-help-active .playback-control-button-backward::before,
	.control-help-active .playback-control-button-primary::before,
	.control-help-active .playback-control-button-forward::before,
	.control-help-active .playback-control-button-down::before,
	.control-help-active .playback-control-button-quick-split::before,
	.control-help-active .playback-control-button-quick-silence::before {
		top: calc(100% + 0.2rem);
		bottom: auto;
		height: var(--help-distance);
		clip-path: polygon(50% 0, 100% 18%, 55% 18%, 55% 100%, 45% 100%, 45% 18%, 0 18%);
	}

	.control-help-active .playback-control-button-edit::after,
	.control-help-active .playback-control-button-backward::after,
	.control-help-active .playback-control-button-primary::after,
	.control-help-active .playback-control-button-forward::after,
	.control-help-active .playback-control-button-down::after,
	.control-help-active .playback-control-button-quick-split::after,
	.control-help-active .playback-control-button-quick-silence::after {
		top: calc(100% + var(--help-distance));
		bottom: auto;
	}

	.control-help-active .playback-control-button-verse-previous,
	.control-help-active .playback-control-button-verse-next {
		--help-distance: 3rem;
	}

	.control-help-active .playback-control-button-delete,
	.control-help-active .playback-control-button-confirm,
	.control-help-active .playback-control-button-primary {
		--help-distance: 6rem;
	}

	.control-help-active .playback-control-button-up,
	.control-help-active .playback-control-button-edit,
	.control-help-active .playback-control-button-down {
		--help-distance: 9rem;
	}

	.control-help-active .playback-control-button-backward,
	.control-help-active .playback-control-button-forward {
		--help-distance: 3rem;
	}

	.control-help-active .playback-control-button-quick-split,
	.control-help-active .playback-control-button-quick-silence {
		--help-distance: 12rem;
	}

	.control-help-active .playback-control-button-verse-previous::after,
	.control-help-active .playback-control-button-delete::after,
	.control-help-active .playback-control-button-backward::after,
	.control-help-active .playback-control-button-edit::after,
	.control-help-active .playback-control-button-quick-split::after {
		right: 50%;
		left: auto;
		transform: none;
	}

	.control-help-active .playback-control-button-verse-next::after,
	.control-help-active .playback-control-button-confirm::after,
	.control-help-active .playback-control-button-forward::after,
	.control-help-active .playback-control-button-down::after,
	.control-help-active .playback-control-button-quick-silence::after {
		left: 50%;
		transform: none;
	}

	.control-help-active .playback-control-button-predefined,
	.control-help-active .playback-control-button-ai,
	.control-help-active .playback-control-button-set-end,
	.control-help-active .playback-control-button-set-start {
		--help-distance: 3rem;
	}

	.control-help-active .playback-control-button-predefined::before,
	.control-help-active .playback-control-button-ai::before {
		top: 50%;
		right: calc(100% + 0.2rem);
		bottom: auto;
		left: auto;
		width: var(--help-distance);
		height: 0.4rem;
		clip-path: polygon(0 45%, 72% 45%, 72% 0, 100% 50%, 72% 100%, 72% 55%, 0 55%);
		transform: translateY(-50%);
	}

	.control-help-active .playback-control-button-predefined::after,
	.control-help-active .playback-control-button-ai::after {
		top: 50%;
		right: calc(100% + var(--help-distance));
		bottom: auto;
		left: auto;
	}

	.control-help-active .playback-control-button-set-end::before,
	.control-help-active .playback-control-button-set-start::before {
		top: 50%;
		bottom: auto;
		left: calc(100% + 0.2rem);
		width: var(--help-distance);
		height: 0.4rem;
		clip-path: polygon(0 50%, 28% 0, 28% 45%, 100% 45%, 100% 55%, 28% 55%, 28% 100%);
		transform: translateY(-50%);
	}

	.control-help-active .playback-control-button-set-end::after,
	.control-help-active .playback-control-button-set-start::after {
		top: 50%;
		right: auto;
		bottom: auto;
		left: calc(100% + var(--help-distance));
	}

	.control-help-active .playback-control-button-predefined::after,
	.control-help-active .playback-control-button-set-end::after {
		transform: translateY(calc(-50% - 0.5rem));
	}

	.control-help-active .playback-control-button-ai::after,
	.control-help-active .playback-control-button-set-start::after {
		transform: translateY(calc(-50% + 0.5rem));
	}

	.preset-picker-overlay {
		position: absolute;
		z-index: 55;
		bottom: calc(100% + 0.6rem);
		left: 0;
		height: min(18rem, 55vh);
		width: 100%;
		overflow: hidden;
		border: 1px solid var(--border-color);
		border-radius: 0.85rem;
		box-shadow: 0 12px 30px rgb(0 0 0 / 45%);
	}
</style>
