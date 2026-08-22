<script lang="ts">
	import Exporter from '$lib/classes/Exporter';
	import Settings, { type PerformanceProfile } from '$lib/classes/Settings.svelte';
	import type { FadeValue } from '$lib/components/projectEditor/tabs/subtitlesEditor/modal/autoSegmentation/types';
	import { globalState } from '$lib/runes/main.svelte';
	import { slide } from 'svelte/transition';
	import { get } from 'svelte/store';
	import toast from 'svelte-5-french-toast';
	import TimeInput from './TimeInput.svelte';
	import Style from '../styleEditor/Style.svelte';
	import { VerseRange } from '$lib/classes';
	import ExportFolderPicker from './ExportFolderPicker.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
	import { open } from '@tauri-apps/plugin-dialog';
	import type { ExportSkipRange } from '$lib/classes/ProjectEditorState.svelte';
	import VerseRangeSlider from './VerseRangeSlider.svelte';
	import {
		buildMeaningExportPrompts,
		buildMeaningExportVerses,
		validateMeaningExportRanges,
		type MeaningExportRange
	} from '$lib/services/MeaningExportRangeService';
	import {
		buildTextAIRequestBody,
		extractTextFromResponse,
		parseAiJsonResponse
	} from '$lib/services/TextAIRequest';

	type VideoCodec = 'h264' | 'h265';
	type ExportRangeMode = 'time' | 'verse' | 'meaning';
	type ExportVerseOption = {
		key: string;
		surah: number;
		startTime: number;
		endTime: number;
	};

	const performanceProfileIds: PerformanceProfile[] = ['fastest', 'balanced', 'low_cpu'];
	const videoCodecIds: VideoCodec[] = ['h264', 'h265'];

	let showAdvancedSettings = $state(false);
	let verseStartIndex = $state(0);
	let verseEndIndex = $state(0);
	let skipCopy = $derived(
		$LL.export as unknown as {
			addSkip: () => string;
			skip: () => string;
			setSkipStartToCursor: () => string;
			setSkipEndToCursor: () => string;
			removeSkip: () => string;
		}
	);
	let rangeCopy = $derived(
		$LL.export as unknown as {
			timeRangeMode: () => string;
			verseRangeMode: () => string;
			selectVerseRange: () => string;
			selectedVerseRange: (args: { start: string; end: string }) => string;
		}
	);
	type MeaningExportCopy = {
		meaningRangeMode: () => string;
		meaningRangeDescription: () => string;
		maxDuration: () => string;
		maxDurationDescription: () => string;
		includeAllMeaningVerses: () => string;
		includeAllMeaningVersesDescription: () => string;
		includeAllMeaningVersesRecommendation: () => string;
		generateMeaningRanges: () => string;
		generatingMeaningRanges: () => string;
		meaningRangesEmpty: () => string;
		noMeaningVerses: () => string;
		meaningRangesGenerationFailed: () => string;
		meaningRangesSkipped: (args: { count: number }) => string;
		meaningRangesMissingVerses: (args: { count: number }) => string;
		meaningRangeOverLimit: () => string;
		exportAll: () => string;
	};
	let meaningCopy = $derived($LL.export as unknown as MeaningExportCopy);
	type RandomBackgroundCopy = {
		addRandomBackground: () => string;
		addRandomBackgroundDescription: () => string;
		selectRandomBackgroundFolder: () => string;
		randomBackgroundFolderDescription: () => string;
	};
	let randomBackgroundCopy = $derived($LL.export as unknown as RandomBackgroundCopy);
	type QuranCaptionPromotionCopy = {
		quranCaptionPromotion: () => string;
		addQuranCaptionPromotion: () => string;
		quranCaptionPromotionDescription: () => string;
		quranCaptionPromotionPosition: () => string;
		quranCaptionPromotionAtStart: () => string;
		quranCaptionPromotionAtEnd: () => string;
	};
	let promotionCopy = $derived($LL.export as unknown as QuranCaptionPromotionCopy);
	let meaningRanges = $state<MeaningExportRange[]>([]);
	let selectedMeaningRangeId = $state<string | null>(null);
	let selectedMeaningRangeIds = $state<string[]>([]);
	let meaningSkippedRangeCount = $state(0);
	let meaningMissingVerseCount = $state(0);
	let isGeneratingMeaningRanges = $state(false);
	const exportVerses = $derived.by(() => {
		const verses: ExportVerseOption[] = [];
		const clips = [...globalState.getSubtitleClips].sort((a, b) => a.startTime - b.startTime);

		for (const clip of clips) {
			const key = `${clip.surah}:${clip.verse}`;
			const previous = verses.at(-1);
			if (previous?.key === key) {
				previous.startTime = Math.min(previous.startTime, clip.startTime);
				previous.endTime = Math.max(previous.endTime, clip.endTime);
				continue;
			}

			verses.push({ key, surah: clip.surah, startTime: clip.startTime, endTime: clip.endTime });
		}

		return verses;
	});

	/**
	 * Retrouve les index de versets correspondant à la plage temporelle actuelle.
	 * @returns {{ start: number; end: number }} Index de début et de fin bornés.
	 */
	function getVerseIndexesFromTime(): { start: number; end: number } {
		if (exportVerses.length === 0) return { start: 0, end: 0 };

		const exactStart = exportVerses.findIndex(
			(verse) => verse.startTime === globalState.getExportState.videoStartTime
		);
		const overlappingStart = exportVerses.findIndex(
			(verse) => verse.endTime >= globalState.getExportState.videoStartTime
		);
		const start =
			exactStart >= 0
				? exactStart
				: overlappingStart >= 0
					? overlappingStart
					: exportVerses.length - 1;
		const exactEnd = exportVerses.findLastIndex(
			(verse) => verse.endTime === globalState.getExportState.videoEndTime
		);
		const overlappingEnd = exportVerses.findLastIndex(
			(verse) => verse.startTime <= globalState.getExportState.videoEndTime
		);
		const matchingEnd = exactEnd >= 0 ? exactEnd : overlappingEnd;

		return { start, end: Math.max(start, matchingEnd) };
	}

	/**
	 * Change le mode de sélection de la plage et aligne les temps sur les versets si nécessaire.
	 * @param {ExportRangeMode} mode Nouveau mode de sélection.
	 * @returns {void}
	 */
	function setExportRangeMode(mode: ExportRangeMode): void {
		ProjectHistoryManager.track('set export range mode', () => {
			globalState.getExportState.exportRangeMode = mode;
			if (mode !== 'meaning') {
				selectedMeaningRangeId = null;
				selectedMeaningRangeIds = [];
			}
			if (mode !== 'verse' || exportVerses.length === 0) return;

			const indexes = getVerseIndexesFromTime();
			verseStartIndex = indexes.start;
			verseEndIndex = indexes.end;
			globalState.getExportState.videoStartTime = exportVerses[indexes.start].startTime;
			globalState.getExportState.videoEndTime = exportVerses[indexes.end].endTime;
		});
	}

	/**
	 * Modifie et enregistre la durée maximale des plages sémantiques.
	 * @param {number} value Nouvelle durée maximale en secondes.
	 * @returns {void}
	 */
	function setMeaningMaxDuration(value: number): void {
		const duration = Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1;
		if (globalState.getExportState.meaningMaxDurationSeconds === duration) return;

		ProjectHistoryManager.track('set meaning export max duration', () => {
			globalState.getExportState.meaningMaxDurationSeconds = duration;
		});
	}

	/**
	 * Modifie et enregistre l'obligation de couvrir tous les versets.
	 * @param {boolean} enabled Nouvel état de l'option.
	 * @returns {void}
	 */
	function setIncludeAllMeaningVerses(enabled: boolean): void {
		if (globalState.getExportState.includeAllMeaningVerses === enabled) return;

		ProjectHistoryManager.track('toggle all meaning verses', () => {
			globalState.getExportState.includeAllMeaningVerses = enabled;
		});
	}

	/**
	 * Demande à l'IA de générer des plages sémantiques à partir des versets de la vidéo.
	 * @returns {Promise<void>} Promesse terminée après la génération ou l'affichage de l'erreur.
	 */
	async function generateMeaningRanges(): Promise<void> {
		if (isGeneratingMeaningRanges) return;

		const exportCopy = get(LL).export as unknown as MeaningExportCopy;
		const aiSettings = globalState.settings?.aiTranslationSettings;
		if (!aiSettings?.openAiApiKey || !aiSettings.textAiApiEndpoint) {
			toast.error(get(LL).translations.configureTextAiFirst());
			return;
		}

		isGeneratingMeaningRanges = true;
		meaningRanges = [];
		selectedMeaningRangeId = null;
		selectedMeaningRangeIds = [];
		meaningSkippedRangeCount = 0;
		meaningMissingVerseCount = 0;
		let errorShown = false;

		try {
			const verses = await buildMeaningExportVerses(globalState.getSubtitleClips);
			if (verses.length === 0) {
				errorShown = true;
				toast.error(exportCopy.noMeaningVerses());
				return;
			}

			const { systemPrompt, userPrompt } = buildMeaningExportPrompts(
				verses,
				globalState.getExportState.meaningMaxDurationSeconds,
				globalState.getExportState.includeAllMeaningVerses
			);
			const response = await fetch(aiSettings.textAiApiEndpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${aiSettings.openAiApiKey}`
				},
				body: JSON.stringify(
					buildTextAIRequestBody(
						aiSettings.textAiApiEndpoint,
						aiSettings.advancedTrimModel || 'gpt-4o-mini',
						systemPrompt,
						userPrompt
					)
				)
			});

			if (!response.ok) {
				const errorText = await response.text();
				errorShown = true;
				toast.error(get(LL).aiVideo.aiApiError({ status: String(response.status) }));
				throw new Error(`AI API returned ${response.status}: ${errorText}`);
			}

			const text = extractTextFromResponse(await response.json());
			if (!text) {
				errorShown = true;
				toast.error(get(LL).aiVideo.aiEmptyResponse());
				throw new Error('No text response from AI');
			}

			const validation = validateMeaningExportRanges(
				parseAiJsonResponse<unknown>(text),
				verses,
				globalState.getExportState.meaningMaxDurationSeconds,
				globalState.getExportState.includeAllMeaningVerses
			);
			meaningRanges = validation.ranges;
			meaningSkippedRangeCount = validation.skippedCount;
			meaningMissingVerseCount = validation.missingVerseKeys.length;
			if (meaningRanges.length === 0) toast.error(exportCopy.meaningRangesEmpty());
		} catch (error) {
			console.error('[ExportVideo] Failed to generate meaning ranges:', error);
			if (!errorShown) toast.error(exportCopy.meaningRangesGenerationFailed());
		} finally {
			isGeneratingMeaningRanges = false;
		}
	}

	/**
	 * Sélectionne une ou plusieurs plages sémantiques avec Ctrl/Cmd et applique la plage active.
	 * @param {MeaningExportRange} range Plage générée par l'IA.
	 * @param {MouseEvent} event Événement de clic de la carte.
	 * @returns {void}
	 */
	function selectMeaningRange(range: MeaningExportRange, event: MouseEvent): void {
		const isMultiSelect = event.ctrlKey || event.metaKey;
		const isSelected = selectedMeaningRangeIds.includes(range.id);
		let nextSelectedIds: string[];
		let activeRange: MeaningExportRange | undefined;

		if (!isMultiSelect) {
			nextSelectedIds = [range.id];
			activeRange = range;
		} else if (isSelected) {
			nextSelectedIds = selectedMeaningRangeIds.filter((id) => id !== range.id);
			activeRange =
				selectedMeaningRangeId === range.id
					? meaningRanges.find((candidate) => candidate.id === nextSelectedIds.at(-1))
					: meaningRanges.find((candidate) => candidate.id === selectedMeaningRangeId);
		} else {
			nextSelectedIds = [...selectedMeaningRangeIds, range.id];
			activeRange = range;
		}

		selectedMeaningRangeIds = nextSelectedIds;
		selectedMeaningRangeId = activeRange?.id ?? null;
		if (!activeRange) return;

		ProjectHistoryManager.track('select meaning export range', () => {
			globalState.getExportState.videoStartTime = activeRange.startTime;
			globalState.getExportState.videoEndTime = activeRange.endTime;
		});
		const indexes = getVerseIndexesFromTime();
		verseStartIndex = indexes.start;
		verseEndIndex = indexes.end;
	}

	/**
	 * Exporte la plage active ou toutes les plages sémantiques sélectionnées.
	 * @returns {Promise<void>} Promesse résolue après la mise en file des exports.
	 */
	async function startVideoExport(): Promise<void> {
		if (
			globalState.getExportState.exportRangeMode !== 'meaning' ||
			selectedMeaningRangeIds.length < 2
		) {
			await Exporter.exportVideo();
			return;
		}

		const sourceProject = globalState.currentProject;
		if (!sourceProject) return;

		const selectedRanges = meaningRanges.filter((range) =>
			selectedMeaningRangeIds.includes(range.id)
		);
		if (selectedRanges.length < 2) {
			await Exporter.exportVideo();
			return;
		}

		await Exporter.queueVideoRanges(
			sourceProject,
			selectedRanges,
			sourceProject.detail.generateExportFileName()
		);
	}

	/**
	 * Déplace la borne de début de la plage de versets.
	 * @param {number} index Index du verset choisi.
	 * @returns {void}
	 */
	function handleVerseStartInput(index: number): void {
		const nextIndex = Math.min(index, verseEndIndex);
		const verse = exportVerses[nextIndex];
		if (!verse) return;

		ProjectHistoryManager.track('set export verse range start', () => {
			verseStartIndex = nextIndex;
			globalState.getExportState.videoStartTime = verse.startTime;
		});
	}

	/**
	 * Déplace la borne de fin de la plage de versets.
	 * @param {number} index Index du verset choisi.
	 * @returns {void}
	 */
	function handleVerseEndInput(index: number): void {
		const nextIndex = Math.max(index, verseStartIndex);
		const verse = exportVerses[nextIndex];
		if (!verse) return;

		ProjectHistoryManager.track('set export verse range end', () => {
			verseEndIndex = nextIndex;
			globalState.getExportState.videoEndTime = verse.endTime;
		});
	}

	/**
	 * Regroupe le déplacement continu d'une poignée dans l'historique du projet.
	 * @returns {void}
	 */
	function beginVerseRangeChange(): void {
		ProjectHistoryManager.begin('set export verse range');
	}

	/**
	 * Valide le déplacement continu d'une poignée dans l'historique du projet.
	 * @returns {void}
	 */
	function commitVerseRangeChange(): void {
		ProjectHistoryManager.commit();
	}

	/**
	 * Ajoute une zone ignorée d'une seconde à la position du curseur.
	 * @returns {void}
	 */
	function addSkipRange(): void {
		const startTime = Math.max(0, Math.round(globalState.getTimelineState.cursorPosition));
		ProjectHistoryManager.track('add export skip range', () => {
			globalState.getExportState.skipRanges.push({ startTime, endTime: startTime + 1000 });
		});
	}

	/**
	 * Place une borne de zone ignorée sur le curseur de la timeline.
	 * @param {ExportSkipRange} range Zone ignorée à modifier.
	 * @param {'start' | 'end'} boundary Borne à déplacer.
	 * @returns {void}
	 */
	function setSkipBoundary(range: ExportSkipRange, boundary: 'start' | 'end'): void {
		const cursorTime = Math.max(0, Math.round(globalState.getTimelineState.cursorPosition));
		ProjectHistoryManager.track(`set export skip ${boundary}`, () => {
			if (boundary === 'start') {
				range.startTime = cursorTime;
				if (range.startTime >= range.endTime) range.endTime = range.startTime + 1000;
				return;
			}

			range.endTime = cursorTime;
			if (range.endTime <= range.startTime) {
				range.startTime = Math.max(0, range.endTime - 1000);
				if (range.endTime === range.startTime) range.endTime += 1000;
			}
		});
	}

	/**
	 * Supprime une zone ignorée de l'export.
	 * @param {number} index Index de la zone à supprimer.
	 * @returns {void}
	 */
	function removeSkipRange(index: number): void {
		ProjectHistoryManager.track('remove export skip range', () => {
			globalState.getExportState.skipRanges.splice(index, 1);
		});
	}

	/**
	 * Normalise et sauvegarde le nombre de WebViews utilisees pour capturer les frames.
	 * @returns {Promise<void>}
	 */
	async function saveParallelCaptureWorkers(): Promise<void> {
		if (!globalState.settings) return;
		globalState.settings.exportSettings.parallelCaptureWorkers = Math.max(
			1,
			Math.min(8, Math.round(globalState.settings.exportSettings.parallelCaptureWorkers || 4))
		);
		await Settings.save();
	}

	/**
	 * Sauvegarde le profil de performance global de l'export video.
	 * @param {PerformanceProfile} profile Profil selectionne.
	 * @returns {Promise<void>}
	 */
	async function savePerformanceProfile(profile: PerformanceProfile): Promise<void> {
		if (!globalState.settings) return;
		globalState.settings.exportSettings.performanceProfile = profile;
		await Settings.save();
	}

	/**
	 * Active ou désactive l'ajout d'un arrière-plan aléatoire pour les exports vidéo.
	 * @param {boolean} enabled Nouvel état de l'option.
	 * @returns {void}
	 */
	function setAddRandomBackground(enabled: boolean): void {
		if (globalState.getExportState.addRandomBackground === enabled) return;

		ProjectHistoryManager.track('toggle random export background', () => {
			globalState.getExportState.addRandomBackground = enabled;
		});
	}

	/**
	 * Ouvre le sélecteur et sauvegarde le dossier global de la pool d'arrière-plans.
	 * @returns {Promise<void>} Promesse terminée après la sauvegarde du réglage.
	 */
	async function selectRandomBackgroundFolder(): Promise<void> {
		if (!globalState.settings) return;

		const selected = await open({
			directory: true,
			multiple: false,
			defaultPath: globalState.settings.exportSettings.randomBackgroundFolder || undefined
		});
		if (typeof selected !== 'string' || !selected.trim()) return;

		globalState.settings.exportSettings.randomBackgroundFolder = selected;
		await Settings.save();
	}

	/**
	 * Active ou désactive l'export limité à la récitation avec prise en charge de l'annulation.
	 * @param {boolean} enabled Nouvel état de l'option.
	 * @returns {void}
	 */
	function setExportOnlyRecitation(enabled: boolean): void {
		ProjectHistoryManager.track('toggle recitation-only export', () => {
			globalState.getExportState.exportOnlyRecitation = enabled;
		});
	}

	/**
	 * Active ou désactive la carte promotionnelle Quran Caption pour l'export.
	 * @param {boolean} enabled Nouvel état de l'option.
	 * @returns {void}
	 */
	function setQuranCaptionPromotionEnabled(enabled: boolean): void {
		if (globalState.getExportState.includeQuranCaptionPromotion === enabled) return;

		ProjectHistoryManager.track('toggle Quran Caption promotion', () => {
			globalState.getExportState.includeQuranCaptionPromotion = enabled;
		});
	}

	/**
	 * Modifie la position de la carte promotionnelle dans la vidéo exportée.
	 * @param {'start' | 'end'} position Nouvelle position.
	 * @returns {void}
	 */
	function setQuranCaptionPromotionPosition(position: 'start' | 'end'): void {
		if (globalState.getExportState.quranCaptionPromotionPosition === position) return;

		ProjectHistoryManager.track('set Quran Caption promotion position', () => {
			globalState.getExportState.quranCaptionPromotionPosition = position;
		});
	}

	/**
	 * Modifie la marge conservée autour des coupures de récitation.
	 * @param {number} marginMs Marge en millisecondes.
	 * @returns {void}
	 */
	function setRecitationCutMargin(marginMs: number): void {
		ProjectHistoryManager.track('set recitation export cut margin', () => {
			globalState.getExportState.recitationCutMarginMs = Math.max(0, Math.round(marginMs || 0));
		});
	}

	/**
	 * Modifie la durée minimale de silence qui déclenche une coupure.
	 * @param {number} durationMs Durée en millisecondes.
	 * @returns {void}
	 */
	function setRecitationMinimumSilence(durationMs: number): void {
		ProjectHistoryManager.track('set recitation export minimum silence', () => {
			globalState.getExportState.recitationMinimumSilenceMs = Math.max(
				0,
				Math.round(durationMs || 0)
			);
		});
	}

	// Initialize export state values if not set
	$effect(() => {
		if (!globalState.getExportState.videoStartTime) {
			globalState.getExportState.videoStartTime = 0;
		}
		if (!globalState.getExportState.videoEndTime) {
			globalState.getExportState.videoEndTime = globalState.getAudioTrack.getDuration().ms || 0;
		}
	});

	$effect(() => {
		if (globalState.getExportState.exportRangeMode !== 'verse') return;
		const indexes = getVerseIndexesFromTime();
		verseStartIndex = indexes.start;
		verseEndIndex = indexes.end;
	});

	// Helper function to format duration for display
	function formatDuration(ms: number): string {
		const totalSeconds = Math.floor(ms / 1000);
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;

		if (hours > 0) {
			return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
		} else {
			return `${minutes}:${seconds.toString().padStart(2, '0')}`;
		}
	}

	/**
	 * Formate une plage sémantique avec une notation courte et sa durée réelle.
	 * @param {MeaningExportRange} range Plage sémantique à afficher.
	 * @returns {string} Libellé de plage accompagné de sa durée en secondes.
	 */
	function formatMeaningRangeLabel(range: MeaningExportRange): string {
		const [startSurah] = range.startKey.split(':');
		const [endSurah, endVerse] = range.endKey.split(':');
		const rangeLabel =
			startSurah === endSurah
				? `${range.startKey}-${endVerse}`
				: `${range.startKey}-${range.endKey}`;
		const durationSeconds = Math.max(0, range.durationMs) / 1000;
		const durationLabel = `${durationSeconds.toFixed(durationSeconds >= 10 ? 1 : 2)}s`;
		return `${rangeLabel} (${durationLabel})`;
	}
</script>

<!-- Export Video Configuration -->
<div
	class="flex h-full min-h-0 flex-col rounded-lg border border-color bg-secondary p-6 pb-2"
	transition:slide
>
	<div class="min-h-0 flex-1 overflow-y-auto -mx-6 px-6">
		<!-- Section Title -->
		<div class="mb-6">
			<h3 class="text-lg font-semibold text-primary mb-2">{$LL.export.exportVideo()}</h3>
			<p class="text-thirdly text-sm">
				{$LL.export.configureExportSettings()}
			</p>
		</div>

		<!-- Time Range Selection -->
		<div data-tour-id="export-range" class="mb-6">
			<h4 class="text-base font-medium text-secondary mb-3">{$LL.export.exportRange()}</h4>

			<div class="bg-accent rounded-lg p-4 border border-color">
				<div class="mb-4 grid grid-cols-3 gap-1 rounded-lg border border-color bg-primary p-1">
					<button
						type="button"
						class="rounded-md px-3 py-2 text-sm font-semibold transition-colors {globalState
							.getExportState.exportRangeMode === 'time'
							? 'bg-accent-primary text-[var(--text-on-accent)]'
							: 'text-secondary hover:bg-accent hover:text-primary'}"
						onclick={() => setExportRangeMode('time')}
					>
						{rangeCopy.timeRangeMode()}
					</button>
					<button
						type="button"
						class="rounded-md px-3 py-2 text-sm font-semibold transition-colors {globalState
							.getExportState.exportRangeMode === 'verse'
							? 'bg-accent-primary text-[var(--text-on-accent)]'
							: 'text-secondary hover:bg-accent hover:text-primary'}"
						onclick={() => setExportRangeMode('verse')}
					>
						{rangeCopy.verseRangeMode()}
					</button>
					<button
						type="button"
						class="rounded-md px-3 py-2 text-sm font-semibold transition-colors {globalState
							.getExportState.exportRangeMode === 'meaning'
							? 'bg-accent-primary text-[var(--text-on-accent)]'
							: 'text-secondary hover:bg-accent hover:text-primary'}"
						onclick={() => setExportRangeMode('meaning')}
					>
						{meaningCopy.meaningRangeMode()}
					</button>
				</div>

				{#if globalState.getExportState.exportRangeMode === 'time'}
					<p class="text-thirdly text-sm mb-4">{$LL.export.selectTimeRange()}</p>
					<div class="grid grid-cols-1 grid-rows-2 gap-4">
						<TimeInput
							label={$LL.export.startTime()}
							bind:value={globalState.getExportState.videoStartTime}
						/>
						<TimeInput
							label={$LL.export.endTime()}
							bind:value={globalState.getExportState.videoEndTime}
						/>
					</div>
				{:else if globalState.getExportState.exportRangeMode === 'meaning'}
					<p class="text-thirdly mb-4 text-sm">{meaningCopy.meaningRangeDescription()}</p>
					<div class="space-y-3">
						<div class="flex items-center justify-between gap-3">
							<label for="meaning-max-duration" class="text-sm text-secondary">
								{meaningCopy.maxDuration()}
							</label>
							<input
								id="meaning-max-duration"
								type="number"
								min="1"
								step="1"
								class="input h-10 w-28"
								value={globalState.getExportState.meaningMaxDurationSeconds}
								disabled={isGeneratingMeaningRanges}
								onchange={(event) =>
									setMeaningMaxDuration((event.currentTarget as HTMLInputElement).valueAsNumber)}
							/>
						</div>
						<p class="text-thirdly text-xs">{meaningCopy.maxDurationDescription()}</p>
						<label class="flex cursor-pointer items-start gap-2 text-sm text-secondary">
							<input
								type="checkbox"
								class="mt-0.5"
								checked={globalState.getExportState.includeAllMeaningVerses}
								disabled={isGeneratingMeaningRanges}
								onchange={(event) =>
									setIncludeAllMeaningVerses((event.currentTarget as HTMLInputElement).checked)}
							/>
							<span>
								<span class="block font-medium">{meaningCopy.includeAllMeaningVerses()}</span>
								<span class="mt-0.5 block text-xs text-thirdly">
									{meaningCopy.includeAllMeaningVersesDescription()}
									{' '}
									<strong class="font-semibold text-secondary">
										{meaningCopy.includeAllMeaningVersesRecommendation()}
									</strong>
								</span>
							</span>
						</label>
						<button
							type="button"
							class="inline-flex w-full items-center justify-center gap-2 rounded-md bg-accent-primary px-3 py-2 text-sm font-semibold text-[var(--text-on-accent)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
							disabled={isGeneratingMeaningRanges || globalState.getSubtitleClips.length === 0}
							onclick={() => void generateMeaningRanges()}
						>
							{isGeneratingMeaningRanges
								? meaningCopy.generatingMeaningRanges()
								: meaningCopy.generateMeaningRanges()}
						</button>
					</div>

					{#if meaningRanges.length > 0}
						<div class="mt-4 grid grid-cols-3 gap-2">
							{#each meaningRanges as range (range.id)}
								<button
									type="button"
									class="rounded-md border px-2 py-2 text-xs font-medium transition-colors {range.exceedsMaxDuration
										? 'border-red-500 bg-red-500/10 text-red-300 hover:bg-red-500/20'
										: 'border-color bg-secondary text-secondary hover:border-accent-primary hover:text-primary'} {selectedMeaningRangeId ===
										range.id || selectedMeaningRangeIds.includes(range.id)
										? 'ring-2 ring-accent-primary ring-offset-1 ring-offset-secondary'
										: ''}"
									aria-pressed={selectedMeaningRangeIds.includes(range.id)}
									title={range.exceedsMaxDuration ? meaningCopy.meaningRangeOverLimit() : undefined}
									onclick={(event) => selectMeaningRange(range, event)}
								>
									{formatMeaningRangeLabel(range)}
								</button>
							{/each}
						</div>
					{:else if !isGeneratingMeaningRanges}
						<p class="mt-4 text-thirdly text-sm">{meaningCopy.meaningRangesEmpty()}</p>
					{/if}

					{#if meaningSkippedRangeCount > 0}
						<p class="mt-2 text-xs text-thirdly">
							{meaningCopy.meaningRangesSkipped({ count: meaningSkippedRangeCount })}
						</p>
					{/if}
					{#if meaningMissingVerseCount > 0}
						<p class="mt-2 text-xs text-red-300">
							{meaningCopy.meaningRangesMissingVerses({ count: meaningMissingVerseCount })}
						</p>
					{/if}
				{:else if exportVerses.length > 0}
					<p class="text-thirdly text-sm mb-4">{rangeCopy.selectVerseRange()}</p>
					<div class="rounded-lg border border-color bg-secondary px-4 py-5">
						<div class="mb-5 text-center font-mono text-sm font-medium text-accent-primary">
							{rangeCopy.selectedVerseRange({
								start: exportVerses[verseStartIndex].key,
								end: exportVerses[verseEndIndex].key
							})}
						</div>
						<VerseRangeSlider
							verses={exportVerses}
							startIndex={verseStartIndex}
							endIndex={verseEndIndex}
							startLabel={$LL.export.startTime()}
							endLabel={$LL.export.endTime()}
							onStartInput={handleVerseStartInput}
							onEndInput={handleVerseEndInput}
							onDragStart={beginVerseRangeChange}
							onDragEnd={commitVerseRangeChange}
						/>
					</div>
				{:else}
					<p class="text-thirdly text-sm">{$LL.editor.noSubtitleFallback()}</p>
				{/if}

				{#if globalState.getExportState.exportRangeMode === 'meaning' && selectedMeaningRangeIds.length === 1 && exportVerses.length > 0}
					<div class="mt-3 rounded-lg border border-color bg-secondary px-4 py-5">
						<div class="mb-5 text-center font-mono text-sm font-medium text-accent-primary">
							{rangeCopy.selectedVerseRange({
								start: exportVerses[verseStartIndex].key,
								end: exportVerses[verseEndIndex].key
							})}
						</div>
						<VerseRangeSlider
							verses={exportVerses}
							startIndex={verseStartIndex}
							endIndex={verseEndIndex}
							startLabel={$LL.export.startTime()}
							endLabel={$LL.export.endTime()}
							onStartInput={handleVerseStartInput}
							onEndInput={handleVerseEndInput}
							onDragStart={beginVerseRangeChange}
							onDragEnd={commitVerseRangeChange}
						/>
					</div>
				{:else if globalState.getExportState.exportRangeMode !== 'meaning'}
					<div class="mt-3 flex flex-col items-center justify-between">
						<button
							type="button"
							class="w-full inline-flex items-center gap-1.5 rounded-md border border-violet-500/40 bg-violet-500/10 px-2.5 py-1 text-xs font-medium text-violet-300 transition-colors hover:bg-violet-500/20"
							onclick={addSkipRange}
						>
							<span class="material-icons text-[17px]!">add</span>
							{skipCopy.addSkip()}
						</button>

						{#if (globalState.getExportState.skipRanges ?? []).length > 0}
							<div class="mt-3 space-y-2 w-full">
								{#each globalState.getExportState.skipRanges ?? [] as range, index}
									<div class="rounded-md border border-violet-500/35 bg-violet-500/10 p-2.5">
										<div class="mb-2 flex items-center justify-between gap-2">
											<span class="text-xs font-medium text-violet-300">
												{skipCopy.skip()}
												{index + 1} · {formatDuration(range.startTime)}–{formatDuration(
													range.endTime
												)}
											</span>
											<button
												type="button"
												class="material-icons rounded p-0.5 text-base text-thirdly transition-colors hover:bg-violet-500/20 hover:text-violet-300"
												title={skipCopy.removeSkip()}
												onclick={() => removeSkipRange(index)}>close</button
											>
										</div>
										<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
											<button
												type="button"
												class="rounded border border-violet-500/30 bg-secondary px-2 py-1.5 text-xs text-secondary transition-colors hover:border-violet-400 hover:text-violet-300"
												onclick={() => setSkipBoundary(range, 'start')}
											>
												{skipCopy.setSkipStartToCursor()}
											</button>
											<button
												type="button"
												class="rounded border border-violet-500/30 bg-secondary px-2 py-1.5 text-xs text-secondary transition-colors hover:border-violet-400 hover:text-violet-300"
												onclick={() => setSkipBoundary(range, 'end')}
											>
												{skipCopy.setSkipEndToCursor()}
											</button>
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/if}

				<!-- Export summary -->
				<div class="mt-4 space-y-3 rounded-lg border border-color bg-secondary p-3">
					<div class="flex items-center justify-between text-sm">
						<span class="text-secondary">{$LL.export.exportDuration()}</span>
						<span class="text-accent-primary font-medium">
							{formatDuration(
								Math.max(
									0,
									(globalState.getExportState.videoEndTime || 0) -
										(globalState.getExportState.videoStartTime || 0)
								)
							)}
						</span>
					</div>

					<div class="flex items-center justify-between border-t border-color pt-3 text-sm">
						<span class="text-secondary min-w-[150px]">{$LL.export.exportVerseRange()}</span>
						<span class="text-accent-primary font-medium">
							{VerseRange.getExportVerseRange().toString()}
						</span>
					</div>
				</div>
			</div>
		</div>

		<div class="mb-6">
			<h4 class="text-base font-medium text-secondary mb-3">
				{$LL.export.videoQualityOrientation()}
			</h4>
			<div class="bg-accent rounded-lg p-4 border border-color">
				<p class="text-thirdly text-sm mb-4">
					{$LL.export.setResolutionOrientation()}
				</p>

				<Style
					style={globalState.getStyle('global', 'video-dimension')!}
					target="global"
					applyValueSimple={(v) => {
						globalState.getStyle('global', 'video-dimension')!.value = v as {
							width: number;
							height: number;
						};
					}}
					disabled={false}
				/>
			</div>
		</div>

		<div class="mb-6">
			<h4 class="text-base font-medium text-secondary mb-3">{$LL.export.videoAudioFade()}</h4>
			<div class="bg-accent rounded-lg p-4 border border-color">
				<p class="text-thirdly text-sm mb-4">
					{$LL.export.enableDisableFade()}
				</p>

				<Style
					style={globalState.getStyle('global', 'video-and-audio-fade')!}
					target="global"
					applyValueSimple={(v) => {
						globalState.getStyle('global', 'video-and-audio-fade')!.value = v as FadeValue;
					}}
					disabled={false}
				/>
			</div>
		</div>

		<div class="mb-6">
			<h4 class="text-base font-medium text-secondary mb-3">{$LL.export.performanceSettings()}</h4>
			<div class="bg-accent rounded-lg p-4 border border-color">
				<div class="flex flex-col gap-3">
					<p class="text-thirdly text-sm leading-snug">
						{$LL.export.setFpsDescription()}
					</p>
					<input
						type="number"
						min="5"
						max="60"
						step="1"
						class="input w-full h-10"
						bind:value={globalState.getExportState.fps}
					/>
				</div>
			</div>
		</div>

		<!-- Video Filename & Export Location -->
		<div class="mb-6">
			<h4 class="text-base font-medium text-secondary mb-3">{$LL.export.videoFileName()}</h4>
			<div class="bg-accent rounded-lg p-4 border border-color">
				<div class="flex flex-col gap-6">
					<div>
						<p class="text-thirdly text-sm mb-4">
							{$LL.export.enterFileName()}
						</p>

						<div class="flex flex-col gap-2">
							<input
								type="text"
								class="input w-full"
								placeholder={globalState.currentProject?.detail.generateExportFileName()}
								bind:value={globalState.getExportState.customFileName}
								onfocus={() => {
									if (!globalState.getExportState.customFileName.trim()) {
										globalState.getExportState.customFileName =
											globalState.currentProject?.detail.generateExportFileName() ?? '';
									}
								}}
							/>
							<p class="text-thirdly text-xs italic">
								{$LL.export.extensionAddedAutomatically()}
							</p>
						</div>
					</div>

					<div class="border-t border-color pt-4">
						<ExportFolderPicker description={$LL.export.chooseExportLocation()} />
					</div>
				</div>
			</div>
		</div>

		<section class="mb-6">
			<h4 class="text-base font-medium text-secondary mb-3">
				{$LL.export.recitationContent()}
			</h4>
			<div class="rounded-lg border border-color bg-secondary p-4 bg-accent">
				<label class="flex items-start gap-3 cursor-pointer select-none">
					<input
						type="checkbox"
						class="mt-0.5 h-4 w-4 rounded border border-color bg-secondary accent-[var(--accent-primary)]"
						checked={globalState.getExportState.exportOnlyRecitation}
						onchange={(event) =>
							setExportOnlyRecitation((event.currentTarget as HTMLInputElement).checked)}
					/>
					<span class="text-sm text-primary">
						{$LL.export.exportOnlyRecitation()}
						<span class="block text-xs text-thirdly mt-1">
							{$LL.export.exportOnlyRecitationDescription()}
						</span>
					</span>
				</label>

				{#if globalState.getExportState.exportOnlyRecitation}
					<div class="mt-4 border-t border-color pt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div>
							<label
								class="block text-sm font-medium text-primary mb-2 sm:min-h-10"
								for="recitation-cut-margin"
							>
								{$LL.export.recitationCutMargin()}
							</label>
							<input
								id="recitation-cut-margin"
								type="number"
								min="0"
								step="50"
								class="input w-full h-10"
								value={globalState.getExportState.recitationCutMarginMs}
								onchange={(event) =>
									setRecitationCutMargin((event.currentTarget as HTMLInputElement).valueAsNumber)}
							/>
							<p class="text-xs text-thirdly mt-2">
								{$LL.export.recitationCutMarginDescription()}
							</p>
						</div>
						<div>
							<label
								class="block text-sm font-medium text-primary mb-2 sm:min-h-10"
								for="recitation-minimum-silence"
							>
								{$LL.export.recitationMinimumSilence()}
							</label>
							<input
								id="recitation-minimum-silence"
								type="number"
								min="0"
								step="100"
								class="input w-full h-10"
								value={globalState.getExportState.recitationMinimumSilenceMs}
								onchange={(event) =>
									setRecitationMinimumSilence(
										(event.currentTarget as HTMLInputElement).valueAsNumber
									)}
							/>
							<p class="text-xs text-thirdly mt-2">
								{$LL.export.recitationMinimumSilenceDescription()}
							</p>
						</div>
					</div>
				{/if}
			</div>
		</section>

		<section class="mb-6">
			<h4 class="text-base font-medium text-secondary mb-3">
				{promotionCopy.quranCaptionPromotion()}
			</h4>
			<div class="rounded-lg border border-color bg-secondary p-4 bg-accent">
				<label class="flex items-start gap-3 cursor-pointer select-none">
					<input
						type="checkbox"
						class="mt-0.5 h-4 w-4 rounded border border-color bg-secondary accent-[var(--accent-primary)]"
						checked={globalState.getExportState.includeQuranCaptionPromotion}
						onchange={(event) =>
							setQuranCaptionPromotionEnabled((event.currentTarget as HTMLInputElement).checked)}
					/>
					<span class="text-sm text-primary">
						{promotionCopy.addQuranCaptionPromotion()}
						<span class="block text-xs text-thirdly mt-1">
							{promotionCopy.quranCaptionPromotionDescription()}
						</span>
					</span>
				</label>

				{#if globalState.getExportState.includeQuranCaptionPromotion}
					<div class="mt-4 border-t border-color pt-4">
						<label
							class="block text-sm font-medium text-primary mb-2"
							for="quran-caption-promotion-position"
						>
							{promotionCopy.quranCaptionPromotionPosition()}
						</label>
						<select
							id="quran-caption-promotion-position"
							class="input w-full"
							value={globalState.getExportState.quranCaptionPromotionPosition}
							onchange={(event) =>
								setQuranCaptionPromotionPosition(
									(event.currentTarget as HTMLSelectElement).value as 'start' | 'end'
								)}
						>
							<option value="start">{promotionCopy.quranCaptionPromotionAtStart()}</option>
							<option value="end">{promotionCopy.quranCaptionPromotionAtEnd()}</option>
						</select>
					</div>
				{/if}
			</div>
		</section>

		<div class="mt-5">
			<button
				type="button"
				class="w-full flex items-center justify-between rounded-lg border border-color bg-accent px-4 py-3 text-left transition-colors hover:bg-primary/60"
				onclick={() => {
					showAdvancedSettings = !showAdvancedSettings;
				}}
				aria-expanded={showAdvancedSettings}
			>
				<div>
					<p class="text-sm font-medium text-primary">{$LL.export.advancedSettings()}</p>
					<p class="text-xs text-thirdly">
						{$LL.export.controlExportPerformance()}
					</p>
				</div>
				<span
					class="material-icons text-secondary transition-transform duration-200"
					style={`transform: rotate(${showAdvancedSettings ? 180 : 0}deg);`}
				>
					expand_more
				</span>
			</button>

			{#if showAdvancedSettings}
				<div class="mt-3 rounded-lg border border-color bg-accent p-4" transition:slide>
					<div class="mb-4">
						<h4 class="text-base font-medium text-secondary mb-1">
							{$LL.export.exportPerformance()}
						</h4>
						<p class="text-thirdly text-sm">
							{$LL.export.chooseCpuUsage()}
						</p>
					</div>

					{#if globalState.settings}
						<div class="mb-4 rounded-lg border border-color bg-secondary p-4">
							<label
								class="block text-sm font-medium text-primary mb-2"
								for="parallel-capture-workers"
							>
								{$LL.export.parallelCaptureWorkers()}
							</label>
							<input
								id="parallel-capture-workers"
								type="number"
								min="1"
								max="8"
								step="1"
								class="input w-full h-10"
								bind:value={globalState.settings.exportSettings.parallelCaptureWorkers}
								onchange={saveParallelCaptureWorkers}
							/>
							<p class="text-xs text-thirdly mt-2">
								{$LL.export.parallelCaptureWorkersDescription()}
							</p>
						</div>

						<div class="mb-4 rounded-lg border border-color bg-secondary p-4">
							<label class="block text-sm font-medium text-primary mb-2" for="video-codec">
								{$LL.export.videoCodec()}
							</label>
							<select
								id="video-codec"
								class="input w-full"
								bind:value={globalState.settings.exportSettings.videoCodec}
								disabled={globalState.getExportState.exportWithoutBackground}
								onchange={() => void Settings.save()}
							>
								{#each videoCodecIds as codec (codec)}
									<option value={codec}>
										{codec === 'h264'
											? $LL.export.h264Compatibility()
											: $LL.export.h265SmallerFiles()}
									</option>
								{/each}
							</select>
							<p class="text-xs text-thirdly mt-2">
								{$LL.export.videoCodecDescription()}
							</p>
						</div>

						<div class="grid grid-cols-1 gap-3">
							{#each performanceProfileIds as id (id)}
								{@const label =
									id === 'fastest'
										? $LL.export.fastest()
										: id === 'balanced'
											? $LL.export.balanced()
											: $LL.export.lowCpu()}
								{@const desc =
									id === 'fastest'
										? $LL.export.fastestDescription()
										: id === 'balanced'
											? $LL.export.balancedDescription()
											: $LL.export.lowCpuDescription()}
								<button
									type="button"
									class="rounded-xl border p-4 text-left transition-colors"
									class:border-accent-primary={globalState.settings.exportSettings
										.performanceProfile === id}
									class:bg-secondary={globalState.settings.exportSettings.performanceProfile === id}
									class:border-color={globalState.settings.exportSettings.performanceProfile !== id}
									onclick={() => void savePerformanceProfile(id)}
								>
									<div class="flex items-center justify-between gap-3">
										<p class="text-sm font-medium text-primary">{label}</p>
										{#if globalState.settings.exportSettings.performanceProfile === id}
											<span class="material-icons text-accent-primary text-lg">check_circle</span>
										{/if}
									</div>
									<p class="mt-1 text-xs text-thirdly">{desc}</p>
								</button>
							{/each}
						</div>
					{/if}

					<div class="mb-4 mt-4">
						<h4 class="text-base font-medium text-secondary mb-1">{$LL.export.background()}</h4>
						<label class="mt-2 flex cursor-pointer select-none items-start gap-3">
							<input
								type="checkbox"
								class="mt-0.5 h-4 w-4 rounded border border-color bg-secondary accent-[var(--accent-primary)] disabled:cursor-not-allowed"
								disabled={globalState.getExportState.exportWithoutBackground}
								checked={globalState.getExportState.addRandomBackground}
								onchange={(event) =>
									setAddRandomBackground((event.currentTarget as HTMLInputElement).checked)}
							/>
							<span class="text-sm text-primary">
								{randomBackgroundCopy.addRandomBackground()}
								<span class="mt-1 block text-xs text-thirdly">
									{randomBackgroundCopy.addRandomBackgroundDescription()}
								</span>
							</span>
						</label>

						{#if globalState.getExportState.addRandomBackground}
							<div class="mt-3 space-y-2">
								<button
									type="button"
									class="btn-accent w-full px-3 py-2 text-sm"
									onclick={() => void selectRandomBackgroundFolder()}
								>
									<span class="material-icons-outlined mr-2 align-middle text-base"
										>folder_open</span
									>
									{randomBackgroundCopy.selectRandomBackgroundFolder()}
								</button>
								{#if globalState.settings?.exportSettings.randomBackgroundFolder}
									<p
										class="break-all text-xs text-secondary"
										title={globalState.settings.exportSettings.randomBackgroundFolder}
									>
										{globalState.settings.exportSettings.randomBackgroundFolder}
									</p>
								{/if}
								<p class="text-xs text-thirdly">
									{randomBackgroundCopy.randomBackgroundFolderDescription()}
								</p>
							</div>
						{/if}

						<label class="mt-2 flex items-start gap-3 cursor-pointer select-none">
							<input
								type="checkbox"
								class="mt-0.5 h-4 w-4 rounded border border-color bg-secondary accent-[var(--accent-primary)]"
								bind:checked={globalState.getExportState.exportWithoutBackground}
							/>
							<span class="text-sm text-primary">
								{$LL.export.exportWithoutBackground()}
								<span class="block text-xs text-thirdly mt-1">
									{$LL.export.rendersOnlyOverlay()}
								</span>
							</span>
						</label>

						{#if globalState.getExportState.exportWithoutBackground}
							<div class="">
								<label class="block text-sm text-primary mb-2" for="transparent-export-format">
									{$LL.export.transparentExportFormat()}
								</label>
								<select
									id="transparent-export-format"
									class="input w-full"
									bind:value={globalState.getExportState.transparentExportFormat}
								>
									<option value="mov_prores_4444">{$LL.export.movQtrleRecommended()}</option>
									<option value="webm_vp9_alpha">{$LL.export.webmVp9()}</option>
								</select>
								<p class="text-xs text-thirdly mt-2">
									{$LL.export.movQtrleCompatibility()}
								</p>
							</div>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	</div>

	<!-- Export Button -->
	<div class="flex flex-shrink-0 flex-col items-center border-t border-color pt-2">
		<button class="btn-accent px-6 py-3 font-medium" onclick={() => void startVideoExport()}>
			{globalState.getExportState.exportRangeMode === 'meaning' &&
			selectedMeaningRangeIds.length > 1
				? meaningCopy.exportAll()
				: $LL.export.exportButton()}
		</button>
		<p class="text-thirdly text-xs mt-2 text-center">
			{$LL.export.startExportDescription()}
		</p>
	</div>
</div>
