import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import WarshProvider from '$lib/services/WarshProvider';

describe('WarshProvider', () => {
	beforeAll(async () => {
		vi.stubGlobal('fetch', async (input: string | URL | Request) => {
			const url = String(input);
			const fileName = url.endsWith('ayah-map.json') ? 'ayah-map.json' : 'verses.json';
			return new Response(await readFile(`static/warsh/${fileName}`), { status: 200 });
		});
		await WarshProvider.prefetch();
	});

	afterAll(() => vi.unstubAllGlobals());

	it('loads a regular one-to-one ayah from the actual Warsh text', () => {
		const slice = WarshProvider.getVerseSlice(57, 10, 0, 36, true);

		expect(slice?.targetAyahs).toEqual([10]);
		expect(slice?.relation).toBe('mapped');
		expect(slice?.text).toContain('وَكُلّاٗ وَعَدَ اَ۬للَّهُ اُ۬لْحُسْن۪ىٰ');
		expect(slice?.suffix).toBe(' ١٠');
	});

	it('uses the mapped Warsh number when Hafs and Warsh numbering differ', () => {
		const slice = WarshProvider.getVerseSlice(57, 15, 0, 14, true);

		expect(slice?.targetAyahs).toEqual([14]);
		expect(slice?.suffix).toBe(' ١٤');
	});

	it('preserves merged and split Warsh ayah boundaries', () => {
		const firstMergedPart = WarshProvider.getVerseSlice(2, 1, 0, 0, true);
		const lastMergedPart = WarshProvider.getVerseSlice(2, 2, 0, 6, true);
		const split = WarshProvider.getVerseSlice(2, 255, 0, 49, true);

		expect(firstMergedPart?.targetAyahs).toEqual([1]);
		expect(firstMergedPart?.relation).toBe('merged');
		expect(firstMergedPart?.text).toBe('أَلَٓمِّٓۖ');
		expect(firstMergedPart?.suffix).toBe('');
		expect(lastMergedPart?.targetAyahs).toEqual([1]);
		expect(lastMergedPart?.relation).toBe('merged');
		expect(lastMergedPart?.text).toBe(
			'ذَٰلِكَ اَ۬لْكِتَٰبُ لَا رَيْبَۖ فِيهِ هُدىٗ لِّلْمُتَّقِينَ'
		);
		expect(lastMergedPart?.suffix).toBe(' ١');
		expect(split?.targetAyahs).toEqual([253, 254]);
		expect(split?.relation).toBe('split');
		expect(split?.words).toHaveLength(50);
		expect(split?.words[0]).toBe('اَ۬للَّهُ');
		expect(split?.text).toContain('اُ۬لْقَيُّومُۖ ٢٥٣ لَا');
		expect(split?.words.at(-1)).toBe('اُ۬لْعَظِيمُۖ');
		expect(split?.suffix).toBe(' ٢٥٤');
		expect(WarshProvider.getTranslationVerseNumber(2, 255, 'before')).toBe('253-254');
		expect(WarshProvider.getTranslationVerseNumber(2, 256, 'before')).toBe('255');
	});

	it('preserves all seven Fatiha clips with Warsh boundaries and an unnumbered basmala', () => {
		const slices = [
			WarshProvider.getVerseSlice(1, 1, 0, 3, true),
			WarshProvider.getVerseSlice(1, 2, 0, 3, true),
			WarshProvider.getVerseSlice(1, 3, 0, 1, true),
			WarshProvider.getVerseSlice(1, 4, 0, 2, true),
			WarshProvider.getVerseSlice(1, 5, 0, 3, true),
			WarshProvider.getVerseSlice(1, 6, 0, 2, true),
			WarshProvider.getVerseSlice(1, 7, 0, 8, true)
		];

		expect(slices.map((slice) => slice?.targetAyahs)).toEqual([
			[],
			[1],
			[2],
			[3],
			[4],
			[5],
			[6, 7]
		]);
		expect(slices.map((slice) => slice?.suffix)).toEqual(['', ' ١', ' ٢', ' ٣', ' ٤', ' ٥', ' ٧']);
		expect(slices[0]?.text).toBe('بِسْمِ اِ۬للَّهِ اِ۬لرَّحْمَٰنِ اِ۬لرَّحِيمِ');
		expect(slices[6]?.text).toContain('عَلَيْهِمْ ٦ غَيْرِ');
		expect(slices.every((slice) => slice && slice.words.length > 0)).toBe(true);
		expect(slices.flatMap((slice) => slice?.words ?? [])).toHaveLength(29);
	});

	it('maps real reading and word-count differences without positional pairing', () => {
		const omittedWordReading = WarshProvider.getVerseSlice(57, 24, 0, 11, true);
		const splitWordReading = WarshProvider.getVerseSlice(2, 181, 0, 12, false);

		expect(omittedWordReading?.targetAyahs).toEqual([23]);
		expect(omittedWordReading?.suffix).toBe(' ٢٣');
		expect(omittedWordReading?.text).not.toContain('هُوَ');
		expect(omittedWordReading?.text).toContain('فَإِنَّ اَ۬للَّهَ اَ۬لْغَنِيُّ اُ۬لْحَمِيدُۖ');
		expect(omittedWordReading?.words).toHaveLength(11);
		expect(omittedWordReading?.sourceWordIndexes.slice(0, 9)).toEqual(
			Array.from({ length: 9 }, (_, index) => [index])
		);
		expect(omittedWordReading?.sourceWordIndexes[9]).toEqual([9, 10]);
		expect(omittedWordReading?.sourceWordIndexes[10]).toEqual([11]);
		expect(splitWordReading?.words).toHaveLength(14);
		expect(splitWordReading?.sourceWordIndexes[2]).toEqual([2]);
		expect(splitWordReading?.sourceWordIndexes[3]).toEqual([2]);
	});

	it('deduplicates and renumbers translation verse numbers across merged Hafs ayahs', () => {
		expect(WarshProvider.getTranslationVerseNumber(2, 1, 'before')).toBe('1');
		expect(WarshProvider.getTranslationVerseNumber(2, 2, 'before')).toBeNull();
		expect(WarshProvider.getTranslationVerseNumber(2, 1, 'after')).toBeNull();
		expect(WarshProvider.getTranslationVerseNumber(2, 2, 'after')).toBe('1');
		expect(WarshProvider.getTranslationVerseNumber(2, 3, 'before')).toBe('2');
		expect(WarshProvider.getTranslationVerseNumber(57, 24, 'before')).toBe('23');
		expect(WarshProvider.getTranslationVerseNumber(2, 255, 'before')).toBe('253-254');
		expect(WarshProvider.getTranslationVerseNumber(2, 255, 'after')).toBe('253-254');
		expect(WarshProvider.getTranslationVerseNumber(2, 256, 'before')).toBe('255');
	});
});
