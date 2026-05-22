<script lang="ts">
	import { Quran } from '$lib/classes/Quran';
	import { globalState } from '$lib/runes/main.svelte';
	import SearchableSelect from '$lib/components/misc/SearchableSelect.svelte';
	import AiVideoVerseRangePreview from './AiVideoVerseRangePreview.svelte';
	import { getReciterOptionKey } from '../reciterLoader';
	import type { ReciterOption } from '../types';

	const aiv = globalState.aiVideo;

	let surahOptions = $derived(
		Quran.getSurahsNames().map((s) => ({
			value: s.id.toString(),
			label: `${s.id}. ${s.transliteration}`
		}))
	);

	let reciterSelectOptions = $derived(
		aiv.reciterOptions.map((option) => ({
			value: getReciterOptionKey(option),
			label: option.label
		}))
	);

	let reviewSurahKey = $state(aiv.review.verseRange.surah.toString());
	let reviewReciterKey = $state(
		aiv.audio.reciter ? getReciterOptionKey(aiv.audio.reciter) : ''
	);

	let reviewMaxAyah = $derived(Quran.getVerseCount(aiv.review.verseRange.surah) || 1);

	// Clamp les valeurs lorsque la sourate change
	$effect(() => {
		const max = Quran.getVerseCount(aiv.review.verseRange.surah) || 1;
		if (aiv.review.verseRange.startVerse > max) aiv.review.verseRange.startVerse = 1;
		if (aiv.review.verseRange.endVerse > max) aiv.review.verseRange.endVerse = max;
		if (aiv.review.verseRange.endVerse < aiv.review.verseRange.startVerse)
			aiv.review.verseRange.endVerse = aiv.review.verseRange.startVerse;
	});

	$effect(() => {
		reviewSurahKey = aiv.review.verseRange.surah.toString();
	});

	let reviewSurahName = $derived(() => {
		const names = Quran.getSurahsNames();
		const found = names.find((s) => s.id === aiv.review.verseRange.surah);
		return found ? `${found.id}. ${found.transliteration}` : `${aiv.review.verseRange.surah}`;
	});

	/**
	 * Applique la sourate choisie dans le select de review.
	 * @returns {void}
	 */
	function handleReviewSurahChange() {
		aiv.review.verseRange.surah = parseInt(reviewSurahKey);
		aiv.review.verseRange.startVerse = 1;
		aiv.review.verseRange.endVerse = Quran.getVerseCount(aiv.review.verseRange.surah) || 1;
	}

	/**
	 * Applique le recitateur choisi dans le select de review.
	 * @returns {void}
	 */
	function handleReviewReciterChange() {
		const option = aiv.reciterOptions.find(
			(o) => getReciterOptionKey(o) === reviewReciterKey
		);
		aiv.audio.reciter = option ?? null;
		aiv.review.reciterName = option?.reciterName ?? '';
		aiv.audio.reciterName = option?.reciterName ?? '';
	}
</script>

