<script lang="ts">
	import type { Edition, SubtitleClip } from '$lib/classes';
	import type { VerseTranslation } from '$lib/classes/Translation.svelte';
	import Settings from '$lib/classes/Settings.svelte';
	import ClickableLink from '$lib/components/home/ClickableLink.svelte';
	import ModalManager from '$lib/components/modals/ModalManager';
	import AdvancedAITrimmingTab from './AdvancedAITrimmingTab.svelte';
	import VerseRangeSelector from './VerseRangeSelector.svelte';
	import AiTranslationTelemetryService from '$lib/services/AiTranslationTelemetryService';
	import { AnalyticsService } from '$lib/services/AnalyticsService';
	import { globalState } from '$lib/runes/main.svelte';
	import { onMount } from 'svelte';
	import toast from 'svelte-5-french-toast';
	import { slide } from 'svelte/transition';

	type TranslationWord = { i: number; w: string };
	type PromptSegment = {
		i: number;
		arabic: string;
		locked: boolean;
		lockedRange?: [number, number];
		lockedText?: string;
	};
	type PromptVersePayload = {
		index: number;
		verseKey: string;
		startTime: number;
		endTime: number;
		segments: PromptSegment[];
		translation: string;
	};
	type VerseRuntimeMapping = {
		verseKey: string;
		subtitles: SubtitleClip[];
		translationWords: TranslationWord[];
		segmentLocks: boolean[];
		promptLockedRanges: Array<[number, number] | null>;
	};

	let {
		close,
		edition
	}: {
		close: () => void;
		edition: Edition;
	} = $props();

	let aiPrompt: string = $state('');
	let aiResponse: string = $state('');
	let activeTab: 'legacy' | 'advanced' = $state(
		globalState.settings?.aiTranslationSettings?.activeModalTab ?? 'legacy'
	);

	// Variables pour le slider de sélection de plage
	let totalVerses: number = $state(0);
	let selectedStartTimeMs: number = $state(0);
	let selectedEndTimeMs: number = $state(0);
	let fullVerseArray: PromptVersePayload[] = $state([]);

	function persistAiTranslationSettings(): void {
		if (!globalState.settings) return;
		void Settings.save();
		void updatePromptWithRange();
	}

	function setActiveTab(nextTab: 'legacy' | 'advanced'): void {
		activeTab = nextTab;
		if (!globalState.settings) return;
		globalState.settings.aiTranslationSettings.activeModalTab = nextTab;
		void Settings.save();
	}

	function getSelectionMaxDurationMs(): number {
		return (
			globalState.getAudioTrack?.getDuration().ms ||
			globalState.getSubtitleTrack?.getDuration().ms ||
			Math.max(...fullVerseArray.map((verse) => verse.endTime), 0)
		);
	}

	function rangesOverlap(
		leftStart: number,
		leftEnd: number,
		rightStart: number,
		rightEnd: number
	): boolean {
		return leftStart <= rightEnd && rightStart <= leftEnd;
	}

	function getSelectedPromptVerses(): PromptVersePayload[] {
		return fullVerseArray.filter((verse) =>
			rangesOverlap(verse.startTime, verse.endTime, selectedStartTimeMs, selectedEndTimeMs)
		);
	}

	// Accepte soit l'ancien format array (fallback), soit le format objet indexé attendu.
	function normalizeResponseJson(raw: unknown, expectedIndexes: number[]): Record<string, unknown> {
		if (Array.isArray(raw)) {
			const normalized: Record<string, unknown> = {};
			for (let i = 0; i < expectedIndexes.length; i++) {
				normalized[String(expectedIndexes[i])] = raw[i];
			}
			return normalized;
		}

		if (raw && typeof raw === 'object') {
			return raw as Record<string, unknown>;
		}

		throw new Error('Invalid AI response format: expected a JSON object or array.');
	}

	// Parser la traduction compacte "index:word index:word..."
	function parseCompactTranslation(translationStr: string): TranslationWord[] {
		return translationStr
			.split(' ')
			.map((item) => {
				const colonIndex = item.indexOf(':');
				const index = Number(item.substring(0, colonIndex));
				const word = item.substring(colonIndex + 1);
				return { i: index, w: word };
			})
			.filter((item) => Number.isFinite(item.i));
	}

	function toValidRange(range: unknown, totalWords: number): [number, number] | null {
		if (!Array.isArray(range) || range.length !== 2) return null;

		const start = Number(range[0]);
		const end = Number(range[1]);

		if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
		if (start < 0 || end < 0) return null;
		if (start > end) return null;
		if (start >= totalWords || end >= totalWords) return null;

		return [start, end];
	}

	// Lit la range sauvegardée d'un segment déjà complété et la valide contre la traduction courante.
	function getLockedRange(
		translation: VerseTranslation | null | undefined,
		totalWords: number
	): [number, number] | null {
		if (!translation) return null;
		if (totalWords <= 0) return null;
		const start = Number(translation.startWordIndex);
		const end = Number(translation.endWordIndex);
		if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
		if (start < 0 || end < 0 || start > end) return null;
		if (start >= totalWords || end >= totalWords) return null;
		return [start, end];
	}

	// Fonction pour traiter la réponse de l'IA et mettre à jour les traductions
	async function setTranslationsFromAIResponse(aiResponseStr: string): Promise<void> {
		try {
			aiResponseStr = aiResponseStr.replace('```json', '');
			aiResponseStr = aiResponseStr.replace('```', '');

			const parsed = JSON.parse(aiResponseStr);

			// Error tracking
			const errorMessages: string[] = [];
			let processedVerses = 0;
			let successfulVerses = 0;
			let lockedSegmentsCount = 0;
			let updatedUnlockedSegmentsCount = 0;
			let skippedLockedSegmentsCount = 0;
			const legacyTelemetryEntries: Array<{
				verseKey: string;
				subtitleId: number;
				segment: string;
				translationWords: TranslationWord[];
				aiRange: [number, number] | null;
				status: 'ai trimmed' | 'ai error';
			}> = [];

			// Utilise le tableau filtré pour le mapping
			const filteredArray = getSelectedPromptVerses();
			const indexToSubtitleMapping: Record<number, VerseRuntimeMapping> = {};

			// Reconstruit le mapping pour les versets sélectionnés
			const verses: Record<string, SubtitleClip[]> = {};
			// Collecte les sous-titres par verset
			for (let i = 0; i < globalState.getSubtitleClips.length; i++) {
				const subtitle = globalState.getSubtitleClips[i];
				const verseKey = subtitle.getVerseKey();

				if (subtitle.isFullVerse) continue; // If complete verse, translation is done by default

				if (!verses[verseKey]) {
					verses[verseKey] = [];
				}
				verses[verseKey].push(subtitle);
			}

			// Filtre seulement les versets qui sont dans la plage sélectionnée
			for (let i = 0; i < filteredArray.length; i++) {
				const verseData = filteredArray[i];
				const verseKey = verseData.verseKey;

				if (!verses[verseKey]) continue;

				const subtitles = verses[verseKey];
				// Convertir le format compact en objets
				const translationWords = parseCompactTranslation(verseData.translation);
				const segmentLocks = subtitles.map((subtitle, segmentIndex) => {
					const promptSegment = verseData.segments?.[segmentIndex];
					if (promptSegment && typeof promptSegment === 'object' && 'locked' in promptSegment) {
						return Boolean(promptSegment.locked);
					}
					const subtitleTranslation = subtitle.translations[edition.name] as VerseTranslation;
					return subtitleTranslation?.isStatusComplete() ?? false;
				});
				const promptLockedRanges = subtitles.map((_, segmentIndex) => {
					const promptSegment = verseData.segments?.[segmentIndex];
					if (!promptSegment?.locked) return null;
					return toValidRange(promptSegment.lockedRange, translationWords.length);
				});

				lockedSegmentsCount += segmentLocks.filter(Boolean).length;

				indexToSubtitleMapping[verseData.index] = {
					verseKey,
					subtitles,
					translationWords,
					segmentLocks,
					promptLockedRanges
				};
			}

			const expectedIndexes = filteredArray
				.map((item) => item.index)
				.filter((index) => indexToSubtitleMapping[index] !== undefined);
			if (expectedIndexes.length === 0) {
				ModalManager.errorModal(
					'AI Translation Errors',
					'No eligible verses were found for this prompt range.',
					'Regenerate the prompt and try again.'
				);
				return;
			}

			const aiResponse = normalizeResponseJson(parsed, expectedIndexes);

			// Traite chaque réponse de l'IA
			for (const responseKey in aiResponse) {
				const responseIndex = Number(responseKey);
				if (!Number.isFinite(responseIndex)) continue;
				if (!indexToSubtitleMapping[responseIndex]) {
					errorMessages.push(
						`Index ${responseIndex}: No corresponding verse found in the selected prompt range`
					);
				}
			}

			for (const indexNum of expectedIndexes) {
				const mappingData = indexToSubtitleMapping[indexNum];
				const segmentRangesRaw = aiResponse[String(indexNum)];

				const fallbackErrorTelemetryEntries = () => {
					for (let segmentIndex = 0; segmentIndex < mappingData.subtitles.length; segmentIndex++) {
						if (mappingData.segmentLocks[segmentIndex]) continue;
						const subtitle = mappingData.subtitles[segmentIndex];
						legacyTelemetryEntries.push({
							verseKey: mappingData.verseKey,
							subtitleId: subtitle.id,
							segment: subtitle.text,
							translationWords: mappingData.translationWords,
							aiRange: null,
							status: 'ai error'
						});
					}
				};

				if (typeof segmentRangesRaw === 'undefined') {
					errorMessages.push(
						`Index ${indexNum} (${mappingData.verseKey}): Missing entry in AI response`
					);
					fallbackErrorTelemetryEntries();
					continue;
				}

				if (!Array.isArray(segmentRangesRaw)) {
					errorMessages.push(
						`Index ${indexNum} (${mappingData.verseKey}): Invalid response format - expected array`
					);
					fallbackErrorTelemetryEntries();
					continue;
				}

				processedVerses++;

				const subtitlesForVerse = mappingData.subtitles;
				const translationWords = mappingData.translationWords;
				const segmentLocks = mappingData.segmentLocks;
				const promptLockedRanges = mappingData.promptLockedRanges;
				const verseKey = mappingData.verseKey;

				const totalWords = translationWords.length;
				if (totalWords === 0) {
					errorMessages.push(`Verse ${verseKey}: Translation has no words to map`);
					for (let segmentIndex = 0; segmentIndex < subtitlesForVerse.length; segmentIndex++) {
						if (segmentLocks[segmentIndex]) continue;
						const verseTranslation = subtitlesForVerse[segmentIndex].translations[
							edition.name
						] as VerseTranslation;
						verseTranslation.updateStatus('ai error', edition);
						legacyTelemetryEntries.push({
							verseKey,
							subtitleId: subtitlesForVerse[segmentIndex].id,
							segment: subtitlesForVerse[segmentIndex].text,
							translationWords,
							aiRange: null,
							status: 'ai error'
						});
					}
					continue;
				}

				const effectiveRanges: Array<[number, number] | null> = new Array(
					subtitlesForVerse.length
				).fill(null);
				const parsedUnlockedRanges: Array<[number, number] | null> = new Array(
					subtitlesForVerse.length
				).fill(null);

				let verseUpdatedUnlocked = 0;
				let verseHasError = false;

				for (let segmentIndex = 0; segmentIndex < subtitlesForVerse.length; segmentIndex++) {
					const subtitle = subtitlesForVerse[segmentIndex];
					const verseTranslation = subtitle.translations[edition.name] as VerseTranslation;
					const isLocked = segmentLocks[segmentIndex] === true;

					if (isLocked) {
						skippedLockedSegmentsCount++;
						// Segment verrouillé = contexte seulement: on n'écrit jamais dessus.
						// On prend la range actuelle, sinon le snapshot envoyé dans le prompt.
						const lockedRange =
							getLockedRange(verseTranslation, totalWords) ?? promptLockedRanges[segmentIndex];
						if (!lockedRange) {
							// Locked segments are immutable context-only anchors; do not block processing.
							continue;
						}

						effectiveRanges[segmentIndex] = lockedRange;
						continue;
					}

					const rawRange =
						segmentIndex < segmentRangesRaw.length ? segmentRangesRaw[segmentIndex] : undefined;
					if (rawRange === null || typeof rawRange === 'undefined') {
						errorMessages.push(
							`Verse ${verseKey}, segment ${segmentIndex + 1}: AI returned null/missing range`
						);
						verseTranslation.updateStatus('ai error', edition);
						verseHasError = true;
						continue;
					}

					const range = toValidRange(rawRange, totalWords);
					if (!range) {
						errorMessages.push(
							`Verse ${verseKey}, segment ${segmentIndex + 1}: Invalid range format or out-of-bounds range`
						);
						verseTranslation.updateStatus('ai error', edition);
						verseHasError = true;
						continue;
					}

					const [rangeStart, rangeEnd] = range;
					// Extrait le texte de traduction correspondant aux indices
					const translationText = translationWords
						.slice(rangeStart, rangeEnd + 1)
						.map((word) => word.w)
						.join(' ');

					// Met à jour la traduction du sous-titre
					verseTranslation.text = translationText;
					verseTranslation.startWordIndex = rangeStart;
					verseTranslation.endWordIndex = rangeEnd;

					parsedUnlockedRanges[segmentIndex] = range;
					effectiveRanges[segmentIndex] = range;
					verseUpdatedUnlocked++;
					updatedUnlockedSegmentsCount++;
				}

				const coveredIndices = new Set<number>();
				// Vérification de la couverture complète des indices (locked + unlocked).
				// Important: on valide la couverture effective, pas uniquement la sortie IA brute.
				for (const range of effectiveRanges) {
					if (!range) continue;
					const [start, end] = range;
					for (let i = start; i <= end; i++) {
						coveredIndices.add(i);
					}
				}

				const incompleteCoverage = coveredIndices.size !== totalWords;
				if (incompleteCoverage) {
					const missingIndices: number[] = [];
					for (let i = 0; i < totalWords; i++) {
						if (!coveredIndices.has(i)) missingIndices.push(i);
					}
					errorMessages.push(
						`Verse ${verseKey}: Incomplete word coverage - missing indices ${missingIndices.join(', ')} (covered ${coveredIndices.size}/${totalWords} words)`
					);
					verseHasError = true;
				}

				for (let segmentIndex = 0; segmentIndex < subtitlesForVerse.length; segmentIndex++) {
					if (segmentLocks[segmentIndex]) continue;
					const verseTranslation = subtitlesForVerse[segmentIndex].translations[
						edition.name
					] as VerseTranslation;
					const appliedRange = parsedUnlockedRanges[segmentIndex];

					// Met le statut approprié : 'ai error' si couverture incomplète, sinon 'ai trimmed'
					const status: 'ai trimmed' | 'ai error' =
						incompleteCoverage || !appliedRange ? 'ai error' : 'ai trimmed';
					if (status === 'ai error') {
						verseTranslation.updateStatus('ai error', edition);
					} else {
						verseTranslation.updateStatus('ai trimmed', edition);
					}

					legacyTelemetryEntries.push({
						verseKey,
						subtitleId: subtitlesForVerse[segmentIndex].id,
						segment: subtitlesForVerse[segmentIndex].text,
						translationWords,
						aiRange: appliedRange,
						status
					});
				}

				// Même en cas d'erreur partielle, on compte le verset comme réussi si au moins
				// un segment non verrouillé a été mis à jour.
				if (verseUpdatedUnlocked > 0) {
					successfulVerses++;
				} else if (!verseHasError) {
					errorMessages.push(`Verse ${verseKey}: No unlocked segments were updated`);
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
					`Errors detected in ${errorMessages.length} item${errorMessages.length > 1 ? 's' : ''}. Locked segments are preserved and were not overwritten.`,
					summaryMessage
				);
			} else {
				toast.success(summaryMessage);
			}

			if (globalState.currentProject && legacyTelemetryEntries.length > 0) {
				await AiTranslationTelemetryService.recordLegacyRun({
					projectId: globalState.currentProject.detail.id,
					edition,
					entries: legacyTelemetryEntries
				});
			}

			if (successfulVerses > 0) {
				AnalyticsService.trackAIUsage('translation', {
					range: `time ${selectedStartTimeMs}-${selectedEndTimeMs}`,
					start_time_ms: selectedStartTimeMs,
					end_time_ms: selectedEndTimeMs,
					total_verses: totalVerses,
					processed_verses: processedVerses,
					successful_verses: successfulVerses,
					had_errors: errorMessages.length > 0,
					locked_segments_count: lockedSegmentsCount,
					updated_unlocked_segments_count: updatedUnlockedSegmentsCount,
					skipped_locked_segments_count: skippedLockedSegmentsCount,
					edition_key: edition.key,
					edition_name: edition.name,
					edition_author: edition.author,
					edition_language: edition.language
				});
				close(); // Close modal only if at least some translations were successful
			}
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			ModalManager.errorModal(
				'Error processing AI response',
				'An error occurred while processing the AI response.',
				errorMessage
			);
		}
	}

	onMount(async () => {
		generatePrompt();
	});

	async function generatePrompt() {
		// Génère le tableau complet des versets
		const array: PromptVersePayload[] = [];
		const verses: Record<string, SubtitleClip[]> = {};
		const verseFirstIndex: Record<string, number> = {};

		for (let i = 0; i < globalState.getSubtitleClips.length; i++) {
			const subtitle = globalState.getSubtitleClips[i];
			const verseKey = subtitle.getVerseKey();

			if (verses[verseKey] === undefined) {
				if (subtitle.isFullVerse) continue; // Si verset complet la traduction est faite par défaut
				verses[verseKey] = [];
				verseFirstIndex[verseKey] = i; // Position du premier segment dans la timeline
			}

			verses[verseKey].push(subtitle);
		}

		// Si tout les sous-titres d'un même verset ont un status qui montre que c'est déjà traduit,
		// on ne les traite pas.
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
			const translationString = translation
				.split(' ')
				.map((word, index) => `${index}:${word}`)
				.join(' ');

			if (verse.length > 0) {
				const translationWords = parseCompactTranslation(translationString);
				const segments: PromptSegment[] = verse.map((subtitle, segmentIndex) => {
					const subtitleTranslation = subtitle.translations[edition.name] as VerseTranslation;
					const isLocked = subtitleTranslation?.isStatusComplete() ?? false;

					const segment: PromptSegment = {
						i: segmentIndex,
						arabic: subtitle.text,
						locked: isLocked
					};

					if (isLocked) {
						// On envoie les segments complets comme ancres de contexte pour l'IA.
						// Ils ne seront jamais écrasés pendant l'ingestion.
						const lockedRange = getLockedRange(subtitleTranslation, translationWords.length);
						if (lockedRange) segment.lockedRange = lockedRange;
						if (subtitleTranslation.text?.trim()) {
							segment.lockedText = subtitleTranslation.text;
						}
					}

					return segment;
				});

				array.push({
					index: verseFirstIndex[verseKey],
					verseKey,
					startTime: Math.min(...verse.map((subtitle) => subtitle.startTime)),
					endTime: Math.max(...verse.map((subtitle) => subtitle.endTime)),
					segments,
					translation: translationString
				});
			}
		}

		// Stocke le tableau complet et initialise les valeurs du slider
		fullVerseArray = array;
		totalVerses = array.length;
		selectedStartTimeMs = 0;
		selectedEndTimeMs = getSelectionMaxDurationMs();

		// Génère le prompt initial avec tous les versets
		await updatePromptWithRange();
	}

	async function updatePromptWithRange() {
		// Filtre le tableau selon la plage temporelle sélectionnée
		const filteredArray = getSelectedPromptVerses();

		const json = JSON.stringify(filteredArray);
		if (globalState.settings?.aiTranslationSettings?.omitPromptPrefix) {
			aiPrompt = json;
			return;
		}

		const prompt = await (await fetch('/prompts/translation.txt')).text();

		aiPrompt = prompt + '\n\n' + json;
	}
