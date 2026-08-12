<script lang="ts">
	import { listen, type UnlistenFn } from '@tauri-apps/api/event';
	import { onDestroy, onMount } from 'svelte';
	import toast from 'svelte-5-french-toast';

	import AiMetricsGrid from '../translationsEditor/modal/shared/AiMetricsGrid.svelte';
	import TranslationsEditorModalShell from '../translationsEditor/modal/shared/TranslationsEditorModalShell.svelte';
	import type { AdvancedTrimUsage } from '$lib/services/AdvancedAITrimming';
	import {
		applyAiSubtitleSplitValidationSuccess,
		buildAiSubtitleSplitBatches,
		buildAiSubtitleSplitCandidates,
		runAiSubtitleSplitBatchStreaming,
		validateAiSubtitleSplitBatchResult,
		type AiSubtitleSplitCandidate
	} from '$lib/services/AiSubtitleSplittingService';
	import { globalState } from '$lib/runes/main.svelte';
	import { getSubtitleClipWordCount } from '$lib/services/AutoSegmentation';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';

	type ActivityEntry = {
		id: string;
		step: string;
		message: string;
		tone: 'info' | 'success' | 'error';
	};
	type StatusEventPayload = {
		batchId: string;
		step: string;
		message: string;
	};
	type ChunkEventPayload = {
		batchId: string;
		delta: string;
		kind: string;
	};
	type CompleteEventPayload = {
		batchId: string;
		rawText: string;
		usage?: AdvancedTrimUsage;
	};

	let { close }: { close: () => void } = $props();
	let panelScale = $derived(
		1 + (globalState.settings?.persistentUiState.editorPanelScalePercent ?? -15) / 100
	);

	const AI_SPLIT_MIN_WORDS = 1;
	const AI_SPLIT_MAX_WORDS = 30;
	let maxWords = $derived(globalState.getSubtitlesEditorState.aiSemanticSplitMaxWords);

	let candidates: AiSubtitleSplitCandidate[] = $state([]);
	let isLoadingCandidates = $state(true);
	let isRunning = $state(false);
	let completedBatches = $state(0);
	let successfulBatches = $state(0);
	let successfulSegments = $state(0);
	let failedSegments = $state(0);
	let appliedSplits = $state(0);
	let currentBatchId = $state('');
	let streamedResponse = $state('');
	let latestSummary = $state('');
	let activityLog: ActivityEntry[] = $state([]);
	let batchUsageById: Record<string, AdvancedTrimUsage> = $state({});
	let unlistenFns: UnlistenFn[] = [];
	let activeBatchIds = new Set<string>();
	let activityCounter = 0;
	let candidatesRequestId = 0;

	const batches = $derived(buildAiSubtitleSplitBatches(candidates));
	const totalWords = $derived(
		candidates.reduce((total, candidate) => total + candidate.wordCount, 0)
	);
	const resultingChunks = $derived(
		candidates.reduce(
			(total, candidate) => total + Math.ceil(candidate.wordCount / candidate.maxWords),
			0
		)
	);
	const missingWbwCount = $derived(
		globalState.getSubtitleClips.filter(
			(subtitle) => getSubtitleClipWordCount(subtitle) > maxWords && !subtitle.alignmentMetadata
		).length
	);

	/**
	 * Ajoute une entrée au journal d'activité.
	 *
	 * @param {string} step Étape concernée.
	 * @param {string} message Message à afficher.
	 * @param {'info' | 'success' | 'error'} tone Ton visuel.
	 * @returns {void}
	 */
	function addActivity(
		step: string,
		message: string,
		tone: 'info' | 'success' | 'error' = 'info'
	): void {
		activityCounter++;
		activityLog = [
			{ id: `ai-subtitle-split-activity-${activityCounter}`, step, message, tone },
			...activityLog
		].slice(0, 80);
	}

	/**
	 * Réinitialise les compteurs avant une nouvelle exécution.
	 *
	 * @returns {void}
	 */
	function resetRunState(): void {
		completedBatches = 0;
		successfulBatches = 0;
		successfulSegments = 0;
		failedSegments = 0;
		appliedSplits = 0;
		currentBatchId = '';
		streamedResponse = '';
		latestSummary = '';
		activityLog = [];
		batchUsageById = {};
		activeBatchIds = new Set<string>();
	}

	/**
	 * Reçoit les changements d'état du streaming actif.
	 *
	 * @param {{payload: StatusEventPayload}} event Événement Tauri.
	 * @returns {void}
	 */
	function handleStatusEvent(event: { payload: StatusEventPayload }): void {
		const payload = event.payload;
		if (!activeBatchIds.has(payload.batchId)) return;
		addActivity(payload.step, payload.message, payload.step === 'failed' ? 'error' : 'info');
	}

	/**
	 * Accumule uniquement les fragments JSON de la réponse active.
	 *
	 * @param {{payload: ChunkEventPayload}} event Événement Tauri.
	 * @returns {void}
	 */
	function handleChunkEvent(event: { payload: ChunkEventPayload }): void {
		const payload = event.payload;
		if (
			!activeBatchIds.has(payload.batchId) ||
			payload.batchId !== currentBatchId ||
			payload.kind !== 'response'
		) {
			return;
		}
		streamedResponse += payload.delta;
	}

	/**
	 * Enregistre le JSON final et l'usage du lot terminé.
	 *
	 * @param {{payload: CompleteEventPayload}} event Événement Tauri.
	 * @returns {void}
	 */
	function handleCompleteEvent(event: { payload: CompleteEventPayload }): void {
		const payload = event.payload;
		if (!activeBatchIds.has(payload.batchId)) return;
		if (payload.batchId === currentBatchId) streamedResponse = payload.rawText;
		if (payload.usage) {
			batchUsageById = { ...batchUsageById, [payload.batchId]: payload.usage };
		}
	}

	/**
	 * Calcule le pourcentage de lots terminés.
	 *
	 * @returns {number} Progression arrondie entre 0 et 100.
	 */
	function getProgressPercent(): number {
		return batches.length === 0 ? 0 : Math.round((completedBatches / batches.length) * 100);
	}

	/**
	 * Résume les tokens réellement déclarés par le fournisseur.
	 *
	 * @returns {string} Résumé localisé de l'usage.
	 */
	function getActualUsageSummary(): string {
		const usageList = Object.values(batchUsageById);
		if (usageList.length === 0) return get(LL).editor.usageUnavailable();
		return get(LL).editor.tokenUsageSummary({
			input: usageList.reduce((total, item) => total + (item.inputTokens ?? 0), 0),
			output: usageList.reduce((total, item) => total + (item.outputTokens ?? 0), 0),
			total: usageList.reduce((total, item) => total + (item.totalTokens ?? 0), 0)
		});
	}

	/**
	 * Met à jour la limite de mots propre au découpage IA.
	 *
	 * @param {number} value Nouvelle limite demandée.
	 * @returns {void}
	 */
	function updateMaxWords(value: number): void {
		globalState.getSubtitlesEditorState.aiSemanticSplitMaxWords = Math.min(
			AI_SPLIT_MAX_WORDS,
			Math.max(AI_SPLIT_MIN_WORDS, Number.isFinite(value) ? Math.round(value) : 5)
		);
	}

	/**
	 * Charge les sous-titres éligibles et leurs mots Quran indexés.
	 *
	 * @param {number} requestedMaxWords Limite de mots utilisée pour cette requête.
	 * @returns {Promise<void>} Résolution une fois la liste prête.
	 */
	async function loadCandidates(requestedMaxWords: number): Promise<void> {
		const requestId = ++candidatesRequestId;
		isLoadingCandidates = true;
		candidates = [];
		try {
			const loadedCandidates = await buildAiSubtitleSplitCandidates(requestedMaxWords);
			if (requestId !== candidatesRequestId) return;
			candidates = loadedCandidates;
		} catch (error) {
			if (requestId !== candidatesRequestId) return;
			candidates = [];
			addActivity('failed', error instanceof Error ? error.message : String(error), 'error');
		} finally {
			if (requestId === candidatesRequestId) isLoadingCandidates = false;
		}
	}

	/**
	 * Exécute les lots IA, valide leurs limites puis applique les coupes sûres.
	 *
	 * @returns {Promise<void>} Résolution une fois tous les lots traités.
	 */
	async function runAiSubtitleSplit(): Promise<void> {
		if (isRunning) return;
		const apiKey = globalState.settings!.aiTranslationSettings.openAiApiKey.trim();
		if (!apiKey) {
			toast.error(get(LL).translations.configureAiKeyFirst());
			return;
		}
		const endpoint = globalState.settings!.aiTranslationSettings.textAiApiEndpoint.trim();
		if (!endpoint) {
			toast.error(get(LL).translations.configureTextAiFirst());
			return;
		}
		if (batches.length === 0) {
			toast.error(get(LL).editor.noSubtitlesMatchSplitRules());
			return;
		}

		const runBatches = [...batches];
		resetRunState();
		isRunning = true;
		activeBatchIds = new Set(runBatches.map((batch) => batch.batchId));
		addActivity(
			'queued',
			get(LL).editor.aiSemanticSplitStarting({
				segments: candidates.length,
				batches: runBatches.length
			})
		);

		for (let batchIndex = 0; batchIndex < runBatches.length; batchIndex++) {
			const batch = runBatches[batchIndex];
			currentBatchId = batch.batchId;
			streamedResponse = '';
			const label = get(LL).editor.batchProgress({
				current: batchIndex + 1,
				total: runBatches.length
			});
			addActivity(
				'queued',
				get(LL).editor.aiSemanticSplitBatchQueued({
					label,
					segments: batch.segments.length,
					words: batch.wordCount
				})
			);

			try {
				const response = await runAiSubtitleSplitBatchStreaming({
					apiKey,
					endpoint,
					model: globalState.settings!.aiTranslationSettings.advancedTrimModel,
					reasoningEffort: globalState.settings!.aiTranslationSettings.advancedTrimReasoningEffort,
					batchId: batch.batchId,
					batch: batch.request
				});
				streamedResponse = response.rawText;
				addActivity('validating', get(LL).editor.validatingBatch({ label }));

				const validation = validateAiSubtitleSplitBatchResult(batch, response.parsed);
				const applyReport = await applyAiSubtitleSplitValidationSuccess(validation.validSegments);
				const validationFailures = batch.segments.length - validation.validSegments.length;
				const batchFailures = validationFailures + applyReport.erroredSegments;
				successfulSegments += applyReport.appliedSegments;
				failedSegments += batchFailures;
				appliedSplits += applyReport.appliedSplits;
				if (batchFailures === 0) successfulBatches++;

				if (applyReport.appliedSegments > 0) {
					addActivity(
						'applied',
						get(LL).editor.aiSemanticSplitAppliedSegments({
							applied: applyReport.appliedSegments,
							total: batch.segments.length
						}),
						'success'
					);
				}
				for (const error of [...validation.errors, ...applyReport.errors]) {
					addActivity('failed', error, 'error');
				}
			} catch (error) {
				failedSegments += batch.segments.length;
				addActivity('failed', error instanceof Error ? error.message : String(error), 'error');
			}
			completedBatches = batchIndex + 1;
		}

		isRunning = false;
		activeBatchIds = new Set<string>();
		latestSummary = get(LL).editor.aiSemanticSplitRunSummary({
			successful: successfulSegments,
			total: candidates.length,
			failed: failedSegments,
			splits: appliedSplits
		});
		if (failedSegments > 0) toast.error(get(LL).editor.aiSemanticSplitCompletedWithIssues());
		else toast.success(get(LL).editor.aiSemanticSplitApplied({ count: appliedSplits }));
	}

	onMount(async () => {
		unlistenFns = [
			await listen('advanced-ai-subtitle-split-status', handleStatusEvent),
			await listen('advanced-ai-subtitle-split-chunk', handleChunkEvent),
			await listen('advanced-ai-subtitle-split-complete', handleCompleteEvent)
		];
	});

	onDestroy(() => {
		candidatesRequestId++;
		for (const unlisten of unlistenFns) unlisten();
		unlistenFns = [];
	});

	$effect(() => {
		void loadCandidates(maxWords);
	});
