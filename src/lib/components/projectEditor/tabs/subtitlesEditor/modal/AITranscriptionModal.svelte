<script lang="ts">
	import { requestProjectSpeakerRemoval } from '$lib/components/modals/speakerRemoval';
	import { TranscriptionRuntimeSession } from '$lib/services/TranscriptionRuntimeSession.svelte';
	import { TranscriptCleanupSession } from '$lib/services/TranscriptCleanupSession.svelte';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import { onDestroy, onMount, tick } from 'svelte';
	import { get } from 'svelte/store';
	import toast from 'svelte-5-french-toast';
	import LL from '$lib/i18n/i18n-svelte';
	import { SubtitleClip } from '$lib/classes';
	import {
		getMatchingSubtitleLengthPreset,
		SUBTITLE_LENGTH_PRESETS,
		type BuiltInSubtitleLengthPreset
	} from '$lib/constants/subtitleLengthPresets';
	import { globalState } from '$lib/runes/main.svelte';
	import {
		addProjectSpeaker,
		canRemoveProjectSpeaker,
		getVisibleProjectSpeakers
	} from '$lib/services/SpeakerLibrary';
	import {
		loadGroqApiKey,
		saveAITranscriptionSettings,
		saveGroqApiKey,
		type AITranscriptionResult
	} from '$lib/services/AITranscription';
	import AIReasoningControls from '$lib/components/ai/AIReasoningControls.svelte';
	import AIStreamBatchList from '$lib/components/ai/AIStreamBatchList.svelte';
	import { resolveAIReasoning, type AIReasoningMode } from '$lib/services/AIReasoning';

	let { close, cleanupOnly = false } = $props<{ close: () => void; cleanupOnly?: boolean }>();
	const settings = globalState.settings!.aiTranscriptionSettings;
	const session = new TranscriptCleanupSession(
		globalState.currentProject!,
		settings,
		globalState.settings!.aiTranslationSettings
	);
	const runtime = new TranscriptionRuntimeSession(settings, session);
	const diarizationEnabled = $derived(
		settings.provider !== 'groq' &&
			((settings.minSpeakers ?? 1) > 1 || (settings.maxSpeakers ?? 1) > 1)
	);
	const steps = $derived(
		[
			{ label: 'Setup', icon: 'download' },
			{ label: 'Model & speakers', icon: 'tune' },
			{ label: 'Transcribe', icon: 'graphic_eq' },
			{ label: 'Name speakers', icon: 'groups' },
			{ label: get(LL).editor.transcriptCleanupStep(), icon: 'auto_fix_high' }
		].filter((_, index) => settings.provider !== 'alignment' || index < 4)
	);

	let currentStep = $state(0);
	let previewingSpeakerId = $state<string | null>(null);
	let addingSpeakerForId = $state<string | null>(null);
	let newSpeakerName = $state('');
	let newSpeakerInput: HTMLInputElement | null = $state(null);
	let advancedSubtitleSettingsOpen = $state(false);
	let groqApiKey = $state('');
	let referenceText = $state('');
	let groqApiKeyLoading = $state(true);
	const setupReady = $derived(
		settings.provider === 'groq'
			? Boolean(groqApiKey.trim()) && !groqApiKeyLoading
			: Boolean(
					runtime.runtimeStatus?.ready &&
						(!diarizationEnabled || settings.hfToken.trim()) &&
						(settings.provider !== 'alignment' || referenceText.trim())
				)
	);

	/**
	 * Sauvegarde le mode de raisonnement propre au nettoyage du transcript.
	 * @param {AIReasoningMode} value Nouveau mode.
	 * @returns {void}
	 */
	function updateCleanupReasoningMode(value: AIReasoningMode): void {
		const settings = globalState.settings!.aiTranslationSettings;
		settings.transcriptCleanupReasoningMode = value;
		settings.advancedTrimReasoningEffort = resolveAIReasoning(
			settings.textAiApiEndpoint,
			settings.advancedTrimModel,
			value
		).effort;
		void saveAITranscriptionSettings();
	}

	const subtitleLengthPresetEntries = Object.entries(SUBTITLE_LENGTH_PRESETS) as Array<
		[BuiltInSubtitleLengthPreset, (typeof SUBTITLE_LENGTH_PRESETS)[BuiltInSubtitleLengthPreset]]
	>;
	const subtitleLengthPresetCopy = $derived.by(() => ({
		compact: {
			label: get(LL).editor.subtitleLengthShort(),
			description: get(LL).editor.subtitleLengthShortDescription()
		},
		balanced: {
			label: get(LL).editor.subtitleLengthMedium(),
			description: get(LL).editor.subtitleLengthMediumDescription()
		},
		relaxed: {
			label: get(LL).editor.subtitleLengthLong(),
			description: get(LL).editor.subtitleLengthLongDescription()
		}
	}));
	const activeSubtitleLengthPreset = $derived.by(() =>
		getMatchingSubtitleLengthPreset({
			maxWords: settings.maxWordsPerSegment,
			maxChars: settings.maxCharsPerSegment
		})
	);
	const audioAvailable = $derived(globalState.getAudioTrack.clips.length > 0);
	const existingSubtitleCount = $derived(
		globalState.getSubtitleTrack.clips.filter((clip) => clip instanceof SubtitleClip).length
	);
	const existingSpeakerNames = $derived(() => getVisibleProjectSpeakers(session.project));

	const streamedCleanupBatches = $derived(() =>
		Object.values(session.cleanupBatchStreams).sort((left, right) => left.index - right.index)
	);
	const streamedSemanticBatches = $derived(() =>
		Object.values(session.semanticBatchStreams).sort((left, right) => left.index - right.index)
	);

	/**
	 * Applique un profil de longueur et ses deux paramètres associés.
	 * @param {BuiltInSubtitleLengthPreset} preset Profil choisi.
	 * @returns {void}
	 */
	function applySubtitleLengthPreset(preset: BuiltInSubtitleLengthPreset): void {
		const definition = SUBTITLE_LENGTH_PRESETS[preset];
		settings.subtitleLengthPreset = preset;
		settings.maxWordsPerSegment = definition.maxWords;
		settings.maxCharsPerSegment = definition.maxChars;
	}

	/**
	 * Marque les valeurs avancées comme personnalisées.
	 * @returns {void}
	 */
	function markSubtitleLengthAsCustom(): void {
		settings.subtitleLengthPreset = 'custom';
	}

	/**
	 * Sélectionne le fournisseur STT et prépare son écran de configuration.
	 * @param {'groq' | 'alignment' | 'local'} provider Fournisseur choisi.
	 * @returns {Promise<void>} Promesse résolue après la sauvegarde.
	 */
	async function selectTranscriptionProvider(
		provider: 'groq' | 'alignment' | 'local'
	): Promise<void> {
		settings.provider = provider;
		session.errorMessage = '';
		await saveAITranscriptionSettings();
		if (provider !== 'groq' && !runtime.runtimeStatus) await refreshRuntime();
	}

	/**
	 * Enregistre la clé Groq saisie dans le coffre-fort du système.
	 * @returns {Promise<void>} Promesse résolue après la sauvegarde.
	 */
	async function persistGroqApiKey(): Promise<void> {
		try {
			await saveGroqApiKey(groqApiKey);
			session.errorMessage = '';
		} catch (error) {
			session.errorMessage = error instanceof Error ? error.message : String(error);
		}
	}

	/** @returns {Promise<void>} Actualise l'état du moteur affiché par la vue. */
	async function refreshRuntime(): Promise<void> {
		await runtime.refreshRuntime();
	}

	/** @returns {Promise<void>} Installe le moteur puis confirme sa disponibilité. */
	async function installRuntime(): Promise<void> {
		if (await runtime.installRuntime()) toast.success(get(LL).common.done());
	}

	/** @returns {Promise<void>} Lance la transcription puis affiche les intervenants détectés. */
	async function startTranscription(): Promise<void> {
		if (!setupReady || !audioAvailable) return;
		if (await runtime.startTranscription(groqApiKey, referenceText)) {
			currentStep = 3;
			toast.success(
				get(LL).editor.transcriptCleanupCompleted({
					cleaned: session.result!.segments.length,
					total: session.result!.segments.length
				})
			);
		}
	}

	/** @returns {Promise<void>} Enregistre les noms choisis puis ferme la vue. */
	async function applyResult(): Promise<void> {
		if (!session.result) return;
		if (!session.cleanupCompleted) {
			if (!(await session.persistCurrentResult())) return;
			toast.success(
				get(LL).editor.transcriptCleanupCompleted({
					cleaned: session.result.segments.length,
					total: session.result.segments.length
				})
			);
		}
		close();
	}

	/**
	 * Ouvre l'étape de nettoyage après validation des noms de voix.
	 * @returns {Promise<void>} Promesse résolue après l'application des noms de voix.
	 */
	async function openTranscriptCleanup(): Promise<void> {
		const previewState = globalState.getVideoPreviewState;
		if (previewState.isPlaying) previewState.togglePlayPause();
		if (!(await session.persistCurrentResult())) return;
		currentStep = 4;
	}

	function getSpeakerExamples(speakerId: string): AITranscriptionResult['segments'] {
		return (
			session.result?.segments.filter((segment) => segment.speaker === speakerId).slice(0, 2) ?? []
		);
	}

	function isSpeakerPreviewActive(speakerId: string): boolean {
		const sample = getSpeakerExamples(speakerId)[0];
		if (!sample || previewingSpeakerId !== speakerId) return false;
		const cursorMs = globalState.getTimelineState.cursorPosition;
		const startMs = Math.max(1, Math.round(sample.start * 1000));
		const endMs = Math.max(startMs, Math.round(sample.end * 1000));
		return cursorMs >= startMs && cursorMs <= endMs;
	}

	function previewSpeaker(speakerId: string): void {
		const sample = getSpeakerExamples(speakerId)[0];
		if (!sample) return;

		const previewState = globalState.getVideoPreviewState;
		if (isSpeakerPreviewActive(speakerId)) {
			previewState.togglePlayPause();
			return;
		}

		const startMs = Math.max(1, Math.round(sample.start * 1000));
		previewingSpeakerId = speakerId;
		globalState.getTimelineState.cursorPosition = startMs;
		globalState.getTimelineState.movePreviewTo = startMs;
		previewState.scrollTimelineToCursor();
		if (!previewState.isPlaying) previewState.togglePlayPause();
	}

	function formatTimestamp(seconds: number): string {
		const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
		const minutes = Math.floor(safeSeconds / 60);
		const remainingSeconds = Math.floor(safeSeconds % 60);
		return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
	}

	function getSpeakerOptions(speakerId: string): string[] {
		const options = existingSpeakerNames();
		const current = session.speakerMap[speakerId]?.trim();
		if (
			!current ||
			options.some((name) => name.toLocaleLowerCase() === current.toLocaleLowerCase())
		) {
			return options;
		}
		return [current, ...options];
	}

	async function openAddSpeaker(speakerId: string): Promise<void> {
		addingSpeakerForId = speakerId;
		newSpeakerName = '';
		await tick();
		newSpeakerInput?.focus();
	}

	function cancelAddSpeaker(): void {
		addingSpeakerForId = null;
		newSpeakerName = '';
	}

	function addSpeakerForVoice(speakerId: string): void {
		const normalized = newSpeakerName.trim();
		if (!normalized) return;

		const speakerName = addProjectSpeaker(session.project, normalized);
		if (!speakerName) return;
		session.speakerMap[speakerId] = speakerName;
		cancelAddSpeaker();
	}

	async function removeAvailableSpeaker(speakerName: string): Promise<void> {
		const outcome = await requestProjectSpeakerRemoval(session.project, speakerName);
		if (!outcome.removed) return;

		for (const speakerId of Object.keys(session.speakerMap)) {
			if (session.speakerMap[speakerId]?.toLocaleLowerCase() === speakerName.toLocaleLowerCase()) {
				session.speakerMap[speakerId] = outcome.replacement ?? '';
			}
		}
	}

	function handleNewSpeakerKeydown(event: KeyboardEvent, speakerId: string): void {
		if (event.key === 'Enter') {
			event.preventDefault();
			addSpeakerForVoice(speakerId);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			cancelAddSpeaker();
		}
	}

	function canGoNext(): boolean {
		if (currentStep === 0) return setupReady;
		if (currentStep === 1)
			return Boolean((!diarizationEnabled || settings.hfToken.trim()) && audioAvailable);
		if (currentStep === 2) return Boolean(session.result);
		return false;
	}

	function closeSafely(): void {
		if (!runtime.running && !runtime.installing && !session.cleanupRunning) close();
	}

	onMount(() => {
		if (!settings.subtitleLengthPreset) applySubtitleLengthPreset('balanced');
		if (cleanupOnly) {
			currentStep = 4;
			session.initializeCleanupOnly();
		} else {
			void loadGroqApiKey()
				.then((value) => (groqApiKey = value))
				.catch(
					(error) => (session.errorMessage = error instanceof Error ? error.message : String(error))
				)
				.finally(() => (groqApiKeyLoading = false));
			if (settings.provider !== 'groq') void refreshRuntime();
		}
	});
	onDestroy(() => {
		runtime.dispose();
		session.dispose();
	});
