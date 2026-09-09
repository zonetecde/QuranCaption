import { describe, expect, it } from 'vitest';
import {
	DEFAULT_SUBTITLE_LENGTH_PRESET,
	getMatchingSubtitleLengthPreset,
	isSubtitleLengthPreset,
	SUBTITLE_LENGTH_PRESETS
} from '$lib/constants/subtitleLengthPresets';

describe('subtitle length presets', () => {
	it('uses the balanced profile as the default', () => {
		expect(DEFAULT_SUBTITLE_LENGTH_PRESET).toBe('balanced');
		expect(SUBTITLE_LENGTH_PRESETS.balanced).toMatchObject({
			maxWords: 12,
			maxChars: 80,
			silenceSeconds: 1.2
		});
	});

	it('keeps the profiles ordered from compact to relaxed', () => {
		expect(SUBTITLE_LENGTH_PRESETS.compact.maxWords).toBeLessThan(
			SUBTITLE_LENGTH_PRESETS.balanced.maxWords
		);
		expect(SUBTITLE_LENGTH_PRESETS.balanced.maxWords).toBeLessThan(
			SUBTITLE_LENGTH_PRESETS.relaxed.maxWords
		);
		expect(SUBTITLE_LENGTH_PRESETS.relaxed.maxChars).toBe(84);
		expect(SUBTITLE_LENGTH_PRESETS.compact.silenceSeconds).toBeLessThan(
			SUBTITLE_LENGTH_PRESETS.relaxed.silenceSeconds
		);
	});

	it('recognizes matching values and custom overrides', () => {
		expect(
			getMatchingSubtitleLengthPreset({
				maxWords: 12,
				maxChars: 80,
				silenceSeconds: 1.2
			})
		).toBe('balanced');
		expect(
			getMatchingSubtitleLengthPreset({
				maxWords: 13,
				maxChars: 80,
				silenceSeconds: 1.2
			})
		).toBe('custom');
	});

	it('rejects unknown persisted profile values', () => {
		expect(isSubtitleLengthPreset('compact')).toBe(true);
		expect(isSubtitleLengthPreset('custom')).toBe(true);
		expect(isSubtitleLengthPreset('legacy')).toBe(false);
		expect(isSubtitleLengthPreset(null)).toBe(false);
	});
});