</script>

<TranslationsEditorModalShell
	{close}
	title={$LL.editor.aiSemanticSplitAssistant()}
	icon="call_split"
	{panelScale}
	shellClass="h-[90dvh] w-full"
	bodyClass="flex min-h-0 flex-1 flex-col overflow-y-auto"
	workspace={{
		configuration: {
			title: $LL.editor.configuration(),
			description: $LL.editor.aiSemanticSplitExplanation(),
			icon: 'auto_fix_high'
		},
		provider: {
			title: $LL.editor.aiProvider(),
			description: $LL.editor.aiProviderConfigHint(),
			currentModelLabel: $LL.editor.currentModel(),
			model: globalState.settings!.aiTranslationSettings.advancedTrimModel,
			endpointLabel: $LL.editor.endpoint(),
			endpoint: globalState.settings!.aiTranslationSettings.textAiApiEndpoint,
			notSetLabel: $LL.editor.notSet()
		},
		run: {
			title: $LL.editor.run(),
			description: $LL.editor.aiSemanticSplitRunDescription(),
			buttonLabel: isRunning
				? $LL.editor.runningAiSemanticSplit()
				: isLoadingCandidates
					? $LL.editor.loadingSegments()
					: $LL.editor.runAiSemanticSplit(),
			disabled: isRunning || isLoadingCandidates || batches.length === 0,
			onclick: runAiSubtitleSplit
		},
		status: {
			title: isRunning
				? $LL.editor.aiSemanticSplitInProgress()
				: $LL.editor.latestAiSemanticSplitRun(),
			subtitle: isRunning
				? $LL.editor.batchProgress({ current: completedBatches, total: batches.length })
				: latestSummary || $LL.editor.noSummaryYet(),
			progressPercent: getProgressPercent(),
			metrics: [
				{ label: $LL.editor.successfulSegments(), value: successfulSegments },
				{ label: $LL.editor.failedSegments(), value: failedSegments },
				{ label: $LL.editor.successfulBatches(), value: successfulBatches },
				{ label: $LL.editor.usage(), value: getActualUsageSummary() }
			]
		},
		activityLog,
		activityTitle: $LL.editor.recentActivity(),
		activityMaxHeightClass: 'max-h-[360px]'
	}}
