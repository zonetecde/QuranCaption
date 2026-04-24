import { invoke } from '@tauri-apps/api/core';
import toast from 'svelte-5-french-toast';

import { Quran } from '$lib/classes/Quran';
import {
	AssetClip,
	PredefinedSubtitleClip,
	SilenceClip,
	SubtitleClip,
	type Translation
} from '$lib/classes';
import { canonicalizePredefinedSubtitleType } from '$lib/classes/Clip.svelte';
import ModalManager from '$lib/components/modals/ModalManager';
import { globalState } from '$lib/runes/main.svelte';
import { VerseRange } from '$lib/classes/VerseRange.svelte';
import { Mp3QuranService } from '$lib/services/Mp3QuranService';
import { QdcRecitationService } from '$lib/services/QdcRecitationService';

const SMALL_GAP_MS = 200;
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
 * Segmentation processing mode
 */
export type SegmentationMode = 'api' | 'local';
export type LocalAsrMode = 'legacy_whisper' | 'multi_aligner';
export type LegacyWhisperModelSize = 'tiny' | 'base' | 'medium' | 'large';
export type MultiAlignerModel = 'Base' | 'Large';
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
 * Status of local segmentation readiness
 */
export type LocalSegmentationStatus = {
	ready: boolean;
	pythonInstalled: boolean;
	packagesInstalled: boolean;
	message: string;
	engines?: {
		legacy: LocalEngineStatus;
		multi: LocalEngineStatus;
	};
};

/**
 * Check if local segmentation is available and ready.
 */
export async function checkLocalSegmentationStatus(
	hfToken?: string
): Promise<LocalSegmentationStatus> {
	try {
		const result = await invoke('check_local_segmentation_ready', {
			hfToken: hfToken && hfToken.trim().length > 0 ? hfToken : undefined
		});
		return result as LocalSegmentationStatus;
	} catch (error) {
		console.error('Failed to check local segmentation status:', error);
		return {
			ready: false,
			pythonInstalled: false,
			packagesInstalled: false,
			message: 'Failed to check local segmentation status',
			engines: {
				legacy: {
					ready: false,
					venvExists: false,
					packagesInstalled: false,
					usable: false,
					message: 'Status check failed'
				},
				multi: {
					ready: false,
					venvExists: false,
					packagesInstalled: false,
					usable: false,
					tokenRequired: true,
					tokenProvided: false,
					message: 'Status check failed'
				}
			}
		};
	}
}

/**
 * Install dependencies for local segmentation.
 * Returns a promise that resolves when installation is complete.
 */
export async function installLocalSegmentationDeps(
	engine: 'legacy' | 'multi',
	hfToken?: string
): Promise<void> {
	try {
		await invoke('install_local_segmentation_deps', {
			engine,
			hfToken: hfToken && hfToken.trim().length > 0 ? hfToken : undefined
		});
	} catch (error) {
		console.error('Failed to install local segmentation deps:', error);
		throw error;
	}
}

/**
 * Get the preferred segmentation mode.
 * Returns 'local' if ready, otherwise 'api'.
 */
export async function getPreferredSegmentationMode(): Promise<SegmentationMode> {
	const status = await checkLocalSegmentationStatus();
	return status.ready ? 'local' : 'api';
}

