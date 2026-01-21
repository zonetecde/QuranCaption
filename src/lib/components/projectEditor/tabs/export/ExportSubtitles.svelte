<script lang="ts">
	import Exporter from '$lib/classes/Exporter';
	import { globalState } from '$lib/runes/main.svelte';
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import ExportFolderPicker from './ExportFolderPicker.svelte';

	onMount(() => {
		for (const target of [
			'arabic',
			...globalState.getProjectTranslation.addedTranslationEditions.map((e) => e.name)
		]) {
			// Si le target n'existe toujours pas dans globalState.getExportState.exportVerseNumbers, l'ajoute
			if (!globalState.getExportState.exportVerseNumbers[target]) {
				globalState.getExportState.exportVerseNumbers[target] = target === 'arabic' ? true : false; // Par défaut seul l'arabe a ses numéros de verset
			}
			if (!globalState.getExportState.includedTarget[target]) {
				globalState.getExportState.includedTarget[target] = true; // Par défaut on exporte tout
			}
		}
	});
</script>

<!-- Export Subtitles Configuration -->
<div class="p-6 bg-secondary rounded-lg border border-color" transition:slide>
	<!-- Section Title -->
	<div class="mb-6">
		<h3 class="text-lg font-semibold text-primary mb-2">Export Subtitles</h3>
		<p class="text-thirdly text-sm">
			Configure your subtitle export settings and choose which content to include.
		</p>
	</div>

	<!-- Subtitle Format Selection -->
	<div class="mb-6">
		<h4 class="text-base font-medium text-secondary mb-3">Subtitle Format</h4>
		<p class="text-thirdly text-sm mb-3">Choose the subtitle file format for your export:</p>
		<div class="flex gap-4">
			<label class="flex items-center gap-2 cursor-pointer group">
				<input
					type="radio"
					name="subtitle-format"
					value="SRT"
					bind:group={globalState.getExportState.subtitleFormat}
					class="w-4 h-4 text-accent-primary"
				/>
				<span class="text-secondary group-hover:text-primary transition-colors">
					SRT
					<span class="text-thirdly text-xs block">SubRip Text format - widely compatible</span>
				</span>
			</label>
			<label class="flex items-center gap-2 cursor-pointer group">
				<input
					type="radio"
					name="subtitle-format"
					value="VTT"
					bind:group={globalState.getExportState.subtitleFormat}
					class="w-4 h-4 text-accent-primary"
				/>
				<span class="text-secondary group-hover:text-primary transition-colors">
					VTT
					<span class="text-thirdly text-xs block"
						>WebVTT format - web standard with styling support</span
					>
				</span>
			</label>
		</div>
	</div>

	<!-- Content Selection -->
	<div class="mb-6">
		<h4 class="text-base font-medium text-secondary mb-3">Content Selection</h4>
		<p class="text-thirdly text-sm mb-4">
			Select which text versions to include in your subtitle export:
		</p>

		<div class="space-y-4">
			{#each Object.entries(globalState.getExportState.includedTarget) as [target, included]}
				<div class="bg-accent rounded-lg p-4 border border-color">
					<!-- Main content checkbox -->
					<div class="flex items-start gap-3 mb-3">
						<input
							type="checkbox"
							bind:checked={globalState.getExportState.includedTarget[target]}
							class="w-4 h-4 mt-0.5 rounded"
							id="include-{target}"
						/>
						<div class="flex-1">
							<label for="include-{target}" class="cursor-pointer">
								<span class="text-secondary font-medium capitalize">
									{target === 'arabic'
										? 'Arabic Text'
										: `${globalState.getProjectTranslation.getEditionFromName(target).author} Translation`}
								</span>
								<p class="text-thirdly text-xs mt-1">
									{target === 'arabic'
										? 'Original Quranic text in Arabic script'
										: `Translation by ${globalState.getProjectTranslation.getEditionFromName(target).author}`}
								</p>
							</label>
						</div>
					</div>

					<!-- Verse numbers option -->
					<div class="ml-7 {!included ? 'opacity-50 pointer-events-none' : ''}">
						<div class="flex items-start gap-3">
							<input
								type="checkbox"
								bind:checked={globalState.getExportState.exportVerseNumbers[target]}
								class="w-4 h-4 mt-0.5 rounded"
								id="verse-numbers-{target}"
								disabled={!included}
								onchange={(e: any) => {
									// Set le style 'show-verse-number' car les méthodes getText() se base dessus
									// pour afficher les numéros de verset
									globalState.getVideoStyle
										.getStylesOfTarget(target)
										.setStyle('show-verse-number', e.target.checked);
								}}
							/>
							<div class="flex-1">
								<label for="verse-numbers-{target}" class="cursor-pointer">
									<span class="text-secondary text-sm">Include verse numbers</span>
									<p class="text-thirdly text-xs mt-1">
										{#if target === 'arabic'}
											Add verse numbers (e.g., <span class="arabic">٥٢</span>) at the end of each
											verse
										{:else}
											Add verse numbers (e.g., "255.") at the beginning of each verse
										{/if}
									</p>
								</label>
							</div>
						</div>
					</div>

					<!-- Arabic text format option (only for Arabic) -->
					{#if target === 'arabic'}
						<div class="mt-4 {!included ? 'opacity-50 pointer-events-none' : ''}">
							<div class="space-y-2">
								<span class="text-secondary text-sm font-medium">Arabic Text Format</span>
								<p class="text-thirdly text-xs mb-3">
									Choose the formatting style for Arabic text display:
								</p>
								<div class="flex gap-2">
									{#each ['Plain', 'V1', 'V2'] as format}
										{@const descriptions: any = {
											Plain: 'Simple text',
											'V1': '1405H Mushaf by Uthman Taha',
											'V2': '1423H Mushaf by Uthman Taha'
										}}
										<label class="flex-1">
											<input
												type="radio"
												name="arabic-format"
												value={format}
												bind:group={globalState.getExportState.arabicTextFormat}
												class="sr-only"
												disabled={!included}
												onchange={(e: any) => {
													// Modifie la police d'écriture dans la vidéo (car c'est elle
													// qui détermine le texte sous-titre pour les polices QPC)
													const fontFamily = globalState.getStyle('arabic', 'font-family')!.value;

													if (
														e.target.value === 'Plain' &&
														(fontFamily === 'QPC1' || fontFamily === 'QPC2')
													) {
														globalState.getVideoStyle
															.getStylesOfTarget('arabic')
															.setStyle('font-family', 'Hafs');
													} else if (e.target.value === 'V1' || e.target.value === 'V2') {
														globalState.getVideoStyle
															.getStylesOfTarget('arabic')
															.setStyle('font-family', 'QPC' + e.target.value[1]);
													}

													globalState.updateVideoPreviewUI();
												}}
											/>
											<div
												class="cursor-pointer rounded-lg border px-3 py-2 text-center flex flex-col items-center justify-center text-sm font-medium transition-all duration-200 h-full {globalState
													.getExportState.arabicTextFormat === format
													? 'bg-accent-primary text-black border-accent-primary'
													: 'bg-accent border-color text-secondary hover:border-accent-primary hover:text-primary'}"
											>
												{format === 'Plain' ? 'Plain' : `QPC ${format}`}
												<div
													class="text-xs mt-1 {globalState.getExportState.arabicTextFormat ===
													format
														? 'text-black/80'
														: 'text-thirdly'}"
												>
													{descriptions[format]}
												</div>
											</div>
										</label>
									{/each}
								</div>
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</div>

	<!-- Export Folder -->
	<div class="mb-6">
		<h4 class="text-base font-medium text-secondary mb-3">Export Folder</h4>
		<div class="bg-accent rounded-lg p-4 border border-color">
			<ExportFolderPicker />
		</div>
	</div>

	<!-- Export Button -->
	<div class="flex flex-col items-center">
		<button class="btn-accent px-6 py-3 font-medium" onclick={Exporter.exportSubtitles}>
			Export Subtitles
		</button>
		<p class="text-thirdly text-xs mt-2 text-center">
			Generate subtitle files with your selected configuration
		</p>
	</div>
</div>
