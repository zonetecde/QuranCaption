<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { Edition } from '$lib/classes';
	import Settings, {
		SettingsTab,
		type IslamicTermTranslationMode
	} from '$lib/classes/Settings.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import {
		applyAIProjectTranslationResults,
		buildAIProjectTranslationBatches,
		getEligibleAIProjectTranslationSubtitles,
		runAIProjectTranslationBatchStreaming,
		validateAIProjectTranslationBatch,
		resolveAIProjectTranslationSuccessContext,
		type AIProjectTranslationOptions,
		type AIProjectTranslationSuccess
	} from '$lib/services/AIProjectTranslationService';
	import { resolveAIReasoning } from '$lib/services/AIReasoning';
	import TranslationsEditorModalShell from './shared/TranslationsEditorModalShell.svelte';
	type TranslationCopy = {
		aiTranslationTitle: () => string;
		aiTranslationSubtitle: (args: { language: string }) => string;
		aiTranslationEligibleCount: (args: { count: number }) => string;
		aiTranslationIslamicTerms: () => string;
		aiTranslationIslamicTermsDescription: () => string;
		aiTranslationTermsTranslated: () => string;
		aiTranslationTermsBoth: () => string;
		aiTranslationTermsTransliterated: () => string;
		aiTranslationNoEligible: () => string;
		aiTranslationOverwriteManualQuran: () => string;
		aiTranslationStart: () => string;
		aiTranslationPreparing: () => string;
		aiTranslationBatchProgress: (args: { current: number; total: number }) => string;
		aiTranslationCompleted: (args: { count: number }) => string;
		aiTranslationFailed: (args: { count: number }) => string;
		aiTranslationProviderMissing: () => string;
		aiTranslationScope: () => string;
		aiTranslationScopeMissing: () => string;
		aiTranslationScopeAi: () => string;
		aiTranslationScopeAll: () => string;
		aiTranslationPreferences: () => string;
		aiTranslationPreferencesHint: () => string;
		aiTranslationSalawatSymbol: () => string;
		aiTranslationSalawatSymbolHint: () => string;
		aiTranslationAdvanced: () => string;
		aiTranslationStop: () => string;
		aiTranslationStopping: () => string;
		aiTranslationStopped: () => string;
		aiTranslationStopHint: () => string;
		aiTranslationPreview: () => string;
		aiTranslationWaiting: () => string;
		aiTranslationSourceChanged: () => string;
		aiTranslationOpenSettings: () => string;
	};

	const PROJECT_TRANSLATION_CONCURRENCY = 3;
	let { close, edition }: { close: () => void; edition: Edition } = $props();
	const copy = $derived($LL.translations as unknown as TranslationCopy);
	let scope = $state('missing');
	let overwriteManualQuran = $state(false);
	let additionalPreferences = $state('');
	let useSalawatSymbol = $state(true);
	let stopRequested = $state(false);
	let disposed = false;
	const options = $derived<AIProjectTranslationOptions>({
		retryErrors: true,
		overwriteAiTranslated: scope !== 'missing',
		overwriteReviewed: scope === 'all',
		overwriteManualQuran
	});
	let isRunning = $state(false);
	let hasFinished = $state(false);
	let completedBatches = $state(0);
	let totalBatches = $state(0);
	let translatedSubtitles = $state(0);
	let failedSubtitles = $state(0);
	let errors = $state<string[]>([]);
	let currentMessage = $state('');
	let previews = $state<
		Array<{
			index: number;
			status: 'pending' | 'running' | 'completed' | 'failed';
			texts: string[];
		}>
	>([]);
	const settings = $derived(() => globalState.settings!.aiTranslationSettings);
	const providerConfigured = $derived(() =>
		Boolean(
			settings().openAiApiKey.trim() &&
				settings().textAiApiEndpoint.trim() &&
				settings().advancedTrimModel.trim()
		)
	);
	const eligibleCount = $derived(
		() => getEligibleAIProjectTranslationSubtitles(edition, options).length
	);
	const progressPercent = $derived(() =>
		totalBatches > 0 ? Math.round((completedBatches / totalBatches) * 100) : 0
	);

	/** Ferme le modal lorsqu'aucune requête n'est en cours. @returns {void} */
	function closeSafely(): void {
		if (!isRunning) close();
	}

	/**
	 * Sauvegarde la présentation des termes islamiques.
	 * @param {IslamicTermTranslationMode} value Mode choisi.
	 * @returns {void}
	 */
	function updateIslamicTermMode(value: IslamicTermTranslationMode): void {
		settings().projectTranslationIslamicTerms = value;
		void Settings.save();
	}

	/** Demande l'arrêt après les requêtes déjà envoyées. @returns {void} */
	function stop(): void {
		stopRequested = true;
		currentMessage = copy.aiTranslationStopping();
	}

	/** Ouvre les réglages du fournisseur texte. @returns {void} */
	function openSettings(): void {
		globalState.uiState.settingsTab = SettingsTab.AI_KEY;
		globalState.uiState.isSettingsOpen = true;
		close();
	}

	onDestroy(() => {
		disposed = true;
		stopRequested = true;
	});

	/** Traduit les passages en parallèle puis applique les résultats validés. @returns {Promise<void>} */
	async function translateVideo(): Promise<void> {
		if (isRunning || !providerConfigured()) return;
		const project = globalState.currentProject;
		const runOptions = { ...options };
		const provider = { ...settings() };
		isRunning = true;
		hasFinished = false;
		stopRequested = false;
		completedBatches = 0;
		totalBatches = 0;
		translatedSubtitles = 0;
		failedSubtitles = 0;
		errors = [];
		previews = [];
		currentMessage = copy.aiTranslationPreparing();
		try {
			const batches = await buildAIProjectTranslationBatches(edition, runOptions);
			if (disposed) return;
			if (globalState.currentProject !== project)
				throw new Error(copy.aiTranslationSourceChanged());
			totalBatches = batches.length;
			previews = batches.map((_, index) => ({ index: index + 1, status: 'pending', texts: [] }));
			if (batches.length === 0) {
				currentMessage = copy.aiTranslationNoEligible();
				return;
			}
			const batchSuccesses: AIProjectTranslationSuccess[][] = batches.map(() => []);
			const batchErrors: string[][] = batches.map(() => []);
			const batchFailures = batches.map(() => 0);
			let nextBatchIndex = 0;
			const reasoning = resolveAIReasoning(
				provider.textAiApiEndpoint,
				provider.advancedTrimModel,
				provider.projectTranslationReasoningMode
			);

			/** Consomme la file tant qu'aucun arrêt n'est demandé. @returns {Promise<void>} */
			async function runTranslationWorker(): Promise<void> {
				while (!stopRequested && nextBatchIndex < batches.length) {
					const batchIndex = nextBatchIndex++;
					const batch = batches[batchIndex];
					previews[batchIndex].status = 'running';
					currentMessage = copy.aiTranslationBatchProgress({
						current: batchIndex + 1,
						total: batches.length
					});
					try {
						const response = await runAIProjectTranslationBatchStreaming({
							apiKey: provider.openAiApiKey,
							endpoint: provider.textAiApiEndpoint,
							model: provider.advancedTrimModel,
							reasoningEffort: reasoning.effort,
							thinkingEnabled: reasoning.thinkingEnabled,
							targetLanguage: edition.language,
							islamicTermMode: provider.projectTranslationIslamicTerms,
							additionalPreferences,
							useSalawatSymbol,
							batch
						});
						if (disposed) return;
						const validation = validateAIProjectTranslationBatch(batch, response.parsed);
						previews[batchIndex].status = validation.errors.length ? 'failed' : 'completed';
						previews[batchIndex].texts = validation.validItems.map((success) =>
							resolveAIProjectTranslationSuccessContext(edition, success)
						);
						batchSuccesses[batchIndex] = validation.validItems;
						batchErrors[batchIndex] = validation.errors;
						batchFailures[batchIndex] = batch.candidates.length - validation.validItems.length;
					} catch (error) {
						if (disposed) return;
						previews[batchIndex].status = 'failed';
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
			if (disposed) return;
			const successes = batchSuccesses.flat();
			errors = batchErrors.flat();
			failedSubtitles = batchFailures.reduce((total, count) => total + count, 0);
			if (globalState.currentProject !== project)
				throw new Error(copy.aiTranslationSourceChanged());
			if (successes.length > 0) {
				translatedSubtitles = applyAIProjectTranslationResults(
					edition,
					successes,
					runOptions
				).appliedSubtitles;
				await project?.save(false);
			}
			currentMessage = stopRequested
				? copy.aiTranslationStopped()
				: copy.aiTranslationCompleted({ count: translatedSubtitles });
		} catch (error) {
			if (disposed) return;
			failedSubtitles = Math.max(failedSubtitles, eligibleCount() - translatedSubtitles);
			errors = [...errors, error instanceof Error ? error.message : String(error)];
			currentMessage = copy.aiTranslationFailed({ count: failedSubtitles });
		} finally {
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
	{#snippet subtitle()}{copy.aiTranslationSubtitle({ language: edition.language })}{/snippet}
	<div class="space-y-5 p-5">
		<div>
			<label class="text-sm font-medium text-primary" for="ai-translation-scope"
				>{copy.aiTranslationScope()}</label
			>
			<select
				id="ai-translation-scope"
				class="mt-2 w-full rounded-md border border-color bg-secondary px-3 py-2 text-sm text-primary"
				bind:value={scope}
				disabled={isRunning}
			>
				<option value="missing">{copy.aiTranslationScopeMissing()}</option>
				<option value="ai">{copy.aiTranslationScopeAi()}</option>
				<option value="all">{copy.aiTranslationScopeAll()}</option>
			</select>
		</div>
		<div>
			<label class="text-sm font-medium text-primary" for="ai-translation-islamic-terms"
				>{copy.aiTranslationIslamicTerms()}</label
			>
			<p class="mt-1 text-xs text-secondary">{copy.aiTranslationIslamicTermsDescription()}</p>
			<select
				id="ai-translation-islamic-terms"
				class="mt-2 w-full rounded-md border border-color bg-secondary px-3 py-2 text-sm text-primary"
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
		<div>
			<label class="text-sm font-medium text-primary" for="ai-translation-preferences"
				>{copy.aiTranslationPreferences()}</label
			>
			<textarea
				id="ai-translation-preferences"
				class="mt-2 min-h-24 w-full rounded-md border border-color bg-secondary px-3 py-2 text-sm text-primary"
				bind:value={additionalPreferences}
				disabled={isRunning}
				placeholder={copy.aiTranslationPreferencesHint()}
			></textarea>
		</div>
		<div>
			<label class="flex cursor-pointer items-center gap-2 text-sm text-primary">
				<input type="checkbox" bind:checked={useSalawatSymbol} disabled={isRunning} />
				{copy.aiTranslationSalawatSymbol()}
			</label>
			<p class="mt-1 text-xs text-secondary">{copy.aiTranslationSalawatSymbolHint()}</p>
		</div>
		<details class="rounded-lg border border-color p-3">
			<summary class="cursor-pointer text-sm text-secondary">{copy.aiTranslationAdvanced()}</summary
			>
			<label class="mt-3 flex items-center gap-2 text-sm text-secondary">
				<input type="checkbox" bind:checked={overwriteManualQuran} disabled={isRunning} />
				{copy.aiTranslationOverwriteManualQuran()}
			</label>
		</details>
		<p class="text-sm text-secondary">
			{copy.aiTranslationEligibleCount({ count: eligibleCount() })}
		</p>
		{#if !providerConfigured()}
			<div class="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
				<p>{copy.aiTranslationProviderMissing()}</p>
				<button class="mt-2 underline" onclick={openSettings}
					>{copy.aiTranslationOpenSettings()}</button
				>
			</div>
		{/if}
		{#if currentMessage}
			<div class="rounded-lg border border-color bg-accent p-4" role="status">
				<div class="flex items-center justify-between gap-3 text-sm text-primary">
					<span>{currentMessage}</span>
					{#if totalBatches > 0}<span>{progressPercent()}%</span>{/if}
				</div>
				{#if totalBatches > 0}
					<div class="mt-3 h-2 overflow-hidden rounded-full bg-[var(--border-color)]">
						<div
							class="h-full rounded-full bg-[var(--accent-primary)] transition-all"
							style={`width: ${progressPercent()}%;`}
						></div>
					</div>
				{/if}
				{#if translatedSubtitles > 0}<p class="mt-2 text-xs text-secondary">
						{copy.aiTranslationCompleted({ count: translatedSubtitles })}
					</p>{/if}
				{#if failedSubtitles > 0}<p class="mt-2 text-xs text-red-300">
						{copy.aiTranslationFailed({ count: failedSubtitles })}
					</p>{/if}
				{#if stopRequested}<p class="mt-2 text-xs text-secondary">
						{copy.aiTranslationStopHint()}
					</p>{/if}
			</div>
		{/if}
		{#if previews.length > 0}
			<details class="rounded-lg border border-color p-3" open>
				<summary class="cursor-pointer text-sm font-medium text-primary"
					>{copy.aiTranslationPreview()}</summary
				>
				<div class="mt-3 max-h-60 space-y-3 overflow-y-auto">
					{#each previews as preview (preview.index)}
						<div class="rounded-md bg-accent p-3">
							<p class="flex items-center gap-2 text-xs text-secondary">
								<span
									class="material-icons text-sm"
									class:animate-spin={preview.status === 'running'}
									>{preview.status === 'completed'
										? 'check_circle'
										: preview.status === 'failed'
											? 'error'
											: preview.status === 'running'
												? 'sync'
												: 'schedule'}</span
								>
								{$LL.editor.streamedBatchLabel({ current: preview.index, total: totalBatches })}
							</p>
							{#each preview.texts as text, index (index)}<p
									class="mt-2 text-sm text-primary"
									dir="auto"
								>
									{text}
								</p>{/each}
							{#if preview.status === 'running'}<p class="mt-2 text-xs text-secondary">
									{copy.aiTranslationWaiting()}
								</p>{/if}
						</div>
					{/each}
				</div>
			</details>
		{/if}
		{#if errors.length > 0}
			<div class="max-h-36 overflow-y-auto rounded-lg border border-red-500/30 bg-red-500/10 p-3">
				{#each errors as error, index (`${index}-${error}`)}<p class="text-xs text-red-200">
						{error}
					</p>{/each}
			</div>
		{/if}
		<div class="flex justify-end gap-3 border-t border-color pt-4">
			<button class="btn px-4 py-2" onclick={closeSafely} disabled={isRunning}
				>{$LL.common.close()}</button
			>
			{#if isRunning}
				<button class="btn px-4 py-2" onclick={stop} disabled={stopRequested}
					>{copy.aiTranslationStop()}</button
				>
			{:else if !hasFinished}
				<button
					class="btn-accent px-5 py-2"
					onclick={() => void translateVideo()}
					disabled={!providerConfigured() || eligibleCount() === 0}
					>{copy.aiTranslationStart()}</button
				>
			{/if}
		</div>
	</div>
</TranslationsEditorModalShell>
