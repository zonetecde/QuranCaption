<script lang="ts">
	import { slide } from 'svelte/transition';
	import { Quran } from '$lib/classes/Quran';
	import Settings, { type AutoSegmentationSettings } from '$lib/classes/Settings.svelte';
	import ModalManager from '$lib/components/modals/ModalManager';
	import { globalState } from '$lib/runes/main.svelte';
	import { onMount } from 'svelte';
	import { listen, type UnlistenFn } from '@tauri-apps/api/event';
	import {
		getAutoSegmentationAudioInfo,
		runAutoSegmentation,
		checkLocalSegmentationStatus,
		installLocalSegmentationDeps,
		type AutoSegmentationResult,
		type LocalAsrMode,
		type LegacyWhisperModelSize,
		type MultiAlignerModel,
		type SegmentationDevice,
		type SegmentationMode,
		type LocalSegmentationStatus
	} from '$lib/services/AutoSegmentation';
	import { AnalyticsService } from '$lib/services/AnalyticsService';

	let { close } = $props();

	let isRunning = $state(false);
	let result: AutoSegmentationResult | null = $state(null);
	let errorMessage = $state<string | null>(null);
	let fallbackMessage = $state<string | null>(null);
	let cloudCpuFallbackMessage = $state<string | null>(null);
	let warningMessage = $state<string | null>(null);

	// Mode selection state
	let selectedMode = $state<SegmentationMode>('api');
	let localAsrMode = $state<LocalAsrMode>('legacy_whisper');
	let legacyWhisperModel = $state<LegacyWhisperModelSize>('base');
	let multiAlignerModel = $state<MultiAlignerModel>('Base');
	let cloudModel = $state<MultiAlignerModel>('Base');
	let device = $state<SegmentationDevice>('GPU');
	let hfToken = $state('');

	let localStatus = $state<LocalSegmentationStatus | null>(null);
	let isCheckingStatus = $state(true);
	let isInstallingDeps = $state(false);
	let installingEngine = $state<'legacy' | 'multi' | null>(null);
	let currentStatus = $state<string>('');
	let installStatus = $state<string>('');

	// Advanced settings state
	let showAdvancedSettings = $state(false);
	let minSilenceMs = $state(200);
	let minSpeechMs = $state(1000);
	let padMs = $state(100);

	// Fill gaps by silence option
	let fillBySilence = $state(true);
	let extendBeforeSilence = $state(false);
	let extendBeforeSilenceMs = $state(50);

	type SegmentationPreset = {
		id: string;
		label: string;
		minSilenceMs: number;
		minSpeechMs: number;
		padMs: number;
	};

	const segmentationPresets: SegmentationPreset[] = [
		{
			id: 'mujawwad',
			label: 'Mujawwad (Slow)',
			minSilenceMs: 600,
			minSpeechMs: 1500,
			padMs: 300
		},
		{
			id: 'murattal',
			label: 'Murattal (Normal)',
			minSilenceMs: 200,
			minSpeechMs: 1000,
			padMs: 100
		},
		{
			id: 'hadr',
			label: 'Hadr (Fast)',
			minSilenceMs: 75,
			minSpeechMs: 750,
			padMs: 40
		}
	];

	const legacyModelOptions: Array<{
		value: LegacyWhisperModelSize;
		label: string;
		description: string;
		source: string;
	}> = [
		{
			value: 'tiny' as const,
			label: 'Tiny',
			description: 'Fastest, less accurate (~60 MB)',
			source: 'tarteel-ai/whisper-tiny-ar-quran'
		},
		{
			value: 'base' as const,
			label: 'Base (recommended)',
			description: 'Balanced speed/accuracy (~150 MB)',
			source: 'tarteel-ai/whisper-base-ar-quran'
		},
		{
			value: 'medium' as const,
			label: 'Medium',
			description: 'Very accurate, slower (~800 MB)',
			source: 'openai/whisper-medium'
		},
		{
			value: 'large' as const,
			label: 'Large',
			description: 'Most accurate, slowest (~3 GB)',
			source: 'IJyad/whisper-large-v3-Tarteel'
		}
	];

	const multiAlignerModelOptions: Array<{
		value: MultiAlignerModel;
		label: string;
		description: string;
	}> = [
		{
			value: 'Base',
			label: 'Base',
			description: 'Balanced speed/accuracy'
		},
		{
			value: 'Large',
			label: 'Large',
			description: 'Higher accuracy, slower'
		}
	];

	const audioInfo = $derived(() => getAutoSegmentationAudioInfo());
	const hasAudio = $derived(() => !!audioInfo());
	const savedSettings = $derived(() => globalState.settings?.autoSegmentationSettings);
	const legacyEngineStatus = $derived(() => localStatus?.engines?.legacy ?? null);
	const multiEngineStatus = $derived(() => localStatus?.engines?.multi ?? null);
	const selectedEngineStatus = $derived(() =>
		localAsrMode === 'legacy_whisper' ? legacyEngineStatus() : multiEngineStatus()
	);
	const isLegacyLocalSelected = $derived(
		() => selectedMode === 'local' && localAsrMode === 'legacy_whisper'
	);

	$effect(() => {
		const persisted = savedSettings();
		if (!persisted) return;

		minSilenceMs = persisted.minSilenceMs;
		minSpeechMs = persisted.minSpeechMs;
		padMs = persisted.padMs;
		selectedMode = persisted.mode;
		localAsrMode = persisted.localAsrMode;
		legacyWhisperModel = persisted.legacyWhisperModel;
		multiAlignerModel = persisted.multiAlignerModel;
		cloudModel = persisted.cloudModel;
		device = persisted.device;
		hfToken = persisted.hfToken ?? '';
		fillBySilence = persisted.fillBySilence ?? true;
		extendBeforeSilence = persisted.extendBeforeSilence ?? false;
		extendBeforeSilenceMs = persisted.extendBeforeSilenceMs ?? 50;
	});

	onMount(async () => {
		await refreshLocalStatus();
	});

	async function refreshLocalStatus(): Promise<void> {
		isCheckingStatus = true;
		try {
			localStatus = await checkLocalSegmentationStatus(hfToken);
		} catch {
			localStatus = null;
		} finally {
			isCheckingStatus = false;
		}
	}

	function persistAutoSegmentationSettings(next: Partial<AutoSegmentationSettings>): void {
		if (!globalState.settings) return;
		Object.assign(globalState.settings.autoSegmentationSettings, next);
		void Settings.save();
	}

	function persistTimingSettings(): void {
		persistAutoSegmentationSettings({ minSilenceMs, minSpeechMs, padMs });
	}

	function persistModeSettings(): void {
		persistAutoSegmentationSettings({ mode: selectedMode });
	}

	function persistAsrModeSettings(): void {
		persistAutoSegmentationSettings({ localAsrMode });
	}

	function persistModelSettings(): void {
		persistAutoSegmentationSettings({
			legacyWhisperModel,
			multiAlignerModel,
			cloudModel
		});
	}

	function persistDeviceSettings(): void {
		persistAutoSegmentationSettings({ device });
	}

	function persistTokenSettings(): void {
		persistAutoSegmentationSettings({ hfToken });
	}

	function persistFillBySilenceSettings(): void {
		persistAutoSegmentationSettings({ fillBySilence });
	}

	function persistExtendBeforeSilenceSettings(): void {
		persistAutoSegmentationSettings({ extendBeforeSilence });
	}

	function persistExtendBeforeSilenceMsSettings(): void {
		persistAutoSegmentationSettings({ extendBeforeSilenceMs });
	}

	function applyPreset(preset: SegmentationPreset): void {
		minSilenceMs = preset.minSilenceMs;
		minSpeechMs = preset.minSpeechMs;
		padMs = preset.padMs;
		persistTimingSettings();
	}

	function isPresetActive(preset: SegmentationPreset): boolean {
		return (
			minSilenceMs === preset.minSilenceMs &&
			minSpeechMs === preset.minSpeechMs &&
			padMs === preset.padMs
		);
	}

	async function promptHFToken(): Promise<void> {
		const nextToken = await ModalManager.inputModal(
			'Enter your Hugging Face token for local Multi-Aligner',
			hfToken,
			256,
			'hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
		);
		const normalized = nextToken.trim();
		if (normalized === hfToken) return;

		hfToken = normalized;
		persistTokenSettings();
		await refreshLocalStatus();
	}

	async function clearHFToken(): Promise<void> {
		hfToken = '';
		persistTokenSettings();
		await refreshLocalStatus();
	}

	function maskToken(token: string): string {
		if (!token) return 'Not configured';
		if (token.length <= 10) return token;
		return `${token.slice(0, 6)}...${token.slice(-4)}`;
	}

	async function handleInstallDeps(engine: 'legacy' | 'multi') {
		if (isInstallingDeps) return;
		isInstallingDeps = true;
		installingEngine = engine;
		errorMessage = null;
		installStatus = `Preparing ${engine === 'legacy' ? 'Legacy Whisper' : 'Multi-Aligner'}...`;

		const unlisten = await listen<{ message: string }>('install-status', (event) => {
			installStatus = event.payload.message;
		});

		try {
			await installLocalSegmentationDeps(engine, engine === 'multi' ? hfToken : undefined);
			await refreshLocalStatus();
		} catch (error) {
			const installErrorMessage = error instanceof Error ? error.message : String(error);
			errorMessage = `Failed to install ${engine} dependencies: ${installErrorMessage}`;
			AnalyticsService.track('local_segmentation_dependencies_install_failed', {
				feature: 'segmentation',
				mode: 'local',
				engine,
				error_message: installErrorMessage,
				python_installed: localStatus?.pythonInstalled,
				legacy_ready: legacyEngineStatus()?.ready,
				multi_ready: multiEngineStatus()?.ready
			});
		} finally {
			isInstallingDeps = false;
			installingEngine = null;
			installStatus = '';
			unlisten();
		}
	}

	function formatVerseRange(resultData: AutoSegmentationResult | null): string {
		if (
			!resultData ||
			resultData.status !== 'completed' ||
			resultData.verseRange.parts.length === 0
		) {
			return 'No verse range detected.';
		}

		return resultData.verseRange.parts
			.map((part) => {
				const surahName =
					Quran.getSurahsNames()[part.surah - 1]?.transliteration || `Surah ${part.surah}`;
				const verseRange =
					part.verseStart === part.verseEnd
						? `${part.verseStart}`
						: `${part.verseStart}-${part.verseEnd}`;
				return `Surah ${surahName}: ${verseRange}`;
			})
			.join(', ');
	}

	function getSelectedModelForAnalytics(): string {
		if (selectedMode === 'api') return cloudModel;
		return localAsrMode === 'legacy_whisper' ? legacyWhisperModel : multiAlignerModel;
	}

	function getDeviceForAnalytics(): string {
		if (selectedMode === 'local' && localAsrMode === 'legacy_whisper') {
			return 'AUTO';
		}
		return device;
	}

	function getAsrModeForAnalytics(): string {
		if (selectedMode === 'api') return 'cloud_v2';
		return localAsrMode;
	}

	async function startSegmentation() {
		if (isRunning || !hasAudio()) return;

		if (selectedMode === 'local' && localAsrMode === 'multi_aligner' && !hfToken) {
			await promptHFToken();
		}

		isRunning = true;
		errorMessage = null;
		result = null;
		fallbackMessage = null;
		cloudCpuFallbackMessage = null;
		warningMessage = null;
		currentStatus = '';
		let response: AutoSegmentationResult | null = null;

		let unlisten: UnlistenFn | null = null;
		if (selectedMode === 'local') {
			unlisten = await listen<{ step: string; message: string }>('segmentation-status', (event) => {
				currentStatus = event.payload.message;
			});
		}

		try {
			response = await runAutoSegmentation(
				{
					minSilenceMs,
					minSpeechMs,
					padMs,
					localAsrMode,
					legacyWhisperModel,
					multiAlignerModel,
					cloudModel,
					device,
					hfToken,
					allowCloudFallback: true,
					fillBySilence,
					extendBeforeSilence,
					extendBeforeSilenceMs
				},
				selectedMode
			);
			if (!response) {
				errorMessage = 'Segmentation failed. Please check the console for details.';
			} else if (response.status === 'cancelled') {
				errorMessage = 'Segmentation canceled.';
			} else if (response.status === 'failed') {
				errorMessage = response.message;
			} else {
				result = response;
				if (response.fallbackToCloud) {
					fallbackMessage =
						'Local processing failed, automatically switched to Cloud v2.';
				}
				if (response.cloudGpuFallbackToCpu) {
					cloudCpuFallbackMessage =
						'Cloud GPU failed during this run. Automatically retried on Cloud CPU.';
				}
				warningMessage = response.warning ?? null;
			}
		} finally {
			const completedResponse = response?.status === 'completed' ? response : null;
			const verseRangeValue = completedResponse
				? completedResponse.verseRange.parts
						.map((part) => `${part.surah}:${part.verseStart}-${part.verseEnd}`)
						.join(', ')
				: undefined;

			AnalyticsService.trackAIUsage('segmentation', {
				status: response?.status ?? 'unknown',
				range: verseRangeValue,
				provider: selectedMode === 'api' ? 'cloud_v2' : localAsrMode,
				requested_mode: selectedMode,
				effective_mode: completedResponse?.effectiveMode ?? selectedMode,
				asr_mode: getAsrModeForAnalytics(),
				model: getSelectedModelForAnalytics(),
				device: getDeviceForAnalytics(),
				fallback_to_cloud: completedResponse?.fallbackToCloud ?? false,
				cloud_warning_present: !!completedResponse?.warning,
				min_silence_ms: minSilenceMs,
				min_speech_ms: minSpeechMs,
				pad_ms: padMs,
				fill_by_silence: fillBySilence,
				extend_before_silence: extendBeforeSilence,
				extend_before_silence_ms: extendBeforeSilenceMs,
				mode: selectedMode,
				hf_token_set: hfToken.trim().length > 0,
				audio_filename:
					(audioInfo()?.clipCount || 0) > 1
						? `${audioInfo()?.fileName} (+${audioInfo()!.clipCount - 1} more)`
						: audioInfo()?.fileName,
				segments_applied: completedResponse?.segmentsApplied,
				low_confidence_segments: completedResponse?.lowConfidenceSegments,
				coverage_gap_segments: completedResponse?.coverageGapSegments,
				error_message: response?.status === 'failed' ? response.message : undefined
			});

			isRunning = false;
			currentStatus = '';
			if (unlisten) unlisten();
		}
	}
