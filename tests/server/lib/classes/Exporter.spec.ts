import { describe, expect, it } from 'vitest';

import {
	getRandomBackgroundCandidates,
	selectRandomBackgroundCandidate,
	createRandomBackgroundClip
} from '$lib/classes/Exporter';
import { AssetType } from '$lib/classes';

describe('Random export backgrounds', () => {
	it('filters compatible files without entering subdirectories', () => {
		const entries = [
			{ name: 'image.PNG', isFile: true, isDirectory: false },
			{ name: 'clip.webm', isFile: true, isDirectory: false },
			{ name: 'audio.mp3', isFile: true, isDirectory: false },
			{ name: 'nested', isFile: false, isDirectory: true }
		];

		expect(getRandomBackgroundCandidates(entries)).toEqual(['image.PNG', 'clip.webm']);
	});

	it('selects a candidate from a normalized random value', () => {
		const entries = [
			{ name: 'first.jpg', isFile: true, isDirectory: false },
			{ name: 'second.mp4', isFile: true, isDirectory: false }
		];

		expect(selectRandomBackgroundCandidate(entries, 0)).toBe('first.jpg');
		expect(selectRandomBackgroundCandidate(entries, 0.99)).toBe('second.mp4');
	});

	it('creates a static image clip and a looping video clip', () => {
		expect(createRandomBackgroundClip(7, AssetType.Image, 5000)).toMatchObject({
			assetId: 7,
			startTime: 0,
			endTime: 0,
			loopUntilAudioEnd: false
		});
		expect(createRandomBackgroundClip(8, AssetType.Video, 5000)).toMatchObject({
			assetId: 8,
			startTime: 0,
			endTime: 5000,
			loopUntilAudioEnd: true
		});
	});
});