export type AutoSegmentationOptions = {
	minSilenceMs?: number;
	minSpeechMs?: number;
	padMs?: number;
	localAsrMode?: LocalAsrMode;
	legacyWhisperModel?: LegacyWhisperModelSize;
	multiAlignerModel?: MultiAlignerModel;
	cloudModel?: MultiAlignerModel;
	device?: SegmentationDevice;
	hfToken?: string;
	allowCloudFallback?: boolean;
	includeWbwTimestamps?: boolean;
	fillBySilence?: boolean; // Si true, insère des SilenceClip dans les gaps. Sinon, étend la fin du sous-titre précédent.
	extendBeforeSilence?: boolean; // If true, extend subtitles before silence clips.
	extendBeforeSilenceMs?: number; // Extra ms added before silence when enabled.
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

type VerseRef = {
	surah: number;
	verse: number;
	word: number;
};

type PredefinedType =
	| 'Basmala'
	| "Isti'adha"
	| 'Amin'
	| 'Takbir'
	| 'Tahmeed'
	| 'Tasleem'
	| 'Sadaqa';

/**
 * Return the audio file used as input for auto segmentation.
 * We use the first clip from the audio track.
 *
 * @returns {AutoSegmentationAudioInfo | null} Audio info if available, otherwise null.
 */
export function getAutoSegmentationAudioClips(): AutoSegmentationAudioClip[] {
	const project = globalState.currentProject;
	const audioTrack = globalState.getAudioTrack;

	if (!project || !audioTrack) return [];

	const clips: AutoSegmentationAudioClip[] = [];

	for (const clip of audioTrack.clips) {
		if (!clip || typeof clip !== 'object') continue;

		const assetId = (clip as { assetId?: unknown }).assetId;
		if (typeof assetId !== 'number') continue;

		const startTime = (clip as { startTime?: unknown }).startTime;
		const endTime = (clip as { endTime?: unknown }).endTime;
		if (typeof startTime !== 'number' || typeof endTime !== 'number') continue;

		const audioAsset = project.content.getAssetById(assetId);
		const filePath: string | undefined = audioAsset?.filePath;
		if (!filePath) continue;

		const fileName: string = filePath.split(/[/\\]/).pop() || filePath;
		clips.push({
			filePath,
			fileName,
			startMs: Math.max(0, Math.round(startTime)),
			endMs: Math.max(0, Math.round(endTime))
		});
	}

	return clips.sort((a, b) => a.startMs - b.startMs);
}

export function getAutoSegmentationAudioInfo(): AutoSegmentationAudioInfo | null {
	const clips = getAutoSegmentationAudioClips();
	if (clips.length === 0) return null;

	const first = clips[0];
	return {
		filePath: first.filePath,
		fileName: first.fileName,
		clipCount: clips.length
	};
}

function asNonEmptyString(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string') {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
	return typeof value === 'boolean' ? value : undefined;
}

function normalizeWordTimestamps(
	value: unknown
): Array<{ key: string; start: number; end: number; type: string }> {
	if (!Array.isArray(value)) return [];
	return value
		.map((entry) => {
			if (!entry || typeof entry !== 'object') return null;
			const key = asNonEmptyString((entry as { key?: unknown }).key);
			const start = asFiniteNumber((entry as { start?: unknown }).start);
			const end = asFiniteNumber((entry as { end?: unknown }).end);
			const type = asNonEmptyString((entry as { type?: unknown }).type);
			if (!key || start === undefined || end === undefined || !type) return null;
			return { key, start, end, type };
		})
		.filter((entry): entry is { key: string; start: number; end: number; type: string } => !!entry);
}

function normalizeSegmentWords(value: unknown): SegmentationWordTimestamp[] {
	if (!Array.isArray(value)) return [];

	return value
		.map((entry) => {
			if (Array.isArray(entry)) {
				const location = asNonEmptyString(entry[0]);
				const start = asFiniteNumber(entry[1]);
				const end = asFiniteNumber(entry[2]);
				if (!location || start === undefined || end === undefined) return null;
				return { location, start, end };
			}

			if (!entry || typeof entry !== 'object') return null;
			const location =
				asNonEmptyString((entry as { location?: unknown }).location) ??
				asNonEmptyString((entry as { key?: unknown }).key);
			const start = asFiniteNumber((entry as { start?: unknown }).start);
			const end = asFiniteNumber((entry as { end?: unknown }).end);
			const word = asNonEmptyString((entry as { word?: unknown }).word);
			if (!location || start === undefined || end === undefined) return null;
			return word ? { location, start, end, word } : { location, start, end };
		})
		.filter((entry): entry is SegmentationWordTimestamp => !!entry);
}

/**
 * Normalise une réponse MFA partielle en réinjectant les métadonnées manquantes depuis les segments source.
 *
 * @param {unknown} value Segments MFA bruts renvoyés par l'API.
 * @param {SegmentationSegment[]} fallbackSegments Segments source déjà connus côté app.
 * @returns {SegmentationSegment[]} Segments MFA exploitables par le reste du pipeline.
 */
function normalizeMfaSegments(
	value: unknown,
	fallbackSegments: SegmentationSegment[]
): SegmentationSegment[] {
	if (!Array.isArray(value)) return [];

	const normalizedSegments: SegmentationSegment[] = [];

	for (const [index, entry] of value.entries()) {
		if (!entry || typeof entry !== 'object') continue;

		const segment = entry as Record<string, unknown>;
		const fallbackSegment = fallbackSegments[index];
		const normalizedError =
			segment.error === null
				? null
				: (asNonEmptyString(segment.error) ?? fallbackSegment?.error ?? null);

		normalizedSegments.push({
			segment: asFiniteNumber(segment.segment) ?? fallbackSegment?.segment ?? index,
			time_from: asFiniteNumber(segment.time_from) ?? fallbackSegment?.time_from,
			time_to: asFiniteNumber(segment.time_to) ?? fallbackSegment?.time_to,
			ref_from: asNonEmptyString(segment.ref_from) ?? fallbackSegment?.ref_from ?? '',
			ref_to: asNonEmptyString(segment.ref_to) ?? fallbackSegment?.ref_to ?? '',
			matched_text: asNonEmptyString(segment.matched_text) ?? fallbackSegment?.matched_text ?? '',
			confidence: asFiniteNumber(segment.confidence) ?? fallbackSegment?.confidence,
			has_missing_words: asBoolean(segment.has_missing_words) ?? fallbackSegment?.has_missing_words,
			potentially_undersegmented:
				asBoolean(segment.potentially_undersegmented) ??
				fallbackSegment?.potentially_undersegmented,
			special_type: asNonEmptyString(segment.special_type) ?? fallbackSegment?.special_type,
			error: normalizedError,
			words: normalizeSegmentWords(segment.words),
			word_timestamps: normalizeWordTimestamps(segment.word_timestamps)
		});
	}

	return normalizedSegments;
}

function normalizeImportedSegment(raw: unknown, index: number): SegmentationSegment {
	if (!raw || typeof raw !== 'object') {
		throw new Error(`Invalid segment at index ${index}: expected an object.`);
	}

	const segment = raw as Record<string, unknown>;
	const timeFrom = asFiniteNumber(segment.time_from);
	const timeTo = asFiniteNumber(segment.time_to);
	if (timeFrom === undefined || timeTo === undefined) {
		throw new Error(`Invalid segment at index ${index}: 'time_from' and 'time_to' are required.`);
	}

	const normalizedError =
		segment.error === null ? null : (asNonEmptyString(segment.error) ?? undefined);

	return {
		segment: asFiniteNumber(segment.segment),
		time_from: Math.max(0, timeFrom),
		time_to: Math.max(Math.max(0, timeFrom), timeTo),
		ref_from: asNonEmptyString(segment.ref_from) ?? '',
		ref_to: asNonEmptyString(segment.ref_to) ?? '',
		matched_text: asNonEmptyString(segment.matched_text) ?? '',
		confidence: asFiniteNumber(segment.confidence),
		has_missing_words: asBoolean(segment.has_missing_words),
		potentially_undersegmented: asBoolean(segment.potentially_undersegmented),
		special_type: asNonEmptyString(segment.special_type),
		error: normalizedError ?? null,
		words: normalizeSegmentWords(segment.words),
		word_timestamps: normalizeWordTimestamps(segment.word_timestamps)
	};
}

export function parseImportedSegmentationJson(
	input: string | unknown
): ImportedSegmentationParseResult {
	let parsed: unknown = input;
	if (typeof input === 'string') {
		const trimmed = input.trim();
		if (!trimmed) throw new Error('JSON input is empty.');
		try {
			parsed = JSON.parse(trimmed);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Invalid JSON format: ${message}`);
		}
	}

	if (!parsed || typeof parsed !== 'object') {
		throw new Error("Invalid payload: expected a JSON object with a 'segments' array.");
	}

	const root = parsed as Record<string, unknown>;
	const rawSegments = root.segments;
	if (!Array.isArray(rawSegments)) {
		throw new Error("Invalid payload: missing 'segments' array.");
	}

	const normalizedSegments = rawSegments.map((segment, index) =>
		normalizeImportedSegment(segment, index)
	);
	if (normalizedSegments.length === 0) {
		throw new Error("Invalid payload: 'segments' array is empty.");
	}

	const response: SegmentationResponse = {
		audio_id: asNonEmptyString(root.audio_id),
		error: asNonEmptyString(root.error),
		warning: asNonEmptyString(root.warning),
		segments: normalizedSegments
	};

	return { response, segmentCount: normalizedSegments.length };
}

/**
 * Parse a verse reference in the format "surah:verse:word".
 *
 * @param {string | undefined} ref - Raw reference string.
 * @returns {VerseRef | null} Parsed reference or null if invalid.
 */
function parseVerseRef(ref?: string): VerseRef | null {
	if (!ref) return null;

	const match: RegExpMatchArray | null = ref.match(/^(\d+):(\d+):(\d+)$/);
	if (!match) return null;

	return {
		surah: Number(match[1]),
		verse: Number(match[2]),
		word: Number(match[3])
	};
}

function compareVerseRefs(a: VerseRef, b: VerseRef): number {
	if (a.surah !== b.surah) return a.surah - b.surah;
	if (a.verse !== b.verse) return a.verse - b.verse;
	return a.word - b.word;
}

type CoverageGapDependencies = {
	getVerseWordCount: (surah: number, verse: number) => Promise<number | null>;
	getVerseCount: (surah: number) => number;
	getSurahCount: () => number;
};

export async function detectCoverageGapIndices(
	orderedSegments: Array<
		Pick<SegmentationSegment, 'ref_from' | 'ref_to' | 'error' | 'special_type'>
	>,
	deps: CoverageGapDependencies
): Promise<Set<number>> {
	const { getVerseWordCount, getVerseCount, getSurahCount } = deps;

	const normalizeRef = async (ref: VerseRef): Promise<VerseRef | null> => {
		const wordCount = await getVerseWordCount(ref.surah, ref.verse);
		if (!wordCount || wordCount <= 0) return null;

		let word = ref.word;
		if (word < 1) word = 1;
		if (word > wordCount) word = wordCount;

		return { surah: ref.surah, verse: ref.verse, word };
	};

	const getExpectedNextRef = async (ref: VerseRef): Promise<VerseRef | null> => {
		const wordCount = await getVerseWordCount(ref.surah, ref.verse);
		if (!wordCount || wordCount <= 0) return null;

		if (ref.word < wordCount) {
			return { surah: ref.surah, verse: ref.verse, word: ref.word + 1 };
		}

		const verseCount = getVerseCount(ref.surah);
		if (verseCount > 0 && ref.verse < verseCount) {
			return { surah: ref.surah, verse: ref.verse + 1, word: 1 };
		}

		const surahCount = getSurahCount();
		if (ref.surah < surahCount) {
			return { surah: ref.surah + 1, verse: 1, word: 1 };
		}

		return null;
	};

	const coverageMap = new Map<string, Set<number>>();
	const normalizedSegments: Array<{ startRef: VerseRef; endRef: VerseRef } | null> = Array(
		orderedSegments.length
	).fill(null);

	const addCoverageRange = (
		surah: number,
		verse: number,
		startWord: number,
		endWord: number
	): void => {
		if (startWord > endWord) return;

		const key = `${surah}:${verse}`;
		let covered = coverageMap.get(key);
		if (!covered) {
			covered = new Set<number>();
			coverageMap.set(key, covered);
		}

		for (let word = startWord; word <= endWord; word += 1) {
			covered.add(word);
		}
	};

	for (let i = 0; i < orderedSegments.length; i += 1) {
		const segment = orderedSegments[i];
		if (segment.error) continue;
		if (getPredefinedType(segment.ref_from, segment.special_type)) continue;

		const rawStartRef = parseVerseRef(segment.ref_from);
		const rawEndRef = parseVerseRef(segment.ref_to);
		if (!rawStartRef || !rawEndRef) continue;
		if (rawStartRef.surah !== rawEndRef.surah) continue;

		let startRef = await normalizeRef(rawStartRef);
		let endRef = await normalizeRef(rawEndRef);
		if (!startRef || !endRef) continue;

		if (compareVerseRefs(startRef, endRef) > 0) {
			[startRef, endRef] = [endRef, startRef];
		}

		normalizedSegments[i] = { startRef, endRef };

		if (startRef.verse === endRef.verse) {
			addCoverageRange(startRef.surah, startRef.verse, startRef.word, endRef.word);
			continue;
		}

		for (let verseNumber = startRef.verse; verseNumber <= endRef.verse; verseNumber += 1) {
			const wordCount = await getVerseWordCount(startRef.surah, verseNumber);
			if (!wordCount || wordCount <= 0) continue;

			let rangeStart = 1;
			let rangeEnd = wordCount;
			if (verseNumber === startRef.verse) rangeStart = startRef.word;
			if (verseNumber === endRef.verse) rangeEnd = endRef.word;
			if (rangeStart > rangeEnd) [rangeStart, rangeEnd] = [rangeEnd, rangeStart];

			addCoverageRange(startRef.surah, verseNumber, rangeStart, rangeEnd);
		}
	}

	const getPreviousRef = async (ref: VerseRef): Promise<VerseRef | null> => {
		const wordCount = await getVerseWordCount(ref.surah, ref.verse);
		if (!wordCount || wordCount <= 0) return null;

		if (ref.word > 1) {
			return { surah: ref.surah, verse: ref.verse, word: ref.word - 1 };
		}

		const prevVerse = ref.verse - 1;
		if (prevVerse >= 1) {
			const prevWordCount = await getVerseWordCount(ref.surah, prevVerse);
			if (!prevWordCount || prevWordCount <= 0) return null;
			return { surah: ref.surah, verse: prevVerse, word: prevWordCount };
		}

		const prevSurah = ref.surah - 1;
		if (prevSurah < 1) return null;

		const prevVerseCount = getVerseCount(prevSurah);
		if (prevVerseCount <= 0) return null;

		const prevWordCount = await getVerseWordCount(prevSurah, prevVerseCount);
		if (!prevWordCount || prevWordCount <= 0) return null;

		return { surah: prevSurah, verse: prevVerseCount, word: prevWordCount };
	};

	const isRangeFullyCovered = async (start: VerseRef, end: VerseRef): Promise<boolean> => {
		if (compareVerseRefs(start, end) > 0) return true;

		let current: VerseRef = { ...start };
		while (true) {
			const wordCount = await getVerseWordCount(current.surah, current.verse);
			if (!wordCount || wordCount <= 0) return false;

			const isLastVerse = current.surah === end.surah && current.verse === end.verse;
			const endWord = isLastVerse ? end.word : wordCount;
			const key = `${current.surah}:${current.verse}`;
			const covered = coverageMap.get(key);
			if (!covered) return false;

			for (let word = current.word; word <= endWord; word += 1) {
				if (!covered.has(word)) return false;
			}

			if (isLastVerse) {
				break;
			}

			const verseCount = getVerseCount(current.surah);
			if (verseCount <= 0) return false;

			if (current.verse < verseCount) {
				current = { surah: current.surah, verse: current.verse + 1, word: 1 };
				continue;
			}

			const surahCount = getSurahCount();
			if (current.surah >= surahCount) return false;
			current = { surah: current.surah + 1, verse: 1, word: 1 };
		}

		return true;
	};

	const coverageGapIndices = new Set<number>();
	let progressRef: VerseRef | null = null;
	let progressIndex: number | null = null;

	for (let i = 0; i < orderedSegments.length; i += 1) {
		const segment = orderedSegments[i];
		if (segment.error) {
			progressRef = null;
			progressIndex = null;
			continue;
		}

		if (getPredefinedType(segment.ref_from, segment.special_type)) {
			continue;
		}

		const normalized = normalizedSegments[i];
		if (!normalized) {
			progressRef = null;
			progressIndex = null;
			continue;
		}

		const { startRef, endRef } = normalized;

		if (!progressRef) {
			progressRef = endRef;
			progressIndex = i;
			continue;
		}

		// Cross-surah jumps are often intentional (e.g. selected recitation excerpts),
		// so we don't treat them as missing-word coverage gaps.
		if (startRef.surah !== progressRef.surah) {
			progressRef = endRef;
			progressIndex = i;
			continue;
		}

		const expectedNextRef = await getExpectedNextRef(progressRef);
		if (expectedNextRef && compareVerseRefs(startRef, expectedNextRef) > 0) {
			const gapEndRef = await getPreviousRef(startRef);
			const gapCovered = gapEndRef ? await isRangeFullyCovered(expectedNextRef, gapEndRef) : false;

			if (!gapCovered) {
				if (progressIndex !== null) {
					coverageGapIndices.add(progressIndex);
				}
				coverageGapIndices.add(i);
			}
		}

		if (compareVerseRefs(endRef, progressRef) > 0) {
			progressRef = endRef;
			progressIndex = i;
		}
	}

	return coverageGapIndices;
}

/**
 * Detect if the segment reference is a predefined clip such as basmala or istiadhah.
 *
 * @param {string | undefined} ref - Segment reference string.
 * @returns {PredefinedType | null} Predefined type or null if none.
 */
function getPredefinedType(ref?: string, specialType?: string): PredefinedType | null {
	const explicitType = canonicalizePredefinedSubtitleType(specialType);
	if (explicitType !== 'Other') return explicitType;

	if (!ref) return null;
	const normalized = ref.toLowerCase().trim();

	if (
		normalized.includes("isti'adha") ||
		normalized.includes('istiadha') ||
		normalized.includes('isti')
	) {
		return "Isti'adha";
	}
	if (normalized.includes('basmala')) return 'Basmala';
	if (normalized.includes('amin') || normalized.includes('ameen')) return 'Amin';
	if (normalized.includes('takbir')) return 'Takbir';
	if (normalized.includes('tahmeed') || normalized.includes('hamidah')) return 'Tahmeed';
	if (normalized.includes('tasleem') || normalized.includes('salam')) return 'Tasleem';
	if (
		normalized.includes('sadaqa') ||
		normalized.includes('sadaqallah') ||
		normalized.includes('sadaqallahul azim')
	) {
		return 'Sadaqa';
	}

	return null;
}

function setClipStartTime(
	clip: SubtitleClip | PredefinedSubtitleClip | SilenceClip,
	newStartTime: number
): void {
	if (clip instanceof SubtitleClip && typeof clip.setStartTimeSilently === 'function') {
		clip.setStartTimeSilently(newStartTime);
	} else {
		clip.setStartTime(newStartTime);
	}
}

function setClipEndTime(
	clip: SubtitleClip | PredefinedSubtitleClip | SilenceClip,
	newEndTime: number
): void {
	if (clip instanceof SubtitleClip && typeof clip.setEndTimeSilently === 'function') {
		clip.setEndTimeSilently(newEndTime);
	} else {
		clip.setEndTime(newEndTime);
	}
}

/**
 * Remove tiny gaps by snapping the next clip start to the previous clip end.
 * This avoids "micro silences" caused by rounding or segmentation jitter.
 *
 * @param {Array<SubtitleClip | PredefinedSubtitleClip>} clips - Subtitle clips to adjust.
 * @param {number} maxGapMs - Maximum gap to close.
 * @returns {void} Mutates clips in-place (via clip setters).
 */
function closeSmallSubtitleGaps(
	clips: Array<SubtitleClip | PredefinedSubtitleClip>,
	maxGapMs: number
): void {
	const ordered: Array<SubtitleClip | PredefinedSubtitleClip> = [...clips].sort(
		(a, b) => a.startTime - b.startTime
	);

	for (let i: number = 0; i < ordered.length - 1; i += 1) {
		const current: SubtitleClip | PredefinedSubtitleClip = ordered[i];
		const next: SubtitleClip | PredefinedSubtitleClip = ordered[i + 1];

		const gapMs: number = next.startTime - current.endTime - 1;
		if (gapMs > 0 && gapMs < maxGapMs) {
			setClipStartTime(next, current.endTime + 1);
		}
	}
}

/**
 * Insert explicit SilenceClip blocks for gaps that are long enough.
 * This helps downstream rendering/export stay consistent.
 *
 * @param {Array<SubtitleClip | PredefinedSubtitleClip | SilenceClip>} clips - Timeline clips.
 * @param {number} minGapMs - Minimum gap to convert into a SilenceClip.
 * @returns {Array<SubtitleClip | PredefinedSubtitleClip | SilenceClip>} New array with inserted silence clips.
 */
function insertSilenceClips(
	clips: Array<SubtitleClip | PredefinedSubtitleClip | SilenceClip>,
	minGapMs: number
): Array<SubtitleClip | PredefinedSubtitleClip | SilenceClip> {
	const ordered: Array<SubtitleClip | PredefinedSubtitleClip | SilenceClip> = [...clips].sort(
		(a, b) => a.startTime - b.startTime
	);

	const result: Array<SubtitleClip | PredefinedSubtitleClip | SilenceClip> = [];
	if (ordered.length === 0) return result;

	const first = ordered[0];

	// Normalize timeline start to 0, or insert leading silence.
	if (first.startTime < minGapMs) {
		setClipStartTime(first, 0);
	} else {
		result.push(new SilenceClip(0, first.startTime - 1));
	}

	result.push(first);

	for (let i: number = 1; i < ordered.length; i += 1) {
		const prev = result[result.length - 1];
		const next = ordered[i];

		const gapMs: number = next.startTime - prev.endTime - 1;
		if (gapMs >= minGapMs) {
			result.push(new SilenceClip(prev.endTime + 1, next.startTime - 1));
		}

		result.push(next);
	}

	return result;
}

/**
 * Extend subtitles into the following silence clip by a fixed amount (when possible).
 * This shortens the silence clip by the same amount to keep the timeline consistent.
 */
function extendSubtitlesBeforeSilence(
	clips: Array<SubtitleClip | PredefinedSubtitleClip | SilenceClip>,
	extendMs: number
): void {
	if (extendMs <= 0) return;

	const ordered = [...clips].sort((a, b) => a.startTime - b.startTime);

	for (let i = 1; i < ordered.length; i += 1) {
		const current = ordered[i];
		if (!(current instanceof SilenceClip)) continue;

		const prev = ordered[i - 1];
		if (!(prev instanceof SubtitleClip || prev instanceof PredefinedSubtitleClip)) continue;

		const silenceDuration = current.endTime - current.startTime + 1;
		if (silenceDuration <= extendMs) continue;
		const delta = extendMs;

		setClipEndTime(prev, prev.endTime + delta);
		setClipStartTime(current, current.startTime + delta);
	}
}

/**
 * Extend subtitle end times to fill gaps (no silence clips inserted).
 * The end of each subtitle is extended to meet the start of the next one - 1ms.
 *
 * @param {Array<SubtitleClip | PredefinedSubtitleClip>} clips - Timeline clips.
 */
function extendSubtitlesToFillGaps(clips: Array<SubtitleClip | PredefinedSubtitleClip>): void {
	if (clips.length === 0) return;

	const ordered = [...clips].sort((a, b) => a.startTime - b.startTime);

	for (let i: number = 0; i < ordered.length - 1; i += 1) {
		const current = ordered[i];
		const next = ordered[i + 1];

		// Extend current subtitle to meet the next one
		if (current.endTime < next.startTime - 1) {
			setClipEndTime(current, next.startTime - 1);
		}
	}
}

/**
 * Retourne un contexte de segmentation vide.
 *
 * @returns {StoredSegmentationContext} Contexte vide sérialisable.
 */
export function createEmptySegmentationContext(): StoredSegmentationContext {
	return {
		audioId: null,
		source: null,
		effectiveMode: null,
		modelName: null,
		device: null,
		includeWbwTimestamps: false,
		alignedSegments: []
	};
}

/**
 * Convertit la liste brute de mots MFA d'un segment en une liste normalisée.
 *
 * @param {SegmentationSegment} segment Segment enrichi par MFA.
 * @returns {SegmentationWordTimestamp[]} Liste des mots MFA normalisés.
 */
function getSegmentWords(segment: SegmentationSegment): SegmentationWordTimestamp[] {
	return (segment.words ?? []).map((word) => ({
		location: word.location,
		start: word.start,
		end: word.end,
		word: word.word
	}));
}

/**
 * Filtre les mots MFA d'un segment pour un verset donné.
 *
 * @param {SegmentationWordTimestamp[]} words Liste de mots MFA.
 * @param {number} surah Sourate cible.
 * @param {number} verse Verse cible.
 * @returns {SegmentationWordTimestamp[]} Liste filtrée dans l'ordre d'origine.
 */
function filterWordsForVerse(
	words: SegmentationWordTimestamp[],
	surah: number,
	verse: number
): SegmentationWordTimestamp[] {
	return words.filter(
		(word) => typeof word.location === 'string' && word.location.startsWith(`${surah}:${verse}:`)
	);
}

/**
 * Construit la métadonnée d'alignement persistée sur un sous-titre Quran.
 *
 * @param {'api' | 'local' | 'import'} source Source de la segmentation.
 * @param {SegmentationSegment} segment Segment source.
 * @param {SegmentationWordTimestamp[]} words Liste des mots associés au clip.
 * @returns {SubtitleAlignmentMetadata | null} Métadonnée prête à persister.
 */
function buildSubtitleAlignmentMetadata(
	source: 'api' | 'local' | 'import',
	segment: SegmentationSegment,
	words: SegmentationWordTimestamp[]
): SubtitleAlignmentMetadata | null {
	const segmentIndex = segment.segment;
	const timeFrom = segment.time_from;
	const timeTo = segment.time_to;
	const refFrom = segment.ref_from ?? '';
	const refTo = segment.ref_to ?? '';
	if (
		segmentIndex === undefined ||
		timeFrom === undefined ||
		timeTo === undefined ||
		!refFrom ||
		!refTo
	) {
		return null;
	}

	return {
		source,
		segment: segmentIndex,
		refFrom,
		refTo,
		matchedText: segment.matched_text ?? '',
		specialType: segment.special_type,
		timeFrom,
		timeTo,
		words
	};
}

/**
 * Construit l'entrée runtime alignée réutilisée par les outils locaux de split.
 *
 * @param {number} clipId Identifiant du clip créé.
 * @param {'Subtitle' | 'Pre-defined Subtitle'} type Type de clip aligné.
 * @param {number} startMs Début du clip sur la timeline.
 * @param {number} endMs Fin du clip sur la timeline.
 * @param {SegmentationSegment} segment Segment source.
 * @param {SegmentationWordTimestamp[]} words Mots attachés à ce clip.
 * @returns {StoredAlignedSegment | null} Entrée runtime sérialisable.
 */
function buildStoredAlignedSegment(
	clipId: number,
	type: 'Subtitle' | 'Pre-defined Subtitle',
	startMs: number,
	endMs: number,
	segment: SegmentationSegment,
	words: SegmentationWordTimestamp[]
): StoredAlignedSegment | null {
	const segmentIndex = segment.segment;
	const refFrom = segment.ref_from ?? '';
	const refTo = segment.ref_to ?? '';
	if (segmentIndex === undefined || !refFrom || !refTo) return null;

	return {
		clipId,
		type,
		startMs,
		endMs,
		segment: segmentIndex,
		refFrom,
		refTo,
		matchedText: segment.matched_text ?? '',
		specialType: segment.special_type,
		words
	};
}

type ApplySegmentationResponseParams = {
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

async function applySegmentationResponseToProject(
	params: ApplySegmentationResponseParams
): Promise<AutoSegmentationResult> {
	const {
		response,
		fillBySilence,
		extendBeforeSilence,
		extendBeforeSilenceMs,
		fallbackToCloud,
		cloudGpuFallbackToCpu,
		requestedMode,
		effectiveMode,
		segmentationSource,
		includeWbwTimestamps,
		modelName,
		device,
		warningOverride,
		payloadForLog
	} = params;

	if (response.warning) {
		toast(response.warning);
	}
	if (response.error) {
		return { status: 'failed', message: response.error };
	}

	const segments: SegmentationSegment[] = response?.segments ?? [];
	if (segments.length === 0) {
		const message = response.error || 'No segments returned from the segmentation service.';
		return { status: 'failed', message };
	}

	const subtitleTrack = globalState.getSubtitleTrack;
	subtitleTrack.clips = [];
	await Quran.load();

	let segmentsApplied: number = 0;
	let lowConfidenceSegments: number = 0;
	let coverageGapSegments: number = 0;
	let reviewSegments: number = 0;
	const storedAlignedSegments: StoredAlignedSegment[] = [];

	const pushSubtitleClip = async (clipParams: {
		segment: SegmentationSegment;
		startMs: number;
		endMs: number;
		surah: number;
		verseNumber: number;
		startIndex: number;
		endIndex: number;
		verse: Awaited<ReturnType<typeof Quran.getVerse>>;
		confidence: number | null;
		isLowConfidence: boolean;
		needsReview: boolean;
		needsCoverageReview: boolean;
	}): Promise<void> => {
		const {
			segment,
			startMs,
			endMs,
			surah,
			verseNumber,
			startIndex,
			endIndex,
			verse,
			confidence,
			isLowConfidence,
			needsReview,
			needsCoverageReview
		} = clipParams;

		if (!verse) return;

		const arabicText: string = verse.getArabicTextBetweenTwoIndexes(startIndex, endIndex);
		const indopakText: string = verse.getArabicTextBetweenTwoIndexes(
			startIndex,
			endIndex,
			'indopak'
		);
		const wbwTranslation: string[] = verse.getWordByWordTranslationBetweenTwoIndexes(
			startIndex,
			endIndex
		);

		const subtitlesProperties: {
			isFullVerse: boolean;
			isLastWordsOfVerse: boolean;
			translations: { [key: string]: Translation };
		} = await subtitleTrack.getSubtitlesProperties(verse, startIndex, endIndex, surah);

		const clip: SubtitleClip = new SubtitleClip(
			startMs,
			endMs,
			surah,
			verseNumber,
			startIndex,
			endIndex,
			arabicText,
			wbwTranslation,
			subtitlesProperties.isFullVerse,
			subtitlesProperties.isLastWordsOfVerse,
			subtitlesProperties.translations,
			indopakText,
			true,
			confidence
		);
		const segmentWords = filterWordsForVerse(getSegmentWords(segment), surah, verseNumber);
		clip.alignmentMetadata = buildSubtitleAlignmentMetadata(
			segmentationSource,
			segment,
			segmentWords
		);

		if (needsReview || needsCoverageReview) {
			clip.needsReview = true;
			if (needsCoverageReview) clip.needsCoverageReview = true;
			markClipTranslationsForReview(clip);
		}

		subtitleTrack.clips.push(clip);
		const storedAlignedSegment = buildStoredAlignedSegment(
			clip.id,
			'Subtitle',
			startMs,
			endMs,
			segment,
			segmentWords
		);
		if (storedAlignedSegment) {
			storedAlignedSegments.push(storedAlignedSegment);
		}
		segmentsApplied += 1;
		if (isLowConfidence) lowConfidenceSegments += 1;
		if (needsCoverageReview) coverageGapSegments += 1;
		if (clip.needsReview) reviewSegments += 1;
	};

	const orderedSegments: SegmentationSegment[] = [...segments].sort(
		(a, b) => (a.time_from ?? 0) - (b.time_from ?? 0)
	);

	const verseWordCountCache = new Map<string, number>();
	const getVerseWordCount = async (surah: number, verse: number): Promise<number | null> => {
		const key = `${surah}:${verse}`;
		const cached = verseWordCountCache.get(key);
		if (cached !== undefined) return cached;

		const verseData = await Quran.getVerse(surah, verse);
		if (!verseData) return null;

		const count = verseData.words.length;
		verseWordCountCache.set(key, count);
		return count;
	};

	const coverageGapIndices = await detectCoverageGapIndices(orderedSegments, {
		getVerseWordCount,
		getVerseCount: (surah) => Quran.getVerseCount(surah),
		getSurahCount: () => Quran.getSurahs().length
	});

	const segmentErrors: string[] = [];
	for (let segmentIndex = 0; segmentIndex < orderedSegments.length; segmentIndex += 1) {
		const segment = orderedSegments[segmentIndex];
		if (segment.error) {
			console.warn('Segment has error:', segment);
			segmentErrors.push(segment.error);
			continue;
		}

		const startMs: number = Math.max(0, Math.round((segment.time_from ?? 0) * 1000));
		const endMs: number = Math.max(startMs, Math.round((segment.time_to ?? 0) * 1000));
		const confidence: number | null = segment.confidence ?? null;
		const isLowConfidence: boolean = segment.confidence !== undefined && segment.confidence <= 0.75;
		const needsCoverageReview: boolean =
			coverageGapIndices.has(segmentIndex) ||
			segment.has_missing_words === true ||
			segment.potentially_undersegmented === true;

		const predefinedType: PredefinedType | null = getPredefinedType(
			segment.ref_from,
			segment.special_type
		);
		if (predefinedType) {
			const clip = new PredefinedSubtitleClip(
				startMs,
				endMs,
				predefinedType,
				undefined,
				true,
				confidence
			);
			subtitleTrack.clips.push(clip);
			const storedAlignedSegment = buildStoredAlignedSegment(
				clip.id,
				'Pre-defined Subtitle',
				startMs,
				endMs,
				segment,
				getSegmentWords(segment)
			);
			if (storedAlignedSegment) {
				storedAlignedSegments.push(storedAlignedSegment);
			}
			segmentsApplied += 1;
			if (isLowConfidence) lowConfidenceSegments += 1;
			if (clip.needsReview) reviewSegments += 1;
			continue;
		}

		const startRef: VerseRef | null = parseVerseRef(segment.ref_from);
		const endRef: VerseRef | null = parseVerseRef(segment.ref_to);
		if (!startRef || !endRef) {
			console.warn('Invalid verse reference:', segment);
			continue;
		}

		const isCrossVerse = startRef.surah !== endRef.surah || startRef.verse !== endRef.verse;
		if (isCrossVerse && startRef.surah === endRef.surah && startRef.verse <= endRef.verse) {
			console.warn('Cross-verse segment detected, splitting into multiple clips', {
				segment,
				startRef,
				endRef
			});

			const splitDefinitions: Array<{
				startMs: number;
				endMs: number;
				surah: number;
				verseNumber: number;
				startIndex: number;
				endIndex: number;
				wordCount: number;
				needsReview: boolean;
			}> = [];
			let splitNeedsReview = false;

			for (let verseNumber = startRef.verse; verseNumber <= endRef.verse; verseNumber += 1) {
				const verse = await Quran.getVerse(startRef.surah, verseNumber);
				if (!verse) {
					console.warn('Verse not found for cross-verse segment:', { segment, verseNumber });
					continue;
				}

				const verseWordCount = verse.words.length;
				if (verseWordCount === 0) {
					console.error('Verse has no word data in cross-verse segment', { segment, verseNumber });
					continue;
				}

				const clampIndex = (value: number) => Math.min(Math.max(value, 0), verseWordCount - 1);
				let startIndex = 0;
				let endIndex = verseWordCount - 1;
				let needsReview = false;

				if (verseNumber === startRef.verse) {
					const rawStartIndex = startRef.word - 1;
					startIndex = clampIndex(rawStartIndex);
					if (rawStartIndex < 0 || rawStartIndex >= verseWordCount) needsReview = true;
				}

				if (verseNumber === endRef.verse) {
					const rawEndIndex = endRef.word - 1;
					endIndex = clampIndex(rawEndIndex);
					if (rawEndIndex < 0 || rawEndIndex >= verseWordCount) needsReview = true;
				}

				if (startIndex > endIndex) {
					needsReview = true;
					[startIndex, endIndex] = [endIndex, startIndex];
				}

				splitNeedsReview = splitNeedsReview || needsReview;
				splitDefinitions.push({
					startMs,
					endMs,
					surah: startRef.surah,
					verseNumber,
					startIndex,
					endIndex,
					wordCount: endIndex - startIndex + 1,
					needsReview
				});
			}

			const totalWords = splitDefinitions.reduce((sum, def) => sum + def.wordCount, 0);
			if (splitDefinitions.length > 0 && totalWords > 0) {
				const totalSpan = endMs - startMs + 1;
				let currentStart = startMs;

				for (let i = 0; i < splitDefinitions.length; i += 1) {
					const def = splitDefinitions[i];
					const remainingParts = splitDefinitions.length - i;
					const remainingSpan = endMs - currentStart + 1;
					const minRemaining = remainingParts - 1;
					let length = remainingSpan;

					if (i < splitDefinitions.length - 1) {
						const rawLength = Math.round((def.wordCount / totalWords) * totalSpan);
						const maxLength = Math.max(1, remainingSpan - minRemaining);
						length = Math.min(Math.max(1, rawLength), maxLength);
					}

					def.startMs = currentStart;
					def.endMs = currentStart + length - 1;
					currentStart = def.endMs + 1;
				}

				for (const def of splitDefinitions) {
					const verse = await Quran.getVerse(def.surah, def.verseNumber);
					if (!verse) continue;
					await pushSubtitleClip({
						segment,
						startMs: def.startMs,
						endMs: def.endMs,
						surah: def.surah,
						verseNumber: def.verseNumber,
						startIndex: def.startIndex,
						endIndex: def.endIndex,
						verse,
						confidence,
						isLowConfidence,
						needsReview: splitNeedsReview || def.needsReview,
						needsCoverageReview
					});
				}
				continue;
			}
		}

		const verse = await Quran.getVerse(startRef.surah, startRef.verse);
		if (!verse) {
			console.warn('Verse not found for segment:', segment);
			continue;
		}

		const verseWordCount = verse.words.length;
		if (verseWordCount === 0) {
			console.error('Verse has no word data, skipping segment', { segment, startRef, endRef });
			continue;
		}

		const clampIndex = (value: number) => Math.min(Math.max(value, 0), verseWordCount - 1);
		const rawStartIndex = startRef.word - 1;
		const rawEndIndex = endRef.word - 1;
		let startIndex = clampIndex(rawStartIndex);
		let endIndex = clampIndex(rawEndIndex);
		let clipNeedsReview = false;

		if (
			rawStartIndex < 0 ||
			rawStartIndex >= verseWordCount ||
			rawEndIndex < 0 ||
			rawEndIndex >= verseWordCount
		) {
			clipNeedsReview = true;
		}

		if (startIndex > endIndex) {
			clipNeedsReview = true;
			[startIndex, endIndex] = [endIndex, startIndex];
		}

		await pushSubtitleClip({
			segment,
			startMs,
			endMs,
			surah: startRef.surah,
			verseNumber: startRef.verse,
			startIndex,
			endIndex,
			verse,
			confidence,
			isLowConfidence,
			needsReview: clipNeedsReview,
			needsCoverageReview
		});
	}

	if (segmentsApplied === 0 && segmentErrors.length > 0) {
		const uniqueErrors = [...new Set(segmentErrors)];
		return {
			status: 'failed',
			message: `All segments failed to process: ${uniqueErrors.join(', ')}`
		};
	}

	subtitleTrack.clips.sort((a, b) => a.startTime - b.startTime);
	const subtitleClips = subtitleTrack.clips.filter(
		(clip) => clip.type === 'Subtitle' || clip.type === 'Pre-defined Subtitle'
	) as Array<SubtitleClip | PredefinedSubtitleClip>;
	closeSmallSubtitleGaps(subtitleClips, SMALL_GAP_MS);

	if (fillBySilence) {
		subtitleTrack.clips = insertSilenceClips(subtitleClips, SMALL_GAP_MS);
		if (extendBeforeSilence && extendBeforeSilenceMs > 0) {
			extendSubtitlesBeforeSilence(
				subtitleTrack.clips as Array<SubtitleClip | PredefinedSubtitleClip | SilenceClip>,
				extendBeforeSilenceMs
			);
		}
	} else {
		extendSubtitlesToFillGaps(subtitleClips);
		subtitleTrack.clips = subtitleClips;
	}
	subtitleTrack.clips.sort((a, b) => a.startTime - b.startTime);
	for (const storedAlignedSegment of storedAlignedSegments) {
		const clip = subtitleTrack.getClipById(storedAlignedSegment.clipId) as
			| SubtitleClip
			| PredefinedSubtitleClip
			| null;
		if (!clip) continue;
		storedAlignedSegment.startMs = clip.startTime;
		storedAlignedSegment.endMs = clip.endTime;
	}

	const verseRange: VerseRange = VerseRange.getVerseRange(0, subtitleTrack.getDuration().ms);
	globalState.currentProject?.detail.updateVideoDetailAttributes();
	globalState.updateVideoPreviewUI();
	globalState.getSubtitlesEditorState.initialLowConfidenceCount = reviewSegments;
	globalState.getSubtitlesEditorState.segmentationContext = {
		audioId: response.audio_id ?? null,
		source: segmentationSource,
		effectiveMode,
		modelName: modelName ?? null,
		device: device ?? null,
		includeWbwTimestamps,
		alignedSegments: storedAlignedSegments
	};

	if (payloadForLog !== undefined) {
		console.log('Quran segmentation payload:', payloadForLog);
	}

	return {
		status: 'completed',
		segmentsApplied,
		lowConfidenceSegments,
		coverageGapSegments,
		verseRange,
		fallbackToCloud,
		cloudGpuFallbackToCpu,
		warning: response.warning ?? warningOverride,
		requestedMode,
		effectiveMode
	};
}

/**
 * Enrichit une réponse de segmentation avec des timestamps MFA quand ils sont absents.
 *
 * @param {SegmentationResponse} response Réponse brute ou partiellement enrichie.
 * @returns {Promise<SegmentationResponse>} Réponse avec mots MFA si disponibles.
 */
export async function enrichSegmentationResponseWithWordTimestamps(
	response: SegmentationResponse
): Promise<SegmentationResponse> {
	const segments = response.segments ?? [];
	if (segments.length === 0) return response;
	if (segments.every((segment) => (segment.words?.length ?? 0) > 0)) return response;

	try {
		let mfaSource: 'session' | 'direct';
		let mfaResponse: SegmentationResponse;
		if (response.audio_id) {
			try {
				mfaSource = 'session';
				mfaResponse = await getSegmentationMfaTimestampsSession(response.audio_id, segments);
			} catch (error) {
				console.warn(
					'[AutoSegmentation] MFA session enrichment failed, falling back to direct MFA:',
					error
				);
				mfaSource = 'direct';
				mfaResponse = await getSegmentationMfaTimestampsDirect(segments);
			}
		} else {
			mfaSource = 'direct';
			mfaResponse = await getSegmentationMfaTimestampsDirect(segments);
		}

		const mfaSegments = normalizeMfaSegments(mfaResponse.segments ?? [], segments);
		console.log('[AutoSegmentation] MFA timings payload:', {
			source: mfaSource,
			audioId: response.audio_id ?? mfaResponse.audio_id ?? null,
			segments: mfaSegments.map((segment) => ({
				segment: segment.segment,
				refFrom: segment.ref_from ?? null,
				refTo: segment.ref_to ?? null,
				words: (segment.words ?? []).map((word) => ({
					location: word.location,
					start: word.start,
					end: word.end,
					word: word.word ?? null
				}))
			}))
		});
		if (mfaSegments.length === 0) {
			console.warn('[AutoSegmentation] MFA enrichment returned no segments.', {
				source: mfaSource,
				audioId: response.audio_id ?? mfaResponse.audio_id ?? null
			});
			return response;
		}

		const mfaBySegment = new Map<number, SegmentationSegment>();
		for (const segment of mfaSegments) {
			if (segment.segment !== undefined) {
				mfaBySegment.set(segment.segment, segment);
			}
		}

		const enrichedResponse = {
			...response,
			audio_id: response.audio_id ?? mfaResponse.audio_id,
			segments: segments.map((segment, index) => {
				const segmentIndex = segment.segment;
				const mfaSegmentByIndex = mfaSegments[index];
				const mfaSegment =
					mfaSegmentByIndex ??
					(segmentIndex !== undefined ? mfaBySegment.get(segmentIndex) : undefined);
				if (!mfaSegment) return segment;
				return {
					...segment,
					words: mfaSegment.words ?? segment.words ?? []
				};
			})
		};

		const segmentsWithoutWords = (enrichedResponse.segments ?? [])
			.filter((segment) => (segment.words?.length ?? 0) === 0)
			.map((segment) => ({
				segment: segment.segment,
				refFrom: segment.ref_from ?? null,
				refTo: segment.ref_to ?? null
			}));
		if (segmentsWithoutWords.length > 0) {
			console.warn('[AutoSegmentation] Some segments still have no MFA word timestamps.', {
				source: mfaSource,
				segmentsWithoutWords
			});
		}

		return enrichedResponse;
	} catch (error) {
		console.warn('[AutoSegmentation] Failed to enrich segmentation with MFA timestamps:', error);
		return response;
	}
}

/**
 * Compte le nombre de mots Quran couverts par un sous-titre.
 *
 * @param {SubtitleClip} clip Sous-titre Quran à mesurer.
 * @returns {number} Nombre de mots dans la plage du clip.
 */
export function getSubtitleClipWordCount(clip: SubtitleClip): number {
	return Math.max(0, clip.endWordIndex - clip.startWordIndex + 1);
}

/**
 * Retourne les segments Quran considérés comme longs pour un seuil donné.
 *
 * @param {number} minWords Seuil minimal de mots.
 * @returns {SubtitleClip[]} Liste triée des sous-titres trop longs.
 */
export function getLongSubtitleClips(minWords: number): SubtitleClip[] {
	return globalState.getSubtitleClips
		.filter((clip) => getSubtitleClipWordCount(clip) >= Math.max(1, minWords))
		.sort((left, right) => left.startTime - right.startTime);
}

/**
 * Marque ou démarque les segments trop longs selon le seuil courant.
 *
 * @param {number} minWords Seuil minimal de mots.
 * @returns {number} Nombre de segments marqués.
 */
export function markLongSegmentsForReview(minWords: number): number {
	const threshold = Math.max(1, minWords);
	let markedCount = 0;

	for (const clip of globalState.getSubtitleClips) {
		const isLong = getSubtitleClipWordCount(clip) >= threshold;
		const hasOtherActiveReview = clip.needsReview || clip.needsCoverageReview;

		if (!isLong) {
			clip.needsLongReview = false;
			continue;
		}

		if (clip.hasBeenVerified !== true && hasOtherActiveReview) {
			continue;
		}

		// Si le clip a déjà été vérifié, et que c'était auparavant un segment low confidence ou missing words
		if (clip.hasBeenVerified === true) {
			// On convertit un segment déjà vérifié en segment long, sans garder l'ancien motif.
			clip.needsReview = false;
			clip.needsCoverageReview = false;
			clip.hasBeenVerified = false;
		}

		clip.needsLongReview = true;
		markedCount += 1;
	}

	return markedCount;
}

/**
 * Efface tous les marquages rose "too long".
 */
export function clearLongSegmentsReview(): void {
	for (const clip of globalState.getSubtitleClips) {
		clip.needsLongReview = false;
	}
}

/**
 * Reconstruit le contexte runtime à partir des clips actuellement présents sur la timeline.
 *
 * @param {boolean} preserveAudioId Si true, conserve l'audio_id courant.
 */
function refreshSegmentationContextFromTrack(preserveAudioId: boolean): void {
	const currentContext = globalState.getSubtitlesEditorState.segmentationContext;
	const existingById = new Map(
		currentContext.alignedSegments.map((segment) => [segment.clipId, segment])
	);
	const alignedSegments: StoredAlignedSegment[] = [];

	for (const rawClip of globalState.getSubtitleTrack.clips) {
		if (rawClip instanceof SubtitleClip && rawClip.alignmentMetadata) {
			const metadata = rawClip.alignmentMetadata;
			alignedSegments.push({
				clipId: rawClip.id,
				type: 'Subtitle',
				startMs: rawClip.startTime,
				endMs: rawClip.endTime,
				segment: metadata.segment,
				refFrom: metadata.refFrom,
				refTo: metadata.refTo,
				matchedText: metadata.matchedText,
				specialType: metadata.specialType,
				words: metadata.words.map((word) => ({ ...word }))
			});
			continue;
		}

		if (rawClip instanceof PredefinedSubtitleClip) {
			const existing = existingById.get(rawClip.id);
			if (existing) {
				alignedSegments.push({
					...existing,
					startMs: rawClip.startTime,
					endMs: rawClip.endTime
				});
			}
		}
	}

	globalState.getSubtitlesEditorState.segmentationContext = {
		...currentContext,
		audioId: preserveAudioId ? currentContext.audioId : null,
		includeWbwTimestamps: currentContext.includeWbwTimestamps,
		alignedSegments
	};
}

/**
 * Applique silencieusement une nouvelle plage de mots à un clip Quran existant.
 *
 * @param {SubtitleClip} clip Clip à mettre à jour.
 * @param {Awaited<ReturnType<typeof Quran.getVerse>>} verse Verset source.
 * @param {number} startWordIndex Index du premier mot.
 * @param {number} endWordIndex Index du dernier mot.
 */
async function hydrateSubtitleClipRange(
	clip: SubtitleClip,
	verse: Awaited<ReturnType<typeof Quran.getVerse>>,
	startWordIndex: number,
	endWordIndex: number
): Promise<void> {
	if (!verse) return;

	clip.startWordIndex = startWordIndex;
	clip.endWordIndex = endWordIndex;
	clip.text = verse.getArabicTextBetweenTwoIndexes(startWordIndex, endWordIndex);
	clip.indopakText = verse.getArabicTextBetweenTwoIndexes(startWordIndex, endWordIndex, 'indopak');
	clip.wbwTranslation = verse.getWordByWordTranslationBetweenTwoIndexes(
		startWordIndex,
		endWordIndex
	);
	const subtitlesProperties = await globalState.getSubtitleTrack.getSubtitlesProperties(
		verse,
		startWordIndex,
		endWordIndex,
		clip.surah
	);
	clip.isFullVerse = subtitlesProperties.isFullVerse;
	clip.isLastWordsOfVerse = subtitlesProperties.isLastWordsOfVerse;
	clip.translations = subtitlesProperties.translations;
	clip.clearArabicInlineStyles();
}

/**
 * Découpe localement les métadonnées d'alignement d'un clip Quran autour d'un mot.
 *
 * @param {SubtitleClip} clip Clip source.
 * @param {number} splitWordIndex Index du dernier mot de la partie gauche.
 * @returns {Promise<SubtitleClip | null>} Nouveau clip droit créé, ou null si impossible.
 */
async function splitSubtitleClipLocally(
	clip: SubtitleClip,
	splitWordIndex: number
): Promise<SubtitleClip | null> {
	const metadata = clip.alignmentMetadata;
	if (!metadata) return null;
	if (splitWordIndex < clip.startWordIndex || splitWordIndex >= clip.endWordIndex) return null;

	const splitLocation = `${clip.surah}:${clip.verse}:${splitWordIndex + 1}`;
	const splitWord = metadata.words.find((word) => word.location === splitLocation);
	if (!splitWord) return null;

	const splitAbsoluteMs = Math.round((metadata.timeFrom + splitWord.end) * 1000);
	if (splitAbsoluteMs - clip.startTime < 100 || clip.endTime - splitAbsoluteMs < 100) {
		return null;
	}

	const verse = await Quran.getVerse(clip.surah, clip.verse);
	if (!verse) return null;

	const originalEndTime = clip.endTime;
	const originalStartWordIndex = clip.startWordIndex;
	const originalEndWordIndex = clip.endWordIndex;
	const originalMetadata = metadata;
	const originalNeedsReview = clip.needsReview;
	const originalNeedsCoverageReview = clip.needsCoverageReview;
	const originalNeedsLongReview = clip.needsLongReview;
	const originalHasBeenVerified = clip.hasBeenVerified;
	const originalComeFromIA = clip.comeFromIA;
	const originalConfidence = clip.confidence;

	clip.setEndTimeSilently(splitAbsoluteMs);
	await hydrateSubtitleClipRange(clip, verse, originalStartWordIndex, splitWordIndex);

	const rightClip = clip.cloneWithTimes(splitAbsoluteMs, originalEndTime);
	rightClip.comeFromIA = originalComeFromIA;
	rightClip.confidence = originalConfidence;
	rightClip.needsReview = originalNeedsReview;
	rightClip.needsCoverageReview = originalNeedsCoverageReview;
	rightClip.needsLongReview = originalNeedsLongReview;
	rightClip.hasBeenVerified = originalHasBeenVerified;
	await hydrateSubtitleClipRange(rightClip, verse, splitWordIndex + 1, originalEndWordIndex);

	const splitOffsetS = splitWord.end;
	const leftWords = originalMetadata.words
		.filter((word) => {
			const wordIndex = Number(word.location.split(':')[2]);
			return Number.isFinite(wordIndex) && wordIndex <= splitWordIndex + 1;
		})
		.map((word) => ({ ...word }));
	const rightWords = originalMetadata.words
		.filter((word) => {
			const wordIndex = Number(word.location.split(':')[2]);
			return Number.isFinite(wordIndex) && wordIndex > splitWordIndex + 1;
		})
		.map((word) => ({
			...word,
			start: Math.max(0, word.start - splitOffsetS),
			end: Math.max(0, word.end - splitOffsetS)
		}));

	clip.alignmentMetadata = {
		...originalMetadata,
		refFrom: `${clip.surah}:${clip.verse}:${originalStartWordIndex + 1}`,
		refTo: `${clip.surah}:${clip.verse}:${splitWordIndex + 1}`,
		matchedText: verse.getArabicTextBetweenTwoIndexes(originalStartWordIndex, splitWordIndex),
		timeTo: splitAbsoluteMs / 1000,
		words: leftWords
	};
	rightClip.alignmentMetadata = {
		...originalMetadata,
		refFrom: `${rightClip.surah}:${rightClip.verse}:${rightClip.startWordIndex + 1}`,
		refTo: `${rightClip.surah}:${rightClip.verse}:${rightClip.endWordIndex + 1}`,
		matchedText: verse.getArabicTextBetweenTwoIndexes(
			rightClip.startWordIndex,
			rightClip.endWordIndex
		),
		timeFrom: splitAbsoluteMs / 1000,
		words: rightWords
	};

	const clipIndex = globalState.getSubtitleTrack.clips.findIndex(
		(candidate) => candidate.id === clip.id
	);
	if (clipIndex === -1) return null;
	globalState.getSubtitleTrack.clips.splice(clipIndex + 1, 0, rightClip);
	return rightClip;
}

/**
 * Extrait l'index de mot Quran (0-based) à partir d'une location MFA.
 *
 * @param {string} location Clé de mot au format `surah:verse:word`.
 * @returns {number | null} Index 0-based, ou null si invalide.
 */
function _getWordIndexFromLocation(location: string): number | null {
	const wordIndex = Number(location.split(':')[2]);
	if (!Number.isFinite(wordIndex) || wordIndex <= 0) return null;
	return wordIndex - 1;
}

/**
 * Cherche le meilleur point de coupe sur un waqf proche d'une cible.
 *
 * @param {SubtitleClip} clip Clip Quran à inspecter.
 * @param {Awaited<ReturnType<typeof Quran.getVerse>>} verse Verset source.
 * @param {number} targetIndex Index cible autour duquel couper.
 * @returns {number | null} Index du dernier mot de la partie gauche.
 */
function findPreferredStopSplitIndex(
	clip: SubtitleClip,
	verse: Awaited<ReturnType<typeof Quran.getVerse>>,
	targetIndex: number
): number | null {
	if (!verse) return null;

	const waqfPriority = ['ۗ', 'ۚ', 'ۖ'];
	for (const waqf of waqfPriority) {
		const candidates: number[] = [];
		for (let index = clip.startWordIndex; index < clip.endWordIndex; index += 1) {
			if (verse.words[index]?.arabic.includes(waqf)) {
				candidates.push(index);
			}
		}

		if (candidates.length > 0) {
			return [...candidates].sort(
				(left, right) => Math.abs(left - targetIndex) - Math.abs(right - targetIndex)
			)[0];
		}
	}

	return null;
}

/**
 * Calcule le meilleur mot de coupe pour la subdivision locale d'un clip.
 *
 * @param {SubtitleClip} clip Clip Quran à subdiviser.
 * @param {number | null} maxWords Limite de mots active, ou null.
 * @param {number | null} maxDurationSeconds Limite de durée active, ou null.
 * @param {boolean} onlyStopSigns Si true, interdit le fallback hors waqf.
 * @returns {Promise<number | null>} Index du dernier mot de gauche, ou null.
 */
async function getAutomaticSplitWordIndex(
	clip: SubtitleClip,
	maxWords: number | null,
	maxDurationSeconds: number | null,
	onlyStopSigns: boolean
): Promise<number | null> {
	const wordCount = getSubtitleClipWordCount(clip);
	const exceedsWords = maxWords !== null && wordCount > maxWords;
	const exceedsDuration = maxDurationSeconds !== null && clip.duration / 1000 > maxDurationSeconds;
	if (!exceedsWords && !exceedsDuration) return null;
	if (!clip.alignmentMetadata || wordCount < 2) return null;

	const verse = await Quran.getVerse(clip.surah, clip.verse);
	if (!verse) return null;

	let targetIndex = clip.startWordIndex;
	if (exceedsWords && maxWords !== null) {
		targetIndex = Math.min(clip.startWordIndex + maxWords - 1, clip.endWordIndex - 1);
	} else {
		targetIndex = Math.min(
			clip.startWordIndex + Math.max(1, Math.floor(wordCount / 2)) - 1,
			clip.endWordIndex - 1
		);
	}

	const waqfIndex = findPreferredStopSplitIndex(clip, verse, targetIndex);
	if (waqfIndex !== null) return waqfIndex;
	return onlyStopSigns ? null : targetIndex;
}

/**
 * Coupe automatiquement un sous-titre Quran au mot fourni.
 *
 * @param {SubtitleClip} clip Clip Quran actuellement édité.
 * @param {number} splitWordIndex Index du dernier mot de la partie gauche.
 * @returns {Promise<boolean>} True si la coupe a été appliquée.
 */
export async function automaticSplitSubtitleAtWord(
	clip: SubtitleClip,
	splitWordIndex: number
): Promise<boolean> {
	const metadata = clip.alignmentMetadata;
	if (!metadata) {
		console.warn('[AutoSegmentation] Automatic split aborted: missing alignment metadata.', {
			clipId: clip.id,
			surah: clip.surah,
			verse: clip.verse,
			splitWordIndex
		});
		return false;
	}

	if (metadata.words.length === 0) {
		console.warn(
			'[AutoSegmentation] Automatic split aborted: no MFA word timestamps are available for this clip.',
			{
				clipId: clip.id,
				surah: clip.surah,
				verse: clip.verse,
				splitWordIndex,
				segment: metadata.segment
			}
		);
		return false;
	}

	const splitLocation = `${clip.surah}:${clip.verse}:${splitWordIndex + 1}`;
	const splitWord = metadata.words.find((word) => word.location === splitLocation);
	if (!splitWord) {
		console.warn(
			'[AutoSegmentation] Automatic split aborted: selected word timestamp was not found in alignment metadata.',
			{
				clipId: clip.id,
				splitWordIndex,
				splitLocation,
				availableLocations: metadata.words.map((word) => word.location)
			}
		);
		return false;
	}

	const splitTimeMs = Math.round((metadata.timeFrom + splitWord.end) * 1000);
	if (splitTimeMs - clip.startTime < 100 || clip.endTime - splitTimeMs < 100) {
		console.warn(
			'[AutoSegmentation] Automatic split aborted: computed split point would create a segment shorter than 100ms.',
			{
				clipId: clip.id,
				splitWordIndex,
				splitTimeMs,
				clipStartTime: clip.startTime,
				clipEndTime: clip.endTime
			}
		);
		return false;
	}

	const rightClip = await splitSubtitleClipLocally(clip, splitWordIndex);
	if (!rightClip) {
		console.warn('[AutoSegmentation] Local split failed.', {
			clipId: clip.id,
			splitWordIndex,
			splitLocation
		});
		return false;
	}

	const shouldRefreshLongMarks = globalState.getSubtitleClips.some(
		(candidate) => candidate.needsLongReview
	);
	if (shouldRefreshLongMarks) {
		markLongSegmentsForReview(globalState.getSubtitlesEditorState.longSegmentMinWords);
	}

	refreshSegmentationContextFromTrack(false);
	globalState.currentProject?.detail.updateVideoDetailAttributes();
	globalState.updateVideoPreviewUI();
	globalState.getSubtitlesEditorState.editSubtitle = rightClip;
	return true;
}

/**
 * Subdivise localement tous les sous-titres Quran dépassant les critères actifs.
 *
 * @returns {Promise<number>} Nombre de coupes appliquées.
 */
export async function subdivideLongSubtitleSegments(): Promise<number> {
	const state = globalState.getSubtitlesEditorState;
	const maxWords =
		state.subdivideMaxWordsPerSegment > SUBDIVIDE_MAX_WORDS_DISABLED
			? null
			: state.subdivideMaxWordsPerSegment;
	const maxDurationSeconds =
		state.subdivideMaxDurationPerSegment > SUBDIVIDE_MAX_DURATION_DISABLED
			? null
			: state.subdivideMaxDurationPerSegment;

	let splitCount = 0;
	let madeProgress = true;
	while (madeProgress) {
		madeProgress = false;
		const clips = [...globalState.getSubtitleClips].sort(
			(left, right) => left.startTime - right.startTime
		);
		for (const clip of clips) {
			const splitWordIndex = await getAutomaticSplitWordIndex(
				clip,
				maxWords,
				maxDurationSeconds,
				state.subdivideOnlySplitAtStopSigns
			);
			if (splitWordIndex === null) continue;

			const rightClip = await splitSubtitleClipLocally(clip, splitWordIndex);
			if (!rightClip) continue;

			splitCount += 1;
			madeProgress = true;
			break;
		}
	}

	if (splitCount > 0) {
		markLongSegmentsForReview(state.longSegmentMinWords);
		refreshSegmentationContextFromTrack(false);
		globalState.currentProject?.detail.updateVideoDetailAttributes();
		globalState.updateVideoPreviewUI();
	}

	return splitCount;
}

/**
 * Apply segmentation output to the project subtitle track.
 *
 * Steps:
 * - Confirm overwrite if subtitles already exist
 * - Invoke Rust command (resampling + segmentation API)
 * - Convert segments into SubtitleClip / PredefinedSubtitleClip
 * - Normalize small gaps + insert silence clips
 * - Refresh project UI and return summary
 *
 * @param {AutoSegmentationOptions} options - Segmentation tuning.
 * @param {SegmentationMode} mode - Processing mode ('api' or 'local'). If not provided, uses preferred mode.
 * @returns {Promise<AutoSegmentationResult | null>} Result summary or null on error.
 */
export async function runAutoSegmentation(
	options: AutoSegmentationOptions = {},
	mode?: SegmentationMode
): Promise<AutoSegmentationResult | null> {
	const minSilenceMs: number = options.minSilenceMs ?? 200;
	const minSpeechMs: number = options.minSpeechMs ?? 1000;
	const padMs: number = options.padMs ?? 100;
	const includeWbwTimestamps: boolean = options.includeWbwTimestamps ?? false;
	const localAsrMode: LocalAsrMode = options.localAsrMode ?? 'legacy_whisper';
	const legacyWhisperModel: LegacyWhisperModelSize = options.legacyWhisperModel ?? 'base';
	const multiAlignerModel: MultiAlignerModel = options.multiAlignerModel ?? 'Base';
	const cloudModel: MultiAlignerModel = options.cloudModel ?? 'Base';
	const device: SegmentationDevice = options.device ?? 'GPU';
	const hfToken: string = (options.hfToken ?? '').trim();
	const allowCloudFallback: boolean = options.allowCloudFallback ?? true;
	const fillBySilence: boolean = options.fillBySilence ?? true; //  Par défaut, on insère des SilenceClip
	const extendBeforeSilence: boolean = options.extendBeforeSilence ?? false;
	const extendBeforeSilenceMs: number = options.extendBeforeSilenceMs ?? 0;

	// Determine mode if not specified
	const requestedMode: SegmentationMode = mode ?? (await getPreferredSegmentationMode());
	const allowCloudFallbackEffective: boolean = allowCloudFallback && requestedMode !== 'local';
	let effectiveMode: SegmentationMode = requestedMode;
	let fallbackToCloud = false;
	const cloudGpuFallbackToCpu = false;
	console.log(
		`[AutoSegmentation] requestedMode=${requestedMode} localAsrMode=${localAsrMode} device=${device} allowCloudFallback=${allowCloudFallbackEffective}`
	);

	const audioInfo: AutoSegmentationAudioInfo | null = getAutoSegmentationAudioInfo();
	const audioClips = getAutoSegmentationAudioClips();
	if (!audioInfo || audioClips.length === 0) {
		const message = 'No audio clip found in the project.';
		return { status: 'failed', message };
	}

	const subtitleTrack = globalState.getSubtitleTrack;
	if (subtitleTrack.clips.length > 0) {
		const confirmOverwrite: boolean = await ModalManager.confirmModal(
			'There are already subtitles in this project. This process will override them. Continue?',
			true
		);

		if (!confirmOverwrite) return { status: 'cancelled' };
	}

	try {
		const basePayload = {
			audioPath: audioInfo.filePath,
			audioClips: audioClips.map((clip) => ({
				path: clip.filePath,
				startMs: clip.startMs,
				endMs: clip.endMs
			})),
			minSilenceMs,
			minSpeechMs,
			padMs
		};

		const invokeCloudWithDevice = async (targetDevice: SegmentationDevice): Promise<unknown> =>
			await invoke('segment_quran_audio', {
				...basePayload,
				modelName: cloudModel,
				device: targetDevice
			});

		const invokeCloud = async (): Promise<unknown> => await invokeCloudWithDevice(device);

		const invokeLocal = async (): Promise<unknown> => {
			if (localAsrMode === 'legacy_whisper') {
				return await invoke('segment_quran_audio_local', {
					...basePayload,
					whisperModel: legacyWhisperModel
				});
			}

			return await invoke('segment_quran_audio_local_multi', {
				...basePayload,
				modelName: multiAlignerModel,
				device,
				hfToken
			});
		};

		let fallbackWarning: string | undefined;
		let payload: unknown;
		if (effectiveMode === 'api') {
			payload = await invokeCloud();
		} else {
			try {
				payload = await invokeLocal();
			} catch (localError) {
				if (!allowCloudFallbackEffective) {
					console.warn('[AutoSegmentation] Local mode failed (no cloud fallback):', localError);
					throw localError;
				}

				const localMessage = localError instanceof Error ? localError.message : String(localError);
				console.warn('[AutoSegmentation] Local mode failed, falling back to cloud:', localMessage);
				fallbackWarning = `Local mode failed and was switched to Cloud: ${localMessage}`;
				fallbackToCloud = true;
				effectiveMode = 'api';
				payload = await invokeCloud();
			}
		}

		if (effectiveMode === 'local') {
			console.log('[AutoSegmentation] Local segmentation raw response:', payload);
		}

		const rawResponse: SegmentationResponse = payload as SegmentationResponse;
		const response = includeWbwTimestamps
			? await enrichSegmentationResponseWithWordTimestamps(rawResponse)
			: rawResponse;
		const contextModelName =
			effectiveMode === 'api'
				? cloudModel
				: localAsrMode === 'multi_aligner'
					? multiAlignerModel
					: legacyWhisperModel;
		return await applySegmentationResponseToProject({
			response,
			fillBySilence,
			extendBeforeSilence,
			extendBeforeSilenceMs,
			fallbackToCloud,
			cloudGpuFallbackToCpu,
			requestedMode,
			effectiveMode,
			segmentationSource: effectiveMode === 'api' ? 'api' : 'local',
			includeWbwTimestamps,
			modelName: contextModelName,
			device,
			warningOverride: fallbackWarning,
			payloadForLog: payload
		});
	} catch (error) {
		console.error('Segmentation request failed:', error);
		const errorMessage = error instanceof Error ? error.message : String(error);
		return { status: 'failed', message: errorMessage };
	}
}

export function getAutoSegmentationAudioDurationS(): number {
	const clips = getAutoSegmentationAudioClips();
	if (clips.length === 0) return 0;
	const totalMs = clips.reduce((sum, clip) => sum + Math.max(0, clip.endMs - clip.startMs), 0);
	return totalMs / 1000;
}

export async function estimateSegmentationDuration(options: {
	endpoint?: string;
	audioDurationS: number;
	modelName: MultiAlignerModel;
	device: SegmentationDevice;
}): Promise<DurationEstimateResult | null> {
	const endpoint = options.endpoint ?? 'process_audio_session';
	if (!Number.isFinite(options.audioDurationS) || options.audioDurationS <= 0) return null;
	try {
		const result = await invoke('estimate_segmentation_duration', {
			endpoint,
			audioDurationS: options.audioDurationS,
			modelName: options.modelName,
			device: options.device
		});
		return result as DurationEstimateResult;
	} catch (error) {
		console.warn('[AutoSegmentation] Failed to estimate duration:', error);
		return null;
	}
}

/**
 * Recupere les timestamps MFA pour une session cloud existante.
 *
 * @param {string} audioId Identifiant de session cloud.
 * @param {SegmentationSegment[]} segments Segments a enrichir.
 * @returns {Promise<SegmentationResponse>} Reponse MFA normalisee.
 */
export async function getSegmentationMfaTimestampsSession(
	audioId: string,
	segments: SegmentationSegment[]
): Promise<SegmentationResponse> {
	return (await invoke('get_segmentation_mfa_timestamps_session', {
		audioId,
		segments,
		granularity: 'words'
	})) as SegmentationResponse;
}

/**
 * Recupere les timestamps MFA a partir de l'audio courant du projet.
 *
 * @param {SegmentationSegment[]} segments Segments a enrichir.
 * @returns {Promise<SegmentationResponse>} Reponse MFA normalisee.
 */
export async function getSegmentationMfaTimestampsDirect(
	segments: SegmentationSegment[]
): Promise<SegmentationResponse> {
	const audioInfo = getAutoSegmentationAudioInfo();
	const audioClips = getAutoSegmentationAudioClips();
	if (!audioInfo || audioClips.length === 0) {
		throw new Error('No audio clip found in the project.');
	}

	return (await invoke('get_segmentation_mfa_timestamps_direct', {
		audioPath: audioInfo.filePath,
		audioClips: audioClips.map((clip) => ({
			path: clip.filePath,
			startMs: clip.startMs,
			endMs: clip.endMs
		})),
		segments,
		granularity: 'words'
	})) as SegmentationResponse;
}

/**
 * Apply subtitles from a Hugging Face Multi-Aligner exported JSON payload.
 *
 * @param {string | unknown} importedPayload - Raw JSON string or parsed JSON object.
 * @param {Pick<AutoSegmentationOptions, 'fillBySilence' | 'extendBeforeSilence' | 'extendBeforeSilenceMs'>} options - Timeline post-processing options.
 * @returns {Promise<AutoSegmentationResult | null>} Result summary or null on unexpected errors.
 */
export async function runAutoSegmentationFromImportedJson(
	importedPayload: string | unknown,
	options: Pick<
		AutoSegmentationOptions,
		'fillBySilence' | 'extendBeforeSilence' | 'extendBeforeSilenceMs'
	> = {}
): Promise<AutoSegmentationResult | null> {
	const fillBySilence: boolean = options.fillBySilence ?? true;
	const extendBeforeSilence: boolean = options.extendBeforeSilence ?? false;
	const extendBeforeSilenceMs: number = options.extendBeforeSilenceMs ?? 0;

	const audioInfo: AutoSegmentationAudioInfo | null = getAutoSegmentationAudioInfo();
	const audioClips = getAutoSegmentationAudioClips();
	if (!audioInfo || audioClips.length === 0) {
		return { status: 'failed', message: 'No audio clip found in the project.' };
	}

	const subtitleTrack = globalState.getSubtitleTrack;
	if (subtitleTrack.clips.length > 0) {
		const confirmOverwrite: boolean = await ModalManager.confirmModal(
			'There are already subtitles in this project. This process will override them. Continue?',
			true
		);
		if (!confirmOverwrite) return { status: 'cancelled' };
	}

	try {
		const parsed = parseImportedSegmentationJson(importedPayload);
		const response = await enrichSegmentationResponseWithWordTimestamps(parsed.response);
		return await applySegmentationResponseToProject({
			response,
			fillBySilence,
			extendBeforeSilence,
			extendBeforeSilenceMs,
			fallbackToCloud: false,
			cloudGpuFallbackToCpu: false,
			requestedMode: 'api',
			effectiveMode: 'api',
			segmentationSource: 'import',
			includeWbwTimestamps: (response.segments ?? []).some(
				(segment) => (segment.words?.length ?? 0) > 0
			),
			modelName: null,
			device: null,
			payloadForLog: importedPayload
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { status: 'failed', message };
	}
}

function markClipTranslationsForReview(clip: SubtitleClip): void {
	if (!globalState.currentProject) return;

	const addedEditions = globalState.getProjectTranslation.addedTranslationEditions;
	if (!addedEditions) return;

	for (const edition of addedEditions) {
		const translation = clip.translations[edition.name];
		if (translation && typeof translation.updateStatus === 'function') {
			translation.updateStatus('to review', edition);
		}
	}
}
/**
 * Handles the "Native" segmentation flow using Mp3Quran timing data.
 */
export async function runNativeSegmentation(
	targetAssetId?: number
): Promise<AutoSegmentationResult | null> {
	// 1. Identify valid audio clip and metadata
	const audioTrack = globalState.getAudioTrack;
	let targetClip: AssetClip | null = null;
	let nativeTimingMeta:
		| {
				provider: 'mp3quran';
				reciterId: number;
				surahId: number;
				moshafId?: number;
		  }
		| {
				provider: 'qdc';
				recitationId: number;
				surahId: number;
		  }
		| null = null;
	let clipStartTime = 0;
	let clipOffset = 0;
	const getClipOffset = (clip: AssetClip): number => {
		if ('offset' in clip && typeof clip.offset === 'number') {
			return clip.offset;
		}
		return 0;
	};

	for (const clip of audioTrack.clips) {
		if (clip instanceof AssetClip) {
			if (typeof targetAssetId === 'number' && clip.assetId !== targetAssetId) {
				continue;
			}
			const asset = globalState.currentProject?.content.getAssetById(clip.assetId);
			if (asset?.metadata?.nativeTiming) {
				const meta = asset.metadata.nativeTiming as Partial<{
					provider: 'mp3quran' | 'qdc';
					reciterId: number;
					recitationId: number;
					surahId: number;
					moshafId?: number;
				}>;
				if (meta.provider === 'mp3quran') {
					if (typeof meta.reciterId !== 'number' || typeof meta.surahId !== 'number') {
						continue;
					}
					nativeTimingMeta = {
						provider: 'mp3quran',
						reciterId: meta.reciterId,
						surahId: meta.surahId,
						moshafId: meta.moshafId
					};
				} else if (meta.provider === 'qdc') {
					if (typeof meta.recitationId !== 'number' || typeof meta.surahId !== 'number') {
						continue;
					}
					nativeTimingMeta = {
						provider: 'qdc',
						recitationId: meta.recitationId,
						surahId: meta.surahId
					};
				} else {
					continue;
				}
				targetClip = clip;
				clipStartTime = clip.startTime;
				clipOffset = getClipOffset(clip);
				break;
			}
			if (asset?.metadata?.mp3Quran) {
				const meta = asset.metadata.mp3Quran as Partial<{
					reciterId: number;
					surahId: number;
					moshafId?: number;
				}>;
				if (typeof meta.reciterId !== 'number' || typeof meta.surahId !== 'number') {
					continue;
				}
				nativeTimingMeta = {
					provider: 'mp3quran',
					reciterId: meta.reciterId,
					surahId: meta.surahId,
					moshafId: meta.moshafId
				};
				targetClip = clip;
				clipStartTime = clip.startTime;
				clipOffset = getClipOffset(clip);
				break;
			}
		}
	}

	if (!targetClip || !nativeTimingMeta) {
		toast.error('No native-timing audio found on timeline.');
		return { status: 'failed', message: 'No native-timing audio found' };
	}

	// 2. Warn about overwriting
	const subtitleTrack = globalState.getSubtitleTrack;
	if (subtitleTrack.clips.length > 0) {
		const confirmOverwrite = await ModalManager.confirmModal(
			'There are already subtitles in this project. This process will replace them with native timing. Continue?',
			true
		);
		if (!confirmOverwrite) return { status: 'cancelled' };
	}

	const surahId = nativeTimingMeta.surahId;

	let toastId: string | undefined;

	try {
		toastId = toast.loading(
			nativeTimingMeta.provider === 'qdc'
				? 'Fetching timing data from Quran.com...'
				: 'Fetching timing data from MP3Quran...'
		);

		// 3. Fetch timing data
		const timingData =
			nativeTimingMeta.provider === 'qdc'
				? ((
						await QdcRecitationService.getChapterAudio(nativeTimingMeta.recitationId, surahId, true)
					)?.timestamps?.map((timestamp) => ({
						ayah: Number(timestamp.verse_key.split(':')[1]),
						start_time: timestamp.timestamp_from,
						end_time: timestamp.timestamp_to
					})) ?? [])
				: await Mp3QuranService.getSurahTiming(
						nativeTimingMeta.moshafId ?? nativeTimingMeta.reciterId,
						surahId
					);

		if (!timingData || timingData.length === 0) {
			toast.error('No timing data found for this reciter/surah.', { id: toastId });
			return { status: 'failed', message: 'No timing data returned from API.' };
		}

		// 4. Load Quran Data
		await Quran.load();

		// 5. Build Subtitle Clips
		subtitleTrack.clips = [];
		let segmentsApplied = 0;

		for (const verseTiming of timingData) {
			// timing in ms
			const timingStart = verseTiming.start_time;
			const timingEnd = verseTiming.end_time;

			// Adjusted for timeline
			// Valid part of the verse must be visible in the clip
			// If the verse ends before the clip starts (due to offset), skip.
			if (timingEnd < clipOffset) continue;

			const relativeStart = timingStart - clipOffset;
			const relativeEnd = timingEnd - clipOffset;

			// Calculate absolute timeline position
			const absStart = clipStartTime + relativeStart;
			const absEnd = clipStartTime + relativeEnd;

			// If segments starts before timeline 0 (unlikely if clip is at 0), clamp?
			// Or if it starts before clip's visible area?
			// Let's just apply it.

			// Fetch Verse
			const verse = await Quran.getVerse(surahId, verseTiming.ayah);
			if (!verse) continue;

			// Create Clip
			// Using full verse range (startIndex=0, endIndex=verse.words.length-1)
			const startIndex = 0;
			const endIndex = verse.words.length - 1;

			const arabicText = verse.getArabicTextBetweenTwoIndexes(startIndex, endIndex);
			const indopakText = verse.getArabicTextBetweenTwoIndexes(startIndex, endIndex, 'indopak');
			const wbwTranslation = verse.getWordByWordTranslationBetweenTwoIndexes(startIndex, endIndex);

			const subtitlesProperties = await subtitleTrack.getSubtitlesProperties(
				verse,
				startIndex,
				endIndex,
				surahId
			);

			const clip = new SubtitleClip(
				Math.max(0, absStart),
				Math.max(0, absEnd),
				surahId,
				verseTiming.ayah,
				startIndex,
				endIndex,
				arabicText,
				wbwTranslation,
				subtitlesProperties.isFullVerse,
				subtitlesProperties.isLastWordsOfVerse,
				subtitlesProperties.translations,
				indopakText,
				true, // isArabic
				1.0 // Confidence 100% since it's manual/official
			);

			subtitleTrack.clips.push(clip);
			segmentsApplied++;
		}

		// --- Post-Processing (Standardizing Logic) ---
		// 1. Sort clips by time
		subtitleTrack.clips.sort((a, b) => a.startTime - b.startTime);

		// 2. Close small gaps (micro-silences)
		closeSmallSubtitleGaps(
			subtitleTrack.clips as Array<SubtitleClip | PredefinedSubtitleClip>,
			SMALL_GAP_MS
		);

		// 3. Fill gaps with explicit SilenceClips (Strategy: Fill By Silence to preserve accurate native timing)
		subtitleTrack.clips = insertSilenceClips(
			subtitleTrack.clips as Array<SubtitleClip | PredefinedSubtitleClip | SilenceClip>,
			SMALL_GAP_MS
		);

		// 4. Handle Trailing Silence (to ensure 100% completion)
		const audioDuration = audioTrack.getDuration().ms;
		const lastClip = subtitleTrack.clips[subtitleTrack.clips.length - 1];

		if (lastClip && lastClip.endTime < audioDuration - SMALL_GAP_MS) {
			const silenceStart = lastClip.endTime + 1;
			const silenceEnd = audioDuration; // Cover until the very end
			if (silenceEnd > silenceStart) {
				subtitleTrack.clips.push(new SilenceClip(silenceStart, silenceEnd));
			}
		}

		// 5. Replace the first clip with basmala if it's silence
		const firstClip = subtitleTrack.clips[0];
		const secondClip = subtitleTrack.clips[1];
		if (firstClip && firstClip instanceof SilenceClip && secondClip instanceof SubtitleClip) {
			const basmalaClip = new PredefinedSubtitleClip(
				firstClip.startTime,
				firstClip.endTime,
				secondClip.surah !== 9 ? 'Basmala' : "Isti'adha"
			);
			subtitleTrack.clips[0] = basmalaClip;
		}

		globalState.currentProject?.detail.updateVideoDetailAttributes();
		globalState.updateVideoPreviewUI();
		// Reset review count as these are trusted segments
		globalState.getSubtitlesEditorState.initialLowConfidenceCount = 0;

		toast.success(`Applied ${segmentsApplied} subtitles from Mp3Quran!`, { id: toastId });

		return {
			status: 'completed',
			segmentsApplied,
			lowConfidenceSegments: 0,
			coverageGapSegments: 0,
			verseRange: new VerseRange() // We could populate this but it's optional for the result summary
		};
	} catch (error) {
		console.error('Native segmentation error:', error);
		toast.error(`Error: ${error}`, { id: toastId });
		return { status: 'failed', message: String(error) };
	}
}
