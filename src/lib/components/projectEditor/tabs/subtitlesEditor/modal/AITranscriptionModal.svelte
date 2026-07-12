<script lang="ts">
	import { listen, type UnlistenFn } from '@tauri-apps/api/event';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import { onDestroy, onMount, tick } from 'svelte';
	import toast from 'svelte-5-french-toast';
	import LL from '$lib/i18n/i18n-svelte';
	import { SubtitleClip } from '$lib/classes';
	import {
		getWhisperLanguageLabel,
		WHISPER_LANGUAGE_OPTIONS
	} from '$lib/constants/whisperLanguages';
	import { globalState } from '$lib/runes/main.svelte';
	import {
		addProjectSpeaker,
		canRemoveProjectSpeaker,
		getVisibleProjectSpeakers,
		requestProjectSpeakerRemoval
	} from '$lib/services/SpeakerLibrary';
	import {
		applyAITranscription,
		buildDefaultSpeakerMap,
		checkAITranscriptionStatus,
		installAITranscriptionRuntime,
		runAITranscription,
		saveAITranscriptionSettings,
		type AITranscriptionResult,
		type AITranscriptionRuntimeStatus,
		type SpeakerNameMap
	} from '$lib/services/AITranscription';

	let { close } = $props<{ close: () => void }>();
	const settings = globalState.settings!.aiTranscriptionSettings;
	const steps = [
		{ label: 'Setup', icon: 'download' },
		{ label: 'Model & speakers', icon: 'tune' },
		{ label: 'Transcribe', icon: 'graphic_eq' },
		{ label: 'Name speakers', icon: 'groups' }
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

	const audioAvailable = $derived(globalState.getAudioTrack.clips.length > 0);
	const existingSubtitleCount = $derived(
		globalState.getSubtitleTrack.clips.filter((clip) => clip instanceof SubtitleClip).length
	);
	const existingSpeakerNames = $derived(() => getVisibleProjectSpeakers());

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
			result = await runAITranscription(settings);
			speakerMap = buildDefaultSpeakerMap(result);
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
		const count = applyAITranscription(result, speakerMap, settings.replaceExisting);
		await saveAITranscriptionSettings();
		toast.success(`Applied ${count} transcript segments with word timestamps.`);
		close();
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
		if (!running && !installing) close();
	}

	onMount(() => void refreshRuntime());
	onDestroy(() => {
		statusUnlisten?.();
		installUnlisten?.();
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
			disabled={running || installing}
			aria-label={$LL.common.close()}
		>
			<span class="material-icons">close</span>
		</button>
	</header>

	<div class="flex min-h-0 flex-1">
		<aside class="w-56 shrink-0 border-r border-color bg-primary/60 p-4">
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
		</aside>

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
										{runtimeStatus?.ready ? 'WhisperX is ready' : 'WhisperX runtime required'}
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
								Choose the quality, language and expected number of distinct voices.
							</p>
						</div>
						<div class="grid gap-5 md:grid-cols-2">
							<label class="space-y-2"
								><span class="text-sm font-semibold text-primary">Whisper model</span><select
									class="w-full rounded-lg border border-color bg-primary px-3 py-2.5 text-primary"
									bind:value={settings.model}
									><option value="small">Small — fastest</option><option value="medium"
										>Medium — recommended</option
									><option value="large-v3">Large v3 — highest quality</option><option
										value="large-v3-turbo">Large v3 Turbo</option
									></select
								></label
							>
							<label class="space-y-2"
								><span class="text-sm font-semibold text-primary">Language</span><select
									class="w-full rounded-lg border border-color bg-primary px-3 py-2.5 text-primary"
									bind:value={settings.language}
									>{#each WHISPER_LANGUAGE_OPTIONS as option (option.code)}<option
											value={option.code}>{option.label}</option
										>{/each}</select
								></label
							>
							<label class="space-y-2 md:col-span-2"
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
							<h4 class="font-semibold text-primary">Subtitle sizing</h4>
							<div class="mt-4 grid gap-4 md:grid-cols-2">
								<label class="space-y-2"
									><span class="text-xs text-secondary">Maximum words per segment</span><input
										type="number"
										min="2"
										max="80"
										class="w-full rounded-lg border border-color bg-secondary px-3 py-2 text-primary"
										bind:value={settings.maxWordsPerSegment}
									/></label
								><label class="space-y-2"
									><span class="text-xs text-secondary">Maximum characters per segment</span><input
										type="number"
										min="20"
										max="500"
										class="w-full rounded-lg border border-color bg-secondary px-3 py-2 text-primary"
										bind:value={settings.maxCharsPerSegment}
									/></label
								>
							</div>
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
								<p class="mt-1 font-semibold text-primary">{settings.model}</p>
							</div>
							<div class="rounded-xl bg-primary p-4">
								<p class="text-xs text-secondary">Language</p>
								<p class="mt-1 font-semibold text-primary">
									{getWhisperLanguageLabel(settings.language)}
								</p>
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
			All processing stays local except model downloads from Hugging Face.
		</p>
		<div class="flex items-center gap-2">
			{#if currentStep > 0}<button
					type="button"
					class="btn cursor-pointer px-4 py-2 text-sm disabled:opacity-40"
					onclick={() => (currentStep -= 1)}
					disabled={running || installing}>Back</button
				>{/if}
			{#if currentStep < 2}<button
					type="button"
					class="btn-accent cursor-pointer px-4 py-2 text-sm disabled:opacity-40"
					onclick={() => (currentStep += 1)}
					disabled={!canGoNext() || running || installing}>Next</button
				>{:else if currentStep === 3 && result}<button
					type="button"
					class="btn-accent inline-flex cursor-pointer items-center gap-2 px-5 py-2 text-sm font-semibold"
					onclick={() => void applyResult()}
					><span class="material-icons text-lg">done_all</span>Apply transcription</button
				>{/if}
		</div>
	</footer>
</div>
