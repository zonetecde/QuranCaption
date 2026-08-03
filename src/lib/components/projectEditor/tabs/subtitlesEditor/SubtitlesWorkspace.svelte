<script lang="ts">
	import { SubtitleClip } from '$lib/classes';
	import { globalState } from '$lib/runes/main.svelte';
	import { enterManualWordByWordEdit, exitManualWordByWordEdit } from '$lib/services/WbwHelper';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
	import toast from 'svelte-5-french-toast';
	import { PROJECT_EDITOR_SUBTITLES_WORDS_HEIGHT } from '$lib/constants/projectEditor';
	import DiviseurRedimensionnable from '../DiviseurRedimensionnable.svelte';
	import VersePicker from './VersePicker.svelte';
	import WordsSelector from './WordsSelector.svelte';
	import ContextMenu, { Item } from 'svelte-contextmenu';
	import { showContextMenuInViewport } from '$lib/services/ContextMenuService';

	let {
		useSplitHeight = true,
		showVersePicker = true,
		showPlaybackControls = false,
		showControlHelp = false,
		onCloseControlHelp = () => {},
		onTogglePresetPicker = () => {},
		onClosePresetPicker = () => {},
		onOpenAutoSegmentation = () => {}
	}: {
		useSplitHeight?: boolean;
		showVersePicker?: boolean;
		showPlaybackControls?: boolean;
		showControlHelp?: boolean;
		onCloseControlHelp?: () => void;
		onTogglePresetPicker?: () => void;
		onClosePresetPicker?: () => void;
		onOpenAutoSegmentation?: () => void;
	} = $props();
	let wordsSelector: {
		selectNextWord: () => Promise<void>;
		selectPreviousWord: () => Promise<void>;
		addSubtitle: () => Promise<void>;
		setLastSubtitleEndTime: () => void;
		setLastSubtitleStartTime: () => void;
		removeLastSubtitle: () => void;
		editCurrentOrLastSubtitle: () => void;
		selectNextVerse: () => void;
		selectPreviousVerse: () => Promise<void>;
	} | null = $state(null);
	let controlHelpCopy = $derived($LL.editor as unknown as Record<string, () => string>);

	const editSubtitle = $derived(globalState.getSubtitlesEditorState.editSubtitle);
	const isEditingSubtitle = $derived(editSubtitle instanceof SubtitleClip);
	const isWbwEditActive = $derived(globalState.shared.wbwEdit.active);
	let splitContextMenu: ContextMenu | undefined = $state(undefined);

	/**
	 * Ouvre le mode d'édition WBW manuel pour le sous-titre en cours d'édition.
	 * @returns {Promise<void>}
	 */
	async function startWbwTimestampEdit(): Promise<void> {
		if (!(editSubtitle instanceof SubtitleClip)) return;
		const success = await enterManualWordByWordEdit(editSubtitle);
		if (!success) {
			toast.error(get(LL).editor.cannotEnterWordEditMode());
			return;
		}
		onClosePresetPicker();
	}

	let wordsHeight = $derived(
		Math.max(
			PROJECT_EDITOR_SUBTITLES_WORDS_HEIGHT.min,
			Math.min(
				PROJECT_EDITOR_SUBTITLES_WORDS_HEIGHT.max,
				globalState.settings!.persistentUiState.projectEditorLayout.subtitlesWordsHeight
			)
		)
	);
	let controlBarExpansion = $derived(
		Math.max(
			0,
			(PROJECT_EDITOR_SUBTITLES_WORDS_HEIGHT.default - wordsHeight) /
				(PROJECT_EDITOR_SUBTITLES_WORDS_HEIGHT.default - PROJECT_EDITOR_SUBTITLES_WORDS_HEIGHT.min)
		)
	);

	/**
	 * Valide la sélection de mots courante depuis les contrôles tactiles.
	 * @returns {Promise<void>} Promesse résolue après l'ajout du sous-titre.
	 */
	export async function addSubtitle(): Promise<void> {
		await wordsSelector?.addSubtitle();
		onClosePresetPicker();
	}

	/**
	 * Déplace le curseur de lecture de quelques secondes et synchronise l'aperçu.
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
	 * Divise le sous-titre sous le curseur en deux.
	 * Si le sous-titre n'a pas de timestamps WBW, entre en mode édition séquentielle
	 * (partie gauche d'abord, puis partie droite après validation).
	 * @param {boolean} forceExactCursor Si true, coupe exactement à la position du curseur.
	 *   Si false, coupe au mot le plus proche.
	 * @returns {Promise<void>}
	 */
	async function splitSubtitleAtCursor(forceExactCursor = true): Promise<void> {
		const cursorPosition = globalState.getTimelineState.cursorPosition;
		const currentClip = globalState.getSubtitleTrack.getCurrentClip(cursorPosition);
		if (!currentClip) return;

		const leftClipId = currentClip.id;
		const leftClipIndex = globalState.getSubtitleTrack.clips.findIndex(
			(clip) => clip.id === leftClipId
		);

		const didSplit = await globalState.getSubtitleTrack.splitSubtitle(currentClip.id, {
			forceExactCursor
		});
		if (!didSplit) return;

		// Seul les SubtitleClip bénéficient de l'édition séquentielle après split.
		if (!(currentClip instanceof SubtitleClip)) return;

		// Après le split, le clip original (leftClipId) est la partie gauche,
		// et un nouveau clip est inséré juste après (rightClip).
		const rightClip = globalState.getSubtitleTrack.clips[leftClipIndex + 1];
		if (!(rightClip instanceof SubtitleClip)) return;

		// Passe en mode édition sur la partie gauche, et programme la partie droite.
		globalState.getSubtitlesEditorState.editSubtitle = currentClip;
		globalState.getSubtitlesEditorState.pendingSplitEditNextId = rightClip.id;
	}

	/**
	 * Ouvre le menu contextuel de choix du type de split (long press).
	 * @param {MouseEvent} event Événement souris/touch.
	 * @returns {Promise<void>}
	 */
	async function openSplitContextMenu(event: MouseEvent): Promise<void> {
		await showContextMenuInViewport(splitContextMenu, event);
	}

	/**
	 * Ajoute rapidement un silence à la position courante.
	 * @returns {void}
	 */
	function addQuickSilence(): void {
		const success = globalState.getSubtitleTrack.addSilence();
		if (success) globalState.currentProject!.detail.updateVideoDetailAttributes();
	}
