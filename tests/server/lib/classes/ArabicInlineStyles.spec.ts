import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PredefinedSubtitleClip, SubtitleClip } from '$lib/classes/Clip.svelte';
import { globalState } from '$lib/runes/main.svelte';

describe('arabic inline styles', () => {
	const originalCurrentProject = globalState.currentProject;

	beforeEach(() => {
		vi.spyOn(globalState, 'getStyle').mockImplementation((_target, styleId) => {
			switch (styleId) {
				case 'show-verse-number':
					return { value: false } as never;
				case 'font-family':
					return { value: 'Hafs' } as never;
				case 'mushaf-style':
					return { value: 'Uthmani' } as never;
				default:
					return { value: 0 } as never;
			}
		});
	});

	afterEach(() => {
		globalState.currentProject = originalCurrentProject;
		vi.restoreAllMocks();
	});

	it('stores bold runs on predefined subtitles', () => {
		const clip = new PredefinedSubtitleClip(0, 1_000, 'Other', 'alpha beta gamma');

		clip.toggleArabicInlineStyles(1, 2, {
			bold: true,
			italic: false,
			underline: false,
			color: null
		});

		expect(clip.arabicInlineStyleRuns).toEqual([
			{
				startWordIndex: 1,
				endWordIndex: 2,
				bold: true,
				italic: false,
				underline: false,
				color: null
			}
		]);
	});

	it('toggles a color off on predefined subtitles when the same swatch is applied twice', () => {
		const clip = new PredefinedSubtitleClip(0, 1_000, 'Other', 'alpha beta');

		clip.toggleArabicInlineStyles(0, 0, {
			bold: false,
			italic: false,
			underline: false,
			color: '#f59e0b'
		});
		clip.toggleArabicInlineStyles(0, 0, {
			bold: false,
			italic: false,
			underline: false,
			color: '#f59e0b'
		});

		expect(clip.arabicInlineStyleRuns).toEqual([]);
	});

	it('preserves whitespace when building styled segments for predefined subtitles', () => {
		const clip = new PredefinedSubtitleClip(0, 1_000, 'Other', 'alpha beta gamma');
		clip.toggleArabicInlineStyles(1, 1, {
			bold: false,
			italic: true,
			underline: true,
			color: null
		});

		expect(clip.getArabicInlineStyledSegments()).toEqual([
			{
				text: 'alpha ',
				bold: false,
				italic: false,
				underline: false,
				color: null
			},
			{
				text: 'beta',
				bold: false,
				italic: true,
				underline: true,
				color: null
			},
			{
				text: ' gamma',
				bold: false,
				italic: false,
				underline: false,
				color: null
			}
		]);
	});

	it('returns editor render parts with the verse number outside the stylable arabic text', () => {
		vi.mocked(globalState.getStyle).mockImplementation((_target, styleId) => {
			switch (styleId) {
				case 'show-verse-number':
					return { value: true } as never;
				case 'font-family':
					return { value: 'Hafs' } as never;
				case 'mushaf-style':
					return { value: 'Uthmani' } as never;
				default:
					return { value: 0 } as never;
			}
		});

		const clip = new SubtitleClip(0, 1_000, 102, 8, 0, 1, 'foo bar', ['a', 'b'], false, true);

		expect(clip.getArabicRenderParts('editor')).toEqual({
			text: 'foo bar',
			suffix: ' ٨',
			suffixFontFamily: null
		});
	});

	it('uses the indopak segment text and Hafs suffix font in preview mode', () => {
		vi.mocked(globalState.getStyle).mockImplementation((_target, styleId) => {
			switch (styleId) {
				case 'show-verse-number':
					return { value: true } as never;
				case 'font-family':
					return { value: 'SomeCustomArabicFont' } as never;
				case 'mushaf-style':
					return { value: 'Indopak' } as never;
				default:
					return { value: 0 } as never;
			}
		});

		const clip = new SubtitleClip(
			0,
			1_000,
			102,
			8,
			0,
			1,
			'uthmani text',
			['a', 'b'],
			false,
			true,
			{},
			'indopak text'
		);

		expect(clip.getArabicRenderParts('preview')).toEqual({
			text: 'indopak text',
			suffix: ' ٨',
			suffixFontFamily: 'Hafs'
		});
	});

	it('builds preview styled segments from the rendered arabic text', () => {
		vi.mocked(globalState.getStyle).mockImplementation((_target, styleId) => {
			switch (styleId) {
				case 'show-verse-number':
					return { value: false } as never;
				case 'font-family':
					return { value: 'SomeCustomArabicFont' } as never;
				case 'mushaf-style':
					return { value: 'Indopak' } as never;
				default:
					return { value: 0 } as never;
			}
		});

		const clip = new SubtitleClip(
			0,
			1_000,
			102,
			8,
			0,
			1,
			'uthmani one two',
			['a', 'b'],
			false,
			false,
			{},
			'indopak one two'
		);

		clip.toggleArabicInlineStyles(0, 0, {
			bold: true,
			italic: false,
			underline: false,
			color: null
		});

		expect(clip.getArabicInlineStyledSegments('preview')).toEqual([
			{
				text: 'indopak',
				bold: true,
				italic: false,
				underline: false,
				color: null
			},
			{
				text: ' one two',
				bold: false,
				italic: false,
				underline: false,
				color: null
			}
		]);
	});
});
