import { describe, expect, it } from 'vitest';

import {
	buildHifzRepetitionPlan,
	detectCoverageGapIndices,
	parseImportedSegmentationJson
} from '$lib/services/AutoSegmentation';

type Segment = {
	ref_from?: string;
	ref_to?: string;
	error?: string | null;
};

type CoverageDeps = {
	getVerseWordCount: (surah: number, verse: number) => Promise<number | null>;
	getVerseCount: (surah: number) => number;
	getSurahCount: () => number;
};

const createDeps = (
	wordCounts: Record<string, number>,
	verseCounts: Record<number, number>,
	surahCount = 114
): CoverageDeps => ({
	getVerseWordCount: async (surah: number, verse: number) =>
		wordCounts[`${surah}:${verse}`] ?? null,
	getVerseCount: (surah: number) => verseCounts[surah] ?? 0,
	getSurahCount: () => surahCount
});

const toSortedArray = (set: Set<number>) => Array.from(set).sort((a, b) => a - b);

describe('detectCoverageGapIndices', () => {
	it('flags gaps when words are skipped within a verse', async () => {
		const segments: Segment[] = [
			{ ref_from: '112:1:1', ref_to: '112:1:2' },
			{ ref_from: '112:1:4', ref_to: '112:1:4' }
		];
		const deps = createDeps({ '112:1': 4 }, { 112: 4 });

		const result = await detectCoverageGapIndices(segments, deps);

		expect(toSortedArray(result)).toEqual([0, 1]);
	});

	it('flags gaps when an entire verse is skipped', async () => {
		const segments: Segment[] = [
			{ ref_from: '112:1:1', ref_to: '112:1:4' },
			{ ref_from: '112:3:1', ref_to: '112:3:4' }
		];
		const deps = createDeps({ '112:1': 4, '112:2': 2, '112:3': 4, '112:4': 5 }, { 112: 4 });

		const result = await detectCoverageGapIndices(segments, deps);

		expect(toSortedArray(result)).toEqual([0, 1]);
	});

	it('does not flag gaps that are covered by later repeats', async () => {
		const segments: Segment[] = [
			{ ref_from: '25:6:1', ref_to: '25:6:2' },
			{ ref_from: '25:6:4', ref_to: '25:6:4' },
			{ ref_from: '25:6:3', ref_to: '25:6:3' }
		];
		const deps = createDeps({ '25:6': 4 }, { 25: 6 });

		const result = await detectCoverageGapIndices(segments, deps);

		expect(toSortedArray(result)).toEqual([]);
	});
});

describe('parseImportedSegmentationJson', () => {
	it('parses valid JSON string payload', () => {
		const payload = JSON.stringify({
			segments: [
				{
					segment: 1,
					time_from: 0.5,
					time_to: 1.2,
					ref_from: '112:1:1',
					ref_to: '112:1:4',
					confidence: 0.98,
					error: null
				}
			]
		});

		const parsed = parseImportedSegmentationJson(payload);
		expect(parsed.segmentCount).toBe(1);
		expect(parsed.response.segments?.[0].time_from).toBe(0.5);
	});

	it('parses valid object payload', () => {
		const parsed = parseImportedSegmentationJson({
			segments: [{ segment: 1, time_from: '0.25', time_to: '2.5', error: null }]
		});
		expect(parsed.segmentCount).toBe(1);
		expect(parsed.response.segments?.[0].time_to).toBe(2.5);
	});

	it('keeps audio_id and normalized word timestamps from imported payloads', () => {
		const parsed = parseImportedSegmentationJson({
			audio_id: 'session-123',
			segments: [
				{
					segment: 1,
					time_from: 0,
					time_to: 2,
					words: [['1:1:1', 0, 0.5], { location: '1:1:2', start: 0.5, end: 1.1, word: 'word' }]
				}
			]
		});

		expect(parsed.response.audio_id).toBe('session-123');
		expect(parsed.response.segments?.[0].words).toEqual([
			{ location: '1:1:1', start: 0, end: 0.5 },
			{ location: '1:1:2', start: 0.5, end: 1.1, word: 'word' }
		]);
	});

	it("throws when payload has no 'segments' array", () => {
		expect(() => parseImportedSegmentationJson({ foo: 'bar' })).toThrow(
			"Invalid payload: missing 'segments' array."
		);
	});

	it('throws when a segment is invalid', () => {
		expect(() =>
			parseImportedSegmentationJson({
				segments: [{ segment: 1, time_from: 1.2 }]
			})
		).toThrow("Invalid segment at index 0: 'time_from' and 'time_to' are required.");
	});
});

describe('buildHifzRepetitionPlan', () => {
	it('repeats Quran subtitle clips while keeping predefined clips single-pass', () => {
		const plan = buildHifzRepetitionPlan(
			[
				{ kind: 'predefined', originalStartMs: 0, originalEndMs: 1200 },
				{ kind: 'subtitle', originalStartMs: 1200, originalEndMs: 2000 },
				{ kind: 'subtitle', originalStartMs: 2000, originalEndMs: 2600 }
			],
			3
		);

		expect(plan.placements).toEqual([
			{ sourceIndex: 0, startMs: 0, endMs: 1200, repetition: 1 },
			{ sourceIndex: 1, startMs: 1201, endMs: 2001, repetition: 1 },
			{ sourceIndex: 1, startMs: 2002, endMs: 2802, repetition: 2 },
			{ sourceIndex: 1, startMs: 2803, endMs: 3603, repetition: 3 },
			{ sourceIndex: 2, startMs: 3604, endMs: 4204, repetition: 1 },
			{ sourceIndex: 2, startMs: 4205, endMs: 4805, repetition: 2 },
			{ sourceIndex: 2, startMs: 4806, endMs: 5406, repetition: 3 }
		]);
		expect(plan.audioSegments).toEqual([
			{ startMs: 0, endMs: 1200, repeatCount: 1 },
			{ startMs: 1200, endMs: 2000, repeatCount: 1 },
			{ startMs: 1200, endMs: 2000, repeatCount: 1 },
			{ startMs: 1200, endMs: 2000, repeatCount: 1 },
			{ startMs: 2000, endMs: 2600, repeatCount: 1 },
			{ startMs: 2000, endMs: 2600, repeatCount: 1 },
			{ startMs: 2000, endMs: 2600, repeatCount: 1 }
		]);
		expect(plan.totalDurationMs).toBe(5406);
	});
});
