<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { Duration } from '$lib/classes';
	import { SettingsTab } from '$lib/classes/Settings.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import AiAccessTabs from '../AiAccessTabs.svelte';
	import ManualAiWorkflow from '../ManualAiWorkflow.svelte';
	import { ManualAiSession, type ManualAiCopy } from '$lib/services/ManualAiSession.svelte';
	import {
		generateMeaningExportRanges,
		type MeaningExportCopy
	} from '$lib/services/MeaningExportRangeService';
	import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
	import TranslationsEditorModalShell from '$lib/components/projectEditor/tabs/translationsEditor/modal/shared/TranslationsEditorModalShell.svelte';

	let { close }: { close: () => void } = $props();
	const project = untrack(() => globalState.currentProject!);
	const controller = new AbortController();
	const manualSession = new ManualAiSession();
	const copy = $derived(($LL.export as unknown as { meaning: MeaningExportCopy }).meaning);
	const manualCopy = $derived(($LL.editor as unknown as { manualAi: ManualAiCopy }).manualAi);
	let manualMode = $state(false);
	let additionalPreferences = $state('');
	let maxDuration = $state(
		untrack(() => project.projectEditorState.export.meaningMaxDurationSeconds)
	);
	let busy = $state(false);
	let errorMessage = $state('');
	let result = $state<Awaited<ReturnType<typeof generateMeaningExportRanges>> | null>(null);
	const hasKey = $derived(Boolean(globalState.settings?.aiTranslationSettings.openAiApiKey.trim()));

	onDestroy(() => {
		controller.abort();
		manualSession.cancel();
	});

	/** Ferme la modale et annule les réponses en attente. @returns {void} */
	function dismiss(): void {
		controller.abort();
		manualSession.cancel();
		close();
	}

	/** Invalide l'aperçu lorsque la durée ou le parcours change. @returns {void} */
	function resetResults(): void {
		result = null;
		errorMessage = '';
		manualSession.cancel();
	}

	/** Prépare les propositions uniquement après une action explicite. @returns {Promise<void>} Fin de l'analyse. */
	async function generate(): Promise<void> {
		if (busy) return;
		busy = true;
		resetResults();
		if (manualMode) manualSession.start();
		try {
			const proposals = await generateMeaningExportRanges(
				project,
				maxDuration,
				controller.signal,
				manualMode ? manualSession : undefined,
				additionalPreferences
			);
			if (controller.signal.aborted) return;
			result = proposals;
			if (manualMode) manualSession.finish();
		} catch (error) {
			manualSession.cancel();
			if (!controller.signal.aborted)
				errorMessage = error instanceof Error ? error.message : copy.requestError();
		} finally {
			busy = false;
		}
	}

	/** Enregistre les propositions validées dans l'historique sans lancer d'export. @returns {void} */
	function apply(): void {
		if (!result || busy) return;
		try {
			result.assertCurrent();
			ProjectHistoryManager.track(
				'apply meaning export ranges',
				() => {
					project.projectEditorState.export.meaningRanges = result!.ranges;
					project.projectEditorState.export.meaningMaxDurationSeconds = maxDuration;
				},
				project
			);
			dismiss();
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : copy.sourceChanged();
		}
	}

	/** Ouvre les réglages existants du fournisseur IA. @returns {void} */
	function openSettings(): void {
		globalState.uiState.settingsTab = SettingsTab.AI_KEY;
		globalState.uiState.isSettingsOpen = true;
		dismiss();
	}
</script>

