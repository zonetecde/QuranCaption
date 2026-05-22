<script lang="ts">
	import { open } from '@tauri-apps/plugin-dialog';

	type Mp3QuranReciterOption = {
		id: number;
		name: string;
	};

	type SurahOption = {
		id: number;
		name: string;
		totalAyah: number;
	};

	type Props = {
		letAiChooseQuran: boolean;
		quranSourceMode: string;
		selectedReciterId: number;
		startSurah: number;
		startAyah: number;
		endAyah: number;
		localAudioPath: string;
		reciters: Mp3QuranReciterOption[];
		surahs: SurahOption[];
		isLoadingReciters: boolean;
	};

	const quranSourceModes = ['Reciter and verse range', 'Local audio file'];

	let {
		letAiChooseQuran = $bindable(),
		quranSourceMode = $bindable(),
		selectedReciterId = $bindable(),
		startSurah = $bindable(),
		startAyah = $bindable(),
		endAyah = $bindable(),
		localAudioPath = $bindable(),
		reciters,
		surahs,
		isLoadingReciters
	}: Props = $props();

	const selectedSurahMaxAyah = $derived(
		surahs.find((surah) => surah.id === startSurah)?.totalAyah ?? 1
	);

	/**
	 * Sélectionne un fichier audio local pour le flux manuel du PoC.
	 */
	async function chooseLocalAudioFile() {
		const filePath = await open({
			multiple: false,
			directory: false,
			filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'ogg', 'flac'] }]
		});

		if (typeof filePath === 'string') {
			localAudioPath = filePath;
		}
	}
</script>

<label
	class="flex items-center gap-3 rounded-full border border-color bg-primary px-4 py-2.5 text-sm text-primary"
>
	<input type="checkbox" bind:checked={letAiChooseQuran} />
	<span>Let AI choose the verses and reciter</span>
</label>

{#if !letAiChooseQuran}
	<div
		class="mt-4 space-y-5 rounded-lg border border-color bg-secondary/80 p-5 shadow-xl shadow-black/20"
	>
		<div class="space-y-2">
			<label
				for="ai-video-quran-source"
				class="flex items-center gap-2 text-sm font-semibold text-primary"
			>
				<span class="material-icons text-base text-accent-primary">graphic_eq</span>
				Quran source
			</label>
			<select id="ai-video-quran-source" bind:value={quranSourceMode} class="w-full">
				{#each quranSourceModes as mode (mode)}
					<option value={mode}>{mode}</option>
				{/each}
			</select>
		</div>

		{#if quranSourceMode === 'Reciter and verse range'}
			<div class="space-y-2">
				<label
					for="ai-video-reciter"
					class="flex items-center gap-2 text-sm font-semibold text-primary"
				>
					<span class="material-icons text-base text-accent-primary">record_voice_over</span>
					Reciter
				</label>
				<select
					id="ai-video-reciter"
					bind:value={selectedReciterId}
					class="w-full"
					disabled={isLoadingReciters}
				>
					{#if isLoadingReciters}
						<option value={-1}>Loading MP3Quran reciters...</option>
					{:else}
						<option value={-1}>Select a reciter</option>
						{#each reciters as reciter (reciter.id)}
							<option value={reciter.id}>{reciter.name}</option>
						{/each}
					{/if}
				</select>
			</div>

			<div class="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_8rem_8rem]">
				<div class="space-y-2">
					<label
						for="ai-video-surah"
						class="flex items-center gap-2 text-sm font-semibold text-primary"
					>
						<span class="material-icons text-base text-accent-primary">menu_book</span>
						Surah
					</label>
					<select id="ai-video-surah" bind:value={startSurah} class="w-full">
						{#if surahs.length === 0}
							{#each Array.from({ length: 114 }, (_, index) => index + 1) as surah (surah)}
								<option value={surah}>Surah {surah}</option>
							{/each}
						{:else}
							{#each surahs as surah (surah.id)}
								<option value={surah.id}>{surah.name}</option>
							{/each}
						{/if}
					</select>
				</div>

				<div class="space-y-2 pt-0.75">
					<label
						for="ai-video-start-ayah"
						class="flex items-center gap-2 text-sm font-semibold text-primary"
					>
						Start
					</label>
					<input
						id="ai-video-start-ayah"
						bind:value={startAyah}
						type="number"
						min="1"
						max={selectedSurahMaxAyah}
						class="w-full"
					/>
				</div>

				<div class="space-y-2 pt-0.75">
					<label
						for="ai-video-end-ayah"
						class="flex items-center gap-2 text-sm font-semibold text-primary"
					>
						End
					</label>
					<input
						id="ai-video-end-ayah"
						bind:value={endAyah}
						type="number"
						min="1"
						max={selectedSurahMaxAyah}
						class="w-full"
					/>
				</div>
			</div>
		{:else}
			<div class="space-y-2">
				<label
					for="ai-video-local-audio"
					class="flex items-center gap-2 text-sm font-semibold text-primary"
				>
					<span class="material-icons text-base text-accent-primary">audio_file</span>
					Local audio file
				</label>
				<div class="flex gap-3">
					<input
						id="ai-video-local-audio"
						type="text"
						class="w-full"
						placeholder="No file selected"
						value={localAudioPath}
						readonly
					/>
					<button class="btn px-4 py-2 text-sm" type="button" onclick={chooseLocalAudioFile}>
						Choose
					</button>
				</div>
			</div>
		{/if}
	</div>
{/if}
