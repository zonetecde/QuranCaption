<script lang="ts">
	import AiBatchSummary from '$lib/components/ai/AiBatchSummary.svelte';
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import { AssetClip, AssetType, Duration, SubtitleClip, TrackType } from '$lib/classes';
	import { SettingsTab } from '$lib/classes/Settings.svelte';
	import LL, { locale } from '$lib/i18n/i18n-svelte';
	import { getLocaleDirection } from '$lib/i18n/direction';
	import AiAccessTabs from '$lib/components/modals/AiAccessTabs.svelte';
	import ManualAiWorkflow from '$lib/components/modals/ManualAiWorkflow.svelte';
	import { ManualAiSession, type ManualAiCopy } from '$lib/services/ManualAiSession.svelte';
	import { AnalyticsService } from '$lib/services/AnalyticsService';
	import { globalState } from '$lib/runes/main.svelte';
	import {
		detectSubtitleCorrections,
		applySubtitleCorrections,
		correctSubtitleCorrectionWarning,
		type SubtitleCorrectionCopy,
		type SubtitleCorrectionPlan
	} from '$lib/services/SubtitleCorrectionService';
	import type { SpeechToTextCopy } from '$lib/services/SpeechToTextService';
	import TranslationsEditorModalShell from '$lib/components/projectEditor/tabs/translationsEditor/modal/shared/TranslationsEditorModalShell.svelte';

	let { close }: { close: () => void } = $props();
	const project = untrack(() => globalState.currentProject!);
	let manualMode = $state(false);
	let convertArabicPhonetics = $state(true);
	const manualSession = new ManualAiSession();
	const manualCopy = $derived(($LL.editor as unknown as { manualAi: ManualAiCopy }).manualAi);
	const timeline = project.projectEditorState.timeline;
	const preview = project.projectEditorState.videoPreview;
	const controller = new AbortController();
	let busy = $state(false);
	let progress = $state(0);
	let batchCount = $state<number | null>(null);
	let errorMessage = $state('');
	let appliedCount = $state<number | null>(null);
	let plan = $state<SubtitleCorrectionPlan | null>(null);
	let selectedIds = $state<number[]>([]);
	let warningDrafts = $state<Record<number, string>>({});
	let activeClip = $state<SubtitleClip | null>(null);
	const copy = $derived(
		($LL.editor as unknown as { subtitleCorrection: SubtitleCorrectionCopy }).subtitleCorrection
	);
	const speechCopy = $derived(
		($LL.editor as unknown as { speechToText: SpeechToTextCopy }).speechToText
	);
	const hasKey = $derived(Boolean(globalState.settings?.aiTranslationSettings.openAiApiKey.trim()));
	const subtitles = $derived(
		project.content.timeline
			.getFirstTrack(TrackType.Subtitle)
			.clips.filter((clip) => clip instanceof SubtitleClip)
	);
	const audioClips = $derived(
		project.content.timeline.tracks
			.filter((track) => track.type === TrackType.Audio || track.type === TrackType.Video)
			.flatMap((track) => track.clips)
			.filter(
				(clip) =>
					clip instanceof AssetClip &&
					project.content.assets.some(
						(asset) =>
							asset.id === clip.assetId &&
							(asset.type === AssetType.Audio || asset.type === AssetType.Video)
					)
			)
	);

	onMount(() => {
		if (preview.isPlaying) preview.togglePlayPause();
	});
	onDestroy(() => {
		controller.abort();
		manualSession.cancel();
		stopPlayback();
	});

	$effect(() => {
		if (
			activeClip &&
			(globalState.currentProject !== project ||
				timeline.cursorPosition >= activeClip.endTime ||
				timeline.cursorPosition < activeClip.startTime)
		)
			untrack(stopPlayback);
	});

	/**
	 * Arrête la préécoute du passage courant sans relancer un autre lecteur.
	 * @returns {void}
	 */
	function stopPlayback(): void {
		if (globalState.currentProject === project && preview.isPlaying) preview.togglePlayPause();
		activeClip = null;
	}

	/**
	 * Joue ou reprend le passage avec le lecteur existant et ses décalages de source.
	 * @param {SubtitleClip} clip Sous-titre à écouter.
	 * @returns {Promise<void>} Résolution après synchronisation de la position.
	 */
	async function toggleAudio(clip: SubtitleClip): Promise<void> {
		if (globalState.currentProject !== project || controller.signal.aborted) return;
		if (activeClip === clip) {
			preview.togglePlayPause();
			return;
		}
		stopPlayback();
		// Le lecteur existant utilise une position non nulle pour déclencher la synchronisation.
		timeline.cursorPosition = Math.max(1, clip.startTime);
		timeline.movePreviewTo = timeline.cursorPosition;
		activeClip = clip;
		await tick();
		if (!controller.signal.aborted && activeClip === clip && globalState.currentProject === project)
			preview.togglePlayPause();
	}

	/**
	 * Ferme la fenêtre et annule tout résultat tardif.
	 * @returns {void}
	 */
	function dismiss(): void {
		controller.abort();
		manualSession.cancel();
		stopPlayback();
		close();
	}

	/**
	 * Analyse le texte sans appliquer les corrections proposées.
	 * @returns {Promise<void>} Résolution après réception de toutes les propositions.
	 */
	async function detect(): Promise<void> {
		if (busy) return;
		stopPlayback();
		plan = null;
		selectedIds = [];
		warningDrafts = {};
		appliedCount = null;
		errorMessage = '';
		busy = true;
		progress = 0;
		batchCount = null;
		if (manualMode) manualSession.start();
		try {
			/** Lance le parcours choisi. @returns {Promise<SubtitleCorrectionPlan>} Aperçu validé. */
			const run = () =>
				detectSubtitleCorrections(
					project,
					controller.signal,
					(value, total) => {
						progress = Math.round(value * 100);
						batchCount = total;
					},
					manualMode ? manualSession : undefined,
					convertArabicPhonetics
				);
			const result = manualMode
				? await run()
				: await AnalyticsService.trackSubtitleAiRequest(
						'transcription_correction',
						controller.signal,
						run,
						{ subtitles_count: subtitles.length }
					);
			if (controller.signal.aborted) return;
			plan = result;
			warningDrafts = Object.fromEntries(
				result.warnings.map(({ id, suggestion }) => [id, suggestion])
			);
			if (manualMode) manualSession.finish();
			selectedIds = result.proposals.map(({ id }) => id);
		} catch (error) {
			if (manualMode) manualSession.cancel();
			batchCount = null;
			if (!controller.signal.aborted)
				errorMessage = error instanceof Error ? error.message : copy.requestError();
		} finally {
			busy = false;
		}
	}

	/**
	 * Applique les propositions approuvées dans une seule action annulable.
	 * @param {number[]} ids Corrections choisies ou totalité des propositions.
	 * @returns {void}
	 */
	function apply(ids: number[]): void {
		if (!plan || busy || !ids.length) return;
		stopPlayback();
		errorMessage = '';
		try {
			appliedCount = applySubtitleCorrections(project, plan, ids);
			AnalyticsService.track('ai_transcription_correction_applied', {
				corrections_count: appliedCount
			});
			plan = null;
			selectedIds = [];
			dismiss();
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : copy.sourceChanged();
			AnalyticsService.track('ai_transcription_correction_failed', { stage: 'applying' });
		}
	}

	/**
	 * Applique le texte corrigé d'un passage suspect en conservant les autres résultats.
	 * @param {number} id Identifiant du passage suspect.
	 * @returns {void}
	 */
	function correctWarning(id: number): void {
		if (!plan || busy) return;
		stopPlayback();
		errorMessage = '';
		try {
			correctSubtitleCorrectionWarning(plan, id, warningDrafts[id]);
			warningDrafts[id] = plan.warnings.find((warning) => warning.id === id)!.text;
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : copy.sourceChanged();
		}
	}

	/**
	 * Ouvre les réglages du fournisseur IA déjà configuré.
	 * @returns {void}
	 */
	function openSettings(): void {
		globalState.uiState.settingsTab = SettingsTab.AI_KEY;
		globalState.uiState.isSettingsOpen = true;
		dismiss();
	}

	/** Efface l'aperçu lorsque le mode de connexion change. @returns {void} */
	function resetMode(): void {
		stopPlayback();
		plan = null;
		selectedIds = [];
		errorMessage = '';
		appliedCount = null;
		batchCount = null;
		manualSession.cancel();
	}
