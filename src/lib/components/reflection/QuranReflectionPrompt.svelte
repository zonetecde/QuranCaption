<script lang="ts">
	import { onMount } from 'svelte';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import toast from 'svelte-5-french-toast';
	import LL from '$lib/i18n/i18n-svelte';
	import { Quran } from '$lib/classes/Quran';
	import { globalState } from '$lib/runes/main.svelte';
	import { AnalyticsService } from '$lib/services/AnalyticsService';
	import { mobileModalSheet } from '$lib/services/mobileModalSheet';
	import { quranAuthService } from '$lib/services/QuranAuthService.svelte';
	import {
		createPrivateReflectionNote,
		getCuratedReflections,
		getReflectionSubmissionScopes,
		hasReflectionSubmissionScopes,
		parsePendingQuranReflection,
		publishReflectionNote,
		type QuranReflectionContext,
		type PendingQuranReflection,
		type QuranReflectionPreview,
		type ReflectionSubmissionMode
	} from '$lib/services/QuranReflectionService';

	type ReflectionMode = ReflectionSubmissionMode;
	type ReflectionStage = 'composer' | 'auth' | 'success';
	type ReflectionSelectionMode = 'whole' | 'range' | 'single';
	type ReflectionCopy = Record<string, (args?: Record<string, string | number>) => string>;

	const PENDING_REFLECTION_KEY = 'quran_reflection_pending';

	let visible = $state(false);
	let context = $state<QuranReflectionContext | null>(null);
	let selectedSurahNumber = $state(0);
	let selectedSpanIndex = $state(0);
	let selectedFrom = $state(1);
	let selectedTo = $state(1);
	let selectionMode = $state<ReflectionSelectionMode>('range');
	let stage = $state<ReflectionStage>('composer');
	let draft = $state('');
	let pendingAction = $state<ReflectionMode | null>(null);
	let pendingNoteId = $state<string | null>(null);
	let examples = $state<QuranReflectionPreview[]>([]);
	let examplesLoading = $state(false);
	let examplesReady = $state(false);
	let examplesFailed = $state(false);
	let isSubmitting = $state(false);
	let submitFailed = $state(false);
	let successMode = $state<ReflectionMode | null>(null);
	let panelScale = $derived(
		1 + (globalState.settings?.persistentUiState.editorPanelScalePercent ?? -15) / 100
	);
	let copy = $derived($LL.export as unknown as ReflectionCopy);
	let selectedSurah = $derived(context?.surahs.find((item) => item.surah === selectedSurahNumber));
	let selectedSpan = $derived(selectedSurah?.ranges[selectedSpanIndex]);
	let selectedSurahName = $derived(
		Quran.surahs.find((surah) => surah.id === selectedSurahNumber)?.name ?? selectedSurahNumber
	);
	let selectedSurahVerseCount = $derived(Quran.getVerseCount(selectedSurahNumber) || 1);
	let reflectionPlaceholder = $derived(
		selectionMode === 'whole'
			? copy.reflectionWholePlaceholder({ surah: selectedSurahName })
			: selectionMode === 'single'
				? copy.reflectionSinglePlaceholder({
						surah: selectedSurahName,
						verse: selectedFrom
					})
				: copy.reflectionRangePlaceholder({
						surah: selectedSurahName,
						from: selectedFrom,
						to: selectedTo
					})
	);

	/** Construit les seules propriétés analytiques non personnelles de la sélection. */
	function analyticsProperties(mode?: ReflectionMode): Record<string, string | number | boolean> {
		return {
			surah: selectedSurahNumber,
			selected_verse_count: selectedTo - selectedFrom + 1,
			whole_surah: selectionMode === 'whole',
			multi_surah_export: Boolean(context?.multiSurah),
			...(mode ? { mode } : {})
		};
	}

	/** Initialise la sélection avec le premier passage valide du contexte. */
	function openPrompt(nextContext: QuranReflectionContext): void {
		context = nextContext;
		selectedSurahNumber = nextContext.surahs[0].surah;
		selectedSpanIndex = 0;
		selectionMode = nextContext.surahs[0].wholeSurah
			? 'whole'
			: nextContext.surahs[0].ranges[0].from === nextContext.surahs[0].ranges[0].to
				? 'single'
				: 'range';
		selectedFrom = selectionMode === 'whole' ? 1 : nextContext.surahs[0].ranges[0].from;
		selectedTo =
			selectionMode === 'whole'
				? Quran.getVerseCount(selectedSurahNumber)
				: nextContext.surahs[0].ranges[0].to;
		stage = 'composer';
		draft = '';
		pendingAction = null;
		pendingNoteId = null;
		submitFailed = false;
		examplesReady = false;
		examplesFailed = false;
		visible = true;
		globalState.uiState.showReflectionPrompt = true;
		AnalyticsService.track('reflection_prompt_shown', analyticsProperties());
	}

	/** Ferme volontairement le panneau et supprime son brouillon persistant. */
	function dismissPrompt(): void {
		AnalyticsService.track('reflection_prompt_dismissed', analyticsProperties());
		visible = false;
		globalState.uiState.showReflectionPrompt = false;
		sessionStorage.removeItem(PENDING_REFLECTION_KEY);
	}

	/** Sélectionne une sourate exportée sans modifier le brouillon. */
	function selectSurah(surah: number): void {
		const item = context?.surahs.find((candidate) => candidate.surah === surah);
		if (!item) return;
		selectedSurahNumber = surah;
		selectedSpanIndex = 0;
		selectedFrom = selectionMode === 'whole' ? 1 : item.ranges[0].from;
		selectedTo =
			selectionMode === 'whole'
				? Quran.getVerseCount(surah)
				: selectionMode === 'single'
					? selectedFrom
					: item.ranges[0].to;
		trackRangeChange();
	}

	/** Bascule entre la sourate entière et une plage de versets. */
	function selectReflectionMode(mode: ReflectionSelectionMode): void {
		selectionMode = mode;
		selectedFrom = mode === 'whole' ? 1 : (selectedSpan?.from ?? 1);
		selectedTo =
			mode === 'whole'
				? selectedSurahVerseCount
				: mode === 'single'
					? selectedFrom
					: (selectedSpan?.to ?? 1);
		trackRangeChange();
	}

	/**
	 * Sélectionne une seule ayah et maintient une plage composée de ce verset uniquement.
	 * @param {number} value Numéro de l'ayah sélectionnée.
	 * @returns {void}
	 */
	function selectSingleVerse(value: number): void {
		selectedFrom = value;
		selectedTo = value;
		trackRangeChange();
	}

	/** Ajuste la première ayah tout en maintenant une plage valide. */
	function selectFrom(value: number): void {
		selectedFrom = value;
		if (selectedTo < value) selectedTo = value;
		trackRangeChange();
	}

	/** Ajuste la dernière ayah tout en maintenant une plage valide. */
	function selectTo(value: number): void {
		selectedTo = value;
		if (selectedFrom > value) selectedFrom = value;
		trackRangeChange();
	}

	/** Enregistre un changement de plage sans inclure le texte du brouillon. */
	function trackRangeChange(): void {
		AnalyticsService.track('reflection_range_changed', analyticsProperties());
		persistPending();
	}

	/**
	 * Ouvre une réflexion complète sur QuranReflect sans exposer son contenu aux analytics.
	 * @param {QuranReflectionPreview} example Réflexion sélectionnée.
	 * @returns {void}
	 */
	function openReflectionExample(example: QuranReflectionPreview): void {
		if (!example.url) return;
		AnalyticsService.track('reflection_example_opened', analyticsProperties());
		void openUrl(example.url);
	}

	/** Persiste la sélection et le brouillon nécessaires à un retour OAuth. */
	function persistPending(): void {
		if (!context) return;
		const pending: PendingQuranReflection = {
			context,
			surah: selectedSurahNumber,
			spanIndex: selectedSpanIndex,
			from: selectedFrom,
			to: selectedTo,
			draft,
			action: pendingAction,
			noteId: pendingNoteId,
			selectionMode
		};
		sessionStorage.setItem(PENDING_REFLECTION_KEY, JSON.stringify(pending));
	}

	/** Restaure un brouillon interrompu par OAuth ou un redémarrage. */
	function restorePending(): void {
		const stored = sessionStorage.getItem(PENDING_REFLECTION_KEY);
		if (!stored) return;
		try {
			const pending = parsePendingQuranReflection(stored);
			if (!pending) throw new Error('INVALID_PENDING_REFLECTION');
			context = pending.context;
			selectedSurahNumber = pending.surah;
			selectedSpanIndex = pending.spanIndex;
			selectedFrom = pending.from;
			selectedTo = pending.to;
			selectionMode = pending.selectionMode ?? 'range';
			draft = pending.draft;
			pendingAction = pending.action;
			pendingNoteId = pending.noteId;
			stage = pending.action ? 'auth' : 'composer';
			examplesReady = false;
			visible = true;
			globalState.uiState.showReflectionPrompt = true;
		} catch {
			sessionStorage.removeItem(PENDING_REFLECTION_KEY);
		}
	}

	/** Prépare une soumission privée ou publique et déclenche OAuth si nécessaire. */
	async function requestSubmission(mode: ReflectionMode): Promise<void> {
		if (!draft.trim()) {
			toast.error(copy.reflectionRequired());
			return;
		}
		if (draft.trim().length < 6) {
			toast.error(copy.reflectionMinimum());
			return;
		}
		pendingAction = mode;
		submitFailed = false;
		persistPending();
		if (!hasRequiredScopes(mode)) {
			stage = 'auth';
			AnalyticsService.track('reflection_auth_requested', {
				...analyticsProperties(mode),
				authenticated_before_action: quranAuthService.status === 'connected'
			});
			return;
		}
		await submitReflection();
	}

	/** Vérifie les permissions Notes strictement nécessaires à l'action choisie. */
	function hasRequiredScopes(mode: ReflectionMode): boolean {
		return (
			quranAuthService.status === 'connected' &&
			hasReflectionSubmissionScopes(quranAuthService.grantedScopes, mode)
		);
	}

	/** Lance ou relance l'autorisation Quran.com avec les scopes enfants approuvés en production. */
	async function connectQuranAccount(): Promise<void> {
		persistPending();
		await quranAuthService.beginLogin(getReflectionSubmissionScopes(pendingAction ?? 'private'));
	}

	/** Exécute l'action en attente et conserve le brouillon si l'API échoue. */
	async function submitReflection(): Promise<void> {
		if (!pendingAction || isSubmitting || !hasRequiredScopes(pendingAction)) return;
		isSubmitting = true;
		submitFailed = false;
		const mode = pendingAction;
		try {
			const accessToken = await quranAuthService.getAccessToken();
			if (!pendingNoteId) {
				const note = await createPrivateReflectionNote(
					accessToken,
					draft.trim(),
					selectedSurahNumber,
					selectedFrom,
					selectedTo
				);
				pendingNoteId = note.data.id;
				persistPending();
			}
			if (mode === 'public') {
				await publishReflectionNote(
					accessToken,
					pendingNoteId,
					draft.trim(),
					selectedSurahNumber,
					selectedFrom,
					selectedTo,
					selectionMode === 'whole'
				);
			}
			successMode = mode;
			stage = 'success';
			pendingAction = null;
			sessionStorage.removeItem(PENDING_REFLECTION_KEY);
			AnalyticsService.track(
				mode === 'private' ? 'reflection_private_saved' : 'reflection_public_published',
				analyticsProperties(mode)
			);
		} catch {
			submitFailed = true;
			stage = 'composer';
			persistPending();
			AnalyticsService.track('reflection_submit_failed', analyticsProperties(mode));
		} finally {
			isSubmitting = false;
		}
	}

	/** Réinitialise le formulaire pour écrire une nouvelle réflexion sur la sélection actuelle. */
	function startAnotherReflection(): void {
		stage = 'composer';
		draft = '';
		pendingAction = null;
		pendingNoteId = null;
		successMode = null;
		submitFailed = false;
	}

	/** Ferme le panneau avec Échap lorsqu'il est dismissible. */
	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape' && visible && !isSubmitting) dismissPrompt();
	}

	onMount(() => {
		restorePending();
		window.addEventListener('keydown', handleKeydown);
		return () => {
			window.removeEventListener('keydown', handleKeydown);
			globalState.uiState.showReflectionPrompt = false;
		};
	});

	$effect(() => {
		const requestedContext = globalState.uiState.reflectionPromptContext;
		if (!requestedContext) return;
		globalState.uiState.reflectionPromptContext = null;
		openPrompt(requestedContext);
	});

	$effect(() => {
		if (!visible || !selectedSurah) return;
		const controller = new AbortController();
		examplesLoading = true;
		examplesFailed = false;
		examples = [];
		void getCuratedReflections(
			selectedSurahNumber,
			selectedFrom,
			selectedTo,
			globalState.settings?.persistentUiState.language ?? 'en',
			controller.signal
		)
			.then((items) => {
				if (!controller.signal.aborted) examples = items;
			})
			.catch(() => {
				if (!controller.signal.aborted) {
					examples = [];
					examplesFailed = true;
				}
			})
			.finally(() => {
				if (!controller.signal.aborted) {
					examplesLoading = false;
					examplesReady = true;
				}
			});
		return () => controller.abort();
	});

	$effect(() => {
		void quranAuthService.status;
		void quranAuthService.grantedScopes;
		if (pendingAction && hasRequiredScopes(pendingAction)) void submitReflection();
	});
