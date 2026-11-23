import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import RiwayahProvider, {
	RIWAYAH_OPTIONS,
	type NonHafsRiwayah
} from '$lib/services/RiwayahProvider';
import { normalizeRiwayahSegmentationResponse } from '$lib/services/autoSegmentation/riwayah';
import type { SegmentationResponse } from '$lib/services/autoSegmentation/types';

const riwayat = RIWAYAH_OPTIONS.filter((riwayah): riwayah is NonHafsRiwayah => riwayah !== 'Hafs');
const warsh = {
	getVerseSlice: RiwayahProvider.getVerseSlice.bind(RiwayahProvider, 'Warsh'),
	getTranslationVerseNumber: RiwayahProvider.getTranslationVerseNumber.bind(
		RiwayahProvider,
		'Warsh'
	)
};

describe('RiwayahProvider', () => {
	beforeAll(async () => {
		vi.stubGlobal('fetch', async (input: string | URL | Request) => {
			const url = String(input);
			const slug = url.split('/')[2];
			const fileName = url.endsWith('ayah-map.json') ? 'ayah-map.json' : 'verses.json';
			return new Response(await readFile(`static/riwayat/${slug}/${fileName}`), { status: 200 });
		});
		await Promise.all(riwayat.map((riwayah) => RiwayahProvider.prefetch(riwayah)));
	});

	afterAll(() => vi.unstubAllGlobals());

	it('maps merged and split Warsh verses back to internal Hafs word references', () => {
		expect(RiwayahProvider.getHafsWordMapping('Warsh', 55, 1, 2)?.locations).toEqual(['55:2:1']);
		expect(RiwayahProvider.getHafsWordMapping('Warsh', 55, 2, 3)?.locations).toEqual(['55:4:1']);
		expect(RiwayahProvider.getHafsWordMapping('Warsh', 2, 254, 1)?.locations).toEqual(['2:255:8']);
		expect(RiwayahProvider.getHafsWordMapping('Warsh', 1, 7, 1)?.locations).toEqual(['1:7:5']);
		expect(RiwayahProvider.getHafsWordMapping('Warsh', 1, 0, 1)?.locations).toEqual(['1:1:1']);
	});

	it('corrects the second Ar-Rahman segment without changing its timings or source payload', async () => {
		const response: SegmentationResponse = {
			audio_id: 'cropped-audio',
			segments: [
				{
					segment: 2,
					time_from: 5.08,
					time_to: 10.38,
					ref_from: '55:1:2',
					ref_to: '55:1:3',
					matched_text: 'عَلَّمَ اَ۬لْقُرْءَانَۖ',
					words: [
						{ location: '55:1:2', start: 0.14, end: 0.97 },
						{ location: '55:1:3', start: 0.97, end: 5.07 }
					]
				}
			]
		};
		const original = structuredClone(response);
		const result = await normalizeRiwayahSegmentationResponse(response, 'warsh');
		expect(result.segments?.[0]).toMatchObject({
			segment: 2,
			time_from: 5.08,
			time_to: 10.38,
			ref_from: '55:2:1',
			ref_to: '55:2:2',
			matched_text: response.segments![0].matched_text,
			words: [
				{ location: '55:2:1', start: 0.14, end: 0.97, word: 'عَلَّمَ' },
				{ location: '55:2:2', start: 0.97, end: 5.07, word: 'اَ۬لْقُرْءَانَۖ' }
			]
		});
		expect(response).toEqual(original);
	});

	it('maps words across both Hafs verses covered by a Warsh segment', async () => {
		const result = await normalizeRiwayahSegmentationResponse(
			{
				segments: [
					{
						ref_from: '55:2:1',
						ref_to: '55:2:4',
						time_from: 10.98,
						time_to: 17.3,
						words: [1, 2, 3, 4].map((word) => ({
							location: `55:2:${word}`,
							start: word - 1,
							end: word
						}))
					}
				]
			},
			'warsh'
		);
		expect(result.segments?.[0]).toMatchObject({
			ref_from: '55:3:1',
			ref_to: '55:4:2',
			time_from: 10.98,
			time_to: 17.3
		});
		expect(result.segments?.[0].words?.map((word) => word.location)).toEqual([
			'55:3:1',
			'55:3:2',
			'55:4:1',
			'55:4:2'
		]);
	});

	it('combines split reading words without losing real recitation repetitions', async () => {
		const result = await normalizeRiwayahSegmentationResponse(
			{
				segments: [
					{
						ref_from: '2:180:3',
						ref_to: '2:180:4',
						words: [
							{ location: '2:180:3', start: 0, end: 0.2 },
							{ location: '2:180:4', start: 0.2, end: 0.5 },
							{ location: '2:180:3', start: 0.6, end: 0.8 },
							{ location: '2:180:4', start: 0.8, end: 1 }
						]
					}
				]
			},
			'warsh'
		);
		expect(result.segments?.[0].words).toEqual([
			{ location: '2:181:3', start: 0, end: 0.5, word: 'بَعْدَ مَا' },
			{ location: '2:181:3', start: 0.6, end: 1, word: 'بَعْدَ مَا' }
		]);
	});

	it('preserves the word range when one reading word covers two Hafs words', async () => {
		const result = await normalizeRiwayahSegmentationResponse(
			{
				segments: [
					{
						ref_from: '57:23:10',
						ref_to: '57:23:10',
						words: [{ location: '57:23:10', start: 0.2, end: 0.8 }]
					}
				]
			},
			'warsh'
		);
		expect(result.segments?.[0]).toMatchObject({ ref_from: '57:24:10', ref_to: '57:24:11' });
		expect(
			result.segments?.[0].words?.map((word) => [word.location, word.start, word.end])
		).toEqual([
			['57:24:10', 0.2, 0.8],
			['57:24:11', 0.2, 0.8]
		]);
	});

	it('normalizes segments without word timings and preserves special subtitles', async () => {
		const special = { ref_from: 'basmala', ref_to: 'basmala', special_type: 'Basmala' };
		const result = await normalizeRiwayahSegmentationResponse(
			{ segments: [special, { ref_from: '55:1:2', ref_to: '55:1:3' }] },
			'warsh'
		);
		expect(result.segments?.[0]).toEqual(special);
		expect(result.segments?.[1]).toEqual({ ref_from: '55:2:1', ref_to: '55:2:2' });
	});

	it.each([undefined, null, 'hafs'] as const)('leaves %s references unchanged', async (riwayah) => {
		const response = { segments: [{ ref_from: '55:2:1', ref_to: '55:2:2' }] };
		expect(await normalizeRiwayahSegmentationResponse(response, riwayah)).toBe(response);
	});

	it.each([
		['qalun', '55:1:2', '55:2:1'],
		['shuba', '55:2:1', '55:2:1']
	] as const)('uses the selected %s word mapping', async (riwayah, native, hafs) => {
		const result = await normalizeRiwayahSegmentationResponse(
			{
				segments: [{ ref_from: native, ref_to: native }]
			},
			riwayah
		);
		expect(result.segments?.[0]).toEqual({ ref_from: hafs, ref_to: hafs });
	});

	it('rejects unmapped Quran references instead of silently clamping them to another word', async () => {
		await expect(
			normalizeRiwayahSegmentationResponse(
				{
					segments: [{ ref_from: '55:1:99', ref_to: '55:1:99' }]
				},
				'warsh'
			)
		).rejects.toThrow('55:1:99');
	});

	it('loads a regular one-to-one ayah from the actual Warsh text', () => {
		const slice = warsh.getVerseSlice(57, 10, 0, 36, true);

		expect(slice?.targetAyahs).toEqual([10]);
		expect(slice?.relation).toBe('mapped');
		expect(slice?.text).toContain('وَكُلّاٗ وَعَدَ اَ۬للَّهُ اُ۬لْحُسْن۪ىٰ');
		expect(slice?.suffix).toBe(' ١٠');
	});

	it('uses the mapped Warsh number when Hafs and Warsh numbering differ', () => {
		const slice = warsh.getVerseSlice(57, 15, 0, 14, true);

		expect(slice?.targetAyahs).toEqual([14]);
		expect(slice?.suffix).toBe(' ١٤');
	});

	it('preserves merged and split Warsh ayah boundaries', () => {
		const firstMergedPart = warsh.getVerseSlice(2, 1, 0, 0, true);
		const lastMergedPart = warsh.getVerseSlice(2, 2, 0, 6, true);
		const split = warsh.getVerseSlice(2, 255, 0, 49, true);

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
		expect(warsh.getTranslationVerseNumber(2, 255, 'before')).toBe('253-254');
		expect(warsh.getTranslationVerseNumber(2, 256, 'before')).toBe('255');
	});

	it('preserves all seven Fatiha clips with Warsh boundaries and an unnumbered basmala', () => {
		const slices = [
			warsh.getVerseSlice(1, 1, 0, 3, true),
			warsh.getVerseSlice(1, 2, 0, 3, true),
			warsh.getVerseSlice(1, 3, 0, 1, true),
			warsh.getVerseSlice(1, 4, 0, 2, true),
			warsh.getVerseSlice(1, 5, 0, 3, true),
			warsh.getVerseSlice(1, 6, 0, 2, true),
			warsh.getVerseSlice(1, 7, 0, 8, true)
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
		const omittedWordReading = warsh.getVerseSlice(57, 24, 0, 11, true);
		const splitWordReading = warsh.getVerseSlice(2, 181, 0, 12, false);

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
		expect(warsh.getTranslationVerseNumber(2, 1, 'before')).toBe('1');
		expect(warsh.getTranslationVerseNumber(2, 2, 'before')).toBeNull();
		expect(warsh.getTranslationVerseNumber(2, 1, 'after')).toBeNull();
		expect(warsh.getTranslationVerseNumber(2, 2, 'after')).toBe('1');
		expect(warsh.getTranslationVerseNumber(2, 3, 'before')).toBe('2');
		expect(warsh.getTranslationVerseNumber(57, 24, 'before')).toBe('23');
		expect(warsh.getTranslationVerseNumber(2, 255, 'before')).toBe('253-254');
		expect(warsh.getTranslationVerseNumber(2, 255, 'after')).toBe('253-254');
		expect(warsh.getTranslationVerseNumber(2, 256, 'before')).toBe('255');
	});

	it.each(riwayat)('loads the bundled KFGQPC text and mapping for %s', (riwayah) => {
		const slice = RiwayahProvider.getVerseSlice(riwayah, 2, 2, 0, 6, true);

		expect(RiwayahProvider.isReady(riwayah)).toBe(true);
		expect(slice?.words.length).toBeGreaterThan(0);
		expect(slice?.text).toMatch(/[ء-غف-ي]/u);
		expect(slice?.targetAyahs.length).toBeGreaterThan(0);
	});

	it.each([
		['Warsh', [], [253, 254], 23],
		['Qaloon', [], [253, 254], 23],
		['Shouba', [1], [255], 24],
		['Doori', [], [253], 23],
		['Soosi', [], [253], 23],
		['Bazzi', [1], [253, 254], 23],
		['Qumbul', [1], [253, 254], 23]
	] as const)(
		'uses the real KFGQPC ayah boundaries for %s',
		(riwayah, fatihaBasmalaTargets, kursiTargets, hadidTarget) => {
			expect(RiwayahProvider.getVerseSlice(riwayah, 1, 1, 0, 3, true)?.targetAyahs).toEqual(
				fatihaBasmalaTargets
			);
			expect(RiwayahProvider.getVerseSlice(riwayah, 2, 255, 0, 49, true)?.targetAyahs).toEqual(
				kursiTargets
			);
			expect(RiwayahProvider.getVerseSlice(riwayah, 57, 24, 0, 11, true)?.targetAyahs).toEqual([
				hadidTarget
			]);
		}
	);

	it.each([
		['warsh', 'warsh/data/warshData_v10.json'],
		['qaloon', 'qaloon/data/QaloonData_v10.json'],
		['shouba', 'shouba/data/ShoubaData08.json'],
		['doori', 'doori/data/DooriData_v09.json'],
		['soosi', 'soosi/data/SoosiData09.json'],
		['bazzi', 'bazzi/data/BazziData_v07.json'],
		['qumbul', 'qumbul/data/QumbulData_v07.json']
	])('records the official KFGQPC source for %s', async (slug, sourcePath) => {
		const [payloadBuffer, ttf, woff2] = await Promise.all([
			readFile(`static/riwayat/${slug}/verses.json`),
			readFile(`static/riwayat/${slug}/font.ttf`),
			readFile(`static/riwayat/${slug}/font.woff2`)
		]);
		const payload = JSON.parse(payloadBuffer.toString('utf8'));

		expect(payload._meta.source).toBe(
			`https://raw.githubusercontent.com/thetruetruth/quran-data-kfgqpc/main/${sourcePath}`
		);
		expect(Object.keys(payload.verses)).toHaveLength(6236);
		expect(ttf.length).toBeGreaterThan(200_000);
		expect(woff2.subarray(0, 4).toString('ascii')).toBe('wOF2');
	});
});
