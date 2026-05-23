import { describe, expect, it } from 'vitest';

import {
	buildStoredAlignedSegment,
	buildSubtitleAlignmentMetadata,
	createEmptySegmentationContext,
	filterWordsForVerse,
	getSegmentWords,
	type SegmentationSegment,
	type SegmentationWordTimestamp
} from '$lib/services/AutoSegmentation';

// ---------------------------------------------------------------------------
// createEmptySegmentationContext
// ---------------------------------------------------------------------------
describe('createEmptySegmentationContext', () => {
	it('returns a context with all fields null/empty', () => {
		const ctx = createEmptySegmentationContext();
		expect(ctx.audioId).toBeNull();
		expect(ctx.source).toBeNull();
		expect(ctx.effectiveMode).toBeNull();
		expect(ctx.modelName).toBeNull();
		expect(ctx.device).toBeNull();
		expect(ctx.includeWbwTimestamps).toBe(false);
		expect(ctx.alignedSegments).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// filterWordsForVerse
// ---------------------------------------------------------------------------
describe('filterWordsForVerse', () => {
	const words: SegmentationWordTimestamp[] = [
		{ location: '1:1:1', start: 0, end: 0.3 },
		{ location: '1:1:2', start: 0.3, end: 0.6 },
		{ location: '1:2:1', start: 0.6, end: 0.9 }
	];

	it('keeps only words belonging to the given surah:verse', () => {
		expect(filterWordsForVerse(words, 1, 1)).toEqual([
			{ location: '1:1:1', start: 0, end: 0.3 },
			{ location: '1:1:2', start: 0.3, end: 0.6 }
		]);
	});

	it('returns empty array when no match', () => {
		expect(filterWordsForVerse(words, 99, 1)).toEqual([]);
	});

	it('returns empty for empty input', () => {
		expect(filterWordsForVerse([], 1, 1)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// getSegmentWords
// ---------------------------------------------------------------------------
describe('getSegmentWords', () => {
	it('maps segment words to normalized format', () => {
		const segment: SegmentationSegment = {
			segment: 1,
			words: [
				{ location: '1:1:1', start: 0, end: 0.5, word: 'test' },
				{ location: '1:1:2', start: 0.5, end: 1.0 }
			]
		};
		expect(getSegmentWords(segment)).toEqual([
			{ location: '1:1:1', start: 0, end: 0.5, word: 'test' },
			{ location: '1:1:2', start: 0.5, end: 1.0, word: undefined }
		]);
	});

	it('returns empty array when no words', () => {
		expect(getSegmentWords({})).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// buildSubtitleAlignmentMetadata
// ---------------------------------------------------------------------------
describe('buildSubtitleAlignmentMetadata', () => {
	const segment: SegmentationSegment = {
		segment: 1,
		time_from: 1.5,
		time_to: 3.0,
		ref_from: '112:1:1',
		ref_to: '112:1:4',
		matched_text: 'test',
		special_type: undefined
	};

	const words: SegmentationWordTimestamp[] = [{ location: '112:1:1', start: 0, end: 0.3 }];

	it('builds metadata from a valid segment', () => {
		const meta = buildSubtitleAlignmentMetadata('api', segment, words);
		expect(meta).not.toBeNull();
		expect(meta!.source).toBe('api');
		expect(meta!.segment).toBe(1);
		expect(meta!.refFrom).toBe('112:1:1');
		expect(meta!.refTo).toBe('112:1:4');
		expect(meta!.words).toEqual(words);
	});

	it('returns null when segment index is missing', () => {
		const meta = buildSubtitleAlignmentMetadata('local', {}, words);
		expect(meta).toBeNull();
	});

	it('returns null when refFrom is empty', () => {
		const meta = buildSubtitleAlignmentMetadata('local', { segment: 1, time_from: 0, time_to: 1, ref_from: '', ref_to: '' }, words);
		expect(meta).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// buildStoredAlignedSegment
// ---------------------------------------------------------------------------
describe('buildStoredAlignedSegment', () => {
	const segment: SegmentationSegment = {
		segment: 2,
		ref_from: '112:1:1',
		ref_to: '112:1:4',
		matched_text: 'test',
		special_type: 'Basmala'
	};

	const words: SegmentationWordTimestamp[] = [{ location: '112:1:1', start: 0, end: 0.3 }];

	it('builds a stored segment from valid input', () => {
		const stored = buildStoredAlignedSegment(10, 'Subtitle', 500, 2000, segment, words);
		expect(stored).not.toBeNull();
		expect(stored!.clipId).toBe(10);
		expect(stored!.type).toBe('Subtitle');
		expect(stored!.startMs).toBe(500);
		expect(stored!.endMs).toBe(2000);
		expect(stored!.segment).toBe(2);
		expect(stored!.specialType).toBe('Basmala');
	});

	it('returns null when segment index is missing', () => {
		expect(buildStoredAlignedSegment(1, 'Subtitle', 0, 100, {}, words)).toBeNull();
	});
});
