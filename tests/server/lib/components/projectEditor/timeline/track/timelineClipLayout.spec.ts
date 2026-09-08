import { describe, expect, it } from 'vitest';

import { getTimelineClipLayout } from '$lib/components/projectEditor/timeline/track/timelineClipLayout';

describe('getTimelineClipLayout', () => {
	it('reuses lanes for non-overlapping clips and creates lanes for overlaps', () => {
		const clips = [
			{ id: 'first', startTime: 0, endTime: 1_000 },
			{ id: 'overlapping', startTime: 500, endTime: 1_500 },
			{ id: 'next', startTime: 1_001, endTime: 2_000 }
		];

		const layout = getTimelineClipLayout(
			clips,
			(clip) => clip.startTime,
			(clip) => clip.endTime
		);
		const laneById = new Map(layout.clips.map(({ clip, laneIndex }) => [clip.id, laneIndex]));

		expect(layout.laneCount).toBe(2);
		expect(laneById.get('first')).toBe(0);
		expect(laneById.get('next')).toBe(0);
		expect(laneById.get('overlapping')).toBe(1);
	});
});
