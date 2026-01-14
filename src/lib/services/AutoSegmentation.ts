import { invoke } from '@tauri-apps/api/core';
import toast from 'svelte-5-french-toast';

import { Quran } from '$lib/classes/Quran';
import { PredefinedSubtitleClip, SilenceClip, SubtitleClip, type Translation } from '$lib/classes';
import ModalManager from '$lib/components/modals/ModalManager';
import { globalState } from '$lib/runes/main.svelte';
import { VerseRange } from '$lib/classes/VerseRange.svelte';
import { Mp3QuranService } from '$lib/services/Mp3QuranService';

const SMALL_GAP_MS = 200;

type SegmentationSegment = {
	confidence?: number;
	error?: string | null;
	matched_text?: string;
	ref_from?: string;
	ref_to?: string;
	segment?: number;
	time_from?: number;
	time_to?: number;
	word_timestamps?: Array<{
		key: string;
		start: number;
		end: number;
		type: string;
	}>;
};

type SegmentationResponse = {
	segments?: SegmentationSegment[];
};

/**
 * Segmentation processing mode
 */
export type SegmentationMode = 'api' | 'local';

/**
 * Status of local segmentation readiness
 */
export type LocalSegmentationStatus = {
	ready: boolean;
	pythonInstalled: boolean;
	packagesInstalled: boolean;
	message: string;
};

/**
 * Check if local segmentation is available and ready.
 */
export async function checkLocalSegmentationStatus(): Promise<LocalSegmentationStatus> {
	try {
		const result = await invoke('check_local_segmentation_ready');
		return result as LocalSegmentationStatus;
	} catch (error) {
		console.error('Failed to check local segmentation status:', error);
		return {
			ready: false,
			pythonInstalled: false,
			packagesInstalled: false,
			message: 'Failed to check local segmentation status'
		};
	}
}

/**
 * Install dependencies for local segmentation.
 * Returns a promise that resolves when installation is complete.
 */
