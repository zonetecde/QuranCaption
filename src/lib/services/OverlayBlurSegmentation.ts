import {
	PredefinedSubtitleClip,
	SubtitleClip,
	type Clip,
	type PredefinedSubtitleType
} from '$lib/classes/Clip.svelte';

export interface TimeRange {
	start: number;
	end: number;
}

export interface BlurSegment extends TimeRange {
	blur: number;
}

const RETAINED_PREDEFINED_RECITATION_TYPES = new Set<PredefinedSubtitleType>([
	'Basmala',
	"Isti'adha",
	'Amin'
]);

/**
 * Regroupe les clips de récitation conservés dans l'export et ajoute les marges de coupe.
 * @param {Clip[]} clips Clips de sous-titres ordonnables de la timeline source.
 * @param {number} rangeStart Début de la plage d'export en millisecondes.
 * @param {number} rangeEnd Fin de la plage d'export en millisecondes.
 * @param {number} minimumSilenceMs Silence minimal à retirer entre deux récitations.
 * @param {number} cutMarginMs Marge conservée autour de chaque plage de récitation.
 * @returns {TimeRange[]} Plages de récitation concaténées par l'export vidéo.
 */
export function getRecitationRangesForExport(
	clips: Clip[],
	rangeStart: number,
	rangeEnd: number,
	minimumSilenceMs: number,
	cutMarginMs: number
): TimeRange[] {
	const orderedClips = [...clips].sort((a, b) => a.startTime - b.startTime);
	const quranClips = orderedClips.filter(
		(clip) =>
			(clip instanceof SubtitleClip ||
				(clip instanceof PredefinedSubtitleClip &&
					RETAINED_PREDEFINED_RECITATION_TYPES.has(clip.predefinedSubtitleType))) &&
			clip.endTime >= rangeStart &&
			clip.startTime <= rangeEnd
	);
	const ranges: TimeRange[] = [];
	const clampedMinimumSilenceMs = Math.max(0, minimumSilenceMs);

	for (const clip of quranClips) {
		const start = Math.max(rangeStart, clip.startTime);
		const end = Math.min(rangeEnd, clip.endTime);
		const current = ranges.at(-1);
		if (!current) {
			ranges.push({ start, end });
			continue;
		}

		const containsPredefinedText = orderedClips.some(
			(candidate) =>
				candidate instanceof PredefinedSubtitleClip &&
				!RETAINED_PREDEFINED_RECITATION_TYPES.has(candidate.predefinedSubtitleType) &&
				candidate.startTime <= start &&
				candidate.endTime >= current.end
		);
		if (!containsPredefinedText && start - current.end < clampedMinimumSilenceMs) {
			current.end = Math.max(current.end, end);
		} else {
			ranges.push({ start, end });
		}
	}

	const paddedRanges: TimeRange[] = [];
	const clampedCutMarginMs = Math.max(0, cutMarginMs);
	for (const range of ranges) {
		const paddedRange = {
			start: Math.max(rangeStart, range.start - clampedCutMarginMs),
			end: Math.min(rangeEnd, range.end + clampedCutMarginMs)
		};
		const previous = paddedRanges.at(-1);
		if (previous && paddedRange.start <= previous.end) {
			previous.end = Math.max(previous.end, paddedRange.end);
		} else {
			paddedRanges.push(paddedRange);
		}
	}

	return paddedRanges;
}

/**
 * Convertit un timestamp source vers la timeline obtenue après concaténation des plages conservées.
 * @param {number} timeMs Timestamp dans la timeline originale.
 * @param {TimeRange[]} ranges Plages conservées, triées dans l'ordre de lecture.
 * @returns {number} Timestamp correspondant dans la vidéo raccourcie.
 */
export function mapTimeToExportRanges(timeMs: number, ranges: TimeRange[]): number {
	let elapsedMs = 0;

	for (const range of ranges) {
		if (timeMs < range.start) return elapsedMs;
		if (timeMs <= range.end) return elapsedMs + timeMs - range.start;
		elapsedMs += range.end - range.start;
	}

	return elapsedMs;
}

/**
 * Retire des plages temporelles d'une liste de segments conservés.
 * @param {TimeRange[]} ranges Plages sources à conserver.
 * @param {TimeRange[]} excludedRanges Plages à retirer, éventuellement superposées.
 * @returns {TimeRange[]} Plages restantes, triées dans l'ordre de lecture.
 */
export function excludeTimeRanges(ranges: TimeRange[], excludedRanges: TimeRange[]): TimeRange[] {
	let remainingRanges = ranges
		.filter((range) => range.end > range.start)
		.sort((a, b) => a.start - b.start)
		.map((range) => ({ ...range }));

	for (const excluded of excludedRanges
		.filter((range) => range.end > range.start)
		.sort((a, b) => a.start - b.start)) {
		remainingRanges = remainingRanges.flatMap((range) => {
			if (excluded.end <= range.start || excluded.start >= range.end) return [range];

			const parts: TimeRange[] = [];
			if (excluded.start > range.start) {
				parts.push({ start: range.start, end: Math.min(excluded.start, range.end) });
			}
			if (excluded.end < range.end) {
				parts.push({ start: Math.max(excluded.end, range.start), end: range.end });
			}
			return parts;
		});
	}

	return remainingRanges;
}

function normalizeBlur(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return value;
}

export function splitRangeByBoundaries(range: TimeRange, boundaries: number[]): TimeRange[] {
	const points = new Set<number>([Math.round(range.start), Math.round(range.end)]);

	for (const boundary of boundaries) {
		const rounded = Math.round(boundary);
		if (rounded > range.start && rounded < range.end) {
			points.add(rounded);
		}
	}

	const sortedPoints = Array.from(points).sort((a, b) => a - b);
	const segments: TimeRange[] = [];

	for (let i = 0; i < sortedPoints.length - 1; i++) {
		const start = sortedPoints[i];
		const end = sortedPoints[i + 1];
		if (end > start) {
			segments.push({ start, end });
		}
	}

	return segments;
}

export function buildBlurSegmentsForRange(
	range: TimeRange,
	boundaries: number[],
	getBlurAt: (time: number) => number
): BlurSegment[] {
	const baseSegments = splitRangeByBoundaries(range, boundaries);
	if (baseSegments.length === 0) return [];

	const withBlur = baseSegments.map((segment) => ({
		...segment,
		blur: normalizeBlur(getBlurAt(segment.start))
	}));

	const merged: BlurSegment[] = [];
	for (const segment of withBlur) {
		const previous = merged[merged.length - 1];
		if (previous && previous.blur === segment.blur && previous.end === segment.start) {
			previous.end = segment.end;
			continue;
		}
		merged.push({ ...segment });
	}

	return merged;
}
