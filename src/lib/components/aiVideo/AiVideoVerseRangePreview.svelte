<script lang="ts">
	import { Quran } from '$lib/classes/Quran';
	import type { Edition } from '$lib/classes';

	let {
		surah,
		ayahStart,
		ayahEnd,
		reciter,
		useLocalAudio,
		localAudioPath,
		selectedTranslation
	}: {
		surah: number;
		ayahStart: number;
		ayahEnd: number;
		reciter: string;
		useLocalAudio: boolean;
		localAudioPath: string;
		selectedTranslation: Edition | null;
	} = $props();

	let surahName = $derived(() => {
		const names = Quran.getSurahsNames();
		const found = names.find((s) => s.id === surah);
		return found ? found.transliteration : `Surah ${surah}`;
	});
</script>

<div class="rounded-xl border border-color bg-bg-secondary/50 p-4 space-y-3">
	<h4 class="flex items-center gap-2 text-xs font-semibold text-thirdly uppercase tracking-wide">
		<span class="material-icons text-accent-primary text-sm">preview</span>
		Generation Preview
	</h4>

	<div class="grid grid-cols-2 gap-3 text-sm">
		<div>
			<span class="text-thirdly text-xs">Surah</span>
			<p class="text-primary font-medium">{surahName()}</p>
		</div>
		<div>
			<span class="text-thirdly text-xs">Verses</span>
			<p class="text-primary font-medium">{ayahStart} - {ayahEnd}</p>
		</div>
		<div>
			<span class="text-thirdly text-xs">Audio Source</span>
			<p class="text-primary font-medium truncate">
				{#if useLocalAudio}
					{localAudioPath ? localAudioPath.split(/[/\\]/).pop() : 'No file selected'}
				{:else}
					{reciter || 'Not selected'}
				{/if}
			</p>
		</div>
		{#if selectedTranslation}
			<div>
				<span class="text-thirdly text-xs">Translation</span>
				<p class="text-primary font-medium truncate">{selectedTranslation.author}</p>
			</div>
		{/if}
	</div>
</div>
