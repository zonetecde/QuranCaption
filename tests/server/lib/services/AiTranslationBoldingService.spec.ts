import { describe, expect, it } from 'vitest';

import {
	buildIndexedTranslationText,
	validateAiBoldBatchResult,
	type AiBoldBatch
} from '$lib/services/AiTranslationBoldingService';

describe('AiTranslationBoldingService', () => {
	it('builds indexed translation text from word tokens only', () => {
		expect(buildIndexedTranslationText('the Most Compassionate, Most Merciful.')).toBe(
			'0:the 1:Most 2:Compassionate, 3:Most 4:Merciful.'
		);
	});

	it('validates a correct AI bold response', () => {
		const batch = {
			batchId: 'batch-1',
			wordCount: 5,
			segments: [
				{
					subtitleId: 11,
					verseKey: '1:1',
					startTime: 0,
					endTime: 1000,
					segmentArabic: 'text',
					translationText: 'the Most Compassionate, Most Merciful.',
					translationIndexed: '0:the 1:Most 2:Compassionate, 3:Most 4:Merciful.',
					wordCount: 5,
					hasExistingBold: false,
					subtitle: {} as never
				}
			],
			request: {
				segments: []
			},
			estimatedInputTokens: 0,
			estimatedOutputTokens: 0,
			estimatedCostUsd: 0
		} satisfies AiBoldBatch;

		const result = validateAiBoldBatchResult(batch, {
			segments: [{ subtitleId: 11, boldWordIndexes: [2, 4] }]
		});

		expect(result.errors).toEqual([]);
		expect(result.validSegments).toEqual([
			{
				candidate: batch.segments[0],
				boldWordIndexes: [2, 4]
			}
		]);
	});

	it('rejects out-of-bounds indexes safely', () => {
		const batch = {
			batchId: 'batch-2',
			wordCount: 3,
			segments: [
				{
					subtitleId: 15,
					verseKey: '1:2',
					startTime: 0,
					endTime: 1000,
					segmentArabic: 'text',
					translationText: 'All praise is',
					translationIndexed: '0:All 1:praise 2:is',
					wordCount: 3,
					hasExistingBold: false,
					subtitle: {} as never
				}
			],
			request: {
				segments: []
			},
			estimatedInputTokens: 0,
			estimatedOutputTokens: 0,
			estimatedCostUsd: 0
		} satisfies AiBoldBatch;

		const result = validateAiBoldBatchResult(batch, {
			segments: [{ subtitleId: 15, boldWordIndexes: [0, 5] }]
		});

		expect(result.validSegments).toEqual([]);
		expect(result.errors).toContain(
			'Subtitle 15: boldWordIndexes contains out-of-bounds index 5.'
		);
	});

	it('deduplicates repeated indexes', () => {
		const batch = {
			batchId: 'batch-3',
			wordCount: 2,
			segments: [
				{
					subtitleId: 21,
					verseKey: '1:3',
					startTime: 0,
					endTime: 1000,
					segmentArabic: 'text',
					translationText: 'The Master',
					translationIndexed: '0:The 1:Master',
					wordCount: 2,
					hasExistingBold: false,
					subtitle: {} as never
				}
			],
			request: {
				segments: []
			},
			estimatedInputTokens: 0,
			estimatedOutputTokens: 0,
			estimatedCostUsd: 0
		} satisfies AiBoldBatch;

		const result = validateAiBoldBatchResult(batch, {
			segments: [{ subtitleId: 21, boldWordIndexes: [1, 1, 1] }]
		});

		expect(result.errors).toEqual([]);
		expect(result.validSegments[0].boldWordIndexes).toEqual([1]);
	});

	it('accepts large safe subtitle ids in validation', () => {
		const batch = {
			batchId: 'batch-4',
			wordCount: 3,
			segments: [
				{
					subtitleId: 1775994570183630,
					verseKey: '1:4',
					startTime: 0,
					endTime: 1000,
					segmentArabic: 'text',
					translationText: 'Master of Judgment',
					translationIndexed: '0:Master 1:of 2:Judgment',
					wordCount: 3,
					hasExistingBold: false,
					subtitle: {} as never
				}
			],
			request: {
				segments: []
			},
			estimatedInputTokens: 0,
			estimatedOutputTokens: 0,
			estimatedCostUsd: 0
		} satisfies AiBoldBatch;

		const result = validateAiBoldBatchResult(batch, {
			segments: [{ subtitleId: 1775994570183630, boldWordIndexes: [0, 2] }]
		});

		expect(result.errors).toEqual([]);
		expect(result.validSegments[0].candidate.subtitleId).toBe(1775994570183630);
		expect(result.validSegments[0].boldWordIndexes).toEqual([0, 2]);
	});
});
