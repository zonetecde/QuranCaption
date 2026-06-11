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
		applyAiWbwTranslationValidationSuccess,
		buildAiWbwTranslationBatches,
		buildAiWbwTranslationCandidates,
		estimateAiWbwTranslationCost,
		runAiWbwTranslationBatchStreaming,
		validateAiWbwTranslationBatchResult,
		type AiWbwTranslationCandidate
	} from '$lib/services/AiWbwTranslationMappingService';
	import { formatUsd } from '$lib/services/AdvancedAITrimming';
	import { AnalyticsService } from '$lib/services/AnalyticsService';
	import { globalState } from '$lib/runes/main.svelte';
	import { onDestroy, onMount } from 'svelte';
	import toast from 'svelte-5-french-toast';
	import LL from '$lib/i18n/i18n-svelte';
	import { get } from 'svelte/store';

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

	const selectedAiWbwTranslationEdition = $derived(
		() =>
			visibleEditions().find(
				(edition) => edition.name === translationsEditorState().aiWbwTranslationEditionName
			) ?? visibleEditions()[0]
	);

	const totalDurationMs = $derived(
		Math.max(
			globalState.getAudioTrack?.getDuration().ms ||
				globalState.getSubtitleTrack?.getDuration().ms ||
				0,
			1
		)
	);

	let aiWbwTranslationCandidates: AiWbwTranslationCandidate[] = $state([]);
	let isLoadingCandidates = $state(false);
	let candidatesRequestId = 0;

	const aiWbwTranslationBatches = $derived(() =>
		buildAiWbwTranslationBatches(
			aiWbwTranslationCandidates,
			globalState.settings!.aiTranslationSettings.advancedTrimModel,
			globalState.settings!.aiTranslationSettings.advancedTrimReasoningEffort,
			translationsEditorState().aiWbwTranslationStartTimeMs,
			translationsEditorState().aiWbwTranslationEndTimeMs
		)
	);

	const aiWbwTranslationEstimate = $derived(() =>
		estimateAiWbwTranslationCost(
			aiWbwTranslationBatches(),
			globalState.settings!.aiTranslationSettings.advancedTrimReasoningEffort
		)
	);

	const selectedAiWbwTranslationSegments = $derived(
		() =>
			aiWbwTranslationCandidates.filter(
				(candidate) =>
					candidate.startTime <= translationsEditorState().aiWbwTranslationEndTimeMs &&
					candidate.endTime >= translationsEditorState().aiWbwTranslationStartTimeMs
			).length
	);

	let isRunning = $state(false);
	let aiWbwTranslationStartTimeMs = $state(0);
	let aiWbwTranslationEndTimeMs = $state(0);
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
	let aiWbwTranslationNoteSaveTimeoutId: number | null = null;

	/**
	 * Synchronise la plage sélectionnée avec la durée disponible.
	 *
	 * @param {boolean} resetToFullRange Force la sélection de toute la timeline.
	 * @returns {void}
	 */
	function syncSelectionWindow(resetToFullRange: boolean = false): void {
		if (
			resetToFullRange ||
			aiWbwTranslationEndTimeMs <= 0 ||
			aiWbwTranslationEndTimeMs > totalDurationMs
		) {
			aiWbwTranslationStartTimeMs = 0;
			aiWbwTranslationEndTimeMs = totalDurationMs;
			return;
		}

		aiWbwTranslationStartTimeMs = Math.max(
			0,
			Math.min(aiWbwTranslationStartTimeMs, totalDurationMs)
		);
		aiWbwTranslationEndTimeMs = Math.max(
			aiWbwTranslationStartTimeMs,
			Math.min(aiWbwTranslationEndTimeMs, totalDurationMs)
		);
	}

	/**
	 * Persiste la plage temporelle du modal dans l'état projet.
	 *
	 * @returns {void}
	 */
	function persistAiWbwTranslationRange(): void {
		translationsEditorState().aiWbwTranslationStartTimeMs = aiWbwTranslationStartTimeMs;
		translationsEditorState().aiWbwTranslationEndTimeMs = aiWbwTranslationEndTimeMs;
	}

	/**
	 * Programme une sauvegarde différée de la note IA globale.
	 *
	 * @returns {void}
	 */
	function queueAiWbwTranslationNoteSave(): void {
		if (aiWbwTranslationNoteSaveTimeoutId !== null) {
			window.clearTimeout(aiWbwTranslationNoteSaveTimeoutId);
		}

		aiWbwTranslationNoteSaveTimeoutId = window.setTimeout(() => {
			aiWbwTranslationNoteSaveTimeoutId = null;
			void Settings.save();
		}, 250);
	}

	/**
	 * Met à jour la note personnalisée utilisée par l'assistant WBW traduction.
	 *
	 * @param {string} value Nouvelle note utilisateur.
	 * @returns {void}
	 */
	function updateAiWbwTranslationCustomNote(value: string): void {
		globalState.settings!.aiTranslationSettings.aiWbwTranslationCustomNote = value;
		queueAiWbwTranslationNoteSave();
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
		batchId: string = currentBatchId
	): void {
		activityCounter += 1;
		activityLog = [
			{
				id: `ai-wbw-translation-activity-${activityCounter}`,
				batchId,
				step,
				message,
				tone
			},
			...activityLog
		].slice(0, 80);
	}

	/**
	 * Détecte les erreurs provider qui doivent interrompre les batches suivants.
	 *
	 * @param {string} message Message d'erreur reçu.
	 * @returns {boolean} `true` si l'erreur est bloquante.
	 */
	function isBlockingError(message: string): boolean {
		return /\b(401|402|403|429|500|502|503|504)\b/.test(message);
	}

	/**
	 * Réinitialise l'état local avant un nouveau run IA.
	 *
	 * @returns {void}
	 */
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

	/**
	 * Traite les événements de statut Tauri pour les batches actifs.
	 *
	 * @param {{ payload: StatusEventPayload }} event Événement Tauri.
	 * @returns {void}
	 */
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

	/**
	 * Met à jour la réponse streamée affichée dans le modal.
	 *
	 * @param {{ payload: ChunkEventPayload }} event Événement Tauri.
	 * @returns {void}
	 */
	function handleChunkEvent(event: { payload: ChunkEventPayload }): void {
		const payload = event.payload;
		if (!activeBatchIds.has(payload.batchId)) return;
		if (payload.batchId !== currentBatchId) return;
		streamedResponse = payload.accumulatedText;
	}

	/**
	 * Capture la réponse finale et l'usage d'un batch terminé.
	 *
	 * @param {{ payload: CompleteEventPayload }} event Événement Tauri.
	 * @returns {void}
	 */
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

	/**
	 * Calcule la progression globale du run.
	 *
	 * @returns {number} Pourcentage de progression.
	 */
	function getProgressPercent(): number {
		if (aiWbwTranslationBatches().length === 0) return 0;
		return Math.round((completedBatches / aiWbwTranslationBatches().length) * 100);
	}

	/**
	 * Résume l'usage tokens réellement retourné par le provider.
	 *
	 * @returns {string} Résumé localisé de l'usage.
	 */
	function getActualUsageSummary(): string {
		const usageList = Object.values(batchUsageById);
		if (usageList.length === 0) return get(LL).editor.usageUnavailable();

		const input = usageList.reduce((total, item) => total + (item.inputTokens ?? 0), 0);
		const output = usageList.reduce((total, item) => total + (item.outputTokens ?? 0), 0);
		const total = usageList.reduce((sum, item) => sum + (item.totalTokens ?? 0), 0);

		return get(LL).editor.tokenUsageSummary({ input, output, total });
	}

	/**
	 * Lance l'assistant IA et applique les mappings WBW traduction validés.
	 *
	 * @returns {Promise<void>} Promesse résolue après la fin du run.
	 */
	async function runAiWbwTranslation(): Promise<void> {
		if (isRunning) return;

		const edition = selectedAiWbwTranslationEdition();
		if (!edition) {
			toast.error(get(LL).editor.noVisibleTranslation());
			return;
		}

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

		if (aiWbwTranslationBatches().length === 0) {
			toast.error(get(LL).editor.noEligibleTranslatedSegments());
			return;
		}

		resetRunState();
		isRunning = true;
		activeBatchIds = new Set<string>(aiWbwTranslationBatches().map((batch) => batch.batchId));
		addActivity(
			'queued',
			get(LL).editor.aiWbwTranslationStarting({
				segments: aiWbwTranslationEstimate().totalSegments,
				batches: aiWbwTranslationBatches().length
			})
		);

		const reportLines: string[] = [];
		let blockingFailure = false;

		for (let batchIndex = 0; batchIndex < aiWbwTranslationBatches().length; batchIndex++) {
			const batch = aiWbwTranslationBatches()[batchIndex];
			currentBatchId = batch.batchId;
			currentBatchLabel = get(LL).editor.batchProgress({
				current: batchIndex + 1,
				total: aiWbwTranslationBatches().length
			});
			streamedResponse = '';

			addActivity(
				'queued',
				get(LL).editor.aiWbwTranslationBatchQueued({
					label: currentBatchLabel,
					segments: batch.segments.length,
					words: batch.wordCount
				}),
				'info',
				batch.batchId
			);

			try {
				const response = await runAiWbwTranslationBatchStreaming({
					apiKey,
					endpoint,
					model: globalState.settings!.aiTranslationSettings.advancedTrimModel,
					reasoningEffort: globalState.settings!.aiTranslationSettings.advancedTrimReasoningEffort,
					batchId: batch.batchId,
					customPromptNote: globalState.settings!.aiTranslationSettings.aiWbwTranslationCustomNote,
					batch: batch.request
				});

				streamedResponse = response.rawText;
				addActivity(
					'validating',
					get(LL).editor.validatingBatch({ label: currentBatchLabel }),
					'info',
					batch.batchId
				);

				const validation = validateAiWbwTranslationBatchResult(batch, response.parsed);
				const applyReport = applyAiWbwTranslationValidationSuccess(
					edition,
					validation.validSegments
				);
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
						get(LL).editor.aiWbwTranslationAppliedSegments({
							applied: applyReport.appliedSegments,
							total: batch.segments.length
						}),
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
		latestSummary = get(LL).editor.aiWbwTranslationRunSummary({
			successful: successfulSegments,
			total: aiWbwTranslationEstimate().totalSegments,
			failed: failedSegments
		});

		AnalyticsService.trackAiBoldUsage({
			range: `time ${translationsEditorState().aiWbwTranslationStartTimeMs}-${translationsEditorState().aiWbwTranslationEndTimeMs}`,
			mode: 'advanced_wbw_translation',
			model: globalState.settings!.aiTranslationSettings.advancedTrimModel,
			reasoning_effort: globalState.settings!.aiTranslationSettings.advancedTrimReasoningEffort,
			total_batches: aiWbwTranslationBatches().length,
			completed_batches: completedBatches,
			successful_batches: successfulBatches,
			failed_batches: failedBatches,
			total_segments: aiWbwTranslationEstimate().totalSegments,
			successful_segments: successfulSegments,
			failed_segments: failedSegments,
			estimated_cost_usd: aiWbwTranslationEstimate().totalEstimatedCostUsd,
			custom_note_length:
				globalState.settings!.aiTranslationSettings.aiWbwTranslationCustomNote.trim().length,
			edition_key: edition.key,
			edition_name: edition.name,
			edition_author: edition.author,
			edition_language: edition.language
		});

		if (reportLines.length > 0) {
			toast.error(get(LL).editor.aiWbwTranslationCompletedWithIssues());
		} else {
			toast.success(get(LL).editor.aiWbwTranslationApplied());
		}
	}

	onMount(async () => {
		aiWbwTranslationStartTimeMs = translationsEditorState().aiWbwTranslationStartTimeMs;
		aiWbwTranslationEndTimeMs = translationsEditorState().aiWbwTranslationEndTimeMs;
		syncSelectionWindow(true);
		persistAiWbwTranslationRange();

		unlistenFns = [
			await listen('advanced-ai-wbw-translation-status', handleStatusEvent),
			await listen('advanced-ai-wbw-translation-chunk', handleChunkEvent),
			await listen('advanced-ai-wbw-translation-complete', handleCompleteEvent)
		];
	});

	onDestroy(() => {
		if (aiWbwTranslationNoteSaveTimeoutId !== null) {
			window.clearTimeout(aiWbwTranslationNoteSaveTimeoutId);
			aiWbwTranslationNoteSaveTimeoutId = null;
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
		if (
			!visible.some(
				(edition) => edition.name === translationsEditorState().aiWbwTranslationEditionName
			)
		) {
			translationsEditorState().aiWbwTranslationEditionName = visible[0].name;
		}
	});

	$effect(() => {
		const edition = selectedAiWbwTranslationEdition();
		const helperLanguage = globalState.settings?.persistentUiState.wbwTranslationLanguage ?? 'en';
		const requestId = ++candidatesRequestId;

		if (!edition) {
			aiWbwTranslationCandidates = [];
			return;
		}

		isLoadingCandidates = true;
		void buildAiWbwTranslationCandidates(edition, helperLanguage)
			.then((candidates) => {
				if (requestId !== candidatesRequestId) return;
				aiWbwTranslationCandidates = candidates;
			})
			.catch((error) => {
				if (requestId !== candidatesRequestId) return;
				aiWbwTranslationCandidates = [];
				addActivity(
					'failed',
					error instanceof Error ? error.message : String(error),
					'error',
					'candidate-build'
				);
			})
			.finally(() => {
				if (requestId === candidatesRequestId) {
					isLoadingCandidates = false;
				}
			});
	});

	$effect(() => {
		syncSelectionWindow();
		persistAiWbwTranslationRange();
	});
</script>

<TranslationsEditorModalShell
	{close}
	title={$LL.editor.aiWbwTranslationAssistant()}
	icon="auto_fix_high"
	shellClass="h-[92vh] xl:h-[84vh] w-[clamp(1180px,94vw,1500px)] max-w-[94vw] xl:max-w-[82vw]"
	bodyClass="flex-1 min-h-0 overflow-hidden grid grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]"
>
	{#snippet subtitle()}
		{$LL.editor.aiWbwTranslationSubtitle()}
	{/snippet}

	<div class="min-h-0 overflow-y-auto p-6 space-y-5 border-r border-color">
		<div class="rounded-xl border border-color bg-accent px-4 py-4">
			<div class="flex items-start justify-between gap-4">
				<div>
					<h3 class="text-base font-semibold text-primary">{$LL.editor.configuration()}</h3>
					<p class="mt-1 text-sm text-thirdly leading-relaxed">
						{$LL.editor.aiWbwTranslationConfigDescription()}
					</p>
				</div>
				<div class="flex h-10 w-10 items-center justify-center rounded-full bg-secondary">
					<span class="material-icons text-accent-primary">link</span>
				</div>
			</div>
		</div>

		{#if visibleEditions().length === 0}
			<div class="rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-4 text-sm text-red-100">
				{$LL.editor.noVisibleTranslation()}
			</div>
		{:else}
			<label class="block space-y-2">
				<span class="text-sm font-medium text-secondary">{$LL.editor.targetEdition()}</span>
				<select
					value={translationsEditorState().aiWbwTranslationEditionName}
					onchange={(event) =>
						(translationsEditorState().aiWbwTranslationEditionName = (
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
			totalItems={aiWbwTranslationCandidates.length}
			selectedItems={selectedAiWbwTranslationSegments()}
			title={$LL.editor.aiWbwTranslationRange()}
			icon="schedule"
			totalLabel={$LL.editor.eligibleSegments()}
			selectionLabel={$LL.editor.selectTimeRangeToProcess()}
			selectionHint=""
			bind:startTimeMs={aiWbwTranslationStartTimeMs}
			bind:endTimeMs={aiWbwTranslationEndTimeMs}
			onRangeChange={persistAiWbwTranslationRange}
		/>

		<label class="block space-y-2">
			<span class="text-sm font-medium text-secondary">{$LL.editor.customNote()}</span>
			<textarea
				value={globalState.settings!.aiTranslationSettings.aiWbwTranslationCustomNote}
				oninput={(event) =>
					updateAiWbwTranslationCustomNote((event.target as HTMLTextAreaElement).value)}
				onblur={() => void Settings.save()}
				rows="4"
				placeholder={$LL.editor.aiWbwTranslationCustomNotePlaceholder()}
				class="w-full resize-y rounded-lg border border-color bg-secondary px-3 py-2 text-sm text-primary"
			></textarea>
			<span class="text-xs text-thirdly">
				{$LL.editor.aiWbwTranslationCustomNoteHint()}
			</span>
		</label>

		<AiBatchOverviewCard
			title={$LL.editor.batchPreview()}
			icon="analytics"
			metrics={[
				{ label: $LL.editor.segments(), value: aiWbwTranslationEstimate().totalSegments },
				{ label: $LL.editor.words(), value: aiWbwTranslationEstimate().totalWords },
				{ label: $LL.editor.batches(), value: aiWbwTranslationBatches().length },
				{
					label: $LL.editor.estimatedCostShort(),
					value: formatUsd(aiWbwTranslationEstimate().totalEstimatedCostUsd)
				}
			]}
			estimatedCostLabel={formatUsd(aiWbwTranslationEstimate().totalEstimatedCostUsd)}
			tokenSummary={$LL.editor.estimatedTokenSummary({
				input: aiWbwTranslationEstimate().totalEstimatedInputTokens,
				output: aiWbwTranslationEstimate().totalEstimatedOutputTokens
			})}
			reasoningNote={aiWbwTranslationEstimate().reasoningNote}
			columnsClass="grid-cols-2"
		/>

		<div class="rounded-lg border border-color bg-secondary px-3 py-3 text-xs text-thirdly">
			{$LL.editor.targetingEdition({
				author: selectedAiWbwTranslationEdition()?.author ?? '',
				language: selectedAiWbwTranslationEdition()?.language ?? ''
			})}
		</div>

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
							{globalState.settings!.aiTranslationSettings.advancedTrimModel || $LL.editor.notSet()}
						</span>
					</div>
					<div class="text-xs text-thirdly break-all">
						{$LL.editor.endpoint()}:
						<span class="font-medium text-primary">
							{globalState.settings!.aiTranslationSettings.textAiApiEndpoint || $LL.editor.notSet()}
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
					<h3 class="text-base font-semibold text-primary">{$LL.editor.run()}</h3>
					<p class="mt-1 text-sm text-thirdly leading-relaxed">
						{$LL.editor.aiWbwTranslationRunDescription()}
					</p>
				</div>
				<button
					class="rounded-lg bg-[var(--accent-primary)] w-56 px-4 py-2.5 text-sm font-semibold text-black transition-all duration-200 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55"
					onclick={runAiWbwTranslation}
					disabled={isRunning ||
						isLoadingCandidates ||
						aiWbwTranslationBatches().length === 0 ||
						visibleEditions().length === 0}
				>
					{#if isRunning}
						{$LL.editor.runningAiWbwTranslation()}
					{:else if isLoadingCandidates}
						{$LL.editor.loadingSegments()}
					{:else}
						{$LL.editor.runAiWbwTranslation()}
					{/if}
				</button>
			</div>
		</div>

		<AiRunStatusCard
			title={isRunning
				? $LL.editor.aiWbwTranslationInProgress()
				: $LL.editor.latestAiWbwTranslationRun()}
			subtitle={isRunning
				? `${currentBatchLabel || $LL.editor.preparingBatches()}`
				: latestSummary || $LL.editor.noSummaryYet()}
			progressPercent={getProgressPercent()}
			metrics={[
				{ label: $LL.editor.successfulSegments(), value: successfulSegments },
				{ label: $LL.editor.failedSegments(), value: failedSegments },
				{ label: $LL.editor.successfulBatches(), value: successfulBatches },
				{ label: $LL.editor.usage(), value: getActualUsageSummary() }
			]}
			columnsClass="grid-cols-2"
		/>

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

		<AiActivityLogCard {activityLog} maxHeightClass="max-h-[420px]" />
	</div>
</TranslationsEditorModalShell>
