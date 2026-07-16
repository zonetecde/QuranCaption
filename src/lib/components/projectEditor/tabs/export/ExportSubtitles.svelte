<script lang="ts">
	import Exporter from '$lib/classes/Exporter';
	import Settings from '$lib/classes/Settings.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import ExportFolderPicker from './ExportFolderPicker.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';

	const LL_ = get(LL);

	const arabicFormatDescriptions: Record<'Plain' | 'V1' | 'V2', () => string> = {
		Plain: () => LL_.export.simpleText(),
		V1: () => LL_.export.uthmani1405(),
		V2: () => LL_.export.uthmani1423()
	};

	const subtitleExportTargets = $derived([
		'arabic',
		...globalState.getProjectTranslation.addedTranslationEditions.map((e) => e.name)
	]);
	const hasIncludedTranslations = $derived(
		subtitleExportTargets.some(
			(target) =>
				target !== 'arabic' &&
				Boolean(globalState.settings?.subtitleExportSettings.includedTarget[target])
		)
	);

	onMount(() => {
		const settings = globalState.settings!.subtitleExportSettings;
		for (const target of Object.keys(settings.includedTarget)) {
			if (!subtitleExportTargets.includes(target)) {
				delete settings.includedTarget[target];
				delete settings.exportVerseNumbers[target];
			}
		}

		for (const target of subtitleExportTargets) {
			// Initialize settings for newly available subtitle targets.
			if (!(target in settings.exportVerseNumbers)) {
				settings.exportVerseNumbers[target] = target === 'arabic';
			}
			if (!(target in settings.includedTarget)) {
				settings.includedTarget[target] = true;
			}
		}
		void Settings.save();
	});
</script>

