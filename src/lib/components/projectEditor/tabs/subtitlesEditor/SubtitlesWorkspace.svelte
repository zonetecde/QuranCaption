<script lang="ts">
	import { globalState } from '$lib/runes/main.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import VersePicker from './VersePicker.svelte';
	import WordsSelector from './WordsSelector.svelte';

	let {
		useSplitHeight = true,
		showVersePicker = true,
		showPlaybackControls = false,
		onTogglePresetPicker = () => {}
	}: {
		useSplitHeight?: boolean;
		showVersePicker?: boolean;
		showPlaybackControls?: boolean;
		onTogglePresetPicker?: () => void;
	} = $props();
	let wordsSelector: {
		selectNextWord: () => Promise<void>;
		selectPreviousWord: () => Promise<void>;
		addSubtitle: () => Promise<void>;
	} | null = $state(null);

	/**
	 * Valide la sélection de mots courante depuis les contrôles tactiles.
	 * @returns {Promise<void>} Promesse résolue après l'ajout du sous-titre.
	 */
	export async function addSubtitle(): Promise<void> {
		await wordsSelector?.addSubtitle();
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
						class="playback-control-button playback-control-button-validate w-20!"
						type="button"
						aria-label={$LL.editor.predefinedLabel()}
						onclick={onTogglePresetPicker}
					>
						<span class="material-icons">dashboard_customize</span>
					</button>
				</div>

				<div class="playback-control-center">
					<button
						class="playback-control-button"
						type="button"
						aria-label={$LL.common.back()}
						onclick={() => void wordsSelector?.selectPreviousWord()}
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
						aria-label={$LL.common.next()}
						onclick={() => void wordsSelector?.selectNextWord()}
					>
						<span class="material-icons">chevron_right</span>
					</button>
				</div>

				<div class="playback-control-side playback-control-side-right">
					<button
						class="playback-control-button playback-control-button-validate w-20!"
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
		display: grid;
		flex-shrink: 0;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: 0.75rem;
		padding-top: 0.5rem;
	}

	.playback-control-center {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.playback-control-side {
		display: flex;
	}

	.playback-control-side-left {
		justify-content: flex-start;
	}

	.playback-control-side-right {
		justify-content: flex-end;
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

	.playback-control-button-validate {
		height: 2.5rem;
		width: 2.5rem;
		border-color: transparent;
		background: var(--accent-primary);
		color: var(--text-on-accent);
		box-shadow: 0 4px 12px color-mix(in srgb, var(--accent-primary) 35%, transparent);
	}
</style>
