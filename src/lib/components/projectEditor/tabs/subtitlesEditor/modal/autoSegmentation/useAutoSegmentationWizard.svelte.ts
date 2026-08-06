import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AutoSegmentationSettings } from '$lib/classes/Settings.svelte';
import { globalState } from '$lib/runes/main.svelte';
import {
	getAutoSegmentationAudioInfo,
	runAutoSegmentation,
	type AutoSegmentationResult,
	type SegmentationDevice,
	type SubtitleApplicationMode
} from '$lib/services/AutoSegmentation';
import { notifyLongTaskCompletion } from '$lib/services/UserAttentionService';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';
import { buildAudioLabel } from './helpers/format';
import { persistSettingsPatch } from './helpers/persist';
import type { SegmentationPreset } from './types';
import { PredefinedSubtitleClip, SubtitleClip } from '$lib/classes';

/** Creates the cloud-only mobile auto-segmentation state and actions. */
export function useAutoSegmentationWizard() {
	const persisted = globalState.settings?.autoSegmentationSettings as
		| AutoSegmentationSettings
		| undefined;
	const selection = $state({
		aiVersion: 'multi_v2' as const,
		mode: 'api' as const,
		runtime: 'cloud' as const,
		cloudModel: persisted?.cloudModel === 'Large' ? ('Large' as const) : ('Base' as const),
		device: persisted?.device ?? ('GPU' as SegmentationDevice)
	});
	let minSilenceMs = $state(persisted?.minSilenceMs ?? 200);
	let minSpeechMs = $state(persisted?.minSpeechMs ?? 1000);
	let padMs = $state(persisted?.padMs ?? 100);
	let includeWbwTimestamps = $state(persisted?.includeWbwTimestamps ?? false);
	let subtitleApplicationMode = $state<SubtitleApplicationMode | null>(null);
	let fillBySilence = $state(persisted?.fillBySilence ?? true);
	let extendBeforeSilence = $state(persisted?.extendBeforeSilence ?? false);
	let extendBeforeSilenceMs = $state(persisted?.extendBeforeSilenceMs ?? 50);
	let isRunning = $state(false);
	let result = $state<AutoSegmentationResult | null>(null);
	let currentStatus = $state('');
	let currentStatusProgress = $state<number | null>(null);
	let errorMessage = $state<string | null>(null);
	let warningMessage = $state<string | null>(null);
	let cloudCpuFallbackMessage = $state<string | null>(null);
	const showExistingSubtitlesStep = $derived(
		() =>
			globalState.getSubtitleTrack.clips.filter(
				(clip) => clip instanceof SubtitleClip || clip instanceof PredefinedSubtitleClip
			).length >= 3
	);

	const audioInfo = $derived(() => getAutoSegmentationAudioInfo());
	const hasAudio = $derived(() => !!audioInfo());

	/** Persists a partial mobile segmentation setting update. */
	function persistPatch(patch: Partial<AutoSegmentationSettings>): void {
		void persistSettingsPatch(patch);
	}

	/** Keeps the only mobile segmentation version selected. */
	function onVersionChange(_version: 'multi_v2'): void {
		selection.aiVersion = 'multi_v2';
	}

	/** Sets the cloud model used by the mobile pipeline. */
	function setCloudModel(value: 'Base' | 'Large'): void {
		selection.cloudModel = value;
		persistPatch({ cloudModel: value });
	}

	/** Sets the preferred cloud device. */
	function setDevice(value: SegmentationDevice): void {
		selection.device = value;
		persistPatch({ device: value });
	}

	/** Listens to upload and processing progress emitted by the cloud command. */
	async function listenSegmentationStatus(): Promise<UnlistenFn> {
		return listen<{ message?: string; progress?: number }>('segmentation-status', (event) => {
			if (typeof event.payload.message === 'string') currentStatus = event.payload.message;
			currentStatusProgress =
				typeof event.payload.progress === 'number' && event.payload.progress < 100
					? Math.max(0, Math.min(100, event.payload.progress))
					: null;
		});
	}

	/** Applies a cloud segmentation response to the modal state. */
	function applySegmentationResponse(response: AutoSegmentationResult | null): void {
		if (!response) {
			errorMessage = 'Segmentation failed. Please inspect logs.';
		} else if (response.status === 'failed') {
			errorMessage = response.message;
		} else if (response.status === 'cancelled') {
			errorMessage = 'Segmentation cancelled.';
		} else {
			result = response;
			warningMessage = response.warning ?? null;
			cloudCpuFallbackMessage = response.cloudGpuFallbackToCpu
				? 'GPU was unavailable for this run, so processing continued on Cloud CPU automatically.'
				: null;
		}
	}

	/** Notifies the user when the long-running cloud segmentation finishes. */
	async function notifySegmentationCompletion(
		response: AutoSegmentationResult | null
	): Promise<void> {
		if (!response || response.status === 'cancelled') return;
		await notifyLongTaskCompletion(
			response.status === 'failed'
				? {
						title: get(LL).editor.aiSegmentationFailed(),
						body: response.message,
						level: 'error'
					}
				: {
						title: get(LL).editor.aiSegmentationFinished(),
						body: `Applied ${response.segmentsApplied} subtitle(s).`,
						level: 'success'
					}
		);
	}

	/** Starts the cloud-only mobile segmentation flow. */
	async function startSegmentation(): Promise<void> {
		if (
			!hasAudio() ||
			isRunning ||
			(showExistingSubtitlesStep() && subtitleApplicationMode === null)
		)
			return;
		isRunning = true;
		result = null;
		errorMessage = null;
		warningMessage = null;
		cloudCpuFallbackMessage = null;
		currentStatus = '';
		currentStatusProgress = null;
		const unlisten = await listenSegmentationStatus();
		let response: AutoSegmentationResult | null = null;
		try {
			response = await runAutoSegmentation(
				{
					minSilenceMs,
					minSpeechMs,
					padMs,
					cloudModel: selection.cloudModel,
					device: selection.device,
					includeWbwTimestamps: subtitleApplicationMode === 'align' || includeWbwTimestamps,
					subtitleApplicationMode: showExistingSubtitlesStep()
						? (subtitleApplicationMode ?? 'replace')
						: 'replace',
					fillBySilence,
					extendBeforeSilence,
					extendBeforeSilenceMs
				},
				'api'
			);
			applySegmentationResponse(response);
		} catch (error) {
			response = {
				status: 'failed',
				message: error instanceof Error ? error.message : String(error)
			};
			applySegmentationResponse(response);
		} finally {
			unlisten();
			isRunning = false;
			currentStatus = '';
			currentStatusProgress = null;
			await notifySegmentationCompletion(response);
		}
	}

	/** Applies a timing preset and persists it. */
	function applyPreset(preset: SegmentationPreset): void {
		minSilenceMs = preset.minSilenceMs;
		minSpeechMs = preset.minSpeechMs;
		padMs = preset.padMs;
		persistPatch({ minSilenceMs, minSpeechMs, padMs });
	}

	/** Reports whether a timing preset matches the current values. */
	function isPresetActive(preset: SegmentationPreset): boolean {
		return (
			minSilenceMs === preset.minSilenceMs &&
			minSpeechMs === preset.minSpeechMs &&
			padMs === preset.padMs
		);
	}

	/** Persists the minimum silence duration. */
	function setMinSilence(value: number): void {
		minSilenceMs = value;
		persistPatch({ minSilenceMs: value });
	}

	/** Persists the minimum speech duration. */
	function setMinSpeech(value: number): void {
		minSpeechMs = value;
		persistPatch({ minSpeechMs: value });
	}

	/** Persists the segmentation padding. */
	function setPad(value: number): void {
		padMs = value;
		persistPatch({ padMs: value });
	}

	/** Persists word-by-word timestamp generation. */
	function setIncludeWbwTimestamps(value: boolean): void {
		includeWbwTimestamps = value;
		persistPatch({ includeWbwTimestamps: value });
	}

	/**
	 * Sets how segmentation updates an existing subtitle track.
	 * @param {SubtitleApplicationMode} value Selected application mode.
	 * @returns {void}
	 */
	function setSubtitleApplicationMode(value: SubtitleApplicationMode): void {
		subtitleApplicationMode = value;
	}

	/** Persists whether timeline gaps become silence clips. */
	function setFillBySilence(value: boolean): void {
		fillBySilence = value;
		persistPatch({ fillBySilence: value });
	}

	/** Persists subtitle extension before silence. */
	function setExtendBeforeSilence(value: boolean): void {
		extendBeforeSilence = value;
		persistPatch({ extendBeforeSilence: value });
	}

	/** Persists the subtitle extension duration. */
	function setExtendBeforeSilenceMs(value: number): void {
		extendBeforeSilenceMs = value;
		persistPatch({ extendBeforeSilenceMs: value });
	}

	return {
		get selection() {
			return selection;
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
		get includeWbwTimestamps() {
			return includeWbwTimestamps;
		},
		get subtitleApplicationMode() {
			return showExistingSubtitlesStep() ? subtitleApplicationMode : 'replace';
		},
		get showExistingSubtitlesStep() {
			return showExistingSubtitlesStep();
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
		get isRunning() {
			return isRunning;
		},
		get result() {
			return result;
		},
		get currentStatus() {
			return currentStatus;
		},
		get currentStatusProgress() {
			return currentStatusProgress;
		},
		get estimatedProgress() {
			return null;
		},
		get estimatedRemainingS() {
			return null;
		},
		get errorMessage() {
			return errorMessage;
		},
		get warningMessage() {
			return warningMessage;
		},
		get fallbackMessage() {
			return null;
		},
		get cloudCpuFallbackMessage() {
			return cloudCpuFallbackMessage;
		},
		get importedJsonFileName() {
			return '';
		},
		selectedModel: () => selection.cloudModel,
		effectiveDeviceLabel: () =>
			result?.status === 'completed' && result.cloudGpuFallbackToCpu ? 'CPU' : selection.device,
		supportsWbwTimestamps: () => true,
		canStart: () =>
			hasAudio() &&
			!isRunning &&
			(!showExistingSubtitlesStep() || subtitleApplicationMode !== null),
		onVersionChange,
		setCloudModel,
		setDevice,
		startSegmentation,
		applyPreset,
		isPresetActive,
		setMinSilence,
		setMinSpeech,
		setPad,
		setIncludeWbwTimestamps,
		setSubtitleApplicationMode,
		setFillBySilence,
		setExtendBeforeSilence,
		setExtendBeforeSilenceMs,
		audioLabel: () => buildAudioLabel(audioInfo()?.fileName, audioInfo()?.clipCount)
	};
}

export type AutoSegmentationWizard = ReturnType<typeof useAutoSegmentationWizard>;
