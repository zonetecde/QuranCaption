import { describe, expect, it, vi } from 'vitest';
import {
	Category,
	Project,
	ProjectDetail,
	Style,
	StylesData,
	VideoStyle,
	type ProjectContent
} from '$lib/classes';
import { initializeClassRegistry } from '$lib/classes/ClassRegistry';
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
					new Style({ id: 'anti-collision', value: true, valueType: 'boolean' }),
					new Style({ id: 'show-speaker-name', value: true, valueType: 'boolean' })
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
		const categories = createContent()
			.videoStyle.getStylesOfTarget('translation')
			.toJSON().categories;
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ json: async () => categories }))
		);
		try {
			await content.videoStyle.addStylesForEdition('new-translation');
			for (const target of [
				'new-translation',
				'new-translation-quran',
				'new-translation-citation'
			]) {
				expect(content.videoStyle.getStylesOfTarget(target).findStyle('font-size')?.value).toBe(40);
				expect(content.videoStyle.getStylesOfTarget(target).findStyle('max-height')?.value).toBe(
					175
				);
			}
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe('new project speaker visibility', () => {
	it.each(['Unknown speaker', ''])('hides the default speaker name for %j', (speaker) => {
		const project = new Project(new ProjectDetail('Lecture', speaker), createContent());
		expect(
			project.content.videoStyle.getStylesOfTarget('global').findStyle('show-speaker-name')?.value
		).toBe(false);
	});

	it('keeps the default visibility for a named speaker', () => {
		const project = new Project(new ProjectDetail('Lecture', 'Shaykh Ahmad'), createContent());
		expect(
			project.content.videoStyle.getStylesOfTarget('global').findStyle('show-speaker-name')?.value
		).toBe(true);
	});

	it('preserves a saved visibility choice when reopening an unknown-speaker project', () => {
		initializeClassRegistry();
		const project = new Project(new ProjectDetail('Lecture', 'Unknown speaker'), createContent());
		project.content.videoStyle.getStylesOfTarget('global').findStyle('show-speaker-name')!.value =
			true;
		const restored = Project.fromJSON<Project>(project.toJSON());
		expect(
			restored.content.videoStyle.getStylesOfTarget('global').findStyle('show-speaker-name')?.value
		).toBe(true);
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
