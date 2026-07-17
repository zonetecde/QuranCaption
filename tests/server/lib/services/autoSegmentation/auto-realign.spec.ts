import { describe, expect, it } from 'vitest';

import { computeRealignWindow } from '$lib/services/AutoSegmentation';
import type { SubtitleClip } from '$lib/classes';

/**
 * Construit un clip minimal pour tester le calcul de fenêtre (seuls les champs lus comptent).
 *
 * @param {object} fields Champs de timing du clip.
 * @returns {SubtitleClip} Pseudo-clip typé pour le test.
 */
function makeClip(fields: {
	startTime: number;
	endTime: number;
	timeFrom?: number;
	timeTo?: number;
}): SubtitleClip {
	const alignmentMetadata =
		fields.timeFrom !== undefined && fields.timeTo !== undefined
			? { timeFrom: fields.timeFrom, timeTo: fields.timeTo, words: [] }
			: null;
	return {
		startTime: fields.startTime,
		endTime: fields.endTime,
		alignmentMetadata
	} as unknown as SubtitleClip;
}

describe('computeRealignWindow', () => {
	it('uses current clip boundaries when older alignment metadata is present', () => {
		const clip = makeClip({ startTime: 9999, endTime: 99999, timeFrom: 5.2, timeTo: 8.5 });
		expect(computeRealignWindow([clip])).toEqual({ startMs: 9999, endMs: 99999 });
	});

	it('uses clip start/end time (ms) when no alignment metadata exists', () => {
		const clip = makeClip({ startTime: 4200, endTime: 7700 });
		expect(computeRealignWindow([clip])).toEqual({ startMs: 4200, endMs: 7700 });
	});

	it('spans the min start and max end across consecutive clips', () => {
		const clips = [
			makeClip({ startTime: 5000, endTime: 8000, timeFrom: 5, timeTo: 8 }),
			makeClip({ startTime: 8001, endTime: 12400, timeFrom: 8, timeTo: 12.4 })
		];
		expect(computeRealignWindow(clips)).toEqual({ startMs: 5000, endMs: 12400 });
	});

	it('does not use stale metadata as a fallback', () => {
		const clip = makeClip({ startTime: 1235, endTime: 2679, timeFrom: 1.2345, timeTo: 2.6789 });
		expect(computeRealignWindow([clip])).toEqual({ startMs: 1235, endMs: 2679 });
	});

	it('ignores metadata across all clips in the realignment group', () => {
		const clips = [
			makeClip({ startTime: 3000, endTime: 6000 }),
			makeClip({ startTime: 6001, endTime: 9000, timeFrom: 6.0, timeTo: 9.0 })
		];
		expect(computeRealignWindow(clips)).toEqual({ startMs: 3000, endMs: 9000 });
	});
});