</script>

{#if showControlHelp}
	<div class="control-help-backdrop"></div>
	<button
		class="control-help-dismiss"
		type="button"
		aria-label={$LL.common.close()}
		onclick={onCloseControlHelp}
	></button>
{/if}

<section
	data-tour-id="verse-picker-area"
	class="w-full max-w-full overflow-hidden min-h-0 bg-primary border border-color rounded-lg shadow-lg"
	class:control-help-active={showControlHelp}
	style={useSplitHeight
		? `height: ${globalState.settings!.persistentUiState.projectEditorLayout.upperSectionHeight}%;`
		: 'height: 100%;'}
>
	<div class="w-full h-full flex flex-col" class:p-4={showVersePicker} class:p-2={!showVersePicker}>
		{#if showVersePicker}
			<!-- Sélecteur de verset -->
			<div class="flex-shrink-0 mb-4">
				<VersePicker />
			</div>
		{/if}

		<!-- Affichage des mots du verset - prend toute la hauteur restante -->
		<div
			class="min-h-0"
			class:flex-1={!showPlaybackControls}
			class:words-selector-resizable={showPlaybackControls}
			style:flex-basis={showPlaybackControls ? `${wordsHeight}%` : undefined}
		>
			<WordsSelector bind:this={wordsSelector} />
		</div>

		{#if isEditingSubtitle}
			<div class="flex-shrink-0 pb-1">
				{#if isWbwEditActive}
					<button
						type="button"
						class="w-full rounded-b-lg border border-yellow-400/40 bg-yellow-400/15 py-2 text-xs font-medium text-yellow-200 transition-colors hover:bg-yellow-400/25"
						onclick={() => exitManualWordByWordEdit()}
					>
						<span class="material-icons-outlined text-sm mr-1 align-middle">close</span>
						{$LL.editor.exit()}
					</button>
				{:else}
					<button
						type="button"
						class="w-full rounded-b-lg border border-yellow-400/30 bg-yellow-400/10 py-2 text-xs font-medium text-yellow-200 transition-colors hover:bg-yellow-400/20"
						onclick={() => void startWbwTimestampEdit()}
					>
						<span class="material-icons-outlined text-sm mr-1 align-middle">timeline</span>
						{$LL.editor.editWbw()}
					</button>
				{/if}
			</div>
		{/if}

		{#if showPlaybackControls}
			<DiviseurRedimensionnable
				orientation="horizontal"
				bind:value={
					globalState.settings!.persistentUiState.projectEditorLayout.subtitlesWordsHeight
				}
				displayedValue={wordsHeight}
				min={PROJECT_EDITOR_SUBTITLES_WORDS_HEIGHT.min}
				max={PROJECT_EDITOR_SUBTITLES_WORDS_HEIGHT.max}
				unit="percent"
				dataTestId="subtitles-words-resizer"
			/>

			<div
				class="playback-controls"
				style={`--playback-button-height: ${2.25 + controlBarExpansion * 6.25}rem; --playback-small-button-height: ${1.45 + controlBarExpansion * 5.55}rem;`}
			>
				<div
					class="playback-control-side playback-control-side-left"
					class:pointer-events-none={isWbwEditActive}
					class:opacity-20={isWbwEditActive}
				>
					<button
						class="playback-control-button playback-control-button-validate playback-control-button-predefined"
						type="button"
						aria-label={$LL.editor.predefinedLabel()}
						data-help={controlHelpCopy.controlHelpPreset()}
						onclick={onTogglePresetPicker}
					>
						<span class="material-icons">dashboard_customize</span>
					</button>
					<button
						class="playback-control-button playback-control-button-validate playback-control-button-ai"
						type="button"
						data-tour-id="auto-segment-button"
						aria-label={$LL.batch.aiSegmentation()}
						data-help={controlHelpCopy.controlHelpAi()}
						onclick={onOpenAutoSegmentation}
					>
						<span class="playback-control-ai-icon" aria-hidden="true"
							>IA <span class="text-[6px]">Subtitles</span></span
						>
					</button>
					<button
						class="playback-control-button playback-control-button-delete"
						type="button"
						aria-label={$LL.settings.shortcutAction.REMOVE_LAST_SUBTITLE()}
						data-help={$LL.settings.shortcutActionDesc.REMOVE_LAST_SUBTITLE()}
						onclick={() => wordsSelector?.removeLastSubtitle()}
					>
						<span class="material-icons text-[20px]!">backspace</span>
					</button>
					<button
						class="playback-control-button playback-control-button-edit"
						type="button"
						aria-label={$LL.settings.shortcutAction.EDIT_LAST_SUBTITLE()}
						data-help={$LL.settings.shortcutActionDesc.EDIT_LAST_SUBTITLE()}
						onclick={() => wordsSelector?.editCurrentOrLastSubtitle()}
					>
						<span class="material-icons">edit</span>
					</button>
				</div>

				<div class="playback-control-center">
					<div class:pointer-events-none={isWbwEditActive} class:opacity-20={isWbwEditActive}>
						<button
							class="playback-control-button playback-control-button-verse-previous"
							type="button"
							aria-label={$LL.common.back()}
							data-help={controlHelpCopy.controlHelpPreviousVerse()}
							onclick={() => void wordsSelector?.selectPreviousVerse()}
						>
							−
						</button>
						<button
							class="playback-control-button playback-control-button-up"
							type="button"
							aria-label={$LL.settings.shortcutAction.SELECT_NEXT_WORD()}
							data-help={$LL.settings.shortcutActionDesc.SELECT_NEXT_WORD()}
							onclick={() => void wordsSelector?.selectNextWord()}
						>
							<span class="material-icons">keyboard_arrow_up</span>
						</button>
						<button
							class="playback-control-button playback-control-button-verse-next"
							type="button"
							aria-label={$LL.common.next()}
							data-help={controlHelpCopy.controlHelpNextVerse()}
							onclick={() => wordsSelector?.selectNextVerse()}
						>
							+
						</button>
					</div>
					<div class="playback-control-horizontal">
						<button
							class="playback-control-button"
							class:pointer-events-none={isWbwEditActive}
							class:opacity-20={isWbwEditActive}
							type="button"
							aria-label={$LL.settings.shortcutAction.MOVE_BACKWARD()}
							data-help={$LL.settings.shortcutActionDesc.MOVE_BACKWARD()}
							onclick={() => movePlaybackCursor(-2000)}
						>
							<span class="material-icons">chevron_left</span>
						</button>
						<button
							class="playback-control-button playback-control-button-primary"
							type="button"
							aria-label={$LL.editor.playbackControls()}
							data-help={$LL.settings.shortcutActionDesc.PLAY_PAUSE()}
							onclick={() => globalState.getVideoPreviewState.togglePlayPause()}
						>
							<span class="material-icons">
								{globalState.getVideoPreviewState.isPlaying ? 'pause' : 'play_arrow'}
							</span>
						</button>
						<button
							class="playback-control-button"
							class:pointer-events-none={isWbwEditActive}
							class:opacity-20={isWbwEditActive}
							type="button"
							aria-label={$LL.settings.shortcutAction.MOVE_FORWARD()}
							data-help={$LL.settings.shortcutActionDesc.MOVE_FORWARD()}
							onclick={() => movePlaybackCursor(2000)}
						>
							<span class="material-icons">chevron_right</span>
						</button>
					</div>
					<div class:pointer-events-none={isWbwEditActive} class:opacity-20={isWbwEditActive}>
						<button
							class="playback-control-button playback-control-button-down"
							type="button"
							aria-label={$LL.settings.shortcutAction.SELECT_PREVIOUS_WORD()}
							data-help={$LL.settings.shortcutActionDesc.SELECT_PREVIOUS_WORD()}
							onclick={() => void wordsSelector?.selectPreviousWord()}
						>
							<span class="material-icons">keyboard_arrow_down</span>
						</button>
						<button
							class="playback-control-button playback-control-button-quick-split text-xs!"
							type="button"
							aria-label={$LL.settings.shortcutAction.SPLIT_SUBTITLE()}
							data-help={$LL.settings.shortcutActionDesc.SPLIT_SUBTITLE()}
							onclick={() => void splitSubtitleAtCursor(true)}
							oncontextmenu={(event) => void openSplitContextMenu(event)}
						>
							<span class="material-icons text-[14px]!">call_split</span>
						</button>
						<button
							class="playback-control-button playback-control-button-quick-silence"
							type="button"
							aria-label={$LL.settings.shortcutAction.ADD_SILENCE()}
							data-help={$LL.settings.shortcutActionDesc.ADD_SILENCE()}
							onclick={addQuickSilence}
						>
							<span class="material-icons text-[14px]!">space_bar</span>
						</button>
					</div>
				</div>

				<div class="playback-control-side playback-control-side-right">
					<button
						class="playback-control-button playback-control-button-set-end"
						class:pointer-events-none={isWbwEditActive}
						class:opacity-20={isWbwEditActive}
						type="button"
						aria-label={$LL.settings.shortcutAction.SET_LAST_SUBTITLE_END()}
						data-help={$LL.settings.shortcutActionDesc.SET_LAST_SUBTITLE_END()}
						onclick={() => wordsSelector?.setLastSubtitleEndTime()}
					>
						<span class="material-icons">vertical_align_bottom</span>
					</button>
					<button
						class="playback-control-button playback-control-button-set-start"
						class:pointer-events-none={isWbwEditActive}
						class:opacity-20={isWbwEditActive}
						type="button"
						aria-label={$LL.settings.shortcutAction.SET_LAST_SUBTITLE_START()}
						data-help={$LL.settings.shortcutActionDesc.SET_LAST_SUBTITLE_START()}
						onclick={() => wordsSelector?.setLastSubtitleStartTime()}
					>
						<span class="material-icons">vertical_align_top</span>
					</button>
					<button
						class="playback-control-button playback-control-button-validate playback-control-button-confirm"
						type="button"
						aria-label={$LL.common.confirm()}
						data-help={$LL.settings.shortcutActionDesc.ADD_SUBTITLE()}
						onclick={() => void addSubtitle()}
					>
						<span class="material-icons">check</span>
					</button>
				</div>
			</div>
		{/if}
	</div>
</section>

<ContextMenu bind:this={splitContextMenu}>
	<Item on:click={() => void splitSubtitleAtCursor(true)}>
		<div class="btn-icon">
			<span class="material-icons-outlined text-sm mr-1">content_cut</span>
			{($LL.editor as unknown as Record<string, () => string>).splitExactCursor()}
		</div>
	</Item>
	<Item on:click={() => void splitSubtitleAtCursor(false)}>
		<div class="btn-icon">
			<span class="material-icons-outlined text-sm mr-1">call_split</span>
			{($LL.editor as unknown as Record<string, () => string>).splitNearestWord()}
		</div>
	</Item>
</ContextMenu>

<style>
	.words-selector-resizable {
		flex: 0 1 auto;
	}

	.control-help-backdrop,
	.control-help-dismiss {
		position: fixed;
		inset: 0;
	}

	.control-help-backdrop {
		z-index: 1000;
		background: rgb(2 8 18 / 88%);
		backdrop-filter: blur(2px);
	}

	.control-help-dismiss {
		z-index: 1003;
		border: 0;
		background: transparent;
	}

	.control-help-active {
		overflow: visible;
	}

	.playback-controls {
		box-sizing: border-box;
		display: grid;
		min-height: 6.5rem;
		flex: 1 1 0;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
		grid-template-rows: repeat(2, minmax(0, 1fr));
		align-items: center;
		gap: 0.75rem;
		padding-top: 0.5rem;
	}

	.control-help-active .playback-controls {
		position: relative;
		z-index: 1002;
		border: 1px solid color-mix(in srgb, var(--border-color) 80%, white);
		border-radius: 1rem;
		background: var(--bg-primary);
		box-shadow:
			0 0 0 0.35rem var(--bg-primary),
			0 0 2rem rgb(0 0 0 / 65%);
	}

	.control-help-active .playback-control-side .playback-control-button,
	.control-help-active .playback-control-horizontal .playback-control-button {
		position: relative;
	}

	.control-help-active .playback-control-button-set-end,
	.control-help-active .playback-control-button-set-start {
		transform: none;
	}

	.control-help-active .playback-control-button-set-end > span,
	.control-help-active .playback-control-button-set-start > span {
		transform: rotate(-90deg);
	}

	.control-help-active .playback-control-button::before {
		--help-distance: 2.2rem;
		position: absolute;
		z-index: 1;
		left: 50%;
		width: 0.4rem;
		height: var(--help-distance);
		background: white;
		content: '';
		transform: translateX(-50%);
	}

	.control-help-active .playback-control-button::after {
		--help-distance: 2.2rem;
		position: absolute;
		z-index: 2;
		left: 50%;
		width: max-content;
		max-width: min(8rem, 24vw);
		padding: 0.35rem 0.45rem;
		border: 1px solid rgb(255 255 255 / 35%);
		border-radius: 0.5rem;
		background: rgb(20 27 36 / 96%);
		color: white;
		content: attr(data-help);
		font-size: 0.65rem;
		font-weight: 500;
		line-height: 1.2;
		text-align: center;
		transform: translateX(-50%);
	}

	.control-help-active .playback-control-button-delete::before,
	.control-help-active .playback-control-button-delete::after,
	.control-help-active .playback-control-button-up::before,
	.control-help-active .playback-control-button-up::after,
	.control-help-active .playback-control-button-set-end::before,
	.control-help-active .playback-control-button-set-end::after,
	.control-help-active .playback-control-button-edit::before,
	.control-help-active .playback-control-button-edit::after,
	.control-help-active .playback-control-button-primary::before,
	.control-help-active .playback-control-button-primary::after,
	.control-help-active .playback-control-button-set-start::before,
	.control-help-active .playback-control-button-set-start::after {
		--help-distance: 4.8rem;
	}

	.control-help-active .playback-control-button-delete::before,
	.control-help-active .playback-control-button-delete::after,
	.control-help-active .playback-control-button-edit::before,
	.control-help-active .playback-control-button-edit::after {
		--help-distance: 6.2rem;
	}

	.control-help-active .playback-control-button-primary::before,
	.control-help-active .playback-control-button-primary::after {
		--help-distance: 5.5rem;
	}

	.control-help-active .playback-control-button-down::before,
	.control-help-active .playback-control-button-down::after {
		--help-distance: 7.2rem;
	}

	.control-help-active .playback-control-button-quick-split::before,
	.control-help-active .playback-control-button-quick-split::after {
		--help-distance: 11rem;
	}

	.control-help-active .playback-control-button-quick-silence::before,
	.control-help-active .playback-control-button-quick-silence::after {
		--help-distance: 11rem;
	}

	.control-help-active .playback-control-button-confirm::before,
	.control-help-active .playback-control-button-confirm::after {
		--help-distance: 11rem;
	}

	.control-help-active .playback-control-button-predefined::after,
	.control-help-active .playback-control-button-ai::after {
		left: 0;
		transform: none;
	}

	.control-help-active .playback-control-button-verse-previous::after,
	.control-help-active .playback-control-horizontal .playback-control-button:first-child::after {
		transform: translateX(-35%);
	}

	.control-help-active .playback-control-button-confirm::after {
		right: 0;
		left: auto;
		transform: none;
	}

	.control-help-active .playback-control-button-predefined::before,
	.control-help-active .playback-control-button-delete::before,
	.control-help-active .playback-control-button-verse-previous::before,
	.control-help-active .playback-control-button-up::before,
	.control-help-active .playback-control-button-verse-next::before,
	.control-help-active .playback-control-button-set-end::before,
	.control-help-active .playback-control-button-confirm::before {
		bottom: calc(100% + 0.2rem);
		clip-path: polygon(45% 0, 55% 0, 55% 82%, 100% 82%, 50% 100%, 0 82%, 45% 82%);
	}

	.control-help-active .playback-control-button-predefined::after,
	.control-help-active .playback-control-button-delete::after,
	.control-help-active .playback-control-button-verse-previous::after,
	.control-help-active .playback-control-button-up::after,
	.control-help-active .playback-control-button-verse-next::after,
	.control-help-active .playback-control-button-set-end::after,
	.control-help-active .playback-control-button-confirm::after {
		bottom: calc(100% + var(--help-distance));
	}

	.control-help-active .playback-control-button-ai::before,
	.control-help-active .playback-control-button-edit::before,
	.control-help-active .playback-control-horizontal .playback-control-button::before,
	.control-help-active .playback-control-button-down::before,
	.control-help-active .playback-control-button-quick-split::before,
	.control-help-active .playback-control-button-quick-silence::before,
	.control-help-active .playback-control-button-set-start::before {
		top: calc(100% + 0.2rem);
		clip-path: polygon(50% 0, 100% 18%, 55% 18%, 55% 100%, 45% 100%, 45% 18%, 0 18%);
	}

	.control-help-active .playback-control-button-ai::after,
	.control-help-active .playback-control-button-edit::after,
	.control-help-active .playback-control-horizontal .playback-control-button::after,
	.control-help-active .playback-control-button-down::after,
	.control-help-active .playback-control-button-quick-split::after,
	.control-help-active .playback-control-button-quick-silence::after,
	.control-help-active .playback-control-button-set-start::after {
		top: calc(100% + var(--help-distance));
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
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		grid-template-rows: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
		min-width: 0;
		grid-row: 1 / span 2;
		align-self: stretch;
	}

	.playback-control-button-confirm {
		grid-row: 1 / span 2;
		width: 100%;
		height: 100%;
	}

	.playback-control-button-predefined {
		grid-column: 1;
		grid-row: 1;
	}

	.playback-control-button-delete,
	.playback-control-button-edit {
		grid-column: 2;
	}

	.playback-control-button-ai {
		grid-column: 1;
		grid-row: 2;
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

	.playback-control-button-set-end span {
		transform: rotate(-90deg);
	}

	.playback-control-button-set-start span {
		transform: rotate(-90deg);
	}

	.playback-control-button-confirm {
		grid-column: 2;
	}

	.playback-control-button {
		display: flex;
		height: var(--playback-button-height, 2.25rem);
		width: 2.25rem;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--border-color);
		border-radius: 9999px;
		background: var(--bg-secondary);
		color: var(--text-primary);
	}

	.playback-control-button-primary {
		height: 2.75rem;
		width: 2.75rem;
		background: var(--accent-primary);
		color: var(--text-on-accent);
	}

	.playback-control-ai-icon {
		font-size: 0.75rem;
		font-weight: 700;
		line-height: 1;
	}

	.playback-control-horizontal {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.playback-control-horizontal .playback-control-button:not(.playback-control-button-primary) {
		height: 2.25rem;
	}

	.playback-control-button-up,
	.playback-control-button-down {
		position: absolute;
		height: var(--playback-small-button-height, 1.45rem);
		width: 1.45rem;
		left: 50%;
		transform: translateX(-50%);
	}

	.playback-control-button-verse-previous,
	.playback-control-button-verse-next,
	.playback-control-button-quick-split,
	.playback-control-button-quick-silence {
		position: absolute;
		font-size: 1.25rem;
		height: var(--playback-small-button-height, 1.45rem);
		font-weight: 600;
	}

	.playback-control-button-verse-previous,
	.playback-control-button-verse-next {
		top: 0;
	}

	.playback-control-button-verse-previous {
		left: 0;
	}

	.playback-control-button-verse-next,
	.playback-control-button-quick-silence {
		right: 0;
	}

	.playback-control-button-quick-split,
	.playback-control-button-quick-silence {
		bottom: 0;
	}

	.playback-control-button-quick-split {
		left: 0;
	}

	.playback-control-button-up {
		top: 0;
	}

	.playback-control-button-down {
		bottom: 0;
	}

	.playback-control-button-validate {
		width: 100%;
		height: 100%;
		border-color: transparent;
		background: var(--accent-primary);
		color: var(--text-on-accent);
		box-shadow: 0 4px 12px color-mix(in srgb, var(--accent-primary) 35%, transparent);
	}
</style>
