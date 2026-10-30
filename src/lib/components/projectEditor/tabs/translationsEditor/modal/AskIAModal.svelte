<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import type { Edition, Project, SubtitleClip } from '$lib/classes';
	import Settings from '$lib/classes/Settings.svelte';
	import AiAccessTabs from '$lib/components/modals/AiAccessTabs.svelte';
	import ManualAiWorkflow from '$lib/components/modals/ManualAiWorkflow.svelte';
	import VerseRangeSlider from '$lib/components/projectEditor/tabs/export/VerseRangeSlider.svelte';
	import { buildVerseRangeSliderOptions } from '$lib/components/projectEditor/tabs/export/VerseRangeSlider';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import {
		applyAdvancedTrimValidationSuccess,
		buildAdvancedTrimBatches,
		buildAdvancedTrimVerseCandidates,
		validateManualAdvancedTrimBatchResult,
		type AdvancedTrimVerseCandidate,
		type AdvancedTrimValidationSuccess
	} from '$lib/services/AdvancedAITrimming';
	import { ManualAiSession, type ManualAiCopy } from '$lib/services/ManualAiSession.svelte';
	import toast from 'svelte-5-french-toast';
	import AdvancedAITrimmingTab from './AdvancedAITrimmingTab.svelte';
	import TranslationsEditorModalShell from './shared/TranslationsEditorModalShell.svelte';

	let { close, edition }: { close: () => void; edition: Edition } = $props();
	const copy = $derived(($LL.editor as unknown as { manualAi: ManualAiCopy }).manualAi);
	let manualMode = $state(globalState.settings?.aiTranslationSettings.activeModalTab === 'manual');
	let apiRunning = $state(false);
	let preparing = $state(false);
	let applying = $state(false);
	let includeReviewed = $state(
		globalState.settings?.aiTranslationSettings.advancedAlsoAskReviewed ?? false
	);
	let candidates = $state<AdvancedTrimVerseCandidate[]>([]);
	let selectedStartIndex = $state(0);
	let selectedEndIndex = $state(0);
	let maxBatchWords = $state(500);
	let completedBatches = $state(0);
	let totalBatches = $state(0);
	let results = $state<AdvancedTrimValidationSuccess[]>([]);
	let error = $state('');
	const session = new ManualAiSession();
	let sourceProject: Project | null = null;
	let sourceSnapshot = '';
	let sourceSubtitles: SubtitleClip[] = [];
	let disposed = false;
	// Les horaires peuvent se chevaucher : le slider et les lots suivent les mêmes versets.
	const rangeVerses = $derived(
		buildVerseRangeSliderOptions(candidates).map(({ key, surah }) => ({ key, surah }))
	);
	const selectedVerseKeys = $derived(
		new Set(rangeVerses.slice(selectedStartIndex, selectedEndIndex + 1).map((verse) => verse.key))
	);
	const batches = $derived(
		buildAdvancedTrimBatches(
			candidates.filter((candidate) => selectedVerseKeys.has(candidate.verseKey)),
			'',
			'none',
			-Infinity,
			Infinity,
			maxBatchWords
		)
	);
	const progress = $derived(totalBatches ? Math.round((completedBatches / totalBatches) * 100) : 0);

	$effect(() => {
		const project = globalState.currentProject;
		const reviewed = includeReviewed;
		untrack(() => {
			candidates = project ? buildAdvancedTrimVerseCandidates(edition, reviewed, project) : [];
			selectedStartIndex = 0;
			selectedEndIndex = Math.max(0, candidates.length - 1);
		});
	});

	/** Réinitialise les réponses lors d'un changement de méthode. @returns {void} */
	function resetMode(): void {
		session.cancel();
		results = [];
		error = '';
		completedBatches = 0;
		if (globalState.settings) {
			globalState.settings.aiTranslationSettings.activeModalTab = manualMode
				? 'manual'
				: 'advanced';
			void Settings.save();
		}
	}

	/** Ferme le modal en annulant toute réponse manuelle attendue. @returns {void} */
	function closeSafely(): void {
		if (apiRunning || applying) return;
		session.cancel();
		close();
	}

	/**
	 * Capture les données utiles sans inclure les états de lecture et de vérification automatique.
	 * @param {AdvancedTrimVerseCandidate[]} verses Versets de l'édition choisie.
	 * @returns {string} Empreinte des textes, bornes et traductions.
	 */
	function snapshot(verses: AdvancedTrimVerseCandidate[]): string {
		return JSON.stringify(
			verses.map((verse) => [
				verse.verseKey,
				verse.sourceTranslation,
				verse.hasFullVerseCoverage,
				verse.coverageOnlyTexts,
				verse.subtitles.map((subtitle) => [
					subtitle.id,
					subtitle.startTime,
					subtitle.endTime,
					subtitle.startWordIndex,
					subtitle.endWordIndex,
					subtitle.text,
					subtitle.wbwTranslation,
					subtitle.translations[edition.name]?.toJSON()
				])
			])
		);
	}

	/** Vérifie que les réponses concernent toujours les mêmes sous-titres. @returns {void} */
	function assertSourceUnchanged(): void {
		if (
			globalState.currentProject !== sourceProject ||
			!sourceProject ||
			sourceSnapshot !==
				snapshot(buildAdvancedTrimVerseCandidates(edition, includeReviewed, sourceProject)) ||
			sourceSubtitles.some((subtitle) => !globalState.getSubtitleClips.includes(subtitle))
		) {
			throw new Error(copy.sourceChanged());
		}
	}

	/** Prépare les lots puis valide chaque réponse sans modifier le projet. @returns {Promise<void>} */
	async function preparePrompts(): Promise<void> {
		if (preparing || applying || !globalState.currentProject) return;
		sourceProject = globalState.currentProject;
		candidates = buildAdvancedTrimVerseCandidates(edition, includeReviewed, sourceProject);
		const runBatches = [...batches];
		if (!runBatches.length) {
			error = $LL.translations.noEligibleVerseBatch();
			return;
		}
		sourceSnapshot = snapshot(candidates);
		sourceSubtitles = candidates.flatMap((candidate) => candidate.subtitles);
		results = [];
		error = '';
		completedBatches = 0;
		totalBatches = runBatches.length;
		preparing = true;
		session.start();
		try {
			for (const batch of runBatches) {
				const validated = await session.request(
					'translation_trim',
					{ batch: batch.request },
					(parsed) => {
						assertSourceUnchanged();
						const validation = validateManualAdvancedTrimBatchResult(edition, batch, parsed);
						if (validation.errors.length || validation.validVerses.length !== batch.verses.length) {
							throw new Error(validation.errors.join('\n') || copy.invalidJson());
						}
						return validation.validVerses;
					}
				);
				results.push(...validated);
				completedBatches++;
			}
			assertSourceUnchanged();
			session.finish();
		} catch (cause) {
			session.cancel();
			results = [];
			if (!disposed && !(cause instanceof DOMException && cause.name === 'AbortError')) {
				error = cause instanceof Error ? cause.message : copy.prepareError();
			}
		} finally {
			preparing = false;
		}
	}

	/** Applique tous les lots validés dans l'historique existant. @returns {Promise<void>} */
	async function applyTranslations(): Promise<void> {
		if (!session.ready || applying) return;
		applying = true;
		try {
			assertSourceUnchanged();
			const report = applyAdvancedTrimValidationSuccess(edition, results);
			await sourceProject!.save(false);
			toast.success($LL.translations.aiTrimmedSegments({ count: report.appliedSegments }));
			close();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : copy.prepareError();
			session.cancel();
		} finally {
			applying = false;
		}
	}

	onDestroy(() => {
		disposed = true;
		session.cancel();
	});
