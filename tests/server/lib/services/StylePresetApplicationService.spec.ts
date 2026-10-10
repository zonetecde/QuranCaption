import { describe, expect, it, vi } from 'vitest';

import {
	Category,
	CustomTextClip,
	ProjectContent,
	ProjectTranslation,
	Style,
	StylesData,
	Timeline,
	VideoStyle
} from '$lib/classes';
import type { Edition } from '$lib/classes/Edition';
import type { StyleName } from '$lib/classes/VideoStyle.svelte';
import { CustomTextTrack } from '$lib/classes/Track.svelte';
import {
	applyStylePresetToProject,
	getPresetTranslationTargets
} from '$lib/services/StylePresetApplicationService';
import { getCustomStyleClips } from '$lib/services/ProjectStyleContentService';

describe('StylePresetApplicationService', () => {
	it.each([true, false])(
		'preserves video transitions and background transforms when preset settings are present: %s',
		async (includePreservedStyles) => {
			const values: Partial<Record<StyleName, string | number>> = {
				'video-clip-transition': 'crossfade',
				'video-clip-transition-duration': 1200,
				'media-position-x': 25,
				'media-position-y': -15,
				'media-scale': 180
			};
			const previous = new StylesData('global', [
				new Category({
					id: 'general',
					styles: Object.entries(values).map(([id, value]) => new Style({ id, value }))
				})
			]);
			previous.findStyle('media-scale')!.keyframes = [{ time: 1000, value: 200 }];
			previous.overrides = { 7: { 'media-position-x': 40 } };
			previous.overrideKeyframes = { 7: { 'media-scale': [{ time: 2000, value: 220 }] } };
			const target = new VideoStyle();
			target.styles = [previous];
			const source = new VideoStyle();
			source.styles = [
				new StylesData('global', [
					new Category({
						id: 'general',
						styles: [
							...(includePreservedStyles
								? Object.keys(values).map((id) => new Style({ id, value: 0 }))
								: []),
							new Style({ id: 'fade-duration', value: 300 })
						]
					})
				])
			];
			source.styles[0].overrides = {
				7: { 'media-position-x': -50, 'overlay-opacity': 0.4 },
				8: { 'media-scale': 250 }
			};
			source.styles[0].overrideKeyframes = {
				8: { 'media-position-y': [{ time: 1000, value: 80 }] }
			};
			const content = new ProjectContent(
				new Timeline([new CustomTextTrack()]),
				[],
				new ProjectTranslation(),
				target
			);
			vi.spyOn(target, 'ensureStylesSchemaUpToDate').mockImplementation(async () => {
				const styles = target.getStylesOfTarget('global');
				for (const id of Object.keys(values) as StyleName[]) {
					if (!styles.findStyle(id)) styles.categories[0].styles.push(new Style({ id, value: 0 }));
				}
				return false;
			});
			await applyStylePresetToProject({
				videoStyle: target,
				projectContent: content,
				data: { videoStyle: JSON.parse(JSON.stringify(source)), customClips: [] }
			});
			const actual = target.getStylesOfTarget('global');
			for (const [id, value] of Object.entries(values)) {
				expect(actual.findStyle(id as StyleName)?.value).toBe(value);
			}
			expect(actual.findStyle('media-scale')?.keyframes).toEqual([{ time: 1000, value: 200 }]);
			expect(actual.overrides[7]).toEqual({ 'media-position-x': 40, 'overlay-opacity': 0.4 });
			expect(actual.overrides[8]?.['media-scale']).toBeUndefined();
			expect(actual.overrideKeyframes[7]).toEqual(previous.overrideKeyframes[7]);
			expect(actual.overrideKeyframes[8]?.['media-position-y']).toBeUndefined();
			expect(actual.findStyle('fade-duration')?.value).toBe(300);
		}
	);

	it('applies legacy preset data to an explicit project without global state', async () => {
		const source = new VideoStyle();
		source.styles = [
			new StylesData('global', [
				new Category({ id: 'overlay', styles: [new Style({ id: 'overlay-opacity', value: 0.4 })] })
			]),
			new StylesData('arabic', [
				new Category({ id: 'text', styles: [new Style({ id: 'font-size', value: 95 })] })
			]),
			new StylesData('source-edition', [
				new Category({ id: 'text', styles: [new Style({ id: 'font-size', value: 52 })] })
			])
		];
		const customClip = new CustomTextClip(
			new Category({
				id: 'custom-text-old',
				styles: [
					new Style({ id: 'text', value: 'Legacy custom text' }),
					new Style({ id: 'time-appearance', value: 0 }),
					new Style({ id: 'time-disappearance', value: 3000 })
				]
			})
		);
		const data = {
			videoStyle: JSON.parse(JSON.stringify(source)) as Record<string, unknown>,
			customClips: [],
			customTextClips: [
				new Proxy(JSON.parse(JSON.stringify(customClip)) as Record<string, unknown>, {})
			]
		};

		const target = new VideoStyle();
		target.styles = [
			new StylesData('global'),
			new StylesData('arabic'),
			new StylesData('project-edition')
		];
		const translations = new ProjectTranslation();
		translations.addedTranslationEditions = [{ name: 'project-edition' } as Edition];
		const content = new ProjectContent(
			new Timeline([new CustomTextTrack()]),
			[],
			translations,
			target
		);
		const ensureStylesSchema = vi
			.spyOn(target, 'ensureStylesSchemaUpToDate')
			.mockResolvedValue(false);

		await applyStylePresetToProject({
			videoStyle: target,
			projectContent: content,
			data,
			translationAssignments: { 'project-edition': 'source-edition' }
		});

		expect(getPresetTranslationTargets(data)).toEqual(['source-edition']);
		expect(target.getStylesOfTarget('global').findStyle('overlay-opacity')?.value).toBe(0.4);
		expect(target.getStylesOfTarget('arabic').findStyle('font-size')?.value).toBe(95);
		expect(target.getStylesOfTarget('project-edition').findStyle('font-size')?.value).toBe(52);
		expect(getCustomStyleClips(content)).toHaveLength(1);
		expect(getCustomStyleClips(content)[0]).toBeInstanceOf(CustomTextClip);
		expect(getCustomStyleClips(content)[0].id).not.toBe(customClip.id);
		expect(ensureStylesSchema).toHaveBeenCalledOnce();
		const importedClipId = getCustomStyleClips(content)[0].id;
		const exported = target.exportStylesData(new Set([importedClipId]), content);
		expect(exported.customClips).toHaveLength(1);
		expect(exported.customTextClips).toBeUndefined();
	});
});
