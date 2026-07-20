import { describe, expect, it } from 'vitest';

import {
	buildBlurSegmentsForRange,
	getRecitationRangesForExport,
	mapTimeToExportRanges,
	splitRangeByBoundaries
} from '$lib/services/OverlayBlurSegmentation';
import { SubtitleClip } from '$lib/classes/Clip.svelte';

describe('splitRangeByBoundaries', () => {
	it('splits a range using internal boundaries only', () => {
		const result = splitRangeByBoundaries({ start: 0, end: 1000 }, [-50, 0, 200, 500, 1000, 1200]);
		expect(result).toEqual([
			{ start: 0, end: 200 },
			{ start: 200, end: 500 },
			{ start: 500, end: 1000 }
		]);
	});
});

describe('buildBlurSegmentsForRange', () => {
	it('merges adjacent segments with identical blur values', () => {
		const result = buildBlurSegmentsForRange({ start: 0, end: 1000 }, [200, 500, 800], (time) =>
			time < 500 ? 5 : 10
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
		const result = buildBlurSegmentsForRange({ start: 0, end: 100 }, [50], (time) =>
			time < 50 ? Number.NaN : Number.POSITIVE_INFINITY
		);
		expect(result).toEqual([{ start: 0, end: 100, blur: 0 }]);
	});
});

describe('recitation export timeline', () => {
	it('maps source timestamps after removed silence', () => {
		const clips = [
			new SubtitleClip(1000, 3000, 1, 1, 0, 0, 'a', [], true, true),
			new SubtitleClip(7000, 9000, 1, 2, 0, 0, 'b', [], true, true)
		];
		const ranges = getRecitationRangesForExport(clips, 0, 10_000, 3000, 350);

		expect(ranges).toEqual([
			{ start: 650, end: 3350 },
			{ start: 6650, end: 9350 }
		]);
		expect(mapTimeToExportRanges(7000, ranges)).toBe(3050);
	});

	it('keeps short silences in a single range', () => {
		const clips = [
			new SubtitleClip(1000, 3000, 1, 1, 0, 0, 'a', [], true, true),
			new SubtitleClip(5000, 7000, 1, 2, 0, 0, 'b', [], true, true)
		];

		expect(getRecitationRangesForExport(clips, 0, 8000, 3000, 350)).toEqual([
			{ start: 650, end: 7350 }
		]);
	});
});
