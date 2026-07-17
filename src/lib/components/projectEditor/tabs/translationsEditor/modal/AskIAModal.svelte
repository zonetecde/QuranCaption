<script lang="ts">
	import { listen, type UnlistenFn } from '@tauri-apps/api/event';
	import type { Edition } from '$lib/classes';
	import Settings, { type IslamicTermTranslationMode } from '$lib/classes/Settings.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import {
		applyAIProjectTranslationResults,
		buildAIProjectTranslationBatches,
		estimateAIProjectTranslationBatchCount,
		getEligibleAIProjectTranslationSubtitles,
		runAIProjectTranslationBatchStreaming,
		validateAIProjectTranslationBatch,
		type AIProjectTranslationOptions,
		type AIProjectTranslationSuccess
	} from '$lib/services/AIProjectTranslationService';
	import { onDestroy, tick } from 'svelte';
	import { get } from 'svelte/store';
	import TranslationsEditorModalShell from './shared/TranslationsEditorModalShell.svelte';

	type TranslationCopy = {
		aiTranslationTitle: () => string;
		aiTranslationSubtitle: (args: { language: string }) => string;
		aiTranslationEligibleCount: (args: { count: number }) => string;
		aiTranslationBatchSize: () => string;
		aiTranslationBatchPreview: (args: { count: number }) => string;
		aiTranslationIslamicTerms: () => string;
		aiTranslationIslamicTermsDescription: () => string;
		aiTranslationTermsTranslated: () => string;
		aiTranslationTermsBoth: () => string;
		aiTranslationTermsTransliterated: () => string;
		aiTranslationNoEligible: () => string;
		aiTranslationRetryErrors: () => string;
		aiTranslationOverwriteAi: () => string;
		aiTranslationOverwriteReviewed: () => string;
		aiTranslationOverwriteManualQuran: () => string;
		aiTranslationStart: () => string;
		aiTranslationPreparing: () => string;
		aiTranslationBatchProgress: (args: { current: number; total: number }) => string;
		aiTranslationCompleted: (args: { count: number }) => string;
		aiTranslationFailed: (args: { count: number }) => string;
		aiTranslationProviderMissing: () => string;
		aiReasoningModeLabel: () => string;
		aiReasoningNone: () => string;
		aiReasoningLow: () => string;
		aiReasoningMedium: () => string;
		aiReasoningHigh: () => string;
	};

	type ReasoningEffort = 'none' | 'low' | 'medium' | 'high';
	type StreamEventPayload = {
		batchId: string;
		accumulatedText: string;
	};
	const PROJECT_TRANSLATION_CONCURRENCY = 3;

	let { close, edition }: { close: () => void; edition: Edition } = $props();
	const copy = get(LL).translations as unknown as TranslationCopy;
	let options = $state<AIProjectTranslationOptions>({
		retryErrors: true,
		overwriteAiTranslated: true,
		overwriteReviewed: true,
		overwriteManualQuran: true
	});
	let isRunning = $state(false);
	let hasFinished = $state(false);
	let completedBatches = $state(0);
	let totalBatches = $state(0);
	let translatedSubtitles = $state(0);
	let failedSubtitles = $state(0);
	let errors = $state<string[]>([]);
	let currentMessage = $state('');
	let currentBatchId = $state('');
	let streamedResponse = $state('');
	let streamedReasoning = $state('');
	let reasoningTextarea = $state<HTMLTextAreaElement>();
	let responseTextarea = $state<HTMLTextAreaElement>();
	let unlistenFns: UnlistenFn[] = [];

	const settings = $derived(() => globalState.settings!.aiTranslationSettings);
	const providerConfigured = $derived(
		() =>
			settings().openAiApiKey.trim().length > 0 &&
			settings().textAiApiEndpoint.trim().length > 0 &&
			settings().advancedTrimModel.trim().length > 0
	);
	const eligibleCount = $derived(
		() => getEligibleAIProjectTranslationSubtitles(edition, options).length
	);
	const progressPercent = $derived(() =>
		totalBatches > 0 ? Math.round((completedBatches / totalBatches) * 100) : 0
	);
	const estimatedBatchCount = $derived(() =>
		estimateAIProjectTranslationBatchCount(
			edition,
			options,
			settings().projectTranslationBatchWords
		)
	);

	$effect(() => {
		if (!streamedReasoning) return;
		void tick().then(() => {
			if (reasoningTextarea) reasoningTextarea.scrollTop = reasoningTextarea.scrollHeight;
		});
	});

	$effect(() => {
		if (!streamedResponse) return;
		void tick().then(() => {
			if (responseTextarea) responseTextarea.scrollTop = responseTextarea.scrollHeight;
		});
	});

	/**
	 * Ferme le modal uniquement lorsqu'aucune traduction n'est en cours.
	 * @returns {void}
	 */
	function closeSafely(): void {
		if (!isRunning) close();
	}

	/**
	 * Met à jour et sauvegarde l'effort de raisonnement utilisé par le provider texte.
	 * @param {ReasoningEffort} value Nouvel effort de raisonnement.
	 * @returns {void}
	 */
	function updateReasoningMode(value: ReasoningEffort): void {
		settings().advancedTrimReasoningEffort = value;
		void Settings.save();
	}

	/**
	 * Sauvegarde la taille de batch de traduction choisie par l'utilisateur.
	 * @returns {void}
	 */
	function saveBatchSize(): void {
		void Settings.save();
	}

	/**
	 * Sauvegarde la présentation choisie pour les termes islamiques arabes.
	 * @param {IslamicTermTranslationMode} value Mode de traduction choisi.
	 * @returns {void}
	 */
	function updateIslamicTermMode(value: IslamicTermTranslationMode): void {
		settings().projectTranslationIslamicTerms = value;
		void Settings.save();
	}

	/**
	 * Met à jour la taille de batch affichée pendant le déplacement du slider.
	 * @param {string} value Valeur brute du contrôle range.
	 * @returns {void}
	 */
	function updateBatchSize(value: string): void {
		settings().projectTranslationBatchWords = Number(value);
	}

	/**
	 * Arrête les écouteurs de streaming actifs.
	 * @returns {void}
	 */
	function stopStreamListeners(): void {
		for (const unlisten of unlistenFns) unlisten();
		unlistenFns = [];
	}

	/**
	 * Écoute le raisonnement et la réponse streamés du batch actif.
	 * @returns {Promise<void>} Promesse résolue lorsque les écouteurs sont installés.
	 */
	async function startStreamListeners(): Promise<void> {
		stopStreamListeners();
		unlistenFns = [
			await listen<StreamEventPayload>('ai-project-translation-reasoning', (event) => {
				if (event.payload.batchId === currentBatchId) {
					streamedReasoning = event.payload.accumulatedText;
				}
			}),
			await listen<StreamEventPayload>('ai-project-translation-chunk', (event) => {
				if (event.payload.batchId === currentBatchId) {
					streamedResponse = event.payload.accumulatedText;
				}
			})
		];
	}

	onDestroy(stopStreamListeners);

	/**
	 * Traduit les batches avec une concurrence limitée puis applique les résultats dans leur ordre initial.
	 * @returns {Promise<void>} Promesse résolue après l'application ou l'échec du workflow.
	 */
	async function translateVideo(): Promise<void> {
		if (isRunning || !providerConfigured()) return;
		isRunning = true;
		hasFinished = false;
		completedBatches = 0;
		totalBatches = 0;
		translatedSubtitles = 0;
		failedSubtitles = 0;
		errors = [];
		currentBatchId = '';
		streamedResponse = '';
		streamedReasoning = '';
		currentMessage = copy.aiTranslationPreparing();

		try {
			await startStreamListeners();
			const batches = await buildAIProjectTranslationBatches(
				edition,
				options,
				settings().projectTranslationBatchWords
			);
			totalBatches = batches.length;
			if (batches.length === 0) {
				currentMessage = copy.aiTranslationNoEligible();
				return;
			}

			const batchSuccesses: AIProjectTranslationSuccess[][] = batches.map(() => []);
			const batchErrors: string[][] = batches.map(() => []);
			const batchFailures = batches.map(() => 0);
			let nextBatchIndex = 0;

			/**
			 * Consomme les batches disponibles jusqu'à épuisement de la file partagée.
			 * @returns {Promise<void>} Promesse résolue lorsque ce worker n'a plus de batch.
			 */
			async function runTranslationWorker(): Promise<void> {
				while (nextBatchIndex < batches.length) {
					const batchIndex = nextBatchIndex;
					nextBatchIndex += 1;
					const batch = batches[batchIndex];
					currentBatchId = batch.batchId;
					streamedResponse = '';
					streamedReasoning = '';
					currentMessage = copy.aiTranslationBatchProgress({
						current: batchIndex + 1,
						total: batches.length
					});
					try {
						const response = await runAIProjectTranslationBatchStreaming({
							apiKey: settings().openAiApiKey,
							endpoint: settings().textAiApiEndpoint,
							model: settings().advancedTrimModel,
							reasoningEffort: settings().advancedTrimReasoningEffort,
							targetLanguage: edition.language,
							islamicTermMode: settings().projectTranslationIslamicTerms,
							batch
						});
						if (currentBatchId === batch.batchId) streamedResponse = response.rawText;
						const validation = validateAIProjectTranslationBatch(batch, response.parsed);
						batchSuccesses[batchIndex] = validation.validItems;
						batchErrors[batchIndex] = validation.errors;
						batchFailures[batchIndex] = batch.candidates.length - validation.validItems.length;
					} catch (error) {
						batchFailures[batchIndex] = batch.candidates.length;
						batchErrors[batchIndex] = [error instanceof Error ? error.message : String(error)];
					}
					completedBatches += 1;
				}
			}

			await Promise.all(
				Array.from({ length: Math.min(PROJECT_TRANSLATION_CONCURRENCY, batches.length) }, () =>
					runTranslationWorker()
				)
			);
			const successes = batchSuccesses.flat();
			errors = batchErrors.flat();
			failedSubtitles = batchFailures.reduce((total, count) => total + count, 0);

			if (successes.length > 0) {
				translatedSubtitles = applyAIProjectTranslationResults(
					edition,
					successes,
					options
				).appliedSubtitles;
				try {
					await globalState.currentProject?.save(false);
				} catch (error) {
					errors = [...errors, error instanceof Error ? error.message : String(error)];
				}
			}
			currentMessage = copy.aiTranslationCompleted({
				count: translatedSubtitles
			});
		} catch (error) {
			failedSubtitles = eligibleCount();
			errors = [...errors, error instanceof Error ? error.message : String(error)];
			currentMessage = copy.aiTranslationFailed({ count: failedSubtitles });
		} finally {
			stopStreamListeners();
			isRunning = false;
			hasFinished = true;
		}
	}
