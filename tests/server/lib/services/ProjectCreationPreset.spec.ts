import { describe, expect, it, vi } from 'vitest';
import { Category, Style, StylesData, VideoStyle } from '$lib/classes';
import type { ProjectContent } from '$lib/classes';
import { VideoStyleFactory } from '$lib/classes/videoStyles/VideoStyleFactory';
import {
	applyProjectCreationPreset,
	getProjectVideoDimensions
} from '$lib/services/ProjectService';

/** @returns {ProjectContent} Minimal project content used by the creation preset tests. */
function createContent(): ProjectContent {
	const videoStyle = new VideoStyle();
	videoStyle.styles = [
		new StylesData('global', [
			new Category({
				id: 'general',
				styles: [
					new Style({
						id: 'video-dimension',
						value: { width: 1920, height: 1080 },
						valueType: 'dimension'
					}),
					new Style({ id: 'anti-collision', value: true, valueType: 'boolean' })
				]
			})
		]),
		new StylesData('arabic', [
			new Category({
				id: 'text',
				styles: [
					new Style({ id: 'font-size', value: 90, valueType: 'number' }),
					new Style({ id: 'max-height', value: 0, valueType: 'number' }),
					new Style({ id: 'vertical-position', value: -110, valueType: 'number' }),
					new Style({ id: 'vertical-text-alignment', value: 'center', valueType: 'select' })
				]
			})
		]),
		new StylesData('translation', [
			new Category({
				id: 'text',
				styles: [
					new Style({ id: 'font-size', value: 60, valueType: 'number' }),
					new Style({ id: 'max-height', value: 0, valueType: 'number' }),
					new Style({ id: 'vertical-position', value: 70, valueType: 'number' }),
					new Style({ id: 'vertical-text-alignment', value: 'center', valueType: 'select' })
				]
			})
		])
	];
	return { videoStyle } as ProjectContent;
}

describe('applyProjectCreationPreset', () => {
	it('applies the requested landscape subtitle layout', () => {
		const content = createContent();

		applyProjectCreationPreset(content, { width: 2000, height: 1000 });

		expect(
			content.videoStyle.getStylesOfTarget('global').findStyle('video-dimension')?.value
		).toEqual({ width: 2000, height: 1000 });
		expect(content.videoStyle.getStylesOfTarget('arabic').findStyle('font-size')?.value).toBe(90);
		expect(
			content.videoStyle.getStylesOfTarget('arabic').findStyle('vertical-position')?.value
		).toBe(-70);
		expect(
			content.videoStyle.getStylesOfTarget('arabic').findStyle('vertical-text-alignment')?.value
		).toBe('bottom');
		expect(content.videoStyle.getStylesOfTarget('translation').findStyle('font-size')?.value).toBe(
			60
		);
		expect(content.videoStyle.getStylesOfTarget('translation').findStyle('max-height')?.value).toBe(
			265
		);
		expect(
			content.videoStyle.getStylesOfTarget('translation').findStyle('vertical-position')?.value
		).toBe(175);
		expect(
			content.videoStyle.getStylesOfTarget('translation').findStyle('vertical-text-alignment')
				?.value
		).toBe('top');
		expect(content.videoStyle.getStylesOfTarget('global').findStyle('anti-collision')?.value).toBe(
			false
		);
	});

	it('applies the requested portrait subtitle layout', () => {
		const content = createContent();

		applyProjectCreationPreset(content, { width: 1000, height: 1600 });

		expect(
			content.videoStyle.getStylesOfTarget('global').findStyle('video-dimension')?.value
		).toEqual({ width: 1000, height: 1600 });
		expect(content.videoStyle.getStylesOfTarget('arabic').findStyle('font-size')?.value).toBe(60);
		expect(content.videoStyle.getStylesOfTarget('arabic').findStyle('max-height')?.value).toBe(145);
		expect(
			content.videoStyle.getStylesOfTarget('arabic').findStyle('vertical-position')?.value
		).toBe(-70);
		expect(
			content.videoStyle.getStylesOfTarget('arabic').findStyle('vertical-text-alignment')?.value
		).toBe('bottom');
		expect(content.videoStyle.getStylesOfTarget('translation').findStyle('font-size')?.value).toBe(
			40
		);
		expect(content.videoStyle.getStylesOfTarget('translation').findStyle('max-height')?.value).toBe(
			175
		);
		expect(
			content.videoStyle.getStylesOfTarget('translation').findStyle('vertical-position')?.value
		).toBe(100);
		expect(
			content.videoStyle.getStylesOfTarget('translation').findStyle('vertical-text-alignment')
				?.value
		).toBe('top');
		expect(content.videoStyle.getStylesOfTarget('global').findStyle('anti-collision')?.value).toBe(
			false
		);
	});

	it('uses the portrait defaults for translations added later', async () => {
		const content = createContent();
		content.videoStyle.styles = content.videoStyle.styles.filter(
			(styles) => styles.target !== 'translation'
		);
		content.videoStyle.getStylesOfTarget('global').findStyle('video-dimension')!.value = {
			width: 1080,
			height: 1920
		};
		const createTranslationStyles = vi
			.spyOn(VideoStyleFactory, 'createTranslationStyles')
			.mockResolvedValue(new StylesData('new-translation'));

		await content.videoStyle.addStylesForEdition('new-translation');

		expect(createTranslationStyles).toHaveBeenCalledWith('new-translation', true);
	});
});

describe('getProjectVideoDimensions', () => {
	it.each([
		['landscape', '720p', { width: 1280, height: 720 }],
		['portrait', '1080p', { width: 1080, height: 1920 }],
		['square', '1440p', { width: 1440, height: 1440 }],
		['landscape', '2160p', { width: 3840, height: 2160 }]
	] as const)('returns the %s dimensions for %s', (format, quality, expected) => {
		expect(getProjectVideoDimensions(format, quality)).toEqual(expected);
	});
});
