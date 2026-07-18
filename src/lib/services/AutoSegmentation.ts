// Re-exports depuis les modules spécialisés
// Ce fichier sert de barrel pour préserver la rétrocompatibilité de l'API publique.

export {
	getAutoSegmentationAudioClips,
	getAutoSegmentationAudioInfo,
	getAutoSegmentationAudioDurationS,
	checkLocalSegmentationStatus,
	installLocalSegmentationDeps,
	getPreferredSegmentationMode
} from './autoSegmentation/audio';
export {
	asNonEmptyString,
	asFiniteNumber,
	asBoolean,
	normalizeWordTimestamps,
	normalizeSegmentWords,
	normalizeMfaSegments,
	normalizeImportedSegment,
	parseImportedSegmentationJson,
	parseSegmentationResponseFromThrownError
} from './autoSegmentation/parsing';
export {
	parseVerseRef,
	compareVerseRefs,
	detectCoverageGapIndices
} from './autoSegmentation/verse-ref';
export { getPredefinedType } from './autoSegmentation/predefined';
export {
	setClipStartTime,
	setClipEndTime,
	closeSmallSubtitleGaps,
	insertSilenceClips,
	extendSubtitlesBeforeSilence,
	extendSubtitlesToFillGaps
} from './autoSegmentation/timeline';
export {
	createEmptySegmentationContext,
	getSegmentWords,
	filterWordsForVerse,
	buildSubtitleAlignmentMetadata,
	buildStoredAlignedSegment,
	refreshSegmentationContextFromTrack
} from './autoSegmentation/context';
export {
	getSubtitleClipWordCount,
	getLongSubtitleClips,
	markLongSegmentsForReview,
	clearLongSegmentsReview,
	getSubtitleClipsWithoutWbwTimestamps,
	markSubtitlesWithoutWbwTimestampsForReview,
	clearWbwTimestampReview,
	computeRealignWindow,
	computeMissingWbwTimestamps,
	computeWbwTimestampsForClips,
	computeWbwTimestampsForClipsSliced,
	isWbwTimestampClip
} from './autoSegmentation/review';
export { scheduleWbwRealign, getAutoRealignStatus } from './autoSegmentation/auto-realign.svelte';
export {
	hydrateSubtitleClipRange,
	splitSubtitleClipLocally,
	automaticSplitSubtitleAtWord,
	subdivideLongSubtitleSegments
} from './autoSegmentation/split';
export {
	getSegmentationMfaTimestampsSession,
	getSegmentationMfaTimestampsDirect,
	enrichSegmentationResponseWithWordTimestamps
} from './autoSegmentation/enrichment';
export { estimateSegmentationDuration } from './autoSegmentation/estimate';
export { applySegmentationResponseToProject } from './autoSegmentation/apply-segmentation';
export { runAutoSegmentation } from './autoSegmentation/run-segmentation';
export { runAutoSegmentationFromImportedJson } from './autoSegmentation/run-imported';
export { applyPreloadSegmentsToProject } from './autoSegmentation/run-preload';
export { runNativeSegmentation } from './autoSegmentation/run-native';
export {
	beginAudioNormalizationIfNeeded,
	awaitAudioNormalization,
	audioNormalizationStatus
} from './autoSegmentation/audio-normalize.svelte';

export {
	SMALL_GAP_MS,
	AUTO_REALIGN_DRAG_THRESHOLD_MS,
	AUTO_REALIGN_DEBOUNCE_MS,
	SUBDIVIDE_MAX_VERSES_DISABLED,
	SUBDIVIDE_MAX_WORDS_DISABLED,
	SUBDIVIDE_MAX_DURATION_DISABLED
} from './autoSegmentation/types';

export type {
	SegmentationWordTimestamp,
	RealignWindow,
	SubtitleAlignmentMetadata,
	StoredAlignedSegment,
	StoredSegmentationContext,
	SegmentationSegment,
	SegmentationResponse,
	ImportedSegmentationParseResult,
	SegmentationMode,
	LocalAsrMode,
	LegacyWhisperModelSize,
	MultiAlignerModel,
	SegmentationDevice,
	LocalEngineStatus,
	LocalSegmentationStatus,
	AutoSegmentationOptions,
	AutoSegmentationResult,
	AutoSegmentationAudioInfo,
	AutoSegmentationAudioClip,
	DurationEstimateResult,
	VerseRef,
	PredefinedType,
	SegmentationClipTemplate,
	ApplySegmentationResponseParams,
	CoverageGapDependencies
} from './autoSegmentation/types';
