import type { VerseRange } from '$lib/classes/VerseRange.svelte';

export const SMALL_GAP_MS = 200;
export const SUBDIVIDE_MAX_VERSES_DISABLED = 5;
export const SUBDIVIDE_MAX_WORDS_DISABLED = 30;
export const SUBDIVIDE_MAX_DURATION_DISABLED = 30;

export type SegmentationWordTimestamp = {
	location: string;
	start: number;
	end: number;
	word?: string;
};

export type SubtitleAlignmentMetadata = {
	source: 'api' | 'local' | 'import';
	segment: number;
	refFrom: string;
	refTo: string;
	matchedText: string;
	specialType?: string;
	timeFrom: number;
	timeTo: number;
	words: SegmentationWordTimestamp[];
};

export type StoredAlignedSegment = {
	clipId: number;
	type: 'Subtitle' | 'Pre-defined Subtitle';
	startMs: number;
	endMs: number;
	segment: number;
	refFrom: string;
	refTo: string;
	matchedText: string;
	specialType?: string;
	words: SegmentationWordTimestamp[];
};

export type StoredSegmentationContext = {
	audioId: string | null;
	source: 'api' | 'local' | 'import' | null;
	effectiveMode: SegmentationMode | null;
	modelName: string | null;
	device: SegmentationDevice | null;
	includeWbwTimestamps: boolean;
	alignedSegments: StoredAlignedSegment[];
};

export type SegmentationSegment = {
	confidence?: number;
	error?: string | null;
	has_missing_words?: boolean;
	potentially_undersegmented?: boolean;
	matched_text?: string;
	special_type?: string;
	ref_from?: string;
	ref_to?: string;
	segment?: number;
	time_from?: number;
	time_to?: number;
	words?: SegmentationWordTimestamp[];
	word_timestamps?: Array<{
		key: string;
		start: number;
		end: number;
		type: string;
	}>;
};

export type SegmentationResponse = {
	audio_id?: string;
	error?: string;
	warning?: string;
	segments?: SegmentationSegment[];
};

export type ImportedSegmentationParseResult = {
	response: SegmentationResponse;
	segmentCount: number;
};

/**
 * Mode de traitement de la segmentation.
 */
export type SegmentationMode = 'api' | 'local';
export type LocalAsrMode = 'legacy_whisper' | 'multi_aligner' | 'muaalem_local' | 'surah_splitter';
export type LegacyWhisperModelSize = 'tiny' | 'base' | 'medium' | 'large';
export type MultiAlignerModel =
	| 'Base'
	| 'Large'
	| 'Muaalem-v3.2'
	| 'Open-Tadabur-Small'
	| 'Open-DeepDML-Small-Mix'
	| 'Open-DeepDML-Medium-Mix'
	| 'Open-IJyad-Large-V3'
	| 'Open-Naazim-Large-V3-Turbo'
	| 'Open-Legacy-Tiny'
	| 'Open-Legacy-Base'
	| 'Open-Legacy-Medium'
	| 'Open-Legacy-Large'
	| 'SurahSplitter-Base-Quran';
export type SegmentationDevice = 'GPU' | 'CPU';

export type LocalEngineStatus = {
	ready: boolean;
	venvExists: boolean;
	packagesInstalled: boolean;
	usable: boolean;
	message: string;
	tokenRequired?: boolean;
	tokenProvided?: boolean;
};

/**
 * Statut de disponibilité de la segmentation locale.
 */
export type LocalSegmentationStatus = {
	ready: boolean;
	pythonInstalled: boolean;
	packagesInstalled: boolean;
	message: string;
	engines?: {
		legacy: LocalEngineStatus;
		multi: LocalEngineStatus;
		muaalem: LocalEngineStatus;
		surahSplitter: LocalEngineStatus;
	};
};

