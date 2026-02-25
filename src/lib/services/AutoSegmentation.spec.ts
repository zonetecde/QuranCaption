import { describe, expect, it } from 'vitest';

import { detectCoverageGapIndices, parseImportedSegmentationJson } from './AutoSegmentation';

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
