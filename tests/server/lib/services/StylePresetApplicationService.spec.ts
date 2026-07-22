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
import { CustomTextTrack } from '$lib/classes/Track.svelte';
import {
	applyStylePresetToProject,
	getPresetTranslationTargets
} from '$lib/services/StylePresetApplicationService';
import { getCustomStyleClips } from '$lib/services/ProjectStyleContentService';

describe('StylePresetApplicationService', () => {
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
			customTextClips: [JSON.parse(JSON.stringify(customClip)) as Record<string, unknown>]
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
		vi.spyOn(target, 'ensureStylesSchemaUpToDate').mockResolvedValue(false);

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
		const importedClipId = getCustomStyleClips(content)[0].id;
		const exported = target.exportStylesData(new Set([importedClipId]), content);
		expect(exported.customClips).toHaveLength(1);
		expect(exported.customTextClips).toBeUndefined();
	});
});
