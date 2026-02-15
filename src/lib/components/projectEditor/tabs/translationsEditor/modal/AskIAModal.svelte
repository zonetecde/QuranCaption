<script lang="ts">
	import type { Edition, SubtitleClip } from '$lib/classes';
	import type { VerseTranslation } from '$lib/classes/Translation.svelte';
	import Settings from '$lib/classes/Settings.svelte';
	import ClickableLink from '$lib/components/home/ClickableLink.svelte';
	import ModalManager from '$lib/components/modals/ModalManager';
	import { AnalyticsService } from '$lib/services/AnalyticsService';
	import { globalState } from '$lib/runes/main.svelte';
	import { onMount } from 'svelte';
	import toast from 'svelte-5-french-toast';
	import { slide } from 'svelte/transition';
	let {
		close,
		edition
	}: {
		close: () => void;
		edition: Edition;
	} = $props();
	let aiPrompt: string = $state('');
	let aiResponse: string = $state('');

	// Variables pour le slider de sélection de plage
	let totalVerses: number = $state(0);
	let startIndex: number = $state(0);
	let endIndex: number = $state(0);
	let fullVerseArray: any[] = $state([]);

	function persistAiTranslationSettings(): void {
		if (!globalState.settings) return;
		void Settings.save();
		void updatePromptWithRange();
	}

	// Fonction pour traiter la réponse de l'IA et mettre à jour les traductions
	function setTranslationsFromAIResponse(aiResponseStr: string): void {
		try {
			aiResponseStr = aiResponseStr.replace('```json', '');
			aiResponseStr = aiResponseStr.replace('```', '');

			const aiResponse = JSON.parse(aiResponseStr);

			// Parser la traduction compacte "index:word index:word..."
			const parseCompactTranslation = (translationStr: string) => {
				return translationStr.split(' ').map((item) => {
					const colonIndex = item.indexOf(':');
					const index = parseInt(item.substring(0, colonIndex));
					const word = item.substring(colonIndex + 1);
					return { i: index, w: word };
				});
			};

			// Error tracking
			const errorMessages: string[] = [];
			let processedVerses = 0;
			let successfulVerses = 0;

			// Utilise le tableau filtré pour le mapping
			const filteredArray = fullVerseArray.slice(startIndex, endIndex + 1);
			const indexToSubtitleMapping: {
				[key: number]: { subtitles: any[]; verseKey: string; translation: any[] };
			} = {};

			// Reconstruit le mapping pour les versets sélectionnés
			let verses: { [key: string]: SubtitleClip[] } = {};

			// Collecte les sous-titres par verset
			for (let i: number = 0; i < globalState.getSubtitleClips.length; i++) {
				const subtitle = globalState.getSubtitleClips[i];
				const verseKey = subtitle.getVerseKey();

				if (subtitle.isFullVerse) continue; // If complete verse, translation is done by default

				if (verses[verseKey] === undefined) {
					verses[verseKey] = [];
				}

				verses[verseKey].push(subtitle);
			}

			// Filtre seulement les versets qui sont dans la plage sélectionnée
			for (let i = 0; i < filteredArray.length; i++) {
				const verseData = filteredArray[i];
				const verseKey = verseData.verseKey;

				// Convertir le format compact en objets
				const translationWords = parseCompactTranslation(verseData.translation);

				if (verses[verseKey]) {
					indexToSubtitleMapping[verseData.index] = {
						subtitles: verses[verseKey],
						verseKey: verseKey,
						translation: translationWords
					};
				}
			}

			// Traite chaque réponse de l'IA
			for (const indexStr in aiResponse) {
				const indexNum = parseInt(indexStr);
				const segmentRanges = aiResponse[indexStr];

				if (!indexToSubtitleMapping[indexNum]) {
					errorMessages.push(`Index ${indexNum}: No corresponding verse found in project`);
					continue;
				}

				if (!Array.isArray(segmentRanges)) {
					errorMessages.push(
						`Index ${indexNum} (${indexToSubtitleMapping[indexNum].verseKey}): Invalid response format - expected array`
					);
					continue;
				}

				const mappingData = indexToSubtitleMapping[indexNum];
				const subtitlesForVerse = mappingData.subtitles;
				const translationWords = mappingData.translation;
				const verseKey = mappingData.verseKey;

				processedVerses++;

				// Check if number of segments matches number of subtitles
				if (segmentRanges.length !== subtitlesForVerse.length) {
					errorMessages.push(
						`Verse ${verseKey}: Mismatch between AI segments (${segmentRanges.length}) and actual subtitles (${subtitlesForVerse.length})`
					);
					continue;
				}

				let verseHasError = false;

				// Vérification de la couverture complète des indices
				const coveredIndices = new Set<number>();
				const totalWords = translationWords.length;

				// Collecte tous les indices couverts par les segments valides
				for (const range of segmentRanges) {
					if (range !== null && Array.isArray(range) && range.length === 2) {
						const [start, end] = range;
						if (start >= 0 && end >= 0 && start <= end && end < totalWords) {
							for (let i = start; i <= end; i++) {
								coveredIndices.add(i);
							}
						}
					}
				}

				// Vérifie si tous les indices de 0 à totalWords-1 sont couverts
				const incompleteCoverage = coveredIndices.size !== totalWords;
				if (incompleteCoverage) {
					const missingIndices = [];
					for (let i = 0; i < totalWords; i++) {
						if (!coveredIndices.has(i)) {
							missingIndices.push(i);
						}
					}
					errorMessages.push(
						`Verse ${verseKey}: Incomplete word coverage - missing indices ${missingIndices.join(', ')} (covered ${coveredIndices.size}/${totalWords} words)`
					);
					verseHasError = true;
				}

				// Applique chaque range à son sous-titre correspondant
				for (let segmentIndex = 0; segmentIndex < segmentRanges.length; segmentIndex++) {
					const range = segmentRanges[segmentIndex];
					const subtitle = subtitlesForVerse[segmentIndex];
					const verseTranslation: VerseTranslation = subtitle.translations[edition.name];

					if (range === null) {
						errorMessages.push(
							`Verse ${verseKey}, segment ${segmentIndex + 1}: AI returned null (unmappable segment)`
						);
						verseTranslation.updateStatus('ai error', edition);
						verseHasError = true;
						continue;
					}

					if (!Array.isArray(range) || range.length !== 2) {
						errorMessages.push(
							`Verse ${verseKey}, segment ${segmentIndex + 1}: Invalid range format - expected [start, end]`
						);
						verseTranslation.updateStatus('ai error', edition);
						verseHasError = true;
						continue;
					}

					const [startIndex, endIndex] = range;

					// Validate indices
					if (startIndex < 0 || endIndex < 0) {
						errorMessages.push(
							`Verse ${verseKey}, segment ${segmentIndex + 1}: Negative indices not allowed (${startIndex}, ${endIndex})`
						);
						verseTranslation.updateStatus('ai error', edition);
						verseHasError = true;
						continue;
					}

					if (startIndex > endIndex) {
						errorMessages.push(
							`Verse ${verseKey}, segment ${segmentIndex + 1}: Start index (${startIndex}) cannot be greater than end index (${endIndex})`
						);
						verseTranslation.updateStatus('ai error', edition);
						verseHasError = true;
						continue;
					}

					if (startIndex >= translationWords.length || endIndex >= translationWords.length) {
						errorMessages.push(
							`Verse ${verseKey}, segment ${segmentIndex + 1}: Indices out of range (${startIndex}-${endIndex}), translation has only ${translationWords.length} words`
						);

						verseTranslation.updateStatus('ai error', edition);
						verseHasError = true;
						continue;
					}

					// Extrait le texte de traduction correspondant aux indices
					const translationText = translationWords
						.slice(startIndex, endIndex + 1)
						.map((word) => word.w)
						.join(' ');

					// Met à jour la traduction du sous-titre
					verseTranslation.text = translationText;
					verseTranslation.startWordIndex = startIndex;
					verseTranslation.endWordIndex = endIndex;

					// Met le statut approprié : 'ai error' si couverture incomplète, sinon 'ai trimmed'
					if (incompleteCoverage) {
						verseTranslation.updateStatus('ai error', edition);
					} else {
						verseTranslation.updateStatus('ai trimmed', edition);
					}
				}

				// Même en cas d'erreur de couverture, on considère le verset comme traité avec succès
				// car les sous-titres ont été appliqués (même s'ils sont marqués 'ai error')
				if (!verseHasError || incompleteCoverage) {
					successfulVerses++;
				}
			}

			// Display processing summary
			let summaryMessage = `Processing complete: ${successfulVerses}/${processedVerses} verses successfully processed`;

			if (errorMessages.length > 0) {
				summaryMessage += `\n\nErrors encountered:\n${errorMessages.join('\n')}`;
				console.warn('Translation processing errors:', errorMessages);
			}

			if (errorMessages.length > 0) {
				ModalManager.errorModal(
					'AI Translation Errors',
					`Errors detected in ${errorMessages.length} verse${errorMessages.length > 1 ? 's' : ''}. You can either try again with a new AI response or manually fix the affected subtitles.`,
					summaryMessage
				);
			} else {
				toast.success(summaryMessage);
			}

			if (successfulVerses > 0) {
				AnalyticsService.trackAIUsage('translation', {
					range: `indices ${startIndex}-${endIndex}`,
					start_index: startIndex,
					end_index: endIndex,
					total_verses: totalVerses,
					processed_verses: processedVerses,
					successful_verses: successfulVerses,
					had_errors: errorMessages.length > 0,
					edition_key: edition.key,
					edition_name: edition.name,
					edition_author: edition.author,
					edition_language: edition.language
				});
				close(); // Close modal only if at least some translations were successful
			}
		} catch (error: any) {
			ModalManager.errorModal(
				'Error processing AI response',
				'An error occurred while processing the AI response.',
				error.message
			);
		}
	}

	onMount(async () => {
		generatePrompt();
	});
	async function generatePrompt() {
		// Génère le tableau complet des versets
		const array = [];
		let verses: { [key: string]: SubtitleClip[] } = {};
		const verseFirstIndex: { [key: string]: number } = {};

		for (let i: number = 0; i < globalState.getSubtitleClips.length; i++) {
			const subtitle = globalState.getSubtitleClips[i];
			const verseKey = subtitle.getVerseKey();

			if (verses[verseKey] === undefined) {
				if (subtitle.isFullVerse) continue; // Si verset complet la traduction est faite par défaut
				verses[verseKey] = [];
				verseFirstIndex[verseKey] = i; // Position du premier segment dans la timeline
			}

			verses[verseKey].push(subtitle);
		}

		// Si tout les sous-titres d'un même verset on un status qui montre que c'est déjà traduit, on ne les traite pas
		for (const verseKey in verses) {
			const subtitlesForVerse = verses[verseKey];

			if (
				subtitlesForVerse.every((subtitle) =>
					subtitle.translations[edition.name]?.isStatusComplete()
				)
			) {
				delete verses[verseKey]; // Supprime le verset s'il est déjà traduit
			}
		}

		// Vérifier s'il reste des versets à traiter
		if (Object.keys(verses).length === 0) {
			aiPrompt =
				'All verses have already been translated for this edition. No AI assistance needed.';
			return;
		}

		for (const verseKey in verses) {
			const verse = verses[verseKey];
			const translation = globalState.getProjectTranslation.getVerseTranslation(edition, verseKey);

			// Format compact : "index:word index:word..."
			let translationString = translation
				.split(' ')
				.map((word, index) => `${index}:${word}`)
				.join(' ');

			if (verse.length > 0) {
				array.push({
					index: verseFirstIndex[verseKey],
					verseKey: verseKey,
					segments: verse.map((subtitle) => subtitle.text),
					translation: translationString
				});
			}
		}

		// Stocke le tableau complet et initialise les valeurs du slider
		fullVerseArray = array;
		totalVerses = array.length;
		startIndex = 0;
		endIndex = Math.max(0, totalVerses - 1);

		// Génère le prompt initial avec tous les versets
		await updatePromptWithRange();
	}

	async function updatePromptWithRange() {
		// Filtre le tableau selon la plage sélectionnée
		const filteredArray = fullVerseArray.slice(startIndex, endIndex + 1);

		const json = JSON.stringify(filteredArray);
		if (globalState.settings?.aiTranslationSettings?.omitPromptPrefix) {
			aiPrompt = json;
			return;
		}

		let prompt = await (await fetch('/prompts/translation.txt')).text();

		aiPrompt = prompt + '\n\n' + json;
	}
