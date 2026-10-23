<script lang="ts">
	import type { Edition } from '$lib/classes';
	import AiActivityLogCard from './shared/AiActivityLogCard.svelte';
	import AiBatchOverviewCard from './shared/AiBatchOverviewCard.svelte';
	import AiRunStatusCard from './shared/AiRunStatusCard.svelte';
	import VerseRangeSelector from './VerseRangeSelector.svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import {
		applyAdvancedTrimValidationSuccess,
		buildAdvancedTrimBatches,
		buildAdvancedTrimVerseCandidates,
		estimateAdvancedTrimCost,
		formatUsd,
		runAdvancedTrimBatchStreaming,
		type AdvancedTrimBatch,
		type AdvancedTrimCostEstimate,
		type AdvancedTrimUsage,
		type AdvancedTrimVerseCandidate,
		validateAdvancedTrimBatchResult
	} from '$lib/services/AdvancedAITrimming';

	import { AnalyticsService } from '$lib/services/AnalyticsService';
	import { notifyLongTaskCompletion } from '$lib/services/UserAttentionService';
	import LL from '$lib/i18n/i18n-svelte';
	import { listen, type UnlistenFn } from '@tauri-apps/api/event';
	import { onDestroy, onMount } from 'svelte';
	import toast from 'svelte-5-french-toast';

	const copy = $derived(Reflect.get($LL.translations, 'advancedTrim'));

	type ActivityTone = 'info' | 'success' | 'error';
	type ActivityEntry = {
		id: string;
		batchId: string;
		step: string;
		message: string;
		tone: ActivityTone;
	};
	type StatusEventPayload = {
		batchId: string;
		step: string;
		message: string;
	};
	type ChunkEventPayload = {
		batchId: string;
		delta: string;
		accumulatedText: string;
	};
	type CompleteEventPayload = {
		batchId: string;
		rawText: string;
		usage?: AdvancedTrimUsage;
	};
	type LatestRunStats = {
		totalBatches: number;
		successfulBatches: number;
		failedBatches: number;
		aiSetSegments: number;
		aiErrorSegments: number;
		cleanVerses: number;
		versesWithIssues: number;
		rejectedVerses: number;
	};

	let { edition }: { edition: Edition } = $props();

	let advancedCandidates: AdvancedTrimVerseCandidate[] = $state([]);
	let advancedBatches: AdvancedTrimBatch[] = $state([]);
	let advancedEstimate: AdvancedTrimCostEstimate = $state({
		batches: [],
		totalVerses: 0,
		totalWords: 0,
		totalEstimatedInputTokens: 0,
		totalEstimatedOutputTokens: 0,
		totalEstimatedCostUsd: 0,
		reasoningNote: Reflect.get($LL.translations, 'aiCost').approximation()
	});

	let selectedStartTimeMs: number = $state(0);
	let selectedEndTimeMs: number = $state(0);

	let isRunning: boolean = $state(false);
	let completedBatches: number = $state(0);
	let successfulVerses: number = $state(0);
	let failedVerses: number = $state(0);
	let successfulBatches: number = $state(0);
	let failedBatches: number = $state(0);
	let currentBatchId: string = $state('');
	let currentBatchStep: string = $state('idle');
	let currentBatchLabel: string = $state('');
	let currentBatchVerseKeys: string = $state('');
	let streamedResponse: string = $state('');
	let latestSummary: string = $state('');
	let latestRunStats: LatestRunStats | null = $state(null);
	let activityLog: ActivityEntry[] = $state([]);
	let batchUsageById: Record<string, AdvancedTrimUsage> = $state({});

	let unlistenFns: UnlistenFn[] = [];
	let activityCounter = 0;
	let activeBatchIds = new Set<string>();

	function aiSettings() {
		return globalState.settings!.aiTranslationSettings;
	}

	function addActivity(
		step: string,
		message: string,
		tone: ActivityTone = 'info',
		batchId: string = currentBatchId
	): void {
		activityCounter += 1;
		activityLog = [
			{
				id: `activity-${activityCounter}`,
				batchId,
				step,
				message,
				tone
			},
			...activityLog
		].slice(0, 80);
	}

	function getSelectionMaxDurationMs(): number {
		return (
			globalState.getAudioTrack?.getDuration().ms ||
			globalState.getSubtitleTrack?.getDuration().ms ||
			0
		);
	}

	function syncSelectionWindow(resetToFullRange: boolean = false): void {
		const maxDuration = getSelectionMaxDurationMs();
		if (resetToFullRange || selectedEndTimeMs <= 0 || selectedEndTimeMs > maxDuration) {
			selectedStartTimeMs = 0;
			selectedEndTimeMs = maxDuration;
			return;
		}

		selectedStartTimeMs = Math.max(0, Math.min(selectedStartTimeMs, maxDuration));
		selectedEndTimeMs = Math.max(selectedStartTimeMs, Math.min(selectedEndTimeMs, maxDuration));
	}

	function getSelectedVerseCount(): number {
		return advancedCandidates.filter(
			(candidate) =>
				candidate.startTime <= selectedEndTimeMs && candidate.endTime >= selectedStartTimeMs
		).length;
	}

	function refreshBatchPreview(): void {
		advancedBatches = buildAdvancedTrimBatches(
			advancedCandidates,
			aiSettings().advancedTrimModel,
			aiSettings().advancedTrimReasoningEffort,
			selectedStartTimeMs,
			selectedEndTimeMs
		);
		advancedEstimate = estimateAdvancedTrimCost(
			advancedBatches,
			aiSettings().advancedTrimReasoningEffort
		);
	}

	function refreshCandidates(resetRange: boolean = false): void {
		advancedCandidates = buildAdvancedTrimVerseCandidates(
			edition,
			aiSettings().advancedAlsoAskReviewed
		);
		syncSelectionWindow(resetRange);
		refreshBatchPreview();
	}

	function isBlockingError(message: string): boolean {
		return /\b(401|402|403|429|500|502|503|504)\b/.test(message);
	}

	function resetRunState(): void {
		completedBatches = 0;
		successfulVerses = 0;
		failedVerses = 0;
		successfulBatches = 0;
		failedBatches = 0;
		currentBatchId = '';
		currentBatchStep = 'idle';
		currentBatchLabel = '';
		currentBatchVerseKeys = '';
		streamedResponse = '';
		latestSummary = '';
		latestRunStats = null;
		activityLog = [];
		batchUsageById = {};
		activeBatchIds = new Set<string>();
	}

	function handleStatusEvent(event: { payload: StatusEventPayload }): void {
		const payload = event.payload;
		if (!activeBatchIds.has(payload.batchId)) return;

		currentBatchId = payload.batchId;
		currentBatchStep = payload.step;
		const tone: ActivityTone = payload.step === 'failed' ? 'error' : 'info';
		addActivity(payload.step, payload.message, tone, payload.batchId);
	}

	function handleChunkEvent(event: { payload: ChunkEventPayload }): void {
		const payload = event.payload;
		if (!activeBatchIds.has(payload.batchId)) return;
		if (payload.batchId !== currentBatchId) return;
		streamedResponse = payload.accumulatedText;
	}

	function handleCompleteEvent(event: { payload: CompleteEventPayload }): void {
		const payload = event.payload;
		if (!activeBatchIds.has(payload.batchId)) return;
		if (payload.batchId === currentBatchId) {
			streamedResponse = payload.rawText;
		}
		if (payload.usage) {
			batchUsageById = {
				...batchUsageById,
				[payload.batchId]: payload.usage
			};
		}
	}

	function getTotalVerses(): number {
		return advancedCandidates.length;
	}

	function getProgressPercent(): number {
		if (advancedBatches.length === 0) return 0;
		return Math.round((completedBatches / advancedBatches.length) * 100);
	}

	function getActualUsageSummary(): string {
		const usageList = Object.values(batchUsageById);
		if (usageList.length === 0) return $LL.editor.usageUnavailable();

		const input = usageList.reduce((total, item) => total + (item.inputTokens ?? 0), 0);
		const output = usageList.reduce((total, item) => total + (item.outputTokens ?? 0), 0);
		const total = usageList.reduce((sum, item) => sum + (item.totalTokens ?? 0), 0);

		return $LL.editor.tokenUsageSummary({ input, output, total });
	}

	async function runAdvancedTrimming(): Promise<void> {
		if (isRunning) return;

		const apiKey = aiSettings().openAiApiKey.trim();
		if (!apiKey) {
			toast.error($LL.translations.configureAiKeyFirst());
			return;
		}

		const endpoint = aiSettings().textAiApiEndpoint.trim();
		if (!endpoint) {
			toast.error($LL.translations.configureTextAiFirst());
			return;
		}
		if (advancedBatches.length === 0) {
			toast.error($LL.translations.noEligibleVerseBatch());
			return;
		}

		resetRunState();
		isRunning = true;
		activeBatchIds = new Set<string>(advancedBatches.map((batch) => batch.batchId));
		addActivity(
			'queued',
			copy.starting({ verses: advancedEstimate.totalVerses, batches: advancedBatches.length })
		);

		const reportLines: string[] = [];
		let blockingFailure = false;
		let totalAiSetSegments = 0;
		let totalAiErrorSegments = 0;
		let totalRejectedVerses = 0;

		for (let batchIndex = 0; batchIndex < advancedBatches.length; batchIndex++) {
			const batch = advancedBatches[batchIndex];
			currentBatchId = batch.batchId;
			currentBatchLabel = $LL.editor.batchProgress({
				current: batchIndex + 1,
				total: advancedBatches.length
			});
			currentBatchVerseKeys = batch.verses.map((verse) => verse.verseKey).join(', ');
			streamedResponse = '';

			addActivity(
				'queued',
				copy.batchQueued({
					label: currentBatchLabel,
					verses: batch.verses.length,
					words: batch.wordCount
				}),
				'info',
				batch.batchId
			);

			try {
				const response = await runAdvancedTrimBatchStreaming({
					apiKey,
					endpoint,
					model: aiSettings().advancedTrimModel,
					reasoningEffort: aiSettings().advancedTrimReasoningEffort,
					batchId: batch.batchId,
					batch: batch.request
				});

				streamedResponse = response.rawText;
				addActivity(
					'validating',
					$LL.editor.validatingBatch({ label: currentBatchLabel }),
					'info',
					batch.batchId
				);

				const validation = validateAdvancedTrimBatchResult(batch, response.parsed);
				const applyReport = applyAdvancedTrimValidationSuccess(edition, validation.validVerses);
				const validationFailedVerses = batch.verses.length - validation.validVerses.length;

				if (validationFailedVerses === 0 && applyReport.erroredVerses === 0) {
					successfulBatches++;
				} else {
					failedBatches++;
				}

				successfulVerses += applyReport.alignedVerses;
				failedVerses += validationFailedVerses + applyReport.erroredVerses;
				totalAiSetSegments += applyReport.appliedSegments;
				totalAiErrorSegments += applyReport.erroredSegments;
				totalRejectedVerses += validationFailedVerses;

				if (applyReport.alignedVerses > 0) {
					addActivity(
						'applied',
						copy.appliedVerses({
							applied: applyReport.alignedVerses,
							total: batch.verses.length,
							segments: applyReport.alignedSegments
						}),
						'success',
						batch.batchId
					);
				}

				if (validation.validVerses.length === 0) {
					addActivity('failed', copy.noValidVerse(), 'error', batch.batchId);
				}

				if (applyReport.erroredSegments > 0) {
					addActivity(
						'failed',
						copy.remappingFailed({ count: applyReport.erroredSegments }),
						'error',
						batch.batchId
					);
				}

				if (validation.errors.length > 0) {
					reportLines.push(`${currentBatchLabel} (${currentBatchVerseKeys})`, ...validation.errors);
					for (const error of validation.errors) {
						addActivity('failed', error, 'error', batch.batchId);
					}
				}

				if (applyReport.errors.length > 0) {
					reportLines.push(...applyReport.errors);
					for (const error of applyReport.errors) {
						addActivity('failed', error, 'error', batch.batchId);
					}
				}
			} catch (error) {
				failedBatches++;
				failedVerses += batch.verses.length;
				const message = error instanceof Error ? error.message : String(error);
				reportLines.push(`${currentBatchLabel} (${currentBatchVerseKeys})`, message);
				addActivity('failed', message, 'error', batch.batchId);
				if (isBlockingError(message)) {
					blockingFailure = true;
					completedBatches = batchIndex + 1;
					break;
				}
			}

			completedBatches = batchIndex + 1;
		}

		isRunning = false;
		activeBatchIds = new Set<string>();
		currentBatchStep = blockingFailure ? 'failed' : 'idle';
		latestRunStats = {
			totalBatches: advancedBatches.length,
			successfulBatches,
			failedBatches,
			aiSetSegments: totalAiSetSegments,
			aiErrorSegments: totalAiErrorSegments,
			cleanVerses: successfulVerses,
			versesWithIssues: failedVerses,
			rejectedVerses: totalRejectedVerses
		};
		latestSummary = copy.runSummary({
			successful: successfulBatches,
			total: advancedBatches.length,
			applied: totalAiSetSegments,
			errors: totalAiErrorSegments,
			verses: failedVerses
		});

		AnalyticsService.trackTranslationUsage({
			range: `time ${selectedStartTimeMs}-${selectedEndTimeMs}`,
			translation_mode: 'advanced',
			mode: 'advanced_trim',
			model: aiSettings().advancedTrimModel,
			reasoning_effort: aiSettings().advancedTrimReasoningEffort,
			total_batches: advancedBatches.length,
			completed_batches: completedBatches,
			successful_batches: successfulBatches,
			failed_batches: failedBatches,
			total_verses: advancedEstimate.totalVerses,
			successful_verses: successfulVerses,
			failed_verses: failedVerses,
			estimated_cost_usd: advancedEstimate.totalEstimatedCostUsd,
			edition_key: edition.key,
			edition_name: edition.name,
			edition_author: edition.author,
			edition_language: edition.language
		});

		if (reportLines.length === 0) {
			toast.success(`${latestSummary} ${getActualUsageSummary()}.`);
			await notifyLongTaskCompletion({
				title: $LL.editor.aiTrimmingFinished(),
				body: latestSummary,
				level: 'success'
			});
		} else {
			toast(`${latestSummary} ${$LL.editor.checkActivityLog()}`, {
				duration: 6000
			});
			await notifyLongTaskCompletion({
				title: $LL.editor.aiTrimmingFinishedWithErrors(),
				body: latestSummary,
				level: 'error'
			});
		}
	}

	onMount(async () => {
		refreshCandidates(true);
		unlistenFns.push(
			await listen('advanced-ai-trim-status', handleStatusEvent),
			await listen('advanced-ai-trim-chunk', handleChunkEvent),
			await listen('advanced-ai-trim-complete', handleCompleteEvent)
		);
	});

	onDestroy(() => {
		for (const unlisten of unlistenFns) {
			unlisten();
		}
	});
