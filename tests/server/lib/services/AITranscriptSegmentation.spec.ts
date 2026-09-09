import { describe, expect, it } from 'vitest';
import {
	buildTranscriptSegmentationBatches,
	validateTranscriptSegmentationBatch
} from '$lib/services/AITranscriptSegmentation';
import type { ProcessedTranscriptToken } from '$lib/services/TranscriptPostProcessor';

/**
 * Construit un token horodaté pour tester le contrat de segmentation IA.
 * @param {number} id Identifiant du token.
 * @returns {ProcessedTranscriptToken} Token prêt à analyser.
 */
function token(id: number): ProcessedTranscriptToken {
	return {
		id,
		text: `word${id}`,
		start: id * 0.4,
		end: id * 0.4 + 0.35,
		speaker: 'SPEAKER_00',
		confidence: 0.9,
		punctuationAfter: '',
		preferredBreakAfter: false,
		sourceIds: [id],
		quran: null,
		quoteId: null,
		quoteType: null
	};
}

describe('AITranscriptSegmentation batches', () => {
	it('uses symmetric context while assigning every boundary to one core', () => {
		const batches = buildTranscriptSegmentationBatches(
			Array.from({ length: 260 }, (_, id) => token(id))
		);

		expect(batches).toHaveLength(3);
		expect(batches[0].request.before).toHaveLength(0);
		expect(batches[0].request.core).toHaveLength(120);
		expect(batches[0].request.after).toHaveLength(40);
		expect(batches[1].request.before[0].id).toBe(80);
		expect(batches[1].request.core[0].id).toBe(120);
		expect(batches[1].request.after.at(-1)?.id).toBe(259);
		expect(batches[2].request.core.at(-1)?.id).toBe(259);
	});

	it('accepts typed core boundaries and rejects context or forbidden Quran boundaries', () => {
		const tokens = Array.from({ length: 130 }, (_, id) => token(id));
		tokens[20].quran = { surah: 2, verse: 255, word: 3, verseWordCount: 50, waqf: false };
		const batch = buildTranscriptSegmentationBatches(tokens)[0];
		const validation = validateTranscriptSegmentationBatch(batch, {
			boundaries: [
				{ after: 10, kind: 'sentence' },
				{ after: 5, kind: 'phrase' },
				{ after: 10, kind: 'clause' },
				{ after: 20, kind: 'clause' },
				{ after: 125, kind: 'phrase' }
			]
		});

		expect(validation.boundaries).toEqual([
			{ afterId: 5, kind: 'phrase' },
			{ afterId: 10, kind: 'sentence' }
		]);
		expect(validation.errors).toHaveLength(3);
	});

	it('accepts an empty boundary list and rejects a malformed response', () => {
		const batch = buildTranscriptSegmentationBatches([token(0)])[0];

		expect(validateTranscriptSegmentationBatch(batch, { boundaries: [] })).toEqual({
			boundaries: [],
			errors: []
		});
		expect(validateTranscriptSegmentationBatch(batch, {}).errors).toHaveLength(1);
	});
});
