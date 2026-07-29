<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import VersePicker from './VersePicker.svelte';
	import WordsSelector from './WordsSelector.svelte';

	let {
		useSplitHeight = true,
		showVersePicker = true,
		showPlaybackControls = false
	}: {
		useSplitHeight?: boolean;
		showVersePicker?: boolean;
		showPlaybackControls?: boolean;
	} = $props();

	/**
	 * Déclenche le même raccourci que la touche clavier demandée.
	 *
	 * @param {string} key Valeur de KeyboardEvent.key à simuler.
	 * @returns {void}
	 */
	function triggerKeyboardShortcut(key: string): void {
		document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
		document.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }));
	}
</script>

<section
	data-tour-id="verse-picker-area"
	class="overflow-hidden min-h-0 bg-primary border border-color rounded-lg shadow-lg"
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
			<WordsSelector />
		</div>

		{#if showPlaybackControls}
			<div class="playback-controls">
				<button
					class="playback-control-button"
					type="button"
					aria-label={$LL.settings.shortcutAction.MOVE_BACKWARD()}
					onclick={() => triggerKeyboardShortcut('ArrowLeft')}
				>
					<span class="material-icons">chevron_left</span>
				</button>
				<button
					class="playback-control-button playback-control-button-primary"
					type="button"
					aria-label={$LL.settings.shortcutAction.PLAY_PAUSE()}
					onclick={() => triggerKeyboardShortcut(' ')}
				>
					<span class="material-icons">
						{globalState.getVideoPreviewState.isPlaying ? 'pause' : 'play_arrow'}
					</span>
				</button>
				<button
					class="playback-control-button"
					type="button"
					aria-label={$LL.settings.shortcutAction.MOVE_FORWARD()}
					onclick={() => triggerKeyboardShortcut('ArrowRight')}
				>
					<span class="material-icons">chevron_right</span>
				</button>
			</div>
		{/if}
	</div>
</section>

<style>
	.playback-controls {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding-top: 0.5rem;
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
</style>
