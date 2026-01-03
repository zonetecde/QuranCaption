<script lang="ts">
	import { slide } from 'svelte/transition';
	import { Quran } from '$lib/classes/Quran';
	import {
		getAutoSegmentationAudioInfo,
		runAutoSegmentation,
		type AutoSegmentationResult
	} from '$lib/services/AutoSegmentation';

	let { close } = $props();

	let isRunning = $state(false);
	let result: AutoSegmentationResult | null = $state(null);
	let errorMessage = $state<string | null>(null);

	const audioInfo = $derived(() => getAutoSegmentationAudioInfo());
	const hasAudio = $derived(() => !!audioInfo());

	function formatVerseRange(resultData: AutoSegmentationResult | null): string {
		if (!resultData || resultData.status !== 'completed' || resultData.verseRange.parts.length === 0) {
			return 'No verse range detected.';
		}

		return resultData.verseRange.parts
			.map((part) => {
				const surahName =
					Quran.getSurahsNames()[part.surah - 1]?.transliteration || `Surah ${part.surah}`;
				const verseRange =
					part.verseStart === part.verseEnd
						? `${part.verseStart}`
						: `${part.verseStart}-${part.verseEnd}`;
				return `Surah ${surahName}: ${verseRange}`;
			})
			.join(', ');
	}

	async function startSegmentation() {
		if (isRunning || !hasAudio()) return;
		isRunning = true;
		errorMessage = null;
		result = null;

		try {
			const response = await runAutoSegmentation();
			if (!response) {
				errorMessage = 'Segmentation failed. Please check the console for details.';
			} else if (response.status === 'cancelled') {
				errorMessage = 'Segmentation canceled.';
			} else {
				result = response;
			}
		} finally {
			isRunning = false;
		}
	}
</script>

<div
	class="bg-secondary border-color border rounded-2xl w-[680px] max-w-[90vw] shadow-2xl shadow-black flex flex-col relative overflow-hidden"
	transition:slide
>
	<!-- Header -->
	<div class="bg-gradient-to-r from-accent to-bg-accent px-6 py-4 border-b border-color">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3">
				<div class="w-8 h-8 bg-accent-primary rounded-full flex items-center justify-center">
					<span class="material-icons text-black text-lg">graphic_eq</span>
				</div>
				<div>
					<h2 class="text-xl font-bold text-primary">Auto Segmentation</h2>
					<p class="text-sm text-thirdly">Send audio to the AI to auto-create subtitles</p>
				</div>
			</div>

			<button
				class="w-8 h-8 rounded-full hover:bg-[rgba(255,255,255,0.1)] flex items-center justify-center transition-all duration-200 text-secondary hover:text-primary cursor-pointer"
				onclick={close}
			>
				<span class="material-icons text-lg">close</span>
			</button>
		</div>
	</div>

	<!-- Body -->
	<div class="px-6 py-5 space-y-4">
		<div class="bg-primary border border-color rounded-xl p-4 space-y-2">
			<p class="text-sm text-secondary leading-relaxed">
				This will upload the first audio clip from the project timeline to the AI segmentation
				service. Segments with confidence below 0.75 will be colored yellow and should be
				manually reviewed.
			</p>
			<div class="flex items-start gap-2 text-xs text-thirdly">
				<span class="material-icons text-sm mt-0.5">info</span>
				<span>
					Audio source:
					{#if hasAudio()}
						<span class="text-primary font-medium">{audioInfo()?.fileName}</span>
					{:else}
						<span class="text-danger-color font-medium">No audio clip found</span>
					{/if}
				</span>
			</div>
		</div>

		{#if isRunning}
			<div class="flex items-center gap-3 bg-accent border border-color rounded-xl px-4 py-3">
				<div
					class="w-6 h-6 border-2 border-accent-primary border-t-transparent rounded-full animate-spin"
				></div>
				<div class="text-sm text-secondary">Segmenting audio... please wait.</div>
			</div>
		{:else if result && result.status === 'completed'}
			<div class="bg-accent border border-color rounded-xl px-4 py-3 space-y-2">
				<div class="flex items-center gap-2 text-sm text-primary font-semibold">
					<span class="material-icons text-accent-primary">check_circle</span>
					Segmentation complete
				</div>
				<div class="text-sm text-secondary">
					Segments found: <span class="text-primary font-semibold">{result.segmentsApplied}</span>
				</div>
				<div class="text-sm text-secondary">
					Verse range:
					<span class="text-primary font-semibold">{formatVerseRange(result)}</span>
				</div>
				<div class="text-sm text-secondary">
					Low-confidence segments:
					<span class="text-primary font-semibold">{result.lowConfidenceSegments}</span>
				</div>
			</div>
		{:else if errorMessage}
			<div class="bg-danger-color/10 border border-danger-color rounded-xl px-4 py-3 text-sm">
				{errorMessage}
			</div>
		{/if}
	</div>

	<!-- Footer -->
	<div class="border-t border-color bg-primary px-6 py-4">
		<div class="flex items-center justify-between">
			<div class="text-xs text-thirdly">
				{#if result && result.status === 'completed'}
					Segmentation is complete. You can close this modal.
				{:else}
					Ready to start auto-segmentation.
				{/if}
			</div>
			<div class="flex gap-3">
				{#if result && result.status === 'completed'}
					<button class="btn-accent px-5 py-2 text-sm" onclick={close}>Finish</button>
				{:else}
					<button class="btn px-5 py-2 text-sm" onclick={close}>Close</button>
					<button
						class="btn-accent px-5 py-2 text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
						onclick={startSegmentation}
						disabled={isRunning || !hasAudio()}
					>
						<span class="material-icons text-base">auto_awesome</span>
						Start segmentation
					</button>
				{/if}
			</div>
		</div>
	</div>
</div>
