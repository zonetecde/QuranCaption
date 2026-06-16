import { describe, expect, it } from 'vitest';

import { parseImportedSegmentationJson } from '$lib/services/AutoSegmentation';

/**
 * The "Quranic Universal Audio" feature feeds the aligner Preload API's
 * `preload_segments` response straight into the existing imported-JSON parse +
 * apply path (no bespoke mapper). These tests pin that the preload envelope is
 * accepted as-is and that word timestamps (relative to segment start) survive
 * parsing unchanged — the property the millisecond conversion in
 * apply-segmentation.ts relies on.
 */

// Shaped exactly like a real `/preload_segments` response (verified against prod).
const PRELOAD_PAYLOAD = {
	_meta: { view_mode: 'segment', source: 'preload' },
	recitation: 'abdul_hamid_ghraio_2026_yt',
	chapter: 2,
	verse_from: 1,
	verse_to: 2,
	audio_url: 'https://hetchyy-quranic-universal-aligner.hf.space/preload-audio/x/2.mp3',
	segments: [
		{
			segment: 1,
			time_from: 3.17,
			time_to: 9.868,
			ref_from: '2:1:1',
			ref_to: '2:1:1',
			matched_text: 'الٓمٓ',
			confidence: 0.99,
			has_missing_words: false,
			has_repeated_words: false,
			special_type: null,
			error: null,
			// Preload-only fields that the parser should simply ignore.
			duplicated: false,
			duplicate_kind: null,
			words: [{ word: 'الٓمٓ', location: '2:1:1', start: 0.0, end: 6.698 }]
		},
		{
			segment: 2,
			time_from: 9.908,
			time_to: 13.354,
			ref_from: '2:2:1',
			ref_to: '2:2:5',
			matched_text: 'ذلك الكتاب',
			confidence: 0.97,
			words: [
				{ word: 'ذَٰلِكَ', location: '2:2:1', start: 0.04, end: 0.69 },
				{ word: 'فِيهِۛ', location: '2:2:5', start: 2.38, end: 3.446 }
			]
		}
	]
};

describe('preload envelope → imported segmentation parse', () => {
	it('accepts the preload envelope and keeps every segment', () => {
		const { response, segmentCount } = parseImportedSegmentationJson(PRELOAD_PAYLOAD);
		expect(segmentCount).toBe(2);
		expect(response.segments).toHaveLength(2);
	});

	it('preserves segment-relative word timestamps unchanged', () => {
		const { response } = parseImportedSegmentationJson(PRELOAD_PAYLOAD);
		const second = response.segments![1];
		// Segment starts at 9.908s but its first word starts at 0.04s (relative).
		expect(second.time_from).toBe(9.908);
		expect(second.words?.[0]).toMatchObject({ location: '2:2:1', start: 0.04, end: 0.69 });
		expect(second.words?.[1]).toMatchObject({ location: '2:2:5', start: 2.38, end: 3.446 });
	});

	it('maps core fields and tolerates preload-only extras', () => {
		const { response } = parseImportedSegmentationJson(PRELOAD_PAYLOAD);
		const first = response.segments![0];
		expect(first).toMatchObject({
			segment: 1,
			time_from: 3.17,
			time_to: 9.868,
			ref_from: '2:1:1',
			ref_to: '2:1:1'
		});
		// No `duplicated`/`duplicate_kind` leak into the normalized segment.
		expect('duplicated' in first).toBe(false);
		expect('duplicate_kind' in first).toBe(false);
	});

	it('also parses the same payload when passed as a JSON string', () => {
		const { segmentCount } = parseImportedSegmentationJson(JSON.stringify(PRELOAD_PAYLOAD));
		expect(segmentCount).toBe(2);
	});
});