<div class="space-y-6">
	<!-- Video Generation Prompt -->
	<div class="space-y-2">
		<span class="flex items-center gap-2 text-sm font-semibold text-primary">
			<span class="material-icons text-accent-primary text-base">movie_creation</span>
			{aiv.video.sourceMode === 'youtube' ? 'YouTube Video URL' : 'Video Generation Prompt'}
		</span>
		{#if aiv.video.sourceMode === 'youtube'}
			<input
				type="text"
				bind:value={aiv.review.videoPrompt}
				class="w-full rounded-xl border border-color bg-bg-secondary px-4 py-3 text-primary placeholder:text-thirdly focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary transition-all text-sm"
				placeholder="https://www.youtube.com/watch?v=..."
			/>
			<p class="text-xs text-thirdly">
				The downloaded video's own orientation will be used automatically.
			</p>
		{:else}
			<textarea
				bind:value={aiv.review.videoPrompt}
				rows={4}
				class="w-full rounded-xl border border-color bg-bg-secondary px-4 py-3 text-primary placeholder:text-thirdly resize-none focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary transition-all text-sm leading-relaxed"
				placeholder="Visual description for the AI video generator..."
			></textarea>
			<p class="text-xs text-thirdly">
				This prompt will be sent to the video generation API. Edit it to adjust the visual style.
			</p>
		{/if}
	</div>

	<!-- Reciter -->
	<div class="space-y-2">
		<span class="flex items-center gap-2 text-sm font-semibold text-primary">
			<span class="material-icons text-accent-primary text-base">record_voice_over</span>
			Reciter
		</span>
		<SearchableSelect
			id="review-reciter-select"
			bind:value={reviewReciterKey}
			options={reciterSelectOptions}
			placeholder="Select a reciter"
			searchPlaceholder="Search reciters..."
			emptyMessage="No reciters found"
			onChange={handleReviewReciterChange}
		/>
	</div>

	{#if !aiv.audio.useLocal || aiv.ai.letAiChoose}
		<!-- Verse Range -->
		<div class="space-y-3">
			<span class="flex items-center gap-2 text-sm font-semibold text-primary">
				<span class="material-icons text-accent-primary text-base">menu_book</span>
				Verse Range
			</span>

			<SearchableSelect
				id="review-surah-select"
				bind:value={reviewSurahKey}
				options={surahOptions}
				placeholder="Select surah"
				searchPlaceholder="Search surah..."
				emptyMessage="No surah found"
				onChange={handleReviewSurahChange}
			/>

			<div class="flex gap-3">
				<div class="flex-1 space-y-1">
					<label for="review-ayah-start" class="text-xs text-thirdly">From Ayah</label>
					<input
						id="review-ayah-start"
						type="number"
						bind:value={aiv.review.verseRange.startVerse}
						min={1}
						max={reviewMaxAyah}
						class="w-full rounded-xl border border-color bg-bg-secondary px-4 py-2.5 text-primary text-sm"
					/>
				</div>
				<div class="flex-1 space-y-1">
					<label for="review-ayah-end" class="text-xs text-thirdly">To Ayah</label>
					<input
						id="review-ayah-end"
						type="number"
						bind:value={aiv.review.verseRange.endVerse}
						min={aiv.review.verseRange.startVerse}
						max={reviewMaxAyah}
						class="w-full rounded-xl border border-color bg-bg-secondary px-4 py-2.5 text-primary text-sm"
					/>
				</div>
			</div>
		</div>

		<!-- Verse preview -->
		<AiVideoVerseRangePreview
			surah={aiv.review.verseRange.surah}
			ayahStart={aiv.review.verseRange.startVerse}
			ayahEnd={aiv.review.verseRange.endVerse}
			selectedTranslation={aiv.selectedTranslation}
		/>
	{/if}

	<!-- Summary card -->
	<div class="rounded-xl border border-color bg-[var(--bg-accent)] p-5 space-y-3">
		<h4 class="flex items-center gap-2 text-xs font-semibold text-thirdly uppercase tracking-wide">
			<span class="material-icons text-accent-primary text-sm">summarize</span>
			Summary
		</h4>
		<div class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
			<div>
				<span class="text-thirdly text-xs">
					{aiv.video.sourceMode === 'youtube' ? 'Background Video' : 'Theme'}
				</span>
				<p class="text-primary font-medium truncate">
					{aiv.video.sourceMode === 'youtube' ? aiv.review.videoPrompt : aiv.video.prompt}
				</p>
			</div>
			{#if aiv.video.sourceMode === 'ai'}
				<div>
					<span class="text-thirdly text-xs">Model</span>
					<p class="text-primary font-medium">{aiv.video.model}</p>
				</div>
			{/if}
			{#if !aiv.audio.useLocal || aiv.ai.letAiChoose}
				<div>
					<span class="text-thirdly text-xs">Surah</span>
					<p class="text-primary font-medium">{reviewSurahName()}</p>
				</div>
			{/if}
			<div>
				<span class="text-thirdly text-xs">Verses</span>
				<p class="text-primary font-medium">
					{aiv.review.verseRange.startVerse} – {aiv.review.verseRange.endVerse}
				</p>
			</div>
			<div>
				<span class="text-thirdly text-xs">Reciter</span>
				<p class="text-primary font-medium truncate">{aiv.review.reciterName}</p>
			</div>
			{#if aiv.video.sourceMode === 'ai'}
				<div>
					<span class="text-thirdly text-xs">Resolution</span>
					<p class="text-primary font-medium">
						{aiv.video.resolution === 'portrait' ? 'Portrait (9:16)' : 'Landscape (16:9)'}
					</p>
				</div>
			{/if}
			{#if aiv.selectedTranslation}
				<div class="col-span-2">
					<span class="text-thirdly text-xs">Translation</span>
					<p class="text-primary font-medium">
						{aiv.selectedTranslation.author} ({aiv.selectedTranslation.language})
					</p>
				</div>
			{/if}
		</div>
	</div>

	<!-- Action buttons -->
	<div class="flex gap-3">
		<button
			type="button"
			class="flex-1 rounded-xl border border-color bg-bg-secondary px-6 py-4 text-sm font-medium text-primary hover:border-accent-primary/50 transition-all cursor-pointer flex items-center justify-center gap-2"
			disabled={aiv.isCreatingProject}
			onclick={() => (aiv.step = 'input')}
		>
			<span class="material-icons text-base">arrow_back</span>
			Back
		</button>
		<button
			type="button"
			class="flex-[2] rounded-xl bg-accent-primary px-6 py-4 text-base font-semibold text-black shadow-lg hover:bg-blue-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2"
			disabled={aiv.isCreatingProject || aiv.review.videoPrompt.trim() === ''}
			onclick={async () => {
				aiv.isCreatingProject = true;
				try {
					const { createAiVideoProject } = await import('../projectCreator');
					await createAiVideoProject();
				} finally {
					aiv.isCreatingProject = false;
					aiv.generationStatus = '';
				}
			}}
		>
			{#if aiv.isCreatingProject}
				<span class="material-icons animate-spin text-lg">autorenew</span>
				{aiv.generationStatus || 'Creating project...'}
			{:else}
				<span class="material-icons text-lg">movie_creation</span>
				Create Project
			{/if}
		</button>
	</div>

	<p class="text-center text-xs text-thirdly">
		{aiv.video.sourceMode === 'youtube'
			? 'The YouTube video will be downloaded and used as the background during project creation.'
			: 'Video generation is currently mocked. A real AI-generated background will be added later.'}
	</p>
</div>