</script>

<div role="dialog" tabindex="-1" aria-modal="true" aria-label={copy.title()}>
	<TranslationsEditorModalShell
		close={dismiss}
		title={copy.title()}
		icon="spellcheck"
		shellClass="h-[82vh] max-h-[92vh] w-[1160px] max-w-[calc(100vw-2rem)]"
		bodyClass="min-h-0 flex-1 overflow-y-auto md:grid md:grid-cols-[minmax(0,1fr)_300px] md:overflow-hidden"
	>
		{#snippet subtitle()}{copy.description()}{/snippet}
		{#snippet afterHeader()}<AiAccessTabs
				bind:manual={manualMode}
				disabled={busy}
				onchange={resetMode}
			/>{/snippet}
		<section class="flex flex-col border-b border-color md:min-h-0 md:border-b-0 md:border-e">
			{#if manualMode && plan}<ManualAiWorkflow
					session={manualSession}
					{progress}
					total={batchCount}
				/>{/if}
			{#if manualMode && !plan}
				<div class="min-h-0 overflow-y-auto">
					<ManualAiWorkflow session={manualSession} {progress} total={batchCount} />
				</div>
			{:else if plan && (plan.proposals.length || plan.warnings.length)}
				<div
					class="flex flex-wrap items-center justify-between gap-3 border-b border-color px-5 py-4"
				>
					<div>
						<h3 class="font-semibold text-primary">
							{plan.proposals.length ? copy.reviewTitle() : copy.warningsTitle()}
							<span class="ms-2 rounded-full bg-accent px-2 py-0.5 text-sm text-accent"
								>{plan.proposals.length + plan.warnings.length}</span
							>
						</h3>
						<p class="mt-1 text-xs text-secondary">{copy.reviewDescription()}</p>
					</div>
					{#if plan.proposals.length}<button
							type="button"
							class="btn px-3 py-2 text-xs"
							onclick={() =>
								(selectedIds =
									selectedIds.length === plan!.proposals.length
										? []
										: plan!.proposals.map(({ id }) => id))}
						>
							{selectedIds.length === plan.proposals.length
								? $LL.common.deselectAll()
								: $LL.common.selectAll()}
						</button>{/if}
				</div>
				<div class="space-y-4 p-4 md:min-h-0 md:flex-1 md:overflow-y-auto md:p-5">
					<ol class="space-y-4">
						{#each plan.proposals as proposal (proposal.id)}
							{@const selected = selectedIds.includes(proposal.id)}
							{@const playing = activeClip === proposal.clip && preview.isPlaying}
							{@const hasAudio = audioClips.some(
								(clip) =>
									clip.startTime < proposal.clip.endTime && clip.endTime > proposal.clip.startTime
							)}
							<li
								class="overflow-hidden rounded-xl border bg-primary transition-colors {selected
									? 'border-[var(--accent-primary)]'
									: 'border-color'}"
							>
								<div
									class="flex items-center justify-between gap-3 border-b border-color px-4 py-3"
								>
									<label class="flex cursor-pointer items-center gap-3 text-sm text-primary">
										<input
											type="checkbox"
											value={proposal.id}
											bind:group={selectedIds}
											aria-label={`${copy.select()} ${proposal.id}`}
											class="h-4 w-4 rounded accent-[var(--accent-primary)]"
										/>
										<span class="font-semibold">#{proposal.id}</span>
										<span class="monospaced text-xs text-secondary"
											>{new Duration(proposal.clip.startTime).getFormattedTime(false, true)} – {new Duration(
												proposal.clip.endTime
											).getFormattedTime(false, true)}</span
										>
									</label>
									<button
										type="button"
										onclick={() => toggleAudio(proposal.clip)}
										disabled={!hasAudio}
										aria-label={`${playing ? copy.pause() : copy.listen()} ${proposal.id}`}
										title={hasAudio ? copy.listenHint() : copy.noAudio()}
										class="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-accent text-accent transition hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-30"
										aria-pressed={playing}
									>
										<span class="material-icons text-xl" aria-hidden="true"
											>{playing ? 'pause' : 'play_arrow'}</span
										>
									</button>
								</div>
								<div class="grid grid-cols-1 sm:grid-cols-2">
									<div class="space-y-2 border-b border-color p-4 sm:border-e sm:border-b-0">
										<p class="text-xs font-medium text-secondary">{copy.original()}</p>
										<p
											dir="auto"
											class="whitespace-pre-wrap break-words text-base leading-relaxed text-secondary"
										>
											{proposal.before}
										</p>
									</div>
									<div class="space-y-2 bg-accent/30 p-4">
										<p class="flex items-center gap-1.5 text-xs font-medium text-accent">
											<span class="material-icons text-sm" aria-hidden="true">auto_fix_high</span
											>{copy.corrected()}
										</p>
										<p
											dir="auto"
											class="whitespace-pre-wrap break-words text-base leading-relaxed text-primary"
										>
											{proposal.after}
										</p>
									</div>
								</div>
								<div
									class="flex items-start gap-2 border-t border-color px-4 py-3 text-xs leading-relaxed text-secondary"
								>
									<span class="material-icons text-base text-accent" aria-hidden="true"
										>lightbulb</span
									>
									<p dir={getLocaleDirection($locale)}>{proposal.reason}</p>
								</div>
								{#if activeClip === proposal.clip}
									<div class="h-0.5 bg-secondary" aria-hidden="true">
										<div
											class="h-full bg-accent-primary transition-[width] duration-100"
											style:width={`${Math.min(100, Math.max(0, ((timeline.cursorPosition - proposal.clip.startTime) / (proposal.clip.endTime - proposal.clip.startTime)) * 100))}%`}
										></div>
									</div>
								{/if}
							</li>
						{/each}
					</ol>
					{#if plan.warnings.length}
						<section class="space-y-3">
							<h4 class="flex items-center gap-2 text-sm font-semibold text-yellow-300">
								<span class="material-icons text-lg" aria-hidden="true">warning_amber</span
								>{copy.warningsTitle()} ({plan.warnings.length})
							</h4>
							<p class="text-xs leading-relaxed text-secondary">{copy.warningsDescription()}</p>
							{#each plan.warnings as warning (warning.id)}
								{@const playing = activeClip === warning.clip && preview.isPlaying}
								{@const hasAudio = audioClips.some(
									(clip) =>
										clip.startTime < warning.clip.endTime && clip.endTime > warning.clip.startTime
								)}
								<article
									class="space-y-3 rounded-xl border bg-primary p-4 {!warning.clip.needsReview
										? 'border-green-500/30'
										: 'border-yellow-500/40'}"
								>
									<div class="flex flex-wrap items-center justify-between gap-3">
										<p class="monospaced text-xs text-secondary">
											#{warning.id} · {new Duration(warning.clip.startTime).getFormattedTime(
												false,
												true
											)}
										</p>
										<div class="flex items-center gap-2">
											<button
												type="button"
												onclick={() => toggleAudio(warning.clip)}
												disabled={!hasAudio}
												aria-label={`${playing ? copy.pause() : copy.listen()} ${warning.id}`}
												title={hasAudio ? copy.listenHint() : copy.noAudio()}
												class="btn flex h-9 w-9 items-center justify-center disabled:opacity-30"
												aria-pressed={playing}
												><span class="material-icons text-lg" aria-hidden="true"
													>{playing ? 'pause' : 'play_arrow'}</span
												></button
											>
											{#if warningDrafts[warning.id].trim() !== warning.text.trim()}<button
													type="button"
													onclick={() => correctWarning(warning.id)}
													disabled={!warningDrafts[warning.id].trim() ||
														/[{}]/u.test(warningDrafts[warning.id])}
													class="btn-accent px-3 py-2 text-xs disabled:opacity-50"
													>{copy.confirmCorrection()}</button
												>{/if}
										</div>
									</div>
									<label class="block space-y-2">
										<span class="block text-xs font-medium text-secondary">{copy.original()}</span>
										<span
											dir="auto"
											class="block whitespace-pre-wrap break-words text-sm text-secondary"
											>{warning.text}</span
										>
										<span class="text-xs font-medium text-secondary">{copy.warningText()}</span>
										<textarea
											dir="auto"
											rows="2"
											bind:value={warningDrafts[warning.id]}
											aria-label={`${copy.warningText()} ${warning.id}`}
											class="w-full resize-y rounded-lg border border-color bg-secondary px-3 py-2 text-base leading-relaxed text-primary focus:border-[var(--accent-primary)]"
										></textarea>
									</label>
									<p
										dir={getLocaleDirection($locale)}
										class="text-xs leading-relaxed text-secondary"
									>
										{warning.reason}
									</p>
								</article>
							{/each}
						</section>
					{/if}
				</div>
			{:else}
				<div
					class="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-10 text-center md:px-14"
				>
					<div
						class="mb-6 flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border border-color bg-gradient-to-br from-accent to-transparent text-accent"
					>
						<span class="material-icons text-4xl {busy ? 'animate-pulse' : ''}" aria-hidden="true"
							>{busy
								? 'manage_search'
								: appliedCount !== null || plan
									? 'task_alt'
									: 'spellcheck'}</span
						>
					</div>
					<h3 class="text-xl font-semibold text-primary">
						{busy
							? copy.analyzing()
							: appliedCount !== null
								? copy.complete()
								: plan
									? copy.noResults()
									: copy.introTitle()}
					</h3>
					<p class="mt-3 max-w-md text-sm leading-relaxed text-secondary">
						{appliedCount !== null
							? copy.preserved()
							: plan
								? copy.noResultsDescription()
								: copy.introDescription()}
					</p>
					{#if busy}
						<div class="mt-6 w-full max-w-xs" role="status">
							<div class="h-1.5 overflow-hidden rounded-full bg-primary">
								<div
									class="h-full rounded-full bg-accent-primary transition-all duration-300"
									style:width={`${progress}%`}
								></div>
							</div>
							<p class="mt-2 text-xs text-secondary">{progress}%</p>
						</div>
					{:else if !plan && appliedCount === null}
						<div
							class="mt-8 flex max-w-md items-start gap-3 rounded-xl border border-color bg-primary p-4 text-start"
						>
							<span class="material-icons text-xl text-accent" aria-hidden="true"
								>verified_user</span
							>
							<div>
								<p class="text-sm font-medium text-primary">{copy.conservative()}</p>
								<p class="mt-1 text-xs leading-relaxed text-secondary">
									{copy.conservativeDescription()}
								</p>
							</div>
						</div>
					{/if}
				</div>
			{/if}
		</section>
		<aside class="flex flex-col gap-5 p-5 md:min-h-0 md:overflow-y-auto">
			<AiBatchSummary {subtitles} feature="correction" total={batchCount} />
			<div class="flex items-center justify-between text-sm text-secondary">
				<span>{$LL.editor.transcriptSegments()}</span><span
					class="rounded-md bg-primary px-2.5 py-1 font-semibold text-primary"
					>{subtitles.length}</span
				>
			</div>
			<label
				class="flex cursor-pointer items-start gap-3 rounded-xl border border-color bg-primary p-4"
			>
				<input
					type="checkbox"
					bind:checked={convertArabicPhonetics}
					disabled={busy}
					class="mt-1 h-4 w-4 shrink-0 rounded accent-[var(--accent-primary)]"
				/>
				<span class="text-sm font-medium text-primary">
					{copy.convertArabicPhonetics()}
					<span
						class="material-icons cursor-help align-middle text-sm! opacity-50 text-secondary"
						title={copy.convertArabicPhoneticsDescription()}
						aria-label={copy.convertArabicPhoneticsDescription()}
						role="img">info_outline</span
					>
				</span>
			</label>
			<div class="space-y-3 rounded-xl border border-color bg-primary p-4">
				<span class="material-icons text-xl text-accent" aria-hidden="true">headphones</span>
				<p class="text-sm leading-relaxed text-primary">{copy.notice()}</p>
				<p class="text-xs leading-relaxed text-secondary">{copy.listenHint()}</p>
			</div>
			<p class="text-xs leading-relaxed text-thirdly">{copy.preserved()}</p>
			{#if plan?.skipped}<p class="text-xs leading-relaxed text-amber-400">
					{copy.skipped()} ({plan.skipped})
				</p>{/if}
			{#if !manualMode}<button
					type="button"
					onclick={openSettings}
					disabled={busy}
					class="self-start cursor-pointer text-xs text-accent underline underline-offset-4 disabled:opacity-50"
					>{speechCopy.textAiSettings()}</button
				>{/if}
			{#if !manualMode && !hasKey}<p class="text-xs text-amber-400">{copy.keyRequired()}</p>{/if}
			{#if errorMessage}<p
					role="alert"
					class="rounded-lg border border-red-400/20 bg-red-400/5 p-3 text-sm text-red-400"
				>
					{errorMessage}
				</p>{/if}
			{#if appliedCount !== null}<p role="status" class="text-sm text-accent">
					{copy.complete()} ({appliedCount})
				</p>{/if}
			<div class="mt-auto space-y-3 border-t border-color pt-5">
				{#if plan?.proposals.length}
					<div class="flex justify-between text-xs text-secondary">
						<span>{copy.selected()}</span><span class="font-semibold text-primary"
							>{selectedIds.length} / {plan.proposals.length}</span
						>
					</div>
					<button
						type="button"
						onclick={() => apply(selectedIds)}
						disabled={busy || !selectedIds.length}
						class="btn-accent w-full px-3 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
						>{copy.apply()} ({selectedIds.length})</button
					>
					<button
						type="button"
						onclick={() => apply(plan!.proposals.map(({ id }) => id))}
						disabled={busy}
						class="btn w-full px-3 py-2.5 text-sm">{copy.applyAll()}</button
					>
				{/if}
				<button
					type="button"
					onclick={detect}
					disabled={busy || (!manualMode && !hasKey) || !subtitles.length}
					class="{plan?.proposals.length
						? 'btn'
						: 'btn-accent'} flex w-full items-center justify-center gap-2 px-3 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
					><span class="material-icons text-lg" aria-hidden="true">manage_search</span>{manualMode
						? manualCopy.prepare()
						: copy.start()}</button
				>
				{#if busy && !manualMode}<p class="text-xs text-thirdly">{speechCopy.cancelHint()}</p>
					<button type="button" onclick={dismiss} class="btn w-full px-3 py-2.5 text-sm"
						>{$LL.common.cancel()}</button
					>{/if}
			</div>
		</aside>
	</TranslationsEditorModalShell>
</div>
