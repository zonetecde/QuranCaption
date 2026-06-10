<script lang="ts">
	import { Quran } from '$lib/classes/Quran';
	import { globalState } from '$lib/runes/main.svelte';
	import SearchableSelect from '$lib/components/misc/SearchableSelect.svelte';
	import { getReciterOptionKey, isSurahAvailableForReciter } from '../reciterLoader';
	import { open } from '@tauri-apps/plugin-dialog';
	import LL from '$lib/i18n/i18n-svelte';

	const aiv = globalState.aiVideo;

	let selectedReciterKey = $state(aiv.audio.reciter ? getReciterOptionKey(aiv.audio.reciter) : '');
	let surahKey = $state(aiv.selectedVerseRange.surah.toString());

	let maxAyah = $derived(Quran.getVerseCount(aiv.selectedVerseRange.surah) || 1);

	// Clamp les valeurs lorsque la sourate change
	$effect(() => {
		const max = Quran.getVerseCount(aiv.selectedVerseRange.surah) || 1;
		if (aiv.selectedVerseRange.startVerse > max) aiv.selectedVerseRange.startVerse = 1;
		if (aiv.selectedVerseRange.endVerse > max) aiv.selectedVerseRange.endVerse = max;
		if (aiv.selectedVerseRange.endVerse < aiv.selectedVerseRange.startVerse)
			aiv.selectedVerseRange.endVerse = aiv.selectedVerseRange.startVerse;
	});

	let isSurahAvailable = $derived.by(() => {
		if (!aiv.audio.reciter) return true;
		return isSurahAvailableForReciter(aiv.audio.reciter, aiv.selectedVerseRange.surah);
	});

	let reciterSelectOptions = $derived([
		{ value: '', label: 'Let AI decide' },
		...aiv.reciterOptions.map((option) => ({
			value: getReciterOptionKey(option),
			label: option.label
		}))
	]);

	let surahOptions = $derived(
		Quran.getSurahsNames().map((s) => ({
			value: s.id.toString(),
			label: `${s.id}. ${s.transliteration}`
		}))
	);

	$effect(() => {
		selectedReciterKey = aiv.audio.reciter ? getReciterOptionKey(aiv.audio.reciter) : '';
	});

	$effect(() => {
		surahKey = aiv.selectedVerseRange.surah.toString();
	});

	/**
	 * Applique le recitateur choisi dans le select.
	 * @returns {void}
	 */
	function handleReciterChange() {
		const option = aiv.reciterOptions.find((o) => getReciterOptionKey(o) === selectedReciterKey);
		aiv.audio.reciter = option ?? null;
		aiv.audio.reciterName = option?.reciterName ?? '';
	}

	/**
	 * Applique la sourate choisie dans le select.
	 * @returns {void}
	 */
	function handleSurahChange() {
		aiv.selectedVerseRange.surah = parseInt(surahKey);
		aiv.selectedVerseRange.startVerse = 1;
		aiv.selectedVerseRange.endVerse = Quran.getVerseCount(aiv.selectedVerseRange.surah) || 1;
	}

	/**
	 * Ouvre un dialogue natif pour selectionner un fichier audio local.
	 * @returns {Promise<void>}
	 */
	async function pickLocalAudio(): Promise<void> {
		const file = await open({
			multiple: false,
			directory: false,
			filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'] }]
		});
		if (file) {
			aiv.audio.localPath = file;
			aiv.audio.useLocal = true;
		}
	}
</script>

