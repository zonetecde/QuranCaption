<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { SubtitleClip, TrackType } from '$lib/classes';
	import { SettingsTab } from '$lib/classes/Settings.svelte';
	import LL from '$lib/i18n/i18n-svelte';
	import { globalState } from '$lib/runes/main.svelte';
	import {
		detectProjectReferences,
		applyReferenceAnnotations,
		type ReferenceDetectionCopy,
		type ReferenceDetectionPlan
	} from '$lib/services/ReferenceDetectionService';
	import type { SpeechToTextCopy } from '$lib/services/SpeechToTextService';
	import TranslationsEditorModalShell from '$lib/components/projectEditor/tabs/translationsEditor/modal/shared/TranslationsEditorModalShell.svelte';

	let { close }: { close: () => void } = $props();
	const project = untrack(() => globalState.currentProject!);
	const controller = new AbortController();
	let detectQuran = $state(true);
	let detectCitations = $state(true);
	let additionalPreferences = $state('');
	let busy = $state(false);
	let progress = $state(0);
	let errorMessage = $state('');
	let appliedCount = $state<number | null>(null);
	let plan = $state<ReferenceDetectionPlan | null>(null);
	let selectedIds = $state<number[]>([]);
	const copy = $derived(
		($LL.editor as unknown as { referenceDetection: ReferenceDetectionCopy }).referenceDetection
	);
	const speechCopy = $derived(
		($LL.editor as unknown as { speechToText: SpeechToTextCopy }).speechToText
	);
	const hasKey = $derived(Boolean(globalState.settings?.aiTranslationSettings.openAiApiKey.trim()));
	const proposals = $derived(
		plan?.proposals.filter(
			(proposal) => proposal.kind !== 'none' && proposal.status !== 'rejected'
		) ?? []
	);
	const confirmedIds = $derived(
		proposals.filter((proposal) => proposal.status === 'confirmed').map((proposal) => proposal.id)
	);
	const subtitles = $derived(
		project.content.timeline
			.getFirstTrack(TrackType.Subtitle)
			.clips.filter((clip): clip is SubtitleClip => clip instanceof SubtitleClip)
	);
	const inputClass =
		'w-full rounded-lg border border-color bg-primary px-3 py-2 text-sm text-primary';
	onDestroy(() => controller.abort());

	/**
	 * Ferme le modal et empêche les résultats d'une requête tardive.
	 * @returns {void}
	 */
	function dismiss(): void {
		controller.abort();
		close();
	}

	/**
	 * Invalide l'aperçu quand les préférences changent.
	 * @returns {void}
	 */
	function resetResults(): void {
		plan = null;
		selectedIds = [];
		appliedCount = null;
		errorMessage = '';
	}

	/**
	 * Produit des propositions sans modifier le projet.
	 * @returns {Promise<void>}
	 */
	async function detect(): Promise<void> {
		if (busy) return;
		resetResults();
		busy = true;
		progress = 0;
		try {
			const result = await detectProjectReferences(
				project,
				{ detectQuran, detectCitations, additionalPreferences },
				controller.signal,
				(value) => {
					progress = Math.round(value * 100);
				}
			);
			if (controller.signal.aborted) return;
			plan = result;
			selectedIds = confirmedIds;
		} catch (error) {
			if (!controller.signal.aborted)
				errorMessage = error instanceof Error ? error.message : copy.requestError();
		} finally {
			busy = false;
		}
	}

	/**
	 * Applique uniquement les propositions choisies dans l'aperçu.
	 * @param {number[]} ids Propositions sélectionnées ou totalité des annotations confirmées.
	 * @returns {void}
	 */
	function apply(ids: number[]): void {
		if (!plan || busy || !ids.length) return;
		errorMessage = '';
		try {
			appliedCount = applyReferenceAnnotations(project, plan, ids);
			plan = null;
			selectedIds = [];
			dismiss();
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : copy.sourceChanged();
		}
	}

	/**
	 * Ouvre les réglages existants du fournisseur Text AI.
	 * @returns {void}
	 */
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
		icon="format_quote"
		shellClass="h-[80vh] max-h-[90vh] w-[1100px] max-w-[calc(100vw-2rem)]"
		bodyClass="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_320px] md:overflow-hidden"
	>
		{#snippet subtitle()}{copy.description()}{/snippet}
		<section
			class="min-h-0 space-y-4 overflow-y-auto border-b border-color p-5 md:border-b-0 md:border-r"
		>
			{#if plan}
				<h3 class="text-sm font-semibold text-primary">
					{copy.proposals()} ({proposals.length})
				</h3>
				{#if !proposals.length}<p role="status" class="text-sm text-secondary">
						{copy.noResults()}
					</p>{/if}
				<ol class="space-y-3">
					{#each proposals as proposal (proposal.id)}
						<li class="space-y-2 rounded-lg border border-color bg-primary p-3">
							<label class="flex items-start gap-3 text-sm text-primary">
								<input
									type="checkbox"
									value={proposal.id}
									bind:group={selectedIds}
									disabled={proposal.status !== 'confirmed'}
									aria-label={`${copy.selectProposal()} ${proposal.id + 1}`}
									class="mt-1"
								/>
								<span class="min-w-0 flex-1 space-y-2">
									<span
										class="flex flex-wrap items-center justify-between gap-2 text-xs text-secondary"
									>
										<span>{proposal.kind === 'citation' ? copy.citations() : copy.quran()}</span>
										<span class="rounded-full bg-secondary px-2 py-1"
											>{copy[proposal.status]()}</span
										>
									</span>
									<span dir="auto" class="block whitespace-pre-wrap break-words leading-relaxed"
										>{proposal.source}</span
									>
									{#if proposal.reference}<span class="monospaced block text-xs text-accent"
											>{proposal.reference.surah}:{proposal.reference.verse}:{proposal.reference
												.startWord}-{proposal.reference.endWord}</span
										>{/if}
									{#if proposal.canonical}<span dir="auto" class="block text-sm text-secondary"
											>{proposal.canonical}</span
										>{/if}
								</span>
							</label>
							<p dir="auto" class="text-xs text-thirdly">{proposal.reason}</p>
						</li>
					{/each}
				</ol>
				{#if plan.skipped}<p class="text-xs text-amber-400">
						{copy.skipped()} ({plan.skipped})
					</p>{/if}
			{:else}
				<p class="text-sm text-secondary">{copy.description()}</p>
			{/if}
		</section>
		<section class="space-y-5 overflow-y-auto p-5">
			<fieldset disabled={busy} class="space-y-4 disabled:opacity-60">
				<label class="flex items-center gap-2 text-sm text-primary"
					><input
						type="checkbox"
						bind:checked={detectQuran}
						onchange={resetResults}
					/>{copy.quran()}</label
				>
				<label class="flex items-center gap-2 text-sm text-primary"
					><input
						type="checkbox"
						bind:checked={detectCitations}
						onchange={resetResults}
					/>{copy.citations()}</label
				>
				<label class="block space-y-1 text-sm text-secondary"
					><span>{speechCopy.additionalPreferences()}</span><textarea
						rows="4"
						bind:value={additionalPreferences}
						oninput={resetResults}
						class={inputClass}
					></textarea></label
				>
				<button
					type="button"
					onclick={openSettings}
					class="cursor-pointer text-sm text-accent underline">{speechCopy.textAiSettings()}</button
				>
			</fieldset>
			<p class="text-xs text-thirdly">{copy.notice()}</p>
			<p class="text-xs text-thirdly">{copy.preserved()}</p>
			{#if !hasKey}<p class="text-xs text-amber-400">{copy.keyRequired()}</p>{/if}
			<button
				type="button"
				onclick={detect}
				disabled={busy || !hasKey || !subtitles.length || (!detectQuran && !detectCitations)}
				class="btn-accent w-full px-3 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
				>{copy.start()}</button
			>
			{#if plan}<button
					type="button"
					onclick={() => apply(selectedIds)}
					disabled={busy || !selectedIds.length}
					class="btn-accent w-full px-3 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
					>{copy.apply()} ({selectedIds.length})</button
				>{/if}
			{#if plan}<button
					type="button"
					onclick={() => apply(confirmedIds)}
					disabled={busy || !confirmedIds.length}
					class="btn-accent w-full px-3 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
					>{copy.applyAll()} ({confirmedIds.length})</button
				>{/if}
			{#if busy}
				<p role="status" class="text-sm text-secondary">{copy.analyzing()} ({progress}%)</p>
				<p class="text-xs text-thirdly">{speechCopy.cancelHint()}</p>
				<button
					type="button"
					onclick={dismiss}
					class="w-full cursor-pointer rounded-lg border border-color px-3 py-2 text-sm text-primary"
					>{$LL.common.cancel()}</button
				>
			{/if}
			{#if appliedCount !== null}<p role="status" class="text-sm text-secondary">
					{copy.complete()} ({appliedCount})
				</p>{/if}
			{#if errorMessage}<p role="alert" class="text-sm text-red-400">{errorMessage}</p>{/if}
		</section>
	</TranslationsEditorModalShell>
</div>
