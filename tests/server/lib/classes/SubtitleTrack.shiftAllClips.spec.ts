import { describe, expect, it, vi } from 'vitest';
import { SubtitleTrack } from '$lib/classes/Track.svelte';
import { SilenceClip, SubtitleClip } from '$lib/classes/Clip.svelte';

// `shiftAllClips` calls `globalState.updateVideoPreviewUI()` indirectly via
// reactive setters, but our reactive setters here just update plain $state
// properties. We mock toast so error/info paths don't blow up in Node.
vi.mock('svelte-5-french-toast', () => ({
	default: Object.assign(vi.fn(), {
		error: vi.fn(),
		success: vi.fn()
	})
}));

let nextSubtitleId = 1;

function makeSubtitle(start: number, end: number): SubtitleClip {
	// SubtitleClip has a heavy constructor. We bypass it to keep the test pure
	// and only set the timing fields the method actually reads.
	const clip = Object.create(SubtitleClip.prototype) as SubtitleClip;
	Object.assign(clip, {
		id: nextSubtitleId++,
		startTime: start,
		endTime: end,
		duration: end - start,
		type: 'Subtitle',
		showWaveform: false
	});
	return clip;
}

function makeSilence(start: number, end: number): SilenceClip {
	return new SilenceClip(start, end);
}

describe('SubtitleTrack.shiftAllClips', () => {
	it('with default fromMs=0, shifts every clip on the track', () => {
		const track = new SubtitleTrack();
		track.clips.push(makeSubtitle(1000, 2000), makeSubtitle(2000, 3000));

		const ok = track.shiftAllClips(500);

		expect(ok).toBe(true);
		expect(track.clips[0].startTime).toBe(1500);
		expect(track.clips[0].endTime).toBe(2500);
		expect(track.clips[1].startTime).toBe(2500);
		expect(track.clips[1].endTime).toBe(3500);
	});

	it('with fromMs=2000, shifts only clips whose startTime >= 2000', () => {
		const track = new SubtitleTrack();
		track.clips.push(
			makeSubtitle(0, 1000),
			makeSubtitle(1000, 2000),
			makeSubtitle(2000, 3000),
			makeSubtitle(3000, 4000)
		);

		const ok = track.shiftAllClips(500, 2000);

		expect(ok).toBe(true);
		// First two stay put.
		expect(track.clips[0].startTime).toBe(0);
		expect(track.clips[1].startTime).toBe(1000);
		// Last two shift by +500.
		expect(track.clips[2].startTime).toBe(2500);
		expect(track.clips[2].endTime).toBe(3500);
		expect(track.clips[3].startTime).toBe(3500);
		expect(track.clips[3].endTime).toBe(4500);
	});

	it('rejects shift that would push a targeted clip before 0ms', () => {
		const track = new SubtitleTrack();
		track.clips.push(makeSubtitle(0, 500), makeSubtitle(1000, 2000));

		const ok = track.shiftAllClips(-2000);

		expect(ok).toBe(false);
		// Nothing changed.
		expect(track.clips[0].startTime).toBe(0);
		expect(track.clips[1].startTime).toBe(1000);
	});

	it('trims the previous clip when a backward shift overlaps the non-shifted region', () => {
		const track = new SubtitleTrack();
		track.clips.push(
			makeSubtitle(0, 1000),
			makeSubtitle(1000, 2000), // ends at 2000
			makeSubtitle(2500, 3000) // starts at 2500, only this one is shifted
		);

		// fromMs=2500 → only the third clip is targeted.
		// Shift -1000 → would put it at [1500, 2000]; overlaps clip[1] which ends at 2000.
		const ok = track.shiftAllClips(-1000, 2500);

		expect(ok).toBe(true);
		expect(track.clips[1].endTime).toBe(1499);
		expect(track.clips[2].startTime).toBe(1500);
	});

	it('allows backward shift when there is enough gap before non-shifted clips', () => {
		const track = new SubtitleTrack();
		track.clips.push(
			makeSubtitle(0, 1000),
			makeSubtitle(5000, 6000) // big gap, only this one is shifted
		);

		const ok = track.shiftAllClips(-2000, 5000);

		expect(ok).toBe(true);
		expect(track.clips[0].startTime).toBe(0);
		expect(track.clips[1].startTime).toBe(3000);
		expect(track.clips[1].endTime).toBe(4000);
	});

	it('with fromMs greater than every startTime, is a no-op and returns true', () => {
		const track = new SubtitleTrack();
		track.clips.push(makeSubtitle(0, 1000), makeSubtitle(1000, 2000));

		const ok = track.shiftAllClips(500, 9_999_999);

		expect(ok).toBe(true);
		expect(track.clips[0].startTime).toBe(0);
		expect(track.clips[1].startTime).toBe(1000);
	});

	it('shifts mixed clip types (Subtitle + Silence) when they sit at or after fromMs', () => {
		const track = new SubtitleTrack();
		track.clips.push(makeSubtitle(0, 1000), makeSilence(1000, 1500), makeSubtitle(1500, 2500));

		const ok = track.shiftAllClips(200, 1000);

		expect(ok).toBe(true);
		expect(track.clips[0].startTime).toBe(0);
		expect(track.clips[1].startTime).toBe(1200);
		expect(track.clips[1].endTime).toBe(1700);
		expect(track.clips[2].startTime).toBe(1700);
		expect(track.clips[2].endTime).toBe(2700);
	});

	it('rejects non-finite timing inputs without mutating clip timings', () => {
		const track = new SubtitleTrack();
		track.clips.push(makeSubtitle(1000, 2000), makeSubtitle(2000, 3000));

		expect(track.shiftAllClips(Number.NaN)).toBe(false);
		expect(track.clips[0].startTime).toBe(1000);
		expect(track.clips[0].endTime).toBe(2000);

		expect(track.shiftAllClips(500, Number.POSITIVE_INFINITY)).toBe(false);
		expect(track.clips[1].startTime).toBe(2000);
		expect(track.clips[1].endTime).toBe(3000);
	});

	it('clamps negative fromMs to 0', () => {
		const track = new SubtitleTrack();
		track.clips.push(makeSubtitle(1000, 2000), makeSubtitle(2000, 3000));

		const ok = track.shiftAllClips(500, -1000);

		expect(ok).toBe(true);
		expect(track.clips[0].startTime).toBe(1500);
		expect(track.clips[1].startTime).toBe(2500);
	});
});
