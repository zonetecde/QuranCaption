import { invoke } from '@tauri-apps/api/core';
import toast from 'svelte-5-french-toast';
import { Quran } from '$lib/classes/Quran';
import { globalState } from '$lib/runes/main.svelte';
import { PredefinedSubtitleClip, SilenceClip, SubtitleClip } from '$lib/classes';
import ModalManager from '$lib/components/modals/ModalManager';
import { VerseRange } from '$lib/classes/VerseRange.svelte';

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
	  };

export type AutoSegmentationAudioInfo = {
	filePath: string;
	fileName: string;
};

export function getAutoSegmentationAudioInfo(): AutoSegmentationAudioInfo | null {
	const audioClip: any = globalState.getAudioTrack?.clips?.[0];
	if (!audioClip || audioClip.assetId === undefined) return null;

	const audioAsset = globalState.currentProject!.content.getAssetById(audioClip.assetId);
	if (!audioAsset?.filePath) return null;

	const fileName = audioAsset.filePath.split(/[/\\]/).pop() || audioAsset.filePath;
	return { filePath: audioAsset.filePath, fileName };
}

function parseVerseRef(ref?: string) {
	if (!ref) return null;
	const match = ref.match(/^(\d+):(\d+):(\d+)$/);
	if (!match) return null;
	return {
		surah: Number(match[1]),
		verse: Number(match[2]),
		word: Number(match[3])
	};
}

function getPredefinedType(ref?: string): 'Basmala' | 'Istiadhah' | null {
	if (!ref) return null;
	const normalized = ref.toLowerCase();
	if (normalized.includes('basmala')) return 'Basmala';
	if (normalized.includes('isti')) return 'Istiadhah';
	return null;
}

function closeSmallSubtitleGaps(
	clips: Array<SubtitleClip | PredefinedSubtitleClip>,
	maxGapMs: number
) {
	// Sort by time to evaluate gaps in chronological order.
	const ordered = [...clips].sort((a, b) => a.startTime - b.startTime);

	for (let i = 0; i < ordered.length - 1; i++) {
		const current = ordered[i];
		const next = ordered[i + 1];
		const gapMs = next.startTime - current.endTime - 1;

		if (gapMs > 0 && gapMs < maxGapMs) {
			// Remove small gaps by snapping the next clip to the previous end.
			next.setStartTime(current.endTime + 1);
		}
	}
}

function insertSilenceClips(
	clips: Array<SubtitleClip | PredefinedSubtitleClip | SilenceClip>,
	minGapMs: number
) {
	const ordered = [...clips].sort((a, b) => a.startTime - b.startTime);
	const result: Array<SubtitleClip | PredefinedSubtitleClip | SilenceClip> = [];

	if (ordered.length === 0) return result;

	const first = ordered[0];
	if (first.startTime < minGapMs) {
		first.setStartTime(0);
	} else if (first.startTime >= minGapMs) {
		result.push(new SilenceClip(0, first.startTime - 1));
	}

	result.push(first);

	for (let i = 1; i < ordered.length; i++) {
		const prev = result[result.length - 1];
		const next = ordered[i];
		const gapMs = next.startTime - prev.endTime - 1;

		if (gapMs >= minGapMs) {
			result.push(new SilenceClip(prev.endTime + 1, next.startTime - 1));
		}

		result.push(next);
	}

	return result;
}

export async function runAutoSegmentation(
	options: AutoSegmentationOptions = {}
): Promise<AutoSegmentationResult | null> {
	const { minSilenceMs = 200, minSpeechMs = 1000, padMs = 50 } = options;

	// Use the first audio clip from the audio track as the source.
	const audioInfo = getAutoSegmentationAudioInfo();
	if (!audioInfo) {
		toast.error('No audio clip found in the project.');
		return null;
	}

	// Confirm overwrite when subtitles already exist.
	const subtitleTrack = globalState.getSubtitleTrack;
	if (subtitleTrack.clips.length > 0) {
		const confirm = await ModalManager.confirmModal(
			'There are already subtitles in this project. This process will override them. Continue?',
			true
		);
		if (!confirm) return { status: 'cancelled' };
	}

	try {
		// Send the audio to Rust; Rust handles resampling + API calls.
		const payload = await invoke('segment_quran_audio', {
			audioPath: audioInfo.filePath,
			minSilenceMs,
			minSpeechMs,
			padMs
		});

		const response = payload as SegmentationResponse;
		const segments = response?.segments ?? [];

		if (segments.length === 0) {
			toast.error('No segments returned from the segmentation service.');
			return null;
		}

		// Clear existing subtitle clips before applying the new ones.
		subtitleTrack.clips = [];
		await Quran.load();

		let segmentsApplied = 0;
		let lowConfidenceSegments = 0;

		for (const segment of segments.sort((a, b) => (a.time_from ?? 0) - (b.time_from ?? 0))) {
			if (segment.error) {
				console.warn('Skipping segment with error:', segment);
				continue;
			}

			const startMs = Math.max(0, Math.round((segment.time_from ?? 0) * 1000));
			const endMs = Math.max(startMs, Math.round((segment.time_to ?? 0) * 1000));

			const predefinedType = getPredefinedType(segment.ref_from);
			if (predefinedType) {
				subtitleTrack.clips.push(
					new PredefinedSubtitleClip(
						startMs,
						endMs,
						predefinedType,
						undefined,
						true,
						segment.confidence ?? null
					)
				);
				segmentsApplied += 1;
				if (segment.confidence !== undefined && segment.confidence <= 0.75) {
					lowConfidenceSegments += 1;
				}
				continue;
			}

			const startRef = parseVerseRef(segment.ref_from);
			const endRef = parseVerseRef(segment.ref_to);
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

			const startIndex = Math.max(0, startRef.word - 1);
			const endIndex = Math.min(verse.words.length - 1, endRef.word - 1);
			const arabicText = verse.getArabicTextBetweenTwoIndexes(startIndex, endIndex);
			const wbwTranslation = verse.getWordByWordTranslationBetweenTwoIndexes(startIndex, endIndex);
			const subtitlesProperties = await subtitleTrack.getSubtitlesProperties(
				verse,
				startIndex,
				endIndex,
				startRef.surah
			);

			const clip = new SubtitleClip(
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
				segment.confidence ?? null
			);

			subtitleTrack.clips.push(clip);
			segmentsApplied += 1;
			if (segment.confidence !== undefined && segment.confidence <= 0.75) {
				lowConfidenceSegments += 1;
			}
		}

		// Keep clips ordered and normalize timing gaps.
		subtitleTrack.clips.sort((a, b) => a.startTime - b.startTime);
		closeSmallSubtitleGaps(subtitleTrack.clips, 200);
		subtitleTrack.clips = insertSilenceClips(subtitleTrack.clips, 200);
		subtitleTrack.clips.sort((a, b) => a.startTime - b.startTime);

		const verseRange = VerseRange.getVerseRange(0, subtitleTrack.getDuration().ms);

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
		toast.error('Segmentation request failed.');
		return null;
	}
}