<!-- Export Subtitles Configuration -->
<div class="p-6 bg-secondary rounded-lg border border-color" transition:slide>
	<!-- Section Title -->
	<div class="mb-6">
		<h3 class="text-lg font-semibold text-primary mb-2">{$LL.export.exportSubtitlesHeading()}</h3>
		<p class="text-thirdly text-sm">
			{$LL.export.exportSubtitlesDescription()}
		</p>
	</div>

	<!-- Subtitle Format Selection -->
	<div class="mb-6">
		<h4 class="text-base font-medium text-secondary mb-3">{$LL.export.subtitleFormat()}</h4>
		<p class="text-thirdly text-sm mb-3">{$LL.export.subtitleFormatDescription()}</p>
		<div class="flex gap-4">
			<label class="flex items-center gap-2 cursor-pointer group">
				<input
					type="radio"
					name="subtitle-format"
					value="SRT"
					bind:group={globalState.settings!.subtitleExportSettings.subtitleFormat}
					onchange={() => void Settings.save()}
					class="w-4 h-4 text-accent-primary"
				/>
				<span class="text-secondary group-hover:text-primary transition-colors">
					SRT
					<span class="text-thirdly text-xs block">{$LL.export.srtFormat()}</span>
				</span>
			</label>
			<label class="flex items-center gap-2 cursor-pointer group">
				<input
					type="radio"
					name="subtitle-format"
					value="VTT"
					bind:group={globalState.settings!.subtitleExportSettings.subtitleFormat}
					onchange={() => void Settings.save()}
					class="w-4 h-4 text-accent-primary"
				/>
				<span class="text-secondary group-hover:text-primary transition-colors">
					VTT
					<span class="text-thirdly text-xs block">{$LL.export.vttFormat()}</span>
				</span>
			</label>
		</div>
	</div>

	<!-- Content Selection -->
	<div class="mb-6">
		<h4 class="text-base font-medium text-secondary mb-3">{$LL.export.contentSelection()}</h4>
		<p class="text-thirdly text-sm mb-4">
			{$LL.export.contentSelectionDescription()}
		</p>

		<div class="space-y-4">
			{#each subtitleExportTargets as target (target)}
				<div class="bg-accent rounded-lg p-4 border border-color">
					<!-- Main content checkbox -->
					<div class="flex items-start gap-3">
						<input
							type="checkbox"
							bind:checked={globalState.settings!.subtitleExportSettings.includedTarget[target]}
							onchange={() => void Settings.save()}
							class="w-4 h-4 mt-0.5 rounded"
							id="include-{target}"
						/>
						<div class="flex-1">
							<label for="include-{target}" class="cursor-pointer">
								<span class="text-secondary font-medium capitalize">
									{target === 'arabic'
										? $LL.export.arabicText()
										: $LL.export.translationAuthor({
												author: globalState.getProjectTranslation.getEditionFromName(target).author
											})}
								</span>
								<p class="text-thirdly text-xs mt-1">
									{target === 'arabic'
										? $LL.export.arabicTextDescription()
										: $LL.export.translationByAuthor({
												author:
													globalState.getProjectTranslation.getEditionFromName(target).quranEdition
														?.author ?? ''
											})}
								</p>
							</label>
						</div>
					</div>
				</div>
			{/each}
		</div>
	</div>

	<details class="mb-6 bg-accent rounded-lg border border-color p-4">
		<summary class="cursor-pointer text-base font-medium text-secondary">
			{$LL.export.advancedSettings()}
		</summary>
		<div class="mt-4 space-y-5">
			<div
				class={!globalState.settings!.subtitleExportSettings.includedTarget.arabic
					? 'opacity-50 pointer-events-none'
					: ''}
			>
				<span class="text-secondary text-sm font-medium">{$LL.export.arabicTextFormat()}</span>
				<p class="text-thirdly text-xs mt-1 mb-3">
					{$LL.export.arabicTextFormatDescription()}
				</p>
				<div class="flex gap-2">
					{#each ['Plain', 'V1', 'V2'] as format (format)}
						<label class="flex-1">
							<input
								type="radio"
								name="arabic-format"
								value={format}
								bind:group={globalState.settings!.subtitleExportSettings.arabicTextFormat}
								onchange={() => void Settings.save()}
								class="sr-only"
								disabled={!globalState.settings!.subtitleExportSettings.includedTarget.arabic}
							/>
							<div
								class="cursor-pointer rounded-lg border px-3 py-2 text-center flex flex-col items-center justify-center text-sm font-medium transition-all duration-200 h-full {globalState
									.settings!.subtitleExportSettings.arabicTextFormat === format
									? 'bg-accent-primary text-black border-accent-primary'
									: 'bg-secondary border-color text-secondary hover:border-accent-primary hover:text-primary'}"
							>
								{format === 'Plain' ? $LL.export.simpleText() : `QPC ${format[1]}`}
								<div
									class="text-xs mt-1 {globalState.settings!.subtitleExportSettings.arabicTextFormat === format
										? 'text-black/80'
										: 'text-thirdly'}"
								>
									{arabicFormatDescriptions[format as 'Plain' | 'V1' | 'V2']()}
								</div>
							</div>
						</label>
					{/each}
				</div>
			</div>

			<div
				class="flex items-start gap-3 {!globalState.settings!.subtitleExportSettings.includedTarget.arabic
					? 'opacity-50 pointer-events-none'
					: ''}"
			>
				<input
					type="checkbox"
					bind:checked={globalState.settings!.subtitleExportSettings.exportArabicAyahParentheses}
					onchange={() => void Settings.save()}
					class="w-4 h-4 mt-0.5 rounded"
					id="export-arabic-ayah-parentheses"
					disabled={!globalState.settings!.subtitleExportSettings.includedTarget.arabic}
				/>
				<label for="export-arabic-ayah-parentheses" class="cursor-pointer">
					<span class="text-secondary text-sm">{$LL.export.includeVerseNumbers()}</span>
				</label>
			</div>

			<div
				class="flex items-start gap-3 {!globalState.settings!.subtitleExportSettings.includedTarget.arabic
					? 'opacity-50 pointer-events-none'
					: ''}"
			>
				<input
					type="checkbox"
					bind:checked={globalState.settings!.subtitleExportSettings.exportVerseNumbers.arabic}
					onchange={() => void Settings.save()}
					class="w-4 h-4 mt-0.5 rounded"
					id="export-arabic-verse-numbers"
					disabled={!globalState.settings!.subtitleExportSettings.includedTarget.arabic}
				/>
				<label for="export-arabic-verse-numbers" class="cursor-pointer">
					<span class="text-secondary text-sm">{$LL.export.includeVerseNumbersAtEnd()}</span>
				</label>
			</div>

			<div
				class="flex items-start gap-3 {!hasIncludedTranslations
					? 'opacity-50 pointer-events-none'
					: ''}"
			>
				<input
					type="checkbox"
					bind:checked={globalState.settings!.subtitleExportSettings.exportTranslationVerseNumbers}
					onchange={() => void Settings.save()}
					class="w-4 h-4 mt-0.5 rounded"
					id="export-translation-verse-numbers"
					disabled={!hasIncludedTranslations}
				/>
				<label for="export-translation-verse-numbers" class="cursor-pointer">
					<span class="text-secondary text-sm">{$LL.export.includeVerseNumbersAtStart()}</span>
				</label>
			</div>
		</div>
	</details>

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
					bind:value={globalState.settings!.subtitleExportSettings.customFileName}
					onchange={() => void Settings.save()}
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

	<!-- Export Button -->
	<div class="flex flex-col items-center">
		<button class="btn-accent px-6 py-3 font-medium" onclick={Exporter.exportSubtitles}>
			{$LL.export.exportSubtitlesButton()}
		</button>
		<p class="text-thirdly text-xs mt-2 text-center">
			{$LL.export.exportSubtitlesButtonDescription()}
		</p>
	</div>
</div>
