export type AITranscriptionWord = {
	word: string;
	start: number;
	end: number;
	confidence?: number | null;
};

export type AITranscriptionSegment = {
	/** Identité du sous-titre lors du nettoyage d’un projet déjà édité. */
	clipId?: number;
	start: number;
	end: number;
	text: string;
	confidence?: number | null;
	words: AITranscriptionWord[];
};

export type AITranscriptionResult = {
	language: string;
	device: string;
	model: string;
	segments: AITranscriptionSegment[];
	wordTimestampsAvailable: boolean;
	alignmentWarning?: string | null;
	gpuFallbackReason?: string;
};

export type AIStreamBatchState = {
	batchId: string;
	index: number;
	total: number;
	status: 'pending' | 'running' | 'completed' | 'failed';
	reasoning: string;
	response: string;
};

export type TranscriptWordTiming = {
	word?: string;
	location?: string;
	start: number;
	end: number;
	/** Durée vocale mesurée, indépendante de l'étirement pour l'affichage WBW. */
	spokenDuration?: number;
	confidence?: number;
};

export type TranscriptAlignmentMetadata = {
	source: 'api' | 'local' | 'import' | 'manual';
	segment?: number;
	refFrom?: string;
	refTo?: string;
	matchedText?: string;
	specialType?: string;
	timeFrom: number;
	timeTo: number;
	words: TranscriptWordTiming[];
};

export type VisualMergeMode = 'arabic' | 'translation' | 'both';
