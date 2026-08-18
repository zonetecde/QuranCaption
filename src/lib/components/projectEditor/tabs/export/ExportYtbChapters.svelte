<script lang="ts">
	import Exporter, { type YouTubeChaptersChoice } from '$lib/classes/Exporter';
	import { SubtitleClip } from '$lib/classes/Clip.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import ExportFolderPicker from './ExportFolderPicker.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
	import toast from 'svelte-5-french-toast';

	const chapterPlaceholders = [
		'<timestamp>',
		'<surah-number>',
		'<surah-translation>',
		'<surah-transliteration>',
		'<verse-arabic>',
		'<verse-number>',
		'<verse-translation>',
		'<hizb-number>',
		'<juz-number>',
		'<rub-number>'
	];

	/** Sélectionne le regroupement des chapitres et suggère un format adapté. */
	function selectChapterChoice(event: Event): void {
		const choice = (event.target as HTMLInputElement).value as YouTubeChaptersChoice;
		globalState.getExportState.ytbChaptersChoice = choice;
		const suggestion =
			choice === 'Each Hizb'
				? get(LL).export.chapterFormatHizb()
				: choice === 'Each Juz'
					? get(LL).export.chapterFormatJuz()
					: choice === 'Each Rub'
						? get(LL).export.chapterFormatRub()
						: null;
		if (suggestion) {
			toast(get(LL).export.chapterFormatSuggestion({ format: suggestion }), {
				position: 'bottom-left'
			});
		}
	}

	onMount(() => {
		const uniqueSurahs = new Set<number>();

		for (const clip of globalState.getSubtitleClips) {
			if (clip instanceof SubtitleClip) {
				uniqueSurahs.add(clip.surah);
				if (uniqueSurahs.size > 3) {
					break;
				}
			}
		}

		if (
			uniqueSurahs.size >= 1 &&
			uniqueSurahs.size <= 3 &&
			globalState.getExportState.ytbChaptersChoice === 'Each Surah'
		) {
			globalState.getExportState.ytbChaptersChoice = 'Each Verse';
		}
	});
</script>

<!-- Export YouTube Chapters Configuration -->

