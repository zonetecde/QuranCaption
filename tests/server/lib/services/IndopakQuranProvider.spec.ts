import { describe, expect, it } from 'vitest';

import { Quran, Surah, Verse, Word } from '$lib/classes/Quran';
import IndopakQuranProvider from '$lib/services/IndopakQuranProvider';

describe('IndopakQuranProvider', () => {
	it('reconstructs an IndoPak segment from its Uthmani word indexes', () => {
		const previousSurahs = Quran.surahs;
		Quran.surahs = [
			new Surah(1, '', '', '', 1, '', '', [
				new Verse(1, [
					new Word('Uthmani one', '', '', 'IndoPak one'),
					new Word('Uthmani two', '', '', 'IndoPak two'),
					new Word('Uthmani three', '', '', 'IndoPak three')
				])
			])
		];

		try {
			expect(IndopakQuranProvider.getVerseWordsSlice(1, 1, 1, 2)).toEqual([
				'IndoPak two',
				'IndoPak three'
			]);
			expect(IndopakQuranProvider.getVerseSlice(1, 1, 1, 2)).toBe('IndoPak two IndoPak three');
		} finally {
			Quran.surahs = previousSurahs;
		}
	});
});
