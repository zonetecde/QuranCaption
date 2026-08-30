import { describe, expect, it } from 'vitest';

import type { Project } from '$lib/classes/Project';
import {
	getAutoSegmentationAudioClips,
	getAutoSegmentationAudioLaneCount
} from '$lib/services/autoSegmentation/audio';

describe('auto-segmentation audio lanes', () => {
	it('keeps only the clips from the selected non-overlapping audio lane', () => {
		const clips = [
			{ id: 1, assetId: 11, startTime: 0, endTime: 1_000, sourceStartTime: 0 },
			{ id: 2, assetId: 12, startTime: 500, endTime: 800, sourceStartTime: 25 },
			{ id: 3, assetId: 13, startTime: 1_001, endTime: 2_000, sourceStartTime: 50 }
		];
		const assets = new Map([
			[11, { filePath: 'C:\\audio\\main-1.mp3' }],
			[12, { filePath: 'C:\\audio\\effect.mp3' }],
			[13, { filePath: 'C:\\audio\\main-2.mp3' }]
		]);
		const project = {
			content: {
				timeline: { getFirstTrack: () => ({ clips }) },
				getAssetById: (assetId: number) => assets.get(assetId)
			}
		} as unknown as Project;

		expect(getAutoSegmentationAudioLaneCount(project)).toBe(2);
		expect(getAutoSegmentationAudioClips(project, 0).map((clip) => clip.fileName)).toEqual([
			'main-1.mp3',
			'main-2.mp3'
		]);
		expect(getAutoSegmentationAudioClips(project, 1)).toEqual([
			{
				filePath: 'C:\\audio\\effect.mp3',
				fileName: 'effect.mp3',
				startMs: 500,
				endMs: 800,
				sourceStartMs: 25
			}
		]);
	});
});
