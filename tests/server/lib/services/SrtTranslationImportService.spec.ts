import { describe, expect, it } from 'vitest';
import {
	matchSrtCuesToClips,
	parseSrtTranslation,
	type SrtCue
} from '$lib/services/SrtTranslationImportService';

describe('parseSrtTranslation', () => {
	it('parses multiline cues and both SRT decimal separators', () => {
		const cues = parseSrtTranslation(
			'\uFEFF1\r\n00:00:01,000 --> 00:00:03,500\r\nFirst line\r\nSecond line\r\n\r\n2\n00:00:04.000 --> 00:00:05.000\nNext cue'
		);

		expect(cues).toEqual([
			{ index: 1, startTime: 1000, endTime: 3500, text: 'First line\nSecond line' },
			{ index: 2, startTime: 4000, endTime: 5000, text: 'Next cue' }
		]);
	});

	it('ignores formatting tags and rejects files without valid cues', () => {
		expect(parseSrtTranslation('1\n00:00:00,000 --> 00:00:01,000\n<i>Text</i>')).toEqual([
			{ index: 1, startTime: 0, endTime: 1000, text: 'Text' }
		]);
		expect(() => parseSrtTranslation('not an srt file')).toThrow();
	});
});

describe('matchSrtCuesToClips', () => {
	it('matches by overlap, combines cues, and uses a nearby cue as fallback', () => {
		const cues: SrtCue[] = [
			{ index: 1, startTime: 1000, endTime: 3000, text: 'First' },
			{ index: 2, startTime: 3000, endTime: 5000, text: 'Second' }
		];

		expect(
			matchSrtCuesToClips(cues, [
				{ id: 10, startTime: 900, endTime: 5200 },
				{ id: 11, startTime: 5100, endTime: 6500 }
			])
		).toEqual([
			{ clipId: 10, text: 'First Second', cueIndexes: [1, 2] },
			{ clipId: 11, text: 'Second', cueIndexes: [2] }
		]);
	});
});