</script>

<TranslationsEditorModalShell
	close={closeSafely}
	title={$LL.editor.aiTranslationAssistant()}
	icon="auto_awesome"
	shellClass={manualMode
		? 'w-[720px] max-w-[94vw] max-h-[88vh]'
		: 'h-[92vh] xl:h-[80vh] w-[clamp(1200px,96vw,1700px)] max-w-[90vw] xl:max-w-[66vw]'}
	bodyClass="min-h-0 overflow-y-auto"
>
	{#snippet subtitle()}{edition.author} · {edition.language}{/snippet}
	{#snippet afterHeader()}
		<AiAccessTabs
			bind:manual={manualMode}
			disabled={apiRunning || preparing || applying}
			onchange={resetMode}
		/>
	{/snippet}
	{#if manualMode}
		<fieldset
			disabled={preparing || applying}
			class={preparing || session.ready ? 'hidden' : 'space-y-5 p-5 pb-0'}
		>
			{#if candidates.length > 1}
				<VerseRangeSlider
					verses={rangeVerses}
					totalItems={candidates.length}
					selectedItems={selectedVerseKeys.size}
					bind:startIndex={selectedStartIndex}
					bind:endIndex={selectedEndIndex}
					title={$LL.tools.selectAyahRange()}
					totalLabel={$LL.editor.eligibleVerses()}
					selectionLabel={$LL.tools.selectAyahRangeHint()}
					showRangeLabel
				/>
			{/if}
			<label class="flex items-center gap-3 text-sm text-secondary">
				<input
					type="checkbox"
					bind:checked={includeReviewed}
					class="accent-[var(--accent-primary)]"
				/>
				{copy.includeReviewed()}
			</label>
			<div class="space-y-2 rounded-xl border border-color bg-primary p-4">
				<label for="manual-ai-batch-size" class="flex justify-between text-sm text-primary">
					<span>{$LL.editor.maxWords()}</span><span>{maxBatchWords} {$LL.editor.words()}</span>
				</label>
				<input
					id="manual-ai-batch-size"
					type="range"
					min="100"
					max="1000"
					step="50"
					bind:value={maxBatchWords}
					class="w-full accent-[var(--accent-primary)]"
				/>
				<p class="text-xs text-secondary">{$LL.editor.batches()}: {batches.length}</p>
			</div>
			{#if !batches.length}<p class="text-sm text-secondary">
					{$LL.translations.noEligibleVerseBatch()}
				</p>{/if}
			<button
				type="button"
				class="btn-accent w-full px-4 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
				disabled={!batches.length || preparing}
				onclick={preparePrompts}>{copy.prepare()}</button
			>
		</fieldset>
		<ManualAiWorkflow {session} {progress} />
		{#if session.ready}
			<div class="space-y-3 px-5 pb-5">
				<h3 class="text-sm font-semibold text-primary">{$LL.editor.translationPreview()}</h3>
				{#each results as result (result.candidate.verseKey)}
					<div class="space-y-3 rounded-xl border border-color bg-primary p-4">
						<p class="text-xs text-thirdly">{result.candidate.verseKey}</p>
						{#each result.result.segments as segment (segment.i)}
							<div class="space-y-1 text-sm">
								<p dir="auto" class="text-secondary">
									{result.candidate.segments[segment.i].arabic}
								</p>
								<p dir="auto" class="text-primary">{segment.text}</p>
							</div>
						{/each}
					</div>
				{/each}
			</div>
		{/if}
		{#if error}<p role="alert" class="px-5 pb-4 text-sm text-red-400">{error}</p>{/if}
		{#if session.ready}
			<div class="flex justify-end border-t border-color p-5">
				<button
					type="button"
					class="btn-accent px-4 py-3 text-sm font-semibold disabled:opacity-40"
					disabled={applying}
					onclick={applyTranslations}>{copy.applyTranslations()}</button
				>
			</div>
		{/if}
	{:else}
		<div class="px-6 py-4"><AdvancedAITrimmingTab {edition} bind:isRunning={apiRunning} /></div>
	{/if}
</TranslationsEditorModalShell>
