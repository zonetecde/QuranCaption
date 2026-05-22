<script lang="ts">
	import { onMount } from 'svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { Quran } from '$lib/classes/Quran';
	import { Mp3QuranService, type Mp3QuranReciter } from '$lib/services/Mp3QuranService';
	import AiVideoGenerationOptions from './AiVideoGenerationOptions.svelte';
	import AiVideoPromptField from './AiVideoPromptField.svelte';
	import AiVideoQuranSourceSettings from './AiVideoQuranSourceSettings.svelte';
	import AiVideoVerseRangePreview from './AiVideoVerseRangePreview.svelte';

	const defaultModel = 'Mock Provider / Cinematic Nature';

	let prompt = $state('');
	let selectedModel = $state(defaultModel);
	let selectedResolution = $state('Portrait');
	let letAiChooseQuran = $state(true);
	let quranSourceMode = $state('Reciter and verse range');
	let selectedReciterId = $state(-1);
	let startSurah = $state(1);
	let startAyah = $state(1);
	let endAyah = $state(7);
	let localAudioPath = $state('');
	let mp3QuranReciters: Mp3QuranReciter[] = $state([]);
	let surahOptions: { id: number; name: string; totalAyah: number }[] = $state([]);
	let isLoadingReciters = $state(false);

	const reciterOptions = $derived(
		mp3QuranReciters
			.map((reciter) => ({ id: reciter.id, name: reciter.name }))
			.sort((a, b) => a.name.localeCompare(b.name))
	);
	const showVersePreview = $derived(
		!letAiChooseQuran && quranSourceMode === 'Reciter and verse range'
	);

	/**
	 * Charge les données nécessaires aux sélecteurs manuels du PoC.
	 */
	async function loadAiVideoOptions() {
		isLoadingReciters = true;
		try {
			const [loadedReciters] = await Promise.all([Mp3QuranService.getReciters(), Quran.load()]);
			mp3QuranReciters = loadedReciters;
			surahOptions = Quran.getSurahs().map((surah) => ({
				id: surah.id,
				name: `${surah.id}. ${surah.name}`,
				totalAyah: surah.totalAyah
			}));
		} finally {
			isLoadingReciters = false;
		}
	}

	onMount(() => {
		void loadAiVideoOptions();
	});
</script>

<div class="relative min-h-full overflow-hidden bg-primary">
	<div class="pointer-events-none absolute inset-0 opacity-60">
		<div
			class="absolute left-1/2 top-1/2 h-[34rem] w-[58rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(88,166,255,0.13)_0%,rgba(88,166,255,0.04)_42%,transparent_70%)]"
		></div>
	</div>

	<div class="relative flex min-h-[calc(100vh-2.5rem)] flex-col px-4 py-6 xl:px-10">
		<button
			type="button"
			class="btn btn-icon w-fit px-3 py-2 text-sm"
			aria-label="Back to homepage"
			title="Back to homepage"
			onclick={() => (globalState.uiState.isUsingAiVideoPromptMode = false)}
		>
			<span class="material-icons-outlined text-[22px]">arrow_back</span>
		</button>

		<div class="flex flex-1 items-center justify-center py-10">
			<section class="w-full max-w-5xl">
				<div class="mb-7 text-center">
					<h2 class="text-4xl font-bold text-primary">AI Video</h2>
				</div>

				<div
					class={showVersePreview
						? 'grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]'
						: ''}
				>
					<div
						class="rounded-[32px] border border-color bg-[color-mix(in_srgb,var(--bg-secondary)_88%,transparent)] p-4 shadow-2xl shadow-black/35 backdrop-blur-md"
					>
						<AiVideoPromptField bind:prompt />

						<div class="mt-4 flex flex-col gap-3">
							<div class="flex flex-col gap-3 lg:flex-row lg:items-center">
								<div class="min-w-0 flex-1">
									<AiVideoGenerationOptions bind:selectedModel bind:selectedResolution />
								</div>

								<button
									class="flex min-h-11 items-center justify-center gap-2 rounded-full bg-accent-primary px-6 py-2.5 text-sm font-semibold text-black shadow-lg transition-all duration-200 hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
									disabled={prompt.trim() === ''}
								>
									<span class="material-icons text-[20px]">auto_awesome</span>
									Generate
								</button>
							</div>

							<AiVideoQuranSourceSettings
								bind:letAiChooseQuran
								bind:quranSourceMode
								bind:selectedReciterId
								bind:startSurah
								bind:startAyah
								bind:endAyah
								bind:localAudioPath
								reciters={reciterOptions}
								surahs={surahOptions}
								{isLoadingReciters}
							/>
						</div>
					</div>

					<AiVideoVerseRangePreview
						surahId={startSurah}
						{startAyah}
						{endAyah}
						isVisible={showVersePreview}
					/>
				</div>
			</section>
		</div>
	</div>
</div>
