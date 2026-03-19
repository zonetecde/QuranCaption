export interface TimeRange {
	start: number;
	end: number;
}

export interface BlurSegment extends TimeRange {
	blur: number;
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
