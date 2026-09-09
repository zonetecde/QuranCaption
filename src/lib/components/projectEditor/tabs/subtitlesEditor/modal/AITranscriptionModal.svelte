<script lang="ts">
	import { listen, type UnlistenFn } from '@tauri-apps/api/event';
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
		getVisibleProjectSpeakers,
		requestProjectSpeakerRemoval
	} from '$lib/services/SpeakerLibrary';
	import {
		applyAITranscription,
		buildAITranscriptionFromSubtitleTrack,
		buildDefaultSpeakerMap,
		checkAITranscriptionStatus,
		installAITranscriptionRuntime,
		runAITranscription,
		saveAITranscriptionSettings,
		type AITranscriptionResult,
		type AITranscriptionRuntimeStatus,
		type SpeakerNameMap
	} from '$lib/services/AITranscription';
	import {
		cleanupAITranscript,
		estimateTranscriptCleanupBatchCount
	} from '$lib/services/AITranscriptCleanup';
	import AIReasoningControls from '$lib/components/ai/AIReasoningControls.svelte';
	import AIStreamBatchList, {
		type AIStreamBatchState
	} from '$lib/components/ai/AIStreamBatchList.svelte';
	import { resolveAIReasoning, type AIReasoningMode } from '$lib/services/AIReasoning';

	let { close, cleanupOnly = false } = $props<{ close: () => void; cleanupOnly?: boolean }>();
	const settings = globalState.settings!.aiTranscriptionSettings;
	const steps = [
		{ label: 'Setup', icon: 'download' },
		{ label: 'Model & speakers', icon: 'tune' },
		{ label: 'Transcribe', icon: 'graphic_eq' },
		{ label: 'Name speakers', icon: 'groups' },
		{ label: get(LL).editor.transcriptCleanupStep(), icon: 'auto_fix_high' }
	];

	let currentStep = $state(0);
	let runtimeStatus = $state<AITranscriptionRuntimeStatus | null>(null);
	let checkingRuntime = $state(false);
	let installing = $state(false);
	let running = $state(false);
	let installMessage = $state('');
	let runMessage = $state('');
	let progress = $state<number | null>(null);
	let errorMessage = $state('');
	let result = $state<AITranscriptionResult | null>(null);
	let speakerMap = $state<SpeakerNameMap>({});
	let previewingSpeakerId = $state<string | null>(null);
	let addingSpeakerForId = $state<string | null>(null);
	let newSpeakerName = $state('');
	let newSpeakerInput: HTMLInputElement | null = $state(null);
	let statusUnlisten: UnlistenFn | null = null;
	let installUnlisten: UnlistenFn | null = null;
	let cleanupChunkUnlisten: UnlistenFn | null = null;
	let cleanupReasoningUnlisten: UnlistenFn | null = null;
	let cleanupRunning = $state(false);
	let cleanupPauseRequested = $state(false);
	let cleanupCompleted = $state(false);
	let cleanupMessage = $state('');
	let cleanupErrors = $state<string[]>([]);
	let cleanupBatchStreams = $state<Record<string, AIStreamBatchState>>({});
	let advancedSubtitleSettingsOpen = $state(false);

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
	let appliedClipIds = $state<number[]>([]);

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
			maxChars: settings.maxCharsPerSegment,
			silenceSeconds: settings.minSilenceDuration
		})
	);
	const audioAvailable = $derived(globalState.getAudioTrack.clips.length > 0);
	const existingSubtitleCount = $derived(
		globalState.getSubtitleTrack.clips.filter((clip) => clip instanceof SubtitleClip).length
	);
	const existingSpeakerNames = $derived(() => getVisibleProjectSpeakers());
	const cleanupBatchCount = $derived(
		result ? estimateTranscriptCleanupBatchCount(result, settings.cleanupBatchWords) : 0
	);
	const streamedCleanupBatches = $derived(() =>
		Object.values(cleanupBatchStreams).sort((left, right) => left.index - right.index)
	);

	/**
	 * Applique un profil de longueur et ses trois paramètres associés.
	 * @param {BuiltInSubtitleLengthPreset} preset Profil choisi.
	 * @returns {void}
	 */
	function applySubtitleLengthPreset(preset: BuiltInSubtitleLengthPreset): void {
		const definition = SUBTITLE_LENGTH_PRESETS[preset];
		settings.subtitleLengthPreset = preset;
		settings.maxWordsPerSegment = definition.maxWords;
		settings.maxCharsPerSegment = definition.maxChars;
		settings.minSilenceDuration = definition.silenceSeconds;
	}

	/**
	 * Marque les valeurs avancées comme personnalisées.
	 * @returns {void}
	 */
	function markSubtitleLengthAsCustom(): void {
		settings.subtitleLengthPreset = 'custom';
	}

	async function refreshRuntime(): Promise<void> {
		checkingRuntime = true;
		errorMessage = '';
		try {
			runtimeStatus = await checkAITranscriptionStatus();
		} catch (error) {
			runtimeStatus = null;
			errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			checkingRuntime = false;
		}
	}

	async function installRuntime(): Promise<void> {
		if (installing) return;
		installing = true;
		errorMessage = '';
		installMessage = 'Preparing managed Python...';
		installUnlisten = await listen<{ message?: string }>('install-status', (event) => {
			if (event.payload.message) installMessage = event.payload.message;
		});
		try {
			await installAITranscriptionRuntime(settings.hfToken);
			await refreshRuntime();
			toast.success('WhisperX transcription runtime installed.');
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			installUnlisten?.();
			installUnlisten = null;
			installing = false;
			installMessage = '';
		}
	}

	async function startTranscription(): Promise<void> {
		if (running || !runtimeStatus?.ready || !settings.hfToken.trim()) return;
		running = true;
		result = null;
		cleanupCompleted = false;
		cleanupErrors = [];
		speakerMap = {};
		errorMessage = '';
		runMessage = 'Preparing audio...';
		progress = 0;
		await saveAITranscriptionSettings();
		statusUnlisten = await listen<{ message?: string; progress?: number }>(
			'segmentation-status',
			(event) => {
				if (event.payload.message) runMessage = event.payload.message;
				if (typeof event.payload.progress === 'number') progress = event.payload.progress;
			}
		);
		try {
			const transcription = await runAITranscription(settings);
			runMessage = get(LL).editor.matchingQuranPassages();
			const quranReport = await cleanupAITranscript(transcription, {
				maxWords: settings.maxWordsPerSegment,
				maxChars: settings.maxCharsPerSegment,
				maxGap: settings.minSilenceDuration
			});
			result = quranReport.result;
			cleanupErrors = quranReport.errors;
			globalState.getSubtitlesEditorState.aiTranscriptCleanup = null;
			speakerMap = buildDefaultSpeakerMap(result);
			const applied = applyAITranscription(result, speakerMap, settings.replaceExisting);
			appliedClipIds = applied.clipIds;
			await globalState.currentProject?.save(false);
			currentStep = 3;
			toast.success(`Transcribed ${result.segments.length} subtitle segments.`);
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			statusUnlisten?.();
			statusUnlisten = null;
			running = false;
			progress = null;
		}
	}

	async function applyResult(): Promise<void> {
		if (!result) return;
		for (const speakerId of result.speakers) {
			if (!speakerMap[speakerId]?.trim()) {
				errorMessage = `Choose a name for ${speakerId} before applying the transcription.`;
				return;
			}
		}
		if (cleanupCompleted) {
			close();
			return;
		}
		const applied = applyAITranscription(
			result,
			speakerMap,
			settings.replaceExisting,
			appliedClipIds
		);
		appliedClipIds = applied.clipIds;
		await saveAITranscriptionSettings();
		await globalState.currentProject?.save(false);
		toast.success(`Applied ${applied.count} transcript segments with word timestamps.`);
		close();
	}

	/**
	 * Ouvre l'étape de nettoyage après validation des noms de voix.
	 * @returns {Promise<void>} Promesse résolue après l'application des noms de voix.
	 */
	async function openTranscriptCleanup(): Promise<void> {
		const previewState = globalState.getVideoPreviewState;
		if (previewState.isPlaying) previewState.togglePlayPause();
		for (const speakerId of result?.speakers ?? []) {
			if (!speakerMap[speakerId]?.trim()) {
				errorMessage = get(LL).editor.chooseSpeakerBeforeCleanup({ speaker: speakerId });
				return;
			}
		}
		errorMessage = '';
		if (result) {
			const applied = applyAITranscription(
				result,
				speakerMap,
				settings.replaceExisting,
				appliedClipIds
			);
			appliedClipIds = applied.clipIds;
			await globalState.currentProject?.save(false);
		}
		currentStep = 4;
	}

	/**
	 * Charge une reprise existante ou les sous-titres actuels pour un nettoyage après-coup.
	 * @returns {void}
	 */
	function initializeCleanupOnly(): void {
		currentStep = 4;
		const pending = globalState.getSubtitlesEditorState.aiTranscriptCleanup;
		if (pending) {
			result = pending.sourceResult;
			speakerMap = pending.speakerMap;
			appliedClipIds = pending.appliedClipIds;
			settings.cleanupBatchWords = pending.batchWords;
			cleanupErrors = pending.errors;
			cleanupMessage = get(LL).editor.transcriptCleanupPaused({
				remaining: pending.totalBatches - pending.nextBatchIndex
			});
			return;
		}
		const snapshot = buildAITranscriptionFromSubtitleTrack();
		result = snapshot.result;
		speakerMap = snapshot.speakerMap;
		appliedClipIds = snapshot.clipIds;
	}

	/**
	 * Prépare les mots transcrits, détecte le Quran et reconstruit les sous-titres.
	 * @returns {Promise<void>} Promesse résolue après tous les batches.
	 */
	async function startTranscriptCleanup(): Promise<void> {
		if (!result || cleanupRunning) return;
		const aiSettings = globalState.settings!.aiTranslationSettings;
		const editorState = globalState.getSubtitlesEditorState;
		const apiKey = aiSettings.openAiApiKey.trim();
		const endpoint = aiSettings.textAiApiEndpoint.trim();
		const model = aiSettings.advancedTrimModel.trim();
		if (!apiKey || !endpoint || !model) {
			errorMessage = get(LL).translations.aiTranslationProviderMissing();
			return;
		}
		let task = editorState.aiTranscriptCleanup;
		if (!task) {
			task = {
				sourceResult: result,
				speakerMap: { ...speakerMap },
				analyses: [],
				errors: [],
				nextBatchIndex: 0,
				totalBatches: cleanupBatchCount,
				batchWords: settings.cleanupBatchWords,
				appliedClipIds: [...appliedClipIds]
			};
			editorState.aiTranscriptCleanup = task;
			await globalState.currentProject?.save(false);
		}
		let activeTask = task;

		cleanupRunning = true;
		cleanupPauseRequested = false;
		cleanupCompleted = false;
		cleanupErrors = [];
		cleanupBatchStreams = Object.fromEntries(
			Array.from(
				{ length: Math.max(0, activeTask.totalBatches - activeTask.nextBatchIndex) },
				(_, index) => {
					const batchIndex = activeTask.nextBatchIndex + index + 1;
					const batchId = `pending-${batchIndex}`;
					return [
						batchId,
						{
							batchId,
							index: batchIndex,
							total: activeTask.totalBatches,
							status: 'pending',
							reasoning: '',
							response: ''
						} satisfies AIStreamBatchState
					];
				}
			)
		);
		cleanupMessage = get(LL).common.processing();
		errorMessage = '';
		await saveAITranscriptionSettings();
		try {
			const reasoning = resolveAIReasoning(
				endpoint,
				model,
				aiSettings.transcriptCleanupReasoningMode
			);
			cleanupChunkUnlisten = await listen<{
				batchId: string;
				accumulatedText: string;
			}>('ai-transcript-cleanup-chunk', (event) => {
				const batch = cleanupBatchStreams[event.payload.batchId];
				if (batch) batch.response = event.payload.accumulatedText;
			});
			cleanupReasoningUnlisten = await listen<{
				batchId: string;
				accumulatedText: string;
			}>('ai-transcript-cleanup-reasoning', (event) => {
				const batch = cleanupBatchStreams[event.payload.batchId];
				if (batch) batch.reasoning = event.payload.accumulatedText;
			});
			const report = await cleanupAITranscript(activeTask.sourceResult, {
				apiKey,
				endpoint,
				model,
				reasoningEffort: reasoning.effort,
				thinkingEnabled: reasoning.thinkingEnabled,
				batchWords: activeTask.batchWords,
				maxWords: settings.maxWordsPerSegment,
				maxChars: settings.maxCharsPerSegment,
				maxGap: settings.minSilenceDuration,
				resume: {
					analyses: activeTask.analyses,
					errors: activeTask.errors,
					nextBatchIndex: activeTask.nextBatchIndex
				},
				shouldPause: () => cleanupPauseRequested,
				onProgress: (current, total, batchId) => {
					delete cleanupBatchStreams[`pending-${current}`];
					cleanupBatchStreams[batchId] = {
						batchId,
						index: current,
						total,
						status: 'running',
						reasoning: '',
						response: ''
					};
					cleanupMessage = get(LL).editor.transcriptCleanupBatchProgress({ current, total });
				},
				onSemanticSegmentationStart: () => {
					cleanupMessage = get(LL).editor.transcriptSemanticSegmentation();
				},
				onBatchComplete: async (batchReport, batchId) => {
					if (cleanupBatchStreams[batchId]) {
						cleanupBatchStreams[batchId].status = 'completed';
					}
					result = batchReport.result;
					cleanupErrors = batchReport.errors;
					const applied = applyAITranscription(
						batchReport.result,
						activeTask.speakerMap,
						false,
						activeTask.appliedClipIds
					);
					appliedClipIds = applied.clipIds;
					activeTask = {
						...activeTask,
						analyses: batchReport.analyses,
						errors: batchReport.errors,
						nextBatchIndex: batchReport.nextBatchIndex,
						totalBatches: batchReport.totalBatches,
						appliedClipIds: applied.clipIds
					};
					editorState.aiTranscriptCleanup = activeTask;
					await globalState.currentProject?.save(false);
				}
			});
			result = report.result;
			cleanupErrors = report.errors;
			if (report.paused) {
				activeTask = {
					...activeTask,
					analyses: report.analyses,
					errors: report.errors,
					nextBatchIndex: report.nextBatchIndex,
					totalBatches: report.totalBatches,
					appliedClipIds: [...appliedClipIds]
				};
				editorState.aiTranscriptCleanup = activeTask;
				cleanupMessage = get(LL).editor.transcriptCleanupPaused({
					remaining: report.totalBatches - report.nextBatchIndex
				});
				await globalState.currentProject?.save(false);
				return;
			}
			const applied = applyAITranscription(
				report.result,
				activeTask.speakerMap,
				false,
				activeTask.appliedClipIds
			);
			appliedClipIds = applied.clipIds;
			cleanupCompleted = true;
			editorState.aiTranscriptCleanup = null;
			cleanupMessage =
				report.errors.length > 0
					? get(LL).editor.transcriptCleanupCompletedWithIssues({
							cleaned: report.processedSegments,
							total: report.processedSegments,
							errors: report.errors.length
						})
					: get(LL).editor.transcriptCleanupCompleted({
							cleaned: report.processedSegments,
							total: report.processedSegments
						});
			await globalState.currentProject?.save(false);
		} catch (error) {
			for (const batch of Object.values(cleanupBatchStreams)) {
				if (batch.status === 'running') batch.status = 'failed';
			}
			errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			cleanupChunkUnlisten?.();
			cleanupChunkUnlisten = null;
			cleanupReasoningUnlisten?.();
			cleanupReasoningUnlisten = null;
			cleanupRunning = false;
		}
	}

	/**
	 * Demande l'arrêt du nettoyage après le batch en cours.
	 * @returns {void}
	 */
	function pauseTranscriptCleanup(): void {
		cleanupPauseRequested = true;
	}

	function getSpeakerExamples(speakerId: string): AITranscriptionResult['segments'] {
		return result?.segments.filter((segment) => segment.speaker === speakerId).slice(0, 2) ?? [];
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
		const current = speakerMap[speakerId]?.trim();
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

		const speakerName = addProjectSpeaker(normalized);
		if (!speakerName) return;
		speakerMap[speakerId] = speakerName;
		cancelAddSpeaker();
	}

	async function removeAvailableSpeaker(speakerName: string): Promise<void> {
		const outcome = await requestProjectSpeakerRemoval(speakerName);
		if (!outcome.removed) return;

		for (const speakerId of Object.keys(speakerMap)) {
			if (speakerMap[speakerId]?.toLocaleLowerCase() === speakerName.toLocaleLowerCase()) {
				speakerMap[speakerId] = outcome.replacement ?? '';
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
		if (currentStep === 0) return Boolean(runtimeStatus?.ready && settings.hfToken.trim());
		if (currentStep === 1) return Boolean(settings.hfToken.trim() && audioAvailable);
		if (currentStep === 2) return Boolean(result);
		return false;
	}

	function closeSafely(): void {
		if (!running && !installing && !cleanupRunning) close();
	}

	onMount(() => {
		if (!settings.subtitleLengthPreset) applySubtitleLengthPreset('balanced');
		if (cleanupOnly) initializeCleanupOnly();
		else void refreshRuntime();
	});
	onDestroy(() => {
		statusUnlisten?.();
		installUnlisten?.();
		cleanupChunkUnlisten?.();
		cleanupReasoningUnlisten?.();
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
			<h2 class="text-xl font-bold text-primary">AI transcription</h2>
			<p class="text-xs text-secondary">
				WhisperX transcription, word alignment and pyannote speaker detection
			</p>
		</div>
		<button
			type="button"
			class="ml-auto flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-secondary transition hover:bg-accent hover:text-primary disabled:opacity-40"
			onclick={closeSafely}
			disabled={running || installing || cleanupRunning}
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
							class={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-semibold transition ${index === currentStep ? 'bg-accent text-primary' : 'text-secondary hover:bg-accent/60 hover:text-primary'} ${index > currentStep && !(index === 3 && result) ? 'cursor-default opacity-45' : 'cursor-pointer'}`}
							onclick={() => {
								if (index <= currentStep || (index === 3 && result)) currentStep = index;
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
							<h3 class="text-lg font-bold text-primary">Local runtime setup</h3>
							<p class="mt-1 text-sm text-secondary">
								Minbar Studio installs its own Python 3.12 environment, WhisperX, pyannote and the
								appropriate PyTorch build. The user's system Python is not required.
							</p>
						</div>
						<div
							class={`rounded-xl border p-5 ${runtimeStatus?.ready ? 'border-green-500/40 bg-green-500/10' : 'border-color bg-primary'}`}
						>
							<div class="flex items-center gap-4">
								<span
									class="material-icons text-3xl {runtimeStatus?.ready
										? 'text-green-400'
										: 'text-secondary'}"
									>{runtimeStatus?.ready ? 'check_circle' : 'download_for_offline'}</span
								>
								<div class="min-w-0 flex-1">
									<p class="font-semibold text-primary">
										{$LL.editor.aiTranscription()} · {runtimeStatus?.ready
											? $LL.common.done()
											: $LL.common.required()}
									</p>
									<p class="mt-1 text-xs text-secondary">
										{checkingRuntime
											? 'Checking local runtime...'
											: (runtimeStatus?.message ?? 'Runtime status has not been checked yet.')}
									</p>
								</div>
								{#if !runtimeStatus?.ready}
									<button
										type="button"
										class="btn-accent inline-flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
										onclick={() => void installRuntime()}
										disabled={installing || checkingRuntime}
									>
										<span class="material-icons text-lg">download</span>
										{installing ? 'Installing...' : 'Install automatically'}
									</button>
								{/if}
							</div>
							{#if installMessage}<p
									class="mt-4 rounded-lg bg-secondary px-3 py-2 font-mono text-xs text-secondary"
								>
									{installMessage}
								</p>{/if}
						</div>
						<div class="rounded-xl border border-color bg-primary p-5">
							<h4 class="font-semibold text-primary">Hugging Face access</h4>
							<p class="mt-1 text-xs leading-relaxed text-secondary">
								Speaker detection uses the gated pyannote Community-1 model. Accept its conditions,
								create a read token, then paste it below. The token is stored in Minbar Studio
								settings and passed only to Hugging Face libraries.
							</p>
							<div class="mt-4 flex flex-wrap gap-2">
								<button
									type="button"
									class="btn cursor-pointer px-3 py-2 text-xs"
									onclick={() =>
										void openUrl('https://huggingface.co/pyannote/speaker-diarization-community-1')}
									>Accept model conditions</button
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
							{#if !settings.hfToken.trim()}
								<p class="mt-2 text-xs text-yellow-300">
									Enter a read token to continue to transcription settings.
								</p>
							{/if}
						</div>
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
											{definition.maxWords} words · {definition.maxChars} characters · {definition.silenceSeconds}s
											pause
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
									<label class="space-y-2 md:col-span-2"
										><div class="flex items-center justify-between gap-3">
											<span class="text-xs text-secondary">{get(LL).editor.minSilenceLabel()}</span>
											<div class="flex items-center gap-2">
												<input
													type="number"
													min="0.3"
													max="4"
													step="0.1"
													class="w-20 rounded-lg border border-color bg-secondary px-3 py-2 text-primary"
													bind:value={settings.minSilenceDuration}
													oninput={markSubtitleLengthAsCustom}
												/>
												<span class="text-xs text-secondary">{get(LL).common.seconds()}</span>
											</div>
										</div>
										<input
											type="range"
											min="0.3"
											max="4"
											step="0.1"
											class="w-full"
											bind:value={settings.minSilenceDuration}
											oninput={markSubtitleLengthAsCustom}
										/></label
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
								WhisperX will transcribe speech, align every available word and pyannote will
								cluster the different voices.
							</p>
						</div>
						<div class="grid gap-3 sm:grid-cols-3">
							<div class="rounded-xl bg-primary p-4">
								<p class="text-xs text-secondary">Model</p>
								<p class="mt-1 font-semibold text-primary">
									{settings.model === 'qwen3-asr-1.7b' ? 'Qwen3-ASR 1.7B' : settings.model}
								</p>
							</div>
							<div class="rounded-xl bg-primary p-4">
								<p class="text-xs text-secondary">Language</p>
								<p class="mt-1 font-semibold text-primary">{$LL.editor.arabic()}</p>
							</div>
							<div class="rounded-xl bg-primary p-4">
								<p class="text-xs text-secondary">Speaker range</p>
								<p class="mt-1 font-semibold text-primary">
									{settings.minSpeakers ?? '?'}–{settings.maxSpeakers ?? '?'}
								</p>
							</div>
						</div>
						{#if running}
							<div class="rounded-xl border border-color bg-primary p-5">
								<div class="flex items-center gap-3">
									<span class="material-icons animate-spin text-accent-primary">sync</span>
									<div>
										<p class="font-semibold text-primary">Transcription in progress</p>
										<p class="text-xs text-secondary">{runMessage}</p>
									</div>
								</div>
								<div class="mt-4 h-2 overflow-hidden rounded-full bg-secondary">
									<div
										class="h-full bg-[var(--accent-primary)] transition-all"
										style={`width: ${progress ?? 5}%`}
									></div>
								</div>
							</div>
						{:else}
							<button
								type="button"
								class="btn-accent inline-flex cursor-pointer items-center gap-2 rounded-lg px-5 py-3 font-semibold disabled:opacity-50"
								onclick={() => void startTranscription()}
								disabled={!runtimeStatus?.ready || !settings.hfToken.trim() || !audioAvailable}
								><span class="material-icons">auto_awesome</span>Start transcription</button
							>
						{/if}
					</section>
				{:else if currentStep === 3 && result}
					<section class="space-y-6">
						<div>
							<h3 class="text-lg font-bold text-primary">Match detected voices</h3>
							<p class="mt-1 text-sm text-secondary">
								pyannote recognizes recurring voices but not their real names. Assign each detected
								voice before adding the subtitles.
							</p>
						</div>
						<div class="grid gap-3 sm:grid-cols-3">
							<div class="rounded-xl bg-primary p-4">
								<p class="text-xs text-secondary">Subtitle segments</p>
								<p class="mt-1 text-xl font-bold text-primary">{result.segments.length}</p>
							</div>
							<div class="rounded-xl bg-primary p-4">
								<p class="text-xs text-secondary">Detected voices</p>
								<p class="mt-1 text-xl font-bold text-primary">{result.speakers.length}</p>
							</div>
							<div class="rounded-xl bg-primary p-4">
								<p class="text-xs text-secondary">Word timestamps</p>
								<p
									class="mt-1 text-xl font-bold {result.wordTimestampsAvailable
										? 'text-green-400'
										: 'text-yellow-400'}"
								>
									{result.wordTimestampsAvailable ? 'Available' : 'Unavailable'}
								</p>
							</div>
						</div>
						{#if result.alignmentWarning}
							<div
								class="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs leading-relaxed text-yellow-200"
							>
								Word-level alignment was unavailable, so these subtitles use segment timestamps
								only. The transcription and speaker detection were still completed.
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
							{#each result.speakers as speakerId, speakerIndex (speakerId)}
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
													value={speakerMap[speakerId] ?? ''}
													onchange={(event) => (speakerMap[speakerId] = event.currentTarget.value)}
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
				{:else if currentStep === 4 && result}
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
						<div class="grid gap-4 rounded-xl border border-color bg-primary p-5 md:grid-cols-2">
							<AIReasoningControls
								id="transcript-cleanup-reasoning-mode"
								endpoint={globalState.settings!.aiTranslationSettings.textAiApiEndpoint}
								model={globalState.settings!.aiTranslationSettings.advancedTrimModel}
								mode={globalState.settings!.aiTranslationSettings.transcriptCleanupReasoningMode}
								disabled={Boolean(globalState.getSubtitlesEditorState.aiTranscriptCleanup)}
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
									disabled={Boolean(globalState.getSubtitlesEditorState.aiTranscriptCleanup)}
									onchange={() => void saveAITranscriptionSettings()}
								/>
								<p class="text-xs text-secondary">
									{get(LL).editor.transcriptCleanupBatchPreview({
										count:
											globalState.getSubtitlesEditorState.aiTranscriptCleanup?.totalBatches ??
											cleanupBatchCount
									})}
								</p>
							</label>
						</div>
						{#if cleanupRunning || cleanupMessage}
							<div class="rounded-xl border border-color bg-primary p-5">
								<div class="flex items-center gap-3">
									<span
										class={`material-icons ${cleanupRunning ? 'animate-spin text-accent-primary' : cleanupErrors.length > 0 ? 'text-yellow-400' : 'text-green-400'}`}
									>
										{cleanupRunning
											? 'sync'
											: cleanupErrors.length > 0
												? 'warning'
												: 'check_circle'}
									</span>
									<p class="text-sm text-secondary">{cleanupMessage}</p>
								</div>
								{#if streamedCleanupBatches().length > 0}
									<div class="mt-4">
										<AIStreamBatchList
											batches={streamedCleanupBatches()}
											placeholder={get(LL).translations.streamingResponsePlaceholder()}
										/>
									</div>
								{/if}
							</div>
						{/if}
					</section>
				{/if}

				{#if errorMessage}<div
						class="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300"
					>
						<div class="flex items-start gap-2">
							<span class="material-icons text-lg">error</span><span class="whitespace-pre-wrap"
								>{errorMessage}</span
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
					disabled={running || installing || cleanupRunning}>Back</button
				>{/if}
			{#if currentStep < 2}<button
					type="button"
					class="btn-accent cursor-pointer px-4 py-2 text-sm disabled:opacity-40"
					onclick={() => (currentStep += 1)}
					disabled={!canGoNext() || running || installing || cleanupRunning}>Next</button
				>{:else if currentStep === 3 && result}<button
					type="button"
					class="btn-accent inline-flex cursor-pointer items-center gap-2 px-5 py-2 text-sm font-semibold"
					onclick={() => void openTranscriptCleanup()}
					><span class="material-icons text-lg">arrow_forward</span>{get(LL).common.next()}</button
				>{:else if currentStep === 4 && result && !cleanupCompleted}<button
					type="button"
					class="btn-accent inline-flex cursor-pointer items-center gap-2 px-5 py-2 text-sm font-semibold disabled:opacity-50"
					onclick={() =>
						cleanupRunning ? pauseTranscriptCleanup() : void startTranscriptCleanup()}
					disabled={cleanupPauseRequested}
					><span class="material-icons text-lg">{cleanupRunning ? 'pause' : 'auto_fix_high'}</span
					>{cleanupRunning
						? cleanupPauseRequested
							? get(LL).editor.pausingTranscriptCleanup()
							: get(LL).editor.pauseTranscriptCleanup()
						: globalState.getSubtitlesEditorState.aiTranscriptCleanup
							? get(LL).editor.resumeTranscriptCleanup()
							: get(LL).editor.cleanTranscript()}</button
				>{:else if currentStep === 4 && result}<button
					type="button"
					class="btn-accent inline-flex cursor-pointer items-center gap-2 px-5 py-2 text-sm font-semibold"
					onclick={() => void applyResult()}
					><span class="material-icons text-lg">done_all</span>{get(LL).common.done()}</button
				>{/if}
		</div>
	</footer>
</div>
