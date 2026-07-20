import { describe, expect, it } from 'vitest';

import type { SubtitleClip } from '$lib/classes/Clip.svelte';
import {
	getDisabledWordByWordHighlightState,
	getWordByWordHighlightState,
	getWordByWordLineBackgroundClass,
	getWordByWordWordCss
} from '$lib/components/projectEditor/videoPreview/wordByWordHighlightUtils';

const words = [
	{ location: '1:1:1', start: 0, end: 1 },
	{ location: '1:1:2', start: 1, end: 2 },
	{ location: '1:1:3', start: 2, end: 3 }
];

describe('WBW line background', () => {
	it('inherits the global bar geometry when the global line background is enabled', () => {
		const values: Record<string, string | number | boolean> = {
			'enable-wbw-line-background': true,
			'wbw-line-background-color': '#ff0000',
			'wbw-line-background-position': -12,
			'wbw-line-background-height': 24,
			'wbw-line-background-padding': 12,
			'line-background-enable': true,
			'line-background-position': 18,
			'line-background-height': 60
		};
		const state = getWordByWordHighlightState({
			subtitle: {} as SubtitleClip,
			isArabicMerged: false,
			mushafStyle: 'Uthmani',
			cursorTimeS: 0.5,
			words,
			clipStartTimeS: 0,
			getStyleValue: (styleId) => values[styleId] ?? false
		});

		expect(state.lineBackgroundPosition).toBe(18);
		expect(state.lineBackgroundHeight).toBe(60);
		expect(state.lineBackgroundPadding).toBe(12);
		expect(getWordByWordWordCss(0, state, 1, 0)).toContain(
			'--wbw-line-background-color: rgba(255, 0, 0, 1);'
		);
		expect(getWordByWordWordCss(0, state, 1, 0)).toContain('--wbw-line-background-padding: 12px;');
	});

	it('uses the WBW geometry when the global line background is disabled', () => {
		const values: Record<string, string | number | boolean> = {
			'enable-wbw-line-background': true,
			'wbw-line-background-color': '#ff0000',
			'wbw-line-background-position': -12,
			'wbw-line-background-height': 24,
			'line-background-enable': false,
			'line-background-position': 18,
			'line-background-height': 60
		};
		const state = getWordByWordHighlightState({
			subtitle: {} as SubtitleClip,
			isArabicMerged: false,
			mushafStyle: 'Uthmani',
			cursorTimeS: 0.5,
			words,
			clipStartTimeS: 0,
			getStyleValue: (styleId) => values[styleId] ?? false
		});

		expect(state.lineBackgroundPosition).toBe(-12);
		expect(state.lineBackgroundHeight).toBe(24);
	});

	it('rounds only the outer ends of a persistent highlighted sequence', () => {
		const state = {
			...getDisabledWordByWordHighlightState(),
			enabled: true,
			lineBackgroundEnabled: true,
			lineBackgroundColor: '#ff0000',
			persistColor: true,
			activeWordIndex: 2,
			cursorTimeS: 2.5,
			words
		};

		expect(getWordByWordLineBackgroundClass(0, state, 1, 0)).toContain('wbw-line-background-start');
		expect(getWordByWordLineBackgroundClass(1, state, 1, 0)).toBe('wbw-line-background');
		expect(getWordByWordLineBackgroundClass(2, state, 1, 0)).toContain('wbw-line-background-end');
	});

	it('keeps a non-persistent current word as a single capsule', () => {
		const state = {
			...getDisabledWordByWordHighlightState(),
			enabled: true,
			lineBackgroundEnabled: true,
			lineBackgroundColor: '#ff0000',
			activeWordIndex: 1,
			cursorTimeS: 1.5,
			words
		};

		expect(getWordByWordLineBackgroundClass(1, state, 1, 0)).toContain(
			'wbw-line-background-single'
		);
		expect(getWordByWordLineBackgroundClass(0, state, 0, 0)).toBe('');
	});

	it('keeps the previous rounded end until the next persistent highlight is fully visible', () => {
		const state = {
			...getDisabledWordByWordHighlightState(),
			enabled: true,
			lineBackgroundEnabled: true,
			lineBackgroundColor: '#ff0000',
			persistColor: true,
			activeWordIndex: 2,
			cursorTimeS: 2.05,
			words
		};

		expect(getWordByWordLineBackgroundClass(1, state, 1, 200)).toContain('wbw-line-background-end');

		state.cursorTimeS = 2.2;
		expect(getWordByWordLineBackgroundClass(1, state, 1, 200)).toBe('wbw-line-background');
	});
});
