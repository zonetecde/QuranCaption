<script lang="ts">
	import { listen, type UnlistenFn } from '@tauri-apps/api/event';
	import Settings from '$lib/classes/Settings.svelte';
	import type { AdvancedTrimUsage } from '$lib/services/AdvancedAITrimming';
	import AiActivityLogCard from './shared/AiActivityLogCard.svelte';
	import AiBatchOverviewCard from './shared/AiBatchOverviewCard.svelte';
	import AiRunStatusCard from './shared/AiRunStatusCard.svelte';
	import TranslationsEditorModalShell from './shared/TranslationsEditorModalShell.svelte';
	import VerseRangeSelector from './VerseRangeSelector.svelte';
	import {
		buildAiBoldBatches,
		buildAiBoldCandidates,
		estimateAiBoldCost,
		runAiBoldBatchStreaming,
		validateAiBoldBatchResult,
		applyAiBoldValidationSuccess
	} from '$lib/services/AiTranslationBoldingService';
	import { formatUsd } from '$lib/services/AdvancedAITrimming';
	import { AnalyticsService } from '$lib/services/AnalyticsService';
	import { globalState } from '$lib/runes/main.svelte';
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

	let { close }: { close: () => void } = $props();

	const translationsEditorState = $derived(
		() => globalState.currentProject!.projectEditorState.translationsEditor
	);

	const visibleEditions = $derived(() =>
		globalState.currentProject!.content.projectTranslation.addedTranslationEditions.filter(
			(edition) => edition.showInTranslationsEditor
		)
	);

	const selectedAiBoldEdition = $derived(
		() =>
			visibleEditions().find(
				(edition) => edition.name === translationsEditorState().aiBoldEditionName
			) ?? visibleEditions()[0]
	);

	const aiBoldCandidates = $derived(() => {
		const edition = selectedAiBoldEdition();
		if (!edition) return [];
		return buildAiBoldCandidates(edition, translationsEditorState().aiBoldIncludeAlreadyBolded);
	});

	const totalDurationMs = $derived(
		Math.max(
			globalState.getAudioTrack?.getDuration().ms ||
				globalState.getSubtitleTrack?.getDuration().ms ||
				0,
			1
		)
	);

	const aiBoldBatches = $derived(() =>
		buildAiBoldBatches(
			aiBoldCandidates(),
			globalState.settings!.aiTranslationSettings.advancedTrimModel,
			globalState.settings!.aiTranslationSettings.advancedTrimReasoningEffort,
			translationsEditorState().aiBoldStartTimeMs,
			translationsEditorState().aiBoldEndTimeMs
		)
	);

	const aiBoldEstimate = $derived(() =>
		estimateAiBoldCost(
			aiBoldBatches(),
			globalState.settings!.aiTranslationSettings.advancedTrimReasoningEffort
		)
	);

	const selectedAiBoldSegments = $derived(
		() =>
			aiBoldCandidates().filter(
				(candidate) =>
					candidate.startTime <= translationsEditorState().aiBoldEndTimeMs &&
					candidate.endTime >= translationsEditorState().aiBoldStartTimeMs
			).length
	);

	let isRunning = $state(false);
	let aiBoldStartTimeMs = $state(0);
	let aiBoldEndTimeMs = $state(0);
	let completedBatches = $state(0);
	let successfulBatches = $state(0);
	let failedBatches = $state(0);
	let successfulSegments = $state(0);
	let failedSegments = $state(0);
	let currentBatchId = $state('');
	let currentBatchStep = $state('idle');
	let currentBatchLabel = $state('');
	let streamedResponse = $state('');
	let latestSummary = $state('');
	let activityLog: ActivityEntry[] = $state([]);
	let batchUsageById: Record<string, AdvancedTrimUsage> = $state({});
	let unlistenFns: UnlistenFn[] = [];
	let activityCounter = 0;
	let activeBatchIds = new Set<string>();
	let aiBoldNoteSaveTimeoutId: number | null = null;

	function syncSelectionWindow(resetToFullRange: boolean = false): void {
		if (resetToFullRange || aiBoldEndTimeMs <= 0 || aiBoldEndTimeMs > totalDurationMs) {
			aiBoldStartTimeMs = 0;
			aiBoldEndTimeMs = totalDurationMs;
			return;
		}

		aiBoldStartTimeMs = Math.max(0, Math.min(aiBoldStartTimeMs, totalDurationMs));
		aiBoldEndTimeMs = Math.max(aiBoldStartTimeMs, Math.min(aiBoldEndTimeMs, totalDurationMs));
	}

	function persistAiBoldRange(): void {
		translationsEditorState().aiBoldStartTimeMs = aiBoldStartTimeMs;
		translationsEditorState().aiBoldEndTimeMs = aiBoldEndTimeMs;
	}

	function queueAiBoldNoteSave(): void {
		if (aiBoldNoteSaveTimeoutId !== null) {
			window.clearTimeout(aiBoldNoteSaveTimeoutId);
		}

		aiBoldNoteSaveTimeoutId = window.setTimeout(() => {
			aiBoldNoteSaveTimeoutId = null;
			void Settings.save();
		}, 250);
	}

	function updateAiBoldCustomNote(value: string): void {
		globalState.settings!.aiTranslationSettings.aiBoldCustomNote = value;
		queueAiBoldNoteSave();
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
				id: `ai-bold-activity-${activityCounter}`,
				batchId,
				step,
				message,
				tone
			},
			...activityLog
		].slice(0, 80);
	}

	function isBlockingError(message: string): boolean {
		return /\b(401|402|403|429|500|502|503|504)\b/.test(message);
	}

	function resetRunState(): void {
		completedBatches = 0;
		successfulBatches = 0;
		failedBatches = 0;
		successfulSegments = 0;
		failedSegments = 0;
		currentBatchId = '';
		currentBatchStep = 'idle';
		currentBatchLabel = '';
		streamedResponse = '';
		latestSummary = '';
		activityLog = [];
		batchUsageById = {};
		activeBatchIds = new Set<string>();
	}

	function handleStatusEvent(event: { payload: StatusEventPayload }): void {
		const payload = event.payload;
		if (!activeBatchIds.has(payload.batchId)) return;
		currentBatchId = payload.batchId;
		currentBatchStep = payload.step;
		addActivity(
			payload.step,
			payload.message,
			payload.step === 'failed' ? 'error' : 'info',
			payload.batchId
		);
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

	function getProgressPercent(): number {
		if (aiBoldBatches().length === 0) return 0;
		return Math.round((completedBatches / aiBoldBatches().length) * 100);
	}

	function getActualUsageSummary(): string {
		const usageList = Object.values(batchUsageById);
		if (usageList.length === 0) return 'Usage unavailable';

		const input = usageList.reduce((total, item) => total + (item.inputTokens ?? 0), 0);
		const output = usageList.reduce((total, item) => total + (item.outputTokens ?? 0), 0);
		const total = usageList.reduce((sum, item) => sum + (item.totalTokens ?? 0), 0);

		return `${input} input / ${output} output / ${total} total tokens`;
	}

	async function runAiBold(): Promise<void> {
		if (isRunning) return;

		const edition = selectedAiBoldEdition();
		if (!edition) {
			toast.error('No visible translation edition is available.');
			return;
		}

		const apiKey = globalState.settings!.aiTranslationSettings.openAiApiKey.trim();
		if (!apiKey) {
			toast.error('Configure your AI API key in Settings > AI Key first.');
			return;
		}

		const endpoint = globalState.settings!.aiTranslationSettings.textAiApiEndpoint.trim();
		if (!endpoint) {
			toast.error('Configure your text AI endpoint in Settings > AI Key first.');
			return;
		}

		if (aiBoldBatches().length === 0) {
			toast.error('No eligible translated segments were found for the selected range.');
			return;
		}

		resetRunState();
		isRunning = true;
		activeBatchIds = new Set<string>(aiBoldBatches().map((batch) => batch.batchId));
		addActivity(
			'queued',
			`Starting AI Bold for ${aiBoldEstimate().totalSegments} segment(s) across ${aiBoldBatches().length} batch(es).`
		);

		const reportLines: string[] = [];
		let blockingFailure = false;

		for (let batchIndex = 0; batchIndex < aiBoldBatches().length; batchIndex++) {
			const batch = aiBoldBatches()[batchIndex];
			currentBatchId = batch.batchId;
			currentBatchLabel = `Batch ${batchIndex + 1} / ${aiBoldBatches().length}`;
			streamedResponse = '';

			addActivity(
				'queued',
				`${currentBatchLabel}: ${batch.segments.length} segment(s), ${batch.wordCount} words.`,
				'info',
				batch.batchId
			);

			try {
				const response = await runAiBoldBatchStreaming({
					apiKey,
					endpoint,
					model: globalState.settings!.aiTranslationSettings.advancedTrimModel,
					reasoningEffort: globalState.settings!.aiTranslationSettings.advancedTrimReasoningEffort,
					batchId: batch.batchId,
					customPromptNote: globalState.settings!.aiTranslationSettings.aiBoldCustomNote,
					batch: batch.request
				});

				streamedResponse = response.rawText;
				addActivity('validating', `Validating ${currentBatchLabel}...`, 'info', batch.batchId);

				const validation = validateAiBoldBatchResult(batch, response.parsed);
				const applyReport = applyAiBoldValidationSuccess(edition, validation.validSegments);
				const validationFailedSegments = batch.segments.length - validation.validSegments.length;

				if (validationFailedSegments === 0 && applyReport.erroredSegments === 0) {
					successfulBatches++;
				} else {
					failedBatches++;
				}

				successfulSegments += applyReport.appliedSegments;
				failedSegments += validationFailedSegments + applyReport.erroredSegments;

				if (applyReport.appliedSegments > 0) {
					addActivity(
						'applied',
						`Applied AI bold to ${applyReport.appliedSegments}/${batch.segments.length} segment(s).`,
						'success',
						batch.batchId
					);
				}

				if (validation.errors.length > 0) {
					reportLines.push(`${currentBatchLabel}`, ...validation.errors);
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
				failedSegments += batch.segments.length;
				const message = error instanceof Error ? error.message : String(error);
				reportLines.push(`${currentBatchLabel}`, message);
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
		latestSummary = `${successfulSegments}/${aiBoldEstimate().totalSegments} segment(s) updated. ${failedSegments} segment(s) had issues.`;

		AnalyticsService.trackAiBoldUsage({
			range: `time ${translationsEditorState().aiBoldStartTimeMs}-${translationsEditorState().aiBoldEndTimeMs}`,
			mode: 'advanced_bold',
			model: globalState.settings!.aiTranslationSettings.advancedTrimModel,
			reasoning_effort: globalState.settings!.aiTranslationSettings.advancedTrimReasoningEffort,
			total_batches: aiBoldBatches().length,
			completed_batches: completedBatches,
			successful_batches: successfulBatches,
			failed_batches: failedBatches,
			total_segments: aiBoldEstimate().totalSegments,
			successful_segments: successfulSegments,
			failed_segments: failedSegments,
			estimated_cost_usd: aiBoldEstimate().totalEstimatedCostUsd,
			include_already_bolded: translationsEditorState().aiBoldIncludeAlreadyBolded,
			custom_note_length:
				globalState.settings!.aiTranslationSettings.aiBoldCustomNote.trim().length,
			edition_key: edition.key,
			edition_name: edition.name,
			edition_author: edition.author,
			edition_language: edition.language
		});

		if (reportLines.length > 0) {
			toast.error('AI Bold completed with issues. See the activity log.');
		} else {
			toast.success('AI Bold applied successfully.');
		}
	}

	onMount(async () => {
		if (
			!globalState.settings!.aiTranslationSettings.aiBoldCustomNote.trim() &&
			translationsEditorState().aiBoldCustomNote.trim()
		) {
			globalState.settings!.aiTranslationSettings.aiBoldCustomNote =
				translationsEditorState().aiBoldCustomNote;
			void Settings.save();
		}

		aiBoldStartTimeMs = translationsEditorState().aiBoldStartTimeMs;
		aiBoldEndTimeMs = translationsEditorState().aiBoldEndTimeMs;
		syncSelectionWindow(true);
		persistAiBoldRange();

		unlistenFns = [
			await listen('advanced-ai-bold-status', handleStatusEvent),
			await listen('advanced-ai-bold-chunk', handleChunkEvent),
			await listen('advanced-ai-bold-complete', handleCompleteEvent)
		];
	});

	onDestroy(() => {
		if (aiBoldNoteSaveTimeoutId !== null) {
			window.clearTimeout(aiBoldNoteSaveTimeoutId);
			aiBoldNoteSaveTimeoutId = null;
			void Settings.save();
		}

		for (const unlisten of unlistenFns) {
			unlisten();
		}
		unlistenFns = [];
	});

	$effect(() => {
		const visible = visibleEditions();
		if (visible.length === 0) return;
		if (!visible.some((edition) => edition.name === translationsEditorState().aiBoldEditionName)) {
			translationsEditorState().aiBoldEditionName = visible[0].name;
		}
	});

	$effect(() => {
		syncSelectionWindow();
		persistAiBoldRange();
	});
</script>

<TranslationsEditorModalShell
	{close}
	title="AI Bold Assistant"
	icon="format_bold"
	shellClass="h-[92vh] xl:h-[84vh] w-[clamp(1180px,94vw,1500px)] max-w-[94vw] xl:max-w-[82vw]"
	bodyClass="flex-1 min-h-0 overflow-hidden grid grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]"
>
	{#snippet subtitle()}
		Choose an edition, a time range, and let your text AI provider return only the word indexes to
		bold.
	{/snippet}

	<div class="min-h-0 overflow-y-auto p-6 space-y-5 border-r border-color">
		<div class="rounded-xl border border-color bg-accent px-4 py-4">
			<div class="flex items-start justify-between gap-4">
				<div>
					<h3 class="text-base font-semibold text-primary">Configuration</h3>
					<p class="mt-1 text-sm text-thirdly leading-relaxed">
						AI Bold replaces existing inline bold for the processed segments only. Italic and
						underline remain untouched.
					</p>
				</div>
				<div class="flex h-10 w-10 items-center justify-center rounded-full bg-secondary">
					<span class="material-icons text-accent-primary">auto_fix_high</span>
				</div>
			</div>
		</div>

		{#if visibleEditions().length === 0}
			<div class="rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-4 text-sm text-red-100">
				No visible translation edition is available in the editor.
			</div>
		{:else}
			<label class="block space-y-2">
				<span class="text-sm font-medium text-secondary">Target edition</span>
				<select
					value={translationsEditorState().aiBoldEditionName}
					onchange={(event) =>
						(translationsEditorState().aiBoldEditionName = (
							event.target as HTMLSelectElement
						).value)}
					class="w-full rounded-lg border border-color bg-secondary px-3 py-2.5 text-sm text-primary"
				>
					{#each visibleEditions() as edition (edition.key)}
						<option value={edition.name}>{edition.language} - {edition.author}</option>
					{/each}
				</select>
			</label>
		{/if}

		<VerseRangeSelector
			{totalDurationMs}
			totalItems={aiBoldCandidates().length}
			selectedItems={selectedAiBoldSegments()}
			title="AI Bold Range"
			icon="schedule"
			totalLabel="eligible segments"
			selectionLabel="Select time range to process:"
			bind:startTimeMs={aiBoldStartTimeMs}
			bind:endTimeMs={aiBoldEndTimeMs}
			onRangeChange={persistAiBoldRange}
		/>

		<label class="block space-y-2">
			<span class="text-sm font-medium text-secondary">Custom note</span>
			<textarea
				value={globalState.settings!.aiTranslationSettings.aiBoldCustomNote}
				oninput={(event) => updateAiBoldCustomNote((event.target as HTMLTextAreaElement).value)}
				onblur={() => void Settings.save()}
				rows="4"
				placeholder="Example: Bold invocations and divine attributes, but keep the emphasis restrained."
				class="w-full resize-y rounded-lg border border-color bg-secondary px-3 py-2 text-sm text-primary"
			></textarea>
			<span class="text-xs text-thirdly">
				This note is saved globally in Settings and appended to the fixed AI instruction. The AI
				still returns indexes only.
			</span>
		</label>

		<label
			class="flex cursor-pointer items-center gap-3 rounded-lg border border-color bg-secondary px-3 py-3"
		>
			<input
				type="checkbox"
				checked={translationsEditorState().aiBoldIncludeAlreadyBolded}
				onchange={(event) =>
					(translationsEditorState().aiBoldIncludeAlreadyBolded = (
						event.target as HTMLInputElement
					).checked)}
				class="h-4 w-4 rounded"
			/>
			<div>
				<div class="text-sm font-medium text-primary">Include already bolded segments</div>
				<div class="text-xs text-thirdly">
					When enabled, AI Bold can replace bold styling on segments that already contain bold.
				</div>
			</div>
		</label>

		<AiBatchOverviewCard
			title="Batch Preview"
			icon="analytics"
			metrics={[
				{ label: 'Segments', value: aiBoldEstimate().totalSegments },
				{ label: 'Words', value: aiBoldEstimate().totalWords },
				{ label: 'Batches', value: aiBoldBatches().length },
				{ label: 'Estimated Cost', value: formatUsd(aiBoldEstimate().totalEstimatedCostUsd) }
			]}
			estimatedCostLabel={formatUsd(aiBoldEstimate().totalEstimatedCostUsd)}
			tokenSummary={`${aiBoldEstimate().totalEstimatedInputTokens} input tokens estimated, ${aiBoldEstimate().totalEstimatedOutputTokens} output tokens estimated.`}
			reasoningNote={aiBoldEstimate().reasoningNote}
			columnsClass="grid-cols-2"
		/>

		<div class="rounded-lg border border-color bg-secondary px-3 py-3 text-xs text-thirdly">
			Targeting <span class="font-semibold text-primary">{selectedAiBoldEdition()?.author}</span>
			({selectedAiBoldEdition()?.language}).
		</div>

		<div class="rounded-xl border border-color bg-secondary px-4 py-4">
			<div class="flex items-start gap-3">
				<div class="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
					<span class="material-icons text-accent-primary">settings</span>
				</div>
				<div class="space-y-1">
					<div class="text-sm font-semibold text-primary">AI Provider</div>
					<p class="text-sm leading-relaxed text-thirdly">
						Configure your API key, text endpoint, model, and reasoning effort in Settings &gt; AI
						Key before running AI Bold.
					</p>
					<div class="text-xs text-thirdly">
						Current model:
						<span class="font-medium text-primary">
							{globalState.settings!.aiTranslationSettings.advancedTrimModel || 'Not set'}
						</span>
					</div>
					<div class="text-xs text-thirdly break-all">
						Endpoint:
						<span class="font-medium text-primary">
							{globalState.settings!.aiTranslationSettings.textAiApiEndpoint || 'Not set'}
						</span>
					</div>
				</div>
			</div>
		</div>
	</div>

	<div class="min-h-0 overflow-y-auto p-6 space-y-5 bg-primary/30">
		<div class="rounded-xl border border-color bg-secondary px-4 py-4">
			<div class="flex items-start justify-between gap-4">
				<div>
					<h3 class="text-base font-semibold text-primary">Run</h3>
					<p class="mt-1 text-sm text-thirdly leading-relaxed">
						The AI receives Arabic text plus indexed translation words and must return JSON word
						indexes only.
					</p>
				</div>
				<button
					class="rounded-lg bg-[var(--accent-primary)] w-52 px-4 py-2.5 text-sm font-semibold text-black transition-all duration-200 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55"
					onclick={runAiBold}
					disabled={isRunning || aiBoldBatches().length === 0 || visibleEditions().length === 0}
				>
					{isRunning ? 'Running AI Bold...' : 'Run AI Bold'}
				</button>
			</div>
		</div>

		<AiRunStatusCard
			title={isRunning ? 'AI Bold in progress' : 'Latest AI Bold run'}
			subtitle={isRunning
				? `${currentBatchLabel || 'Preparing batches...'}`
				: latestSummary || 'No summary yet.'}
			progressPercent={getProgressPercent()}
			metrics={[
				{ label: 'Successful segments', value: successfulSegments },
				{ label: 'Failed segments', value: failedSegments },
				{ label: 'Successful batches', value: successfulBatches },
				{ label: 'Usage', value: getActualUsageSummary() }
			]}
			columnsClass="grid-cols-2"
		/>

		{#if streamedResponse}
			<div class="rounded-xl border border-color bg-secondary p-4">
				<div class="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-thirdly">
					Latest streamed JSON
				</div>
				<div
					class="max-h-48 overflow-y-auto rounded-lg border border-color bg-accent px-3 py-2 text-[12px] leading-5 [font-family:Consolas,monospace]"
				>
					<pre class="whitespace-pre-wrap break-words text-secondary">{streamedResponse}</pre>
				</div>
			</div>
		{/if}

		<AiActivityLogCard {activityLog} maxHeightClass="max-h-[420px]" />
	</div>
</TranslationsEditorModalShell>
