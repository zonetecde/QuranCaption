import { describe, expect, it } from 'vitest';
import {
	appendTimedOverlayRange,
	getTimedOverlayRanges,
	normalizeTimedOverlayRanges,
	updateTimedOverlayRange
} from '$lib/services/TimedOverlayRanges';

describe('TimedOverlayRanges', () => {
	it('normalizes valid ranges and ignores invalid entries', () => {
		expect(
			normalizeTimedOverlayRanges([
				{ startTime: 5000, endTime: 7000 },
				{ startTime: -5, endTime: 100 },
				{ startTime: 4, endTime: 4 },
				{ startTime: 'bad', endTime: 10 }
			])
		).toEqual([
			{ startTime: 0, endTime: 100 },
			{ startTime: 5000, endTime: 7000 }
		]);
	});

	it('falls back to the legacy appearance and disappearance styles', () => {
		expect(getTimedOverlayRanges(undefined, 1200, 3400)).toEqual([
			{ startTime: 1200, endTime: 3400 }
		]);
	});

	it('can preserve range order for timeline editing', () => {
		expect(
			getTimedOverlayRanges(
				[
					{ startTime: 2_000, endTime: 3_000 },
					{ startTime: 0, endTime: 500 }
				],
				undefined,
				undefined,
				false
			)
		).toEqual([
			{ startTime: 2_000, endTime: 3_000 },
			{ startTime: 0, endTime: 500 }
		]);
	});

	it('allows edited ranges to overlap their neighbors', () => {
		const ranges = [
			{ startTime: 0, endTime: 1_000 },
			{ startTime: 2_000, endTime: 3_000 }
		];

		expect(updateTimedOverlayRange(ranges, 0, 'endTime', 2_500)).toEqual([
			{ startTime: 0, endTime: 2_500 },
			{ startTime: 2_000, endTime: 3_000 }
		]);
		expect(updateTimedOverlayRange(ranges, 1, 'startTime', 500)).toEqual([
			{ startTime: 0, endTime: 1_000 },
			{ startTime: 500, endTime: 3_000 }
		]);
	});

	it('keeps the minimum duration when changing a range bound', () => {
		const ranges = [{ startTime: 1000, endTime: 3000 }];
		expect(updateTimedOverlayRange(ranges, 0, 'startTime', 5000)).toEqual([
			{ startTime: 2900, endTime: 3000 }
		]);
		expect(updateTimedOverlayRange(ranges, 0, 'endTime', 500)).toEqual([
			{ startTime: 1000, endTime: 1100 }
		]);
	});

	it('appends a range after the last normalized range', () => {
		expect(appendTimedOverlayRange([{ startTime: 1000, endTime: 2000 }])).toEqual([
			{ startTime: 1000, endTime: 2000 },
			{ startTime: 3000, endTime: 6000 }
		]);
	});
});
