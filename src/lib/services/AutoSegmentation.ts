import { invoke } from '@tauri-apps/api/core';
import toast from 'svelte-5-french-toast';

import { Quran } from '$lib/classes/Quran';
import { PredefinedSubtitleClip, SilenceClip, SubtitleClip, type Translation } from '$lib/classes';
import ModalManager from '$lib/components/modals/ModalManager';
import { globalState } from '$lib/runes/main.svelte';
import { VerseRange } from '$lib/classes/VerseRange.svelte';

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

type AutoSegmentationOptions = {
	minSilenceMs?: number;
	minSpeechMs?: number;
	padMs?: number;
};

export type AutoSegmentationResult =
	| {
			status: 'completed';
			segmentsApplied: number;
			lowConfidenceSegments: number;
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
export function getAutoSegmentationAudioInfo(): AutoSegmentationAudioInfo | null {
	const audioClip: unknown = globalState.getAudioTrack?.clips?.[0];

	const hasAssetId: boolean =
		typeof audioClip === 'object' &&
		audioClip !== null &&
		'assetId' in audioClip &&
		(audioClip as { assetId?: unknown }).assetId !== undefined;

	if (!audioClip || !hasAssetId) return null;

	const assetId: unknown = (audioClip as { assetId?: unknown }).assetId;
	if (typeof assetId !== 'number') return null;

	const project = globalState.currentProject;
	if (!project) return null;

	const audioAsset = project.content.getAssetById(assetId);
	const filePath: string | undefined = audioAsset?.filePath;
	if (!filePath) return null;

	const fileName: string = filePath.split(/[/\\]/).pop() || filePath;
	return { filePath, fileName };
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
			next.setStartTime(current.endTime + 1);
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
		first.setStartTime(0);
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

	// Determine mode if not specified
	const effectiveMode: SegmentationMode = mode ?? (await getPreferredSegmentationMode());
	console.log(`[AutoSegmentation] Using ${effectiveMode} mode`);

	const audioInfo: AutoSegmentationAudioInfo | null = getAutoSegmentationAudioInfo();
	if (!audioInfo) {
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
		const command =
			effectiveMode === 'local' ? 'segment_quran_audio_local' : 'segment_quran_audio';

		const payload: unknown = await invoke(command, {
			audioPath: audioInfo.filePath,
			minSilenceMs,
			minSpeechMs,
			padMs
		});

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

		const orderedSegments: SegmentationSegment[] = [...segments].sort(
			(a, b) => (a.time_from ?? 0) - (b.time_from ?? 0)
		);

		for (const segment of orderedSegments) {
			if (segment.error) {
				console.warn('Skipping segment with error:', segment);
				continue;
			}

			const startMs: number = Math.max(0, Math.round((segment.time_from ?? 0) * 1000));
			const endMs: number = Math.max(startMs, Math.round((segment.time_to ?? 0) * 1000));

			const confidence: number | null = segment.confidence ?? null;
			const isLowConfidence: boolean =
				segment.confidence !== undefined && segment.confidence <= 0.75;

			// Predefined segments (basmala / istiadhah)
			const predefinedType: PredefinedType | null = getPredefinedType(segment.ref_from);
			if (predefinedType) {
				subtitleTrack.clips.push(
					new PredefinedSubtitleClip(startMs, endMs, predefinedType, undefined, true, confidence)
				);

				segmentsApplied += 1;
				if (isLowConfidence) lowConfidenceSegments += 1;
				continue;
			}

			// Quran word range segment
			const startRef: VerseRef | null = parseVerseRef(segment.ref_from);
			const endRef: VerseRef | null = parseVerseRef(segment.ref_to);

			if (!startRef || !endRef) {
				console.warn('Invalid verse reference:', segment);
				continue;
			}

			if (startRef.surah !== endRef.surah || startRef.verse !== endRef.verse) {
				console.warn('Cross-verse segment detected, using ref_from:', segment);
			}

			const verse = await Quran.getVerse(startRef.surah, startRef.verse);
			if (!verse) {
				console.warn('Verse not found for segment:', segment);
				continue;
			}

			const startIndex: number = Math.max(0, startRef.word - 1);
			const endIndex: number = Math.min(verse.words.length - 1, endRef.word - 1);

			const arabicText: string = verse.getArabicTextBetweenTwoIndexes(startIndex, endIndex);
			const wbwTranslation: string[] = verse.getWordByWordTranslationBetweenTwoIndexes(
				startIndex,
				endIndex
			);

			const subtitlesProperties: {
				isFullVerse: boolean;
				isLastWordsOfVerse: boolean;
				translations: { [key: string]: Translation };
			} = await subtitleTrack.getSubtitlesProperties(verse, startIndex, endIndex, startRef.surah);

			const clip: SubtitleClip = new SubtitleClip(
				startMs,
				endMs,
				startRef.surah,
				startRef.verse,
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

			subtitleTrack.clips.push(clip);
			segmentsApplied += 1;
			if (isLowConfidence) lowConfidenceSegments += 1;
		}

		// Normalize timing and explicit silence.
		subtitleTrack.clips.sort((a, b) => a.startTime - b.startTime);
		const subtitleClips = subtitleTrack.clips.filter(
			(clip) => clip.type === 'Subtitle' || clip.type === 'Pre-defined Subtitle'
		) as Array<SubtitleClip | PredefinedSubtitleClip>;
		closeSmallSubtitleGaps(subtitleClips, SMALL_GAP_MS);

		subtitleTrack.clips = insertSilenceClips(subtitleClips, SMALL_GAP_MS);
		subtitleTrack.clips.sort((a, b) => a.startTime - b.startTime);

		const verseRange: VerseRange = VerseRange.getVerseRange(0, subtitleTrack.getDuration().ms);

		globalState.currentProject?.detail.updateVideoDetailAttributes();
		globalState.updateVideoPreviewUI();

		console.log('Quran segmentation payload:', payload);

		return {
			status: 'completed',
			segmentsApplied,
			lowConfidenceSegments,
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
