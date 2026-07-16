<script lang="ts">
	import { Quran, type Verse } from '$lib/classes/Quran';
	import AutocompleteInput from '$lib/components/misc/AutocompleteInput.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import type { QuranTranscriptReference } from '$lib/services/TranscriptReferenceService';
	import { onMount, untrack } from 'svelte';

	type Props = {
		reference: QuranTranscriptReference;
		title: string;
		onCancel: () => void;
		onApply: (reference: QuranTranscriptReference) => void;
	};

	let { reference, title, onCancel, onApply }: Props = $props();

	const initialReference = untrack(() => ({ ...reference }));
	const initialSurah = Quran.getSurahsNames().find((surah) => surah.id === initialReference.surah);

	let selectedSurah = $state(initialReference.surah);
	let selectedVerse = $state(initialReference.verse);
	let surahSearchValue = $state(
		initialSurah ? `${initialSurah.id}. ${initialSurah.transliteration}` : ''
	);
	let selectedVerseData: Verse | null = $state(null);
	let selectedStartWord = $state(0);
	let selectedEndWord = $state(0);
	let quranReady = $state(false);
	let verseLoadRequest = 0;

	const surahSuggestions = $derived(() =>
		(quranReady ? Quran.getSurahsNames() : []).map(
			(surah) => `${surah.id}. ${surah.transliteration}`
		)
	);
	const selectedSurahVerseCount = $derived(() =>
		quranReady ? Quran.getVerseCount(selectedSurah) : 0
	);

	onMount(() => {
		void loadSelectedVerse(initialReference.startWord, initialReference.endWord);
	});

	/**
	 * Charge le verset sélectionné et initialise sa plage de mots.
	 * @param {number | null} startWord Premier mot stocké, en base 1.
	 * @param {number | null} endWord Dernier mot stocké, en base 1.
	 * @returns {Promise<void>}
	 */
	async function loadSelectedVerse(
		startWord: number | null,
		endWord: number | null
	): Promise<void> {
		const request = ++verseLoadRequest;
		selectedVerseData = null;
		await Quran.load();
		quranReady = true;
		const verse = (await Quran.getVerse(selectedSurah, selectedVerse)) ?? null;
		if (request !== verseLoadRequest) return;
		selectedVerseData = verse;
		selectedStartWord = Math.max(0, Math.min((startWord ?? 1) - 1, (verse?.words.length ?? 1) - 1));
		selectedEndWord = Math.max(
			selectedStartWord,
			Math.min((endWord ?? verse?.words.length ?? 1) - 1, (verse?.words.length ?? 1) - 1)
		);
	}

	/**
	 * Applique une sourate choisie dans l'autocomplétion.
	 * @param {string} value Libellé au format `ID. Nom`.
	 * @returns {void}
	 */
	function selectSurahSuggestion(value: string): void {
		const match = value.match(/^(\d+)\./);
		if (!match) return;
		changeSelectedSurah(Number(match[1]));
		const surah = Quran.getSurahsNames().find((item) => item.id === selectedSurah);
		surahSearchValue = surah ? `${surah.id}. ${surah.transliteration}` : value;
	}

	/**
	 * Change la sourate du sélecteur.
	 * @param {number} surah Numéro de sourate.
	 * @returns {void}
	 */
	function changeSelectedSurah(surah: number): void {
		selectedSurah = surah;
		selectedVerse = 1;
		void loadSelectedVerse(null, null);
	}

	/**
	 * Change le verset du sélecteur.
	 * @param {number} verse Numéro de verset.
	 * @returns {void}
	 */
	function changeSelectedVerse(verse: number): void {
		selectedVerse = Math.max(1, Math.min(verse, selectedSurahVerseCount() || 1));
		void loadSelectedVerse(null, null);
	}

	/**
	 * Étend ou redémarre la plage de mots à partir du mot choisi.
	 * @param {number} index Index du mot dans le verset.
	 * @returns {void}
	 */
	function selectVerseWord(index: number): void {
		if (index < selectedStartWord) {
			selectedStartWord = index;
		} else if (index > selectedEndWord) {
			selectedEndWord = index;
		} else {
			selectedStartWord = index;
			selectedEndWord = index;
		}
	}

	/**
	 * Transmet la référence et la plage de mots actuellement sélectionnées.
	 * @returns {void}
	 */
	function applySelection(): void {
		if (!selectedVerseData?.words.length) return;
		const isFullVerse =
			selectedStartWord === 0 && selectedEndWord === selectedVerseData.words.length - 1;
		onApply({
			surah: selectedSurah,
			verse: selectedVerse,
			startWord: isFullVerse ? null : selectedStartWord + 1,
			endWord: isFullVerse ? null : selectedEndWord + 1
		});
	}
