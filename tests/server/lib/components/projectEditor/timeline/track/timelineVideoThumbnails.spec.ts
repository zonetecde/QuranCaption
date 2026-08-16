import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauriMocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauriMocks.invoke }));

import {
	getVisibleTimelineVideoThumbnailSlots,
	loadTimelineVideoThumbnailPaths
} from '$lib/components/projectEditor/timeline/track/timelineVideoThumbnails';

describe('timeline video thumbnails', () => {
	beforeEach(() => {
		tauriMocks.invoke.mockReset();
	});

	it('only requests frames intersecting the current viewport of a long clip', () => {
		const slots = getVisibleTimelineVideoThumbnailSlots({
			clipStartMs: 0,
			clipEndMs: 3_600_000,
			sourceStartMs: 0,
			sourceDurationMs: 3_600_000,
			viewportStartMs: 1_800_000,
			viewportEndMs: 1_810_000,
			zoom: 100,
			loop: false
		});

		expect(slots).toHaveLength(5);
		expect(slots.every((slot) => slot.leftPx >= 180_000 && slot.leftPx < 181_000)).toBe(true);
		expect(slots.every((slot) => slot.timestampMs >= 1_800_000)).toBe(true);
	});

	it('maps timeline cells to the trimmed source range', () => {
		const [slot] = getVisibleTimelineVideoThumbnailSlots({
			clipStartMs: 10_000,
			clipEndMs: 20_000,
			sourceStartMs: 5_000,
			sourceDurationMs: 60_000,
			viewportStartMs: 10_000,
			viewportEndMs: 20_000,
			zoom: 20,
			loop: false
		});

		expect(slot.timestampMs).toBe(10_000);
		expect(slot.leftPx).toBe(0);
	});

	it('reuses the in-memory path cache for identical frames', async () => {
		tauriMocks.invoke.mockResolvedValue([{ timestampMs: 1_000, path: 'cache/1000.jpg' }]);

		const first = await loadTimelineVideoThumbnailPaths('video-cache-test.mp4', [1_000], 0);
		const second = await loadTimelineVideoThumbnailPaths('video-cache-test.mp4', [1_000], 0);

		expect(first.get(1_000)).toBe('cache/1000.jpg');
		expect(second.get(1_000)).toBe('cache/1000.jpg');
		expect(tauriMocks.invoke).toHaveBeenCalledTimes(1);
		expect(tauriMocks.invoke).toHaveBeenCalledWith('get_video_timeline_thumbnails', {
			filePath: 'video-cache-test.mp4',
			timestampsMs: [1_000],
			width: 160,
			height: 72
		});
	});
});
