import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PredefinedSubtitleClip, SubtitleClip } from '$lib/classes/Clip.svelte';
import { Category, Style, StylesData, VideoStyle } from '$lib/classes/VideoStyle.svelte';
import { globalState } from '$lib/runes/main.svelte';
import IndopakQuranProvider from '$lib/services/IndopakQuranProvider';
import MinimalQuranProvider from '$lib/services/MinimalQuranProvider';
import RiwayahProvider from '$lib/services/RiwayahProvider';

describe('arabic inline styles', () => {
	const originalCurrentProject = globalState.currentProject;

	beforeEach(() => {
		vi.spyOn(globalState, 'getStyle').mockImplementation((_target, styleId) => {
			switch (styleId) {
				case 'show-verse-number':
					return { value: false } as never;
				case 'font-family':
					return { value: 'Hafs' } as never;
				case 'riwayah':
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
		vi.spyOn(IndopakQuranProvider, 'getVerseWordsSlice').mockReturnValue(['indopak', 'text']);

		const clip = new SubtitleClip(0, 1_000, 102, 8, 0, 1, 'uthmani text', ['a', 'b'], false, true);

		expect(clip.getArabicRenderParts('preview')).toEqual({
			text: 'indopak text',
			words: ['indopak', 'text'],
			suffix: ' ٨',
			suffixFontFamily: 'Hafs'
		});
	});

	it('preserves Minimal Quran word groups in preview render parts', () => {
		vi.mocked(globalState.getStyle).mockImplementation((_target, styleId) => {
			switch (styleId) {
				case 'show-verse-number':
					return { value: false } as never;
				case 'font-family':
					return { value: 'Hafs' } as never;
				case 'mushaf-style':
					return { value: 'Minimal Quran' } as never;
				default:
					return { value: 0 } as never;
			}
		});
		vi.spyOn(MinimalQuranProvider, 'getVerseWordsSlice').mockReturnValue([
			'وَيَقولُ',
			'الكافِرُ',
			'يا لَيتَني',
			'كُنتُ',
			'تُرابًا'
		]);
		const clip = new SubtitleClip(
			0,
			1_000,
			78,
			40,
			10,
			14,
			'uthmani words remain available as fallback',
			[],
			false,
			true
		);

		expect(clip.getArabicRenderParts('preview')).toMatchObject({
			text: 'وَيَقولُ الكافِرُ يا لَيتَني كُنتُ تُرابًا',
			words: ['وَيَقولُ', 'الكافِرُ', 'يا لَيتَني', 'كُنتُ', 'تُرابًا']
		});
	});

	it('maps Warsh preview words and inline styles through their Hafs source indexes', () => {
		vi.mocked(globalState.getStyle).mockImplementation((_target, styleId) => {
			switch (styleId) {
				case 'show-verse-number':
					return { value: true } as never;
				case 'font-family':
					return { value: 'warsh10' } as never;
				case 'riwayah':
					return { value: 'Warsh' } as never;
				case 'mushaf-style':
					return { value: 'Uthmani' } as never;
				default:
					return { value: 0 } as never;
			}
		});
		vi.spyOn(RiwayahProvider, 'getVerseSlice').mockReturnValue({
			text: 'وَأَنْ يُّظْهِرَ',
			words: ['وَأَنْ', 'يُّظْهِرَ'],
			sourceWordIndexes: [[12, 13], [14]],
			suffix: ' ٢٦',
			targetAyahs: [26],
			relation: 'mapped'
		});
		const clip = new SubtitleClip(0, 1_000, 40, 26, 12, 14, 'أَوْ أَنْ يُظْهِرَ', [], false, true);
		clip.toggleArabicInlineStyles(1, 1, {
			bold: true,
			italic: false,
			underline: false,
			color: null
		});

		expect(clip.getArabicRenderParts('preview')).toMatchObject({
			words: ['وَأَنْ', 'يُّظْهِرَ'],
			sourceWordIndexes: [[12, 13], [14]],
			suffix: ' ٢٦',
			suffixFontFamily: 'warsh10'
		});
		expect(clip.getArabicInlineStyledSegments('preview')[0]).toMatchObject({
			text: 'وَأَنْ',
			bold: true
		});
	});

	it('maps preview text with the riwayah override of the current subtitle', () => {
		const clip = new SubtitleClip(0, 1_000, 40, 26, 12, 14, 'Hafs text', [], false, true);
		const arabicStyles = new StylesData('arabic', [
			new Category({
				id: 'general',
				styles: [new Style({ id: 'riwayah', value: 'Hafs', valueType: 'select' })]
			})
		]);
		arabicStyles.setStyleForClips([clip.id], 'riwayah', 'Warsh');
		const videoStyle = new VideoStyle();
		videoStyle.styles = [arabicStyles];
		globalState.currentProject = { content: { videoStyle } } as never;
		const getVerseSlice = vi.spyOn(RiwayahProvider, 'getVerseSlice').mockReturnValue({
			text: 'Warsh text',
			words: ['Warsh', 'text'],
			sourceWordIndexes: [[12], [13, 14]],
			suffix: '',
			targetAyahs: [26],
			relation: 'mapped'
		});
		const getTranslationVerseNumber = vi
			.spyOn(RiwayahProvider, 'getTranslationVerseNumber')
			.mockReturnValue('25-26');

		expect(clip.getArabicRenderParts('preview').text).toBe('Warsh text');
		expect(getVerseSlice).toHaveBeenCalledWith('Warsh', 40, 26, 12, 14, false);
		expect(clip.getTranslationVerseNumber('before')).toBe('25-26');
		expect(getTranslationVerseNumber).toHaveBeenCalledWith('Warsh', 40, 26, 'before');
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
		vi.spyOn(IndopakQuranProvider, 'getVerseWordsSlice').mockReturnValue(['indopak', 'one', 'two']);

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
			false
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

	it('keeps WBW timestamps and preserves global word positions when the subtitle start changes', () => {
		const clip = new SubtitleClip(1_000, 5_000, 102, 8, 0, 2, 'one two three', [], false, false);
		clip.alignmentMetadata = {
			source: 'local',
			segment: 0,
			refFrom: '102:8:1',
			refTo: '102:8:3',
			matchedText: clip.text,
			timeFrom: 1,
			timeTo: 5,
			words: [
				{ location: '102:8:1', start: 0, end: 0.5 },
				{ location: '102:8:2', start: 0.5, end: 2 },
				{ location: '102:8:3', start: 2, end: 4 }
			]
		};

		clip.setStartTime(500);

		expect(clip.alignmentMetadata).toMatchObject({
			timeFrom: 0.5,
			timeTo: 5,
			words: [
				{ location: '102:8:1', start: 0, end: 1 },
				{ location: '102:8:2', start: 1, end: 2.5 },
				{ location: '102:8:3', start: 2.5, end: 4.5 }
			]
		});
	});

	it('keeps WBW timestamps and pins the last word to the new subtitle end', () => {
		const clip = new SubtitleClip(1_000, 5_000, 102, 8, 0, 2, 'one two three', [], false, false);
		clip.alignmentMetadata = {
			source: 'local',
			segment: 0,
			refFrom: '102:8:1',
			refTo: '102:8:3',
			matchedText: clip.text,
			timeFrom: 1,
			timeTo: 5,
			words: [
				{ location: '102:8:1', start: 0, end: 0.5 },
				{ location: '102:8:2', start: 0.5, end: 2 },
				{ location: '102:8:3', start: 2, end: 4 }
			]
		};

		clip.setEndTime(6_000);

		expect(clip.alignmentMetadata).toMatchObject({
			timeFrom: 1,
			timeTo: 6,
			words: [
				{ location: '102:8:1', start: 0, end: 0.5 },
				{ location: '102:8:2', start: 0.5, end: 2 },
				{ location: '102:8:3', start: 2, end: 5 }
			]
		});
	});
});
