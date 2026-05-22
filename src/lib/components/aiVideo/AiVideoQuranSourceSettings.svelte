<script lang="ts">
	import { onMount } from 'svelte';
	import { Quran } from '$lib/classes/Quran';
	import { Mp3QuranService, type Mp3QuranMoshaf } from '$lib/services/Mp3QuranService';
	import AutocompleteInput from '$lib/components/misc/AutocompleteInput.svelte';
	import SearchableSelect from '$lib/components/misc/SearchableSelect.svelte';
	import { open } from '@tauri-apps/plugin-dialog';

	type ReciterOption = {
		label: string;
		reciterName: string;
		moshaf: Mp3QuranMoshaf;
		reciterId: number;
		surahSet: Set<number>;
	};

	let {
		letAiChoose = $bindable(true),
		reciter = $bindable(''),
		selectedReciterOption = $bindable<ReciterOption | null>(null),
		surah = $bindable(1),
		ayahStart = $bindable(1),
		ayahEnd = $bindable(7),
		useLocalAudio = $bindable(false),
		localAudioPath = $bindable('')
	} = $props();

	let reciterOptions: ReciterOption[] = $state([]);
	let isLoadingReciters = $state(true);
	let selectedReciterKey = $state('');
	let reciterSelectOptions = $derived([
		{ value: '', label: 'Let AI decide' },
		...reciterOptions.map((option) => ({
			value: getReciterOptionKey(option),
			label: option.label
		}))
	]);

	let maxAyah = $derived(Quran.getVerseCount(surah) || 1);

	// Clamp ayah values when surah changes
	$effect(() => {
		const max = Quran.getVerseCount(surah) || 1;
		if (ayahStart > max) ayahStart = 1;
		if (ayahEnd > max) ayahEnd = max;
		if (ayahEnd < ayahStart) ayahEnd = ayahStart;
	});

	// Check if selected surah is available for the chosen reciter
	let isSurahAvailable = $derived.by(() => {
		if (!selectedReciterOption) return true;
		return selectedReciterOption.surahSet.has(surah);
	});

	let surahSuggestions = $derived(
		Quran.getSurahsNames().map((s) => `${s.id}. ${s.transliteration}`)
	);

	let surahSearchValue = $state('1. Al-Fatihah');

	function handleSurahSelection(value: string) {
		const match = value.match(/^(\d+)\./);
		if (match) {
			surah = parseInt(match[1]);
			ayahStart = 1;
			ayahEnd = Quran.getVerseCount(surah) || 1;
		}
	}

	/**
	 * Retourne la cle stable utilisee par le select recitateur.
	 * @param {ReciterOption} option Option de recitateur MP3Quran.
	 * @returns {string} Cle unique recitateur/moshaf.
	 */
	function getReciterOptionKey(option: ReciterOption): string {
		return `${option.reciterId}:${option.moshaf.id}`;
	}

	/**
	 * Applique le recitateur choisi dans le select.
	 * @returns {void}
	 */
	function handleReciterChange() {
		const option = reciterOptions.find((item) => getReciterOptionKey(item) === selectedReciterKey);
		selectedReciterOption = option ?? null;
		reciter = option?.reciterName ?? '';
	}

	$effect(() => {
		selectedReciterKey = selectedReciterOption ? getReciterOptionKey(selectedReciterOption) : '';
	});

	onMount(async () => {
		try {
			const mp3Reciters = await Mp3QuranService.getReciters();
			const options: ReciterOption[] = [];
			for (const rec of mp3Reciters) {
				for (const moshaf of rec.moshaf) {
					options.push({
						label: `${rec.name} — ${moshaf.name}`,
						reciterName: rec.name,
						moshaf,
						reciterId: rec.id,
						surahSet: new Set(moshaf.surah_list.split(',').map(Number))
					});
				}
			}
			reciterOptions = options.sort((a, b) => a.label.localeCompare(b.label));
		} catch (error) {
			console.error('Failed to load mp3quran reciters:', error);
		} finally {
			isLoadingReciters = false;
		}
	});

	async function pickLocalAudio() {
		const file = await open({
			multiple: false,
			directory: false,
			filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'] }]
		});
		if (file) {
			localAudioPath = file;
			useLocalAudio = true;
		}
	}
</script>

