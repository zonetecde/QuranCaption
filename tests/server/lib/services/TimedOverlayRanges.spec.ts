import { describe, expect, it } from 'vitest';

import {
	appendTimedOverlayRange,
	getTimedOverlayRanges,
	getTimedOverlayRangesFromStyles,
	updateTimedOverlayRange
} from '$lib/services/TimedOverlayRanges';
import { getTimedOverlayOpacity } from '$lib/services/TimedOverlayVisibility';

describe('TimedOverlayRanges', () => {
	it('falls back to the legacy start and end values', () => {
		expect(getTimedOverlayRanges(undefined, 250, 750)).toEqual([{ startTime: 250, endTime: 750 }]);
	});

	it('normalizes ranges from styles with category-specific ids', () => {
		expect(
			getTimedOverlayRangesFromStyles([
				{ id: 'surah-name-time-appearance', value: 500 },
				{ id: 'surah-name-time-disappearance', value: 1500 },
				{
					id: 'surah-name-time-ranges',
					value: [
						{ startTime: 2_000, endTime: 3_000 },
						{ startTime: 0, endTime: 500 }
					]
				}
			])
		).toEqual([
			{ startTime: 0, endTime: 500 },
			{ startTime: 2_000, endTime: 3_000 }
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

	it('appends a new appearance after the last range', () => {
		expect(appendTimedOverlayRange([{ startTime: 0, endTime: 1_000 }])).toEqual([
			{ startTime: 0, endTime: 1_000 },
			{ startTime: 2_000, endTime: 5_000 }
		]);
	});
});

describe('getTimedOverlayOpacity', () => {
	it('uses the highest opacity of the active appearance range', () => {
		const ranges = [
			{ startTime: 0, endTime: 1_000 },
			{ startTime: 2_000, endTime: 3_000 }
		];

		expect(
			getTimedOverlayOpacity({
				alwaysShow: false,
				maxOpacity: 1,
				currentTime: 500,
				fadeDuration: 100,
				ranges
			})
		).toBe(1);
		expect(
			getTimedOverlayOpacity({
				alwaysShow: false,
				maxOpacity: 1,
				currentTime: 1_500,
				fadeDuration: 100,
				ranges
			})
		).toBe(0);
		expect(
			getTimedOverlayOpacity({
				alwaysShow: false,
				maxOpacity: 1,
				currentTime: 2_050,
				fadeDuration: 100,
				ranges
			})
		).toBe(0.5);
	});
});