</script>

<TranslationsEditorModalShell
	close={closeSafely}
	title={copy.aiTranslationTitle()}
	icon="auto_awesome"
	shellClass="w-[720px] max-w-[94vw] max-h-[88vh]"
	bodyClass="min-h-0 overflow-y-auto"
>
	{#snippet subtitle()}
		{copy.aiTranslationSubtitle({ language: edition.language })}
	{/snippet}

	<div class="space-y-5 p-5">
		<div class="grid grid-cols-2 gap-3">
			<div class="rounded-lg border border-color bg-accent p-3">
				<p class="text-xs text-thirdly">{$LL.translations.aiModelLabel()}</p>
				<p class="mt-1 truncate text-sm font-medium text-primary">
					{settings().advancedTrimModel || '—'}
				</p>
			</div>
			<div class="rounded-lg border border-color bg-accent p-3">
				<label class="block text-xs text-thirdly" for="ai-translation-reasoning-mode">
					{copy.aiReasoningModeLabel()}
				</label>
				<select
					id="ai-translation-reasoning-mode"
					class="mt-1 w-full rounded-md border border-color bg-secondary px-2 py-1.5 text-sm font-medium text-primary"
					value={settings().advancedTrimReasoningEffort}
					disabled={isRunning}
					onchange={(event) => updateReasoningMode(event.currentTarget.value as ReasoningEffort)}
				>
					<option value="none">{copy.aiReasoningNone()}</option>
					<option value="low">{copy.aiReasoningLow()}</option>
					<option value="medium">{copy.aiReasoningMedium()}</option>
					<option value="high">{copy.aiReasoningHigh()}</option>
				</select>
			</div>
		</div>

		<div class="rounded-lg border border-color bg-accent p-3">
			<label class="block text-sm font-medium text-primary" for="ai-translation-islamic-terms">
				{copy.aiTranslationIslamicTerms()}
			</label>
			<p class="mt-1 text-xs text-secondary">{copy.aiTranslationIslamicTermsDescription()}</p>
			<select
				id="ai-translation-islamic-terms"
				class="mt-3 w-full rounded-md border border-color bg-secondary px-3 py-2 text-sm text-primary"
				value={settings().projectTranslationIslamicTerms}
				disabled={isRunning}
				onchange={(event) =>
					updateIslamicTermMode(event.currentTarget.value as IslamicTermTranslationMode)}
			>
				<option value="translated">{copy.aiTranslationTermsTranslated()}</option>
				<option value="both">{copy.aiTranslationTermsBoth()}</option>
				<option value="transliterated">{copy.aiTranslationTermsTransliterated()}</option>
			</select>
		</div>

		<div class="rounded-lg border border-color bg-accent p-3">
			<div class="flex items-center justify-between gap-3">
				<span class="text-sm font-medium text-primary">{copy.aiTranslationBatchSize()}</span>
				<span class="text-sm font-bold text-accent-primary">
					{settings().projectTranslationBatchWords}
				</span>
			</div>
			<input
				type="range"
				min="160"
				max="640"
				step="10"
				class="mt-3 w-full"
				value={settings().projectTranslationBatchWords}
				disabled={isRunning}
				oninput={(event) => updateBatchSize(event.currentTarget.value)}
				onchange={saveBatchSize}
			/>
			<p class="mt-2 text-xs text-secondary">
				{copy.aiTranslationBatchPreview({ count: estimatedBatchCount() })}
			</p>
		</div>

		{#if !providerConfigured()}
			<div class="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
				{copy.aiTranslationProviderMissing()}
			</div>
		{/if}

		<div class="rounded-lg border border-color bg-accent p-4">
			<p class="text-sm font-semibold text-primary">
				{copy.aiTranslationEligibleCount({ count: eligibleCount() })}
			</p>
			<div class="mt-3 grid gap-2 text-sm text-secondary sm:grid-cols-2">
				<label class="flex cursor-pointer items-center gap-2">
					<input type="checkbox" bind:checked={options.retryErrors} disabled={isRunning} />
					{copy.aiTranslationRetryErrors()}
				</label>
				<label class="flex cursor-pointer items-center gap-2">
					<input
						type="checkbox"
						bind:checked={options.overwriteAiTranslated}
						disabled={isRunning}
					/>
					{copy.aiTranslationOverwriteAi()}
				</label>
				<label class="flex cursor-pointer items-center gap-2">
					<input type="checkbox" bind:checked={options.overwriteReviewed} disabled={isRunning} />
					{copy.aiTranslationOverwriteReviewed()}
				</label>
				<label class="flex cursor-pointer items-center gap-2">
					<input type="checkbox" bind:checked={options.overwriteManualQuran} disabled={isRunning} />
					{copy.aiTranslationOverwriteManualQuran()}
				</label>
			</div>
		</div>

		{#if currentMessage}
			<div class="rounded-lg border border-color bg-accent p-4">
				<div class="flex items-center justify-between gap-3 text-sm">
					<span class="text-primary">{currentMessage}</span>
					{#if totalBatches > 0}<span class="text-thirdly">{progressPercent()}%</span>{/if}
				</div>
				{#if totalBatches > 0}
					<div class="mt-3 h-2 overflow-hidden rounded-full bg-[var(--border-color)]">
						<div
							class="h-full rounded-full bg-[var(--accent-primary)] transition-all"
							style={`width: ${progressPercent()}%;`}
						></div>
					</div>
				{/if}
				{#if translatedSubtitles > 0 || failedSubtitles > 0}
					<div class="mt-3 flex gap-4 text-xs">
						<span class="text-green-300">
							{copy.aiTranslationCompleted({ count: translatedSubtitles })}
						</span>
						{#if failedSubtitles > 0}
							<span class="text-red-300">
								{copy.aiTranslationFailed({ count: failedSubtitles })}
							</span>
						{/if}
					</div>
				{/if}
			</div>
		{/if}

		{#if currentBatchId && (isRunning || streamedReasoning || streamedResponse)}
			<div class="rounded-lg border border-color bg-accent p-4">
				{#if streamedReasoning}
					<div class="mb-4">
						<div class="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-thirdly">
							<span class="material-icons text-sm">psychology</span>
							<span>{$LL.editor.currentStreamedReasoning()}</span>
						</div>
						<textarea
							readonly
							bind:this={reasoningTextarea}
							bind:value={streamedReasoning}
							class="h-32 w-full resize-none rounded-lg border border-color bg-primary p-3 font-mono text-xs leading-relaxed text-primary"
						></textarea>
					</div>
				{/if}
				<div class="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-thirdly">
					<span class="material-icons text-sm">stream</span>
					<span>{$LL.editor.currentStreamedResponse()}</span>
				</div>
				<textarea
					readonly
					bind:this={responseTextarea}
					bind:value={streamedResponse}
					class="h-40 w-full resize-none rounded-lg border border-color bg-primary p-3 font-mono text-xs leading-relaxed text-primary"
					placeholder={$LL.translations.streamingResponsePlaceholder()}
				></textarea>
			</div>
		{/if}

		{#if errors.length > 0}
			<div class="max-h-36 overflow-y-auto rounded-lg border border-red-500/30 bg-red-500/10 p-3">
				{#each errors as error, index (`${index}-${error}`)}
					<p class="text-xs text-red-200">{error}</p>
				{/each}
			</div>
		{/if}

		<div class="flex justify-end gap-3 border-t border-color pt-4">
			<button class="btn px-4 py-2" onclick={closeSafely} disabled={isRunning}>
				{$LL.common.close()}
			</button>
			{#if !hasFinished}
				<button
					class="btn-accent flex items-center gap-2 px-5 py-2"
					onclick={() => void translateVideo()}
					disabled={isRunning || !providerConfigured() || eligibleCount() === 0}
				>
					<span class="material-icons text-base">auto_awesome</span>
					{copy.aiTranslationStart()}
				</button>
			{/if}
		</div>
	</div>
</TranslationsEditorModalShell>
