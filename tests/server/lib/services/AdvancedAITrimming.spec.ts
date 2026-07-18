import { describe, expect, it } from 'vitest';

import {
	buildAdvancedTrimBatches,
	type AdvancedTrimVerseCandidate
} from '$lib/services/AdvancedAITrimming';

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
});
