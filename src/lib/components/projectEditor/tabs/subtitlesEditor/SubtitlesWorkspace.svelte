<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import VersePicker from './VersePicker.svelte';
	import WordsSelector from './WordsSelector.svelte';

	let {
		useSplitHeight = true,
		showVersePicker = true,
		showPlaybackControls = false,
		onTogglePresetPicker = () => {},
		onOpenAutoSegmentation = () => {}
	}: {
		useSplitHeight?: boolean;
		showVersePicker?: boolean;
		showPlaybackControls?: boolean;
		onTogglePresetPicker?: () => void;
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

	/**
	 * Valide la sélection de mots courante depuis les contrôles tactiles.
	 * @returns {Promise<void>} Promesse résolue après l'ajout du sous-titre.
	 */
	export async function addSubtitle(): Promise<void> {
		await wordsSelector?.addSubtitle();
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
</script>

<section
	data-tour-id="verse-picker-area"
	class="w-full max-w-full overflow-hidden min-h-0 bg-primary border border-color rounded-lg shadow-lg"
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
		<div class="flex-1 min-h-0">
			<WordsSelector bind:this={wordsSelector} />
		</div>

		{#if showPlaybackControls}
			<div class="playback-controls">
				<div class="playback-control-side playback-control-side-left">
					<button
						class="playback-control-button playback-control-button-validate playback-control-button-predefined"
						type="button"
						aria-label={$LL.editor.predefinedLabel()}
						onclick={onTogglePresetPicker}
					>
						<span class="material-icons">dashboard_customize</span>
					</button>
					<button
						class="playback-control-button playback-control-button-validate playback-control-button-ai"
						type="button"
						aria-label={$LL.batch.aiSegmentation()}
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
						onclick={() => wordsSelector?.removeLastSubtitle()}
					>
						<span class="material-icons text-[20px]!">backspace</span>
					</button>
					<button
						class="playback-control-button playback-control-button-edit"
						type="button"
						aria-label={$LL.settings.shortcutAction.EDIT_LAST_SUBTITLE()}
						onclick={() => wordsSelector?.editCurrentOrLastSubtitle()}
					>
						<span class="material-icons">edit</span>
					</button>
				</div>

				<div class="playback-control-center">
					<button
						class="playback-control-button playback-control-button-verse-previous"
						type="button"
						aria-label={$LL.common.back()}
						onclick={() => void wordsSelector?.selectPreviousVerse()}
					>
						−
					</button>
					<button
						class="playback-control-button playback-control-button-up"
						type="button"
						aria-label={$LL.settings.shortcutAction.SELECT_NEXT_WORD()}
						onclick={() => void wordsSelector?.selectNextWord()}
					>
						<span class="material-icons">keyboard_arrow_up</span>
					</button>
					<button
						class="playback-control-button playback-control-button-verse-next"
						type="button"
						aria-label={$LL.common.next()}
						onclick={() => wordsSelector?.selectNextVerse()}
					>
						+
					</button>
					<div class="playback-control-horizontal">
						<button
							class="playback-control-button"
							type="button"
							aria-label={$LL.settings.shortcutAction.MOVE_BACKWARD()}
							onclick={() => movePlaybackCursor(-2000)}
						>
							<span class="material-icons">chevron_left</span>
						</button>
						<button
							class="playback-control-button playback-control-button-primary"
							type="button"
							aria-label={$LL.editor.playbackControls()}
							onclick={() => globalState.getVideoPreviewState.togglePlayPause()}
						>
							<span class="material-icons">
								{globalState.getVideoPreviewState.isPlaying ? 'pause' : 'play_arrow'}
							</span>
						</button>
						<button
							class="playback-control-button"
							type="button"
							aria-label={$LL.settings.shortcutAction.MOVE_FORWARD()}
							onclick={() => movePlaybackCursor(2000)}
						>
							<span class="material-icons">chevron_right</span>
						</button>
					</div>
					<button
						class="playback-control-button playback-control-button-down"
						type="button"
						aria-label={$LL.settings.shortcutAction.SELECT_PREVIOUS_WORD()}
						onclick={() => void wordsSelector?.selectPreviousWord()}
					>
						<span class="material-icons">keyboard_arrow_down</span>
					</button>
				</div>

				<div class="playback-control-side playback-control-side-right">
					<button
						class="playback-control-button playback-control-button-set-end"
						type="button"
						aria-label={$LL.settings.shortcutAction.SET_LAST_SUBTITLE_END()}
						onclick={() => wordsSelector?.setLastSubtitleEndTime()}
					>
						<span class="material-icons">vertical_align_bottom</span>
					</button>
					<button
						class="playback-control-button playback-control-button-set-start"
						type="button"
						aria-label={$LL.settings.shortcutAction.SET_LAST_SUBTITLE_START()}
						onclick={() => wordsSelector?.setLastSubtitleStartTime()}
					>
						<span class="material-icons">vertical_align_top</span>
					</button>
					<button
						class="playback-control-button playback-control-button-validate playback-control-button-confirm"
						type="button"
						aria-label={$LL.common.confirm()}
						onclick={() => void addSubtitle()}
					>
						<span class="material-icons">check</span>
					</button>
				</div>
			</div>
		{/if}
	</div>
</section>

<style>
	.playback-controls {
		box-sizing: border-box;
		display: grid;
		flex-shrink: 0;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
		grid-template-rows: repeat(2, minmax(0, 1fr));
		align-items: center;
		gap: 0.75rem;
		height: 6.5rem;
		padding-top: 0.5rem;
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

	.playback-control-button-set-end {
		transform: rotate(90deg);
	}

	.playback-control-button-set-start {
		transform: rotate(-90deg);
	}

	.playback-control-button-confirm {
		grid-column: 2;
	}

	.playback-control-button {
		display: flex;
		height: 2.25rem;
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

	.playback-control-button-up,
	.playback-control-button-down {
		position: absolute;
		height: 1.45rem;
		width: 1.45rem;
		left: 50%;
		transform: translateX(-50%);
	}

	.playback-control-button-verse-previous,
	.playback-control-button-verse-next {
		position: absolute;
		top: 0;
		font-size: 1.25rem;
		height: 1.45rem;
		font-weight: 600;
	}

	.playback-control-button-verse-previous {
		left: 0;
	}

	.playback-control-button-verse-next {
		right: 0;
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
