import { describe, expect, it } from 'vitest';
import { matchReferenceTranscript } from '$lib/services/ReferenceTranscriptAlignment';
import type { AITranscriptionResult } from '$lib/types/transcription';

/**
 * Construit une reconnaissance avec des timings absolus pour tester les reprises.
 * @param {string} text Texte entendu.
 * @returns {AITranscriptionResult} Résultat de reconnaissance simulé.
 */
function transcript(text: string): AITranscriptionResult {
	const words = text.split(' ').map((word, index) => ({
		word,
		start: 10 + index * 0.5,
		end: 10.4 + index * 0.5,
		speaker: 'SPEAKER_00'
	}));
	return {
		language: 'ar',
		device: 'cpu',
		model: 'small',
		speakers: ['SPEAKER_00'],
		wordTimestampsAvailable: true,
		segments: [
			{ start: words[0].start, end: words.at(-1)!.end, text, speaker: 'SPEAKER_00', words }
		]
	};
}

describe('reference transcript alignment', () => {
	it('uses the supplied spelling and preserves verse boundaries and absolute times', () => {
		const result = matchReferenceTranscript(
			transcript('يا قلب لا تحزن إن الفجر قريب'),
			'يَا قَلْبُ لَا تَحْزَنْ\nإِنَّ الْفَجْرَ قَرِيبٌ'
		);
		expect(result.segments.map((segment) => segment.text)).toEqual([
			'يَا قَلْبُ لَا تَحْزَنْ',
			'إِنَّ الْفَجْرَ قَرِيبٌ'
		]);
		expect(result.unmatchedWords).toBe(0);
		expect(result.segments[0].start).toBe(10);
		expect(result.segments[1].end).toBe(13.4);
	});

	it('finds a verse repeated without duplicating it in the reference', () => {
		const result = matchReferenceTranscript(
			transcript('يا قلب لا تحزن يا قلب لا تحزن إن الفجر قريب'),
			'يا قلب لا تحزن\nإن الفجر قريب'
		);
		expect(result.segments.map((segment) => segment.text)).toEqual([
			'يا قلب لا تحزن',
			'يا قلب لا تحزن',
			'إن الفجر قريب'
		]);
		expect(result.matched.every(Boolean)).toBe(true);
	});

	it('keeps a mistaken word and recovers when the speaker restarts', () => {
		const result = matchReferenceTranscript(
			transcript('يا قلب سيارة يا قلب لا تحزن'),
			'يا قلب لا تحزن'
		);
		expect(result.segments.at(-1)?.text).toBe('يا قلب لا تحزن');
		expect(result.segments.some((segment) => segment.text === 'سيارة')).toBe(true);
		expect(result.unmatchedWords).toBeGreaterThan(0);
	});

	it('handles a repeated word inside a line', () => {
		const result = matchReferenceTranscript(transcript('إن الفجر الفجر قريب'), 'إن الفجر قريب');
		expect(result.segments.map((segment) => segment.text).join(' ')).toBe('إن الفجر الفجر قريب');
		expect(result.unmatchedWords).toBe(0);
	});

	it('can start partway through the reference and return to an earlier verse', () => {
		const result = matchReferenceTranscript(
			transcript('إن الفجر قريب يا قلب لا تحزن'),
			'يا قلب لا تحزن\nإن الفجر قريب'
		);
		expect(result.segments.map((segment) => segment.text)).toEqual([
			'إن الفجر قريب',
			'يا قلب لا تحزن'
		]);
	});

	it('does not match unrelated speech', () => {
		const result = matchReferenceTranscript(transcript('سيارة مدرسة حاسوب'), 'يا قلب لا تحزن');
		expect(result.matched.some(Boolean)).toBe(false);
		expect(result.unmatchedWords).toBe(3);
	});

	it('does not merge different speakers or long silences into an alignment window', () => {
		const source = transcript('يا قلب لا تحزن');
		source.segments[0].words[2].speaker = 'SPEAKER_01';
		source.segments[0].words[3].start += 4;
		source.segments[0].words[3].end += 4;
		const result = matchReferenceTranscript(source, 'يا قلب لا تحزن');
		expect(result.segments).toHaveLength(3);
		expect(result.segments[1].speaker).toBe('SPEAKER_01');
	});

	it('rejects an empty or non-Arabic reference', () => {
		expect(() => matchReferenceTranscript(transcript('يا قلب'), '   ')).toThrow(
			'REFERENCE_TEXT_REQUIRED'
		);
		expect(() => matchReferenceTranscript(transcript('يا قلب'), 'hello')).toThrow(
			'REFERENCE_TEXT_REQUIRED'
		);
	});

	it('bounds alignment memory for oversized inputs', () => {
		expect(() =>
			matchReferenceTranscript(transcript('قلب '.repeat(3000).trim()), 'قلب '.repeat(3000))
		).toThrow('REFERENCE_TEXT_TOO_LONG');
	});
});
