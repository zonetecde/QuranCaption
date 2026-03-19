import { describe, expect, it } from 'vitest';

import { buildBlurSegmentsForRange, splitRangeByBoundaries } from './OverlayBlurSegmentation';

describe('splitRangeByBoundaries', () => {
	it('splits a range using internal boundaries only', () => {
		const result = splitRangeByBoundaries(
			{ start: 0, end: 1000 },
			[-50, 0, 200, 500, 1000, 1200]
		);
		expect(result).toEqual([
			{ start: 0, end: 200 },
			{ start: 200, end: 500 },
			{ start: 500, end: 1000 }
		]);
	});
});

describe('buildBlurSegmentsForRange', () => {
	it('merges adjacent segments with identical blur values', () => {
		const result = buildBlurSegmentsForRange(
			{ start: 0, end: 1000 },
			[200, 500, 800],
			(time) => (time < 500 ? 5 : 10)
		);

		expect(result).toEqual([
			{ start: 0, end: 500, blur: 5 },
			{ start: 500, end: 1000, blur: 10 }
		]);
	});

	it('returns one segment when there are no effective boundaries', () => {
		const result = buildBlurSegmentsForRange({ start: 100, end: 300 }, [], () => 2.5);
		expect(result).toEqual([{ start: 100, end: 300, blur: 2.5 }]);
	});

	it('normalizes invalid blur values to 0', () => {
		const result = buildBlurSegmentsForRange(
			{ start: 0, end: 100 },
			[50],
			(time) => (time < 50 ? Number.NaN : Number.POSITIVE_INFINITY)
		);
		expect(result).toEqual([{ start: 0, end: 100, blur: 0 }]);
	});
});