</script>

<div
	class="bg-secondary border-color border rounded-2xl h-[92vh] xl:h-[80vh] w-[clamp(1200px,96vw,1700px)] max-w-[90vw] xl:max-w-[66vw] shadow-2xl shadow-black flex flex-col relative overflow-hidden"
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
	<div class="border-b border-color bg-primary px-6 py-3">
		<div class="flex gap-2">
			<button
				class="tab-button {activeTab === 'legacy' ? 'tab-button-active' : ''}"
				onclick={() => setActiveTab('legacy')}
			>
				<span class="material-icons text-base">rule</span>
				Legacy AI Mapping
			</button>
			<button
				class="tab-button {activeTab === 'advanced' ? 'tab-button-active' : ''}"
				onclick={() => setActiveTab('advanced')}
			>
				<span class="material-icons text-base">auto_awesome</span>
				Advanced AI Trimming
			</button>
		</div>
	</div>
	<!-- Instructions section - Legacy only -->
	{#if activeTab === 'legacy'}
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
							<h3 class="text-sm font-semibold text-primary">How to use Legacy AI Mapping</h3>
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
								Copy the generated prompt below and paste it in <span
									class="text-accent font-medium"
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
	{/if}
	<!-- Content area -->
	<div class="flex-1 overflow-hidden flex flex-col">
		<div class="flex-1 overflow-y-auto px-6 py-4 space-y-6">
			{#if activeTab === 'advanced'}
				<AdvancedAITrimmingTab {edition} />
			{:else if aiPrompt === 'All verses have already been translated for this edition. No AI assistance needed.'}
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
					<VerseRangeSelector
						totalDurationMs={getSelectionMaxDurationMs()}
						totalItems={totalVerses}
						selectedItems={getSelectedPromptVerses().length}
						bind:startTimeMs={selectedStartTimeMs}
						bind:endTimeMs={selectedEndTimeMs}
						title="Time Selection"
						icon="schedule"
						totalLabel="eligible verses"
						selectionLabel="Select time range to include in prompt:"
						selectionHint="(in case prompt is too long)"
						onRangeChange={updatePromptWithRange}
					/>
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
				<span>
					{activeTab === 'legacy'
						? 'Using AI to optimize translation segmentation'
						: 'Running OpenAI-powered advanced trimming with live feedback'}
				</span>
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

	.tab-button {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		border-radius: 9999px;
		border: 1px solid var(--border-color);
		background: var(--bg-secondary);
		padding: 0.5rem 0.9rem;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-secondary);
		transition:
			background 0.2s ease,
			border-color 0.2s ease,
			color 0.2s ease;
	}

	.tab-button-active {
		border-color: var(--accent-primary);
		background: color-mix(in srgb, var(--accent-primary) 16%, var(--bg-secondary));
		color: var(--text-primary);
	}
</style>
