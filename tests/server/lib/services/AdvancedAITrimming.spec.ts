import { describe, expect, it, vi } from 'vitest';

import {
	applyAdvancedTrimValidationSuccess,
	buildAdvancedTrimBatches,
	type AdvancedTrimValidationSuccess,
	type AdvancedTrimVerseCandidate
} from '$lib/services/AdvancedAITrimming';
import { Edition, SubtitleClip, type Project } from '$lib/classes';
import { VerseTranslation } from '$lib/classes/Translation.svelte';

/**
 * Crée un candidat minimal avec un nombre de mots contrôlé.
 *
 * @param {number} index Index du verset.
 * @param {number} wordCount Nombre de mots estimé.
 * @returns {AdvancedTrimVerseCandidate} Candidat utilisable par le batcher.
 */
function createCandidate(index: number, wordCount: number): AdvancedTrimVerseCandidate {
	return {
		index,
		verseKey: `1:${index + 1}`,
		startTime: index * 1000,
		endTime: (index + 1) * 1000,
		subtitles: [],
		coverageOnlyTexts: [],
		hasFullVerseCoverage: false,
		sourceTranslation: 'word '.repeat(wordCount).trim(),
		wordCount,
		segments: [],
		isAlreadyReviewed: false
	};
}

describe('AdvancedAITrimming batches', () => {
	it('uses the selected maximum word count for each batch', () => {
		const candidates = [createCandidate(0, 100), createCandidate(1, 100), createCandidate(2, 100)];

		const batches = buildAdvancedTrimBatches(candidates, 'gpt-5.4', 'none', 0, Infinity, 150);

		expect(batches.map((batch) => batch.wordCount)).toEqual([100, 100, 100]);
	});

	it('recalculates batch translation indexes from the explicit source translation', () => {
		const edition = new Edition('key', 'edition', 'Author', 'English', 'ltr', '', '', '', '');
		const translation = new VerseTranslation('Source words', 'to review');
		const recalculate = vi
			.spyOn(translation, 'tryRecalculateTranslationIndexes')
			.mockImplementation(() => undefined);
		const subtitle = {
			translations: { [edition.name]: translation },
			startWordIndex: 0,
			endWordIndex: 1
		} as unknown as SubtitleClip;
		const candidate = {
			...createCandidate(0, 2),
			verseKey: '1:1',
			sourceTranslation: 'Source words',
			hasFullVerseCoverage: true,
			subtitles: [subtitle],
			segments: [
				{
					i: 0,
					arabic: 'text',
					wordByWordEnglish: [],
					needsAi: true,
					existingText: '',
					subtitle
				}
			]
		};
		const validVerse = {
			candidate,
			result: { verseKey: '1:1', segments: [{ i: 0, text: 'Source words' }] }
		} satisfies AdvancedTrimValidationSuccess;

		applyAdvancedTrimValidationSuccess(edition, [validVerse], {} as Project);

		expect(recalculate).toHaveBeenCalledWith(edition, '1:1', 'Source words');
	});
});
