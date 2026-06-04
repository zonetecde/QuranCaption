import { describe, expect, it } from 'vitest';

import {
	DEFAULT_YTB_CHAPTERS_FORMAT,
	formatYouTubeChapterLine,
	type YouTubeChapterFormatValues
} from '$lib/classes/Exporter';

const baseValues: YouTubeChapterFormatValues = {
	timestamp: '0:03',
	surahNumber: 20,
	surahTranslation: 'Ta-Ha',
	surahTransliteration: 'Taha',
	verseArabic: 'طه',
	verseNumber: 2,
	verseTranslation: 'We have not sent down to you the Quran that you be distressed'
};

describe('YouTube chapter formatting', () => {
	it('keeps the default chapter output shape', () => {
		expect(formatYouTubeChapterLine(DEFAULT_YTB_CHAPTERS_FORMAT, baseValues)).toBe(
			'0:03 Surah 20, Verse 2'
		);
	});

	it('replaces verse placeholders in a custom format', () => {
		const line = formatYouTubeChapterLine(
			'<timestamp> <surah-number>:<verse-number> <verse-arabic> - <verse-translation>',
			baseValues
		);

		expect(line).toBe(
			'0:03 20:2 طه - We have not sent down to you the Quran that you be distressed'
		);
	});

	it('replaces surah name placeholders', () => {
		const line = formatYouTubeChapterLine(
			'<timestamp> <surah-transliteration> / <surah-translation>',
			baseValues
		);

		expect(line).toBe('0:03 Taha / Ta-Ha');
	});

	it('keeps unknown placeholders and supports blank verse translations', () => {
		const line = formatYouTubeChapterLine('<timestamp> <verse-translation> <unknown>', {
			...baseValues,
			verseTranslation: ''
		});

		expect(line).toBe('0:03  <unknown>');
	});
});
