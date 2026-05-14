import { describe, expect, it } from 'vitest';

import {
	closeSmallSubtitleGaps,
	extendSubtitlesToFillGaps,
	insertSilenceClips
} from '$lib/services/AutoSegmentation';
import { SilenceClip, type SubtitleClip, type PredefinedSubtitleClip } from '$lib/classes';

/**
 * Crée un clip simulé avec startTime / endTime mutables.
 * On utilise SilenceClip car il est le plus simple à construire.
 */
function mockClip(start: number, end: number): SilenceClip {
	return new SilenceClip(start, end);
}

/** Cast pour les fonctions qui attendent (SubtitleClip | PredefinedSubtitleClip)[] */
function asOptionalClips(clips: SilenceClip[]) {
	return clips as unknown as Array<SubtitleClip | PredefinedSubtitleClip>;
}

// ---------------------------------------------------------------------------
// closeSmallSubtitleGaps
// ---------------------------------------------------------------------------
describe('closeSmallSubtitleGaps', () => {
	it('closes a gap smaller than maxGapMs', () => {
		const clips = [mockClip(0, 100), mockClip(115, 200)];
		closeSmallSubtitleGaps(asOptionalClips(clips), 20);
		expect(clips[1].startTime).toBe(101);
	});

	it('does not close a gap larger than or equal to maxGapMs', () => {
		const clips = [mockClip(0, 100), mockClip(130, 200)];
		closeSmallSubtitleGaps(asOptionalClips(clips), 20);
		expect(clips[1].startTime).toBe(130);
	});

	it('does nothing for a single clip', () => {
		const clips = [mockClip(0, 100)];
		closeSmallSubtitleGaps(asOptionalClips(clips), 200);
		expect(clips[0].startTime).toBe(0);
		expect(clips[0].endTime).toBe(100);
	});

	it('does nothing when clips are already contiguous', () => {
		const clips = [mockClip(0, 100), mockClip(101, 200)];
		closeSmallSubtitleGaps(asOptionalClips(clips), 200);
		expect(clips[1].startTime).toBe(101);
	});

	it('handles multiple gaps', () => {
		const clips = [mockClip(0, 100), mockClip(110, 200), mockClip(230, 350)];
		closeSmallSubtitleGaps(asOptionalClips(clips), 15);
		expect(clips[1].startTime).toBe(101);
		expect(clips[2].startTime).toBe(230);
	});
});

// ---------------------------------------------------------------------------
// insertSilenceClips
// ---------------------------------------------------------------------------
describe('insertSilenceClips', () => {
	it('inserts a leading silence when first clip starts late', () => {
		const clips = [mockClip(500, 1000)];
		const result = insertSilenceClips(clips, 200);
		expect(result).toHaveLength(2);
		expect(result[0]).toBeInstanceOf(SilenceClip);
		expect(result[0].startTime).toBe(0);
		expect(result[0].endTime).toBe(499);
		expect(result[1]).toBe(clips[0]);
	});

	it('does not insert leading silence when first clip starts early', () => {
		const clips = [mockClip(50, 1000)];
		const result = insertSilenceClips(clips, 200);
		expect(result).toHaveLength(1);
		expect(result[0]).toBe(clips[0]);
		expect(clips[0].startTime).toBe(0);
	});

	it('inserts silence between clips when gap is large enough', () => {
		const clips = [mockClip(0, 500), mockClip(800, 1200)];
		const result = insertSilenceClips(clips, 200);
		expect(result).toHaveLength(3);
		expect(result[0]).toBe(clips[0]);
		expect(result[1]).toBeInstanceOf(SilenceClip);
		expect(result[1].startTime).toBe(501);
		expect(result[1].endTime).toBe(799);
		expect(result[2]).toBe(clips[1]);
	});

	it('does not insert silence when gap is small', () => {
		const clips = [mockClip(0, 500), mockClip(520, 1000)];
		const result = insertSilenceClips(clips, 200);
		expect(result).toHaveLength(2);
	});
});

// ---------------------------------------------------------------------------
// extendSubtitlesToFillGaps
// ---------------------------------------------------------------------------
describe('extendSubtitlesToFillGaps', () => {
	it('extends clip end to meet the next clip start minus 1ms', () => {
		const clips = [mockClip(0, 500), mockClip(800, 1200)];
		extendSubtitlesToFillGaps(asOptionalClips(clips));
		expect(clips[0].endTime).toBe(799);
	});

	it('does not change clips that are already contiguous', () => {
		const clips = [mockClip(0, 500), mockClip(501, 1000)];
		extendSubtitlesToFillGaps(asOptionalClips(clips));
		expect(clips[0].endTime).toBe(500);
	});

	it('does nothing for a single clip', () => {
		const clips = [mockClip(0, 500)];
		extendSubtitlesToFillGaps(asOptionalClips(clips));
		expect(clips[0].endTime).toBe(500);
	});
});
