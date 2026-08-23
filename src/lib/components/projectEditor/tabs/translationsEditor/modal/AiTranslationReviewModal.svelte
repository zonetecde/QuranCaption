<script lang="ts">
	import { listen, type UnlistenFn } from '@tauri-apps/api/event';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import {
		applyAiTranslationReviewIssues,
		buildAiTranslationReviewBatches,
		buildAiTranslationReviewCandidates,
		runAiTranslationReviewBatch,
		validateAiTranslationReviewBatchResult,
		type AiTranslationReviewIssue
	} from '$lib/services/AiTranslationReviewService';
	import type { AdvancedTrimUsage } from '$lib/services/AdvancedAITrimming';
	import {
		AiStreamChunkBuffer,
		runAiWorkerPool,
		type AiStreamChunkKind,
		type AiStreamChunkUpdate,
		type AiStreamWorker
	} from '$lib/services/AiWorkerPool';
	import { onDestroy, onMount } from 'svelte';
	import { get } from 'svelte/store';
	import toast from 'svelte-5-french-toast';
	import AiStreamingWorkerGrid from './shared/AiStreamingWorkerGrid.svelte';
	import TranslationsEditorModalShell from './shared/TranslationsEditorModalShell.svelte';

	type ActivityTone = 'info' | 'success' | 'error';
	type ActivityEntry = {
		id: string;
		batchId: string;
		step: string;
		message: string;
		tone: ActivityTone;
	};
	type StatusEventPayload = { batchId: string; step: string };
	type ChunkEventPayload = { batchId: string; delta: string; kind: AiStreamChunkKind };

	const AI_TRANSLATION_REVIEW_WORKER_COUNT = 3;
	let { close }: { close: () => void } = $props();

	let maxBatchWords = $state(500);
	let isRunning = $state(false);
	let completedBatches = $state(0);
	let successfulBatches = $state(0);
	let failedSegments = $state(0);
	let markedSegments = $state(0);
	let workers: AiStreamWorker[] = $state(createIdleWorkers());
	let latestSummary = $state('');
	let activityLog: ActivityEntry[] = $state([]);
	let batchUsageById: Record<string, AdvancedTrimUsage> = $state({});
	let unlistenFns: UnlistenFn[] = [];
	let activityCounter = 0;
	let activeBatchIds = new Set<string>();
	const chunkBuffer = new AiStreamChunkBuffer(applyBufferedChunks);

	const candidates = $derived(buildAiTranslationReviewCandidates());
	const batches = $derived(buildAiTranslationReviewBatches(candidates, maxBatchWords));
	const totalSegments = $derived(
		candidates.reduce((total, candidate) => total + candidate.segments.length, 0)
	);
	const totalWords = $derived(
		candidates.reduce((total, candidate) => total + candidate.wordCount, 0)
	);
	const progressPercent = $derived(
		batches.length === 0 ? 0 : Math.round((completedBatches / batches.length) * 100)
	);

	/**
	 * Crée les emplacements de workers affichés dans la modale.
	 *
	 * @returns {AiStreamWorker[]} Workers initialisés au repos.
	 */
	function createIdleWorkers(): AiStreamWorker[] {
		return Array.from({ length: AI_TRANSLATION_REVIEW_WORKER_COUNT }, (_, index) => ({
			workerId: index + 1,
			batchId: '',
			batchLabel: '',
			step: 'idle',
			reasoning: '',
			response: ''
		}));
	}

	/**
	 * Applique les fragments streamés aux workers concernés.
	 *
	 * @param {AiStreamChunkUpdate[]} updates Fragments regroupés par batch.
	 * @returns {void}
	 */
	function applyBufferedChunks(updates: AiStreamChunkUpdate[]): void {
		for (const update of updates) {
			const worker = workers.find((item) => item.batchId === update.batchId);
			if (!worker) continue;
			worker.reasoning += update.reasoning;
			worker.response += update.response;
		}
	}

	/**
	 * Met à jour l'étape affichée pour le worker d'un batch actif.
	 *
	 * @param {{ payload: StatusEventPayload }} event Événement de statut Tauri.
	 * @returns {void}
	 */
	function handleStatusEvent(event: { payload: StatusEventPayload }): void {
		const payload = event.payload;
		if (!activeBatchIds.has(payload.batchId)) return;
		const worker = workers.find((item) => item.batchId === payload.batchId);
		if (worker) worker.step = payload.step;
	}

	/**
	 * Met en tampon un fragment streamé par le backend.
	 *
	 * @param {{ payload: ChunkEventPayload }} event Événement de streaming Tauri.
	 * @returns {void}
	 */
	function handleChunkEvent(event: { payload: ChunkEventPayload }): void {
		const payload = event.payload;
		if (!activeBatchIds.has(payload.batchId)) return;
		chunkBuffer.push(payload.batchId, payload.kind, payload.delta);
	}

	/**
	 * Ajoute une entrée au journal d'activité du run courant.
	 *
	 * @param {string} step Étape technique.
	 * @param {string} message Message affiché.
	 * @param {ActivityTone} tone Niveau visuel du message.
	 * @param {string} batchId Identifiant du batch concerné.
	 * @returns {void}
	 */
	function addActivity(
		step: string,
		message: string,
		tone: ActivityTone = 'info',
		batchId: string = ''
	): void {
		activityCounter++;
		activityLog = [
			{
				id: `ai-translation-review-activity-${activityCounter}`,
				batchId,
				step,
				message,
				tone
			},
			...activityLog
		].slice(0, 80);
	}

	/**
	 * Détecte une erreur fournisseur qui doit stopper les prochains lots.
	 *
	 * @param {string} message Message d'erreur reçu.
	 * @returns {boolean} `true` lorsque les workers doivent s'arrêter.
	 */
	function isBlockingError(message: string): boolean {
		return /\b(401|402|403|429|500|502|503|504)\b/.test(message);
	}

	/**
	 * Réinitialise l'affichage d'un nouveau run.
	 *
	 * @returns {void}
	 */
	function resetRunState(): void {
		completedBatches = 0;
		successfulBatches = 0;
		failedSegments = 0;
		markedSegments = 0;
		workers = createIdleWorkers();
		latestSummary = '';
		activityLog = [];
		batchUsageById = {};
	}

	/**
	 * Formate l'usage cumulé retourné par les batches.
	 *
	 * @returns {string} Résumé localisé des tokens consommés.
	 */
	function getActualUsageSummary(): string {
		const usageList = Object.values(batchUsageById);
		if (usageList.length === 0) return get(LL).editor.usageUnavailable();
		const input = usageList.reduce((total, usage) => total + (usage.inputTokens ?? 0), 0);
		const output = usageList.reduce((total, usage) => total + (usage.outputTokens ?? 0), 0);
		const total = usageList.reduce((sum, usage) => sum + (usage.totalTokens ?? 0), 0);
		return get(LL).editor.tokenUsageSummary({ input, output, total });
	}

	/**
	 * Vérifie toutes les traductions avec trois workers puis marque les erreurs en "to review".
	 *
	 * @returns {Promise<void>} Promesse résolue à la fin de la vérification.
	 */
	async function runReview(): Promise<void> {
		if (isRunning || batches.length === 0) return;

		const aiSettings = globalState.settings!.aiTranslationSettings;
		const apiKey = aiSettings.openAiApiKey.trim();
		const endpoint = aiSettings.textAiApiEndpoint.trim();
		if (!apiKey) {
			toast.error(get(LL).translations.configureAiKeyFirst());
			return;
		}
		if (!endpoint) {
			toast.error(get(LL).translations.configureTextAiFirst());
			return;
		}

		const runBatches = [...batches];
		const issues: AiTranslationReviewIssue[] = [];
		const reportLines: string[] = [];
		let blockingFailure = false;
		let successfullyCheckedSegments = 0;
		resetRunState();
		isRunning = true;
		activeBatchIds = new Set(runBatches.map((batch) => batch.batchId));
		addActivity('queued', get(LL).editor.aiTranslationReviewDescription());

		await runAiWorkerPool(
			runBatches,
			AI_TRANSLATION_REVIEW_WORKER_COUNT,
			async (batch, batchIndex, workerIndex) => {
				const worker = workers[workerIndex];
				const batchLabel = get(LL).editor.batchProgress({
					current: batchIndex + 1,
					total: runBatches.length
				});
				const batchSegmentCount = batch.verses.reduce(
					(total, verse) => total + verse.segments.length,
					0
				);
				worker.batchId = batch.batchId;
				worker.batchLabel = batchLabel;
				worker.detail = `${batchSegmentCount} ${get(LL).editor.segments()} · ${batch.wordCount} ${get(LL).editor.words()}`;
				worker.step = 'queued';
				worker.reasoning = '';
				worker.response = '';
				addActivity('queued', `${batchLabel} · ${worker.detail}`, 'info', batch.batchId);

				try {
					const response = await runAiTranslationReviewBatch({
						apiKey,
						endpoint,
						model: aiSettings.advancedTrimModel,
						reasoningEffort: aiSettings.advancedTrimReasoningEffort,
						batchId: batch.batchId,
						batch: batch.request
					});
					chunkBuffer.flush();
					worker.response = response.rawText;
					worker.step = 'validating';
					if (response.usage) batchUsageById[batch.batchId] = response.usage;
					addActivity(
						'validating',
						get(LL).editor.validatingBatch({ label: batchLabel }),
						'info',
						batch.batchId
					);

					const validation = validateAiTranslationReviewBatchResult(batch, response.parsed);
					if (validation.errors.length > 0) throw new Error(validation.errors.join(' '));
					issues.push(...validation.issues);
					successfulBatches++;
					successfullyCheckedSegments += batchSegmentCount;
					worker.step = 'completed';
					addActivity(
						'completed',
						get(LL).editor.aiTranslationReviewComplete({
							marked: validation.issues.length,
							checked: batchSegmentCount
						}),
						'success',
						batch.batchId
					);
				} catch (error) {
					failedSegments += batchSegmentCount;
					worker.step = 'failed';
					const message = error instanceof Error ? error.message : String(error);
					reportLines.push(message);
					addActivity('failed', message, 'error', batch.batchId);
					if (isBlockingError(message)) blockingFailure = true;
				} finally {
					chunkBuffer.flush();
					completedBatches++;
				}
			},
			() => blockingFailure
		);

		try {
			markedSegments = applyAiTranslationReviewIssues(issues);
			globalState.getTranslationsState.checkOnlyFilters(['to review']);
			await globalState.currentProject?.save(false);
		} catch (error) {
			reportLines.push(error instanceof Error ? error.message : String(error));
		} finally {
			activeBatchIds = new Set<string>();
			isRunning = false;
		}
		latestSummary = get(LL).editor.aiTranslationReviewComplete({
			marked: markedSegments,
			checked: successfullyCheckedSegments
		});

		if (reportLines.length > 0) {
			toast.error(get(LL).editor.aiTranslationReviewFailed({ error: reportLines[0] }));
		} else {
			toast.success(latestSummary);
		}
	}

	onMount(async () => {
		unlistenFns = [
			await listen('ai-translation-review-status', handleStatusEvent),
			await listen('ai-translation-review-chunk', handleChunkEvent)
		];
	});

	onDestroy(() => {
		chunkBuffer.clear();
		for (const unlisten of unlistenFns) unlisten();
		unlistenFns = [];
	});
