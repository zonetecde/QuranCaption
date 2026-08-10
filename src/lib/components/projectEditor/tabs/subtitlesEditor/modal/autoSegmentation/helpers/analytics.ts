import {
	AnalyticsService,
	type AnalyticsWorkflow,
	type AnalyticsWorkflowStatus
} from '$lib/services/AnalyticsService';
import type {
	AutoSegmentationResult,
	LocalSegmentationStatus,
	SegmentationMode
} from '$lib/services/AutoSegmentation';
import type { UnknownRecord } from '$lib/types/common';
import type { AiVersion, WizardRuntime } from '../types';

export type SegmentationAnalyticsParams = {
	requestedMode: SegmentationMode;
	runtime: WizardRuntime;
	version: AiVersion;
	model: string;
	device: string;
	minSilenceMs: number;
	minSpeechMs: number;
	padMs: number;
	includeWordByWord: boolean;
	fillBySilence: boolean;
	extendBeforeSilence: boolean;
	extendBeforeSilenceMs: number;
};

/**
 * Resolves machine-stable model identifiers for segmentation analytics.
 * @param {AiVersion} version Selected segmentation engine.
 * @param {string} displayedModel Model label displayed by the wizard.
 * @param {string} surahSplitterModel Stable Surah Splitter model value.
 * @returns {string} Stable analytics model identifier.
 */
export function getSegmentationAnalyticsModel(
	version: AiVersion,
	displayedModel: string,
	surahSplitterModel: string
): string {
	if (version === 'surah_splitter') return surahSplitterModel;
	if (version === 'quran_word_timing') return 'quran_word_timing';
	return displayedModel;
}

/**
 * Tracks installation failures for local segmentation engines.
 * @param {'legacy' | 'multi' | 'surah_splitter' | 'quran_word_timing'} engine Stable engine identifier.
 * @param {LocalSegmentationStatus | null} status Current structural readiness status.
 * @returns {void} Nothing.
 */
export function trackInstallFailure(
	engine: 'legacy' | 'multi' | 'surah_splitter' | 'quran_word_timing',
	status: LocalSegmentationStatus | null
): void {
	AnalyticsService.track('local_segmentation_dependencies_install_failed', {
		feature: 'segmentation',
		mode: 'local',
		engine,
		error_code: 'dependency_install_failed',
		python_installed: status?.pythonInstalled,
		legacy_ready: status?.engines?.legacy?.ready,
		multi_ready: status?.engines?.multi?.ready,
		surah_splitter_ready: status?.engines?.surahSplitter?.ready,
		word_timing_ready: status?.engines?.quranwordtiming?.ready
	});
}

/**
 * Builds the structural properties shared by segmentation workflow events.
 * @param {SegmentationAnalyticsParams} params Stable segmentation choices.
 * @returns {UnknownRecord} Privacy-safe workflow properties.
 */
export function buildSegmentationAnalyticsProperties(
	params: SegmentationAnalyticsParams
): UnknownRecord {
	const provider =
		params.runtime === 'hf_json'
			? 'hf_space_json'
			: params.requestedMode === 'api'
				? 'cloud_v2'
				: params.version;
	const inputSource =
		params.runtime === 'hf_json'
			? 'hf_space_json'
			: params.requestedMode === 'api'
				? 'cloud'
				: 'local';

	return {
		provider,
		input_source: inputSource,
		requested_mode: params.requestedMode,
		asr_mode: params.version,
		model: params.model,
		device: params.device,
		min_silence_ms: params.minSilenceMs,
		min_speech_ms: params.minSpeechMs,
		pad_ms: params.padMs,
		include_word_by_word: params.includeWordByWord,
		fill_by_silence: params.fillBySilence,
		extend_before_silence: params.extendBeforeSilence,
		extend_before_silence_ms: params.extendBeforeSilenceMs
	};
}

/**
 * Starts a correlated segmentation workflow.
 * @param {SegmentationAnalyticsParams} params Stable segmentation choices.
 * @returns {AnalyticsWorkflow} Correlation data for the terminal event.
 */
export function startSegmentationRun(params: SegmentationAnalyticsParams): AnalyticsWorkflow {
	return AnalyticsService.trackSegmentationStarted(buildSegmentationAnalyticsProperties(params));
}

/**
 * Tracks a terminal segmentation result without filenames or raw errors.
 * @param {AnalyticsWorkflow} workflow Correlation data returned at workflow start.
 * @param {AutoSegmentationResult | null} response Structural segmentation result.
 * @param {SegmentationAnalyticsParams} params Stable segmentation choices.
 * @returns {void} Nothing.
 */
export function trackSegmentationRun(
	workflow: AnalyticsWorkflow,
	response: AutoSegmentationResult | null,
	params: SegmentationAnalyticsParams
): void {
	const completed = response?.status === 'completed' ? response : null;
	const status: AnalyticsWorkflowStatus =
		response?.status === 'completed'
			? 'completed'
			: response?.status === 'cancelled'
				? 'canceled'
				: 'failed';

	AnalyticsService.trackSegmentationUsage(workflow, status, {
		...buildSegmentationAnalyticsProperties(params),
		effective_mode: completed?.effectiveMode ?? params.requestedMode,
		fallback_to_cloud: completed?.fallbackToCloud ?? false,
		cloud_warning_present: !!completed?.warning,
		segments_applied: completed?.segmentsApplied,
		low_confidence_segments: completed?.lowConfidenceSegments,
		coverage_gap_segments: completed?.coverageGapSegments
	});
}