</script>

<div
	class="bg-secondary border-color border rounded-2xl w-[760px] max-w-[92vw] max-h-[90vh] shadow-2xl shadow-black flex flex-col relative overflow-hidden"
	transition:slide
>
	<!-- Header -->
	<div class="bg-gradient-to-r from-accent to-bg-accent px-6 py-4 border-b border-color">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3">
				<div class="w-8 h-8 bg-accent-primary rounded-full flex items-center justify-center">
					<span class="material-icons text-black text-lg">graphic_eq</span>
				</div>
				<div>
					<h2 class="text-xl font-bold text-primary">Auto Segmentation</h2>
					<p class="text-sm text-thirdly">Quran Multi-Aligner v2 (Cloud + Local)</p>
				</div>
			</div>

			<button
				class="w-8 h-8 rounded-full hover:bg-[rgba(255,255,255,0.1)] flex items-center justify-center transition-all duration-200 text-secondary hover:text-primary cursor-pointer"
				onclick={close}
			>
				<span class="material-icons text-lg">close</span>
			</button>
		</div>
	</div>

	<!-- Body -->
	<div class="px-6 py-5 space-y-4 flex-1 min-h-0 overflow-y-auto">
		<!-- Body -->
		{#if !showAdvancedSettings}
			<div class="bg-accent border border-color rounded-xl p-4 space-y-3" transition:slide>
				<div class="space-y-2">
					<p class="text-sm text-secondary leading-relaxed">
						This will analyze <span class="text-primary font-medium">all audio clips</span> in your timeline
						and automatically generate subtitle clips from them.
					</p>

					<ul class="text-sm text-secondary leading-relaxed list-disc pl-5 space-y-1">
						<li>
							Existing subtitles will be <span class="text-primary font-medium">replaced</span>.
						</li>
						<li>
							Each generated segment includes a confidence score. Anything <span
								class="text-primary font-medium">below 0.75</span
							> will be highlighted in yellow and should be reviewed.
						</li>
						<li>
							Segments that appear to skip words or verses are highlighted in violet and should be
							reviewed.
						</li>
					</ul>
				</div>

				<div class="flex items-center gap-2 text-xs text-thirdly">
					<span class="material-icons text-sm mt-0.5">info</span>
					<span>
						Audio source:
						{#if hasAudio()}
							<span class="text-primary font-medium">
								{audioInfo()?.fileName}
								{#if (audioInfo()?.clipCount || 0) > 1}
									<span class="text-thirdly"> (+{audioInfo()!.clipCount - 1} more)</span>
								{/if}
							</span>
						{:else}
							<span class="text-danger-color font-medium">No audio clip found</span>
						{/if}
					</span>
				</div>
			</div>
		{/if}

		<!-- Processing Mode Selection -->
		<div class="bg-accent border border-color rounded-xl p-4 space-y-3">
			<div class="text-sm text-primary font-medium">Processing Mode</div>

			<div class="space-y-2">
				<label
					class="flex items-start gap-3 p-2 rounded-lg hover:bg-[rgba(255,255,255,0.05)] cursor-pointer transition-colors"
				>
					<input
						type="radio"
						name="mode"
						value="api"
						bind:group={selectedMode}
						onchange={persistModeSettings}
						class="mt-0.5 accent-accent-primary"
					/>
					<div class="flex-1">
						<div class="text-sm text-primary font-medium">Cloud v2 (Quran Multi-Aligner)</div>
						<div class="text-xs text-thirdly">Always uses the new cloud API</div>
					</div>
					<span class="material-icons text-accent-primary text-lg">cloud</span>
				</label>

				<label
					class="flex items-start gap-3 p-2 rounded-lg hover:bg-[rgba(255,255,255,0.05)] cursor-pointer transition-colors"
				>
					<input
						type="radio"
						name="mode"
						value="local"
						bind:group={selectedMode}
						onchange={persistModeSettings}
						class="mt-0.5 accent-accent-primary"
					/>
					<div class="flex-1">
						<div class="text-sm text-primary font-medium flex items-center gap-2">
							Local Processing
							{#if localStatus?.ready}
								<span class="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">Ready</span>
							{:else}
								<span class="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full">Setup / token may be needed</span>
							{/if}
						</div>
						<div class="text-xs text-thirdly">Supports Legacy Whisper and Multi-Aligner engines</div>
					</div>
					<span class="material-icons text-accent-primary text-lg">computer</span>
				</label>
			</div>
		</div>

		<div class="bg-accent border border-color rounded-xl p-4 space-y-4">
			<div class="text-sm text-primary font-medium">Model Options</div>

			{#if selectedMode === 'local'}
				<div class="space-y-2">
					<div class="text-xs text-thirdly font-medium uppercase">ASR Mode</div>
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
						<label
							class="flex items-start gap-2 p-2 rounded-lg hover:bg-[rgba(255,255,255,0.05)] cursor-pointer transition-colors border border-transparent"
							class:border-accent-primary={localAsrMode === 'legacy_whisper'}
						>
							<input
								type="radio"
								name="asr-mode"
								value="legacy_whisper"
								bind:group={localAsrMode}
								onchange={persistAsrModeSettings}
								class="mt-0.5 accent-accent-primary"
							/>
							<div>
								<div class="text-sm text-primary font-medium">Legacy Whisper</div>
								<div class="text-xs text-thirdly">Compatible local engine with 4 Whisper models</div>
							</div>
						</label>

						<label
							class="flex items-start gap-2 p-2 rounded-lg hover:bg-[rgba(255,255,255,0.05)] cursor-pointer transition-colors border border-transparent"
							class:border-accent-primary={localAsrMode === 'multi_aligner'}
						>
							<input
								type="radio"
								name="asr-mode"
								value="multi_aligner"
								bind:group={localAsrMode}
								onchange={persistAsrModeSettings}
								class="mt-0.5 accent-accent-primary"
							/>
							<div>
								<div class="text-sm text-primary font-medium">Multi-Aligner</div>
								<div class="text-xs text-thirdly">New local engine (HF token required)</div>
							</div>
						</label>
					</div>
				</div>
			{/if}

			<div class="space-y-2 pt-2 border-t border-color">
				<div class="text-xs text-thirdly font-medium uppercase">Model</div>

				{#if selectedMode === 'api'}
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
						{#each multiAlignerModelOptions as option}
							<label
								class="flex items-start gap-2 p-2 rounded-lg hover:bg-[rgba(255,255,255,0.05)] cursor-pointer transition-colors border border-transparent"
								class:border-accent-primary={cloudModel === option.value}
							>
								<input
									type="radio"
									name="cloud-model"
									value={option.value}
									bind:group={cloudModel}
									onchange={persistModelSettings}
									class="mt-0.5 accent-accent-primary"
								/>
								<div>
									<div class="text-sm text-primary font-medium">{option.label}</div>
									<div class="text-xs text-thirdly">{option.description}</div>
								</div>
							</label>
						{/each}
					</div>
				{:else if localAsrMode === 'legacy_whisper'}
					<div class="space-y-2">
						{#each legacyModelOptions as option}
							<label
								class="flex items-start gap-3 p-2 rounded-lg hover:bg-[rgba(255,255,255,0.05)] cursor-pointer transition-colors border border-transparent"
								class:border-accent-primary={legacyWhisperModel === option.value}
							>
								<input
									type="radio"
									name="legacy-model"
									value={option.value}
									bind:group={legacyWhisperModel}
									onchange={persistModelSettings}
									class="mt-0.5 accent-accent-primary"
								/>
								<div class="flex-1">
									<div class="flex items-center gap-2">
										<span class="text-sm text-primary font-medium">{option.label}</span>
										<span
											class="text-[10px] bg-secondary/10 px-1.5 py-0.5 rounded text-secondary/70 font-mono border border-[var(--text-secondary)]/10 truncate max-w-[220px]"
											title="HuggingFace model: {option.source}"
										>
											{option.source}
										</span>
									</div>
									<div class="text-xs text-thirdly">{option.description}</div>
								</div>
							</label>
						{/each}
					</div>
				{:else}
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
						{#each multiAlignerModelOptions as option}
							<label
								class="flex items-start gap-2 p-2 rounded-lg hover:bg-[rgba(255,255,255,0.05)] cursor-pointer transition-colors border border-transparent"
								class:border-accent-primary={multiAlignerModel === option.value}
							>
								<input
									type="radio"
									name="multi-model"
									value={option.value}
									bind:group={multiAlignerModel}
									onchange={persistModelSettings}
									class="mt-0.5 accent-accent-primary"
								/>
								<div>
									<div class="text-sm text-primary font-medium">{option.label}</div>
									<div class="text-xs text-thirdly">{option.description}</div>
								</div>
							</label>
						{/each}
					</div>
				{/if}
			</div>

			<div class="space-y-2 pt-2 border-t border-color">
				<div class="text-xs text-thirdly font-medium uppercase">Device</div>
				<div class="grid grid-cols-2 gap-2">
					<label
						class="flex items-center gap-2 p-2 rounded-lg border border-transparent"
						class:border-accent-primary={device === 'GPU'}
						class:opacity-60={isLegacyLocalSelected()}
					>
						<input
							type="radio"
							name="device"
							value="GPU"
							bind:group={device}
							onchange={persistDeviceSettings}
							disabled={isLegacyLocalSelected()}
							class="accent-accent-primary"
						/>
						<div class="text-sm text-primary">GPU</div>
					</label>
					<label
						class="flex items-center gap-2 p-2 rounded-lg border border-transparent"
						class:border-accent-primary={device === 'CPU'}
						class:opacity-60={isLegacyLocalSelected()}
					>
						<input
							type="radio"
							name="device"
							value="CPU"
							bind:group={device}
							onchange={persistDeviceSettings}
							disabled={isLegacyLocalSelected()}
							class="accent-accent-primary"
						/>
						<div class="text-sm text-primary">CPU</div>
					</label>
				</div>
				{#if isLegacyLocalSelected()}
					<div class="text-xs text-thirdly">Legacy Whisper local mode auto-detects device.</div>
				{/if}
			</div>

			{#if selectedMode === 'local' && localAsrMode === 'multi_aligner'}
				<div class="space-y-2 pt-2 border-t border-color">
					<div class="flex items-center justify-between">
						<div>
							<div class="text-xs text-thirdly font-medium uppercase">Hugging Face Token</div>
							<div class="text-sm text-secondary">Required for local Multi-Aligner model access.</div>
						</div>
						<div class="text-xs text-primary font-mono">{maskToken(hfToken)}</div>
					</div>
					<div class="flex gap-2">
						<button class="btn-accent px-3 py-1.5 text-xs" onclick={() => void promptHFToken()}>
							{hfToken ? 'Update token' : 'Set token'}
						</button>
						<button
							class="btn px-3 py-1.5 text-xs"
							onclick={() => void clearHFToken()}
							disabled={!hfToken}
						>
							Clear token
						</button>
					</div>
				</div>
			{/if}
		</div>

		<div class="bg-accent border border-color rounded-xl p-4 space-y-3">
			<div class="text-sm text-primary font-medium">Local Engine Setup</div>

			{#if isCheckingStatus}
				<div class="flex items-center gap-2 text-sm text-secondary">
					<div class="w-4 h-4 border-2 border-accent-primary border-t-transparent rounded-full animate-spin"></div>
					Checking local engine status...
				</div>
			{:else if !localStatus}
				<div class="text-sm text-secondary">Local status unavailable. Cloud mode remains available.</div>
			{:else if !localStatus.pythonInstalled}
				<div class="flex items-start gap-3 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
					<span class="material-icons text-red-400">warning</span>
					<div>
						<div class="text-sm text-primary">Python is required for local mode</div>
						<div class="text-xs text-thirdly">
							Install Python 3.10+ from
							<a href="https://python.org" target="_blank" class="text-accent-primary underline">python.org</a>
						</div>
					</div>
				</div>
			{:else}
				<div class="space-y-2">
					<div class="flex items-center justify-between gap-3 rounded-lg border border-color p-2">
						<div>
							<div class="text-sm text-primary font-medium">Legacy Whisper</div>
							<div class="text-xs text-thirdly">{legacyEngineStatus()?.message || 'Status unavailable'}</div>
						</div>
						<div class="flex items-center gap-2">
							<span
								class={`text-xs px-2 py-0.5 rounded-full ${legacyEngineStatus()?.usable ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}`}
							>
								{legacyEngineStatus()?.usable ? 'Ready' : 'Needs install'}
							</span>
							<button
								class="btn px-3 py-1.5 text-xs"
								onclick={() => void handleInstallDeps('legacy')}
								disabled={isInstallingDeps || !!legacyEngineStatus()?.ready}
							>
								{#if isInstallingDeps && installingEngine === 'legacy'}
									Installing...
								{:else if legacyEngineStatus()?.ready}
									Installed
								{:else}
									Install
								{/if}
							</button>
						</div>
					</div>

					<div class="flex items-center justify-between gap-3 rounded-lg border border-color p-2">
						<div>
							<div class="text-sm text-primary font-medium">Multi-Aligner</div>
							<div class="text-xs text-thirdly">{multiEngineStatus()?.message || 'Status unavailable'}</div>
						</div>
						<div class="flex items-center gap-2">
							<span
								class={`text-xs px-2 py-0.5 rounded-full ${multiEngineStatus()?.usable ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}`}
							>
								{#if multiEngineStatus()?.usable}
									Ready
								{:else if multiEngineStatus()?.ready && !multiEngineStatus()?.tokenProvided}
									Token needed
								{:else}
									Needs install
								{/if}
							</span>
							<button
								class="btn px-3 py-1.5 text-xs"
								onclick={() => void handleInstallDeps('multi')}
								disabled={isInstallingDeps || !!multiEngineStatus()?.ready}
							>
								{#if isInstallingDeps && installingEngine === 'multi'}
									Installing...
								{:else if multiEngineStatus()?.ready}
									Installed
								{:else}
									Install
								{/if}
							</button>
						</div>
					</div>
				</div>

				<div class="text-xs text-thirdly">{localStatus.message}</div>
			{/if}

			{#if isInstallingDeps}
				<div class="flex items-center gap-2 text-xs text-secondary bg-secondary/20 rounded-lg p-2">
					<div class="w-3 h-3 border-2 border-accent-primary border-t-transparent rounded-full animate-spin"></div>
					{installStatus || 'Installing dependencies...'}
				</div>
			{/if}
		</div>

		<!-- Advanced Settings (Collapsible) -->
		<div
			class="bg-accent border border-color rounded-xl overflow-hidden overflow-y-auto max-h-[200px] xl:max-h-[400px]"
		>
			<button
				class="w-full px-4 py-3 flex items-center justify-between hover:bg-[rgba(255,255,255,0.03)] transition-colors"
				onclick={() => (showAdvancedSettings = !showAdvancedSettings)}
			>
				<div class="flex items-center gap-2 text-sm text-primary font-medium">
					<span class="material-icons text-base"
						>{showAdvancedSettings ? 'expand_less' : 'expand_more'}</span
					>
					Advanced Settings
				</div>
				<span class="text-xs text-thirdly">
					{showAdvancedSettings ? 'Hide' : 'Show'}
				</span>
			</button>

			{#if showAdvancedSettings}
				<div class="px-4 pb-4 space-y-4 border-t border-color" transition:slide={{ duration: 200 }}>
					<div class="pt-3 space-y-3">
						<div class="text-xs text-thirdly font-medium uppercase">Presets</div>
						<div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
							{#each segmentationPresets as preset}
								<button
									class="px-3 py-2 rounded-lg text-xs border transition-colors"
									class:border-accent-primary={isPresetActive(preset)}
									class:bg-[rgba(0,200,255,0.1)]={isPresetActive(preset)}
									class:text-primary={isPresetActive(preset)}
									class:border-color={!isPresetActive(preset)}
									class:text-secondary={!isPresetActive(preset)}
									onclick={() => applyPreset(preset)}
								>
									{preset.label}
								</button>
							{/each}
						</div>
					</div>

					<!-- Timing Parameters -->
					<div class="pt-3 space-y-3 border-t border-color">
						<div class="text-xs text-thirdly font-medium uppercase">Timing Parameters</div>

						<!-- Min Silence -->
						<div>
							<div class="flex items-center justify-between mb-1">
								<div class="text-sm text-secondary">
									Min Silence Duration
									<span class="text-xs text-thirdly">(default: 200ms)</span>
								</div>
								<span class="text-xs text-primary font-mono">{minSilenceMs} ms</span>
							</div>
							<input
								type="range"
								min="50"
								max="1200"
								step="25"
								bind:value={minSilenceMs}
								onchange={persistTimingSettings}
								class="w-full accent-accent-primary"
							/>
							<p class="text-xs text-thirdly mt-1">Minimum pause between segments</p>
						</div>

						<!-- Min Speech -->
						<div>
							<div class="flex items-center justify-between mb-1">
								<div class="text-sm text-secondary">
									Min Speech Duration
									<span class="text-xs text-thirdly">(default: 1000ms)</span>
								</div>
								<span class="text-xs text-primary font-mono">{minSpeechMs} ms</span>
							</div>
							<input
								type="range"
								min="500"
								max="3000"
								step="50"
								bind:value={minSpeechMs}
								onchange={persistTimingSettings}
								class="w-full accent-accent-primary"
							/>
							<p class="text-xs text-thirdly mt-1">Minimum segment length to keep</p>
						</div>

						<!-- Padding -->
						<div>
							<div class="flex items-center justify-between mb-1">
								<div class="text-sm text-secondary">
									Padding <span class="text-xs text-thirdly">(default: 100ms)</span>
								</div>
								<span class="text-xs text-primary font-mono">{padMs} ms</span>
							</div>
							<input
								type="range"
								min="0"
								max="500"
								step="10"
								bind:value={padMs}
								onchange={persistTimingSettings}
								class="w-full accent-accent-primary"
							/>
							<p class="text-xs text-thirdly mt-1">Extra time added before/after each segment</p>
						</div>
					</div>

					<!-- Fill by Silence Option -->
					<div class="pt-3 border-t border-color">
						<label class="flex items-start gap-3 cursor-pointer">
							<input
								type="checkbox"
								bind:checked={fillBySilence}
								onchange={persistFillBySilenceSettings}
								class="accent-accent-primary mt-0.5 w-4 h-4"
							/>
							<div class="flex-1">
								<div class="text-sm text-primary font-medium">Fill gaps with silence clips</div>
								<p class="text-xs text-thirdly mt-0.5">
									When enabled, gaps between subtitles are filled with explicit silence clips. When
									disabled, each subtitle is extended to meet the next one.
								</p>
							</div>
						</label>
						{#if fillBySilence}
							<label class="mt-3 flex items-center gap-2 text-xs text-secondary cursor-pointer">
								<input
									type="checkbox"
									bind:checked={extendBeforeSilence}
									onchange={persistExtendBeforeSilenceSettings}
									class="accent-accent-primary w-4 h-4"
								/>
								<span>Add</span>
								<input
									type="number"
									min="0"
									max="2000"
									step="10"
									bind:value={extendBeforeSilenceMs}
									onchange={persistExtendBeforeSilenceMsSettings}
									disabled={!extendBeforeSilence}
									class="w-20 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1 text-xs text-primary focus:outline-none focus:border-[var(--accent-primary)] disabled:opacity-60"
								/>
								<span>ms to each subtitle before silence</span>
							</label>
						{/if}
					</div>

				</div>
			{/if}
		</div>

		{#if isRunning}
			<div class="flex items-center gap-3 bg-accent border border-color rounded-xl px-4 py-3">
				<div
					class="w-6 h-6 border-2 border-accent-primary border-t-transparent rounded-full animate-spin"
				></div>
				<div class="text-sm text-secondary">
					{#if currentStatus}
						{currentStatus}
					{:else if selectedMode === 'api'}
						Sending audio to Cloud v2...
					{:else}
						Starting local processing...
					{/if}
				</div>
			</div>
		{:else if result && result.status === 'completed'}
			<div class="bg-accent border border-color rounded-xl px-4 py-3 space-y-2">
				<div class="flex items-center gap-2 text-sm text-primary font-semibold">
					<span class="material-icons text-accent-primary">check_circle</span>
					Segmentation complete
				</div>
				{#if fallbackMessage}
					<div class="text-xs bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-3 py-2 text-yellow-300">
						{fallbackMessage}
					</div>
				{/if}
				{#if warningMessage}
					<div class="text-xs bg-blue-500/10 border border-blue-500/30 rounded-lg px-3 py-2 text-blue-300">
						{warningMessage}
					</div>
				{/if}
				{#if cloudCpuFallbackMessage}
					<div class="text-xs bg-blue-500/10 border border-blue-500/30 rounded-lg px-3 py-2 text-blue-300">
						{cloudCpuFallbackMessage}
					</div>
				{/if}
				<div class="text-sm text-secondary">
					Mode: <span class="text-primary font-semibold">{selectedMode === 'api' ? 'Cloud v2' : 'Local'}</span>
					({getSelectedModelForAnalytics()}, {getDeviceForAnalytics()})
				</div>
				<div class="text-sm text-secondary">
					Segments found: <span class="text-primary font-semibold">{result.segmentsApplied}</span>
				</div>
				<div class="text-sm text-secondary">
					Verse range:
					<span class="text-primary font-semibold">{formatVerseRange(result)}</span>
				</div>
				<div class="text-sm text-secondary">
					Low-confidence segments:
					<span class="text-primary font-semibold">{result.lowConfidenceSegments}</span>
					{#if result.lowConfidenceSegments > 0}
						<span class="text-thirdly"> (make sure to review them manually)</span>
					{/if}
				</div>
				<div class="text-sm text-secondary">
					Coverage gap segments:
					<span class="text-primary font-semibold">{result.coverageGapSegments}</span>
					{#if result.coverageGapSegments > 0}
						<span class="text-thirdly"> (words or verses may be missing)</span>
					{/if}
				</div>
			</div>
		{:else if errorMessage}
			<div
				class="bg-danger-color/10 border border-danger-color rounded-xl px-4 py-3 text-sm space-y-1"
			>
				<div class="font-semibold text-danger-color">Segmentation failed</div>
				<div class="text-secondary break-words max-h-40 overflow-y-auto">{errorMessage}</div>
			</div>
		{/if}
	</div>

	<!-- Footer -->
	<div class="border-t border-color bg-primary px-6 py-4">
		<div class="flex items-center justify-between">
			<div class="text-xs text-thirdly">
				{#if result && result.status === 'completed'}
					Segmentation is complete. You can close this modal.
				{:else if selectedMode === 'local' && !selectedEngineStatus()?.usable}
					Local mode may fallback to Cloud v2 if setup or token is incomplete.
				{:else}
					Ready to start auto-segmentation.
				{/if}
			</div>
			<div class="flex gap-3">
				{#if result && result.status === 'completed'}
					<button class="btn-accent px-5 py-2 text-sm" onclick={close}>Finish</button>
				{:else}
					<button class="btn px-5 py-2 text-sm" onclick={close}>Close</button>
					<button
						class="btn-accent px-5 py-2 text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
						onclick={startSegmentation}
						disabled={isRunning || !hasAudio()}
					>
						<span class="material-icons text-base">auto_awesome</span>
						Start segmentation
					</button>
				{/if}
			</div>
		</div>
	</div>
</div>
