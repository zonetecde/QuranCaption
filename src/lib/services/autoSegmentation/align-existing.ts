import { PredefinedSubtitleClip, SilenceClip, SubtitleClip } from '$lib/classes';
import type { ProjectTranslation } from '$lib/classes/ProjectTranslation.svelte';
import type { SubtitleTrack } from '$lib/classes/Track.svelte';
import { buildStoredAlignedSegment, getSegmentWords } from './context';
import { getPredefinedType } from './predefined';
import {
	closeSmallSubtitleGaps,
	extendSubtitlesBeforeSilence,
	extendSubtitlesToFillGaps,
	insertSilenceClips
} from './timeline';
import type {
	PredefinedType,
	SegmentationSegment,
	SegmentationWordTimestamp,
	StoredAlignedSegment
} from './types';
import { parseVerseRef } from './verse-ref';

type AbsoluteWord = SegmentationWordTimestamp & {
	wordNumber: number;
	absoluteStartMs: number;
	absoluteEndMs: number;
};

type CurrentQuranOccurrence = {
	key: string;
	clips: SubtitleClip[];
};

type AlignedQuranOccurrence = {
	key: string;
	slices: Array<{
		words: AbsoluteWord[];
		segment: SegmentationSegment;
	}>;
};

type AlignedSliceMatch = {
	words: AbsoluteWord[];
	segments: SegmentationSegment[];
	endSliceIndex: number;
};

export type ExistingSubtitleAlignmentResult = {
	segmentsApplied: number;
	lowConfidenceSegments: number;
	storedAlignedSegments: StoredAlignedSegment[];
};

export type ExistingSubtitleAlignmentParams = {
	subtitleTrack: SubtitleTrack;
	segments: SegmentationSegment[];
	segmentationSource: 'api' | 'local' | 'import';
	projectTranslation: ProjectTranslation | null;
	fillBySilence?: boolean;
	extendBeforeSilence?: boolean;
	extendBeforeSilenceMs?: number;
};

/**
 * Regroupe les clips Quran existants par occurrence chronologique de verset.
 * @param {SubtitleClip[]} clips Clips Quran existants.
 * @returns {CurrentQuranOccurrence[]} Occurrences chronologiques de versets.
 */
function groupCurrentQuranOccurrences(clips: SubtitleClip[]): CurrentQuranOccurrence[] {
	const occurrences: CurrentQuranOccurrence[] = [];
	for (const clip of [...clips].sort((left, right) => left.startTime - right.startTime)) {
		const key = `${clip.surah}:${clip.verse}`;
		const current = occurrences[occurrences.length - 1];
		const previousClip = current?.clips[current.clips.length - 1];
		if (current?.key === key && previousClip && clip.startWordIndex !== 0) {
			current.clips.push(clip);
		} else {
			occurrences.push({ key, clips: [clip] });
		}
	}
	return occurrences;
}

/**
 * Regroupe les mots IA par occurrence en détectant les retours de référence.
 * @param {SegmentationSegment[]} segments Segments IA ordonnables.
 * @returns {AlignedQuranOccurrence[]} Occurrences Quran détectées dans l'audio.
 */
function groupAlignedQuranOccurrences(segments: SegmentationSegment[]): AlignedQuranOccurrence[] {
	const occurrences: AlignedQuranOccurrence[] = [];
	for (const segment of [...segments].sort(
		(left, right) => (left.time_from ?? 0) - (right.time_from ?? 0)
	)) {
		if (getPredefinedType(segment.ref_from, segment.special_type)) continue;
		const segmentStartMs = (segment.time_from ?? 0) * 1000;
		const slices: Array<{ key: string; words: AbsoluteWord[] }> = [];
		for (const word of getSegmentWords(segment)) {
			const ref = parseVerseRef(word.location);
			if (!ref) continue;
			const key = `${ref.surah}:${ref.verse}`;
			const activeSlice = slices[slices.length - 1];
			const previousWord = activeSlice?.words[activeSlice.words.length - 1];
			let targetSlice = activeSlice;
			if (activeSlice?.key !== key || (previousWord && ref.word <= previousWord.wordNumber)) {
				targetSlice = { key, words: [] };
				slices.push(targetSlice);
			}
			targetSlice.words.push({
				...word,
				wordNumber: ref.word,
				absoluteStartMs: Math.round(segmentStartMs + word.start * 1000),
				absoluteEndMs: Math.round(segmentStartMs + word.end * 1000)
			});
		}

		if (slices.length === 0) {
			const ref = parseVerseRef(segment.ref_from);
			if (ref) slices.push({ key: `${ref.surah}:${ref.verse}`, words: [] });
		}

		for (const slice of slices) {
			const current = occurrences[occurrences.length - 1];
			const startsNewRepetition = slice.words[0]?.wordNumber === 1 && current?.key === slice.key;
			const target =
				current?.key === slice.key && !startsNewRepetition
					? current
					: { key: slice.key, slices: [] };
			if (target !== current) occurrences.push(target);
			target.slices.push({ words: slice.words, segment });
		}
	}
	return occurrences;
}