</script>

<div
	class="bg-secondary border-color border rounded-2xl w-[900px] h-[700px] shadow-2xl shadow-black flex flex-col relative overflow-hidden"
	transition:slide
>
	<!-- Header with gradient background -->
	<div class="bg-gradient-to-r from-accent to-bg-accent px-6 py-4 border-b border-color">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3">
				<div class="w-10 h-10 bg-accent-primary rounded-full flex items-center justify-center">
					<span class="material-icons text-black text-xl">psychology</span>
				</div>
				<div>
					<h2 class="text-xl font-bold text-primary">AI Translation Assistant</h2>
					<p class="text-sm text-thirdly">
						Generate translations for <strong class="text-accent">{edition.author}</strong> edition
					</p>
				</div>
			</div>

			<!-- Close button -->
			<button
				class="w-8 h-8 rounded-full hover:bg-[rgba(255,255,255,0.1)] flex items-center justify-center transition-all duration-200 text-secondary hover:text-primary cursor-pointer"
				onclick={close}
			>
				<span class="material-icons text-lg">close</span>
			</button>
		</div>
	</div>
	<!-- Instructions section - Collapsible -->
	<div class="px-6 py-3 border-b border-color bg-primary">
		<button
			class="w-full bg-accent border border-color rounded-lg p-3 transition-all duration-200 hover:bg-[rgba(88,166,255,0.1)]"
			onclick={() =>
				(globalState.currentProject!.projectEditorState.translationsEditor.showAIInstructions =
					!globalState.currentProject!.projectEditorState.translationsEditor.showAIInstructions)}
		>
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-3">
					<div
						class="w-7 h-7 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0"
					>
						<span class="material-icons text-white text-sm">info</span>
					</div>
					<div class="text-left">
						<h3 class="text-sm font-semibold text-primary">How to use AI Translation</h3>
						<p class="text-xs text-thirdly">
							Click to {globalState.currentProject!.projectEditorState.translationsEditor
								.showAIInstructions
								? 'hide'
								: 'show'} detailed instructions
						</p>
					</div>
				</div>
				<span
					class="material-icons text-secondary transition-transform duration-200 {globalState
						.currentProject!.projectEditorState.translationsEditor.showAIInstructions
						? 'rotate-180'
						: ''}"
				>
					expand_more
				</span>
			</div>
		</button>

		{#if globalState.currentProject!.projectEditorState.translationsEditor.showAIInstructions}
			<div
				class="mt-3 p-4 bg-secondary border border-color rounded-lg"
				transition:slide={{ duration: 200 }}
			>
				<div class="space-y-2 text-sm text-secondary">
					<div class="flex items-start gap-2">
						<span
							class="flex-shrink-0 w-5 h-5 bg-accent-primary text-black rounded-full flex items-center justify-center text-xs font-bold mt-0.5"
							>1</span
						>
						<p>
							Copy the generated prompt below and paste it in <span class="text-accent font-medium"
								><ClickableLink url="https://grok.com/" label="Grok" /></span
							> (Recommended)
						</p>
					</div>
					<div class="flex items-start gap-2">
						<span
							class="flex-shrink-0 w-5 h-5 bg-accent-primary text-black rounded-full flex items-center justify-center text-xs font-bold mt-0.5"
							>2</span
						>
						<p>Wait for the AI to generate the JSON response</p>
					</div>
					<div class="flex items-start gap-2">
						<span
							class="flex-shrink-0 w-5 h-5 bg-accent-primary text-black rounded-full flex items-center justify-center text-xs font-bold mt-0.5"
							>3</span
						>
						<p>Copy the JSON response and paste it in the response field below</p>
					</div>
					<div class="flex items-start gap-2">
						<span
							class="flex-shrink-0 w-5 h-5 bg-accent-primary text-black rounded-full flex items-center justify-center text-xs font-bold mt-0.5"
							>4</span
						>
						<p>Click "Apply Translations" to update your subtitles</p>
					</div>
				</div>
			</div>
		{/if}
	</div>
	<!-- Content area -->
	<div class="flex-1 overflow-hidden flex flex-col">
		<div class="flex-1 overflow-y-auto px-6 py-4 space-y-6">
			{#if aiPrompt === 'All verses have already been translated for this edition. No AI assistance needed.'}
				<!-- All verses translated message -->
				<div class="flex flex-col items-center justify-center h-full text-center">
					<div class="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mb-4">
						<span class="material-icons text-green-500 text-2xl">check_circle</span>
					</div>
					<h3 class="text-xl font-semibold text-primary mb-2">All Done!</h3>
					<p class="text-thirdly text-lg mb-2">
						All verses have already been translated for the <strong class="text-accent"
							>{edition.author}</strong
						> edition.
					</p>
					<p class="text-sm text-secondary">No AI assistance needed at this time.</p>
				</div>
			{:else}
				<!-- Normal AI workflow -->

				<!-- Range Selection Section -->
				{#if totalVerses > 1}
					<div class="space-y-3">
						<div class="flex items-center gap-2">
							<span class="material-icons text-accent text-lg">tune</span>
							<h3 class="text-lg font-semibold text-primary">Verse Selection</h3>
							<span class="bg-accent px-2 py-1 rounded-md text-xs font-semibold">
								{totalVerses} verses found
							</span>
						</div>
						<div class="bg-accent border border-color rounded-lg p-4">
							<div class="mb-4">
								<div class="flex items-center justify-between mb-2">
									<p class="text-sm font-medium text-secondary">
										Select verse range to include in prompt: <span class="italic"
											>(in case prompt is too long)</span
										>
									</p>
									<div class="text-sm text-primary font-mono">
										Indices {startIndex} to {endIndex} ({endIndex - startIndex + 1} verses)
									</div>
								</div>

								<!-- Custom dual-handle slider -->
								<div class="relative mt-6 mb-6">
									<!-- Track background -->
									<div class="w-full h-2 bg-secondary rounded-full relative">
										<!-- Active track between handles -->
										<div
											class="absolute h-2 bg-accent-primary rounded-full"
											style="left: {(startIndex / Math.max(1, totalVerses - 1)) *
												100}%; width: {((endIndex - startIndex) / Math.max(1, totalVerses - 1)) *
												100}%;"
										></div>
									</div>

									<!-- Start handle -->
									<input
										type="range"
										min="0"
										max={totalVerses - 1}
										bind:value={startIndex}
										oninput={(e) => {
											//@ts-ignore
											const newStart = parseInt(e.target.value);
											if (newStart > endIndex) {
												endIndex = newStart;
											}
											startIndex = newStart;
											updatePromptWithRange();
										}}
										class="absolute top-0 w-full h-2 appearance-none bg-transparent cursor-pointer range-slider"
									/>

									<!-- End handle -->
									<input
										type="range"
										min="0"
										max={totalVerses - 1}
										bind:value={endIndex}
										oninput={(e) => {
											//@ts-ignore
											const newEnd = parseInt(e.target.value);
											if (newEnd < startIndex) {
												startIndex = newEnd;
											}
											endIndex = newEnd;
											updatePromptWithRange();
										}}
										class="absolute top-0 w-full h-2 appearance-none bg-transparent cursor-pointer range-slider"
									/>
								</div>

								<!-- Verse preview -->
								<div class="grid grid-cols-2 gap-4 text-xs">
									<div class="bg-secondary border border-color rounded-lg p-3">
										<div class="font-medium text-accent-primary mb-1">
											Start: Index {startIndex}
										</div>
										<div class="text-thirdly">
											Verse: {fullVerseArray[startIndex]?.verseKey || 'N/A'}
										</div>
									</div>
									<div class="bg-secondary border border-color rounded-lg p-3">
										<div class="font-medium text-accent-primary mb-1">End: Index {endIndex}</div>
										<div class="text-thirdly">
											Verse: {fullVerseArray[endIndex]?.verseKey || 'N/A'}
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>
				{/if}

				<!-- Prompt section -->
				<div class="space-y-3">
					<div class="flex items-center gap-2">
						<span class="material-icons text-accent-primary text-lg">code</span>
						<h3 class="text-lg font-semibold text-primary">AI Prompt</h3>
						<span class="bg-accent-primary text-black px-2 py-1 rounded-md text-xs font-semibold"
							>Step 1</span
						>
					</div>
					<div class="bg-accent border border-color rounded-lg p-4">
						<div class="flex items-center justify-between mb-3">
							<label for="ai-prompt" class="text-sm font-medium text-secondary"
								>Generated prompt for AI:</label
							>
							<button
								class="btn-accent px-4 py-2 text-sm font-medium rounded-lg flex items-center gap-2 hover:shadow-lg transition-all duration-200"
								onclick={() => {
									navigator.clipboard.writeText(aiPrompt);
									toast.success('Prompt copied to clipboard!');
								}}
								disabled={!aiPrompt}
							>
								<span class="material-icons text-base">content_copy</span>
								Copy Prompt
							</button>
						</div>
						<div class="flex items-center gap-3 mb-3">
							<input
								id="ai-prompt-input-only"
								type="checkbox"
								bind:checked={globalState.settings!.aiTranslationSettings.omitPromptPrefix}
								onchange={persistAiTranslationSettings}
								class="w-4 h-4 rounded transition-all duration-200 focus:ring-2 focus:ring-[var(--accent-primary)] focus:ring-offset-2 focus:ring-offset-[var(--bg-accent)]"
							/>
							<label for="ai-prompt-input-only" class="text-sm text-secondary">
								Use input only (no prompt prefix)
							</label>
						</div>
						<textarea
							id="ai-prompt"
							readonly
							bind:value={aiPrompt}
							class="w-full h-32 bg-secondary border border-color rounded-lg p-3 text-sm text-primary resize-none font-mono leading-relaxed"
							placeholder="Generating prompt..."
						></textarea>
					</div>
				</div>

				<!-- Response section -->
				<div class="space-y-3">
					<div class="flex items-center gap-2">
						<span class="material-icons text-accent-secondary text-lg">smart_toy</span>
						<h3 class="text-lg font-semibold text-primary">AI Response</h3>
						<span class="bg-accent-secondary text-black px-2 py-1 rounded-md text-xs font-semibold"
							>Step 2</span
						>
					</div>
					<div class="bg-accent border border-color rounded-lg p-4">
						<div class="flex items-center justify-between mb-3">
							<label for="ai-response" class="text-sm font-medium text-secondary"
								>Paste the JSON response from AI:</label
							>
							<button
								class="btn-accent px-4 py-2 text-sm font-medium rounded-lg flex items-center gap-2 hover:shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
								onclick={() => setTranslationsFromAIResponse(aiResponse)}
								disabled={!aiResponse.trim()}
							>
								<span class="material-icons text-base">auto_fix_high</span>
								Apply Translations
							</button>
						</div>
						<textarea
							id="ai-response"
							bind:value={aiResponse}
							class="w-full h-32 bg-secondary border border-color rounded-lg p-3 text-sm text-primary resize-none font-mono leading-relaxed focus:border-accent-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:ring-opacity-20 transition-all duration-200"
							placeholder="Paste the JSON response from the AI here..."
						></textarea>

						{#if aiResponse.trim()}
							<div class="mt-3 p-3 bg-secondary border border-color rounded-lg">
								<div class="flex items-center gap-2">
									<span class="material-icons text-accent-secondary text-sm">check_circle</span>
									<span class="text-sm text-accent-secondary font-medium">Response detected</span>
								</div>
								<p class="text-xs text-thirdly mt-1">
									Ready to apply translations to your subtitles
								</p>
							</div>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	</div>

	<!-- Footer -->
	<div class="border-t border-color bg-primary px-6 py-4">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-2 text-sm text-thirdly">
				<span class="material-icons text-accent-primary">psychology</span>
				<span>Using AI to optimize translation segmentation</span>
			</div>

			<div class="flex gap-3">
				<button class="btn px-6 py-2.5 font-medium" onclick={close}> Cancel </button>
			</div>
		</div>
	</div>
</div>

<style>
	/* Custom scrollbar */
	.overflow-y-auto::-webkit-scrollbar {
		width: 8px;
	}

	.overflow-y-auto::-webkit-scrollbar-track {
		background: var(--bg-secondary);
		border-radius: 4px;
	}

	.overflow-y-auto::-webkit-scrollbar-thumb {
		background: var(--timeline-scrollbar);
		border-radius: 4px;
		transition: background 0.2s ease;
	}

	.overflow-y-auto::-webkit-scrollbar-thumb:hover {
		background: var(--timeline-scrollbar-hover);
	}

	/* Enhanced gradient backgrounds */
	.bg-gradient-to-r.from-accent.to-bg-accent {
		background: linear-gradient(135deg, var(--bg-accent) 0%, var(--bg-secondary) 100%);
	}

	/* Enhanced hover effects */
	button:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
	}

	.btn-accent:hover:not(:disabled) {
		box-shadow: 0 4px 16px rgba(88, 166, 255, 0.3);
	}

	/* Enhanced focus states */
	textarea:focus {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(88, 166, 255, 0.2);
	}

	/* Better disabled state */
	button:disabled {
		transform: none !important;
		box-shadow: none !important;
	}

	/* Smooth animations */
	@keyframes slideInUp {
		from {
			opacity: 0;
			transform: translateY(20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.bg-secondary {
		animation: slideInUp 0.3s ease-out;
	}

	/* Step indicators */
	.bg-accent-primary,
	.bg-accent-secondary {
		position: relative;
		overflow: hidden;
	}

	.bg-accent-primary::before,
	.bg-accent-secondary::before {
		content: '';
		position: absolute;
		top: 0;
		left: -100%;
		width: 100%;
		height: 100%;
		background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
		transition: left 0.5s;
	}

	.bg-accent-primary:hover::before,
	.bg-accent-secondary:hover::before {
		left: 100%;
	}

	/* Custom dual-handle range slider styles */
	.range-slider {
		pointer-events: none;
	}

	.range-slider::-webkit-slider-thumb {
		appearance: none;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: var(--accent-primary);
		border: 3px solid var(--bg-primary);
		cursor: pointer;
		pointer-events: all;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
		transition: all 0.2s ease;
		position: relative;
		z-index: 2;
	}

	.range-slider::-webkit-slider-thumb:hover {
		transform: scale(1.1);
		box-shadow: 0 3px 8px rgba(88, 166, 255, 0.4);
	}

	.range-slider::-webkit-slider-thumb:active {
		transform: scale(1.05);
		box-shadow: 0 1px 4px rgba(88, 166, 255, 0.6);
	}

	.range-slider::-moz-range-thumb {
		appearance: none;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: var(--accent-primary);
		border: 3px solid var(--bg-primary);
		cursor: pointer;
		pointer-events: all;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
		transition: all 0.2s ease;
	}

	.range-slider::-moz-range-thumb:hover {
		transform: scale(1.1);
		box-shadow: 0 3px 8px rgba(88, 166, 255, 0.4);
	}

	.range-slider::-moz-range-track {
		background: transparent;
		height: 8px;
	}

	.range-slider:focus {
		outline: none;
	}

	.range-slider:focus::-webkit-slider-thumb {
		box-shadow: 0 0 0 2px rgba(88, 166, 255, 0.3);
	}
</style>
