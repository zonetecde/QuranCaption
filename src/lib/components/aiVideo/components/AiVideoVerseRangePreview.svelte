<script lang="ts">
	import { Quran, type Verse } from '$lib/classes/Quran';
	import { ProjectTranslation } from '$lib/classes';
	import type { Edition } from '$lib/classes';
	import { globalState } from '$lib/runes/main.svelte';

	let {
		surah,
		ayahStart,
		ayahEnd,
		selectedTranslation
	}: {
		surah: number;
		ayahStart: number;
		ayahEnd: number;
		selectedTranslation: Edition | null;
	} = $props();

	type VersePreview = {
		verse: number;
		arabic: string;
		translation: string | null;
	};

	let verses = $state<VersePreview[]>([]);
	let isLoading = $state(false);
	let loadKey = $state('');

	let surahName = $derived(() => {
		const names = Quran.getSurahsNames();
		const found = names.find((s) => s.id === surah);
		return found ? found.transliteration : `Surah ${surah}`;
	});

	// Reload verses when surah/range/translation changes
	$effect(() => {
		const key = `${surah}:${ayahStart}-${ayahEnd}:${selectedTranslation?.name ?? 'none'}`;
		if (key === loadKey) return;
		loadKey = key;
		loadVerses();
	});

	async function loadVerses() {
		isLoading = true;
		try {
			const surahData = await Quran.getSurah(surah);
			const start = Math.max(1, ayahStart);
			const end = Math.min(ayahEnd, surahData.totalAyah);
			const result: VersePreview[] = [];

			for (let v = start; v <= end; v++) {
				const verseObj = surahData.verses.find((vr) => vr.id === v);
				const arabic = verseObj ? verseObj.words.map((w) => w.arabic).join(' ') : '';

				let translation: string | null = null;
				if (selectedTranslation) {
					const pt = new ProjectTranslation();
					const text = await pt.downloadVerseTranslation(selectedTranslation, surah, v);
					if (text && text !== 'No translation found') {
						translation = text;
					}
				}

				result.push({ verse: v, arabic, translation });
			}

			verses = result;
		} catch (error) {
			console.error('Failed to load verse preview:', error);
			verses = [];
		} finally {
			isLoading = false;
		}
	}
</script>

<div class="rounded-xl border border-color bg-[var(--bg-accent)] overflow-hidden">
	<!-- Header -->
	<div
		class="flex items-center justify-between px-4 py-3 border-b border-color bg-[var(--bg-accent)]"
	>
		<div class="flex items-center gap-2">
			<span class="material-icons text-accent-primary text-sm">menu_book</span>
			<span class="text-xs font-semibold text-thirdly uppercase tracking-wide">Verse Preview</span>
		</div>
		<span class="text-xs text-thirdly">
			{surahName()} — {ayahStart}:{ayahEnd}
			({ayahEnd - ayahStart + 1} verse{ayahEnd - ayahStart + 1 > 1 ? 's' : ''})
		</span>
	</div>

	<!-- Verses -->
	<div class="max-h-72 overflow-y-auto">
		{#if isLoading}
			<div class="flex items-center justify-center py-8 gap-2 text-sm text-thirdly">
				<span class="material-icons animate-spin text-base">autorenew</span>
				Loading verses...
			</div>
		{:else if verses.length === 0}
			<p class="py-6 text-center text-sm text-thirdly">No verses to preview</p>
		{:else}
			{#each verses as v (v.verse)}
				<div
					class="px-4 py-3 border-b border-color last:border-b-0 hover:bg-accent/30 transition-colors"
				>
					<!-- Verse number badge -->
					<div class="flex items-start gap-3">
						<span
							class="shrink-0 mt-1 w-7 h-7 rounded-full bg-accent-primary/15 text-accent-primary text-xs font-bold flex items-center justify-center"
						>
							{v.verse}
						</span>
						<div class="min-w-0 flex-1 space-y-1.5">
							<!-- Arabic text -->
							<p
								class="text-primary text-base leading-loose text-right font-['Amiri',serif]"
								dir="rtl"
							>
								{v.arabic}
							</p>
							<!-- Translation -->
							{#if v.translation}
								<p class="text-secondary text-sm leading-relaxed">
									{v.translation}
								</p>
							{/if}
						</div>
					</div>
				</div>
			{/each}
		{/if}
	</div>
</div>
