import { describe, expect, it } from 'vitest';

import {
	asBoolean,
	asFiniteNumber,
	asNonEmptyString,
	normalizeImportedSegment,
	normalizeMfaSegments,
	normalizeSegmentWords,
	normalizeWordTimestamps,
	parseSegmentationResponseFromThrownError,
	type SegmentationSegment
} from '$lib/services/AutoSegmentation';

// ---------------------------------------------------------------------------
// asNonEmptyString
// ---------------------------------------------------------------------------
describe('asNonEmptyString', () => {
	it('returns the trimmed string for a valid input', () => {
		expect(asNonEmptyString('  hello  ')).toBe('hello');
	});

	it('returns undefined for an empty string', () => {
		expect(asNonEmptyString('')).toBeUndefined();
	});

	it('returns undefined for whitespace-only strings', () => {
		expect(asNonEmptyString('   ')).toBeUndefined();
	});

	it('returns undefined for non-string values', () => {
		expect(asNonEmptyString(42)).toBeUndefined();
		expect(asNonEmptyString(null)).toBeUndefined();
		expect(asNonEmptyString(undefined)).toBeUndefined();
		expect(asNonEmptyString({})).toBeUndefined();
		expect(asNonEmptyString(true)).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// asFiniteNumber
// ---------------------------------------------------------------------------
describe('asFiniteNumber', () => {
	it('returns the number for a finite numeric value', () => {
		expect(asFiniteNumber(42)).toBe(42);
		expect(asFiniteNumber(3.14)).toBe(3.14);
		expect(asFiniteNumber(0)).toBe(0);
		expect(asFiniteNumber(-1)).toBe(-1);
	});

	it('parses valid numeric strings', () => {
		expect(asFiniteNumber('42')).toBe(42);
		expect(asFiniteNumber('3.14')).toBe(3.14);
	});

	it('returns undefined for non-finite numbers', () => {
		expect(asFiniteNumber(Number.NaN)).toBeUndefined();
		expect(asFiniteNumber(Number.POSITIVE_INFINITY)).toBeUndefined();
	});

	it('returns undefined for invalid strings', () => {
		expect(asFiniteNumber('abc')).toBeUndefined();
	});

	it('parses empty string as 0 (JavaScript coercion)', () => {
		expect(asFiniteNumber('')).toBe(0);
	});

	it('returns undefined for non-numeric types', () => {
		expect(asFiniteNumber(null)).toBeUndefined();
		expect(asFiniteNumber(undefined)).toBeUndefined();
		expect(asFiniteNumber(true)).toBeUndefined();
		expect(asFiniteNumber({})).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// asBoolean
// ---------------------------------------------------------------------------
describe('asBoolean', () => {
	it('returns true for true', () => {
		expect(asBoolean(true)).toBe(true);
	});

	it('returns false for false', () => {
		expect(asBoolean(false)).toBe(false);
	});

	it('returns undefined for non-boolean values', () => {
		expect(asBoolean(1)).toBeUndefined();
		expect(asBoolean('true')).toBeUndefined();
		expect(asBoolean(null)).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// normalizeWordTimestamps
// ---------------------------------------------------------------------------
describe('normalizeWordTimestamps', () => {
	it('returns an empty array for non-array input', () => {
		expect(normalizeWordTimestamps(null)).toEqual([]);
		expect(normalizeWordTimestamps('abc')).toEqual([]);
	});

	it('normalizes valid word timestamp entries', () => {
		const input = [{ key: '1:1:1', start: 0.1, end: 0.3, type: 'word' }];
		expect(normalizeWordTimestamps(input)).toEqual([
			{ key: '1:1:1', start: 0.1, end: 0.3, type: 'word' }
		]);
	});

	it('filters out entries with missing fields', () => {
		const input = [
			{ key: '1:1:1', start: 0.1, end: 0.3, type: 'word' },
			{ key: '1:1:2', start: 0.3, end: undefined, type: '' },
			{}
		];
		expect(normalizeWordTimestamps(input)).toEqual([
			{ key: '1:1:1', start: 0.1, end: 0.3, type: 'word' }
		]);
	});
});

// ---------------------------------------------------------------------------
// normalizeSegmentWords
// ---------------------------------------------------------------------------
describe('normalizeSegmentWords', () => {
	it('returns an empty array for non-array input', () => {
		expect(normalizeSegmentWords(null)).toEqual([]);
		expect(normalizeSegmentWords(undefined)).toEqual([]);
	});

	it('normalizes array-of-array entries (legacy format)', () => {
		const input = [['1:1:1', 0, 0.5]];
		expect(normalizeSegmentWords(input)).toEqual([
			{ location: '1:1:1', start: 0, end: 0.5 }
		]);
	});

	it('normalizes object entries', () => {
		const input = [{ location: '1:1:2', start: 0.5, end: 1.1, word: 'test' }];
		expect(normalizeSegmentWords(input)).toEqual([
			{ location: '1:1:2', start: 0.5, end: 1.1, word: 'test' }
		]);
	});

	it('normalizes object entries without word field', () => {
		const input = [{ location: '1:1:3', start: 1.1, end: 1.5 }];
		expect(normalizeSegmentWords(input)).toEqual([
			{ location: '1:1:3', start: 1.1, end: 1.5 }
		]);
	});

	it('filters out invalid entries', () => {
		const input = [['1:1:1', 0, 0.5], { start: 0.5 }, null, []];
		expect(normalizeSegmentWords(input)).toEqual([
			{ location: '1:1:1', start: 0, end: 0.5 }
		]);
	});

	it('falls back to "key" field when "location" is missing', () => {
		const input = [{ key: '1:1:4', start: 1.5, end: 2.0 }];
		expect(normalizeSegmentWords(input)).toEqual([
			{ location: '1:1:4', start: 1.5, end: 2.0 }
		]);
	});
});

// ---------------------------------------------------------------------------
// normalizeMfaSegments
// ---------------------------------------------------------------------------
describe('normalizeMfaSegments', () => {
	const fallback: SegmentationSegment[] = [
		{
			segment: 0,
			time_from: 0,
			time_to: 2,
			ref_from: '1:1:1',
			ref_to: '1:1:4',
			confidence: 0.9
		}
	];

	it('returns an empty array for non-array input', () => {
		expect(normalizeMfaSegments(null, fallback)).toEqual([]);
	});

	it('fills missing fields from fallback segments', () => {
		const mfaInput = [
			{ time_from: 0.5, time_to: 1.8, words: [{ location: '1:1:1', start: 0, end: 0.3 }] }
		];
		const result = normalizeMfaSegments(mfaInput, fallback);
		expect(result).toHaveLength(1);
		expect(result[0].segment).toBe(0);
		expect(result[0].ref_from).toBe('1:1:1');
		expect(result[0].confidence).toBe(0.9);
		expect(result[0].words).toEqual([{ location: '1:1:1', start: 0, end: 0.3 }]);
	});

	it('uses segment field from MFA when available', () => {
		const mfaInput = [{ segment: 5, time_from: 0.5, time_to: 1.8 }];
		const result = normalizeMfaSegments(mfaInput, fallback);
		expect(result[0].segment).toBe(5);
	});
});

// ---------------------------------------------------------------------------
// normalizeImportedSegment
// ---------------------------------------------------------------------------
describe('normalizeImportedSegment', () => {
	it('normalizes a valid segment', () => {
		const result = normalizeImportedSegment(
			{ segment: 1, time_from: 0.5, time_to: 1.2, ref_from: '112:1:1', ref_to: '112:1:4', error: null },
			0
		);
		expect(result.segment).toBe(1);
		expect(result.time_from).toBe(0.5);
		expect(result.time_to).toBe(1.2);
		expect(result.ref_from).toBe('112:1:1');
	});

	it('ensures time_to >= time_from', () => {
		const result = normalizeImportedSegment({ time_from: 2, time_to: 1 }, 0);
		expect(result.time_to).toBeGreaterThanOrEqual(result.time_from!);
	});

	it('clamps negative time_from to 0', () => {
		const result = normalizeImportedSegment({ time_from: -5, time_to: 3 }, 0);
		expect(result.time_from).toBe(0);
	});

	it('throws for non-object input', () => {
		expect(() => normalizeImportedSegment(null, 0)).toThrow(
			'Invalid segment at index 0: expected an object.'
		);
	});

	it('throws when time_from or time_to is missing', () => {
		expect(() => normalizeImportedSegment({ segment: 1, time_from: 1.2 }, 1)).toThrow(
			"Invalid segment at index 1: 'time_from' and 'time_to' are required."
		);
	});
});

// ---------------------------------------------------------------------------
// parseSegmentationResponseFromThrownError
// ---------------------------------------------------------------------------
describe('parseSegmentationResponseFromThrownError', () => {
	it('extracts a JSON response embedded in an error message', () => {
		const error = new Error(
			'Something failed. {"segments":[{"segment":1,"time_from":0,"time_to":2,"error":null}]}'
		);
		const result = parseSegmentationResponseFromThrownError(error);
		expect(result).not.toBeNull();
		expect(result!.segments).toHaveLength(1);
	});

	it('returns null when no JSON is found in the error', () => {
		const error = new Error('Just a plain error message');
		expect(parseSegmentationResponseFromThrownError(error)).toBeNull();
	});

	it('returns null for a non-Error input without JSON', () => {
		expect(parseSegmentationResponseFromThrownError('no json here')).toBeNull();
	});
});