export type AutoSegmentationOptions = {
	minSilenceMs?: number;
	minSpeechMs?: number;
	padMs?: number;
	localAsrMode?: LocalAsrMode;
	legacyWhisperModel?: LegacyWhisperModelSize;
	multiAlignerModel?: MultiAlignerModel;
	cloudModel?: MultiAlignerModel;
	surahSplitterSurah?: number | null;
	device?: SegmentationDevice;
	hfToken?: string;
	allowCloudFallback?: boolean;
	includeWbwTimestamps?: boolean;
	/** Si true, insère des SilenceClip dans les gaps. Sinon, étend la fin du sous-titre précédent. */
	fillBySilence?: boolean;
	/** Si true, étend les sous-titres avant les clips de silence. */
	extendBeforeSilence?: boolean;
	/** Millisecondes supplémentaires ajoutées avant un silence quand extendBeforeSilence est actif. */
	extendBeforeSilenceMs?: number;
	/** Appelé une fois après la confirmation de l'écrasement. */
	onRunConfirmed?: (() => void | Promise<void>) | null;
};

export type AutoSegmentationResult =
	| {
			status: 'completed';
			segmentsApplied: number;
			lowConfidenceSegments: number;
			coverageGapSegments: number;
			verseRange: VerseRange;
			fallbackToCloud?: boolean;
			cloudGpuFallbackToCpu?: boolean;
			warning?: string;
			requestedMode?: SegmentationMode;
			effectiveMode?: SegmentationMode;
	  }
	| {
			status: 'cancelled';
	  }
	| {
			status: 'failed';
			message: string;
	  };

export type AutoSegmentationAudioInfo = {
	filePath: string;
	fileName: string;
	clipCount: number;
};

export type AutoSegmentationAudioClip = {
	filePath: string;
	fileName: string;
	startMs: number;
	endMs: number;
};

export type DurationEstimateResult = {
	endpoint: string;
	estimated_duration_s: number;
	device: SegmentationDevice;
	model_name: MultiAlignerModel;
};

export type VerseRef = {
	surah: number;
	verse: number;
	word: number;
};

export type PredefinedType =
	| 'Basmala'
	| "Isti'adha"
	| 'Amin'
	| 'Takbir'
	| 'Tahmeed'
	| 'Tasleem'
	| 'Sadaqa';

export type SegmentationClipTemplate =
	| {
			kind: 'subtitle';
			segment: SegmentationSegment;
			originalStartMs: number;
			originalEndMs: number;
			surah: number;
			verseNumber: number;
			startIndex: number;
			endIndex: number;
			verse: NonNullable<Awaited<ReturnType<typeof import('$lib/classes/Quran').Quran.getVerse>>>;
			confidence: number | null;
			isLowConfidence: boolean;
			needsReview: boolean;
			needsCoverageReview: boolean;
			segmentWords: SegmentationWordTimestamp[];
	  }
	| {
			kind: 'predefined';
			segment: SegmentationSegment;
			originalStartMs: number;
			originalEndMs: number;
			predefinedType: PredefinedType;
			confidence: number | null;
			isLowConfidence: boolean;
			segmentWords: SegmentationWordTimestamp[];
	  };

export type ApplySegmentationResponseParams = {
	response: SegmentationResponse;
	fillBySilence: boolean;
	extendBeforeSilence: boolean;
	extendBeforeSilenceMs: number;
	fallbackToCloud: boolean;
	cloudGpuFallbackToCpu: boolean;
	requestedMode: SegmentationMode;
	effectiveMode: SegmentationMode;
	segmentationSource: 'api' | 'local' | 'import';
	includeWbwTimestamps: boolean;
	modelName?: string | null;
	device?: SegmentationDevice | null;
	warningOverride?: string;
	payloadForLog?: unknown;
};

export type CoverageGapDependencies = {
	getVerseWordCount: (surah: number, verse: number) => Promise<number | null>;
	getVerseCount: (surah: number) => number;
	getSurahCount: () => number;
};
