import { describe, expect, it } from 'vitest';
import { getDroppedJsonPath } from '$lib/components/projectEditor/tabs/subtitlesEditor/drop';

describe('getDroppedJsonPath', () => {
	it('returns the first JSON path case-insensitively', () => {
		expect(getDroppedJsonPath(['audio.mp3', 'segments.JSON', 'other.json'])).toBe('segments.JSON');
	});

	it('returns null when no JSON path is dropped', () => {
		expect(getDroppedJsonPath(['audio.mp3', 'video.mp4'])).toBeNull();
	});

	it('returns null while the import modal handles the drop', () => {
		expect(getDroppedJsonPath(['segments.json'], true)).toBeNull();
	});
});
