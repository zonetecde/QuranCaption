import { describe, expect, it } from 'vitest';

import {
	calculateCaptureTimingsForRange,
	getTimedOverlayStateAt,
	hasBlankImg,
	hasTiming,
	resolveCurrentSurahFromClips,
	type ExportSubtitleCaptureClip,
	type ExportTimedOverlayCaptureClip
} from '$lib/services/ExportCaptureTiming';

function subtitle(
	startTime: number,
	endTime: number,
	surah: number
): ExportSubtitleCaptureClip {
	return { startTime, endTime, surah, kind: 'subtitle' };
}

function silence(startTime: number, endTime: number): ExportSubtitleCaptureClip {
	return { startTime, endTime, kind: 'silence' };
}

function predefined(startTime: number, endTime: number): ExportSubtitleCaptureClip {
	return { startTime, endTime, kind: 'predefined' };
}

function customText(
	id: number,
	startTime: number | null,
	endTime: number | null,
	alwaysShow: boolean = false
): ExportTimedOverlayCaptureClip {
	return {
		id,
		startTime,
		endTime,
		alwaysShow,
		captureBoundariesWhenAlwaysShow: true
	};
}

function timedOverlay(
	id: string,
	startTime: number | null,
	endTime: number | null,
	alwaysShow: boolean = false,
	isVisibleAt?: (timing: number) => boolean
): ExportTimedOverlayCaptureClip {
	return {
		id,
		startTime,
		endTime,
		alwaysShow,
		isVisibleAt
	};
}

function calculateTimings(
	subtitleClips: ExportSubtitleCaptureClip[],
	timedOverlayClips: ExportTimedOverlayCaptureClip[] = [],
	rangeStart: number = 0,
	rangeEnd: number = 5_000,
	fadeDuration: number = 200
) {
	return calculateCaptureTimingsForRange({
		rangeStart,
		rangeEnd,
		fadeDuration,
		subtitleClips,
		timedOverlayClips,
		getCurrentSurah: (time) => resolveCurrentSurahFromClips(subtitleClips, time)
	});
}

describe('resolveCurrentSurahFromClips', () => {
	it('returns the active subtitle surah when the cursor is inside a subtitle', () => {
		expect(resolveCurrentSurahFromClips([subtitle(0, 500, 1)], 250)).toBe(1);
	});

	it('returns the previous subtitle surah when the cursor is inside a silence clip', () => {
		const clips = [subtitle(0, 500, 1), silence(501, 800), subtitle(801, 1200, 4)];
		expect(resolveCurrentSurahFromClips(clips, 650)).toBe(1);
	});

	it('returns the next subtitle surah when the cursor is before the first subtitle', () => {
		expect(resolveCurrentSurahFromClips([subtitle(100, 500, 36)], 50)).toBe(36);
	});

	it('returns the previous subtitle surah for decimal holes instead of the last surah in the project', () => {
		const clips = [
			subtitle(273.50427350427356, 307.49, 1),
			subtitle(309.01, 4239.49, 1),
			subtitle(30_000, 31_000, 112)
		];

		expect(resolveCurrentSurahFromClips(clips, 308)).toBe(1);
	});

	it('returns the next subtitle surah when the current non-subtitle clip has no previous subtitle', () => {
		const clips = [predefined(0, 100), subtitle(101, 400, 55)];
		expect(resolveCurrentSurahFromClips(clips, 50)).toBe(55);
	});

	it('returns the last subtitle surah after the final clip', () => {
		const clips = [subtitle(0, 500, 1), subtitle(1_000, 1_500, 112)];
		expect(resolveCurrentSurahFromClips(clips, 2_000)).toBe(112);
	});

	it('returns -1 when there is no subtitle at all', () => {
		expect(resolveCurrentSurahFromClips([silence(0, 500), predefined(600, 700)], 650)).toBe(-1);
	});
});

describe('getTimedOverlayStateAt', () => {
	it('ignores always-show overlays and sorts timed overlays for a stable signature', () => {
		const clips = [
			customText(7, 0, 500, true),
			customText(2, 0, 500),
			timedOverlay('surah-name', 100, 400)
		];

		expect(getTimedOverlayStateAt(200, clips)).toBe('2-0-500|surah-name-100-400');
	});

	it('returns an empty signature when no timed overlay is visible', () => {
		expect(getTimedOverlayStateAt(900, [customText(1, 0, 500)])).toBe('');
	});

	it('respects isVisibleAt for overlays like verse number', () => {
		const verseNumber = timedOverlay('verse-number', 0, 1_000, false, (timing) => timing >= 200);
		expect(getTimedOverlayStateAt(100, [verseNumber])).toBe('');
		expect(getTimedOverlayStateAt(300, [verseNumber])).toBe('verse-number-0-1000');
	});
});

