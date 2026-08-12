import { describe, expect, it } from 'vitest';

import {
	buildAiSubtitleSplitBatches,
	validateAiSubtitleSplitBatchResult,
	type AiSubtitleSplitBatch,
	type AiSubtitleSplitCandidate
} from '$lib/services/AiSubtitleSplittingService';

const candidate = {
	segmentIndex: 42,
	verseKey: '2:255',
	startTime: 0,
	endTime: 5000,
	wordCount: 14,
	maxWords: 5,
	words: Array.from({ length: 14 }, (_, index) => ({ index, arabic: `word-${index}` })),
	subtitle: {
		startWordIndex: 0,
		endWordIndex: 13
	} as AiSubtitleSplitCandidate['subtitle']
} satisfies AiSubtitleSplitCandidate;

const batch = {
	batchId: 'batch-1',
	wordCount: 14,
	resultingChunkCount: 3,
	segments: [candidate],
	request: {
		s: [
			{
				i: candidate.segmentIndex,
				v: candidate.verseKey,
				m: candidate.maxWords,
				w: candidate.words.map((word) => `${word.index}:${word.arabic}`).join(' ')
			}
		]
	}
} satisfies AiSubtitleSplitBatch;

describe('AiSubtitleSplittingService', () => {
	it('uses one-letter keys in the AI input payload', () => {
		expect(buildAiSubtitleSplitBatches([candidate])[0].request).toEqual({
			s: [
				{
					i: 42,
					v: '2:255',
					m: 5,
					w: Array.from({ length: 14 }, (_, i) => `${i}:word-${i}`).join(' ')
				}
			]
		});
	});

	it('accepts three chunks for fourteen words with a five-word limit', () => {
		const result = validateAiSubtitleSplitBatchResult(batch, {
			s: [{ i: 42, e: [4, 9, 13] }]
		});

		expect(result.errors).toEqual([]);
		expect(result.validSegments).toEqual([
			{
				candidate,
				chunkEndWordIndexes: [4, 9, 13]
			}
		]);
	});

	it('rejects a response with too few chunks', () => {
		const result = validateAiSubtitleSplitBatchResult(batch, {
			s: [{ i: 42, e: [4, 13] }]
		});

		expect(result.validSegments).toEqual([]);
		expect(result.errors).toContain('Segment 42: expected 3 chunk end indexes, received 2.');
	});

	it('rejects a boundary that exceeds the word limit', () => {
		const result = validateAiSubtitleSplitBatchResult(batch, {
			s: [{ i: 42, e: [5, 9, 13] }]
		});

		expect(result.validSegments).toEqual([]);
		expect(result.errors).toContain('Segment 42: invalid chunk boundary 5.');
	});

	it('requires the final chunk to cover the subtitle end', () => {
		const result = validateAiSubtitleSplitBatchResult(batch, {
			s: [{ i: 42, e: [3, 8, 12] }]
		});

		expect(result.validSegments).toEqual([]);
		expect(result.errors).toContain('Segment 42: the final chunk must end at word 13.');
	});
});