</script>

<div
	data-quran-passage-selector
	class="absolute inset-0 z-30 flex min-h-0 flex-col bg-black/45 backdrop-blur-md"
>
	<div
		class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-color bg-primary px-5 py-4"
	>
		<p class="flex items-center gap-2 text-base font-semibold text-primary">
			<span class="material-icons text-xl text-accent-primary">menu_book</span>
			{title}
		</p>
		<div class="flex items-center gap-2">
			<button
				type="button"
				class="cursor-pointer rounded-lg border border-color bg-secondary px-3 py-2 text-sm font-semibold text-secondary transition hover:bg-accent hover:text-primary"
				onclick={onCancel}
			>
				{$LL.common.cancel()}
			</button>
			<button
				type="button"
				class="cursor-pointer rounded-lg bg-[var(--accent-primary)] px-4 py-2 text-sm font-semibold text-black transition hover:brightness-110"
				onclick={applySelection}
			>
				{$LL.common.apply()}
			</button>
		</div>
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto bg-primary/95 px-5 py-4">
		<div
			class="-mx-5 -mt-4 mb-4 flex flex-wrap items-end gap-3 border-b border-color bg-secondary px-5 py-3"
		>
			<div class="w-72 max-w-full">
				<span class="mb-1 block text-xs font-semibold text-secondary">
					{$LL.editor.surahLabel()}
				</span>
				<AutocompleteInput
					showEverything
					clearOnFocus
					bind:value={surahSearchValue}
					suggestions={surahSuggestions()}
					placeholder={$LL.editor.searchSurah()}
					icon="menu_book"
					onSelect={selectSurahSuggestion}
				/>
			</div>
			<span class="pb-2 text-xl font-bold text-thirdly">:</span>
			<label class="w-20 text-xs font-semibold text-secondary">
				<span class="mb-1 block">{$LL.editor.verseLabel()}</span>
				<input
					type="number"
					min="1"
					max={selectedSurahVerseCount() || 1}
					value={selectedVerse}
					class="w-full rounded-lg border border-color bg-accent px-2 py-2 text-center text-sm font-semibold text-primary"
					onchange={(event) => changeSelectedVerse(Number(event.currentTarget.value))}
				/>
			</label>
		</div>

		<div class="pt-4">
			{#if selectedVerseData}
				<div class="flex flex-row-reverse flex-wrap content-center justify-start py-2">
					{#each selectedVerseData.words as word, wordIndex (wordIndex)}
						{@const isSelected = selectedStartWord <= wordIndex && wordIndex <= selectedEndWord}
						{@const isFirstSelected = isSelected && wordIndex === selectedStartWord}
						{@const isLastSelected = isSelected && wordIndex === selectedEndWord}
						{@const isSingleSelected = isFirstSelected && isLastSelected}
						<button
							type="button"
							class={`verse-selector-word arabic -mx-px cursor-pointer border-2 border-transparent px-3 py-2 text-3xl leading-relaxed transition ${
								isSelected
									? `verse-selector-word-selected text-[var(--text-on-selected-word)] ${
											isSingleSelected
												? 'verse-selector-word-first verse-selector-word-last'
												: isLastSelected
													? 'verse-selector-word-first'
													: isFirstSelected
														? 'verse-selector-word-last'
														: 'verse-selector-word-middle'
										}`
									: 'rounded-lg text-primary hover:border-color hover:bg-accent'
							}`}
							onclick={() => selectVerseWord(wordIndex)}
						>
							{word.arabic}
						</button>
					{/each}
				</div>
			{:else}
				<div class="flex min-h-28 items-center justify-center text-sm text-thirdly">
					{$LL.common.loading()}
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.verse-selector-word-selected {
		background-color: var(--selected-word-bg);
		border-top-color: var(--accent-primary);
		border-bottom-color: var(--accent-primary);
	}

	.verse-selector-word-first {
		border-left-color: var(--accent-primary);
		border-radius: 12px 0 0 12px;
	}

	.verse-selector-word-last {
		border-right-color: var(--accent-primary);
		border-radius: 0 12px 12px 0;
	}

	.verse-selector-word-middle {
		border-right-color: transparent;
		border-left-color: transparent;
		border-radius: 0;
	}

	.verse-selector-word-first.verse-selector-word-last {
		border-color: var(--accent-primary);
		border-radius: 12px;
	}

	.verse-selector-word-selected:hover {
		position: relative;
		z-index: 1;
		background-color: var(--bg-accent);
		color: var(--text-primary);
	}
</style>
