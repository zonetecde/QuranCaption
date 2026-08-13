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
		const firstMergedPart = WarshProvider.getVerseSlice(57, 13, 0, 26, true);
		const lastMergedPart = WarshProvider.getVerseSlice(57, 14, 0, 19, true);
		const split = WarshProvider.getVerseSlice(2, 255, 0, 49, true);

		expect(firstMergedPart?.relation).toBe('merged');
		expect(firstMergedPart?.suffix).toBe('');
		expect(lastMergedPart?.suffix).toBe(' ١٣');
		expect(split?.targetAyahs).toEqual([253, 254]);
		expect(split?.text).toContain('اُ۬لْقَيُّومُۖ ٢٥٣ لَا');
		expect(split?.suffix).toBe(' ٢٥٤');
	});

	it('handles the unnumbered Fatiha basmala and its split final Hafs ayah', () => {
		const basmala = WarshProvider.getVerseSlice(1, 1, 0, 3, true);
		const finalAyah = WarshProvider.getVerseSlice(1, 7, 0, 8, true);

		expect(basmala?.targetAyahs).toEqual([]);
		expect(basmala?.text).toBe('بِسْمِ اِ۬للَّهِ اِ۬لرَّحْمَٰنِ اِ۬لرَّحِيمِ');
		expect(basmala?.suffix).toBe('');
		expect(finalAyah?.text).toContain('عَلَيْهِمْ ٦ غَيْرِ');
		expect(finalAyah?.suffix).toBe(' ٧');
	});

	it('maps real reading and word-count differences without positional pairing', () => {
		const omittedWordReading = WarshProvider.getVerseSlice(57, 24, 0, 11, false);
		const splitWordReading = WarshProvider.getVerseSlice(2, 181, 0, 12, false);

		expect(omittedWordReading?.text).not.toContain('هُوَ');
		expect(omittedWordReading?.words).toHaveLength(11);
		expect(omittedWordReading?.sourceWordIndexes[9]).toEqual([9, 10]);
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