describe('calculateCaptureTimingsForRange', () => {
	it('reuses the fade-out screenshot when timed overlay visibility is unchanged across the subtitle', () => {
		const result = calculateTimings([subtitle(0, 1_000, 1)], [customText(9, 0, 2_000)]);

		expect(result.uniqueSorted).toEqual([0, 200, 1_000, 1_800, 2_000, 5_000]);
		expect(result.duplicableTimings).toEqual(new Map([[800, 200]]));
		expect(result.imgWithNothingShown).toEqual({});
		expect(result.blankImgs).toEqual({});
	});

	it('keeps distinct fade-in and fade-out captures when timed overlay visibility changes mid-subtitle', () => {
		const result = calculateTimings([subtitle(0, 1_000, 1)], [customText(9, 0, 300)]);

		expect(result.uniqueSorted).toEqual([0, 100, 200, 300, 800, 1_000, 5_000]);
		expect(result.duplicableTimings.size).toBe(0);
		expect(result.imgWithNothingShown).toEqual({ 1: 1_000 });
	});

	it('creates one reusable blank image per surah and reuses it for later subtitles of the same surah', () => {
		const result = calculateTimings([subtitle(0, 500, 1), subtitle(1_000, 1_500, 1)]);

		expect(result.imgWithNothingShown).toEqual({ 1: 500 });
		expect(result.blankImgs).toEqual({ 1: [1_500] });
	});

	it('groups reusable blank images by surah', () => {
		const result = calculateTimings([subtitle(0, 500, 1), subtitle(1_000, 1_500, 112)]);

		expect(result.imgWithNothingShown).toEqual({ 1: 500, 112: 1_500 });
		expect(result.blankImgs).toEqual({});
	});

	it('reuses an existing blank image during silence clips on the same surah', () => {
		const result = calculateTimings([subtitle(0, 500, 1), silence(501, 900)]);

		expect(result.imgWithNothingShown).toEqual({ 1: 500 });
		expect(result.blankImgs[1]).toEqual([900, 900]);
		expect(hasTiming(result.blankImgs, 900)).toEqual({ hasIt: true, surah: 1 });
		expect(hasBlankImg(result.imgWithNothingShown, 1)).toBe(true);
	});

	it('does not register a blank image when a timed overlay is still visible at subtitle end', () => {
		const result = calculateTimings([subtitle(0, 500, 1)], [customText(3, 100, 700)]);

		expect(result.imgWithNothingShown).toEqual({});
		expect(result.blankImgs).toEqual({});
	});

	it('does register a blank image when the overlapping overlay is always-show', () => {
		const result = calculateTimings([subtitle(0, 500, 1)], [customText(3, 100, 700, true)]);

		expect(result.imgWithNothingShown).toEqual({ 1: 500 });
	});

	it('adds only boundary screenshots for always-show custom texts', () => {
		const result = calculateTimings([], [customText(5, 100, 700, true)], 0, 1_000);

		expect(result.uniqueSorted).toEqual([0, 100, 700, 1_000]);
	});

	it('adds fade-in, fade-out and end screenshots for timed custom texts', () => {
		const result = calculateTimings([], [customText(5, 100, 800)], 0, 1_000, 200);

		expect(result.uniqueSorted).toEqual([0, 300, 600, 800, 1_000]);
	});

	it('clips timings to the requested export range and rounds decimal captures', () => {
		const result = calculateTimings([subtitle(90.6, 120.4, 1)], [], 100, 121, 50);

		expect(result.uniqueSorted).toEqual([100, 120, 121]);
		expect(result.imgWithNothingShown).toEqual({ 1: 120 });
	});

	it('ignores invalid or zero-length clips', () => {
		const result = calculateTimings(
			[
				subtitle(0, 0, 1),
				subtitle(100, 100, 2),
				subtitle(200, 400, 3)
			],
			[customText(1, 500, 500)],
			0,
			1_000,
			100
		);

		expect(result.imgWithNothingShown).toEqual({ 3: 400 });
		expect(result.uniqueSorted).toEqual([0, 300, 400, 1_000]);
	});

	it('allows duplication when a timed global overlay stays visible for the whole subtitle', () => {
		const result = calculateTimings([subtitle(0, 1_000, 1)], [timedOverlay('surah-name', 0, 2_000)]);

		expect(result.duplicableTimings).toEqual(new Map([[800, 200]]));
	});

	it('prevents duplication when a timed global overlay changes state during the subtitle', () => {
		const result = calculateTimings([subtitle(0, 1_000, 1)], [timedOverlay('reciter-name', 0, 300)]);

		expect(result.duplicableTimings.size).toBe(0);
		expect(result.uniqueSorted).toEqual([0, 100, 200, 300, 800, 1_000, 5_000]);
	});

	it('does not create a blank image when a timed global overlay is visible at subtitle end', () => {
		const result = calculateTimings(
			[subtitle(0, 500, 1)],
			[timedOverlay('surah-name', 100, 700)]
		);

		expect(result.imgWithNothingShown).toEqual({});
		expect(result.blankImgs).toEqual({});
	});

	it('combines custom overlays and global overlays in duplication decisions', () => {
		const result = calculateTimings(
			[subtitle(0, 1_000, 1)],
			[customText(1, 0, 2_000), timedOverlay('surah-name', 0, 2_000)]
		);

		expect(result.duplicableTimings).toEqual(new Map([[800, 200]]));
	});

	it('keeps verse number hidden outside subtitle-active timings even inside its global timed range', () => {
		const result = calculateTimings(
			[subtitle(0, 500, 1), silence(501, 900)],
			[
				timedOverlay('verse-number', 0, 1_000, false, (timing) => timing >= 0 && timing <= 500)
			]
		);

		expect(result.imgWithNothingShown).toEqual({ 1: 900 });
		expect(result.blankImgs).toEqual({});
	});
});
