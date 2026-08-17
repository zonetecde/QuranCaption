import { describe, expect, it } from 'vitest';

import {
	DEFAULT_YTB_CHAPTERS_FORMAT,
	formatYouTubeChapterLine,
	getRandomBackgroundCandidates,
	selectRandomBackgroundCandidate,
	createRandomBackgroundClip,
	type YouTubeChapterFormatValues
} from '$lib/classes/Exporter';
import { AssetType } from '$lib/classes';

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

describe('Random export backgrounds', () => {
	it('filters compatible files without entering subdirectories', () => {
		const entries = [
			{ name: 'image.PNG', isFile: true, isDirectory: false },
			{ name: 'clip.webm', isFile: true, isDirectory: false },
			{ name: 'audio.mp3', isFile: true, isDirectory: false },
			{ name: 'nested', isFile: false, isDirectory: true }
		];

		expect(getRandomBackgroundCandidates(entries)).toEqual(['image.PNG', 'clip.webm']);
	});

	it('selects a candidate from a normalized random value', () => {
		const entries = [
			{ name: 'first.jpg', isFile: true, isDirectory: false },
			{ name: 'second.mp4', isFile: true, isDirectory: false }
		];

		expect(selectRandomBackgroundCandidate(entries, 0)).toBe('first.jpg');
		expect(selectRandomBackgroundCandidate(entries, 0.99)).toBe('second.mp4');
	});

	it('creates a static image clip and a looping video clip', () => {
		expect(createRandomBackgroundClip(7, AssetType.Image, 5000)).toMatchObject({
		assetId: 7,
		startTime: 0,
		endTime: 0,
		loopUntilAudioEnd: false
	});
		expect(createRandomBackgroundClip(8, AssetType.Video, 5000)).toMatchObject({
		assetId: 8,
		startTime: 0,
		endTime: 5000,
		loopUntilAudioEnd: true
	});
	});
});
