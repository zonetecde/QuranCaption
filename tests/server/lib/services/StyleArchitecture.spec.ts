import { afterEach, describe, expect, it, vi } from 'vitest';

import { Category, Style, StylesData, VideoStyle } from '$lib/classes/VideoStyle.svelte';
import { PredefinedSubtitleClip, SubtitleClip } from '$lib/classes/Clip.svelte';
import { globalState } from '$lib/runes/main.svelte';
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
					target: 'global',
					categories: [
						{
							id: 'overlay',
							styles: [
								{
									id: 'background-overlay-mode',
									value: 'fade-up',
									valueType: 'select',
									options: ['uniform', 'fade-up', 'fade-down', 'fade-center']
								}
							]
						}
					]
				},
				{
					target: 'arabic',
					categories: [
						{
							id: 'general',
							styles: [{ id: 'mushaf-style', value: 'Soosi', valueType: 'select' }]
						},
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
				json: async () => [
					{ id: 'general', styles: [{ id: 'fade-duration', value: 1000 }] },
					{
						id: 'overlay',
						styles: [
							{
								id: 'background-overlay-mode',
								value: 'uniform',
								valueType: 'select',
								options: ['uniform', 'fade-up', 'fade-down', 'fade-center', 'fade-four-sides']
							},
							{
								id: 'background-overlay-fade-softness',
								value: 1,
								valueType: 'number'
							}
						]
					}
				]
			})
			.mockResolvedValueOnce({
				json: async () => [
					{
						id: 'general',
						styles: [
							{ id: 'riwayah', value: 'Hafs', valueType: 'select' },
							{
								id: 'mushaf-style',
								value: 'Uthmani',
								valueType: 'select',
								options: ['Uthmani', 'Indopak', 'Tajweed', 'Minimal Quran']
							}
						]
					},
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
		expect(legacy.getStylesOfTarget('arabic').findStyle('riwayah')?.value).toBe('Hafs');
		expect(legacy.getStylesOfTarget('arabic').findStyle('mushaf-style')?.value).toBe('Soosi');
		expect(legacy.getStylesOfTarget('global').findStyle('background-overlay-mode')).toMatchObject({
			value: 'fade-up',
			options: ['uniform', 'fade-up', 'fade-down', 'fade-center', 'fade-four-sides']
		});
		expect(
			legacy.getStylesOfTarget('global').findStyle('background-overlay-fade-softness')?.value
		).toBe(1);
		expect(legacy.doesTargetStyleExist('global')).toBe(true);
		expect(
			legacy.getStylesOfTarget('arabic').categories.find((category) => category.id === 'text')?.ui
				?.panel.id
		).toBe('text');
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
					new Style({ id: 'background-overlay-fade-softness', value: 0.6 }),
					new Style({ id: 'background-overlay-fade-curve', value: 'smooth' }),
					new Style({ id: 'background-overlay-fade-invert', value: true }),
					new Style({ id: 'background-overlay-fade-position-x', value: 0.4 }),
					new Style({ id: 'background-overlay-fade-position-y', value: 0.7 }),
					new Style({ id: 'background-overlay-fade-width', value: 1.2 }),
					new Style({ id: 'background-overlay-fade-height', value: 0.8 }),
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
		styles.setStyleForClips([7], 'background-overlay-fade-width', 1.7);

		expect(resolveOverlayVisualState(styles, 7)).toMatchObject({
			enable: true,
			blur: 9,
			fadeSoftness: 0.6,
			fadeCurve: 'smooth',
			fadeInvert: true,
			fadePositionX: 0.4,
			fadePositionY: 0.7,
			fadeWidth: 1.7,
			fadeHeight: 0.8
		});
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
		const riwayahStyle = new Style({ id: 'riwayah', value: 'Hafs', valueType: 'select' });
		const mushafStyle = new Style({ id: 'mushaf-style', value: 'Uthmani', valueType: 'select' });
		const fontStyle = new Style({ id: 'font-family', value: 'Hafs', valueType: 'select' });
		const opacityStyle = new Style({ id: 'opacity', value: 1, valueType: 'number' });
		const videoStyle = new VideoStyle();
		videoStyle.styles = [
			new StylesData('arabic', [
				new Category({ id: 'general', styles: [riwayahStyle, mushafStyle] }),
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

		applyStyleMutation({
			videoStyle,
			style: riwayahStyle,
			target: 'arabic',
			clipIds: [],
			value: 'Warsh',
			applyBaseValue: (value) => (riwayahStyle.value = value)
		});
		expect(riwayahStyle.value).toBe('Warsh');
		expect(fontStyle.value).toBe('warsh10');
		const reopened = VideoStyle.fromJSON(JSON.parse(JSON.stringify(videoStyle))) as VideoStyle;
		expect(reopened.getStylesOfTarget('arabic').findStyle('riwayah')?.value).toBe('Warsh');
		expect(reopened.getStylesOfTarget('arabic').findStyle('font-family')?.value).toBe('warsh10');

		applyStyleMutation({
			videoStyle,
			style: mushafStyle,
			target: 'arabic',
			clipIds: [],
			value: 'Uthmani',
			applyBaseValue: (value) => (mushafStyle.value = value)
		});
		expect(mushafStyle.value).toBe('Uthmani');
		expect(fontStyle.value).toBe('warsh10');

		applyStyleMutation({
			videoStyle,
			style: riwayahStyle,
			target: 'arabic',
			clipIds: [],
			value: 'Hafs',
			applyBaseValue: (value) => (riwayahStyle.value = value)
		});
		expect(fontStyle.value).toBe('Hafs');

		applyStyleMutation({
			videoStyle,
			style: riwayahStyle,
			target: 'arabic',
			clipIds: [42],
			value: 'Warsh',
			applyBaseValue: (value) => (riwayahStyle.value = value)
		});
		const arabicStyles = videoStyle.getStylesOfTarget('arabic');
		expect(riwayahStyle.value).toBe('Hafs');
		expect(arabicStyles.getEffectiveValue('riwayah', 42)).toBe('Warsh');
		expect(arabicStyles.getEffectiveValue('font-family', 42)).toBe('warsh10');
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

	it('forces the bundled riwayah font for Quran clips', () => {
		const clip = new SubtitleClip(0, 1_000, 1, 2, 0, 3, 'text', [], true, true);
		const arabicStyles = new StylesData('arabic', [
			new Category({
				id: 'general',
				styles: [
					new Style({ id: 'riwayah', value: 'Warsh', valueType: 'select' }),
					new Style({ id: 'mushaf-style', value: 'Uthmani', valueType: 'select' })
				]
			}),
			new Category({
				id: 'text',
				styles: [
					new Style({
						id: 'font-family',
						value: 'SomeCustomFont',
						valueType: 'select',
						css: "font-family: '{value}', sans-serif;"
					})
				]
			})
		]);
		const videoStyle = new VideoStyle();
		videoStyle.styles = [arabicStyles];
		const originalProject = globalState.currentProject;
		globalState.currentProject = {
			content: {
				videoStyle,
				timeline: { getFirstTrack: () => ({ getClipById: () => clip }) }
			}
		} as never;

		try {
			expect(arabicStyles.generateCSS(clip.id)).toContain('font-family: warsh10, sans-serif;');
		} finally {
			globalState.currentProject = originalProject;
		}
	});

	it('forces the individually selected riwayah font for Quran clips', () => {
		const clip = new SubtitleClip(0, 1_000, 1, 2, 0, 3, 'text', [], true, true);
		const arabicStyles = new StylesData('arabic', [
			new Category({
				id: 'general',
				styles: [
					new Style({ id: 'riwayah', value: 'Hafs', valueType: 'select' }),
					new Style({ id: 'mushaf-style', value: 'Uthmani', valueType: 'select' })
				]
			}),
			new Category({
				id: 'text',
				styles: [
					new Style({
						id: 'font-family',
						value: 'Hafs',
						valueType: 'select',
						css: "font-family: '{value}', sans-serif;"
					})
				]
			})
		]);
		arabicStyles.setStyleForClips([clip.id], 'riwayah', 'Warsh');
		const videoStyle = new VideoStyle();
		videoStyle.styles = [arabicStyles];
		const originalProject = globalState.currentProject;
		globalState.currentProject = {
			content: {
				videoStyle,
				timeline: { getFirstTrack: () => ({ getClipById: () => clip }) }
			}
		} as never;

		try {
			expect(arabicStyles.generateCSS(clip.id)).toContain('font-family: warsh10, sans-serif;');
		} finally {
			globalState.currentProject = originalProject;
		}
	});

	it('renders the selected calligraphic basmala with its bundled font', () => {
		const clip = new PredefinedSubtitleClip(0, 1_000, 'Basmala');
		const arabicStyles = new StylesData('arabic', [
			new Category({
				id: 'general',
				styles: [
					new Style({ id: 'riwayah', value: 'Hafs', valueType: 'select' }),
					new Style({ id: 'mushaf-style', value: 'Uthmani', valueType: 'select' }),
					new Style({ id: 'basmala-style', value: '122', valueType: 'select' }),
					new Style({ id: 'basmala-scale', value: 125, valueType: 'number' })
				]
			}),
			new Category({
				id: 'text',
				styles: [
					new Style({
						id: 'font-family',
						value: 'QPC2',
						valueType: 'select',
						css: "font-family: '{value}', sans-serif;"
					})
				]
			}),
			new Category({
				id: 'animation',
				styles: [
					new Style({ id: 'scale', value: 80, valueType: 'number', css: '--scale: {value}%;' })
				]
			})
		]);
		const videoStyle = new VideoStyle();
		videoStyle.styles = [arabicStyles];
		const originalProject = globalState.currentProject;
		globalState.currentProject = {
			content: {
				videoStyle,
				timeline: { getFirstTrack: () => ({ getClipById: () => clip }) }
			}
		} as never;

		try {
			expect(clip.getText()).toBe('122');
			expect(arabicStyles.generateCSS(clip.id)).toContain('font-family: Basmalah;');
			expect(arabicStyles.generateCSS(clip.id)).toContain('--scale: 125%;');
		} finally {
			globalState.currentProject = originalProject;
		}
	});

	it('preserves Hafs clip data across repeated riwayah style round trips', () => {
		const clips = [
			new SubtitleClip(0, 1_000, 57, 24, 0, 11, '57:24 Hafs', [], true, true),
			new SubtitleClip(1_000, 2_000, 2, 255, 0, 49, '2:255 Hafs', [], true, true),
			new SubtitleClip(2_000, 3_000, 2, 1, 0, 0, '2:1 Hafs', [], true, true),
			new SubtitleClip(3_000, 4_000, 2, 2, 0, 6, '2:2 Hafs', [], true, true)
		];
		const originalClips = JSON.stringify(clips);
		const riwayahStyle = new Style({ id: 'riwayah', value: 'Hafs', valueType: 'select' });
		const mushafStyle = new Style({ id: 'mushaf-style', value: 'Uthmani', valueType: 'select' });
		const fontStyle = new Style({
			id: 'font-family',
			value: 'SomeCustomFont',
			valueType: 'select'
		});
		const videoStyle = new VideoStyle();
		videoStyle.styles = [
			new StylesData('arabic', [
				new Category({ id: 'general', styles: [riwayahStyle, mushafStyle] }),
				new Category({ id: 'text', styles: [fontStyle] })
			])
		];
		for (const [value, expectedFont] of [
			['Warsh', 'warsh10'],
			['Qaloon', 'qaloon10'],
			['Shouba', 'shouba8'],
			['Doori', 'doori9'],
			['Soosi', 'soosi9'],
			['Bazzi', 'bazzi7'],
			['Qumbul', 'qumbul7'],
			['Hafs', 'Hafs'],
			['Warsh', 'warsh10']
		]) {
			applyStyleMutation({
				videoStyle,
				style: riwayahStyle,
				target: 'arabic',
				clipIds: [],
				value,
				applyBaseValue: (nextValue) => (riwayahStyle.value = nextValue)
			});
			expect(fontStyle.value).toBe(expectedFont);
		}

		const reopened = VideoStyle.fromJSON(JSON.parse(JSON.stringify(videoStyle))) as VideoStyle;
		expect(reopened.getStylesOfTarget('arabic').findStyle('riwayah')?.value).toBe('Warsh');
		expect(reopened.getStylesOfTarget('arabic').findStyle('font-family')?.value).toBe('warsh10');
		expect(JSON.stringify(clips)).toBe(originalClips);
	});
});
