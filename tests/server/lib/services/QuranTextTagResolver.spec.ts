import { describe, expect, it } from 'vitest';

import { QURAN_TEXT_TAGS, resolveQuranTextTags } from '$lib/services/QuranTextTagResolver.svelte';

describe('Quran text tag resolver', () => {
	it('resolves all shared Quran tags and keeps unknown tags', () => {
		expect(
			resolveQuranTextTags(
				'<number>|<surah>|<verse>|<min-range>|<max-range>|<transliteration>|<translation>|<arabic>|<translation-EN>|<translation-zh-hant>|<br>|<unknown>',
				{
					number: 7,
					surah: 2,
					verse: 255,
					minRange: 1,
					maxRange: 255,
					transliteration: 'Al-Baqarah',
					translation: 'The Cow',
					arabic: 'قارئ',
					translations: {
						English: 'Al-Baqarah',
						ChineseTraditional: '黃牛章'
					}
				}
			)
		).toBe('7|2|255|1|255|Al-Baqarah|The Cow|قارئ|Al-Baqarah|黃牛章|\n|<unknown>');
	});

	it('exposes the complete list of supported format tags', () => {
		expect(QURAN_TEXT_TAGS).toEqual([
			'<number>',
			'<surah>',
			'<verse>',
			'<min-range>',
			'<max-range>',
			'<transliteration>',
			'<translation>',
			'<arabic>',
			'<translation-en>',
			'<translation-es>',
			'<translation-fr>',
			'<translation-bn>',
			'<translation-zh>',
			'<translation-zh_hant>',
			'<translation-zh-hant>',
			'<br>'
		]);
	});
});
