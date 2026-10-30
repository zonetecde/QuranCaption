<script lang="ts">
	import AiBatchSummary from '$lib/components/ai/AiBatchSummary.svelte';
	import { onDestroy, untrack } from 'svelte';
	import { Duration, SubtitleClip, TrackType } from '$lib/classes';
	import { SettingsTab } from '$lib/classes/Settings.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import AiAccessTabs from '$lib/components/modals/AiAccessTabs.svelte';
	import ManualAiWorkflow from '$lib/components/modals/ManualAiWorkflow.svelte';
	import { ManualAiSession, type ManualAiCopy } from '$lib/services/ManualAiSession.svelte';
	import { AnalyticsService } from '$lib/services/AnalyticsService';
	import { globalState } from '$lib/runes/main.svelte';
	import type { SpeechToTextCopy } from '$lib/services/SpeechToTextService';
	import {
		rearrangeProjectSubtitles,
		type SubtitleRearrangementPlan
	} from '$lib/services/SubtitleRearrangementService';
	import TranslationsEditorModalShell from '$lib/components/projectEditor/tabs/translationsEditor/modal/shared/TranslationsEditorModalShell.svelte';

	let { close }: { close: () => void } = $props();
	const project = untrack(() => globalState.currentProject!);
	let manualMode = $state(false);
	const manualSession = new ManualAiSession();
	const manualCopy = $derived(($LL.editor as unknown as { manualAi: ManualAiCopy }).manualAi);
	let maxWords = $state(untrack(() => globalState.settings!.speechToTextSettings.maxWords));
	let maxDuration = $state(untrack(() => globalState.settings!.speechToTextSettings.maxDuration));
	let additionalPreferences = $state('');
	let busy = $state(false);
	let progress = $state(0);
	let errorMessage = $state('');
	let plan = $state<SubtitleRearrangementPlan | null>(null);
	const previewSides = ['before', 'after'] as const;
	const controller = new AbortController();
	const copy = $derived(($LL.editor as unknown as { speechToText: SpeechToTextCopy }).speechToText);
	const subtitles = $derived(
		project.content.timeline
			.getFirstTrack(TrackType.Subtitle)
			.clips.filter((clip): clip is SubtitleClip => clip instanceof SubtitleClip)
			.sort((a, b) => a.startTime - b.startTime)
	);
	const hasTextAiKey = $derived(
		Boolean(globalState.settings?.aiTranslationSettings.openAiApiKey.trim())
	);

	const inputClass =
		'w-full rounded-lg border border-color bg-primary px-3 py-2 text-sm text-primary';
	onDestroy(() => {
		controller.abort();
		manualSession.cancel();
	});

	/**
	 * Ferme le modal et empêche toute application tardive d'un résultat.
	 * @returns {void}
	 */
	function dismiss(): void {
		controller.abort();
		manualSession.cancel();
		close();
	}

	/**
	 * Prépare le découpage pour validation sans changer les sous-titres du projet.
	 * @returns {Promise<void>}
	 */
	async function rearrange(): Promise<void> {
		if (busy) return;
		busy = true;
		progress = 0;
		errorMessage = '';
		plan = null;
		if (manualMode) manualSession.start();
		try {
			/** Lance le parcours choisi. @returns {Promise<SubtitleRearrangementPlan>} Aperçu validé. */
			const run = () =>
				rearrangeProjectSubtitles(
					project,
					{ maxWords, maxDuration, additionalPreferences },
					controller.signal,
					(value) => {
						progress = Math.round(value * 100);
					},
					manualMode ? manualSession : undefined
				);
			const result = manualMode
				? await run()
				: await AnalyticsService.trackSubtitleAiRequest(
						'subtitle_rearrangement',
						controller.signal,
						run,
						{ subtitles_count: subtitles.length, max_words: maxWords, max_duration: maxDuration }
					);
			if (!controller.signal.aborted) {
				plan = result;
				if (manualMode) manualSession.finish();
			}
		} catch (error) {
			if (manualMode) manualSession.cancel();
			if (!controller.signal.aborted)
				errorMessage = error instanceof Error ? error.message : copy.rearrangeProviderError();
		} finally {
			busy = false;
		}
	}

	/**
	 * Applique toutes les propositions validées puis ferme la fenêtre.
	 * @returns {void}
	 */
	function apply(): void {
		if (!plan || busy) return;
		errorMessage = '';
		try {
			const result = plan.apply();
			AnalyticsService.track('ai_subtitle_rearrangement_applied', {
				subtitles_count: result.count,
				skipped_count: result.skipped
			});
			dismiss();
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : copy.rearrangeSourceChanged();
			AnalyticsService.track('ai_subtitle_rearrangement_failed', { stage: 'applying' });
		}
	}

	/**
	 * Ouvre les réglages existants du fournisseur d'IA textuelle.
	 * @returns {void}
	 */
	function openTextAiSettings(): void {
		globalState.uiState.settingsTab = SettingsTab.AI_KEY;
		globalState.uiState.isSettingsOpen = true;
		dismiss();
	}

	/** Invalide le découpage lorsque ses préférences ou son mode changent. @returns {void} */
	function resetResults(): void {
		plan = null;
		errorMessage = '';
		manualSession.cancel();
	}