<div class="space-y-5 rounded-xl border border-color bg-bg-secondary/50 p-5">
	<h3 class="flex items-center gap-2 text-sm font-semibold text-primary">
		<span class="material-icons text-accent-primary text-base">tune</span>
		Quran Source Settings
	</h3>

	<!-- Source toggle -->
	<div class="flex gap-3">
		<button
			type="button"
			class="flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-all cursor-pointer {!useLocalAudio
				? 'border-accent-primary bg-accent-primary/15 text-accent-primary'
				: 'border-color bg-bg-secondary text-secondary hover:border-accent-primary/50'}"
			onclick={() => (useLocalAudio = false)}
		>
			<span class="material-icons text-base align-middle mr-1">cloud</span>
			MP3Quran Reciter
		</button>
		<button
			type="button"
			class="flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-all cursor-pointer {useLocalAudio
				? 'border-accent-primary bg-accent-primary/15 text-accent-primary'
				: 'border-color bg-bg-secondary text-secondary hover:border-accent-primary/50'}"
			onclick={() => (useLocalAudio = true)}
		>
			<span class="material-icons text-base align-middle mr-1">folder_open</span>
			Local Audio File
		</button>
	</div>

	{#if useLocalAudio}
		<!-- Local audio file picker -->
		<div class="space-y-2">
			<span class="flex items-center gap-2 text-sm font-semibold text-primary">
				<span class="material-icons text-accent-primary text-base">audio_file</span>
				Audio File
			</span>
			<div class="flex gap-2">
				<input
					type="text"
					readonly
					value={localAudioPath}
					placeholder="No file selected"
					class="flex-1 rounded-xl border border-color bg-bg-secondary px-4 py-3 text-primary text-sm truncate"
				/>
				<button
					type="button"
					class="rounded-xl border border-color bg-bg-secondary px-4 py-3 text-sm font-medium text-primary hover:border-accent-primary/50 transition-all cursor-pointer"
					onclick={pickLocalAudio}
				>
					Browse
				</button>
			</div>
		</div>
	{:else}
		<!-- Mp3Quran reciter selector -->
		<div class="space-y-2">
			<span class="flex items-center gap-2 text-sm font-semibold text-primary">
				<span class="material-icons text-accent-primary text-base">record_voice_over</span>
				Reciter
			</span>

			{#if isLoadingReciters}
				<div class="flex items-center gap-2 text-sm text-thirdly py-3">
					<span class="material-icons animate-spin text-base">autorenew</span>
					Loading reciters from MP3Quran...
				</div>
			{:else}
				<SearchableSelect
					id="reciter-select"
					bind:value={selectedReciterKey}
					options={reciterSelectOptions}
					placeholder="Let AI decide"
					searchPlaceholder="Search reciters..."
					emptyMessage="No reciters found"
					onChange={handleReciterChange}
				/>
			{/if}
		</div>
	{/if}

	{#if !useLocalAudio && !letAiChoose}
		<!-- Surah / Ayah range -->
		<div class="space-y-2">
			<span class="flex items-center gap-2 text-sm font-semibold text-primary">
				<span class="material-icons text-accent-primary text-base">menu_book</span>
				Surah & Verse Range
			</span>

			<div style="position: relative; z-index: 90;">
				<AutocompleteInput
					bind:value={surahSearchValue}
					suggestions={surahSuggestions}
					placeholder="Search surah..."
					icon="search"
					label=""
					onSelect={handleSurahSelection}
				/>
			</div>

			{#if selectedReciterOption && !isSurahAvailable}
				<p class="text-xs text-red-400 flex items-center gap-1">
					<span class="material-icons text-xs">warning</span>
					This surah is not available for the selected reciter/moshaf.
				</p>
			{/if}

			<div class="flex gap-3 mt-2">
				<div class="flex-1 space-y-1">
					<label for="ayah-start" class="text-xs text-thirdly">From Ayah</label>
					<input
						id="ayah-start"
						type="number"
						bind:value={ayahStart}
						min={1}
						max={maxAyah}
						class="w-full rounded-xl border border-color bg-bg-secondary px-4 py-2.5 text-primary text-sm"
					/>
				</div>
				<div class="flex-1 space-y-1">
					<label for="ayah-end" class="text-xs text-thirdly">To Ayah</label>
					<input
						id="ayah-end"
						type="number"
						bind:value={ayahEnd}
						min={ayahStart}
						max={maxAyah}
						class="w-full rounded-xl border border-color bg-bg-secondary px-4 py-2.5 text-primary text-sm"
					/>
				</div>
			</div>
		</div>
	{/if}
</div>
