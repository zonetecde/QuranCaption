<script lang="ts">
	import { Quran } from '$lib/classes/Quran';
	import { globalState } from '$lib/runes/main.svelte';
	import AutocompleteInput from '$lib/components/misc/AutocompleteInput.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { untrack } from 'svelte';

	let subtitlesEditorState = $derived(() => globalState.getSubtitlesEditorState);

	// Create suggestions array for autocomplete
	let surahSuggestions = $derived(() => {
		return Quran.getSurahsNames().map((surah) => `${surah.id}. ${surah.transliteration}`);
	});

	// Current search value for surah
	let surahSearchValue = $state('');
	let isSurahSearchInitialized = $state(false);

	// Get current surah name for display
	let currentSurahName = $derived(() => {
		const surahId = globalState.getSubtitlesEditorState.selectedSurah;
		const surah = Quran.getSurahsNames().find((s) => s.id === surahId);
		return surah ? `${surah.id}. ${surah.transliteration}` : '';
	});

	let lastSelectedSurahId = $state(globalState.getSubtitlesEditorState.selectedSurah);

	// Réinitialise la sélection de mots quand le verset change.
	$effect(() => {
		const _ = globalState.getSubtitlesEditorState.selectedVerse;
		untrack(() => {
			const state = globalState.getSubtitlesEditorState;
			state.startWordIndex = 0;
			state.endWordIndex = 0;
		});
	});

	function handleSurahSelection(selectedValue: string) {
		// Extract ID from the selected value (format: "1. Al-Fatihah")
		const match = selectedValue.match(/^(\d+)\./);
		if (match) {
			const surahId = parseInt(match[1]);
			if (globalState.getSubtitlesEditorState.selectedSurah !== surahId) {
				globalState.getSubtitlesEditorState.selectedSurah = surahId;
				lastSelectedSurahId = surahId; // update local tracking
				subtitlesEditorState().selectedVerse = 1;
				subtitlesEditorState().startWordIndex = 0;
				subtitlesEditorState().endWordIndex = 0;
			}
		}
		if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
	}

	// Update search value ONLY when current surah changes EXTERNALLY
	$effect(() => {
		const currentId = globalState.getSubtitlesEditorState.selectedSurah;
		if (!isSurahSearchInitialized || currentId !== lastSelectedSurahId) {
			lastSelectedSurahId = currentId;
			surahSearchValue = currentSurahName();
			isSurahSearchInitialized = true;
		}
	});
</script>

<section class="verse-picker w-full flex gap-3 items-center px-3 bg-secondary rounded-lg py-2">
	<div class="verse-picker-help flex gap-2 items-center">
		<div class="flex gap-2 items-center group relative" data-tour-id="subtitles-help-button">
			<span class="material-icons text-2xl!">help</span>
			<div
				class="group transition-opacity text-sm text-[var(--text-secondary)] absolute top-4.5 left-3.5 bg-primary px-3 w-[400px] py-3 border-2 border-[var(--border-color)]/90 rounded-lg max-h-[400px] overflow-auto z-20 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"
			>
				<div class="space-y-2 mb-3">
					<div class="text-secondary text-sm font-semibold">
						{$LL.editor.needVisualWalkthrough()}
					</div>
					<p class="text-xs text-thirdly">
						{$LL.editor.walkthroughDescription()}
					</p>
					<div class="relative w-full overflow-hidden rounded-md border border-color">
						<iframe
							class="w-full aspect-video"
							src="https://www.youtube.com/embed/vCRUjzATRDk?start=35"
							title={$LL.editor.subtitlesEditorWalkthrough()}
							allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
							allowfullscreen
						></iframe>
					</div>
				</div>
			</div>
		</div>
	</div>

	<!-- Surah Selector with Autocomplete -->
	<div class="surah-picker flex min-w-0 flex-1 items-center gap-2 ml-auto">
		<span class="picker-label text-sm font-medium text-secondary">{$LL.editor.surahLabel()}</span>
		<div class="surah-input min-w-0 flex-1">
			<AutocompleteInput
				showEverything
				clearOnFocus
				bind:value={surahSearchValue}
				suggestions={surahSuggestions()}
				placeholder={$LL.editor.searchSurah()}
				icon=""
				onSelect={(val) => handleSurahSelection(val)}
			/>
		</div>
	</div>

	<!-- Separator -->
	<div class="picker-separator flex items-center">
		<span class="text-lg font-bold text-accent mx-2">:</span>
	</div>

	<!-- Verse Selector -->
	<div class="verse-input-group flex items-center gap-2">
		<span class="picker-label text-sm font-medium text-secondary">{$LL.editor.verseLabel()}</span>
		<input
			type="number"
			min="1"
			placeholder="1"
			class="verse-input bg-accent border border-color text-primary rounded-lg px-3 py-2 text-sm font-medium text-center w-20"
			max={Quran.getVerseCount(subtitlesEditorState().selectedSurah)}
			bind:value={globalState.getSubtitlesEditorState.selectedVerse}
		/>
	</div>
</section>

<style>
	.surah-input {
		min-width: 200px;
	}

	@media (max-width: 640px) {
		.verse-picker {
			gap: 0.5rem;
			padding: 0.35rem 0.5rem;
		}

		.verse-picker-help,
		.picker-label {
			display: none;
		}

		.picker-separator span {
			margin-right: 0;
			margin-left: 0;
		}

		.surah-picker {
			margin-left: 0;
		}

		.surah-input {
			min-width: 0;
		}

		.verse-input-group {
			flex-shrink: 0;
		}

		.verse-input {
			width: 3.5rem;
			padding-right: 0.5rem;
			padding-left: 0.5rem;
		}
	}
</style>