</script>

<TranslationsEditorModalShell
	close={() => {
		if (!isRunning) close();
	}}
	title={$LL.editor.reviewTranslationsWithAi()}
	icon="fact_check"
	shellClass="h-[90dvh] w-full"
	bodyClass="flex min-h-0 flex-1 flex-col overflow-y-auto"
	workspace={{
		configuration: {
			title: $LL.editor.configuration(),
			description: $LL.editor.aiTranslationReviewDescription(),
			icon: 'fact_check'
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
			description: $LL.editor.aiTranslationReviewDescription(),
			buttonLabel: isRunning
				? $LL.editor.runningAiTranslationReview()
				: $LL.editor.runAiTranslationReview(),
			disabled: isRunning || batches.length === 0,
			onclick: runReview
		},
		status: {
			title: $LL.editor.reviewTranslationsWithAi(),
			subtitle: isRunning
				? $LL.editor.batchProgress({ current: completedBatches, total: batches.length })
				: latestSummary || $LL.editor.noSummaryYet(),
			progressPercent,
			metrics: [
				{ label: $LL.editor.toReview(), value: markedSegments },
				{ label: $LL.editor.successfulBatches(), value: successfulBatches },
				{ label: $LL.editor.failedSegments(), value: failedSegments },
				{ label: $LL.editor.usage(), value: getActualUsageSummary() }
			]
		},
		activityLog,
		activityTitle: $LL.editor.recentActivity()
	}}
