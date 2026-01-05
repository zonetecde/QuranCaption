<script lang="ts">
	import { Quran } from '$lib/classes/Quran';
	import { globalState } from '$lib/runes/main.svelte';
	import AutocompleteInput from '$lib/components/misc/AutocompleteInput.svelte';

	let subtitlesEditorState = $derived(() => globalState.getSubtitlesEditorState);

	// Create suggestions array for autocomplete
	let surahSuggestions = $derived(() => {
		return Quran.getSurahsNames().map((surah) => `${surah.id}. ${surah.transliteration}`);
	});

	// Current search value for surah
	let surahSearchValue = $state('');

	// Get current surah name for display
	let currentSurahName = $derived(() => {
		const surahId = globalState.getSubtitlesEditorState.selectedSurah;
		const surah = Quran.getSurahsNames().find((s) => s.id === surahId);
		return surah ? `${surah.id}. ${surah.transliteration}` : '';
	});

	// Update search value when current surah changes
	$effect(() => {
		surahSearchValue = currentSurahName();
	});

	function handleSurahSelection(selectedValue: string) {
		// Extract ID from the selected value (format: "1. Al-Fatihah")
		const match = selectedValue.match(/^(\d+)\./);
		if (match) {
			const surahId = parseInt(match[1]);
			globalState.getSubtitlesEditorState.selectedSurah = surahId;
			subtitlesEditorState().selectedVerse = 1;
			subtitlesEditorState().startWordIndex = 0;
			subtitlesEditorState().endWordIndex = 0;
		}
	}

	// Watch for changes in search value to update selection
	$effect(() => {
		if (surahSearchValue && surahSearchValue !== currentSurahName()) {
			handleSurahSelection(surahSearchValue);
		}
	});
</script>

<section
	class="w-full flex gap-3 items-center px-3 bg-secondary border border-color rounded-lg py-2"
>
	<div class="flex gap-2 items-center">
		<div class="flex gap-2 items-center group relative">
			<span class="material-icons text-2xl!">help</span>
			<div
				class="group transition-opacity text-sm text-[var(--text-secondary)] absolute top-4.5 left-3.5 bg-primary px-3 w-[400px] py-3 border-2 border-[var(--border-color)]/90 rounded-lg max-h-[400px] overflow-auto z-20 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"
			>
				<div class="space-y-2 mb-3">
					<div class="text-secondary text-sm font-semibold">Need a visual walkthrough?</div>
					<p class="text-xs text-thirdly">
						Here is a short video that demonstrates how the subtitles editor works:
					</p>
					<div class="relative w-full overflow-hidden rounded-md border border-color">
						<iframe
							class="w-full aspect-video"
							src="https://www.youtube.com/embed/vCRUjzATRDk?start=35"
							title="Subtitles editor walkthrough"
							allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
							allowfullscreen
						></iframe>
					</div>
				</div>

				<div class="border-t border-color my-3"></div>

				Press<span class="font-mono bg-accent px-1 rounded-sm">space</span> to play/pause the
				recitation.
				<br />
				<!-- arrowup/arrowdown -->
				Use <span class="font-mono bg-accent px-1 rounded-sm">↑</span> and
				<span class="font-mono bg-accent px-1 rounded-sm">↓</span> to select words.
				<br /> When the reciter finishes a verse, or a part of a verse, press
				<span class="font-mono bg-accent px-1 rounded-sm">enter</span> to add a subtitle at the
				current time with the selected words.

				<!-- separator line -->
				<div class="border-t border-color my-3"></div>

				<!-- list of shortcuts -->
				{#each Object.entries(globalState.settings!.shortcuts.SUBTITLES_EDITOR).concat(Object.entries(globalState.settings!.shortcuts.VIDEO_PREVIEW)) as [action, shortcut]}
					<div class="flex items-center justify-between py-1 border-b border-color last:border-0">
						<div class="flex flex-col">
							<span class="text-sm font-medium text-secondary">{shortcut.name}</span>
							<span class="text-xs italic font-medium text-secondary">{shortcut.description}</span>
						</div>
						<span class="font-mono bg-accent px-1 rounded-sm">{shortcut.keys.join(', ')}</span>
					</div>
				{/each}
			</div>
		</div>

	</div>

	<!-- Surah Selector with Autocomplete -->
	<div class="flex items-center gap-2 ml-auto">
		<span class="text-sm font-medium text-secondary">Surah:</span>
		<div class="min-w-[200px]">
			<AutocompleteInput
				showEverything
				clearOnFocus
				bind:value={surahSearchValue}
				suggestions={surahSuggestions()}
				placeholder="Search surah"
				icon=""
			/>
		</div>
	</div>

	<!-- Separator -->
	<div class="flex items-center">
		<span class="text-lg font-bold text-accent mx-2">:</span>
	</div>

	<!-- Verse Selector -->
	<div class="flex items-center gap-2">
		<span class="text-sm font-medium text-secondary">Verse:</span>
		<input
			type="number"
			min="1"
			placeholder="1"
			class="bg-accent border border-color text-primary rounded-lg px-3 py-2 text-sm font-medium text-center w-20"
			max={Quran.getVerseCount(subtitlesEditorState().selectedSurah)}
			onchange={() => {
				subtitlesEditorState().startWordIndex = 0;
				subtitlesEditorState().endWordIndex = 0;
			}}
			bind:value={globalState.getSubtitlesEditorState.selectedVerse}
		/>
	</div>
</section>