<div role="dialog" tabindex="-1" aria-modal="true" aria-label={copy.title()}>
	<TranslationsEditorModalShell
		close={dismiss}
		title={copy.title()}
		icon="auto_awesome"
		shellClass="h-[82vh] max-h-[92vh] w-[1160px] max-w-[calc(100vw-2rem)]"
		bodyClass="min-h-0 flex-1 overflow-y-auto md:grid md:grid-cols-[minmax(0,1fr)_300px] md:overflow-hidden"
	>
		{#snippet subtitle()}{copy.description()}{/snippet}
		{#snippet afterHeader()}<AiAccessTabs
				bind:manual={manualMode}
				disabled={busy}
				onchange={resetResults}
			/>{/snippet}
		<section
			class="flex min-h-0 flex-col overflow-y-auto border-b border-color md:border-b-0 md:border-e"
		>
			{#if manualMode}<ManualAiWorkflow session={manualSession} />{/if}
			{#if result}
				<div class="border-b border-color px-5 py-4 text-sm font-semibold text-primary">
					{$LL.editor.referenceDetection.preview()}
					<span class="ms-2 text-secondary">{result.ranges.length}</span>
				</div>
				{#if !result.ranges.length}<p role="status" class="p-5 text-sm text-secondary">
						{copy.noResults()}
					</p>{/if}
				<ol class="space-y-3 p-5">
					{#each result.ranges as range (range.id)}
						<li class="space-y-2 rounded-xl border border-color bg-primary p-4">
							<p class="font-semibold text-primary" dir="auto">{range.title}</p>
							<p class="monospaced text-xs text-secondary">
								{new Duration(range.startTime).getFormattedTime(false, true)} – {new Duration(
									range.endTime
								).getFormattedTime(false, true)}
							</p>
							<p class="text-sm text-secondary" dir="auto">{range.context}</p>
						</li>
					{/each}
				</ol>
			{:else if !manualMode}
				<div class="flex flex-1 flex-col items-center justify-center gap-5 p-8 text-center">
					<div
						class="flex h-20 w-20 items-center justify-center rounded-2xl border border-color text-accent"
					>
						<span class="material-icons text-3xl" aria-hidden="true">auto_awesome</span>
					</div>
					<h3 class="text-xl font-semibold text-primary">{copy.title()}</h3>
					<p class="max-w-lg text-sm leading-relaxed text-secondary">{copy.description()}</p>
				</div>
			{/if}
		</section>
		<section class="space-y-5 overflow-y-auto p-5">
			<fieldset disabled={busy} oninput={resetResults} class="space-y-5 disabled:opacity-60">
				<label class="block space-y-2 text-sm text-secondary">
					<span>{copy.maxDuration()}</span>
					<input
						type="number"
						min="1"
						step="1"
						bind:value={maxDuration}
						class="w-full rounded-lg border border-color bg-primary px-3 py-2 text-primary"
					/>
				</label>
				<label class="block space-y-2 text-sm text-secondary">
					<span>{$LL.editor.speechToText.additionalPreferences()}</span>
					<textarea
						rows="5"
						bind:value={additionalPreferences}
						placeholder={copy.preferencesHint()}
						class="w-full rounded-lg border border-color bg-primary px-3 py-2 text-sm text-primary"
					></textarea>
				</label>
				{#if !manualMode}
					<button
						type="button"
						onclick={openSettings}
						class="cursor-pointer text-sm text-accent underline"
						>{$LL.editor.speechToText.textAiSettings()}</button
					>
					{#if !hasKey}<p class="text-xs text-thirdly">
							{$LL.editor.speechToText.rearrangeKeyRequired()}
						</p>{/if}
				{/if}
			</fieldset>
			{#if errorMessage}<p role="alert" class="text-sm text-red-400">{errorMessage}</p>{/if}
			<div class="space-y-3 border-t border-color pt-5">
				{#if busy && !manualMode}<p role="status" class="text-sm text-secondary">
						{copy.generating()}
					</p>{/if}
				<button
					type="button"
					onclick={generate}
					disabled={busy ||
						(!manualMode && !hasKey) ||
						!Number.isFinite(maxDuration) ||
						maxDuration < 1}
					class="btn-accent w-full px-4 py-2.5 disabled:opacity-50"
					>{manualMode ? manualCopy.prepare() : copy.generate()}</button
				>
				{#if result?.ranges.length}<button
						type="button"
						onclick={apply}
						disabled={busy}
						class="btn-accent w-full px-4 py-2.5">{copy.apply()}</button
					>{/if}
				<button type="button" onclick={dismiss} class="btn w-full px-4 py-2.5"
					>{$LL.common.cancel()}</button
				>
			</div>
		</section>
	</TranslationsEditorModalShell>
</div>