export async function installLocalSegmentationDeps(): Promise<void> {
	try {
		await invoke('install_local_segmentation_deps');
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

/**
 * Whisper model size for local processing
 */
export type WhisperModelSize = 'tiny' | 'base' | 'medium' | 'large';

export type AutoSegmentationOptions = {
	minSilenceMs?: number;
	minSpeechMs?: number;
	padMs?: number;
	whisperModel?: WhisperModelSize;
	fillBySilence?: boolean; // Si true, insère des SilenceClip dans les gaps. Sinon, étend la fin du sous-titre précédent.
	includeWordByWord?: boolean; // If true, request word-by-word timestamps.
};

export type AutoSegmentationResult =
	| {
			status: 'completed';
			segmentsApplied: number;
			lowConfidenceSegments: number;
			coverageGapSegments: number;
			verseRange: VerseRange;
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

type VerseRef = {
	surah: number;
	verse: number;
	word: number;
};

type PredefinedType = 'Basmala' | 'Istiadhah';

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
	orderedSegments: Array<Pick<SegmentationSegment, 'ref_from' | 'ref_to' | 'error'>>,
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
		if (getPredefinedType(segment.ref_from)) continue;

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

		if (getPredefinedType(segment.ref_from)) {
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
function getPredefinedType(ref?: string): PredefinedType | null {
	if (!ref) return null;

	const normalized: string = ref.toLowerCase();
	if (normalized.includes('basmala')) return 'Basmala';
	if (normalized.includes('isti')) return 'Istiadhah';

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
	const padMs: number = options.padMs ?? 50;
	const whisperModel: string = options.whisperModel ?? 'base';
	const fillBySilence: boolean = options.fillBySilence ?? true; // Par défaut, on insère des SilenceClip
	const includeWordByWord: boolean = options.includeWordByWord ?? false;

	// Determine mode if not specified
	const effectiveMode: SegmentationMode = mode ?? (await getPreferredSegmentationMode());
	console.log(`[AutoSegmentation] Using ${effectiveMode} mode, fillBySilence=${fillBySilence}`);

	const audioInfo: AutoSegmentationAudioInfo | null = getAutoSegmentationAudioInfo();
	const audioClips = getAutoSegmentationAudioClips();
	if (!audioInfo || audioClips.length === 0) {
		const message = 'No audio clip found in the project.';
		toast.error(message);
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
		// Choose command based on mode
		const command = effectiveMode === 'local' ? 'segment_quran_audio_local' : 'segment_quran_audio';

		const payload: unknown = await invoke(command, {
			audioPath: audioInfo.filePath,
			audioClips: audioClips.map((clip) => ({
				path: clip.filePath,
				startMs: clip.startMs,
				endMs: clip.endMs
			})),
			minSilenceMs,
			minSpeechMs,
			padMs,
			whisperModel: effectiveMode === 'local' ? whisperModel : undefined,
			includeWordByWord
		});

		if (effectiveMode === 'local') {
			console.log('[AutoSegmentation] Local segmentation raw response:', payload);
		}

		const response: SegmentationResponse = payload as SegmentationResponse;
		const segments: SegmentationSegment[] = response?.segments ?? [];

		if (segments.length === 0) {
			const message = 'No segments returned from the segmentation service.';
			toast.error(message);
			return { status: 'failed', message };
		}

		// Replace existing subtitle clips entirely.
		subtitleTrack.clips = [];
		await Quran.load();

		let segmentsApplied: number = 0;
		let lowConfidenceSegments: number = 0;
		let coverageGapSegments: number = 0;
		let reviewSegments: number = 0;

		const pushSubtitleClip = async (params: {
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
			} = params;

			if (!verse) return;

			const arabicText: string = verse.getArabicTextBetweenTwoIndexes(startIndex, endIndex);
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
				true,
				confidence
			);

			if (needsReview || needsCoverageReview) {
				clip.needsReview = true;
				if (needsCoverageReview) {
					clip.needsCoverageReview = true;
				}
				markClipTranslationsForReview(clip);
			}

			subtitleTrack.clips.push(clip);
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

		// Collect segment errors to surface them if all segments fail
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
			const isLowConfidence: boolean =
				segment.confidence !== undefined && segment.confidence <= 0.75;
			const needsCoverageReview: boolean = coverageGapIndices.has(segmentIndex);

			// Predefined segments (basmala / istiadhah)
			const predefinedType: PredefinedType | null = getPredefinedType(segment.ref_from);
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

				segmentsApplied += 1;
				if (isLowConfidence) lowConfidenceSegments += 1;
				if (clip.needsReview) reviewSegments += 1;
				continue;
			}

			// Quran word range segment
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
						console.warn('Verse not found for cross-verse segment:', {
							segment,
							verseNumber
						});
						continue;
					}

					const verseWordCount = verse.words.length;
					if (verseWordCount === 0) {
						console.error('Verse has no word data in cross-verse segment', {
							segment,
							verseNumber
						});
						continue;
					}

					const clampIndex = (value: number) => Math.min(Math.max(value, 0), verseWordCount - 1);

					let startIndex = 0;
					let endIndex = verseWordCount - 1;
					let needsReview = false;

					if (verseNumber === startRef.verse) {
						const rawStartIndex = startRef.word - 1;
						startIndex = clampIndex(rawStartIndex);
						if (rawStartIndex < 0 || rawStartIndex >= verseWordCount) {
							needsReview = true;
							console.error('Cross-verse start index out of bounds, clamping to verse limits', {
								segment,
								verseWordCount,
								startRef,
								rawStartIndex,
								startIndex
							});
						}
					}

					if (verseNumber === endRef.verse) {
						const rawEndIndex = endRef.word - 1;
						endIndex = clampIndex(rawEndIndex);
						if (rawEndIndex < 0 || rawEndIndex >= verseWordCount) {
							needsReview = true;
							console.error('Cross-verse end index out of bounds, clamping to verse limits', {
								segment,
								verseWordCount,
								endRef,
								rawEndIndex,
								endIndex
							});
						}
					}

					if (startIndex > endIndex) {
						needsReview = true;
						console.error('Cross-verse word range inverted, swapping values', {
							segment,
							verseWordCount,
							startIndex,
							endIndex
						});
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
						if (!verse) {
							console.warn('Verse not found when building split clip:', def);
							continue;
						}

						await pushSubtitleClip({
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
			} else if (isCrossVerse) {
				console.warn('Cross-verse segment detected but unable to split safely, falling back', {
					segment,
					startRef,
					endRef
				});
			}

			const verse = await Quran.getVerse(startRef.surah, startRef.verse);
			if (!verse) {
				console.warn('Verse not found for segment:', segment);
				continue;
			}

			const verseWordCount = verse.words.length;
			if (verseWordCount === 0) {
				console.error('Verse has no word data, skipping segment', {
					segment,
					startRef,
					endRef
				});
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
				console.error('Segment word indexes out of bounds, clamping to verse limits', {
					segment,
					verseWordCount,
					startRef,
					endRef,
					rawStartIndex,
					rawEndIndex,
					startIndex,
					endIndex
				});
			}

			if (startIndex > endIndex) {
				clipNeedsReview = true;
				console.error('Segment word range inverted, swapping values', {
					segment,
					verseWordCount,
					startRef,
					endRef,
					rawStartIndex,
					rawEndIndex,
					startIndex,
					endIndex
				});
				[startIndex, endIndex] = [endIndex, startIndex];
			}

			await pushSubtitleClip({
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

		// If all segments had errors, surface the error to the user
		if (segmentsApplied === 0 && segmentErrors.length > 0) {
			// Get unique error messages
			const uniqueErrors = [...new Set(segmentErrors)];
			const message = `All segments failed to process: ${uniqueErrors.join(', ')}`;
			toast.error(message);
			return { status: 'failed', message };
		}

		// Normalize timing and explicit silence.
		subtitleTrack.clips.sort((a, b) => a.startTime - b.startTime);
		const subtitleClips = subtitleTrack.clips.filter(
			(clip) => clip.type === 'Subtitle' || clip.type === 'Pre-defined Subtitle'
		) as Array<SubtitleClip | PredefinedSubtitleClip>;
		closeSmallSubtitleGaps(subtitleClips, SMALL_GAP_MS);

		if (fillBySilence) {
			// Insère des SilenceClip dans les gaps
			subtitleTrack.clips = insertSilenceClips(subtitleClips, SMALL_GAP_MS);
		} else {
			// Étend la fin de chaque sous-titre pour combler les gaps
			extendSubtitlesToFillGaps(subtitleClips);
			subtitleTrack.clips = subtitleClips;
		}
		subtitleTrack.clips.sort((a, b) => a.startTime - b.startTime);

		const verseRange: VerseRange = VerseRange.getVerseRange(0, subtitleTrack.getDuration().ms);

		globalState.currentProject?.detail.updateVideoDetailAttributes();
		globalState.updateVideoPreviewUI();

		// Set le nbre de segment à review initialement pour la barre de progression
		globalState.getSubtitlesEditorState.initialLowConfidenceCount = reviewSegments;

		console.log('Quran segmentation payload:', payload);

		return {
			status: 'completed',
			segmentsApplied,
			lowConfidenceSegments,
			coverageGapSegments,
			verseRange
		};
	} catch (error) {
		console.error('Segmentation request failed:', error);
		const errorMessage = error instanceof Error ? error.message : String(error);
		if (errorMessage.toLowerCase().includes('gpu quota')) {
			toast.error('GPU quota exceeded. No GPU quota left. Please try again later.');
		} else {
			toast.error('Segmentation request failed.');
		}
		return { status: 'failed', message: errorMessage };
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
export async function runNativeSegmentation(): Promise<AutoSegmentationResult | null> {
	// 1. Identify valid audio clip and metadata
	const audioTrack = globalState.getAudioTrack;
	let targetClip: AssetClip | null = null;
	let mp3QuranMeta: { reciterId: number; surahId: number; moshafId?: number } | null = null;
	let clipStartTime = 0;
	let clipOffset = 0;

	for (const clip of audioTrack.clips) {
		if (clip instanceof AssetClip) {
			const asset = globalState.currentProject?.content.getAssetById(clip.assetId);
			if (asset?.metadata?.mp3Quran) {
				mp3QuranMeta = asset.metadata.mp3Quran;
				targetClip = clip;
				clipStartTime = clip.startTime;
				// clip.offset might not exist on AssetClip type definition yet but let's assume valid access for now or cast
				clipOffset = (clip as any).offset || 0; 
				break;
			}
		}
	}

	if (!targetClip || !mp3QuranMeta) {
		toast.error('No Mp3Quran audio found on timeline.');
		return { status: 'failed', message: 'No Mp3Quran audio found' };
	}

	// 2. Warn about overwriting
	const subtitleTrack = globalState.getSubtitleTrack;
	if (subtitleTrack.clips.length > 0) {
		const confirmOverwrite = await ModalManager.confirmModal(
			'There are already subtitles in this project. This process will replace them with Mp3Quran timing. Continue?',
			true
		);
		if (!confirmOverwrite) return { status: 'cancelled' };
	}

	const { reciterId, surahId, moshafId } = mp3QuranMeta;
	// Use moshafId (readId) if available, otherwise fallback to reciterId (legacy/fallback)
	const readId = moshafId ?? reciterId;


	let toastId: string | undefined;

	try {
		toastId = toast.loading('Fetching timing data from Mp3Quran...');
		
		// 3. Fetch timing data
		// Note from plan: We assume reciterId matches readId.
		// If this fails often, we might need a lookup table.
		const timingData = await Mp3QuranService.getSurahTiming(reciterId, surahId);
		
		if (!timingData || timingData.length === 0) {
			toast.error('No timing data found for this reciter/surah.', { id: toastId });
			return { status: 'failed', message: 'No timing data returned from API.' };
		}

		// 4. Load Quran Data
		await Quran.load();

		// 5. Build Subtitle Clips
		// The timing data gives us start/end in MS relative to the audio file start.
		// We need to map this to the timeline.
		// Since we added the FULL file to the timeline, the clip's source offset is likely 0,
		// but the clip on timeline might start at a different position (clip.startTime).
		
		// Ideally, we align the subtitles with the CLIP's start time on the timeline.
		// clip_timeline_start = clip.startTime
		// clip_source_offset = clip.offset ?? 0 (if user trimmed the start)
		
		// Subtitle Start = clip.startTime + (TimingStart - clip.offset)
		// We will assume for now the user dropped the raw file and didn't trim it internally yet, 
		// OR that they want the subtitles to match the audio content regardless of trim.
		// Let's stick to: Subtitle Start = Timing Start + Clip Start Time (assuming offset is 0 for fresh imports).
		// If offset > 0, we should subtract it: (TimingStart - Offset) + ClipStartTime.
		// If (TimingStart - Offset) < 0, that part of audio is trimmed out.

		// Let's get the clip properties
		const clipStartTime = (clipWithMetadata as any).startTime || 0;
		const clipOffset = (clipWithMetadata as any).mediaOffset || 0; // if your clip class has 'mediaOffset' or similar

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
				 true, // isArabic
				 1.0   // Confidence 100% since it's manual/official
			);

			subtitleTrack.clips.push(clip);
			segmentsApplied++;
		}
		
		// --- Post-Processing (Standardizing Logic) ---
		// 1. Sort clips by time
		subtitleTrack.clips.sort((a, b) => a.startTime - b.startTime);

		// 2. Close small gaps (micro-silences)
		closeSmallSubtitleGaps(subtitleTrack.clips as Array<SubtitleClip | PredefinedSubtitleClip>, SMALL_GAP_MS);

		// 3. Fill gaps with explicit SilenceClips (Strategy: Fill By Silence to preserve accurate native timing)
		subtitleTrack.clips = insertSilenceClips(subtitleTrack.clips as Array<SubtitleClip | PredefinedSubtitleClip | SilenceClip>, SMALL_GAP_MS);

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