</script>

<div
	class="flex h-[84vh] w-[min(1180px,94vw)] flex-col overflow-hidden rounded-2xl border border-color bg-secondary shadow-2xl shadow-black"
>
	<header class="flex items-center gap-4 border-b border-color bg-primary px-6 py-4">
		<div class="flex h-11 w-11 items-center justify-center rounded-xl bg-accent">
			<span class="material-icons text-2xl text-accent-primary">auto_awesome</span>
		</div>
		<div>
			<h2 class="text-xl font-bold text-primary">{$LL.editor.aiTranscription()}</h2>
			<p class="text-xs text-secondary">
				{settings.provider === 'groq'
					? $LL.editor.aiTranscriptionGroqDescription()
					: settings.provider === 'alignment'
						? $LL.editor.referenceAlignmentDescription()
						: $LL.editor.aiTranscriptionLocalDescription()}
			</p>
		</div>
		<button
			type="button"
			class="ml-auto flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-secondary transition hover:bg-accent hover:text-primary disabled:opacity-40"
			onclick={closeSafely}
			disabled={runtime.running || runtime.installing || session.cleanupRunning}
			aria-label={$LL.common.close()}
		>
			<span class="material-icons">close</span>
		</button>
	</header>

	<div class="flex min-h-0 flex-1">
		{#if !cleanupOnly}<aside class="w-56 shrink-0 border-r border-color bg-primary/60 p-4">
				<div class="space-y-2">
					{#each steps as step, index (step.label)}
						<button
							type="button"
							class={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-semibold transition ${index === currentStep ? 'bg-accent text-primary' : 'text-secondary hover:bg-accent/60 hover:text-primary'} ${index > currentStep && !(index === 3 && session.result) ? 'cursor-default opacity-45' : 'cursor-pointer'}`}
							onclick={() => {
								if (index <= currentStep || (index === 3 && session.result)) currentStep = index;
							}}
						>
							<span class="material-icons text-lg">{step.icon}</span>
							<span>{step.label}</span>
						</button>
					{/each}
				</div>
			</aside>{/if}

		<main class="min-w-0 flex-1 overflow-y-auto p-6">
			<div class="mx-auto max-w-4xl space-y-6">
				{#if currentStep === 0}
					<section class="space-y-5">
						<div>
							<h3 class="text-lg font-bold text-primary">{$LL.editor.transcriptionEngine()}</h3>
						</div>
						<div class="grid gap-3 md:grid-cols-3">
							<button
								type="button"
								aria-pressed={settings.provider === 'groq'}
								class={`cursor-pointer rounded-xl border p-4 text-left transition ${settings.provider === 'groq' ? 'border-accent-primary bg-accent-primary/15' : 'border-color bg-primary hover:border-accent-primary/50'}`}
								onclick={() => void selectTranscriptionProvider('groq')}
								disabled={runtime.running || runtime.installing || session.cleanupRunning}
							>
								<div class="flex items-center justify-between gap-3">
									<span class="font-semibold text-primary">{$LL.editor.groqCloud()}</span>
									<span
										class="rounded-full bg-accent-primary/15 px-2 py-0.5 text-[10px] font-semibold text-accent-primary"
									>
										{$LL.editor.groqRecommended()}
									</span>
								</div>
								<p class="mt-2 text-xs leading-relaxed text-secondary">
									{$LL.editor.groqProviderDescription()}
								</p>
							</button>
							<button
								type="button"
								aria-pressed={settings.provider === 'alignment'}
								class={`cursor-pointer rounded-xl border p-4 text-left transition ${settings.provider === 'alignment' ? 'border-accent-primary bg-accent-primary/15' : 'border-color bg-primary hover:border-accent-primary/50'}`}
								onclick={() => void selectTranscriptionProvider('alignment')}
								disabled={runtime.running || runtime.installing || session.cleanupRunning}
							>
								<span class="font-semibold text-primary">{$LL.editor.referenceAlignment()}</span>
								<p class="mt-2 text-xs leading-relaxed text-secondary">
									{$LL.editor.referenceAlignmentDescription()}
								</p>
							</button>
							<button
								type="button"
								aria-pressed={settings.provider === 'local'}
								class={`cursor-pointer rounded-xl border p-4 text-left transition ${settings.provider === 'local' ? 'border-accent-primary bg-accent-primary/15' : 'border-color bg-primary hover:border-accent-primary/50'}`}
								onclick={() => void selectTranscriptionProvider('local')}
								disabled={runtime.running || runtime.installing || session.cleanupRunning}
							>
								<span class="font-semibold text-primary">{$LL.editor.localWhisperX()}</span>
								<p class="mt-2 text-xs leading-relaxed text-secondary">
									{$LL.editor.localWhisperXProviderDescription()}
								</p>
							</button>
						</div>
						{#if settings.provider === 'alignment'}
							<label class="block space-y-2">
								<span class="text-sm font-semibold text-primary"
									>{$LL.editor.referenceTextLabel()}</span
								>
								<textarea
									class="w-full rounded-lg border border-color bg-primary px-3 py-2.5 text-primary outline-none focus:border-[var(--accent-primary)]"
									rows="8"
									dir="auto"
									bind:value={referenceText}
									placeholder={$LL.editor.referenceTextPlaceholder()}
									disabled={runtime.running}
								></textarea>
								<span class="block text-xs leading-relaxed text-secondary"
									>{$LL.editor.referenceTextHelp()}</span
								>
								{#if !referenceText.trim()}
									<span class="block text-xs text-yellow-300"
										>{$LL.editor.referenceTextRequired()}</span
									>
								{/if}
							</label>
						{/if}
						{#if settings.provider === 'groq'}
							<div class="rounded-xl border border-color bg-primary p-5">
								<h4 class="font-semibold text-primary">{$LL.editor.groqApiKeyTitle()}</h4>
								<p class="mt-1 text-xs leading-relaxed text-secondary">
									{$LL.editor.groqApiKeyDescription()}
								</p>
								<div class="mt-4 rounded-lg bg-secondary p-4">
									<p class="text-sm font-semibold text-primary">
										{$LL.editor.groqApiKeyTutorialTitle()}
									</p>
									<ol class="mt-2 list-inside list-decimal space-y-1 text-xs text-secondary">
										<li>{$LL.editor.groqApiKeyTutorialAccount()}</li>
										<li>{$LL.editor.groqApiKeyTutorialCreate()}</li>
										<li>{$LL.editor.groqApiKeyTutorialPaste()}</li>
									</ol>
									<button
										type="button"
										class="btn mt-3 cursor-pointer px-3 py-2 text-xs"
										onclick={() => void openUrl('https://console.groq.com/keys')}
									>
										{$LL.editor.groqOpenApiKeys()}
									</button>
								</div>
								<label class="mt-4 block space-y-2">
									<span class="text-sm font-semibold text-primary"
										>{$LL.editor.groqApiKeyLabel()}</span
									>
									<input
										type="password"
										class="w-full rounded-lg border border-color bg-secondary px-3 py-2.5 text-primary outline-none focus:border-[var(--accent-primary)]"
										bind:value={groqApiKey}
										placeholder="gsk_..."
										disabled={groqApiKeyLoading}
										onchange={() => void persistGroqApiKey()}
									/>
								</label>
								<p class="mt-2 text-xs {groqApiKey.trim() ? 'text-green-400' : 'text-yellow-300'}">
									{groqApiKey.trim()
										? $LL.editor.groqApiKeyStored()
										: $LL.editor.groqApiKeyRequired()}
								</p>
							</div>
						{:else}
							<div>
								<h3 class="text-lg font-bold text-primary">Local runtime setup</h3>
								<p class="mt-1 text-sm text-secondary">
									Minbar Studio installs its own Python 3.12 environment, WhisperX, pyannote and the
									appropriate PyTorch build. The user's system Python is not required.
								</p>
							</div>
							<div
								class={`rounded-xl border p-5 ${runtime.runtimeStatus?.ready ? 'border-green-500/40 bg-green-500/10' : 'border-color bg-primary'}`}
							>
								<div class="flex items-center gap-4">
									<span
										class="material-icons text-3xl {runtime.runtimeStatus?.ready
											? 'text-green-400'
											: 'text-secondary'}"
										>{runtime.runtimeStatus?.ready ? 'check_circle' : 'download_for_offline'}</span
									>
									<div class="min-w-0 flex-1">
										<p class="font-semibold text-primary">
											{$LL.editor.aiTranscription()} · {runtime.runtimeStatus?.ready
												? $LL.common.done()
												: $LL.common.required()}
										</p>
										<p class="mt-1 text-xs text-secondary">
											{runtime.checkingRuntime
												? 'Checking local runtime...'
												: (runtime.runtimeStatus?.message ??
													'Runtime status has not been checked yet.')}
										</p>
									</div>
									{#if !runtime.runtimeStatus?.ready}
										<button
											type="button"
											class="btn-accent inline-flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
											onclick={() => void installRuntime()}
											disabled={runtime.installing || runtime.checkingRuntime}
										>
											<span class="material-icons text-lg">download</span>
											{runtime.installing ? 'Installing...' : 'Install automatically'}
										</button>
									{/if}
								</div>
								{#if runtime.installMessage}<p
										class="mt-4 rounded-lg bg-secondary px-3 py-2 font-mono text-xs text-secondary"
									>
										{runtime.installMessage}
									</p>{/if}
							</div>
							<div class="rounded-xl border border-color bg-primary p-5">
								<h4 class="font-semibold text-primary">Hugging Face access</h4>
								<p class="mt-1 text-xs leading-relaxed text-secondary">
									Speaker detection uses the gated pyannote Community-1 model. Accept its
									conditions, create a read token, then paste it below. The token is stored in
									Minbar Studio settings and passed only to Hugging Face libraries.
								</p>
								<div class="mt-4 flex flex-wrap gap-2">
									<button
										type="button"
										class="btn cursor-pointer px-3 py-2 text-xs"
										onclick={() =>
											void openUrl(
												'https://huggingface.co/pyannote/speaker-diarization-community-1'
											)}>Accept model conditions</button
									>
									<button
										type="button"
										class="btn cursor-pointer px-3 py-2 text-xs"
										onclick={() =>
											void openUrl('https://huggingface.co/settings/tokens/new?tokenType=read')}
										>Create read token</button
									>
								</div>
								<label class="mt-4 block space-y-2">
									<span class="text-sm font-semibold text-primary">Hugging Face read token</span>
									<input
										type="password"
										class="w-full rounded-lg border border-color bg-secondary px-3 py-2.5 text-primary outline-none focus:border-[var(--accent-primary)]"
										bind:value={settings.hfToken}
										placeholder="hf_..."
										onchange={() => void saveAITranscriptionSettings()}
									/>
								</label>
								{#if diarizationEnabled && !settings.hfToken.trim()}
									<p class="mt-2 text-xs text-yellow-300">
										Enter a read token to continue to transcription settings.
									</p>
								{/if}
							</div>
						{/if}
					</section>
				{:else if currentStep === 1}
					<section class="space-y-6">
						<div>
							<h3 class="text-lg font-bold text-primary">Transcription settings</h3>
							<p class="mt-1 text-sm text-secondary">
								Choose the quality and expected number of distinct voices.
							</p>
							<p
								class="mt-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2.5 text-sm font-semibold text-yellow-300"
							>
								{$LL.editor.arabicAudioRequired()}
							</p>
						</div>
						{#if settings.provider === 'groq'}
							<div class="grid gap-3 md:grid-cols-2">
								<div class="rounded-xl border border-color bg-primary p-4">
									<p class="text-xs text-secondary">{$LL.aiVideo.model()}</p>
									<p class="mt-1 font-semibold text-primary">Whisper Large V3</p>
								</div>
								<div class="rounded-xl border border-color bg-primary p-4">
									<p class="text-xs text-secondary">{$LL.editor.groqProcessingLabel()}</p>
									<p class="mt-1 font-semibold text-primary">{$LL.editor.groqCloud()}</p>
								</div>
							</div>
							<p
								class="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-200"
							>
								{$LL.editor.groqSingleSpeakerNotice()}
							</p>
						{:else}
							<div class="grid gap-5 md:grid-cols-2">
								<label class="space-y-2"
									><span class="text-sm font-semibold text-primary">{$LL.aiVideo.model()}</span
									><select
										class="w-full rounded-lg border border-color bg-primary px-3 py-2.5 text-primary"
										bind:value={settings.model}
										><option value="qwen3-asr-1.7b"
											>Qwen3-ASR 1.7B — {$LL.editor.bestLocalAccuracy()}</option
										><option value="small">Small — fastest</option><option value="medium"
											>Medium — recommended</option
										><option value="large-v3">Large v3 — highest quality</option><option
											value="large-v3-turbo">Large v3 Turbo</option
										></select
									></label
								>
								<label class="space-y-2"
									><span class="text-sm font-semibold text-primary">Device</span><select
										class="w-full rounded-lg border border-color bg-primary px-3 py-2.5 text-primary"
										bind:value={settings.device}
										><option value="AUTO">Automatic — GPU with CPU fallback</option><option
											value="GPU">GPU preferred</option
										><option value="CPU">CPU</option></select
									></label
								>
								<label class="space-y-2"
									><span class="text-sm font-semibold text-primary"
										>Minimum speakers <span class="font-normal text-thirdly">(optional)</span></span
									><input
										type="number"
										min="1"
										max="20"
										class="w-full rounded-lg border border-color bg-primary px-3 py-2.5 text-primary"
										value={settings.minSpeakers ?? ''}
										oninput={(event) =>
											(settings.minSpeakers = event.currentTarget.value
												? Number(event.currentTarget.value)
												: null)}
									/></label
								>
								<label class="space-y-2"
									><span class="text-sm font-semibold text-primary"
										>Maximum speakers <span class="font-normal text-thirdly">(optional)</span></span
									><input
										type="number"
										min="1"
										max="20"
										class="w-full rounded-lg border border-color bg-primary px-3 py-2.5 text-primary"
										value={settings.maxSpeakers ?? ''}
										oninput={(event) =>
											(settings.maxSpeakers = event.currentTarget.value
												? Number(event.currentTarget.value)
												: null)}
									/></label
								>
							</div>
						{/if}
						<div class="rounded-xl border border-color bg-primary p-5">
							<div class="flex items-start justify-between gap-4">
								<div>
									<h4 class="font-semibold text-primary">Subtitle length</h4>
									<p class="mt-1 text-xs leading-relaxed text-secondary">
										Choose how dense the generated subtitles should feel. These are preferred
										limits, not rigid cutoffs.
									</p>
								</div>
								{#if activeSubtitleLengthPreset === 'custom'}
									<span
										class="rounded-full border border-color bg-secondary px-2.5 py-1 text-[11px] font-semibold text-secondary"
										>Custom</span
									>
								{/if}
							</div>
							<div class="mt-4 grid gap-3 md:grid-cols-3">
								{#each subtitleLengthPresetEntries as [preset, definition] (preset)}
									<button
										type="button"
										aria-pressed={activeSubtitleLengthPreset === preset}
										class={`cursor-pointer rounded-xl border p-4 text-left transition-all ${
											activeSubtitleLengthPreset === preset
												? 'border-accent-primary bg-accent-primary/15'
												: 'border-color bg-secondary hover:border-accent-primary/50'
										}`}
										onclick={() => applySubtitleLengthPreset(preset)}
									>
										<div class="flex items-center justify-between gap-2">
											<span class="text-sm font-semibold text-primary"
												>{subtitleLengthPresetCopy[preset].label}</span
											>
											{#if preset === 'balanced'}
												<span
													class="rounded-full bg-accent-primary/15 px-2 py-0.5 text-[10px] font-semibold text-accent-primary"
													>Recommended</span
												>
											{/if}
										</div>
										<p class="mt-2 text-xs leading-relaxed text-secondary">
											{subtitleLengthPresetCopy[preset].description}
										</p>
										<p class="mt-3 text-[11px] font-medium text-thirdly">
											{definition.maxWords} words · {definition.maxChars} characters
										</p>
									</button>
								{/each}
							</div>
							<div class="mt-4 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2.5">
								<p class="text-xs leading-relaxed text-secondary">
									Minbar may slightly exceed the preferred length to preserve a complete idea, avoid
									orphan words or keep a short Quran verse together.
								</p>
							</div>
							<button
								type="button"
								class="mt-4 flex w-full cursor-pointer items-center justify-between rounded-lg px-1 py-2 text-left text-sm font-semibold text-secondary hover:text-primary"
								onclick={() => (advancedSubtitleSettingsOpen = !advancedSubtitleSettingsOpen)}
								aria-expanded={advancedSubtitleSettingsOpen}
							>
								<span>Advanced settings</span>
								<span class="material-icons text-lg">
									{advancedSubtitleSettingsOpen ? 'expand_less' : 'expand_more'}
								</span>
							</button>
							{#if advancedSubtitleSettingsOpen}
								<div class="mt-1 grid gap-4 border-t border-color pt-4 md:grid-cols-2">
									<label class="space-y-2"
										><span class="text-xs text-secondary">Preferred maximum words</span><input
											type="number"
											min="4"
											max="40"
											class="w-full rounded-lg border border-color bg-secondary px-3 py-2 text-primary"
											bind:value={settings.maxWordsPerSegment}
											oninput={markSubtitleLengthAsCustom}
										/></label
									><label class="space-y-2"
										><span class="text-xs text-secondary">Preferred maximum characters</span><input
											type="number"
											min="30"
											max="240"
											class="w-full rounded-lg border border-color bg-secondary px-3 py-2 text-primary"
											bind:value={settings.maxCharsPerSegment}
											oninput={markSubtitleLengthAsCustom}
										/></label
									>
									<label class="space-y-2"
										><span class="text-xs text-secondary"
											>{get(LL).editor.extendSubtitleBeforeSilence()}</span
										>
										<div class="flex items-center gap-2">
											<input
												type="number"
												min="0"
												max="2000"
												step="50"
												class="w-full rounded-lg border border-color bg-secondary px-3 py-2 text-primary"
												bind:value={settings.subtitleEndPaddingMs}
											/>
											<span class="text-xs text-secondary">{get(LL).common.milliseconds()}</span>
										</div></label
									><label class="space-y-2"
										><span class="text-xs text-secondary"
											>{get(LL).editor.startTimeLabel()} {get(LL).editor.paddingLabel()}</span
										>
										<div class="flex items-center gap-2">
											<input
												type="number"
												min="0"
												max="2000"
												step="50"
												class="w-full rounded-lg border border-color bg-secondary px-3 py-2 text-primary"
												bind:value={settings.subtitleStartLeadMs}
											/>
											<span class="text-xs text-secondary">{get(LL).common.milliseconds()}</span>
										</div></label
									>
								</div>
							{/if}
						</div>
						{#if !audioAvailable}<p
								class="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300"
							>
								Add an audio clip to the timeline before starting transcription.
							</p>{/if}
					</section>
				{:else if currentStep === 2}
					<section class="space-y-6">
						<div>
							<h3 class="text-lg font-bold text-primary">Transcribe the project audio</h3>
							<p class="mt-1 text-sm text-secondary">
								{settings.provider === 'groq'
									? $LL.editor.groqTranscriptionDescription()
									: settings.provider === 'alignment'
										? $LL.editor.referenceAlignmentDescription()
										: $LL.editor.aiTranscriptionLocalDescription()}
							</p>
						</div>
						<div class="grid gap-3 sm:grid-cols-3">
							<div class="rounded-xl bg-primary p-4">
								<p class="text-xs text-secondary">Model</p>
								<p class="mt-1 font-semibold text-primary">
									{settings.provider === 'groq'
										? 'Whisper Large V3'
										: settings.model === 'qwen3-asr-1.7b'
											? 'Qwen3-ASR 1.7B'
											: settings.model}
								</p>
							</div>
							<div class="rounded-xl bg-primary p-4">
								<p class="text-xs text-secondary">Language</p>
								<p class="mt-1 font-semibold text-primary">{$LL.editor.arabic()}</p>
							</div>
							<div class="rounded-xl bg-primary p-4">
								<p class="text-xs text-secondary">Speaker range</p>
								<p class="mt-1 font-semibold text-primary">
									{settings.provider === 'groq'
										? '1'
										: `${settings.minSpeakers ?? '?'}–${settings.maxSpeakers ?? '?'}`}
								</p>
							</div>
						</div>
						{#if runtime.running}
							<div class="rounded-xl border border-color bg-primary p-5">
								<div class="flex items-center gap-3">
									<span class="material-icons animate-spin text-accent-primary">sync</span>
									<div>
										<p class="font-semibold text-primary">Transcription in progress</p>
										<p class="text-xs text-secondary">{runtime.runMessage}</p>
									</div>
								</div>
								<div class="mt-4 h-2 overflow-hidden rounded-full bg-secondary">
									<div
										class="h-full bg-[var(--accent-primary)] transition-all"
										style={`width: ${runtime.progress ?? 5}%`}
									></div>
								</div>
							</div>
						{:else}
							<button
								type="button"
								class="btn-accent inline-flex cursor-pointer items-center gap-2 rounded-lg px-5 py-3 font-semibold disabled:opacity-50"
								onclick={() => void startTranscription()}
								disabled={!setupReady || !audioAvailable}
								><span class="material-icons">auto_awesome</span>{settings.provider === 'alignment'
									? $LL.editor.referenceAlignmentStart()
									: $LL.editor.startAITranscription()}</button
							>
						{/if}
					</section>
				{:else if currentStep === 3 && session.result}
					<section class="space-y-6">
						<div>
							<h3 class="text-lg font-bold text-primary">Match detected voices</h3>
							<p class="mt-1 text-sm text-secondary">
								{settings.provider === 'groq'
									? $LL.editor.groqSpeakerResultDescription()
									: $LL.editor.localSpeakerResultDescription()}
							</p>
						</div>
						<div class="grid gap-3 sm:grid-cols-3">
							<div class="rounded-xl bg-primary p-4">
								<p class="text-xs text-secondary">Subtitle segments</p>
								<p class="mt-1 text-xl font-bold text-primary">{session.result.segments.length}</p>
							</div>
							<div class="rounded-xl bg-primary p-4">
								<p class="text-xs text-secondary">Detected voices</p>
								<p class="mt-1 text-xl font-bold text-primary">{session.result.speakers.length}</p>
							</div>
							<div class="rounded-xl bg-primary p-4">
								<p class="text-xs text-secondary">Word timestamps</p>
								<p
									class="mt-1 text-xl font-bold {session.result.wordTimestampsAvailable
										? 'text-green-400'
										: 'text-yellow-400'}"
								>
									{session.result.wordTimestampsAvailable ? 'Available' : 'Unavailable'}
								</p>
							</div>
						</div>
						{#if session.result.alignmentWarning}
							<div
								class="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs leading-relaxed text-yellow-200"
							>
								{#if settings.provider === 'alignment'}
									{session.result.alignmentWarning}
								{:else}
									Word-level alignment was unavailable, so these subtitles use segment timestamps
									only. The transcription and speaker detection were still completed.
								{/if}
							</div>
						{/if}
						<div class="rounded-xl border border-blue-500/30 bg-blue-500/10 p-4">
							<div class="flex items-start gap-3">
								<span class="material-icons mt-0.5 text-lg text-blue-300">info</span>
								<div class="text-xs leading-relaxed text-secondary">
									<p class="font-semibold text-primary">What should I do here?</p>
									<p class="mt-1">
										Each card represents one distinct voice detected by pyannote. Preview the voice,
										then select the real speaker name. Use <strong>Add speaker</strong> when the name
										is not already in the project.
									</p>
								</div>
							</div>
						</div>
						{#if existingSpeakerNames().length > 0}
							<div class="rounded-xl border border-color bg-primary p-4">
								<div class="flex items-start justify-between gap-4">
									<div>
										<p class="text-sm font-semibold text-primary">Available speakers</p>
										<p class="mt-1 text-xs text-secondary">
											Remove an unused speaker directly, or reassign its existing segments before
											removing it.
										</p>
									</div>
								</div>
								<div class="mt-3 flex flex-wrap gap-2">
									{#each existingSpeakerNames() as speakerName (speakerName)}
										<div class="group/saved-speaker relative inline-flex">
											<span
												class="rounded-full border border-color bg-secondary py-1.5 px-3 text-xs font-semibold text-secondary"
											>
												{speakerName}
											</span>
											{#if canRemoveProjectSpeaker(speakerName)}
												<button
													type="button"
													class="absolute -right-1 top-1 border-2 border-color flex h-5 w-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full opacity-0 transition hover:bg-accent hover:text-primary group-hover/saved-speaker:opacity-100 focus:opacity-100"
													onclick={() => void removeAvailableSpeaker(speakerName)}
													aria-label={`Remove ${speakerName}`}
													title={`Remove ${speakerName} from the project`}
												>
													<span class="material-icons text-xs!">close</span>
												</button>
											{/if}
										</div>
									{/each}
								</div>
							</div>
						{/if}
						<div class="space-y-3">
							{#each session.result.speakers as speakerId, speakerIndex (speakerId)}
								<div class="rounded-xl border border-color bg-primary p-4">
									<div class="flex items-center gap-4">
										<span
											class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-primary"
											>{speakerIndex + 1}</span
										>
										<div class="min-w-0 flex-1">
											<div class="flex items-center justify-between gap-3">
												<div>
													<p class="text-sm font-semibold text-primary">Voice {speakerIndex + 1}</p>
													<p class="text-[11px] font-mono text-thirdly">{speakerId}</p>
												</div>
												<button
													type="button"
													class="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-color px-2.5 py-1.5 text-xs font-semibold text-secondary transition hover:bg-accent hover:text-primary"
													onclick={() => previewSpeaker(speakerId)}
												>
													<span class="material-icons text-sm">
														{isSpeakerPreviewActive(speakerId) &&
														globalState.getVideoPreviewState.isPlaying
															? 'pause'
															: 'play_arrow'}
													</span>
													{isSpeakerPreviewActive(speakerId)
														? globalState.getVideoPreviewState.isPlaying
															? 'Pause voice'
															: 'Resume voice'
														: 'Preview voice'}
												</button>
											</div>
											<div class="mt-3 flex items-center gap-2">
												<select
													class="min-w-0 flex-1 rounded-lg border border-color bg-secondary px-3 py-2.5 text-primary outline-none focus:border-[var(--accent-primary)]"
													value={session.speakerMap[speakerId] ?? ''}
													onchange={(event) =>
														(session.speakerMap[speakerId] = event.currentTarget.value)}
												>
													<option value="" disabled>Select a speaker</option>
													{#each getSpeakerOptions(speakerId) as speakerName (speakerName)}
														<option value={speakerName}>{speakerName}</option>
													{/each}
												</select>
												<button
													type="button"
													class="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-color px-3 py-2.5 text-xs font-semibold text-secondary transition hover:bg-accent hover:text-primary"
													onclick={() => void openAddSpeaker(speakerId)}
												>
													<span class="material-icons text-base">person_add</span>
													Add speaker
												</button>
											</div>
											{#if addingSpeakerForId === speakerId}
												<div
													class="mt-2 flex items-center gap-2 rounded-lg border border-color bg-secondary p-2"
												>
													<input
														bind:this={newSpeakerInput}
														class="min-w-0 flex-1 bg-transparent px-2 py-1 text-sm text-primary outline-none"
														bind:value={newSpeakerName}
														placeholder="New speaker name"
														onkeydown={(event) => handleNewSpeakerKeydown(event, speakerId)}
													/>
													<button
														type="button"
														class="btn-accent cursor-pointer px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
														onclick={() => addSpeakerForVoice(speakerId)}
														disabled={!newSpeakerName.trim()}>Add</button
													>
													<button
														type="button"
														class="cursor-pointer rounded px-2 py-1.5 text-xs text-secondary hover:bg-accent hover:text-primary"
														onclick={cancelAddSpeaker}>Cancel</button
													>
												</div>
											{/if}
										</div>
									</div>
									<div class="mt-3 space-y-1 border-t border-color pt-3">
										{#each getSpeakerExamples(speakerId) as example (`${speakerId}-${example.start}`)}
											<div class="flex gap-2 text-xs leading-relaxed text-secondary">
												<span class="shrink-0 font-mono text-thirdly"
													>{formatTimestamp(example.start)}</span
												>
												<span dir="auto">{example.text}</span>
											</div>
										{/each}
									</div>
								</div>
							{/each}
						</div>
						<label
							class="flex cursor-pointer items-start gap-3 rounded-xl border border-color bg-primary p-4"
							><input type="checkbox" class="mt-1" bind:checked={settings.replaceExisting} /><span
								><span class="block font-semibold text-primary"
									>Replace existing transcript segments</span
								><span class="mt-1 block text-xs text-secondary"
									>{existingSubtitleCount} existing subtitle segment(s) will be replaced. Disable this
									to append the new result instead.</span
								></span
							></label
						>
					</section>
				{:else if currentStep === 4 && session.result}
					<section class="space-y-6">
						<div>
							<h3 class="text-lg font-bold text-primary">
								{get(LL).editor.transcriptCleanupTitle()}
							</h3>
							<p class="mt-1 text-sm text-secondary">
								{get(LL).editor.transcriptCleanupDescription()}
							</p>
						</div>
						<div class="rounded-xl border border-blue-500/30 bg-blue-500/10 p-4">
							<div class="flex items-start gap-3">
								<span class="material-icons mt-0.5 text-lg text-blue-300">verified</span>
								<p class="text-xs leading-relaxed text-secondary">
									{get(LL).editor.transcriptCleanupMarkersInfo()}
								</p>
							</div>
						</div>
						<label
							class="flex cursor-pointer items-start gap-3 rounded-xl border border-color bg-primary p-4"
						>
							<input
								type="checkbox"
								class="mt-1"
								bind:checked={settings.poemMode}
								disabled={session.cleanupRunning}
								onchange={() => void saveAITranscriptionSettings()}
							/>
							<span>
								<span class="block font-semibold text-primary">{$LL.editor.poemMode()}</span>
								<span class="mt-1 block text-xs leading-relaxed text-secondary"
									>{$LL.editor.poemModeDescription()}</span
								>
							</span>
						</label>
						<div class="grid gap-4 rounded-xl border border-color bg-primary p-5 md:grid-cols-2">
							<AIReasoningControls
								id="transcript-cleanup-reasoning-mode"
								endpoint={globalState.settings!.aiTranslationSettings.textAiApiEndpoint}
								model={globalState.settings!.aiTranslationSettings.advancedTrimModel}
								mode={globalState.settings!.aiTranslationSettings.transcriptCleanupReasoningMode}
								disabled={session.cleanupRunning}
								onchange={updateCleanupReasoningMode}
							/>
							<label class="space-y-3">
								<div class="flex items-center justify-between gap-3">
									<span class="text-sm font-semibold text-primary"
										>{get(LL).editor.transcriptCleanupBatchSize()}</span
									>
									<span class="text-sm font-bold text-accent-primary"
										>{settings.cleanupBatchWords}</span
									>
								</div>
								<input
									type="range"
									min="160"
									max="640"
									step="40"
									class="w-full"
									bind:value={settings.cleanupBatchWords}
									disabled={session.cleanupRunning}
									onchange={() => void saveAITranscriptionSettings()}
								/>
								<p class="text-xs text-secondary">
									{get(LL).editor.transcriptCleanupBatchPreview({
										count: session.cleanupBatchCount
									})}
								</p>
								{#if globalState.getSubtitlesEditorState.aiTranscriptCleanup && globalState.getSubtitlesEditorState.aiTranscriptCleanup.batchWords !== settings.cleanupBatchWords}
									<p class="text-xs text-secondary">
										{$LL.editor.transcriptCleanupBatchSizeChanged()}
									</p>
								{/if}
							</label>
						</div>
						{#if session.cleanupRunning || session.cleanupMessage}
							<div class="rounded-xl border border-color bg-primary p-5">
								<div class="flex items-center gap-3">
									<span
										class={`material-icons ${session.cleanupRunning ? 'animate-spin text-accent-primary' : session.cleanupErrors.length > 0 ? 'text-yellow-400' : 'text-green-400'}`}
									>
										{session.cleanupRunning
											? 'sync'
											: session.cleanupErrors.length > 0
												? 'warning'
												: 'check_circle'}
									</span>
									<p class="text-sm text-secondary">{session.cleanupMessage}</p>
								</div>
								{#if streamedCleanupBatches().length > 0}
									<div class="mt-4">
										<AIStreamBatchList
											batches={streamedCleanupBatches()}
											placeholder={get(LL).translations.streamingResponsePlaceholder()}
										/>
									</div>
								{/if}
								{#if streamedSemanticBatches().length > 0}
									<div class="mt-5 border-t border-color pt-4">
										<p class="mb-3 text-xs font-semibold uppercase tracking-wide text-secondary">
											{get(LL).editor.transcriptSemanticSegmentation()}
										</p>
										<AIStreamBatchList
											batches={streamedSemanticBatches()}
											placeholder={get(LL).translations.streamingResponsePlaceholder()}
										/>
									</div>
								{/if}
							</div>
						{/if}
					</section>
				{/if}

				{#if session.errorMessage}<div
						class="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300"
					>
						<div class="flex items-start gap-2">
							<span class="material-icons text-lg">error</span><span class="whitespace-pre-wrap"
								>{session.errorMessage}</span
							>
						</div>
					</div>{/if}
			</div>
		</main>
	</div>

	<footer class="flex items-center justify-between border-t border-color bg-primary px-6 py-4">
		<p class="text-xs text-thirdly">
			{get(LL).editor.transcriptionDataPrivacy()}
		</p>
		<div class="flex items-center gap-2">
			{#if currentStep > 0 && !cleanupOnly}<button
					type="button"
					class="btn cursor-pointer px-4 py-2 text-sm disabled:opacity-40"
					onclick={() => (currentStep -= 1)}
					disabled={runtime.running || runtime.installing || session.cleanupRunning}>Back</button
				>{/if}
			{#if currentStep < 2}<button
					type="button"
					class="btn-accent cursor-pointer px-4 py-2 text-sm disabled:opacity-40"
					onclick={() => (currentStep += 1)}
					disabled={!canGoNext() || runtime.running || runtime.installing || session.cleanupRunning}
					>Next</button
				>{:else if currentStep === 3 && session.result}<button
					type="button"
					class="btn-accent inline-flex cursor-pointer items-center gap-2 px-5 py-2 text-sm font-semibold"
					onclick={() =>
						settings.provider === 'alignment' ? void applyResult() : void openTranscriptCleanup()}
					><span class="material-icons text-lg"
						>{settings.provider === 'alignment' ? 'done_all' : 'arrow_forward'}</span
					>{settings.provider === 'alignment' ? $LL.common.done() : $LL.common.next()}</button
				>{:else if currentStep === 4 && session.result && !session.cleanupCompleted}<button
					type="button"
					class="btn-accent inline-flex cursor-pointer items-center gap-2 px-5 py-2 text-sm font-semibold disabled:opacity-50"
					onclick={() =>
						session.cleanupRunning
							? session.pauseTranscriptCleanup()
							: void session.startTranscriptCleanup()}
					disabled={session.cleanupPauseRequested}
					><span class="material-icons text-lg"
						>{session.cleanupRunning ? 'pause' : 'auto_fix_high'}</span
					>{session.cleanupRunning
						? session.cleanupPauseRequested
							? get(LL).editor.pausingTranscriptCleanup()
							: get(LL).editor.pauseTranscriptCleanup()
						: globalState.getSubtitlesEditorState.aiTranscriptCleanup
							? get(LL).editor.resumeTranscriptCleanup()
							: get(LL).editor.cleanTranscript()}</button
				>{:else if currentStep === 4 && session.result}<button
					type="button"
					class="btn-accent inline-flex cursor-pointer items-center gap-2 px-5 py-2 text-sm font-semibold"
					onclick={() => void applyResult()}
					><span class="material-icons text-lg">done_all</span>{get(LL).common.done()}</button
				>{/if}
		</div>
	</footer>
</div>