/**
 * Trouve la première tranche IA chronologique couvrant les bornes WBW d'un clip.
 * @param {SubtitleClip} clip Clip Quran à couvrir.
 * @param {AlignedQuranOccurrence} occurrence Occurrence IA correspondante.
 * @param {number} minimumSliceIndex Première tranche IA autorisée.
 * @returns {AlignedSliceMatch | null} Mots et segments utilisables, ou `null`.
 */
function findAlignedSliceMatch(
	clip: SubtitleClip,
	occurrence: AlignedQuranOccurrence,
	minimumSliceIndex: number
): AlignedSliceMatch | null {
	const firstWordNumber = clip.startWordIndex + 1;
	const lastWordNumber = clip.endWordIndex + 1;
	for (let index = minimumSliceIndex; index < occurrence.slices.length; index += 1) {
		const words = occurrence.slices[index].words;
		if (
			words.some((word) => word.wordNumber === firstWordNumber) &&
			words.some((word) => word.wordNumber === lastWordNumber)
		) {
			return { words, segments: [occurrence.slices[index].segment], endSliceIndex: index };
		}
	}

	for (let startIndex = minimumSliceIndex; startIndex < occurrence.slices.length; startIndex += 1) {
		if (!occurrence.slices[startIndex].words.some((word) => word.wordNumber === firstWordNumber)) {
			continue;
		}
		const words: AbsoluteWord[] = [];
		const segments: SegmentationSegment[] = [];
		for (let endIndex = startIndex; endIndex < occurrence.slices.length; endIndex += 1) {
			const slice = occurrence.slices[endIndex];
			words.push(...slice.words);
			if (!segments.includes(slice.segment)) segments.push(slice.segment);
			if (slice.words.some((word) => word.wordNumber === lastWordNumber)) {
				return { words, segments, endSliceIndex: endIndex };
			}
		}
	}
	return null;
}

/**
 * Marque un clip non alignable pour révision sans modifier ses timings.
 * @param {SubtitleClip} clip Clip à signaler.
 * @returns {void}
 */
function markLowConfidence(clip: SubtitleClip): void {
	clip.comeFromIA = true;
	clip.confidence = 0;
	clip.needsReview = true;
	clip.hasBeenVerified = false;
	clip.alignmentMetadata = null;
}

/**
 * Applique les mots d'une occurrence IA à un clip Quran existant.
 * @param {SubtitleClip} clip Clip existant à recaler.
 * @param {AlignedSliceMatch} match Tranche IA correspondant au clip.
 * @param {'api' | 'local' | 'import'} segmentationSource Source des timings.
 * @returns {StoredAlignedSegment | null} Segment stockable, ou `null` sans bornes WBW exactes.
 */
function retimeQuranClip(
	clip: SubtitleClip,
	match: AlignedSliceMatch,
	segmentationSource: 'api' | 'local' | 'import'
): StoredAlignedSegment | null {
	const firstWord = match.words.find((word) => word.wordNumber === clip.startWordIndex + 1);
	const lastWord = [...match.words]
		.reverse()
		.find((word) => word.wordNumber === clip.endWordIndex + 1);
	if (!firstWord || !lastWord) return null;

	const startMs = firstWord.absoluteStartMs;
	const endMs = Math.max(startMs, lastWord.absoluteEndMs);
	const words = match.words
		.filter(
			(word) =>
				word.wordNumber >= clip.startWordIndex + 1 && word.wordNumber <= clip.endWordIndex + 1
		)
		.map(({ wordNumber: _wordNumber, absoluteStartMs, absoluteEndMs, ...word }) => ({
			...word,
			start: (absoluteStartMs - startMs) / 1000,
			end: (absoluteEndMs - startMs) / 1000
		}));
	const confidenceValues = match.segments
		.map((segment) => segment.confidence)
		.filter((confidence): confidence is number => confidence !== undefined);
	const confidence = confidenceValues.length > 0 ? Math.min(...confidenceValues) : null;
	const firstSegment = match.segments[0];
	const alignmentSegment: SegmentationSegment = {
		...firstSegment,
		segment: firstSegment?.segment ?? 0,
		ref_from: `${clip.surah}:${clip.verse}:${clip.startWordIndex + 1}`,
		ref_to: `${clip.surah}:${clip.verse}:${clip.endWordIndex + 1}`,
		time_from: startMs / 1000,
		time_to: endMs / 1000
	};

	clip.startTime = startMs;
	clip.endTime = endMs;
	clip.duration = endMs - startMs;
	clip.comeFromIA = true;
	clip.confidence = confidence;
	clip.needsReview = confidence !== null && confidence <= 0.75;
	clip.needsWbwTimestampReview = false;
	clip.hasBeenVerified = false;
	clip.wbwTimestampsManuallyEdited = false;
	clip.alignmentMetadata = {
		source: segmentationSource,
		segment: alignmentSegment.segment!,
		refFrom: alignmentSegment.ref_from!,
		refTo: alignmentSegment.ref_to!,
		matchedText: alignmentSegment.matched_text ?? '',
		timeFrom: startMs / 1000,
		timeTo: endMs / 1000,
		words
	};

	return buildStoredAlignedSegment(clip.id, 'Subtitle', startMs, endMs, alignmentSegment, words);
}

