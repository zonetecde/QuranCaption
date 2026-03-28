<script lang="ts">
	import type { Edition } from '$lib/classes';
	import Settings from '$lib/classes/Settings.svelte';
	import ModalManager from '$lib/components/modals/ModalManager';
	import { globalState } from '$lib/runes/main.svelte';
	import {
		applyAdvancedTrimValidationSuccess,
		buildAdvancedTrimBatches,
		buildAdvancedTrimVerseCandidates,
		estimateAdvancedTrimCost,
		formatUsd,
		maskApiKey,
		runAdvancedTrimBatchStreaming,
		type AdvancedTrimBatch,
		type AdvancedTrimCostEstimate,
		type AdvancedTrimModel,
		type AdvancedTrimReasoningEffort,
		type AdvancedTrimUsage,
		type AdvancedTrimVerseCandidate,
		validateAdvancedTrimBatchResult
	} from '$lib/services/AdvancedAITrimming';
	import { AnalyticsService } from '$lib/services/AnalyticsService';
	import { listen, type UnlistenFn } from '@tauri-apps/api/event';
	import { onDestroy, onMount } from 'svelte';
	import toast from 'svelte-5-french-toast';

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
		reasoningNote: 'Approximation based on prompt/output size only.'
	});

	let startIndex: number = $state(0);
	let endIndex: number = $state(0);

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
	let latestErrorLog: string = $state('');
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
			...activityLog,
			{
				id: `activity-${activityCounter}`,
				batchId,
				step,
				message,
				tone
			}
		].slice(-80);
	}

	function clampRange(resetToFullRange: boolean = false): void {
		if (advancedCandidates.length === 0) {
			startIndex = 0;
			endIndex = 0;
			return;
		}

		if (resetToFullRange) {
			startIndex = 0;
			endIndex = advancedCandidates.length - 1;
			return;
		}

		startIndex = Math.max(0, Math.min(startIndex, advancedCandidates.length - 1));
		endIndex = Math.max(startIndex, Math.min(endIndex, advancedCandidates.length - 1));
	}

	function refreshBatchPreview(): void {
		advancedBatches = buildAdvancedTrimBatches(
			advancedCandidates,
			aiSettings().advancedTrimModel,
			aiSettings().advancedTrimReasoningEffort,
			startIndex,
			endIndex
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
		clampRange(
			resetRange || startIndex >= advancedCandidates.length || endIndex >= advancedCandidates.length
		);
		refreshBatchPreview();
	}

	function persistSettingsAndRefresh(mode: 'settings' | 'batches' | 'candidates'): void {
		void Settings.save();
		if (mode === 'candidates') {
			refreshCandidates(true);
			return;
		}
		if (mode === 'batches') {
			refreshBatchPreview();
		}
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
		latestErrorLog = '';
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
		if (usageList.length === 0) return 'Usage unavailable';

		const input = usageList.reduce((total, item) => total + (item.inputTokens ?? 0), 0);
		const output = usageList.reduce((total, item) => total + (item.outputTokens ?? 0), 0);
		const total = usageList.reduce((sum, item) => sum + (item.totalTokens ?? 0), 0);

		return `${input} input / ${output} output / ${total} total tokens`;
	}

	async function runAdvancedTrimming(): Promise<void> {
		if (isRunning) return;

		const apiKey = aiSettings().openAiApiKey.trim();
		if (!apiKey) {
			toast.error('An OpenAI API key is required.');
			return;
		}
		if (advancedBatches.length === 0) {
			toast.error('No eligible verse batch was found for the selected range.');
			return;
		}

		resetRunState();
		isRunning = true;
		activeBatchIds = new Set<string>(advancedBatches.map((batch) => batch.batchId));
		addActivity(
			'queued',
			`Starting advanced trim for ${advancedEstimate.totalVerses} verse(s) across ${advancedBatches.length} batch(es).`
		);

		const reportLines: string[] = [];
		let blockingFailure = false;

		for (let batchIndex = 0; batchIndex < advancedBatches.length; batchIndex++) {
			const batch = advancedBatches[batchIndex];
			currentBatchId = batch.batchId;
			currentBatchLabel = `Batch ${batchIndex + 1} / ${advancedBatches.length}`;
			currentBatchVerseKeys = batch.verses.map((verse) => verse.verseKey).join(', ');
			streamedResponse = '';

			addActivity(
				'queued',
				`${currentBatchLabel}: ${batch.verses.length} verse(s), ${batch.wordCount} words.`,
				'info',
				batch.batchId
			);

			try {
				const response = await runAdvancedTrimBatchStreaming({
					apiKey,
					model: aiSettings().advancedTrimModel,
					reasoningEffort: aiSettings().advancedTrimReasoningEffort,
					batchId: batch.batchId,
					batch: batch.request
				});

				streamedResponse = response.rawText;
				addActivity('validating', `Validating ${currentBatchLabel}...`, 'info', batch.batchId);

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

				if (applyReport.alignedVerses > 0) {
					addActivity(
						'applied',
						`Applied ${applyReport.alignedVerses}/${batch.verses.length} fully aligned verse(s), ${applyReport.alignedSegments} aligned segment(s).`,
						'success',
						batch.batchId
					);
				}

				if (validation.validVerses.length === 0) {
					addActivity(
						'failed',
						'No verse from this batch passed validation.',
						'error',
						batch.batchId
					);
				}

				if (applyReport.erroredSegments > 0) {
					addActivity(
						'failed',
						`${applyReport.erroredSegments} segment(s) were kept but marked AI Error because word range remapping failed.`,
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
		latestErrorLog = reportLines.join('\n');
		latestSummary = `Applied ${successfulVerses} verse(s) across ${successfulBatches} fully valid batch(es).`;

		AnalyticsService.trackAIUsage('translation', {
			range: `indices ${startIndex}-${endIndex}`,
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

		if (reportLines.length > 0) {
			await ModalManager.errorModal(
				'Advanced AI trimming finished with issues',
				`${latestSummary} ${failedVerses} verse(s) were skipped.`,
				latestErrorLog
			);
		} else {
			toast.success(`${latestSummary} ${getActualUsageSummary()}.`);
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
			<h3 class="mb-2 text-xl font-semibold text-primary">No eligible verses</h3>
			<p class="text-secondary">
				The selected edition already looks complete for advanced trimming.
			</p>
		</div>
	{:else}
		<div class="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
			<div class="space-y-4">
				<div class="rounded-xl border border-color bg-accent p-4">
					<div class="mb-4 flex items-center gap-2">
						<span class="material-icons text-accent-primary">key</span>
						<h3 class="text-lg font-semibold text-primary">OpenAI Settings</h3>
					</div>

					<div class="grid gap-4 md:grid-cols-2">
						<label class="space-y-2 md:col-span-2">
							<span class="text-sm font-medium text-secondary">OpenAI API key</span>
							<input
								type="password"
								bind:value={globalState.settings!.aiTranslationSettings.openAiApiKey}
								onblur={() => persistSettingsAndRefresh('settings')}
								placeholder="sk-..."
								class="w-full rounded-lg border border-color bg-secondary px-3 py-2 text-sm text-primary"
							/>
							<span class="text-xs text-thirdly">
								Stored in plain text in `settings.json`. Current: {maskApiKey(
									globalState.settings!.aiTranslationSettings.openAiApiKey
								)}
							</span>
						</label>

						<label class="space-y-2">
							<span class="text-sm font-medium text-secondary">Model</span>
							<select
								bind:value={globalState.settings!.aiTranslationSettings.advancedTrimModel}
								onchange={() => persistSettingsAndRefresh('batches')}
								class="w-full rounded-lg border border-color bg-secondary px-3 py-2 text-sm text-primary"
							>
								<option value="gpt-5.4">gpt-5.4</option>
								<option value="gpt-5.4-mini">gpt-5.4-mini</option>
								<option value="gpt-5.4-nano">gpt-5.4-nano</option>
							</select>
						</label>

						<label class="space-y-2">
							<span class="text-sm font-medium text-secondary">Reasoning effort</span>
							<select
								bind:value={globalState.settings!.aiTranslationSettings.advancedTrimReasoningEffort}
								onchange={() => persistSettingsAndRefresh('batches')}
								class="w-full rounded-lg border border-color bg-secondary px-3 py-2 text-sm text-primary"
							>
								<option value="none">none</option>
								<option value="low">low</option>
								<option value="medium">medium</option>
								<option value="high">high</option>
							</select>
						</label>
					</div>

					<label
						class="mt-4 flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--accent-primary)]/40 bg-secondary px-3 py-3"
					>
						<input
							type="checkbox"
							bind:checked={globalState.settings!.aiTranslationSettings.advancedAlsoAskReviewed}
							onchange={() => persistSettingsAndRefresh('candidates')}
							class="h-4 w-4 rounded"
						/>
						<div>
							<div class="text-sm font-medium text-primary">
								Also ask for already reviewed verses
							</div>
							<div class="text-xs text-thirdly">
								Include fully reviewed verses in candidate selection.
							</div>
						</div>
					</label>
				</div>

				{#if getTotalVerses() > 1}
					<div class="rounded-xl border border-color bg-accent p-4">
						<div class="mb-4 flex items-center justify-between">
							<div class="flex items-center gap-2">
								<span class="material-icons text-accent-primary">tune</span>
								<h3 class="text-lg font-semibold text-primary">Verse Range</h3>
							</div>
							<span class="rounded-md bg-secondary px-2 py-1 text-xs font-semibold text-primary">
								Indices {startIndex} to {endIndex}
							</span>
						</div>

						<div class="relative mb-6 mt-6">
							<div class="relative h-2 w-full rounded-full bg-secondary">
								<div
									class="absolute h-2 rounded-full bg-accent-primary"
									style="left: {(startIndex / Math.max(1, getTotalVerses() - 1)) *
										100}%; width: {((endIndex - startIndex) / Math.max(1, getTotalVerses() - 1)) *
										100}%;"
								></div>
							</div>

							<input
								type="range"
								min="0"
								max={getTotalVerses() - 1}
								bind:value={startIndex}
								oninput={(event) => {
									const nextValue = Number((event.target as HTMLInputElement).value);
									if (nextValue > endIndex) endIndex = nextValue;
									startIndex = nextValue;
									refreshBatchPreview();
								}}
								class="range-slider absolute top-0 h-2 w-full appearance-none bg-transparent"
							/>
							<input
								type="range"
								min="0"
								max={getTotalVerses() - 1}
								bind:value={endIndex}
								oninput={(event) => {
									const nextValue = Number((event.target as HTMLInputElement).value);
									if (nextValue < startIndex) startIndex = nextValue;
									endIndex = nextValue;
									refreshBatchPreview();
								}}
								class="range-slider absolute top-0 h-2 w-full appearance-none bg-transparent"
							/>
						</div>

						<div class="grid gap-3 md:grid-cols-2">
							<div class="rounded-lg border border-color bg-secondary p-3 text-xs">
								<div class="mb-1 font-medium text-accent-primary">Start verse</div>
								<div class="text-thirdly">{advancedCandidates[startIndex]?.verseKey}</div>
							</div>
							<div class="rounded-lg border border-color bg-secondary p-3 text-xs">
								<div class="mb-1 font-medium text-accent-primary">End verse</div>
								<div class="text-thirdly">{advancedCandidates[endIndex]?.verseKey}</div>
							</div>
						</div>
					</div>
				{/if}

				<div class="rounded-xl border border-color bg-accent p-4">
					<div class="mb-4 flex items-center gap-2">
						<span class="material-icons text-accent-primary">analytics</span>
						<h3 class="text-lg font-semibold text-primary">Batch Preview</h3>
					</div>

					<div class="grid gap-3 md:grid-cols-3">
						<div class="rounded-lg border border-color bg-secondary p-3">
							<div class="text-xs uppercase tracking-wide text-thirdly">Verses</div>
							<div class="mt-1 text-xl font-semibold text-primary">
								{advancedEstimate.totalVerses}
							</div>
						</div>
						<div class="rounded-lg border border-color bg-secondary p-3">
							<div class="text-xs uppercase tracking-wide text-thirdly">Words</div>
							<div class="mt-1 text-xl font-semibold text-primary">
								{advancedEstimate.totalWords}
							</div>
						</div>
						<div class="rounded-lg border border-color bg-secondary p-3">
							<div class="text-xs uppercase tracking-wide text-thirdly">Batches</div>
							<div class="mt-1 text-xl font-semibold text-primary">
								{advancedBatches.length}
							</div>
						</div>
					</div>

					<div class="mt-4 rounded-lg border border-[var(--accent-primary)]/30 bg-secondary p-4">
						<div class="mb-1 text-sm font-medium text-primary">
							Estimated cost: {formatUsd(advancedEstimate.totalEstimatedCostUsd)}
						</div>
						<div class="text-xs text-thirdly">
							{advancedEstimate.totalEstimatedInputTokens} input tokens estimated,
							{advancedEstimate.totalEstimatedOutputTokens} output tokens estimated.
						</div>
						<div class="mt-2 text-xs text-thirdly">{advancedEstimate.reasoningNote}</div>
					</div>

					<div class="mt-4 space-y-2">
						{#each advancedBatches as batch}
							<div
								class="rounded-lg border border-color bg-secondary px-3 py-2 text-xs text-secondary"
							>
								<span class="font-semibold text-primary">{batch.batchId}</span>
								: {batch.verses.length} verse(s), {batch.wordCount} words, {formatUsd(
									batch.estimatedCostUsd
								)}
							</div>
						{/each}
					</div>
				</div>
			</div>

			<div class="space-y-4">
				<div class="rounded-xl border border-color bg-accent p-4">
					<div class="mb-4 flex items-center justify-between">
						<div class="flex items-center gap-2">
							<span class="material-icons text-accent-secondary">auto_awesome</span>
							<h3 class="text-lg font-semibold text-primary">Run</h3>
						</div>
						<button
							class="btn-accent px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
							onclick={runAdvancedTrimming}
							disabled={isRunning || advancedBatches.length === 0}
						>
							{isRunning ? 'Running...' : 'Run Advanced AI Trimming'}
						</button>
					</div>

					<div class="mb-3 flex items-center justify-between text-xs text-secondary">
						<span>{currentBatchLabel || 'Idle'}</span>
						<span>{getProgressPercent()}%</span>
					</div>
					<div class="h-2 overflow-hidden rounded-full bg-secondary">
						<div
							class="h-full rounded-full bg-accent-secondary transition-all duration-300"
							style="width: {getProgressPercent()}%;"
						></div>
					</div>

					<div class="mt-4 grid gap-3 md:grid-cols-2">
						<div class="rounded-lg border border-color bg-secondary p-3">
							<div class="text-xs uppercase tracking-wide text-thirdly">Current step</div>
							<div class="mt-1 text-sm font-semibold text-primary">{currentBatchStep}</div>
						</div>
						<div class="rounded-lg border border-color bg-secondary p-3">
							<div class="text-xs uppercase tracking-wide text-thirdly">Usage</div>
							<div class="mt-1 text-sm font-semibold text-primary">{getActualUsageSummary()}</div>
						</div>
					</div>

					{#if currentBatchVerseKeys}
						<div
							class="mt-3 rounded-lg border border-color bg-secondary p-3 text-xs text-secondary"
						>
							<span class="font-semibold text-primary">Current verses:</span>
							{currentBatchVerseKeys}
						</div>
					{/if}
				</div>

				<div class="rounded-xl border border-color bg-accent p-4">
					<div class="mb-3 flex items-center justify-between">
						<div class="flex items-center gap-2">
							<span class="material-icons text-accent-primary">stream</span>
							<h3 class="text-lg font-semibold text-primary">Live Response</h3>
						</div>
						<button
							class="btn px-3 py-1.5 text-xs"
							onclick={() => {
								navigator.clipboard.writeText(streamedResponse);
								toast.success('Live response copied.');
							}}
							disabled={!streamedResponse}
						>
							Copy
						</button>
					</div>
					<textarea
						readonly
						bind:value={streamedResponse}
						class="h-48 w-full resize-none rounded-lg border border-color bg-secondary p-3 font-mono text-xs leading-relaxed text-primary"
						placeholder="Streaming response will appear here..."
					></textarea>
				</div>

				<div class="rounded-xl border border-color bg-accent p-4">
					<div class="mb-3 flex items-center gap-2">
						<span class="material-icons text-accent-primary">history</span>
						<h3 class="text-lg font-semibold text-primary">Live Activity</h3>
					</div>

					<div class="max-h-72 space-y-2 overflow-y-auto pr-1">
						{#if activityLog.length === 0}
							<div
								class="rounded-lg border border-dashed border-color bg-secondary p-3 text-sm text-thirdly"
							>
								No activity yet.
							</div>
						{:else}
							{#each activityLog as entry}
								<div
									class="rounded-lg border px-3 py-2 text-xs {entry.tone === 'error'
										? 'border-red-500/30 bg-red-500/10 text-red-200'
										: entry.tone === 'success'
											? 'border-green-500/30 bg-green-500/10 text-green-200'
											: 'border-color bg-secondary text-secondary'}"
								>
									<div class="mb-1 font-semibold uppercase tracking-wide text-[11px]">
										{entry.step}
									</div>
									<div>{entry.message}</div>
								</div>
							{/each}
						{/if}
					</div>
				</div>

				{#if latestSummary}
					<div class="rounded-xl border border-[var(--accent-primary)]/35 bg-accent p-4">
						<div class="text-sm font-semibold text-primary">Last run summary</div>
						<div class="mt-1 text-sm text-secondary">{latestSummary}</div>
						{#if latestErrorLog}
							<div class="mt-2 text-xs text-thirdly">
								Some verses were skipped. Check the activity log for details.
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.range-slider {
		pointer-events: none;
	}

	.range-slider::-webkit-slider-thumb {
		appearance: none;
		width: 18px;
		height: 18px;
		border-radius: 9999px;
		background: var(--accent-primary);
		border: 3px solid var(--bg-primary);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
		cursor: pointer;
		pointer-events: all;
	}

	.range-slider::-moz-range-thumb {
		width: 18px;
		height: 18px;
		border: 3px solid var(--bg-primary);
		border-radius: 9999px;
		background: var(--accent-primary);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
		cursor: pointer;
		pointer-events: all;
	}

	.range-slider::-moz-range-track {
		height: 8px;
		background: transparent;
	}

	.range-slider:focus {
		outline: none;
	}
</style>
