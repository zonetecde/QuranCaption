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
import { runAutoSegmentationFromImportedJson } from '$lib/services/AutoSegmentation';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import { PredefinedSubtitleClip, SubtitleClip } from '$lib/classes';
import { AnalyticsService } from '$lib/services/AnalyticsService';

/**
 * Creates the mobile cloud alignment and JSON import actions.
 * @param {(() => string | null) | undefined} getImportedPayload Current optional JSON import.
 * @returns {object} Reactive cloud alignment state and actions.
 */
export function useAutoSegmentationWizard(getImportedPayload?: () => string | null) {
	const persisted = globalState.settings?.autoSegmentationSettings as
		| AutoSegmentationSettings
		| undefined;
	const selection = $state({
		aiVersion: 'multi_v2' as const,
		mode: 'api' as const,
		runtime: 'cloud' as const,
		cloudModel: persisted?.cloudModel === 'Large' ? ('Large' as const) : ('Base' as const),
		device: persisted?.device ?? ('GPU' as SegmentationDevice),
		riwayah: persisted?.riwayah ?? ('hafs' as const)
	});
	let padLeftMs = $state(persisted?.padLeftMs ?? 100);
	let padRightMs = $state(persisted?.padRightMs ?? 200);
	let subtitleApplicationMode = $state<SubtitleApplicationMode | null>('replace');
	let fillBySilence = $state(persisted?.fillBySilence ?? true);
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
			).length >= (getImportedPayload?.() ? 1 : 3)
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

	/** Persists the recitation reading used by the cloud aligner. */
	function setRiwayah(value: 'hafs' | 'warsh' | 'qalun' | 'shuba'): void {
		selection.riwayah = value;
		persistPatch({ riwayah: value });
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
		const applicationMode = showExistingSubtitlesStep()
			? (subtitleApplicationMode ?? 'replace')
			: 'replace';
		const unlisten = await listenSegmentationStatus();
		const analyticsWorkflow = AnalyticsService.trackSegmentationStarted({
			method: 'cloud',
			model: selection.cloudModel,
			device: selection.device,
			applicationMode,
			includeWbwTimestamps: true
		});
		let response: AutoSegmentationResult | null = null;
		try {
			const importedPayload = getImportedPayload?.();
			response = importedPayload
				? await ProjectHistoryManager.trackAsync('import subtitle segmentation', () =>
						runAutoSegmentationFromImportedJson(importedPayload, {
							fillBySilence,
							subtitleApplicationMode: applicationMode
						})
					)
				: await runAutoSegmentation(
						{
							padLeftMs,
							padRightMs,
							cloudModel: selection.cloudModel,
							device: selection.device,
							riwayah: selection.riwayah,
							includeWbwTimestamps: true,
							subtitleApplicationMode: applicationMode,
							fillBySilence
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
			AnalyticsService.trackSegmentationFinished(analyticsWorkflow, {
				outcome:
					response?.status === 'completed'
						? 'completed'
						: response?.status === 'cancelled'
							? 'canceled'
							: 'failed',
				segmentsApplied: response?.status === 'completed' ? response.segmentsApplied : undefined,
				lowConfidenceSegments:
					response?.status === 'completed' ? response.lowConfidenceSegments : undefined,
				coverageGapSegments:
					response?.status === 'completed' ? response.coverageGapSegments : undefined,
				cloudGpuFallbackToCpu:
					response?.status === 'completed' ? response.cloudGpuFallbackToCpu : undefined
			});
			unlisten();
			isRunning = false;
			currentStatus = '';
			currentStatusProgress = null;
			await notifySegmentationCompletion(response);
		}
	}

	/** Persists the amount added before cloud segment boundaries. */
	function setPadLeft(value: number): void {
		padLeftMs = Math.max(0, Math.min(1000, value));
		persistPatch({ padLeftMs });
	}

	/** Persists the amount added after cloud segment boundaries. */
	function setPadRight(value: number): void {
		padRightMs = Math.max(0, Math.min(1000, value));
		persistPatch({ padRightMs });
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

	return {
		get selection() {
			return selection;
		},
		get padLeftMs() {
			return padLeftMs;
		},
		get padRightMs() {
			return padRightMs;
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
		setRiwayah,
		startSegmentation,
		setPadLeft,
		setPadRight,
		setSubtitleApplicationMode,
		setFillBySilence,
		audioLabel: () => buildAudioLabel(audioInfo()?.fileName, audioInfo()?.clipCount)
	};
}

export type AutoSegmentationWizard = ReturnType<typeof useAutoSegmentationWizard>;
