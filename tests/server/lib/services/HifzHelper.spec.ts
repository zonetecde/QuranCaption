import { describe, expect, it } from 'vitest';

import { buildHifzRepetitionPlan } from '$lib/services/HifzHelper';

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

	it('adds silence between repetitions from the previous segment duration multiplier', () => {
		const plan = buildHifzRepetitionPlan(
			[
				{
					kind: 'subtitle',
					originalStartMs: 1200,
					originalEndMs: 1600,
					surah: 2,
					verseNumber: 1
				}
			],
			3,
			'subtitle',
			false,
			0.5,
			false
		);

		expect(plan.audioSegments).toEqual([
			{ startMs: 1200, endMs: 1600, repeatCount: 3, silenceBetweenRepetitionsMs: 200 }
		]);
		expect(plan.placements).toEqual([
			{ sourceIndex: 0, startMs: 0, endMs: 400, repetition: 1 },
			{ sourceIndex: 0, startMs: 600, endMs: 1000, repetition: 2 },
			{ sourceIndex: 0, startMs: 1200, endMs: 1600, repetition: 3 }
		]);
		expect(plan.silencePlacements).toEqual([
			{ startMs: 400, endMs: 600 },
			{ startMs: 1000, endMs: 1200 },
			{ startMs: 1600, endMs: 1800 }
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

	it('extends subtitle display over pause when requested', () => {
		const plan = buildHifzRepetitionPlan(
			[
				{
					kind: 'subtitle',
					originalStartMs: 1200,
					originalEndMs: 1600,
					surah: 2,
					verseNumber: 1
				}
			],
			3,
			'subtitle',
			false,
			0.5,
			true
		);

		expect(plan.silencePlacements).toEqual([]);
		expect(plan.placements).toEqual([
			{ sourceIndex: 0, startMs: 0, endMs: 600, repetition: 1 },
			{ sourceIndex: 0, startMs: 600, endMs: 1200, repetition: 2 },
			{ sourceIndex: 0, startMs: 1200, endMs: 1800, repetition: 3 }
		]);
		expect(plan.totalDurationMs).toBe(1800);
	});

	it('merges complete subtitle repetitions into one placement in subtitle mode', () => {
		const plan = buildHifzRepetitionPlan(
			[
				{
					kind: 'subtitle',
					originalStartMs: 0,
					originalEndMs: 1000,
					isMergeableCompleteUnit: true,
					surah: 2,
					verseNumber: 1
				}
			],
			3,
			'subtitle',
			false,
			0.5,
			true,
			true
		);

		expect(plan.placements).toEqual([{ sourceIndex: 0, startMs: 0, endMs: 4500, repetition: 1 }]);
		expect(plan.silencePlacements).toEqual([]);
		expect(plan.totalDurationMs).toBe(4500);
	});

	it('does not merge repetitions when subtitle is not complete', () => {
		const plan = buildHifzRepetitionPlan(
			[
				{
					kind: 'subtitle',
					originalStartMs: 0,
					originalEndMs: 500,
					isMergeableCompleteUnit: false,
					surah: 2,
					verseNumber: 1
				}
			],
			3,
			'subtitle',
			false,
			0.5,
			true,
			true
		);

		expect(plan.placements).toEqual([
			{ sourceIndex: 0, startMs: 0, endMs: 750, repetition: 1 },
			{ sourceIndex: 0, startMs: 750, endMs: 1500, repetition: 2 },
			{ sourceIndex: 0, startMs: 1500, endMs: 2250, repetition: 3 }
		]);
	});

	it('merges repetitions in verse mode only when verse block is a single complete subtitle', () => {
		const mergedPlan = buildHifzRepetitionPlan(
			[
				{
					kind: 'subtitle',
					originalStartMs: 0,
					originalEndMs: 1200,
					isMergeableCompleteUnit: true,
					surah: 2,
					verseNumber: 1
				}
			],
			2,
			'verse',
			false,
			0,
			true,
			true
		);
		expect(mergedPlan.placements).toEqual([
			{ sourceIndex: 0, startMs: 0, endMs: 2400, repetition: 1 }
		]);

		const splitPlan = buildHifzRepetitionPlan(
			[
				{
					kind: 'subtitle',
					originalStartMs: 0,
					originalEndMs: 500,
					isMergeableCompleteUnit: false,
					surah: 2,
					verseNumber: 1
				},
				{
					kind: 'subtitle',
					originalStartMs: 500,
					originalEndMs: 1000,
					isMergeableCompleteUnit: false,
					surah: 2,
					verseNumber: 1
				}
			],
			2,
			'verse',
			false,
			0,
			true,
			true
		);
		expect(splitPlan.placements).toEqual([
			{ sourceIndex: 0, startMs: 0, endMs: 500, repetition: 1 },
			{ sourceIndex: 1, startMs: 500, endMs: 1000, repetition: 1 },
			{ sourceIndex: 0, startMs: 1000, endMs: 1500, repetition: 2 },
			{ sourceIndex: 1, startMs: 1500, endMs: 2000, repetition: 2 }
		]);
	});

	it('never merges predefined subtitles across repetitions', () => {
		const plan = buildHifzRepetitionPlan(
			[
				{
					kind: 'predefined',
					originalStartMs: 0,
					originalEndMs: 700,
					isMergeableCompleteUnit: false
				}
			],
			3,
			'subtitle',
			false,
			0,
			true,
			true
		);

		expect(plan.placements).toEqual([{ sourceIndex: 0, startMs: 0, endMs: 700, repetition: 1 }]);
	});

	it('does not extend earlier merged subtitles when a later repeated group shows pauses', () => {
		const plan = buildHifzRepetitionPlan(
			[
				{
					kind: 'subtitle',
					originalStartMs: 0,
					originalEndMs: 1000,
					isMergeableCompleteUnit: true,
					surah: 1,
					verseNumber: 1
				},
				{
					kind: 'subtitle',
					originalStartMs: 1000,
					originalEndMs: 1400,
					isMergeableCompleteUnit: false,
					surah: 1,
					verseNumber: 7
				},
				{
					kind: 'subtitle',
					originalStartMs: 1400,
					originalEndMs: 1800,
					isMergeableCompleteUnit: false,
					surah: 1,
					verseNumber: 7
				}
			],
			3,
			'verse',
			false,
			0.5,
			true,
			true
		);

		expect(plan.placements).toEqual([
			{ sourceIndex: 0, startMs: 0, endMs: 4500, repetition: 1 },
			{ sourceIndex: 1, startMs: 4500, endMs: 5700, repetition: 1 },
			{ sourceIndex: 2, startMs: 4900, endMs: 5700, repetition: 1 },
			{ sourceIndex: 1, startMs: 5700, endMs: 6900, repetition: 2 },
			{ sourceIndex: 2, startMs: 6100, endMs: 6900, repetition: 2 },
			{ sourceIndex: 1, startMs: 6900, endMs: 8100, repetition: 3 },
			{ sourceIndex: 2, startMs: 7300, endMs: 8100, repetition: 3 }
		]);
	});
});
