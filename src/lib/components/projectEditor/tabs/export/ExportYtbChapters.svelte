<script lang="ts">
	import Exporter, { type YouTubeChaptersChoice } from '$lib/classes/Exporter';
	import { SubtitleClip } from '$lib/classes/Clip.svelte';
	import Settings from '$lib/classes/Settings.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import ExportFolderPicker from './ExportFolderPicker.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';
	import toast from 'svelte-5-french-toast';

	const LL_ = get(LL);

	type PersistedYouTubeChapterExportSettings = {
		ytbChaptersFormat?: string;
	};

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

	/**
	 * Retourne les paramètres persistants propres à l'export des chapitres YouTube.
	 * @returns {PersistedYouTubeChapterExportSettings} Paramètres stockés dans settings.json.
	 */
	function getPersistedYouTubeChapterExportSettings(): PersistedYouTubeChapterExportSettings {
		return globalState.settings!.exportSettings as unknown as PersistedYouTubeChapterExportSettings;
	}

	/**
	 * Enregistre le format des chapitres YouTube pour le réutiliser dans tous les projets.
	 * @returns {void}
	 */
	function saveChapterFormat(): void {
		getPersistedYouTubeChapterExportSettings().ytbChaptersFormat =
			globalState.getExportState.ytbChaptersFormat;
		void Settings.save();
	}

	/**
	 * Sélectionne le regroupement des chapitres et suggère un format adapté aux divisions coraniques.
	 * @param {Event} event Événement déclenché par le bouton radio.
	 * @returns {void}
	 */
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
		const persistedSettings = getPersistedYouTubeChapterExportSettings();
		if (typeof persistedSettings.ytbChaptersFormat === 'string') {
			const persistedFormat = persistedSettings.ytbChaptersFormat;
			if (globalState.getExportState.ytbChaptersFormat !== persistedFormat) {
				ProjectHistoryManager.track('restore YouTube chapter format', () => {
					globalState.getExportState.ytbChaptersFormat = persistedFormat;
				});
			}
		} else {
			persistedSettings.ytbChaptersFormat = globalState.getExportState.ytbChaptersFormat;
			void Settings.save();
		}

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
<div
	class="flex h-full min-h-0 flex-col rounded-lg border border-color bg-secondary p-6 pb-2"
	transition:slide
>
	<div class="min-h-0 flex-1 overflow-y-auto -mx-6 px-6">
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
					class="flex items-center gap-3 cursor-pointer group bg-accent rounded-lg p-4 border border-color hover:border-accent-primary transition-colors"
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
						class="flex items-center gap-3 cursor-pointer group bg-accent rounded-lg p-4 border border-color hover:border-accent-primary transition-colors"
					>
						<input
							type="radio"
							name="ytb-chapters"
							value={option.value}
							checked={globalState.getExportState.ytbChaptersChoice === option.value}
							onchange={selectChapterChoice}
							class="w-4 h-4 text-accent-primary"
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
		<div class="mb-6">
			<h4 class="text-base font-medium text-secondary mb-3">Chapter Format</h4>
			<div class="space-y-4">
				<div>
					<label for="ytb-chapters-format" class="text-secondary text-sm font-medium">
						Text format
					</label>
					<textarea
						id="ytb-chapters-format"
						class="mt-2 min-h-24 w-full rounded-lg border border-color bg-accent p-3 text-sm text-primary outline-none focus:border-accent-primary"
						bind:value={globalState.getExportState.ytbChaptersFormat}
						onchange={saveChapterFormat}
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
						class="mt-2 w-full rounded-lg border border-color bg-accent p-3 text-sm text-primary outline-none focus:border-accent-primary"
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
		<div class="mb-6">
			<h4 class="text-base font-medium text-secondary mb-3">{$LL.export.howToUse()}</h4>
			<div class="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
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
		<div class="mb-6">
			<h4 class="text-base font-medium text-secondary mb-3">{$LL.export.exportFileName()}</h4>
			<div class="bg-accent rounded-lg p-4 border border-color">
				<p class="text-thirdly text-sm mb-4">
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
		<div class="mb-6">
			<h4 class="text-base font-medium text-secondary mb-3">{$LL.export.exportFolder()}</h4>
			<div class="bg-accent rounded-lg p-4 border border-color">
				<ExportFolderPicker />
			</div>
		</div>
	</div>

	<!-- Export Button -->
	<div class="flex flex-shrink-0 flex-col items-center border-t border-color pt-2">
		<button class="btn-accent px-6 py-3 font-medium" onclick={Exporter.exportYtbChapters}>
			{$LL.export.exportYoutubeChaptersButton()}
		</button>
		<p class="text-thirdly text-xs mt-2 text-center">
			{$LL.export.exportYoutubeChaptersButtonDescription()}
		</p>
	</div>
</div>