<div class="flex h-full min-h-0 min-w-0 flex-col rounded-lg bg-secondary p-3 pb-0" transition:slide>
	<div class="min-h-0 flex-1 overflow-y-auto">
		<!-- Section Title -->
		<div class="mb-4">
			<h3 class="mb-1 text-base font-semibold text-primary">
				{$LL.export.exportYoutubeChapters()}
			</h3>
			<p class="text-xs leading-snug text-thirdly">
				{$LL.export.exportYoutubeChaptersDescription()}
			</p>
		</div>

		<!-- Chapter Generation Options -->
		<div class="mb-4">
			<h4 class="mb-2 text-sm font-medium text-secondary">{$LL.export.chapterGeneration()}</h4>
			<p class="mb-3 text-xs leading-snug text-thirdly">
				{$LL.export.chapterGenerationDescription()}
			</p>

			<div class="space-y-2">
				<label
					class="group flex cursor-pointer items-start gap-3 rounded-lg border border-color bg-accent p-3 transition-colors hover:border-accent-primary"
				>
					<input
						type="radio"
						name="ytb-chapters"
						value="Each Surah"
						checked={globalState.getExportState.ytbChaptersChoice === 'Each Surah'}
						onchange={selectChapterChoice}
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
					class="group flex cursor-pointer items-start gap-3 rounded-lg border border-color bg-accent p-3 transition-colors hover:border-accent-primary"
				>
					<input
						type="radio"
						name="ytb-chapters"
						value="Each Verse"
						checked={globalState.getExportState.ytbChaptersChoice === 'Each Verse'}
						onchange={selectChapterChoice}
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

				{#each [{ value: 'Each Hizb', title: $LL.export.chapterPerHizb(), description: $LL.export.chapterPerHizbDescription() }, { value: 'Each Juz', title: $LL.export.chapterPerJuz(), description: $LL.export.chapterPerJuzDescription() }, { value: 'Each Rub', title: $LL.export.chapterPerRub(), description: $LL.export.chapterPerRubDescription() }] as option (option.value)}
					<label
						class="group flex cursor-pointer items-start gap-3 rounded-lg border border-color bg-accent p-3 transition-colors hover:border-accent-primary"
					>
						<input
							type="radio"
							name="ytb-chapters"
							value={option.value}
							checked={globalState.getExportState.ytbChaptersChoice === option.value}
							onchange={selectChapterChoice}
							class="h-4 w-4 text-accent-primary"
						/>
						<div class="flex-1">
							<span class="text-secondary font-medium group-hover:text-primary transition-colors">
								{option.title}
							</span>
							<p class="text-thirdly text-xs mt-1">{option.description}</p>
						</div>
					</label>
				{/each}
			</div>
		</div>

		<!-- Custom Format -->
		<div class="mb-4">
			<h4 class="mb-2 text-sm font-medium text-secondary">Chapter Format</h4>
			<div class="space-y-3">
				<div>
					<label for="ytb-chapters-format" class="text-secondary text-sm font-medium">
						Text format
					</label>
					<textarea
						id="ytb-chapters-format"
						class="mt-2 min-h-20 w-full rounded-lg border border-color bg-accent p-3 text-sm text-primary outline-none focus:border-accent-primary"
						bind:value={globalState.getExportState.ytbChaptersFormat}
					></textarea>
					<p class="mt-2 text-xs text-thirdly">
						Placeholders: {chapterPlaceholders.join(', ')}
					</p>
				</div>

				<div>
					<label for="ytb-chapters-translation" class="text-secondary text-sm font-medium">
						Translation for &lt;verse-translation&gt;
					</label>
					<select
						id="ytb-chapters-translation"
						class="mt-2 h-10 min-w-0 w-full rounded-lg border border-color bg-accent px-2 text-sm text-primary outline-none focus:border-accent-primary"
						bind:value={globalState.getExportState.ytbChaptersTranslationEditionName}
					>
						<option value="">No translation</option>
						{#each globalState.getProjectTranslation.addedTranslationEditions as edition (edition.name)}
							<option value={edition.name}>{edition.author}</option>
						{/each}
					</select>
				</div>
			</div>
		</div>

		<!-- Usage Instructions -->
		<div class="mb-4">
			<h4 class="mb-2 text-sm font-medium text-secondary">{$LL.export.howToUse()}</h4>
			<div class="rounded-lg border border-blue-500/20 bg-blue-500/10 p-3">
				<div class="flex items-start gap-3">
					<div class="text-blue-400 text-lg flex-shrink-0">ℹ️</div>
					<div>
						<span class="text-[var(--text-primary)] text-sm font-medium"
							>{$LL.export.youtubeIntegration()}</span
						>
						<p class="text-secondary text-xs mt-1">
							{$LL.export.youtubeIntegrationDescription()}
						</p>
					</div>
				</div>
			</div>
		</div>

		<!-- Export Filename -->
		<div class="mb-4">
			<h4 class="mb-2 text-sm font-medium text-secondary">{$LL.export.exportFileName()}</h4>
			<div class="rounded-lg border border-color bg-accent p-3">
				<p class="mb-3 text-xs leading-snug text-thirdly">
					{$LL.export.enterExportFileName()}
				</p>

				<div class="flex flex-col gap-2">
					<input
						type="text"
						class="input w-full"
						placeholder={globalState.currentProject?.detail.generateExportFileName()}
						bind:value={globalState.getExportState.customFileName}
					/>
					<p class="text-thirdly text-xs italic">
						{$LL.export.fileExtensionAddedAutomatically()}
					</p>
				</div>
			</div>
		</div>

		<!-- Export Folder -->
		<div class="mb-4">
			<h4 class="mb-2 text-sm font-medium text-secondary">{$LL.export.exportFolder()}</h4>
			<div class="rounded-lg border border-color bg-accent p-3">
				<ExportFolderPicker />
			</div>
		</div>
	</div>

	<!-- Export Button -->
	<div class="flex flex-shrink-0 flex-col items-center border-t border-color pt-1">
		<button class="btn-accent h-10 w-full px-4 font-medium" onclick={Exporter.exportYtbChapters}>
			{$LL.export.exportYoutubeChaptersButton()}
		</button>
	</div>
</div>
