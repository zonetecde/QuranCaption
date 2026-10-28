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
					new Style({ id: 'overlay-opacity', value: 0.65, valueType: 'number' }),
					new Style({ id: 'background-overlay-mode', value: 'uniform', valueType: 'select' }),
					new Style({ id: 'background-overlay-fade-coverage', value: 0.75, valueType: 'number' }),
					new Style({ id: 'background-overlay-fade-softness', value: 1, valueType: 'number' }),
					new Style({ id: 'show-speaker-name', value: true, valueType: 'boolean' })
				]
			})
		]),
		new StylesData('arabic', [
			new Category({
				id: 'text',
				styles: [
					new Style({ id: 'font-size', value: 90, valueType: 'number' }),
					new Style({ id: 'outline-enable', value: false, valueType: 'boolean' }),
					new Style({ id: 'text-outline', value: 0.25, valueType: 'number' }),
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
					new Style({ id: 'outline-enable', value: false, valueType: 'boolean' }),
					new Style({ id: 'text-outline', value: 0.25, valueType: 'number' }),
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
		).toBe(231);
		expect(
			content.videoStyle.getStylesOfTarget('arabic').findStyle('vertical-text-alignment')?.value
		).toBe('bottom');
		expect(content.videoStyle.getStylesOfTarget('translation').findStyle('font-size')?.value).toBe(
			60
		);
		expect(content.videoStyle.getStylesOfTarget('translation').findStyle('max-height')?.value).toBe(
			179
		);
		expect(
			content.videoStyle.getStylesOfTarget('translation').findStyle('vertical-position')?.value
		).toBe(413);
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
		expect(content.videoStyle.getStylesOfTarget('arabic').findStyle('font-size')?.value).toBe(90);
		expect(content.videoStyle.getStylesOfTarget('arabic').findStyle('max-height')?.value).toBe(176);
		expect(
			content.videoStyle.getStylesOfTarget('arabic').findStyle('vertical-position')?.value
		).toBe(231);
		expect(
			content.videoStyle.getStylesOfTarget('arabic').findStyle('vertical-text-alignment')?.value
		).toBe('bottom');
		expect(content.videoStyle.getStylesOfTarget('translation').findStyle('font-size')?.value).toBe(
			60
		);
		expect(content.videoStyle.getStylesOfTarget('translation').findStyle('max-height')?.value).toBe(
			179
		);
		expect(
			content.videoStyle.getStylesOfTarget('translation').findStyle('vertical-position')?.value
		).toBe(413);
		expect(
			content.videoStyle.getStylesOfTarget('translation').findStyle('vertical-text-alignment')
				?.value
		).toBe('top');
		expect(content.videoStyle.getStylesOfTarget('global').findStyle('anti-collision')?.value).toBe(
			false
		);
	});

	it('enables the reference outline and bottom fade without changing unrelated styles', () => {
		const content = createContent();
		applyProjectCreationPreset(content, { width: 1920, height: 1080 });
		for (const target of ['arabic', 'translation']) {
			const styles = content.videoStyle.getStylesOfTarget(target);
			expect(styles.findStyle('outline-enable')?.value).toBe(true);
			expect(styles.findStyle('text-outline')?.value).toBe(5);
		}
		const styles = content.videoStyle.getStylesOfTarget('global');
		expect(styles.findStyle('overlay-opacity')?.value).toBe(0.86);
		expect(styles.findStyle('background-overlay-mode')?.value).toBe('fade-up');
		expect(styles.findStyle('background-overlay-fade-coverage')?.value).toBe(0.96);
		expect(styles.findStyle('background-overlay-fade-softness')?.value).toBe(0.43);
		expect(styles.findStyle('show-speaker-name')?.value).toBe(true);
	});

	it('uses the reference layout for translations added later', async () => {
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
				expect(content.videoStyle.getStylesOfTarget(target).findStyle('font-size')?.value).toBe(60);
				expect(content.videoStyle.getStylesOfTarget(target).findStyle('max-height')?.value).toBe(
					target === 'new-translation' ? 179 : 265
				);
				expect(
					content.videoStyle.getStylesOfTarget(target).findStyle('vertical-position')?.value
				).toBe(target === 'new-translation' ? 413 : 175);
				expect(
					content.videoStyle.getStylesOfTarget(target).findStyle('outline-enable')?.value
				).toBe(target === 'new-translation');
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