</script>

<div role="dialog" tabindex="-1" aria-modal="true" aria-label={copy.rearrangeTitle()}>
	<TranslationsEditorModalShell
		close={dismiss}
		title={copy.rearrangeTitle()}
		icon="reorder"
		shellClass="h-[80vh] max-h-[90vh] w-[1050px] max-w-[calc(100vw-2rem)]"
		bodyClass="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_320px] md:overflow-hidden"
	>
		{#snippet subtitle()}{copy.rearrangeDescription()}{/snippet}
		{#snippet afterHeader()}<AiAccessTabs
				bind:manual={manualMode}
				disabled={busy}
				onchange={resetResults}
			/>{/snippet}
		<section class="flex min-h-0 flex-col border-b border-color md:border-b-0 md:border-e">
			{#if manualMode && plan}<ManualAiWorkflow session={manualSession} {progress} />{/if}
			{#if manualMode && !plan}
				<div class="min-h-0 overflow-y-auto">
					<ManualAiWorkflow session={manualSession} {progress} />
				</div>
			{:else if plan}
				<div class="border-b border-color px-5 py-4">
					<h3 class="text-sm font-semibold text-primary">
						{$LL.editor.referenceDetection.preview()}
					</h3>
					<p class="mt-1 text-xs text-secondary">{copy.rearrangePreviewDescription()}</p>
				</div>
				{#if !plan.before.length && !plan.after.length}
					<p role="status" class="p-5 text-sm text-secondary">{copy.rearrangeNoChanges()}</p>
				{:else}
					<div class="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto sm:grid-cols-2">
						{#each previewSides as side (side)}
							<section
								class="p-4 {side === 'before'
									? 'border-b border-color sm:border-b-0 sm:border-e'
									: 'bg-accent/20'}"
							>
								<h4
									class="mb-3 text-xs font-semibold {side === 'after'
										? 'text-accent'
										: 'text-secondary'}"
								>
									{$LL.editor.referenceDetection[side]()} ({plan[side].length})
								</h4>
								<ol class="space-y-3">
									{#each plan[side] as subtitle (subtitle.id)}
										<li class="space-y-2 rounded-xl border border-color bg-primary p-3">
											<p class="monospaced text-xs text-thirdly">
												{new Duration(subtitle.startTime).getFormattedTime(false, true)} – {new Duration(
													subtitle.endTime
												).getFormattedTime(false, true)}
											</p>
											<p
												dir="auto"
												class="whitespace-pre-wrap break-words text-sm leading-relaxed {side ===
												'after'
													? 'text-primary'
													: 'text-secondary'}"
											>
												{subtitle.text}
											</p>
										</li>
									{/each}
								</ol>
							</section>
						{/each}
					</div>
				{/if}
			{:else}
				<h3
					class="flex shrink-0 items-center justify-between border-b border-color px-5 py-3 text-sm font-semibold text-primary"
				>
					{$LL.editor.transcriptSegments()} <span class="text-secondary">{subtitles.length}</span>
				</h3>
				<ol class="min-h-40 space-y-3 overflow-y-auto p-4 md:min-h-0">
					{#each subtitles as subtitle, index (subtitle.id)}
						<li class="space-y-2 rounded-lg border border-color bg-primary p-3">
							<div class="flex items-center justify-between gap-3 text-xs text-thirdly">
								<span>{index + 1}</span>
								<span class="monospaced"
									>{new Duration(subtitle.startTime).getFormattedTime(false, true)} – {new Duration(
										subtitle.endTime
									).getFormattedTime(false, true)}</span
								>
							</div>
							<p
								dir="auto"
								class="whitespace-pre-wrap break-words text-sm leading-relaxed text-primary"
							>
								{subtitle.text}
							</p>
						</li>
					{/each}
				</ol>
			{/if}
		</section>
		<section class="space-y-5 overflow-y-auto p-5">
			<AiBatchSummary {subtitles} feature="rearrangement" />
			<fieldset disabled={busy} oninput={resetResults} class="space-y-5 disabled:opacity-60">
				<h3 class="text-sm font-semibold text-primary">{copy.preferences()}</h3>
				<label class="block space-y-1 text-sm text-secondary">
					<span>{$LL.editor.maxWordsPerSegment()}</span>
					<input type="number" min="1" max="50" step="1" bind:value={maxWords} class={inputClass} />
				</label>
				<label class="block space-y-1 text-sm text-secondary">
					<span>{copy.maxDuration()}</span>
					<input
						type="number"
						min="1"
						max="30"
						step="0.5"
						bind:value={maxDuration}
						class={inputClass}
					/>
				</label>
				<label class="block space-y-1 text-sm text-secondary">
					<span>{copy.additionalPreferences()}</span>
					<textarea
						rows="4"
						bind:value={additionalPreferences}
						class={inputClass}
						placeholder={copy.additionalPreferencesHint()}
					></textarea>
				</label>
				{#if !manualMode}<button
						type="button"
						onclick={openTextAiSettings}
						class="cursor-pointer text-sm text-accent underline">{copy.textAiSettings()}</button
					>{/if}
				{#if !manualMode && !hasTextAiKey}<p class="text-xs text-thirdly">
						{copy.rearrangeKeyRequired()}
					</p>{/if}
			</fieldset>
			<p class="text-xs text-thirdly">{copy.rearrangeNotice()}</p>
			<button
				type="button"
				disabled={busy || (!manualMode && !hasTextAiKey) || !subtitles.length}
				onclick={rearrange}
				class="btn-accent w-full px-3 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
			>
				{manualMode ? manualCopy.prepare() : copy.rearrangeAction()}
			</button>
			{#if plan}
				<button
					type="button"
					onclick={apply}
					disabled={busy}
					class="btn-accent w-full px-3 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
					>{copy.rearrangeApplyAll()}</button
				>
			{/if}
			{#if busy && !manualMode}
				<p role="status" class="text-sm text-secondary">{copy.rearranging()} ({progress}%)</p>
				<p class="text-xs text-thirdly">{copy.cancelHint()}</p>
				<button
					type="button"
					onclick={dismiss}
					class="w-full cursor-pointer rounded-lg border border-color px-3 py-2 text-sm text-primary"
					>{$LL.common.cancel()}</button
				>
			{/if}
			{#if plan?.skipped}<p class="text-sm text-amber-400">
					{copy.rearrangeSkipped()} ({plan.skipped})
				</p>{/if}
			{#if errorMessage}<p role="alert" class="text-sm text-red-400">{errorMessage}</p>{/if}
		</section>
	</TranslationsEditorModalShell>
</div>