<div class="space-y-5 rounded-xl border border-color bg-[var(--bg-accent)] p-5">
	<h3 class="flex items-center gap-2 text-sm font-semibold text-primary">
		<span class="material-icons text-accent-primary text-base">tune</span>
		{$LL.aiVideo.quranSourceSettings()}
	</h3>

	<!-- Source toggle -->
	<div class="flex gap-3">
		<button
			type="button"
			class="flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-all cursor-pointer {!aiv
				.audio.useLocal
				? 'border-accent-primary bg-accent-primary/15 text-accent-primary'
				: 'border-color bg-bg-secondary text-secondary hover:border-accent-primary/50'}"
			onclick={() => (aiv.audio.useLocal = false)}
		>
			<span class="material-icons text-base align-middle mr-1">cloud</span>
			{$LL.aiVideo.mp3QuranReciter()}
		</button>
		<button
			type="button"
			class="flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-all cursor-pointer {aiv
				.audio.useLocal
				? 'border-accent-primary bg-accent-primary/15 text-accent-primary'
				: 'border-color bg-bg-secondary text-secondary hover:border-accent-primary/50'}"
			onclick={() => (aiv.audio.useLocal = true)}
		>
			<span class="material-icons text-base align-middle mr-1">folder_open</span>
			{$LL.aiVideo.localAudioFile()}
		</button>
	</div>

	{#if aiv.audio.useLocal}
		<!-- Local audio file picker -->
		<div class="space-y-2">
			<span class="flex items-center gap-2 text-sm font-semibold text-primary">
				<span class="material-icons text-accent-primary text-base">audio_file</span>
				{$LL.aiVideo.audioFile()}
			</span>
			<div class="flex gap-2">
				<input
					type="text"
					readonly
					value={aiv.audio.localPath}
					placeholder={$LL.aiVideo.noFileSelected()}
					class="flex-1 rounded-xl border border-color bg-bg-secondary px-4 py-3 text-primary text-sm truncate"
				/>
				<button
					type="button"
					class="rounded-xl border border-color bg-bg-secondary px-4 py-3 text-sm font-medium text-primary hover:border-accent-primary/50 transition-all cursor-pointer"
					onclick={pickLocalAudio}
				>
					{$LL.aiVideo.browse()}
				</button>
			</div>
		</div>
	{:else}
		<!-- Mp3Quran reciter selector -->
		<div class="space-y-2">
			<span class="flex items-center gap-2 text-sm font-semibold text-primary">
				<span class="material-icons text-accent-primary text-base">record_voice_over</span>
				{$LL.aiVideo.selectReciterLabel()}
			</span>

			{#if aiv.isLoadingReciters}
				<div class="flex items-center gap-2 text-sm text-thirdly py-3">
					<span class="material-icons animate-spin text-base">autorenew</span>
					{$LL.aiVideo.loadingReciters()}
				</div>
			{:else}
				<SearchableSelect
					id="reciter-select"
					bind:value={selectedReciterKey}
					options={reciterSelectOptions}
					placeholder={$LL.aiVideo.letAiDecide()}
					searchPlaceholder={$LL.aiVideo.searchRecitersPlaceholder()}
					emptyMessage={$LL.aiVideo.noRecitersFound()}
					onChange={handleReciterChange}
				/>
			{/if}
		</div>
	{/if}

	{#if !aiv.audio.useLocal && !aiv.ai.letAiChoose}
		<!-- Surah / Verse Range -->
		<div class="space-y-2">
			<span class="flex items-center gap-2 text-sm font-semibold text-primary">
				<span class="material-icons text-accent-primary text-base">menu_book</span>
				{$LL.aiVideo.surahAndVerseRange()}
			</span>

			<SearchableSelect
				id="surah-select"
				bind:value={surahKey}
				options={surahOptions}
				placeholder={$LL.aiVideo.selectSurahPlaceholder()}
				searchPlaceholder={$LL.aiVideo.searchSurahPlaceholder()}
				emptyMessage={$LL.aiVideo.noSurahFound()}
				onChange={handleSurahChange}
			/>

			{#if aiv.audio.reciter && !isSurahAvailable}
				<p class="text-xs text-red-400 flex items-center gap-1">
					<span class="material-icons text-xs">warning</span>
					{$LL.aiVideo.surahNotAvailable()}
				</p>
			{/if}

			<div class="flex gap-3 mt-2">
				<div class="flex-1 space-y-1">
					<label for="ayah-start" class="text-xs text-thirdly">{$LL.aiVideo.fromAyah()}</label>
					<input
						id="ayah-start"
						type="number"
						bind:value={aiv.selectedVerseRange.startVerse}
						min={1}
						max={maxAyah}
						class="w-full rounded-xl border border-color bg-bg-secondary px-4 py-2.5 text-primary text-sm"
					/>
				</div>
				<div class="flex-1 space-y-1">
					<label for="ayah-end" class="text-xs text-thirdly">{$LL.aiVideo.toAyah()}</label>
					<input
						id="ayah-end"
						type="number"
						bind:value={aiv.selectedVerseRange.endVerse}
						min={aiv.selectedVerseRange.startVerse}
						max={maxAyah}
						class="w-full rounded-xl border border-color bg-bg-secondary px-4 py-2.5 text-primary text-sm"
					/>
				</div>
			</div>
		</div>
	{/if}
</div>
