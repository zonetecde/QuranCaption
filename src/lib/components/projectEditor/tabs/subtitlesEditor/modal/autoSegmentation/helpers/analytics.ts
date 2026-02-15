import { AnalyticsService } from '$lib/services/AnalyticsService';
import type {
	AutoSegmentationResult,
	LocalSegmentationStatus,
	SegmentationMode
} from '$lib/services/AutoSegmentation';
import type { AiVersion } from '../types';

/** Tracks installation failures for local segmentation engines. */
export function trackInstallFailure(
	engine: 'legacy' | 'multi',
	errorMessage: string,
	status: LocalSegmentationStatus | null
): void {
	AnalyticsService.track('local_segmentation_dependencies_install_failed', {
		feature: 'segmentation',
		mode: 'local',
		engine,
		error_message: errorMessage,
		python_installed: status?.pythonInstalled,
		legacy_ready: status?.engines?.legacy?.ready,
		multi_ready: status?.engines?.multi?.ready
	});
}

/** Tracks segmentation usage with the same payload shape as the legacy modal. */
export function trackSegmentationRun(params: {
	response: AutoSegmentationResult | null;
	requestedMode: SegmentationMode;
	version: AiVersion;
	model: string;
	device: string;
	audioLabel: string;
	minSilenceMs: number;
	minSpeechMs: number;
	padMs: number;
	fillBySilence: boolean;
	extendBeforeSilence: boolean;
	extendBeforeSilenceMs: number;
	hfTokenSet: boolean;
}): void {
	const completed = params.response?.status === 'completed' ? params.response : null;
	const range = completed?.verseRange.parts
		.map((part) => `${part.surah}:${part.verseStart}-${part.verseEnd}`)
		.join(', ');

	AnalyticsService.trackAIUsage('segmentation', {
		status: params.response?.status ?? 'unknown',
		range,
		provider: params.requestedMode === 'api' ? 'cloud_v2' : params.version,
		requested_mode: params.requestedMode,
		effective_mode: completed?.effectiveMode ?? params.requestedMode,
		asr_mode: params.version,
		model: params.model,
		device: params.device,
		fallback_to_cloud: completed?.fallbackToCloud ?? false,
		cloud_warning_present: !!completed?.warning,
		min_silence_ms: params.minSilenceMs,
		min_speech_ms: params.minSpeechMs,
		pad_ms: params.padMs,
		fill_by_silence: params.fillBySilence,
		extend_before_silence: params.extendBeforeSilence,
		extend_before_silence_ms: params.extendBeforeSilenceMs,
		mode: params.requestedMode,
		hf_token_set: params.hfTokenSet,
		audio_filename: params.audioLabel,
		segments_applied: completed?.segmentsApplied,
		low_confidence_segments: completed?.lowConfidenceSegments,
		coverage_gap_segments: completed?.coverageGapSegments,
		error_message: params.response?.status === 'failed' ? params.response.message : undefined
	});
}
