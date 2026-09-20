import { describe, expect, it } from 'vitest';

import { AssetClip, Clip, SilenceClip, SubtitleClip } from '$lib/classes/Clip.svelte';
import { TrackType } from '$lib/classes/enums';
import { splitTranscriptTextAtWordBoundary, SubtitleTrack, Track } from '$lib/classes/Track.svelte';

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
		`Verse ${verse}`,
		'Unknown speaker',
		{},
		true,
		null
	);
	clip.id = nextClipId++;
	return clip;
}

describe('Track lookup helpers', () => {
	it('preserves Quran markers when splitting aligned transcript text', async () => {
		expect(await splitTranscriptTextAtWordBoundary('{{2:153:2-4}}', 1, 3)).toEqual([
			'{{2:153:2-2}}',
			'{{2:153:3-4}}'
		]);
	});

	it('splits a full Quran marker into explicit ranges', async () => {
		expect(await splitTranscriptTextAtWordBoundary('{{2:153}}', 2, 5)).toEqual([
			'{{2:153:1-2}}',
			'{{2:153:3-5}}'
		]);
	});

	it('preserves the source offset of trimmed asset clips', () => {
		const clip = new AssetClip(500, 1500, 42);
		clip.sourceStartTime = 750;

		const restored = AssetClip.fromJSON(clip.toJSON()) as AssetClip;

		expect(restored.sourceStartTime).toBe(750);
		expect(restored.duration).toBe(1000);
	});

	it('defaults old asset clips to the start of their source', () => {
		const clip = new AssetClip(0, 1000, 42);
		const serialized = clip.toJSON();
		delete serialized.sourceStartTime;

		const restored = AssetClip.fromJSON(serialized) as AssetClip;

		expect(restored.sourceStartTime).toBe(0);
	});

	it('preserves individual asset clip volume and defaults legacy clips to 100%', () => {
		const clip = new AssetClip(0, 1000, 42);
		clip.volumePercent = 35;

		const restored = AssetClip.fromJSON(clip.toJSON()) as AssetClip;
		const legacyData = clip.toJSON();
		delete legacyData.volumePercent;
		const legacy = AssetClip.fromJSON(legacyData) as AssetClip;

		expect(restored.volumePercent).toBe(35);
		expect(legacy.volumePercent).toBe(100);
	});

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

	it('returns every active audio clip when sub-tracks overlap', () => {
		const main = createClip(0, 2_000);
		const effect = createClip(500, 1_000);
		const track = new Track(TrackType.Audio);
		track.clips = [main, effect];

		expect(track.getCurrentClip(750)).toBe(main);
		expect(track.getCurrentClips(750)).toEqual([main, effect]);
		expect(track.getCurrentClip(1_500)).toBe(main);
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
