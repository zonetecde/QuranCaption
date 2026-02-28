import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AutoSegmentationSettings } from '$lib/classes/Settings.svelte';
import ModalManager from '$lib/components/modals/ModalManager';
import { globalState } from '$lib/runes/main.svelte';
import {
	checkLocalSegmentationStatus,
	getAutoSegmentationAudioInfo,
	installLocalSegmentationDeps,
	estimateSegmentationDuration,
	getAutoSegmentationAudioDurationS,
	parseImportedSegmentationJson,
	runAutoSegmentation,
	runAutoSegmentationFromImportedJson,
	type AutoSegmentationResult,
	type LegacyWhisperModelSize,
	type LocalSegmentationStatus,
	type MultiAlignerModel,
	type SegmentationDevice,
	type SegmentationMode
} from '$lib/services/AutoSegmentation';
import { getWizardSteps } from './constants';
import { trackInstallFailure, trackSegmentationRun } from './helpers/analytics';
import {
	buildAudioLabel,
	formatVerseRange,
	getDeviceLabel,
	getSelectedModelLabel
} from './helpers/format';
import { deriveSelectionState, persistSettingsPatch } from './helpers/persist';
import type { AiVersion, SegmentationPreset, WizardRuntime, WizardSelectionState } from './types';

/** Creates modal state and actions for the auto-segmentation wizard. */
export function useAutoSegmentationWizard() {
	const persisted = globalState.settings?.autoSegmentationSettings as
		| AutoSegmentationSettings
		| undefined;
	const selection = $state<WizardSelectionState>(deriveSelectionState(persisted));
	let minSilenceMs = $state(persisted?.minSilenceMs ?? 200);
	let minSpeechMs = $state(persisted?.minSpeechMs ?? 1000);
	let padMs = $state(persisted?.padMs ?? 100);
	let fillBySilence = $state(persisted?.fillBySilence ?? true);
	let extendBeforeSilence = $state(persisted?.extendBeforeSilence ?? false);
	let extendBeforeSilenceMs = $state(persisted?.extendBeforeSilenceMs ?? 50);
	let currentStep = $state(0);
	let isRunning = $state(false);
	let result = $state<AutoSegmentationResult | null>(null);
	let localStatus = $state<LocalSegmentationStatus | null>(null);
	let isCheckingStatus = $state(false);
	let isInstallingDeps = $state(false);
	let installingEngine = $state<'legacy' | 'multi' | null>(null);
	let installStatus = $state('');
	let currentStatus = $state('');
	let currentStatusProgress = $state<number | null>(null);
	let estimatedDurationS = $state<number | null>(null);
	let estimatedProgress = $state<number | null>(null);
	let estimatedRemainingS = $state<number | null>(null);
	let errorMessage = $state<string | null>(null);
	let warningMessage = $state<string | null>(null);
	let fallbackMessage = $state<string | null>(null);
	let cloudCpuFallbackMessage = $state<string | null>(null);
	let importedJsonRaw = $state('');
	let importedJsonFileName = $state('');
	let importedJsonSegmentCount = $state(0);
	let importedJsonParseError = $state<string | null>(null);
	let estimationTimer: ReturnType<typeof setInterval> | null = null;
	let runStartedAtMs: number | null = null;
	const steps = $derived(() => getWizardSteps(selection.aiVersion, selection.runtime));
	const maxStep = $derived(() => Math.max(0, steps().length - 1));
	const currentStepKey = $derived(() => steps()[currentStep]?.key ?? 'review');

	const audioInfo = $derived(() => getAutoSegmentationAudioInfo());
	const hasAudio = $derived(() => !!audioInfo());
	const audioLabel = $derived(() => buildAudioLabel(audioInfo()?.fileName, audioInfo()?.clipCount));
	const runtimeLabel = $derived(() =>
		selection.runtime === 'cloud'
			? 'Cloud'
			: selection.runtime === 'local'
				? 'Local'
				: 'Hugging Face JSON import'
	);
	const selectedModel = $derived(() =>
		selection.runtime === 'hf_json'
			? 'From imported JSON'
			: getSelectedModelLabel(
					selection.aiVersion,
					selection.mode,
					selection.legacyModel,
					selection.multiModel,
					selection.cloudModel
				)
	);
	const selectedDevice = $derived(() =>
		selection.runtime === 'hf_json'
			? 'N/A'
			: getDeviceLabel(selection.aiVersion, selection.mode, selection.device)
	);
	const effectiveDeviceLabel = $derived(() => {
		if (selection.runtime === 'hf_json') return 'N/A';
		if (result?.status === 'completed' && result.cloudGpuFallbackToCpu) return 'CPU';
		return selectedDevice();
	});
	const verseRange = $derived(() => formatVerseRange(result));
	const canStart = $derived(() => {
		if (selection.runtime === 'hf_json')
			return hasAudio() && importedJsonRaw.trim().length > 0 && !isRunning;
		return hasAudio() && !isRunning;
	});
	const canGoNext = $derived(() => {
		if (isRunning) return false;
		return true;
	});
	const helperText = $derived(() =>
		result?.status === 'completed'
			? 'Segmentation completed. You can close and review the subtitles.'
			: selection.runtime === 'hf_json'
				? 'Import and parse a JSON export from Hugging Face, then apply it to your timeline.'
				: selection.mode === 'local'
				? "Local mode uses your computer's resources."
				: 'Cloud mode uses Quran Multi-Aligner v2.'
	);

	/** Persists a partial settings update. */
	function persistPatch(patch: Partial<AutoSegmentationSettings>): void {
		void persistSettingsPatch(patch);
	}

	/** Loads local engine readiness without blocking run action. */
	async function refreshLocalStatus(): Promise<void> {
		isCheckingStatus = true;
		try {
			localStatus = await checkLocalSegmentationStatus(selection.hfToken);
		} catch {
			localStatus = null;
		} finally {
			isCheckingStatus = false;
		}
	}

	/** Changes AI family and applies runtime constraints. */
	function onVersionChange(aiVersion: AiVersion): void {
		selection.aiVersion = aiVersion;
		selection.mode = aiVersion === 'legacy_v1' ? 'local' : 'api';
		selection.runtime = aiVersion === 'legacy_v1' ? 'local' : 'cloud';
		selection.localAsrMode = aiVersion === 'legacy_v1' ? 'legacy_whisper' : 'multi_aligner';
		currentStep = Math.max(0, Math.min(currentStep, maxStep()));
		persistPatch({ mode: selection.mode, localAsrMode: selection.localAsrMode });
		if (selection.mode === 'local') void refreshLocalStatus();
	}

	/** Updates runtime while preserving legacy local-only behavior. */
	function onModeChange(mode: SegmentationMode): void {
		selection.mode = selection.aiVersion === 'legacy_v1' ? 'local' : mode;
		selection.runtime = selection.mode === 'local' ? 'local' : 'cloud';
		if (selection.mode === 'local' && selection.aiVersion === 'multi_v2')
			selection.localAsrMode = 'multi_aligner';
		persistPatch({ mode: selection.mode, localAsrMode: selection.localAsrMode });
		if (selection.mode === 'local') void refreshLocalStatus();
	}

	/** Updates runtime for V2 while preserving persisted mode compatibility. */
	function setRuntime(runtime: WizardRuntime): void {
		if (selection.aiVersion === 'legacy_v1') {
			onModeChange('local');
			return;
		}

		if (runtime === 'hf_json') {
			selection.runtime = 'hf_json';
			selection.mode = 'api';
			currentStep = Math.max(0, Math.min(currentStep, maxStep()));
			return;
		}

		onModeChange(runtime === 'local' ? 'local' : 'api');
	}

	/** Sets raw JSON import text and resets parsed state. */
	function setImportedJsonRaw(value: string): void {
		importedJsonRaw = value;
		importedJsonParseError = null;
		importedJsonSegmentCount = 0;
	}

	/** Loads a dropped/browsed JSON file for parsing. */
	async function loadImportedJsonFile(file: File): Promise<void> {
		importedJsonFileName = file.name;
		setImportedJsonRaw(await file.text());
	}

	/** Loads a JSON payload from a dropped desktop file path. */
	async function loadImportedJsonPath(filePath: string, fileContent: string): Promise<void> {
		importedJsonFileName = filePath.split(/[/\\]/).pop() ?? filePath;
		setImportedJsonRaw(fileContent);
	}

	/** Clears import payload and parse state. */
	function clearImportedJson(): void {
		importedJsonRaw = '';
		importedJsonFileName = '';
		importedJsonSegmentCount = 0;
		importedJsonParseError = null;
	}

	/** Prompts and stores the Hugging Face token for local V2. */
	async function promptHFToken(): Promise<void> {
		try {
			const token = await ModalManager.inputModal(
				'Enter your Hugging Face token',
				selection.hfToken,
				256,
				'hf_xxxxxxxxxxxxxxxxx'
			);
			selection.hfToken = token.trim();
			persistPatch({ hfToken: selection.hfToken });
			await refreshLocalStatus();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			errorMessage = `Token prompt failed: ${message}`;
		}
	}

	/** Clears token and refreshes local readiness. */
	async function clearHFToken(): Promise<void> {
		selection.hfToken = '';
		persistPatch({ hfToken: '' });
		await refreshLocalStatus();
	}

	/** Installs local dependencies for one engine with streamed status text. */
	async function installEngine(engine: 'legacy' | 'multi'): Promise<void> {
		if (isInstallingDeps) return;
		isInstallingDeps = true;
		installingEngine = engine;
		installStatus = '';
		const unlisten = await listen<{ message: string }>(
			'install-status',
			(event) => (installStatus = event.payload.message)
		);
		try {
			await installLocalSegmentationDeps(
				engine,
				engine === 'multi' ? selection.hfToken : undefined
			);
			await refreshLocalStatus();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			errorMessage = `Failed to install ${engine} dependencies: ${message}`;
			trackInstallFailure(engine, message, localStatus);
		} finally {
			unlisten();
			isInstallingDeps = false;
			installingEngine = null;
			installStatus = '';
		}
	}

	/** Returns a segmentation status listener for both local and cloud runs. */
	async function listenSegmentationStatus(): Promise<UnlistenFn | null> {
		return listen<{ message?: string; progress?: number }>(
			'segmentation-status',
			(event) => {
				if (typeof event.payload.message === 'string') currentStatus = event.payload.message;
				if (typeof event.payload.progress === 'number') {
					currentStatusProgress = Math.max(0, Math.min(100, event.payload.progress));
				} else {
					currentStatusProgress = null;
				}
			}
		);
	}

	function stopEstimationTimer(): void {
		if (estimationTimer) {
			clearInterval(estimationTimer);
			estimationTimer = null;
		}
	}

	function resetEstimatedProgress(): void {
		stopEstimationTimer();
		runStartedAtMs = null;
		estimatedDurationS = null;
		estimatedProgress = null;
		estimatedRemainingS = null;
	}

	function startEstimatedProgressTimer(durationS: number): void {
		stopEstimationTimer();
		if (!Number.isFinite(durationS) || durationS <= 0) return;
		runStartedAtMs = Date.now();
		estimatedDurationS = durationS;
		const tick = () => {
			if (!runStartedAtMs || !estimatedDurationS) {
				estimatedProgress = null;
				estimatedRemainingS = null;
				return;
			}
			const elapsedS = (Date.now() - runStartedAtMs) / 1000;
			const ratio = Math.max(0, Math.min(1, elapsedS / estimatedDurationS));
			estimatedProgress = ratio * 100;
			estimatedRemainingS = Math.max(0, Math.ceil(estimatedDurationS - elapsedS));
		};
		tick();
		estimationTimer = setInterval(tick, 400);
	}

	/** Stores response metadata for result/error panels. */
	function applySegmentationResponse(response: AutoSegmentationResult | null): void {
		if (!response) errorMessage = 'Segmentation failed. Please inspect logs.';
		else if (response.status === 'failed') errorMessage = response.message;
		else if (response.status === 'cancelled') errorMessage = 'Segmentation cancelled.';
		else {
			result = response;
			fallbackMessage = response.fallbackToCloud
				? 'Local mode failed and automatically switched to cloud v2.'
				: null;
			cloudCpuFallbackMessage = response.cloudGpuFallbackToCpu
				? 'GPU was unavailable for this run, so processing continued on Cloud CPU automatically.'
				: null;
			warningMessage = response.warning ?? null;
		}
	}

	/** Executes segmentation while preserving fallback and analytics behavior. */
	async function startSegmentation(): Promise<void> {
		if (!canStart()) return;
		if (selection.runtime === 'hf_json' && importedJsonRaw.trim().length === 0) {
			errorMessage = 'Please provide a Hugging Face JSON payload before adding subtitles.';
			return;
		}
		if (
			selection.mode === 'local' &&
			selection.localAsrMode === 'multi_aligner' &&
			!selection.hfToken.trim()
		) {
			errorMessage =
				'Local V2 requires a Hugging Face token with access to private models (hetchyy/r15_95m, hetchyy/r7).';
			return;
		}
		isRunning = true;
		result = null;
		errorMessage = null;
		warningMessage = null;
		fallbackMessage = null;
		cloudCpuFallbackMessage = null;
		currentStatus = '';
		currentStatusProgress = null;
		resetEstimatedProgress();

		if (
			selection.runtime !== 'hf_json' &&
			(selection.mode === 'api' || selection.localAsrMode === 'multi_aligner')
		) {
			const audioDurationS = getAutoSegmentationAudioDurationS();
			const estimated = await estimateSegmentationDuration({
				endpoint: 'process_audio_session',
				audioDurationS,
				modelName: selection.mode === 'api' ? selection.cloudModel : selection.multiModel,
				device: selection.device
			});
			if (estimated?.estimated_duration_s && estimated.estimated_duration_s > 0) {
				startEstimatedProgressTimer(estimated.estimated_duration_s);
			}
		}
		const unlisten = await listenSegmentationStatus();
		let response: AutoSegmentationResult | null = null;
		try {
			if (selection.runtime === 'hf_json') {
				const parsed = parseImportedSegmentationJson(importedJsonRaw);
				importedJsonSegmentCount = parsed.segmentCount;
				importedJsonParseError = null;
				response = await runAutoSegmentationFromImportedJson(parsed.response, {
					fillBySilence,
					extendBeforeSilence,
					extendBeforeSilenceMs
				});
			} else {
				response = await runAutoSegmentation(
					{
						minSilenceMs,
						minSpeechMs,
						padMs,
						localAsrMode: selection.localAsrMode,
						legacyWhisperModel: selection.legacyModel,
						multiAlignerModel: selection.multiModel,
						cloudModel: selection.cloudModel,
						device: selection.device,
						hfToken: selection.hfToken,
						allowCloudFallback: selection.mode !== 'local',
						fillBySilence,
						extendBeforeSilence,
						extendBeforeSilenceMs
					},
					selection.mode
				);
			}
			applySegmentationResponse(response);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (selection.runtime === 'hf_json') importedJsonParseError = message;
			response = { status: 'failed', message };
			applySegmentationResponse(response);
		} finally {
			unlisten?.();
			isRunning = false;
			currentStatus = '';
			currentStatusProgress = null;
			resetEstimatedProgress();
			trackSegmentationRun({
				response,
				requestedMode: selection.runtime === 'hf_json' ? 'api' : selection.mode,
				runtime: selection.runtime,
				version: selection.aiVersion,
				model: selectedModel(),
				device: selectedDevice(),
				audioLabel: audioLabel(),
				minSilenceMs,
				minSpeechMs,
				padMs,
				fillBySilence,
				extendBeforeSilence,
				extendBeforeSilenceMs,
				hfTokenSet: selection.hfToken.length > 0
			});
		}
	}

	/** Applies preset timings and persists the timing trio. */
	function applyPreset(preset: SegmentationPreset): void {
		minSilenceMs = preset.minSilenceMs;
		minSpeechMs = preset.minSpeechMs;
		padMs = preset.padMs;
		persistPatch({ minSilenceMs, minSpeechMs, padMs });
	}

	/** Checks if a preset matches current timings. */
	function isPresetActive(preset: SegmentationPreset): boolean {
		return (
			minSilenceMs === preset.minSilenceMs &&
			minSpeechMs === preset.minSpeechMs &&
			padMs === preset.padMs
		);
	}

	/** Sets local legacy model and persists the choice. */
	function setLegacyModel(value: LegacyWhisperModelSize): void {
		selection.legacyModel = value;
		persistPatch({ legacyWhisperModel: value });
	}
	/** Sets local multi-aligner model and persists the choice. */
	function setMultiModel(value: MultiAlignerModel): void {
		selection.multiModel = value;
		persistPatch({ multiAlignerModel: value });
	}
	/** Sets cloud model and persists the choice. */
	function setCloudModel(value: MultiAlignerModel): void {
		selection.cloudModel = value;
		persistPatch({ cloudModel: value });
	}
	/** Sets preferred device and persists the choice. */
	function setDevice(value: SegmentationDevice): void {
		selection.device = value;
		persistPatch({ device: value });
	}
	/** Sets min silence and persists it. */
	function setMinSilence(value: number): void {
		minSilenceMs = value;
		persistPatch({ minSilenceMs: value });
	}
	/** Sets min speech and persists it. */
	function setMinSpeech(value: number): void {
		minSpeechMs = value;
		persistPatch({ minSpeechMs: value });
	}
	/** Sets pad and persists it. */
	function setPad(value: number): void {
		padMs = value;
		persistPatch({ padMs: value });
	}
	/** Sets fill-by-silence and persists it. */
	function setFillBySilence(value: boolean): void {
		fillBySilence = value;
		persistPatch({ fillBySilence: value });
	}
	/** Sets extend-before-silence and persists it. */
	function setExtendBeforeSilence(value: boolean): void {
		extendBeforeSilence = value;
		persistPatch({ extendBeforeSilence: value });
	}
	/** Sets extension ms and persists it. */
	function setExtendBeforeSilenceMs(value: number): void {
		extendBeforeSilenceMs = value;
		persistPatch({ extendBeforeSilenceMs: value });
	}
	/** Goes to any wizard step within bounds. */
	function goToStep(step: number): void {
		currentStep = Math.max(0, Math.min(maxStep(), step));
	}
	/** Moves to the next wizard step. */
	function goNext(): void {
		if (!canGoNext()) {
			errorMessage = 'Parse the Hugging Face JSON payload before continuing.';
			return;
		}
		goToStep(currentStep + 1);
	}
	/** Moves to the previous wizard step. */
	function goBack(): void {
		goToStep(currentStep - 1);
	}

	return {
		get selection() {
			return selection;
		},
		get steps() {
			return steps();
		},
		get maxStep() {
			return maxStep();
		},
		get currentStepKey() {
			return currentStepKey();
		},
		get minSilenceMs() {
			return minSilenceMs;
		},
		get minSpeechMs() {
			return minSpeechMs;
		},
		get padMs() {
			return padMs;
		},
		get fillBySilence() {
			return fillBySilence;
		},
		get extendBeforeSilence() {
			return extendBeforeSilence;
		},
		get extendBeforeSilenceMs() {
			return extendBeforeSilenceMs;
		},
		get currentStep() {
			return currentStep;
		},
		get isRunning() {
			return isRunning;
		},
		get result() {
			return result;
		},
		get localStatus() {
			return localStatus;
		},
		get isCheckingStatus() {
			return isCheckingStatus;
		},
		get isInstallingDeps() {
			return isInstallingDeps;
		},
		get installingEngine() {
			return installingEngine;
		},
		get installStatus() {
			return installStatus;
		},
		get currentStatus() {
			return currentStatus;
		},
		get currentStatusProgress() {
			return currentStatusProgress;
		},
		get estimatedDurationS() {
			return estimatedDurationS;
		},
		get estimatedProgress() {
			return estimatedProgress;
		},
		get estimatedRemainingS() {
			return estimatedRemainingS;
		},
		get errorMessage() {
			return errorMessage;
		},
		get warningMessage() {
			return warningMessage;
		},
		get fallbackMessage() {
			return fallbackMessage;
		},
		get cloudCpuFallbackMessage() {
			return cloudCpuFallbackMessage;
		},
		get importedJsonRaw() {
			return importedJsonRaw;
		},
		get importedJsonFileName() {
			return importedJsonFileName;
		},
		get importedJsonSegmentCount() {
			return importedJsonSegmentCount;
		},
		get importedJsonParseError() {
			return importedJsonParseError;
		},
		hasAudio,
		audioLabel,
		runtimeLabel,
		selectedModel,
		selectedDevice,
		effectiveDeviceLabel,
		verseRange,
		canStart,
		canGoNext,
		helperText,
		refreshLocalStatus,
		onVersionChange,
		onModeChange,
		setRuntime,
		promptHFToken,
		clearHFToken,
		setImportedJsonRaw,
		loadImportedJsonFile,
		loadImportedJsonPath,
		clearImportedJson,
		installEngine,
		startSegmentation,
		applyPreset,
		isPresetActive,
		setLegacyModel,
		setMultiModel,
		setCloudModel,
		setDevice,
		setMinSilence,
		setMinSpeech,
		setPad,
		setFillBySilence,
		setExtendBeforeSilence,
		setExtendBeforeSilenceMs,
		goToStep,
		goNext,
		goBack
	};
}

export type AutoSegmentationWizard = ReturnType<typeof useAutoSegmentationWizard>;
