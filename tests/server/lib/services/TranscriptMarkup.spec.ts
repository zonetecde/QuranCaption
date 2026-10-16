import { describe, expect, it } from 'vitest';
import {
	getTranscriptReferenceLogicalParts,
	parseQuranTranscriptReference
} from '$lib/services/TranscriptMarkup';

describe('Transcript markup without project or rendering dependencies', () => {
	it('parses free text, citations and explicit Quran ranges without loading a corpus', () => {
		expect(
			getTranscriptReferenceLogicalParts('before {{2:255:2-4}} {{a quotation}} after')
		).toEqual([
			{ text: 'before ', referenceType: null, wordCount: 1 },
			{
				text: '2:255:2-4',
				referenceType: 'quran',
				quranReference: { surah: 2, verse: 255, startWord: 2, endWord: 4 },
				wordCount: 3
			},
			{ text: ' ', referenceType: null, wordCount: 0 },
			{ text: 'a quotation', referenceType: 'citation', wordCount: 2 },
			{ text: ' after', referenceType: null, wordCount: 1 }
		]);
	});

	it('resolves complete verses only through the supplied corpus boundary', () => {
		expect(getTranscriptReferenceLogicalParts('{{2:255}}')?.[0].wordCount).toBeNull();
		expect(getTranscriptReferenceLogicalParts('{{2:255}}', () => 50)?.[0].wordCount).toBe(50);
		expect(parseQuranTranscriptReference('a quotation')).toBeNull();
	});
});
