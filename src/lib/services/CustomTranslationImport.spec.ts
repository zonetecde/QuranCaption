import { describe, expect, it } from 'vitest';

import {
	buildCustomTranslationImport,
	extractSurahNumberFromFileName
} from './CustomTranslationImport';

describe('extractSurahNumberFromFileName', () => {
	it('extracts surah numbers from common file naming patterns', () => {
		expect(extractSurahNumberFromFileName('1.txt')).toBe(1);
		expect(extractSurahNumberFromFileName('001.txt')).toBe(1);
		expect(extractSurahNumberFromFileName('/tmp/surah-114.txt')).toBe(114);
	});

	it('returns null when no valid surah number is found', () => {
		expect(extractSurahNumberFromFileName('translation.txt')).toBe(null);
		expect(extractSurahNumberFromFileName('200.txt')).toBe(null);
	});
});

describe('buildCustomTranslationImport', () => {
	it('builds a custom edition and verse map from valid text files', () => {
		const imported = buildCustomTranslationImport(
			[
				{
					name: '001.txt',
					content: ['First ayah', 'Second ayah', 'Third ayah'].join('\n')
				},
				{
					name: 'surah-2.txt',
					content: ['Ayah one', 'Ayah two'].join('\n')
				}
			],
			{
				author: 'My Translation',
				language: 'Somali',
				direction: 'ltr',
				getVerseCount: (surah) => ({ 1: 3, 2: 2 }[surah] || 0),
				requiredSurahs: [1, 2]
			}
		);

		expect(imported.edition.author).toBe('My Translation');
		expect(imported.edition.language).toBe('Somali');
		expect(imported.edition.isCustom).toBe(true);
		expect(imported.importedSurahs).toEqual([1, 2]);
		expect(imported.translations['1:2']).toBe('Second ayah');
		expect(imported.translations['2:2']).toBe('Ayah two');
	});

	it('fails when a provided surah file has the wrong ayah count', () => {
		expect(() =>
			buildCustomTranslationImport(
				[
					{
						name: '1.txt',
						content: ['Only one ayah'].join('\n')
					}
				],
				{
					author: 'My Translation',
					language: 'Somali',
					direction: 'ltr',
					getVerseCount: (surah) => ({ 1: 3 }[surah] || 0)
				}
			)
		).toThrow('Surah 1 has 1 lines, but 3 ayahs are expected.');
	});

	it('fails when the current project requires surahs that were not imported', () => {
		expect(() =>
			buildCustomTranslationImport(
				[
					{
						name: '1.txt',
						content: ['A', 'B', 'C'].join('\n')
					}
				],
				{
					author: 'My Translation',
					language: 'Somali',
					direction: 'ltr',
					getVerseCount: (surah) => ({ 1: 3, 2: 2 }[surah] || 0),
					requiredSurahs: [1, 2]
				}
			)
		).toThrow('Missing required surah files for this project: 2.');
	});
});
