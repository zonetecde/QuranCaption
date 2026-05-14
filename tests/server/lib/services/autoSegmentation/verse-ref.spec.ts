import { describe, expect, it } from 'vitest';

import { compareVerseRefs, parseVerseRef } from '$lib/services/AutoSegmentation';

// ---------------------------------------------------------------------------
// parseVerseRef
// ---------------------------------------------------------------------------
describe('parseVerseRef', () => {
	it('parses a valid "surah:verse:word" reference', () => {
		expect(parseVerseRef('1:1:1')).toEqual({ surah: 1, verse: 1, word: 1 });
		expect(parseVerseRef('114:6:3')).toEqual({ surah: 114, verse: 6, word: 3 });
	});

	it('returns null for an undefined reference', () => {
		expect(parseVerseRef(undefined)).toBeNull();
	});

	it('returns null for an empty string', () => {
		expect(parseVerseRef('')).toBeNull();
	});

	it('returns null for an invalid format', () => {
		expect(parseVerseRef('abc')).toBeNull();
		expect(parseVerseRef('1:1')).toBeNull();
		expect(parseVerseRef('1:1:1:1')).toBeNull();
	});

	it('returns null for non-numeric parts', () => {
		expect(parseVerseRef('a:b:c')).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// compareVerseRefs
// ---------------------------------------------------------------------------
describe('compareVerseRefs', () => {
	it('returns 0 for equal references', () => {
		expect(compareVerseRefs({ surah: 1, verse: 1, word: 1 }, { surah: 1, verse: 1, word: 1 })).toBe(
			0
		);
	});

	it('returns negative when surah is smaller', () => {
		expect(
			compareVerseRefs({ surah: 1, verse: 1, word: 1 }, { surah: 2, verse: 1, word: 1 })
		).toBeLessThan(0);
	});

	it('returns positive when surah is larger', () => {
		expect(
			compareVerseRefs({ surah: 3, verse: 1, word: 1 }, { surah: 2, verse: 1, word: 1 })
		).toBeGreaterThan(0);
	});

	it('compares by verse when surah is equal', () => {
		expect(
			compareVerseRefs({ surah: 2, verse: 1, word: 1 }, { surah: 2, verse: 3, word: 1 })
		).toBeLessThan(0);
	});

	it('compares by word when surah and verse are equal', () => {
		expect(
			compareVerseRefs({ surah: 2, verse: 3, word: 1 }, { surah: 2, verse: 3, word: 5 })
		).toBeLessThan(0);
	});
});
