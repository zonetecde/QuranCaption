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
		expect(batches[0].request.after).toHaveLength(30);
		expect(batches[1].request.before[0].i).toBe(90);
		expect(batches[1].request.core[0].i).toBe(120);
		expect(batches[1].request.after.at(-1)?.i).toBe(259);
		expect(batches[2].request.core.at(-1)?.i).toBe(259);
	});

	it('uses compact word keys and omits empty optional metadata', () => {
		const tokens = [token(0), token(1)];
		tokens[1].speaker = 'SPEAKER_01';
		tokens[1].quran = { surah: 2, verse: 255, word: 3, verseWordCount: 50, waqf: false };
		tokens[1].quoteId = 7;
		tokens[1].quoteType = 'hadith';

		const words = buildTranscriptSegmentationBatches(tokens)[0].request.core;

		expect(words[0]).toEqual({ i: 0, t: 'word0', p: 0, s: 0, e: 0.35, g: 0.05 });
		expect(words[1]).toEqual({
			i: 1,
			t: 'word1',
			p: 1,
			s: 0.4,
			e: 0.75,
			l: true,
			q: '2:255',
			v: 'hadith-7'
		});
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
