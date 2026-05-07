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
	it('repeats each verse block rather than each subtitle clip', () => {
		const plan = buildHifzRepetitionPlan(
			[
				{ kind: 'predefined', originalStartMs: 0, originalEndMs: 1200 },
				{
					kind: 'subtitle',
					originalStartMs: 1200,
					originalEndMs: 1600,
					surah: 2,
					verseNumber: 1
				},
				{
					kind: 'subtitle',
					originalStartMs: 1700,
					originalEndMs: 2200,
					surah: 2,
					verseNumber: 1
				},
				{
					kind: 'subtitle',
					originalStartMs: 2300,
					originalEndMs: 2600,
					surah: 2,
					verseNumber: 2
				}
			],
			3,
			'verse'
		);

		expect(plan.placements).toEqual([
			{ sourceIndex: 0, startMs: 0, endMs: 1200, repetition: 1 },
			{ sourceIndex: 1, startMs: 1200, endMs: 1600, repetition: 1 },
			{ sourceIndex: 2, startMs: 1700, endMs: 2200, repetition: 1 },
			{ sourceIndex: 1, startMs: 2200, endMs: 2600, repetition: 2 },
			{ sourceIndex: 2, startMs: 2700, endMs: 3200, repetition: 2 },
			{ sourceIndex: 1, startMs: 3200, endMs: 3600, repetition: 3 },
			{ sourceIndex: 2, startMs: 3700, endMs: 4200, repetition: 3 },
			{ sourceIndex: 3, startMs: 4200, endMs: 4500, repetition: 1 },
			{ sourceIndex: 3, startMs: 4500, endMs: 4800, repetition: 2 },
			{ sourceIndex: 3, startMs: 4800, endMs: 5100, repetition: 3 }
		]);
		expect(plan.audioSegments).toEqual([
			{ startMs: 0, endMs: 1200, repeatCount: 1 },
			{ startMs: 1200, endMs: 2200, repeatCount: 3 },
			{ startMs: 2300, endMs: 2600, repeatCount: 3 }
		]);
		expect(plan.totalDurationMs).toBe(5100);
	});

	it('can repeat each subtitle independently when requested', () => {
		const plan = buildHifzRepetitionPlan(
			[
				{
					kind: 'subtitle',
					originalStartMs: 1200,
					originalEndMs: 1600,
					surah: 2,
					verseNumber: 1
				},
				{
					kind: 'subtitle',
					originalStartMs: 1700,
					originalEndMs: 2200,
					surah: 2,
					verseNumber: 1
				}
			],
			2,
			'subtitle'
		);

		expect(plan.placements).toEqual([
			{ sourceIndex: 0, startMs: 0, endMs: 400, repetition: 1 },
			{ sourceIndex: 0, startMs: 400, endMs: 800, repetition: 2 },
			{ sourceIndex: 1, startMs: 800, endMs: 1300, repetition: 1 },
			{ sourceIndex: 1, startMs: 1300, endMs: 1800, repetition: 2 }
		]);
		expect(plan.audioSegments).toEqual([
			{ startMs: 1200, endMs: 1600, repeatCount: 2 },
			{ startMs: 1700, endMs: 2200, repeatCount: 2 }
		]);
		expect(plan.totalDurationMs).toBe(1800);
	});

	it('keeps complete cross-verse visual merges when repeating each verse', () => {
		const plan = buildHifzRepetitionPlan(
			[
				{
					kind: 'subtitle',
					originalStartMs: 0,
					originalEndMs: 1000,
					surah: 2,
					verseNumber: 1,
					startWordIndex: 0,
					isFullVerse: true,
					isLastWordsOfVerse: true,
					visualMergeGroupId: 'merge-a',
					visualMergeMode: 'both'
				},
				{
					kind: 'subtitle',
					originalStartMs: 1000,
					originalEndMs: 2000,
					surah: 2,
					verseNumber: 2,
					startWordIndex: 0,
					isFullVerse: true,
					isLastWordsOfVerse: true,
					visualMergeGroupId: 'merge-a',
					visualMergeMode: 'both'
				},
				{
					kind: 'subtitle',
					originalStartMs: 2000,
					originalEndMs: 2500,
					surah: 2,
					verseNumber: 3,
					startWordIndex: 0,
					isFullVerse: true,
					isLastWordsOfVerse: true
				}
			],
			2,
			'verse',
			true
		);

		expect(plan.audioSegments).toEqual([
			{ startMs: 0, endMs: 2000, repeatCount: 2 },
			{ startMs: 2000, endMs: 2500, repeatCount: 2 }
		]);
		expect(plan.placements).toEqual([
			{
				sourceIndex: 0,
				startMs: 0,
				endMs: 1000,
				repetition: 1,
				visualMergeGroupId: 'hifz-merge-a-1-0',
				visualMergeMode: 'both'
			},
			{
				sourceIndex: 1,
				startMs: 1000,
				endMs: 2000,
				repetition: 1,
				visualMergeGroupId: 'hifz-merge-a-1-0',
				visualMergeMode: 'both'
			},
			{
				sourceIndex: 0,
				startMs: 2000,
				endMs: 3000,
				repetition: 2,
				visualMergeGroupId: 'hifz-merge-a-2-2000',
				visualMergeMode: 'both'
			},
			{
				sourceIndex: 1,
				startMs: 3000,
				endMs: 4000,
				repetition: 2,
				visualMergeGroupId: 'hifz-merge-a-2-2000',
				visualMergeMode: 'both'
			},
			{ sourceIndex: 2, startMs: 4000, endMs: 4500, repetition: 1 },
			{ sourceIndex: 2, startMs: 4500, endMs: 5000, repetition: 2 }
		]);
	});

	it('ignores partial cross-verse visual merges when repeating each verse', () => {
		const plan = buildHifzRepetitionPlan(
			[
				{
					kind: 'subtitle',
					originalStartMs: 0,
					originalEndMs: 1000,
					surah: 2,
					verseNumber: 1,
					startWordIndex: 0,
					isFullVerse: true,
					isLastWordsOfVerse: true,
					visualMergeGroupId: 'merge-a',
					visualMergeMode: 'both'
				},
				{
					kind: 'subtitle',
					originalStartMs: 1000,
					originalEndMs: 1500,
					surah: 2,
					verseNumber: 2,
					startWordIndex: 0,
					isFullVerse: false,
					isLastWordsOfVerse: false,
					visualMergeGroupId: 'merge-a',
					visualMergeMode: 'both'
				},
				{
					kind: 'subtitle',
					originalStartMs: 1500,
					originalEndMs: 2500,
					surah: 2,
					verseNumber: 3,
					startWordIndex: 0,
					isFullVerse: true,
					isLastWordsOfVerse: true,
					visualMergeGroupId: 'merge-a',
					visualMergeMode: 'both'
				}
			],
			2,
			'verse',
			true
		);

		expect(plan.audioSegments).toEqual([
			{ startMs: 0, endMs: 1000, repeatCount: 2 },
			{ startMs: 1000, endMs: 1500, repeatCount: 2 },
			{ startMs: 1500, endMs: 2500, repeatCount: 2 }
		]);
		expect(plan.placements).toEqual([
			{ sourceIndex: 0, startMs: 0, endMs: 1000, repetition: 1 },
			{ sourceIndex: 0, startMs: 1000, endMs: 2000, repetition: 2 },
			{ sourceIndex: 1, startMs: 2000, endMs: 2500, repetition: 1 },
			{ sourceIndex: 1, startMs: 2500, endMs: 3000, repetition: 2 },
			{ sourceIndex: 2, startMs: 3000, endMs: 4000, repetition: 1 },
			{ sourceIndex: 2, startMs: 4000, endMs: 5000, repetition: 2 }
		]);
	});

	it('keeps visual merges when repeating each subtitle', () => {
		const plan = buildHifzRepetitionPlan(
			[
				{
					kind: 'subtitle',
					originalStartMs: 0,
					originalEndMs: 500,
					surah: 2,
					verseNumber: 1,
					visualMergeGroupId: 'merge-a',
					visualMergeMode: 'translation'
				},
				{
					kind: 'subtitle',
					originalStartMs: 500,
					originalEndMs: 1000,
					surah: 2,
					verseNumber: 2,
					visualMergeGroupId: 'merge-a',
					visualMergeMode: 'translation'
				}
			],
			2,
			'subtitle',
			true
		);

		expect(plan.audioSegments).toEqual([{ startMs: 0, endMs: 1000, repeatCount: 2 }]);
		expect(plan.placements.map((placement) => placement.visualMergeGroupId)).toEqual([
			'hifz-merge-a-1-0',
			'hifz-merge-a-1-0',
			'hifz-merge-a-2-1000',
			'hifz-merge-a-2-1000'
		]);
		expect(plan.placements.map((placement) => placement.visualMergeMode)).toEqual([
			'translation',
			'translation',
			'translation',
			'translation'
		]);
	});
});