>
	{#snippet subtitle()}
		{$LL.editor.aiSemanticSplitDescription()}
	{/snippet}

	{#snippet configurationFields()}
		<div class="rounded-xl border border-color bg-secondary p-4">
			<div class="mb-4 flex items-center gap-2">
				<span class="material-icons text-accent-primary">analytics</span>
				<h3 class="text-lg font-semibold text-primary">{$LL.editor.batchPreview()}</h3>
			</div>
			<AiMetricsGrid
				items={[
					{ label: $LL.editor.segments(), value: candidates.length },
					{ label: $LL.editor.words(), value: totalWords },
					{ label: $LL.editor.batches(), value: batches.length },
					{ label: $LL.editor.resultingChunks(), value: resultingChunks }
				]}
				columnsClass="grid-cols-2"
			/>
		</div>

		{#if missingWbwCount > 0}
			<div
				class="rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
			>
				{$LL.editor.aiSemanticSplitMissingWbw({ count: missingWbwCount })}
			</div>
		{/if}

		<div class="rounded-xl border border-color bg-secondary px-4 py-4 space-y-3">
			<div class="flex items-center justify-between gap-3">
				<label for="ai-split-max-words" class="text-sm font-semibold text-primary">
					{$LL.editor.maxWordsPerSegment()}
				</label>
				<input
					id="ai-split-max-words"
					type="number"
					min={AI_SPLIT_MIN_WORDS}
					max={AI_SPLIT_MAX_WORDS}
					value={maxWords}
					disabled={isRunning}
					onchange={(event) => updateMaxWords(Number((event.target as HTMLInputElement).value))}
					class="w-20 rounded-md border border-color bg-accent px-2 py-1 text-sm text-primary disabled:opacity-50"
				/>
			</div>
			<input
				type="range"
				min={AI_SPLIT_MIN_WORDS}
				max={AI_SPLIT_MAX_WORDS}
				step="1"
				value={maxWords}
				disabled={isRunning}
				onchange={(event) => updateMaxWords(Number((event.target as HTMLInputElement).value))}
				class="w-full disabled:opacity-50"
			/>
			<div class="flex items-center justify-between text-[10px] text-thirdly">
				<span>{AI_SPLIT_MIN_WORDS}</span>
				<span>{AI_SPLIT_MAX_WORDS}</span>
			</div>
		</div>
	{/snippet}

	{#snippet afterStatus()}
		{#if streamedResponse}
			<div class="rounded-xl border border-color bg-secondary p-4">
				<div class="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-thirdly">
					{$LL.editor.latestStreamedJson()}
				</div>
				<div
					class="max-h-48 overflow-y-auto rounded-lg border border-color bg-accent px-3 py-2 text-[12px] leading-5 [font-family:Consolas,monospace]"
				>
					<pre class="whitespace-pre-wrap break-words text-secondary">{streamedResponse}</pre>
				</div>
			</div>
		{/if}
	{/snippet}
</TranslationsEditorModalShell>