</script>

{#if visible && examplesReady && context && selectedSurah && selectedSpan}
	<div class="modal-wrapper reflection-backdrop" role="presentation">
		<dialog
			open
			aria-labelledby="quran-reflection-title"
			aria-live="polite"
			aria-modal="true"
			class="reflection-banner reflection-ui-scale overflow-hidden! outline-none"
			style={`--editor-panel-scale: ${panelScale}; --editor-panel-height: ${100 / panelScale}%;`}
			use:mobileModalSheet={dismissPrompt}
		>
			<header
				class="reflection-header sticky top-0 z-10 flex items-start justify-between gap-3 px-4 py-3.5"
			>
				<div class="reflection-icon flex size-10 shrink-0 items-center justify-center rounded-2xl">
					<span class="material-icons-outlined text-xl">auto_awesome</span>
				</div>
				<div class="min-w-0 flex-1">
					<h2 id="quran-reflection-title" class="text-base font-bold text-primary">
						{copy.reflectionTitle()}
					</h2>
					<p class="mt-0.5 text-xs leading-snug text-secondary">
						{copy.reflectionDescription()}
					</p>
				</div>
				<button
					type="button"
					class="flex size-12 shrink-0 items-center justify-center rounded-full text-secondary hover:bg-accent hover:text-primary"
					onclick={dismissPrompt}
					aria-label={copy.reflectionCloseLabel()}
				>
					<span class="material-icons">close</span>
				</button>
			</header>

			<div class="reflection-content min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
				{#if stage === 'auth'}
					<div class="reflection-auth-card rounded-xl p-5">
						<div class="relative z-1 flex flex-col items-center gap-4">
							<div
								class="reflection-auth-icon flex size-12 shrink-0 items-center justify-center rounded-2xl"
							>
								<span class="material-icons text-2xl">account_circle</span>
							</div>
							<div class="min-w-0 flex-1 text-center">
								<h3 class="font-semibold text-primary">{copy.reflectionAuthTitle()}</h3>
								<p class="mt-1 text-sm leading-relaxed text-secondary">
									{quranAuthService.status === 'connected'
										? copy.reflectionPermissionDescription()
										: copy.reflectionAuthDescription()}
								</p>
							</div>
							<div class="flex w-full shrink-0 flex-col gap-2">
								<button
									type="button"
									class="reflection-primary min-h-11 rounded-xl px-5 text-sm font-semibold disabled:cursor-wait disabled:opacity-60"
									onclick={connectQuranAccount}
									disabled={quranAuthService.status === 'connecting'}
								>
									{copy.reflectionConnect()}
								</button>
								<button
									type="button"
									class="reflection-auth-back min-h-10 rounded-xl px-4 text-sm font-medium text-secondary"
									onclick={() => (stage = 'composer')}
								>
									{copy.reflectionBack()}
								</button>
							</div>
						</div>
					</div>
				{:else if stage === 'success'}
					<div class="rounded-xl border border-green-500/30 bg-green-500/10 p-6 text-center">
						<span class="material-icons text-4xl text-green-400">check_circle</span>
						<p class="mt-3 font-medium text-primary">
							{successMode === 'private'
								? copy.reflectionPrivateSuccess()
								: copy.reflectionPublicSuccess()}
						</p>
						<button
							type="button"
							class="btn-accent mt-5 min-h-11 px-6"
							onclick={startAnotherReflection}
						>
							{copy.reflectionWriteAnother()}
						</button>
					</div>
				{:else}
					<div>
						{#if context.multiSurah}
							<div class="mb-3 flex flex-wrap gap-2">
								{#each context.surahs as item (item.surah)}
									<button
										type="button"
										class="min-h-11 rounded-full border px-3 text-sm"
										class:border-accent-primary={item.surah === selectedSurahNumber}
										class:bg-accent={item.surah === selectedSurahNumber}
										class:border-color={item.surah !== selectedSurahNumber}
										onclick={() => selectSurah(item.surah)}
									>
										{Quran.surahs.find((surah) => surah.id === item.surah)?.name ?? item.surah}
									</button>
								{/each}
							</div>
						{/if}
						<div class="passage-selector flex flex-wrap items-center gap-2 rounded-xl px-3 py-2">
							<div class="flex w-full items-center justify-between gap-2">
								<p class="min-w-0 text-sm font-semibold text-primary">
									{selectedSurahName}
									— {selectionMode === 'whole'
										? copy.reflectionWholeSurah()
										: selectionMode === 'single'
											? copy.reflectionSingleAyah({ verse: selectedFrom })
											: copy.reflectionAyat({ from: selectedFrom, to: selectedTo })}
								</p>
								{#if selectionMode === 'range'}
									<div class="flex shrink-0 gap-2">
										<label class="flex items-center gap-1 text-xs text-thirdly"
											>{copy.reflectionFromAyah()}
											<select
												class="compact-select"
												value={selectedFrom}
												onchange={(event) => selectFrom(Number(event.currentTarget.value))}
											>
												{#each Array.from({ length: selectedSurahVerseCount }, (_, index) => index + 1) as verse (verse)}
													<option value={verse}>{verse}</option>
												{/each}
											</select>
										</label>
										<label class="flex items-center gap-1 text-xs text-thirdly"
											>{copy.reflectionToAyah()}
											<select
												class="compact-select"
												value={selectedTo}
												onchange={(event) => selectTo(Number(event.currentTarget.value))}
											>
												{#each Array.from({ length: selectedSurahVerseCount }, (_, index) => index + 1) as verse (verse)}
													<option value={verse}>{verse}</option>
												{/each}
											</select>
										</label>
									</div>
								{:else if selectionMode === 'single'}
									<label class="flex shrink-0 items-center gap-1 text-xs text-thirdly"
										>{copy.reflectionAyahLabel()}
										<select
											class="compact-select"
											value={selectedFrom}
											onchange={(event) => selectSingleVerse(Number(event.currentTarget.value))}
										>
											{#each Array.from({ length: selectedSurahVerseCount }, (_, index) => index + 1) as verse (verse)}
												<option value={verse}>{verse}</option>
											{/each}
										</select>
									</label>
								{/if}
							</div>
							<div class="mode-selector flex w-full rounded-lg p-0.5">
								<button
									type="button"
									class="min-h-11 flex-1 rounded-md px-2 py-2 text-xs font-semibold"
									class:active={selectionMode === 'whole'}
									onclick={() => selectReflectionMode('whole')}
									>{copy.reflectionWholeChoice()}</button
								>
								<button
									type="button"
									class="min-h-11 flex-1 rounded-md px-2 py-2 text-xs font-semibold"
									class:active={selectionMode === 'range'}
									onclick={() => selectReflectionMode('range')}
									>{copy.reflectionRangeChoice()}</button
								>
								<button
									type="button"
									class="min-h-11 flex-1 rounded-md px-2 py-2 text-xs font-semibold"
									class:active={selectionMode === 'single'}
									onclick={() => selectReflectionMode('single')}
									>{copy.reflectionSingleChoice()}</button
								>
							</div>
						</div>
					</div>

					<div class="reflection-main grid gap-3">
						<div class="reflection-editor flex min-h-0 flex-col">
							<label for="quran-reflection-body" class="mb-2 block text-sm font-medium text-primary"
								>{copy.reflectionComposerLabel()}</label
							>
							<textarea
								id="quran-reflection-body"
								class="reflection-textarea min-h-40 w-full resize-y rounded-xl px-3 py-2.5 text-sm text-primary outline-none"
								placeholder={reflectionPlaceholder}
								bind:value={draft}
								oninput={persistPending}
							></textarea>
							{#if submitFailed}<p class="mt-2 text-sm text-red-400">
									{copy.reflectionSubmitError()}
								</p>{/if}
						</div>

						<section class="min-w-0" aria-labelledby="reflection-examples-title">
							<div class="mb-2 flex items-center justify-between gap-2">
								<h3 id="reflection-examples-title" class="text-sm font-semibold text-primary">
									{copy.reflectionExamplesTitle()}
								</h3>
								<span class="quranreflect-badge text-[10px] font-bold uppercase tracking-wide">
									QuranReflect
								</span>
							</div>
							<div class="reflection-strip flex min-h-40 snap-x gap-2 overflow-x-auto pb-1">
								{#if examplesLoading}
									<div
										class="reflection-card flex min-w-full items-center justify-center px-4 text-center text-sm text-thirdly"
									>
										{copy.reflectionExamplesLoading()}
									</div>
								{:else if examplesFailed}
									<div
										class="reflection-card flex min-w-full items-center justify-center px-4 text-center text-sm text-thirdly"
									>
										{copy.reflectionExamplesError()}
									</div>
								{:else if examples.length === 0}
									<div
										class="reflection-card flex min-w-full items-center justify-center px-4 text-center text-sm text-thirdly"
									>
										{copy.reflectionNoExamples()}
									</div>
								{:else}
									{#each examples as example (example.id)}
										{@const authorName = example.author || copy.reflectionContributor()}
										<article class="reflection-card min-w-[85%] snap-start p-3">
											<div class="mb-2.5 flex items-center gap-2.5">
												{#if example.avatarUrl}
													<img
														src={example.avatarUrl}
														alt={authorName}
														class="size-8 shrink-0 rounded-full object-cover"
													/>
												{:else}
													<span
														class="reflection-avatar flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold"
														aria-hidden="true"
													>
														{authorName.charAt(0).toUpperCase()}
													</span>
												{/if}
												<span class="truncate text-xs font-semibold text-primary">{authorName}</span
												>
											</div>
											<p
												title={example.body}
												class="line-clamp-4 whitespace-pre-line text-sm leading-relaxed text-secondary"
											>
												{example.body}
											</p>
											<div class="mt-2 flex items-center justify-between gap-2">
												<span class="text-[11px] text-thirdly">
													{#if example.likesCount > 0}{copy.reflectionLikes({
															count: example.likesCount
														})}{/if}
												</span>
												{#if example.url}<button
														type="button"
														class="reflection-read-more flex items-center gap-1 text-[11px] font-medium"
														onclick={() => openReflectionExample(example)}
													>
														{copy.reflectionReadMore()}
														<span class="material-icons text-xs" aria-hidden="true"
															>open_in_new</span
														>
													</button>{/if}
											</div>
										</article>
									{/each}
								{/if}
							</div>
						</section>
					</div>

					<div class="flex flex-col gap-2">
						<button
							type="button"
							class="reflection-choice flex-1 rounded-xl px-3 py-2 text-left disabled:opacity-45"
							disabled={isSubmitting}
							onclick={() => requestSubmission('private')}
						>
							<span class="block text-sm font-bold text-primary">{copy.reflectionPrivate()}</span>
							<span class="block text-[11px] text-thirdly"
								>{copy.reflectionPrivateDescription()}</span
							>
						</button>
						<button
							type="button"
							class="reflection-primary flex-1 rounded-xl px-3 py-2 text-left disabled:opacity-45"
							disabled={isSubmitting}
							onclick={() => requestSubmission('public')}
						>
							<span class="block text-sm font-bold">{copy.reflectionPublic()}</span>
							<span class="block text-[11px] opacity-75">{copy.reflectionPublicDescription()}</span>
						</button>
					</div>
					{#if isSubmitting}<p class="text-center text-xs text-thirdly">
							{copy.reflectionSubmitting()}
						</p>{/if}
				{/if}
			</div>
		</dialog>
	</div>
{/if}

<style>
	.reflection-backdrop {
		background: rgb(0 0 0 / 45%);
	}

	.reflection-banner {
		height: calc(90dvh + 50px) !important;
		max-height: calc(90dvh + 50px) !important;
		padding: 0;
		background:
			linear-gradient(
				180deg,
				color-mix(in srgb, var(--accent-primary) 11%, var(--bg-secondary)) 0%,
				var(--bg-secondary) 100%
			),
			var(--bg-secondary);
		border: 1px solid color-mix(in srgb, var(--accent-primary) 28%, var(--border-color));
		border-bottom: 0;
		border-radius: 1.25rem 1.25rem 0 0;
		box-shadow:
			0 -16px 48px rgba(0, 0, 0, 0.42),
			inset 0 1px 0 rgba(255, 255, 255, 0.12);
		color: inherit;
	}

	.reflection-ui-scale {
		display: flex;
		min-width: 0;
		max-width: 100%;
		height: var(--editor-panel-height);
		flex: 1;
		flex-direction: column;
		zoom: var(--editor-panel-scale);
	}

	.reflection-banner::before {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: linear-gradient(
			90deg,
			rgba(255, 255, 255, 0.08),
			transparent 20%,
			transparent 80%,
			rgba(255, 255, 255, 0.05)
		);
	}

	.reflection-header {
		background: color-mix(in srgb, var(--bg-secondary) 92%, transparent);
		border-bottom: 1px solid color-mix(in srgb, var(--accent-primary) 16%, var(--border-color));
		backdrop-filter: blur(14px);
	}

	.reflection-content {
		position: relative;
		overscroll-behavior: contain;
	}

	.reflection-icon,
	.quranreflect-badge {
		border-radius: 999px;
		padding: 0.2rem 0.45rem;
		background: color-mix(in srgb, var(--accent-primary) 14%, transparent);
		color: var(--accent-primary);
	}

	.reflection-icon {
		border-radius: 1rem;
		padding: 0;
		box-shadow: 0 0 18px color-mix(in srgb, var(--accent-primary) 24%, transparent);
	}

	.reflection-avatar {
		background: color-mix(in srgb, var(--accent-primary) 18%, var(--bg-secondary));
		color: var(--accent-primary);
	}

	.reflection-auth-card {
		border: 1px solid color-mix(in srgb, var(--accent-primary) 28%, var(--border-color));
		background: color-mix(in srgb, var(--bg-primary) 82%, var(--bg-secondary));
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.08),
			0 10px 28px rgba(0, 0, 0, 0.2);
	}

	.reflection-auth-icon {
		border: 1px solid color-mix(in srgb, var(--accent-primary) 32%, transparent);
		background: color-mix(in srgb, var(--accent-primary) 16%, var(--bg-secondary));
		color: var(--accent-primary);
		box-shadow: 0 0 22px color-mix(in srgb, var(--accent-primary) 22%, transparent);
	}

	.reflection-auth-back {
		border: 1px solid color-mix(in srgb, var(--accent-primary) 16%, var(--border-color));
		background: color-mix(in srgb, var(--bg-secondary) 78%, transparent);
	}

	.reflection-auth-back:hover {
		border-color: color-mix(in srgb, var(--accent-primary) 38%, var(--border-color));
		background: color-mix(in srgb, var(--accent-primary) 10%, var(--bg-secondary));
		color: var(--text-primary);
	}

	.passage-selector,
	.reflection-card,
	.reflection-choice,
	.reflection-textarea {
		border: 1px solid color-mix(in srgb, var(--accent-primary) 18%, var(--border-color));
		background: color-mix(in srgb, var(--bg-primary) 78%, transparent);
	}

	.reflection-textarea:focus {
		border-color: var(--accent-primary);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-primary) 16%, transparent);
	}

	.reflection-editor .reflection-textarea {
		min-height: 10rem;
		flex: 1;
	}

	.mode-selector {
		background: rgba(255, 255, 255, 0.07);
	}

	.mode-selector button {
		color: var(--text-thirdly);
	}

	.mode-selector button.active {
		background: color-mix(in srgb, var(--accent-primary) 18%, var(--bg-secondary));
		color: var(--text-primary);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-primary) 45%, transparent);
	}

	.compact-select {
		min-width: 3.25rem;
		min-height: 2.75rem;
		border: 1px solid var(--border-color);
		border-radius: 0.5rem;
		background: var(--bg-secondary);
		padding: 0.3rem 0.4rem;
		color: var(--text-primary);
	}

	.reflection-strip {
		scrollbar-width: thin;
		scrollbar-color: color-mix(in srgb, var(--accent-primary) 45%, transparent) transparent;
	}

	.reflection-read-more {
		color: var(--accent-primary);
	}

	.reflection-read-more:hover {
		text-decoration: underline;
	}

	.reflection-primary {
		border: 1px solid rgba(255, 255, 255, 0.2);
		background: var(--accent-primary);
		color: var(--text-on-accent);
		box-shadow:
			0 8px 22px color-mix(in srgb, var(--accent-primary) 22%, transparent),
			inset 0 1px 0 rgba(255, 255, 255, 0.2);
	}
</style>