</script>

<div class="space-y-6">
	{#if getTotalVerses() === 0}
		<div class="flex flex-col items-center justify-center py-16 text-center">
			<div class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-500/20">
				<span class="material-icons text-2xl text-green-500">task_alt</span>
			</div>
			<h3 class="mb-2 text-xl font-semibold text-primary">{copy.noEligibleVerses()}</h3>
			<p class="text-secondary">
				{copy.alreadyComplete()}
			</p>
		</div>
	{:else}
		<div class="space-y-4">
			{#if latestRunStats}
				<div class="rounded-xl border border-[var(--accent-primary)]/35 bg-accent p-4">
					<div class="flex items-center gap-2">
						<span class="material-icons text-accent-primary">summarize</span>
						<h3 class="text-lg font-semibold text-primary">{copy.latestRecap()}</h3>
					</div>
					<div class="mt-2 text-sm text-secondary">{latestSummary}</div>

					<div class="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
						<div class="rounded-lg border border-color bg-secondary p-3">
							<div class="text-xs uppercase tracking-wide text-thirdly">
								{copy.fullySuccessfulBatches()}
							</div>
							<div class="mt-1 text-xl font-semibold text-primary">
								{latestRunStats.successfulBatches}/{latestRunStats.totalBatches}
							</div>
						</div>
						<div class="rounded-lg border border-color bg-secondary p-3">
							<div class="text-xs uppercase tracking-wide text-thirdly">
								{copy.segmentsSetByAi()}
							</div>
							<div class="mt-1 text-xl font-semibold text-primary">
								{latestRunStats.aiSetSegments}
							</div>
						</div>
						<div class="rounded-lg border border-color bg-secondary p-3">
							<div class="text-xs uppercase tracking-wide text-thirdly">
								{copy.errorSegmentsToReview()}
							</div>
							<div class="mt-1 text-xl font-semibold text-red-200">
								{latestRunStats.aiErrorSegments}
							</div>
						</div>
						<div class="rounded-lg border border-color bg-secondary p-3">
							<div class="text-xs uppercase tracking-wide text-thirdly">
								{copy.rejectedVerses()}
							</div>
							<div class="mt-1 text-xl font-semibold text-primary">
								{latestRunStats.rejectedVerses}
							</div>
						</div>
					</div>

					<div class="mt-3 grid gap-3 md:grid-cols-2">
						<div class="rounded-lg border border-color bg-secondary p-3 text-sm text-secondary">
							{copy.cleanVerses({ count: latestRunStats.cleanVerses })}
						</div>
						<div class="rounded-lg border border-color bg-secondary p-3 text-sm text-secondary">
							{copy.versesWithIssues({ count: latestRunStats.versesWithIssues })}
						</div>
					</div>
				</div>
			{/if}

			<div class="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
				<div class="space-y-4">
					{#if getTotalVerses() > 1}
						<VerseRangeSelector
							totalDurationMs={getSelectionMaxDurationMs()}
							totalItems={getTotalVerses()}
							selectedItems={getSelectedVerseCount()}
							bind:startTimeMs={selectedStartTimeMs}
							bind:endTimeMs={selectedEndTimeMs}
							title={$LL.editor.timeSelection()}
							icon="schedule"
							totalLabel={$LL.editor.eligibleVerses()}
							selectionLabel={$LL.editor.selectTimeRangeToProcess()}
							selectionHint={copy.timelineRangeHint()}
							onRangeChange={refreshBatchPreview}
						/>
					{/if}

					<AiBatchOverviewCard
						title={$LL.editor.batchPreview()}
						icon="analytics"
						metrics={[
							{ label: $LL.export.versesColumn(), value: advancedEstimate.totalVerses },
							{ label: $LL.editor.words(), value: advancedEstimate.totalWords },
							{ label: $LL.editor.batches(), value: advancedBatches.length }
						]}
						estimatedCostLabel={formatUsd(advancedEstimate.totalEstimatedCostUsd)}
						tokenSummary={$LL.editor.estimatedTokenSummary({
							input: advancedEstimate.totalEstimatedInputTokens,
							output: advancedEstimate.totalEstimatedOutputTokens
						})}
						reasoningNote={advancedEstimate.reasoningNote}
						columnsClass="md:grid-cols-3"
					/>

					<div class="rounded-xl border border-color bg-secondary px-4 py-4">
						<div class="flex items-start gap-3">
							<div class="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
								<span class="material-icons text-accent-primary">settings</span>
							</div>
							<div class="space-y-1">
								<div class="text-sm font-semibold text-primary">{$LL.editor.aiProvider()}</div>
								<p class="text-sm leading-relaxed text-thirdly">
									{$LL.editor.aiProviderConfigHint()}
								</p>
								<div class="text-xs text-thirdly">
									{$LL.editor.currentModel()}:
									<span class="font-medium text-primary">
										{aiSettings().advancedTrimModel || $LL.editor.notSet()}
									</span>
								</div>
								<div class="text-xs text-thirdly break-all">
									{$LL.editor.endpoint()}:
									<span class="font-medium text-primary">
										{aiSettings().textAiApiEndpoint || $LL.editor.notSet()}
									</span>
								</div>
							</div>
						</div>
					</div>
				</div>

				<div class="space-y-4">
					<div class="rounded-xl border border-color bg-accent p-4">
						<div class="mb-4 flex items-center justify-between">
							<div class="flex items-center gap-2">
								<span class="material-icons text-accent-secondary">auto_awesome</span>
								<h3 class="text-lg font-semibold text-primary">{$LL.editor.run()}</h3>
							</div>
							<button
								class="btn-accent px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
								onclick={runAdvancedTrimming}
								disabled={isRunning || advancedBatches.length === 0}
							>
								{isRunning ? copy.running() : copy.run()}
							</button>
						</div>

						<AiRunStatusCard
							title={$LL.editor.currentRun()}
							subtitle={currentBatchLabel || $LL.settings.idle()}
							progressPercent={getProgressPercent()}
							metrics={[
								{ label: copy.currentStep(), value: currentBatchStep },
								{ label: $LL.editor.usage(), value: getActualUsageSummary() }
							]}
							progressTrackClass="bg-secondary"
							progressBarClass="bg-accent-secondary"
							containerClass="space-y-3"
							metricCardClass="rounded-lg border border-color bg-secondary p-3"
							detailLabel={currentBatchVerseKeys ? copy.currentVerses() : undefined}
							detailText={currentBatchVerseKeys || undefined}
						/>
					</div>

					<div class="rounded-xl border border-color bg-accent p-4">
						<div class="mb-3 flex items-center justify-between">
							<div class="flex items-center gap-2">
								<span class="material-icons text-accent-primary">monitoring</span>
								<h3 class="text-lg font-semibold text-primary">{copy.liveActivity()}</h3>
							</div>
							<button
								class="btn px-3 py-1.5 text-xs"
								onclick={() => {
									navigator.clipboard.writeText(streamedResponse);
									toast.success($LL.translations.liveResponseCopied());
								}}
								disabled={!streamedResponse}
							>
								{copy.copyResponse()}
							</button>
						</div>

						<div class="rounded-lg border border-color bg-secondary p-3">
							<div
								class="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-thirdly"
							>
								<span class="material-icons text-sm">stream</span>
								<span>{$LL.editor.currentStreamedResponse()}</span>
							</div>
							<textarea
								readonly
								bind:value={streamedResponse}
								class="h-40 w-full resize-none rounded-lg border border-color bg-[var(--bg-primary)] p-3 font-mono text-xs leading-relaxed text-primary"
								placeholder={$LL.translations.streamingResponsePlaceholder()}
							></textarea>
						</div>

						<div class="mt-4">
							<AiActivityLogCard
								{activityLog}
								title={$LL.editor.recentActivity()}
								maxHeightClass="max-h-72"
								containerClass=""
							/>
						</div>
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>
