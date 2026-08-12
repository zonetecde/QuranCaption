import type {
	SegmentationSegment,
	SegmentationWordTimestamp,
	StoredAlignedSegment,
	StoredSegmentationContext,
	SubtitleAlignmentMetadata
} from './types';
import { parseVerseRef } from './verse-ref';
import { globalState } from '$lib/runes/main.svelte';
import { SubtitleClip, PredefinedSubtitleClip, TrackType, type Project } from '$lib/classes';

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
export function getSegmentWords(segment: SegmentationSegment): SegmentationWordTimestamp[] {
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
 * @param {number} verse Verset cible.
 * @returns {SegmentationWordTimestamp[]} Liste filtrée dans l'ordre d'origine.
 */
export function filterWordsForVerse(
	words: SegmentationWordTimestamp[],
	surah: number,
	verse: number
): SegmentationWordTimestamp[] {
	return words.filter(
		(word) => typeof word.location === 'string' && word.location.startsWith(`${surah}:${verse}:`)
	);
}

/**
 * Sépare les mots lorsqu'une référence repart en arrière dans un même verset.
 *
 * @param {SegmentationWordTimestamp[]} words Liste de mots MFA dans l'ordre temporel.
 * @returns {SegmentationWordTimestamp[][]} Séquences dont les références sont strictement croissantes.
 */
export function splitWordsAtReferenceReset(
	words: SegmentationWordTimestamp[]
): SegmentationWordTimestamp[][] {
	const groups: SegmentationWordTimestamp[][] = [];
	let currentGroup: SegmentationWordTimestamp[] = [];
	let previousRef: ReturnType<typeof parseVerseRef> = null;

	for (const word of words) {
		const ref = parseVerseRef(word.location);
		if (
			currentGroup.length > 0 &&
			ref &&
			previousRef &&
			ref.surah === previousRef.surah &&
			ref.verse === previousRef.verse &&
			ref.word <= previousRef.word
		) {
			groups.push(currentGroup);
			currentGroup = [];
		}

		currentGroup.push(word);
		previousRef = ref;
	}

	if (currentGroup.length > 0) groups.push(currentGroup);
	return groups;
}

/**
 * Construit la métadonnée d'alignement persistée sur un sous-titre Quran.
 *
 * @param {'api' | 'local' | 'import'} source Source de la segmentation.
 * @param {SegmentationSegment} segment Segment source.
 * @param {SegmentationWordTimestamp[]} words Liste des mots associés au clip.
 * @returns {SubtitleAlignmentMetadata | null} Métadonnée prête à persister.
 */
export function buildSubtitleAlignmentMetadata(
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
export function buildStoredAlignedSegment(
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

/**
 * Reconstruit le contexte runtime à partir des clips actuellement présents sur la timeline.
 *
 * @param {boolean} preserveAudioId Si true, conserve l'audio_id courant.
 * @param {Project} [project] Projet explicite à actualiser hors éditeur.
 */
export function refreshSegmentationContextFromTrack(
	preserveAudioId: boolean,
	project?: Project
): void {
	const subtitlesEditorState = project
		? project.projectEditorState.subtitlesEditor
		: globalState.getSubtitlesEditorState;
	const clips = project
		? project.content.timeline.getFirstTrack(TrackType.Subtitle).clips
		: globalState.getSubtitleTrack.clips;
	const currentContext = subtitlesEditorState.segmentationContext;
	const existingById = new Map(
		currentContext.alignedSegments.map((segment) => [segment.clipId, segment])
	);
	const alignedSegments: StoredAlignedSegment[] = [];

	for (const rawClip of clips) {
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

		if (rawClip instanceof PredefinedSubtitleClip && rawClip.alignmentMetadata) {
			const metadata = rawClip.alignmentMetadata;
			alignedSegments.push({
				clipId: rawClip.id,
				type: 'Pre-defined Subtitle',
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

	subtitlesEditorState.segmentationContext = {
		...currentContext,
		audioId: preserveAudioId ? currentContext.audioId : null,
		includeWbwTimestamps: currentContext.includeWbwTimestamps,
		alignedSegments
	};
}
