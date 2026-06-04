<script lang="ts">
	import Exporter from '$lib/classes/Exporter';
	import { SubtitleClip } from '$lib/classes/Clip.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import ExportFolderPicker from './ExportFolderPicker.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';

	const LL_ = get(LL);

	onMount(() => {
		const uniqueSurahs = new Set<number>();

		for (const clip of globalState.getSubtitleClips) {
			if (clip instanceof SubtitleClip) {
				uniqueSurahs.add(clip.surah);
				if (uniqueSurahs.size > 1) {
					break;
				}
			}
		}

		if (uniqueSurahs.size === 1 && globalState.getExportState.ytbChaptersChoice === 'Each Surah') {
			globalState.getExportState.ytbChaptersChoice = 'Each Verse';
		}
	});
</script>

<!-- Export YouTube Chapters Configuration -->
<div class="p-6 bg-secondary rounded-lg border border-color" transition:slide>
	<!-- Section Title -->
	<div class="mb-6">
		<h3 class="text-lg font-semibold text-primary mb-2">{$LL.export.exportYoutubeChapters()}</h3>
		<p class="text-thirdly text-sm">
			{$LL.export.exportYoutubeChaptersDescription()}
		</p>
	</div>

	<!-- Chapter Generation Options -->
	<div class="mb-6">
		<h4 class="text-base font-medium text-secondary mb-3">{$LL.export.chapterGeneration()}</h4>
		<p class="text-thirdly text-sm mb-4">{$LL.export.chapterGenerationDescription()}</p>

		<div class="space-y-4">
			<label
				class="flex items-center gap-3 cursor-pointer group bg-accent rounded-lg p-4 border border-color hover:border-accent-primary transition-colors"
			>
				<input
					type="radio"
					name="ytb-chapters"
					value="Each Surah"
					checked={globalState.getExportState.ytbChaptersChoice === 'Each Surah'}
					onchange={(event: Event) => {
						const input = event.target as HTMLInputElement;
						globalState.getExportState.ytbChaptersChoice =
							input.value === 'Each Surah' ? 'Each Surah' : 'Each Verse';
					}}
					class="w-4 h-4 text-accent-primary"
				/>
				<div class="flex-1">
					<span class="text-secondary font-medium group-hover:text-primary transition-colors">
						{$LL.export.chapterPerSurah()}
					</span>
					<p class="text-thirdly text-xs mt-1">
						{$LL.export.chapterPerSurahDescription()}
					</p>
				</div>
			</label>

			<label
				class="flex items-center gap-3 cursor-pointer group bg-accent rounded-lg p-4 border border-color hover:border-accent-primary transition-colors"
			>
				<input
					type="radio"
					name="ytb-chapters"
					value="Each Verse"
					checked={globalState.getExportState.ytbChaptersChoice === 'Each Verse'}
					onchange={(event: Event) => {
						const input = event.target as HTMLInputElement;
						globalState.getExportState.ytbChaptersChoice =
							input.value === 'Each Verse' ? 'Each Verse' : 'Each Surah';
					}}
					class="w-4 h-4 text-accent-primary"
				/>
				<div class="flex-1">
					<span class="text-secondary font-medium group-hover:text-primary transition-colors">
						{$LL.export.chapterPerVerse()}
					</span>
					<p class="text-thirdly text-xs mt-1">
						{$LL.export.chapterPerVerseDescription()}
					</p>
				</div>
			</label>
		</div>
	</div>

	<!-- Usage Instructions -->
	<div class="mb-6">
		<h4 class="text-base font-medium text-secondary mb-3">{$LL.export.howToUse()}</h4>
		<div class="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
			<div class="flex items-start gap-3">
				<div class="text-blue-400 text-lg flex-shrink-0">ℹ️</div>
				<div>
					<span class="text-blue-200 text-sm font-medium">{$LL.export.youtubeIntegration()}</span>
					<p class="text-blue-100/80 text-xs mt-1">
						{$LL.export.youtubeIntegrationDescription()}
					</p>
				</div>
			</div>
		</div>
	</div>

	<!-- Export Folder -->
	<div class="mb-6">
		<h4 class="text-base font-medium text-secondary mb-3">{$LL.export.exportFolder()}</h4>
		<div class="bg-accent rounded-lg p-4 border border-color">
			<ExportFolderPicker />
		</div>
	</div>

	<!-- Export Button -->
	<div class="flex flex-col items-center">
		<button class="btn-accent px-6 py-3 font-medium" onclick={Exporter.exportYtbChapters}>
			{$LL.export.exportYoutubeChaptersButton()}
		</button>
		<p class="text-thirdly text-xs mt-2 text-center">
			{$LL.export.exportYoutubeChaptersButtonDescription()}
		</p>
	</div>
</div>