/**
 * Réconcilie les clips prédéfinis existants avec les segments spéciaux IA.
 * @param {PredefinedSubtitleClip[]} existingClips Clips prédéfinis existants.
 * @param {SegmentationSegment[]} segments Segments IA reçus.
 * @param {'api' | 'local' | 'import'} segmentationSource Source des timings.
 * @param {ProjectTranslation | null} projectTranslation Traductions du projet.
 * @returns {{ clips: PredefinedSubtitleClip[]; stored: StoredAlignedSegment[] }} Clips et contexte aligné.
 */
function reconcilePredefinedClips(
	existingClips: PredefinedSubtitleClip[],
	segments: SegmentationSegment[],
	segmentationSource: 'api' | 'local' | 'import',
	projectTranslation: ProjectTranslation | null
): { clips: PredefinedSubtitleClip[]; stored: StoredAlignedSegment[] } {
	const available = new Map<PredefinedType, PredefinedSubtitleClip[]>();
	for (const clip of [...existingClips].sort((left, right) => left.startTime - right.startTime)) {
		const type = getPredefinedType(undefined, clip.predefinedSubtitleType);
		if (!type) continue;
		const clips = available.get(type) ?? [];
		clips.push(clip);
		available.set(type, clips);
	}

	const clips: PredefinedSubtitleClip[] = [];
	const stored: StoredAlignedSegment[] = [];
	for (const segment of [...segments].sort(
		(left, right) => (left.time_from ?? 0) - (right.time_from ?? 0)
	)) {
		const type = getPredefinedType(segment.ref_from, segment.special_type);
		if (!type || segment.time_from === undefined || segment.time_to === undefined) continue;
		const clip =
			available.get(type)?.shift() ??
			new PredefinedSubtitleClip(
				0,
				0,
				type,
				undefined,
				true,
				segment.confidence ?? null,
				projectTranslation
			);
		clip.startTime = Math.round(segment.time_from * 1000);
		clip.endTime = Math.max(clip.startTime, Math.round(segment.time_to * 1000));
		clip.duration = clip.endTime - clip.startTime;
		clip.comeFromIA = true;
		clip.confidence = segment.confidence ?? null;
		clip.needsReview = segment.confidence !== undefined && segment.confidence <= 0.75;
		const words = getSegmentWords(segment);
		clip.alignmentMetadata = {
			source: segmentationSource,
			segment: segment.segment ?? 0,
			refFrom: segment.ref_from ?? type,
			refTo: segment.ref_to ?? type,
			matchedText: segment.matched_text ?? '',
			specialType: segment.special_type,
			timeFrom: segment.time_from,
			timeTo: segment.time_to,
			words
		};
		clips.push(clip);
		const storedSegment = buildStoredAlignedSegment(
			clip.id,
			'Pre-defined Subtitle',
			clip.startTime,
			clip.endTime,
			segment,
			words
		);
		if (storedSegment) stored.push(storedSegment);
	}
	return { clips, stored };
}

/**
 * Réaligne les clips existants à partir des résultats IA sans reconstruire les sous-titres Quran.
 * @param {ExistingSubtitleAlignmentParams} params Piste, segments et contexte d'alignement.
 * @returns {ExistingSubtitleAlignmentResult} Compteurs et segments alignés persistables.
 */
