import { describe, expect, it } from 'vitest';

import { TrackType } from '$lib/classes';
import { globalState } from '$lib/runes/main.svelte';
import {
	getTimelineCustomClipLayout,
	getSnappedTimelineCustomClipTime,
	type TimelineCustomClipLike
} from '$lib/components/projectEditor/timeline/track/timelineCustomClip';

describe('getTimelineCustomClipLayout', () => {
	it('reuses lanes for non-overlapping clips and creates lanes only for overlaps', () => {
		const first = {
			id: 'first',
			startTime: 0,
			endTime: 1_000,
			getAlwaysShow: () => false
		} as unknown as TimelineCustomClipLike;
		const overlapping = {
			id: 'overlapping',
			startTime: 500,
			endTime: 1_500,
			getAlwaysShow: () => false
		} as unknown as TimelineCustomClipLike;
		const next = {
			id: 'next',
			startTime: 1_001,
			endTime: 2_000,
			getAlwaysShow: () => false
		} as unknown as TimelineCustomClipLike;

		const layout = getTimelineCustomClipLayout([next, overlapping, first]);
		const laneById = new Map(layout.clips.map(({ clip, laneIndex }) => [clip.id, laneIndex]));

		expect(layout.laneCount).toBe(2);
		expect(laneById.get('first')).toBe(0);
		expect(laneById.get('next')).toBe(0);
		expect(laneById.get('overlapping')).toBe(1);
	});

	it('keeps always-show clips on their own full-duration lane', () => {
		const alwaysShow = {
			id: 'always-show',
			startTime: 0,
			endTime: 1_000,
			getAlwaysShow: () => true
		} as unknown as TimelineCustomClipLike;
		const timed = {
			id: 'timed',
			startTime: 2_000,
			endTime: 3_000,
			getAlwaysShow: () => false
		} as unknown as TimelineCustomClipLike;

		const layout = getTimelineCustomClipLayout([alwaysShow, timed]);

		expect(layout.laneCount).toBe(2);
	});

	it('snaps a moved clip end to another custom clip start', () => {
		const otherClip = {
			id: 'other',
			startTime: 2_000,
			endTime: 3_000,
			getAlwaysShow: () => false,
			getTimedOverlayRanges: () => []
		} as unknown as TimelineCustomClipLike;
		const customTrack = { clips: [otherClip] };
		const subtitleTrack = { clips: [] };
		const videoStyle = {
			styles: [],
			getStylesOfTarget: () => ({
				categories: [],
				findStyle: () => undefined
			})
		};
		const originalProject = globalState.currentProject;

		globalState.currentProject = {
			detail: { reciter: 'not set' },
			content: {
				videoStyle,
				timeline: {
					getFirstTrack: (trackType: TrackType) =>
						trackType === TrackType.CustomClip ? customTrack : subtitleTrack
				}
			},
			projectEditorState: { timeline: { zoom: 1_000 } }
		} as never;

		try {
			expect(getSnappedTimelineCustomClipTime(995, 'current', 1_000)).toBe(1_000);
		} finally {
			globalState.currentProject = originalProject;
		}
	});
});
