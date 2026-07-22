import { afterEach, describe, expect, it, vi } from 'vitest';

import { Category, Style, StylesData, VideoStyle } from '$lib/classes/VideoStyle.svelte';
import {
	loadCustomStyleCategoryDefinition,
	loadStyleCategoryDefinitions
} from '$lib/services/StyleDefinitionCatalog';
import { applyStyleMutation, coerceStyleValue } from '$lib/services/StyleMutationService';
import {
	isWordByWordVisualEnabled,
	resolveOverlayVisualState,
	resolveTimedVisualState
} from '$lib/services/StyleVisualResolver';

describe('style architecture modules', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('loads valid catalogs and rejects malformed definitions', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({ json: async () => [{ id: 'text', styles: [{ id: 'font-size' }] }] })
			.mockResolvedValueOnce({ json: async () => ({ styles: [] }) });
		vi.stubGlobal('fetch', fetchMock);

		await expect(loadStyleCategoryDefinitions('subtitle')).resolves.toEqual([
			{ id: 'text', styles: [{ id: 'font-size' }] }
		]);
		await expect(loadCustomStyleCategoryDefinition('text')).rejects.toThrow(
			'Invalid custom style catalog'
		);
	});

	it('hydrates an old project without overwriting values or persisting UI metadata', async () => {
		const legacy = VideoStyle.fromJSON({
			styles: [
				{
					target: 'arabic',
					categories: [
						{
							id: 'text',
							styles: [{ id: 'font-size', value: 77, valueType: 'number' }]
						}
					]
				}
			]
		}) as VideoStyle;
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({
				json: async () => [{ id: 'general', styles: [{ id: 'fade-duration', value: 1000 }] }]
			})
			.mockResolvedValueOnce({
				json: async () => [
					{
						id: 'text',
						ui: { panel: { id: 'text', icon: 'text', label: 'text', order: 1, categoryOrder: 1 } },
						styles: [
							{ id: 'font-size', value: 90, valueType: 'number' },
							{ id: 'text-color', value: '#ffffff', valueType: 'color' }
						]
					}
				]
			})
			.mockResolvedValueOnce({ json: async () => ({ id: 'custom-text', styles: [] }) })
			.mockResolvedValueOnce({ json: async () => [] });
		vi.stubGlobal('fetch', fetchMock);

		await legacy.ensureStylesSchemaUpToDate();

		expect(legacy.getStylesOfTarget('arabic').findStyle('font-size')?.value).toBe(77);
		expect(legacy.getStylesOfTarget('arabic').findStyle('text-color')?.value).toBe('#ffffff');
		expect(legacy.doesTargetStyleExist('global')).toBe(true);
		expect(legacy.getStylesOfTarget('arabic').categories[0].ui?.panel.id).toBe('text');
		expect(JSON.stringify(legacy)).not.toContain('"ui"');
	});

	it('resolves identical overlay and timing values for every adapter', () => {
		const styles = new StylesData('global', [
			new Category({
				id: 'overlay',
				styles: [
					new Style({ id: 'overlay-enable', value: true }),
					new Style({ id: 'overlay-blur', value: 4 }),
					new Style({ id: 'overlay-opacity', value: 0.5 }),
					new Style({ id: 'overlay-color', value: '#112233' }),
					new Style({ id: 'background-overlay-mode', value: 'uniform' }),
					new Style({ id: 'background-overlay-fade-intensity', value: 0.8 }),
					new Style({ id: 'background-overlay-fade-coverage', value: 60 }),
					new Style({ id: 'overlay-custom-css', value: 'mix-blend-mode: multiply' })
				]
			}),
			new Category({
				id: 'surah-name',
				styles: [
					new Style({ id: 'show-surah-name', value: true }),
					new Style({ id: 'surah-name-always-show', value: false }),
					new Style({ id: 'surah-name-time-appearance', value: 500 }),
					new Style({ id: 'surah-name-time-disappearance', value: 2500 })
				]
			})
		]);
		styles.setStyleForClips([7], 'overlay-blur', 9);

		expect(resolveOverlayVisualState(styles, 7)).toMatchObject({ enable: true, blur: 9 });
		expect(
			resolveTimedVisualState(styles, {
				enabled: 'show-surah-name',
				alwaysShow: 'surah-name-always-show',
				startTime: 'surah-name-time-appearance',
				endTime: 'surah-name-time-disappearance'
			})
		).toEqual({ enabled: true, alwaysShow: false, startTime: 500, endTime: 2500 });
	});

	it('keeps scope, coercion and Arabic invariants in one mutation', () => {
		const mushafStyle = new Style({ id: 'mushaf-style', value: 'Uthmani', valueType: 'select' });
		const fontStyle = new Style({ id: 'font-family', value: 'Hafs', valueType: 'select' });
		const opacityStyle = new Style({ id: 'opacity', value: 1, valueType: 'number' });
		const videoStyle = new VideoStyle();
		videoStyle.styles = [
			new StylesData('arabic', [
				new Category({ id: 'general', styles: [mushafStyle] }),
				new Category({ id: 'text', styles: [fontStyle] }),
				new Category({ id: 'effects', styles: [opacityStyle] })
			])
		];

		const result = applyStyleMutation({
			videoStyle,
			style: mushafStyle,
			target: 'arabic',
			clipIds: [],
			value: 'Tajweed',
			applyBaseValue: (value) => (mushafStyle.value = value)
		});
		applyStyleMutation({
			videoStyle,
			style: opacityStyle,
			target: 'arabic',
			clipIds: [42],
			value: '0.4',
			applyBaseValue: (value) => (opacityStyle.value = value)
		});

		expect(result).toEqual({ refreshPreview: true, showTajweedWarning: true });
		expect(fontStyle.value).toBe('QPC2');
		expect(videoStyle.getStylesOfTarget('arabic').getEffectiveValue('opacity', 42)).toBe(0.4);
		expect(coerceStyleValue(opacityStyle, '0.75')).toBe(0.75);
	});

	it('resolves WBW activation independently from its adapters', () => {
		const values: Record<string, string | number | boolean> = {
			'enable-wbw-highlight': false,
			'enable-wbw-underline': false,
			'enable-wbw-glow': false,
			'wbw-reveal-specific-word-style': false,
			'wbw-reveal-on-recitation': false,
			'enable-wbw-background': false,
			'enable-wbw-line-background': false,
			'wbw-show-current-word-only': false,
			'wbw-current-word-custom-css': 'opacity: .8',
			'enable-wbw-current-word-opacity': false
		};
		expect(isWordByWordVisualEnabled((id) => values[id] ?? false)).toBe(true);
	});
});
