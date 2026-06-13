import { describe, expect, it } from 'vitest';

import { Clip, SilenceClip, SubtitleClip } from '$lib/classes/Clip.svelte';
import { TrackType } from '$lib/classes/enums';
import { SubtitleTrack, Track } from '$lib/classes/Track.svelte';

let nextClipId = 1;

/**
 * Creates a minimal generic clip with deterministic IDs for lookup tests.
 *
 * @param {number} startTime Clip start time in milliseconds.
 * @param {number} endTime Clip end time in milliseconds.
 * @returns {Clip} Created clip.
 */
function createClip(startTime: number, endTime: number): Clip {
	const clip = new Clip(startTime, endTime, 'Asset');
	clip.id = nextClipId++;
	return clip;
}

/**
 * Creates a minimal Quran subtitle with deterministic IDs.
 *
 * @param {number} startTime Clip start time in milliseconds.
 * @param {number} endTime Clip end time in milliseconds.
 * @param {number} verse Verse number.
 * @returns {SubtitleClip} Created subtitle clip.
 */
function createSubtitle(startTime: number, endTime: number, verse: number): SubtitleClip {
	const clip = new SubtitleClip(
		startTime,
		endTime,
		1,
		verse,
		0,
		0,
		`Verse ${verse}`,
		[],
		true,
		true
	);
	clip.id = nextClipId++;
	return clip;
}

describe('Track lookup helpers', () => {
	it('finds the current clip at inclusive start and end boundaries', () => {
		const first = createClip(0, 1000);
		const second = createClip(1500, 2000);
		const track = new Track(TrackType.Video);
		track.clips = [first, second];

		expect(track.getCurrentClip(0)).toBe(first);
		expect(track.getCurrentClip(1000)).toBe(first);
		expect(track.getCurrentClip(1001)).toBeNull();
		expect(track.getCurrentClip(1499)).toBeNull();
		expect(track.getCurrentClip(1500)).toBe(second);
	});

	it('keeps zero-duration image clips addressable at their exact time', () => {
		const imageClip = createClip(5000, 5000);
		const track = new Track(TrackType.Video);
		track.clips = [imageClip];

		expect(track.getCurrentClip(4999)).toBeNull();
		expect(track.getCurrentClip(5000)).toBe(imageClip);
		expect(track.getCurrentClip(5001)).toBeNull();
	});

	it('extracts clips that overlap a visible range with their indexes', () => {
		const first = createClip(0, 999);
		const second = createClip(1000, 1999);
		const third = createClip(3000, 3999);
		const track = new Track(TrackType.Video);
		track.clips = [first, second, third];

		expect(track.getClipsInRange(1500, 3200)).toEqual([
			{ clip: second, clipIndex: 1 },
			{ clip: third, clipIndex: 2 }
		]);
	});

	it('falls back to linear time lookup when clips are not sorted', () => {
		const lateClip = createClip(3000, 3999);
		const earlyClip = createClip(0, 999);
		const track = new Track(TrackType.Video);
		track.clips = [lateClip, earlyClip];

		expect(track.getCurrentClip(500)).toBe(earlyClip);
	});

	it('builds visual merge groups by walking adjacent clips only', () => {
		const first = createSubtitle(0, 999, 1);
		const second = createSubtitle(1000, 1999, 2);
		const third = createSubtitle(2000, 2999, 3);
		first.setVisualMerge('group-a', 'both');
		second.setVisualMerge('group-a', 'both');

		const track = new SubtitleTrack();
		track.clips = [first, second, third];

		expect(track.getVisualMergeGroupForClipId(second.id)).toMatchObject({
			groupId: 'group-a',
			mode: 'both',
			clips: [first, second],
			firstClip: first,
			lastClip: second,
			startTime: 0,
			endTime: 1999
		});
	});

	it('rejects visual merge groups that are no longer contiguous', () => {
		const first = createSubtitle(0, 999, 1);
		const silence = new SilenceClip(1000, 1499);
		const second = createSubtitle(1500, 2499, 2);
		first.setVisualMerge('group-b', 'arabic');
		second.setVisualMerge('group-b', 'arabic');

		const track = new SubtitleTrack();
		track.clips = [first, silence, second];

		expect(track.getVisualMergeGroupForClipId(first.id)).toBeNull();
		expect(track.getVisualMergeGroupForClipId(second.id)).toBeNull();
	});
});