export function alignExistingSubtitles(
	params: ExistingSubtitleAlignmentParams
): ExistingSubtitleAlignmentResult {
	const {
		subtitleTrack,
		segments,
		segmentationSource,
		projectTranslation,
		fillBySilence,
		extendBeforeSilence = false,
		extendBeforeSilenceMs = 0
	} = params;
	const currentQuranOccurrences = groupCurrentQuranOccurrences(
		subtitleTrack.clips.filter((clip): clip is SubtitleClip => clip instanceof SubtitleClip)
	);
	const alignedQuranOccurrences = groupAlignedQuranOccurrences(segments);
	const alignedCounts = new Map<string, number>();
	for (const occurrence of alignedQuranOccurrences) {
		alignedCounts.set(occurrence.key, (alignedCounts.get(occurrence.key) ?? 0) + 1);
	}
	const currentCounts = new Map<string, number>();
	for (const occurrence of currentQuranOccurrences) {
		currentCounts.set(occurrence.key, (currentCounts.get(occurrence.key) ?? 0) + 1);
	}

	const currentOrdinals = new Map<string, number>();
	const retainedQuran: SubtitleClip[] = [];
	const storedAlignedSegments: StoredAlignedSegment[] = [];
	const deletedMergeGroups = new Set<string>();
	let alignedCursor = 0;
	let segmentsApplied = 0;
	let lowConfidenceSegments = 0;

	for (const occurrence of currentQuranOccurrences) {
		const ordinal = (currentOrdinals.get(occurrence.key) ?? 0) + 1;
		currentOrdinals.set(occurrence.key, ordinal);
		const matchIndex = alignedQuranOccurrences.findIndex(
			(candidate, index) => index >= alignedCursor && candidate.key === occurrence.key
		);
		const alignedCount = alignedCounts.get(occurrence.key) ?? 0;
		if (
			matchIndex === -1 &&
			(currentCounts.get(occurrence.key) ?? 0) > 1 &&
			ordinal > Math.max(alignedCount, 1)
		) {
			for (const clip of occurrence.clips) {
				if (clip.visualMergeGroupId) deletedMergeGroups.add(clip.visualMergeGroupId);
			}
			continue;
		}

		if (matchIndex === -1) {
			for (const clip of occurrence.clips) {
				markLowConfidence(clip);
				retainedQuran.push(clip);
				lowConfidenceSegments += 1;
			}
			continue;
		}

		alignedCursor = matchIndex + 1;
		const alignedOccurrence = alignedQuranOccurrences[matchIndex];
		let sliceCursor = 0;
		let previousClip: SubtitleClip | null = null;
		for (const clip of occurrence.clips) {
			const minimumSliceIndex =
				previousClip && clip.startWordIndex <= previousClip.endWordIndex
					? sliceCursor + 1
					: sliceCursor;
			const match = findAlignedSliceMatch(clip, alignedOccurrence, minimumSliceIndex);
			const stored = match ? retimeQuranClip(clip, match, segmentationSource) : null;
			if (stored && match) {
				sliceCursor = match.endSliceIndex;
				storedAlignedSegments.push(stored);
				segmentsApplied += 1;
				if (clip.needsReview) lowConfidenceSegments += 1;
			} else {
				markLowConfidence(clip);
				lowConfidenceSegments += 1;
			}
			retainedQuran.push(clip);
			previousClip = clip;
		}
	}

	for (const clip of retainedQuran) {
		if (clip.visualMergeGroupId && deletedMergeGroups.has(clip.visualMergeGroupId)) {
			clip.clearVisualMerge();
		}
	}

	const predefined = reconcilePredefinedClips(
		subtitleTrack.clips.filter(
			(clip): clip is PredefinedSubtitleClip => clip instanceof PredefinedSubtitleClip
		),
		segments,
		segmentationSource,
		projectTranslation
	);
	storedAlignedSegments.push(...predefined.stored);
	segmentsApplied += predefined.clips.length;

	const unchangedClips = subtitleTrack.clips.filter(
		(clip) =>
			!(clip instanceof SilenceClip) &&
			!(clip instanceof SubtitleClip) &&
			!(clip instanceof PredefinedSubtitleClip)
	);
	const alignedClips = [...retainedQuran, ...predefined.clips].sort(
		(left, right) => left.startTime - right.startTime
	);
	if (fillBySilence !== undefined) closeSmallSubtitleGaps(alignedClips);
	const timelineClips = fillBySilence === true ? insertSilenceClips(alignedClips) : alignedClips;
	if (fillBySilence && extendBeforeSilence && extendBeforeSilenceMs > 0) {
		extendSubtitlesBeforeSilence(timelineClips, extendBeforeSilenceMs);
	} else if (fillBySilence === false) {
		extendSubtitlesToFillGaps(alignedClips);
	}
	subtitleTrack.clips = [...unchangedClips, ...timelineClips].sort(
		(left, right) => left.startTime - right.startTime
	);

	return { segmentsApplied, lowConfidenceSegments, storedAlignedSegments };
}
