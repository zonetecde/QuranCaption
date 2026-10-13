import { describe, expect, it } from 'vitest';
import { padSegmentBoundaries } from '$lib/services/autoSegmentation/padding';
import type { SegmentationSegment } from '$lib/services/autoSegmentation/types';

describe('padSegmentBoundaries', () => {
	it('pads fully when the gap is wide and keeps words at the same absolute time', () => {
		const segments: SegmentationSegment[] = [
			{ time_from: 1, time_to: 2, words: [{ location: '1:1:1', start: 0, end: 1 }] },
			{ time_from: 4, time_to: 5 }
		];
		padSegmentBoundaries(segments, 100, 200, 10);
		expect(segments[0].time_from).toBeCloseTo(0.9);
		expect(segments[0].time_to).toBeCloseTo(2.2);
		expect(segments[1].time_from).toBeCloseTo(3.9);
		expect(segments[1].time_to).toBeCloseTo(5.2);
		expect(segments[0].words?.[0].start).toBeCloseTo(0.1);
		expect(segments[0].words?.[0].end).toBeCloseTo(1.1);
	});

	it('never pads a segment into its neighbour', () => {
		const segments: SegmentationSegment[] = [
			{ time_from: 0.05, time_to: 1 },
			{ time_from: 1.18, time_to: 2 }
		];
		padSegmentBoundaries(segments, 100, 200, 2.1);
		expect(segments[0].time_from).toBe(0);
		expect(segments[0].time_to).toBeCloseTo(1.18);
		expect(segments[1].time_from).toBeCloseTo(1.18);
		expect(segments[1].time_to).toBeCloseTo(2.1);
	});
});
