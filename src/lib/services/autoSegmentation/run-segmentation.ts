import { invoke } from '@tauri-apps/api/core';
import ModalManager from '$lib/components/modals/ModalManager';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';
import { globalState } from '$lib/runes/main.svelte';
import type {
	AutoSegmentationExecutionOptions,
	AutoSegmentationOptions,
	AutoSegmentationResult,
	SegmentationDevice,
	SegmentationMode,
	SegmentationResponse,
	SubtitleApplicationMode
} from './types';
import { getAutoSegmentationAudioInfo, getAutoSegmentationAudioClips } from './audio';
import { enrichSegmentationResponseWithWordTimestamps } from './enrichment';
import { applySegmentationResponseToProject } from './apply-segmentation';
import {
	beginAudioNormalizationIfNeeded,
	normalizeAudioForProject
} from './audio-normalize.svelte';
import type { Project } from '$lib/classes/Project';
import { TrackType } from '$lib/classes/enums';
import type { SubtitleTrack } from '$lib/classes/Track.svelte';
import {
	AutoSegmentationExecutionCoordinator,
	getAutoSegmentationBusyMessage
} from '$lib/services/AutoSegmentationExecutionCoordinator';

/**
 * Detects cloud GPU quota failures that should be retried on CPU.
 * @param {string} message Error message.
 * @param {SegmentationDevice} device Current cloud device.
 * @returns {boolean} Whether a CPU retry is appropriate.
 */
function shouldRetryCloudOnCpu(message: string, device: SegmentationDevice): boolean {
	return (
		device === 'GPU' &&
		/GPU/i.test(message) &&
		/(quota exhausted|retry with device=CPU|daily limit)/i.test(message)
	);
}

/**
 * Determines whether word timestamps are required for the selected application mode.
 * @param {boolean} requested Saved word-timestamp preference.
 * @param {SubtitleApplicationMode} subtitleApplicationMode Selected subtitle application mode.
 * @returns {boolean} Whether the segmentation response must include word timestamps.
 */
export function resolveIncludeWbwTimestamps(
	requested: boolean,
	subtitleApplicationMode: SubtitleApplicationMode
): boolean {
	return subtitleApplicationMode === 'align' || requested;
}

/**
 * Runs cloud segmentation for an explicit project.
 * @param {Project} project Target project.
 * @param {AutoSegmentationOptions} options Cloud segmentation options.
 * @param {SegmentationMode} [_mode] Retained API argument; mobile always uses cloud.
 * @param {AutoSegmentationExecutionOptions} executionOptions UI and overwrite behavior.
 * @returns {Promise<AutoSegmentationResult | null>} Segmentation summary.
 */
export async function runAutoSegmentationForProject(
	project: Project,
	options: AutoSegmentationOptions = {},
	_mode?: SegmentationMode,
	executionOptions: AutoSegmentationExecutionOptions = {}
): Promise<AutoSegmentationResult | null> {
	const minSilenceMs = options.minSilenceMs ?? 200;
	const minSpeechMs = options.minSpeechMs ?? 1000;
	const padMs = options.padMs ?? 100;
	const subtitleApplicationMode = options.subtitleApplicationMode ?? 'replace';
	const includeWbwTimestamps = resolveIncludeWbwTimestamps(
		options.includeWbwTimestamps ?? false,
		subtitleApplicationMode
	);
	const cloudModel = options.cloudModel ?? 'Base';
	const device = options.device ?? 'GPU';
	const fillBySilence = options.fillBySilence ?? true;
	const extendBeforeSilence = options.extendBeforeSilence ?? false;
	const extendBeforeSilenceMs = options.extendBeforeSilenceMs ?? 0;

	const audioInfo = getAutoSegmentationAudioInfo(project);
	const audioClips = getAutoSegmentationAudioClips(project);
	if (!audioInfo || audioClips.length === 0) {
		return { status: 'failed', message: 'No audio clip found in the project.' };
	}

	const audioNormalizationPromise = executionOptions.headless
		? normalizeAudioForProject(project)
		: undefined;
	if (!executionOptions.headless) beginAudioNormalizationIfNeeded();

	const subtitleTrack = project.content.timeline.getFirstTrack(TrackType.Subtitle) as SubtitleTrack;
	if (subtitleTrack.clips.length > 0) {
		if (executionOptions.headless && executionOptions.overwriteExistingSubtitles !== true) {
			return { status: 'cancelled' };
		}
		if (
			!executionOptions.headless &&
			executionOptions.overwriteExistingSubtitles !== true &&
			options.subtitleApplicationMode === undefined
		) {
			const confirmed = await ModalManager.confirmModal(
				get(LL).editor.subtitlesAlreadyExist(),
				true
			);
			if (!confirmed) return { status: 'cancelled' };
		}
	}
	await options.onRunConfirmed?.();

	try {
		const basePayload = {
			audioPath: audioInfo.filePath,
			audioClips: audioClips.map((clip) => ({
				path: clip.filePath,
				startMs: clip.startMs,
				endMs: clip.endMs,
				sourceStartMs: clip.sourceStartMs
			})),
			minSilenceMs,
			minSpeechMs,
			padMs,
			modelName: cloudModel
		};
		const invokeCloud = async (targetDevice: SegmentationDevice): Promise<SegmentationResponse> =>
			(await invoke('segment_quran_audio', {
				...basePayload,
				device: targetDevice
			})) as SegmentationResponse;

		let cloudGpuFallbackToCpu = false;
		let payload: SegmentationResponse;
		try {
			payload = await invokeCloud(device);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (!shouldRetryCloudOnCpu(message, device)) throw error;
			payload = await invokeCloud('CPU');
			cloudGpuFallbackToCpu = true;
		}
		if (!cloudGpuFallbackToCpu && payload.error && shouldRetryCloudOnCpu(payload.error, device)) {
			payload = await invokeCloud('CPU');
			cloudGpuFallbackToCpu = true;
		}

		const response = includeWbwTimestamps
			? await enrichSegmentationResponseWithWordTimestamps(payload)
			: payload;
		executionOptions.onApplying?.();
		return await applySegmentationResponseToProject({
			response,
			fillBySilence,
			extendBeforeSilence,
			extendBeforeSilenceMs,
			fallbackToCloud: false,
			cloudGpuFallbackToCpu,
			requestedMode: 'api',
			effectiveMode: 'api',
			segmentationSource: 'api',
			includeWbwTimestamps,
			subtitleApplicationMode,
			modelName: cloudModel,
			device,
			payloadForLog: payload,
			project,
			headless: executionOptions.headless,
			audioNormalizationPromise
		});
	} catch (error) {
		console.error('Segmentation request failed:', error);
		return {
			status: 'failed',
			message: error instanceof Error ? error.message : String(error)
		};
	}
}

/**
 * Runs cloud segmentation for the currently open project.
 * @param {AutoSegmentationOptions} options Cloud segmentation options.
 * @param {SegmentationMode} [mode] Retained API argument; mobile always uses cloud.
 * @returns {Promise<AutoSegmentationResult | null>} Segmentation result.
 */
export async function runAutoSegmentation(
	options: AutoSegmentationOptions = {},
	mode?: SegmentationMode
): Promise<AutoSegmentationResult | null> {
	const release = AutoSegmentationExecutionCoordinator.tryAcquire('manual');
	if (!release) return { status: 'failed', message: getAutoSegmentationBusyMessage() };
	try {
		const project = globalState.currentProject;
		if (!project) return { status: 'failed', message: get(LL).home.anErrorOccurred() };
		return await runAutoSegmentationForProject(project, options, mode);
	} finally {
		release();
	}
}