>
	{#snippet subtitle()}
		{$LL.editor.aiTranslationReviewDescription()}
	{/snippet}

	{#snippet configurationFields()}
		<div class="rounded-xl border border-color bg-secondary p-4">
			<div class="mb-3 flex items-center justify-between gap-3">
				<div class="flex items-center gap-2">
					<span class="material-icons text-accent-primary">tune</span>
					<span class="text-sm font-semibold text-primary">{$LL.editor.maxWords()}</span>
				</div>
				<span class="text-sm font-medium text-primary">{maxBatchWords} {$LL.editor.words()}</span>
			</div>
			<input
				type="range"
				min="100"
				max="1000"
				step="50"
				bind:value={maxBatchWords}
				disabled={isRunning}
				aria-label={$LL.editor.maxWords()}
				class="w-full accent-[var(--accent-primary)] disabled:opacity-50"
			/>
		</div>
	{/snippet}

	{#snippet configurationSummary()}
		<div class="rounded-xl border border-color bg-accent p-4">
			<div class="mb-4 flex items-center gap-2">
				<span class="material-icons text-accent-primary">analytics</span>
				<h3 class="text-lg font-semibold text-primary">{$LL.editor.batchPreview()}</h3>
			</div>
			<div class="grid grid-cols-3 gap-3">
				<div class="rounded-lg border border-color bg-secondary p-3 text-center">
					<div class="text-lg font-semibold text-primary">{totalSegments}</div>
					<div class="text-xs text-thirdly">{$LL.editor.segments()}</div>
				</div>
				<div class="rounded-lg border border-color bg-secondary p-3 text-center">
					<div class="text-lg font-semibold text-primary">{totalWords}</div>
					<div class="text-xs text-thirdly">{$LL.editor.words()}</div>
				</div>
				<div class="rounded-lg border border-color bg-secondary p-3 text-center">
					<div class="text-lg font-semibold text-primary">{batches.length}</div>
					<div class="text-xs text-thirdly">{$LL.editor.batches()}</div>
				</div>
			</div>
			{#if batches.length === 0}
				<p class="mt-3 text-sm text-secondary">{$LL.editor.aiTranslationReviewNoTranslations()}</p>
			{/if}
		</div>
	{/snippet}

	{#snippet afterStatus()}
		<AiStreamingWorkerGrid {workers} columnsClass="grid-cols-1" textareaClass="h-24" />
	{/snippet}
</TranslationsEditorModalShell>
