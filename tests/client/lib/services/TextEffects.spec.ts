import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import NativeTextEffects from '$lib/components/projectEditor/videoPreview/NativeTextEffects.svelte';
import { StyleCssGenerator, type StyleCssSource } from '$lib/classes/videoStyles/StyleCssGenerator';
import { Style } from '$lib/classes/videoStyles/Style.svelte';
import { getWordGlowCss } from '$lib/services/TextEffects';
import { refreshRoundedTextOutlines } from '$lib/services/RoundedTextOutline';
import { applyReactiveFontSize } from '$lib/components/projectEditor/videoPreview/helpers/reactiveFontSize';
import type {
	RawCategoryDefinition,
	RawStyleDefinition
} from '$lib/services/StyleDefinitionCatalog';
import { captureMacOsOverlayPngBytes } from '../../../../src/routes/exporter/MacOSExport';
import {
	captureExportOverlayBlob,
	releaseExportScreenshotContext
} from '../../../../src/routes/exporter/ExportScreenshot';

vi.mock('$lib/runes/main.svelte', () => ({ globalState: {} }));
vi.mock('$lib/classes/Clip.svelte', () => ({
	PredefinedSubtitleClip: class {},
	SubtitleClip: class {},
	getForcedFontForPredefinedSubtitle: vi.fn()
}));

const elements: HTMLElement[] = [];
const components: ReturnType<typeof mount>[] = [];
const effectCategories = ['shadow', 'outline', 'text-glow', 'text-neon', 'effects'];
let qpcText: Record<string, string>;
let definitions: RawCategoryDefinition[];
let compositeDefinitions: RawStyleDefinition[];

beforeAll(async () => {
	[definitions, compositeDefinitions, qpcText] = await Promise.all(
		['/styles/styles.json', '/styles/compositeStyles.json', '/QPC2/qpc-v2.json'].map(async (path) =>
			(await fetch(path)).json()
		)
	);
});

/**
 * Génère les vrais styles sans dépendre d'un projet ouvert dans l'éditeur.
 * @param {Record<string, string | number | boolean>} values Valeurs de contrôle à appliquer.
 * @returns {string} CSS des effets de sous-titres.
 */
function generateEffects(values: Record<string, string | number | boolean>): string {
	const categories = definitions.filter((category) => effectCategories.includes(category.id));
	return StyleCssGenerator.generate({
		target: 'translation',
		categories: categories.map((category) => ({
			...category,
			styles: category.styles!.map((style) => ({ ...style, getCategory: () => category.id }))
		})),
		getEffectiveValue: (id) =>
			values[id] ??
			categories.flatMap((category) => category.styles!).find((style) => style.id === id)!.value
	} as StyleCssSource);
}

/**
 * Charge les polices locales et crée un texte isolé sur fond transparent.
 * @param {string} font Police locale du texte.
 * @param {string} text Texte latin, arabe Unicode ou glyphes QPC.
 * @returns {Promise<HTMLElement>} Racine prête à capturer.
 */
async function createText(font: string, text: string): Promise<HTMLElement> {
	if (/^\d+:\d+$/.test(text)) text = verseGlyphs(text);
	const fonts = document.createElement('style');
	fonts.textContent = `
		@font-face { font-family: EffectsHafs; src: url('/Hafs.ttf'); }
		@font-face { font-family: EffectsQpc1; src: url('/QPC2/fonts/QPC2_p001.woff2'); }
		@font-face { font-family: EffectsQpc293; src: url('/QPC2/fonts/QPC2_p293.woff2'); }
		@font-face { font-family: EffectsQpc604; src: url('/QPC2/fonts/QPC2_p604.woff2'); }
	`;
	const root = document.createElement('div');
	root.style.cssText = 'width:800px;height:220px;position:relative;';
	root.innerHTML = `<p dir="${font === 'Georgia' ? 'ltr' : 'rtl'}" style="position:absolute;inset:20px 30px;margin:0;text-align:center;line-height:1.8;font:54px ${font};color:white"><span>${text}</span></p>`;
	document.head.append(fonts);
	document.body.append(root);
	elements.push(root, fonts);
	await document.fonts.load(`54px ${font}`, text);
	return root;
}

/**
 * Décode les pixels d'un PNG de capture.
 * @param {Blob} blob Image à analyser.
 * @returns {Promise<ImageData>} Pixels de l'image.
 */
async function pixels(blob: Blob): Promise<ImageData> {
	const bitmap = await createImageBitmap(blob);
	const canvas = document.createElement('canvas');
	canvas.width = bitmap.width;
	canvas.height = bitmap.height;
	const context = canvas.getContext('2d')!;
	context.drawImage(bitmap, 0, 0);
	bitmap.close();
	return context.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Lit les glyphes du verset depuis le mapping QPC V2 du projet.
 * @param {string} verse Clé sourate:verset.
 * @returns {string} Glyphes dans l'ordre du verset.
 */
function verseGlyphs(verse: string): string {
	return Object.entries(qpcText)
		.filter(([key]) => key.startsWith(`${verse}:`))
		.map(([, glyph]) => glyph)
		.join(' ');
}

/**
 * Monte le renderer réel avec le contenu du paragraphe.
 * @param {HTMLElement} paragraph Texte à entourer.
 * @param {string} css Styles transmis au renderer.
 * @returns {void} Rien.
 */
function mountEffects(paragraph: HTMLElement, css: string): void {
	const markup = paragraph.innerHTML;
	paragraph.replaceChildren();
	components.push(
		mount(NativeTextEffects, {
			target: paragraph,
			props: { css, children: createRawSnippet(() => ({ render: () => `<span>${markup}</span>` })) }
		})
	);
	flushSync();
}

/**
 * Détecte les pointes dépassant le rayon du contour autour du glyphe original.
 * @param {ImageData} reference Remplissage sans contour.
 * @param {ImageData} actual Texte avec contour.
 * @param {number} radius Largeur extérieure, avec tolérance d'anticrénelage.
 * @returns {number} Nombre de pixels rouges trop éloignés du remplissage.
 */
function countOutlineSpikes(reference: ImageData, actual: ImageData, radius: number): number {
	let spikes = 0;
	const extent = Math.ceil(radius);
	for (let y = 0; y < actual.height; y++) {
		for (let x = 0; x < actual.width; x++) {
			const index = (y * actual.width + x) * 4;
			if (actual.data[index + 3] < 128 || actual.data[index] < actual.data[index + 1] + 100)
				continue;
			let nearFill = false;
			for (let dy = -extent; dy <= extent && !nearFill; dy++) {
				for (let dx = -extent; dx <= extent; dx++) {
					if (dx * dx + dy * dy > radius * radius) continue;
					const px = x + dx,
						py = y + dy;
					if (px < 0 || py < 0 || px >= actual.width || py >= actual.height) continue;
					if (reference.data[(py * actual.width + px) * 4 + 3] > 32) {
						nearFill = true;
						break;
					}
				}
			}
			if (!nearFill) spikes++;
		}
	}
	return spikes;
}

afterEach(async () => {
	releaseExportScreenshotContext();
	for (const component of components.splice(0)) await unmount(component);
	for (const element of elements.splice(0)) element.remove();
	vi.restoreAllMocks();
});

describe('contours natifs et composition des effets', () => {
	it.each([
		['Georgia', 'All praise is for Allah'],
		['EffectsHafs', 'ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ'],
		['EffectsQpc1', '1:2']
	])(
		'cumule les 16 combinaisons d’effets sur %s sans modifier les filtres',
		async (font, sample) => {
			const root = await createText(font, sample);
			const text = root.querySelector('p')!;
			const base = text.style.cssText;
			for (let mask = 0; mask < 16; mask++) {
				text.style.cssText =
					base +
					generateEffects({
						'outline-enable': Boolean(mask & 1),
						'shadow-enable': Boolean(mask & 2),
						'text-glow-enable': Boolean(mask & 4),
						'text-neon-enable': Boolean(mask & 8),
						'text-outline': 2,
						'text-glow-color': '#a31b2e',
						'text-neon-color': '#159b7d',
						'text-shadow-color': '#3c2482',
						blur: 1.25,
						brightness: 85,
						contrast: 120
					});
				const computed = getComputedStyle(text);
				expect(computed.webkitTextStrokeWidth).toBe(mask & 1 ? '4px' : '0px');
				expect(computed.filter).toBe('blur(1.25px) brightness(0.85) contrast(1.2)');
				for (const [bit, property] of [
					[2, '--text-drop-shadow'],
					[4, '--text-glow-shadow'],
					[8, '--text-neon-shadow']
				] as const) {
					expect(Boolean(computed.getPropertyValue(property))).toBe(Boolean(mask & bit));
				}
				if (mask & 14) expect(computed.textShadow).not.toBe('none');
				for (const [bit, color] of [
					[2, 'rgb(60, 36, 130)'],
					[4, 'rgb(163, 27, 46)'],
					[8, 'rgb(21, 155, 125)']
				] as const) {
					expect(computed.textShadow.includes(color)).toBe(Boolean(mask & bit));
				}
			}
		}
	);

	it.each([
		['Georgia', 'All  praise is for Allah'],
		['EffectsHafs', 'ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ'],
		['EffectsQpc1', '1:2'],
		['EffectsQpc1', '1:7'],
		['EffectsQpc293', '18:1'],
		['EffectsQpc604', '114:1']
	])(
		'préserve les traits fins de %s et conserve le contour aux deux échelles d’export',
		async (font, text) => {
			const root = await createText(font, text);
			const paragraph = root.querySelector('p')!;
			const base = paragraph.style.cssText;
			mountEffects(paragraph, generateEffects({ 'outline-enable': true }));
			for (const scale of [1, 2]) {
				const reference = await pixels(await captureExportOverlayBlob(root, { scale }));
				for (const width of [0.25, 1, 3, 8, 10, 15, 20]) {
					paragraph.style.cssText =
						base +
						generateEffects({
							'outline-enable': true,
							'text-outline': width,
							'text-outline-color': '#ff0000'
						});
					const actual = await pixels(await captureExportOverlayBlob(root, { scale }));
					let foreground = 0;
					let preserved = 0;
					let outline = 0;
					for (let i = 0; i < reference.data.length; i += 4) {
						if (reference.data[i + 3] > 250) {
							foreground++;
							if (actual.data[i + 1] > 245 && actual.data[i + 2] > 245) preserved++;
						}
						outline +=
							((Math.max(0, actual.data[i] - actual.data[i + 1]) / 255) * actual.data[i + 3]) / 255;
					}
					expect(foreground).toBeGreaterThan(100);
					expect(preserved / foreground).toBeGreaterThan(0.98);
					expect(outline).toBeGreaterThan(10);
					if (width >= 10)
						expect(countOutlineSpikes(reference, actual, (width + 1.5) * scale)).toBe(0);
				}
				paragraph.style.cssText = base;
			}
		}
	);

	it.each([
		['Georgia', 'All praise is for Allah'],
		['EffectsHafs', 'ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ'],
		['EffectsQpc1', '1:2']
	])(
		'conserve l’épaisseur des anciens contours de %s à valeurs identiques',
		async (font, sample) => {
			const root = await createText(font, sample);
			const paragraph = root.querySelector('p')!;
			const base = paragraph.style.cssText;
			for (const width of [1, 5, 10]) {
				// Ancien contour : 16 ombres à rayon plein et 8 ombres intérieures à 60 %.
				const shadows = [
					...Array.from({ length: 16 }, (_, i) => [(i * Math.PI) / 8, 1]),
					...Array.from({ length: 8 }, (_, i) => [(i * Math.PI) / 4, 0.6])
				].map(
					([angle, radius]) =>
						`${Number((Math.cos(angle) * radius).toFixed(4)) * width}px ${Number((Math.sin(angle) * radius).toFixed(4)) * width}px 0 red`
				);
				paragraph.style.cssText = `${base};text-shadow:${shadows.join(',')};`;
				const legacy = await pixels(await captureExportOverlayBlob(root, { scale: 1 }));
				const css = generateEffects({
					'outline-enable': true,
					'text-outline': width,
					'text-outline-color': '#ff0000'
				});
				paragraph.style.cssText = base + css;
				if (!paragraph.querySelector('.native-text-effects')) mountEffects(paragraph, css);
				const actual = await pixels(await captureExportOverlayBlob(root, { scale: 1 }));
				const bounds = [legacy, actual].map((image) => {
					let left = image.width,
						top = image.height,
						right = 0,
						bottom = 0;
					for (let y = 0; y < image.height; y++) {
						for (let x = 0; x < image.width; x++) {
							if (image.data[(y * image.width + x) * 4 + 3] < 128) continue;
							left = Math.min(left, x);
							right = Math.max(right, x);
							top = Math.min(top, y);
							bottom = Math.max(bottom, y);
						}
					}
					return [left, top, right, bottom];
				});
				for (let edge = 0; edge < 4; edge++)
					expect(Math.abs(bounds[0][edge] - bounds[1][edge])).toBeLessThanOrEqual(1);
			}
		}
	);

	it('supprime les pointes sous لا et الضالين en QPC V2 à 10 px', async () => {
		const phrase = verseGlyphs('1:7').split(' ').slice(-5, -1).join(' ');
		const root = await createText('EffectsQpc1', phrase);
		const paragraph = root.querySelector('p')!;
		const reference = await pixels(await captureExportOverlayBlob(root, { scale: 1 }));
		const css = generateEffects({
			'outline-enable': true,
			'text-outline': 10,
			'text-outline-color': '#ff0000'
		});
		paragraph.style.cssText += css;
		const angular = await pixels(await captureExportOverlayBlob(root, { scale: 1 }));
		expect(countOutlineSpikes(reference, angular, 11.5)).toBeGreaterThan(25);
		mountEffects(paragraph, css);
		const rounded = await pixels(await captureExportOverlayBlob(root, { scale: 1 }));
		expect(countOutlineSpikes(reference, rounded, 11.5)).toBe(0);
	});

	it.each([1, 5])(
		'stabilise le fit QPC V2 à 11,93 et 11,94 px avec max-line=%s',
		async (maxLine) => {
			const phrase = verseGlyphs('1:7').split(' ').slice(-6, -1).join(' ');
			const root = await createText('EffectsQpc1', phrase);
			root.style.width = '1920px';
			const paragraph = root.querySelector('p')!;
			paragraph.classList.add('arabic', 'subtitle');
			paragraph.style.cssText +=
				'width:1613px;right:auto;bottom:auto;font-size:120px;line-height:1.25;';
			const signal = new AbortController().signal;

			/**
			 * Applique le fit réel avec l'attente de la preview ou celle de l'export.
			 * @param {boolean} preview Indique s'il faut céder aux timers de la preview.
			 * @returns {Promise<number>} Taille de police retenue.
			 */
			async function fit(preview: boolean): Promise<number> {
				await applyReactiveFontSize(
					'arabic',
					151,
					maxLine,
					120,
					true,
					signal,
					(_target, value) => {
						paragraph.style.fontSize = `${value}px`;
					},
					async () => {
						if (preview) await new Promise((resolve) => setTimeout(resolve, 1));
					}
				);
				return Number.parseFloat(paragraph.style.fontSize);
			}

			const referenceSize = await fit(false);
			const css = generateEffects({ 'outline-enable': true, 'text-outline': 11.93 });
			paragraph.style.cssText += css;
			mountEffects(paragraph, css);
			for (const preview of [false, true]) {
				for (const width of [11.93, 11.94, 20, 5, 11.93]) {
					paragraph.style.webkitTextStrokeWidth = `${width * 2}px`;
					// Le SVG peut encore décrire une police plus grande au début du calcul suivant.
					paragraph.style.fontSize = '240px';
					refreshRoundedTextOutlines(root);
					expect(await fit(preview)).toBe(referenceSize);
					const svg = paragraph.querySelector('svg')!;
					expect(getComputedStyle(svg).display).not.toBe('none');
					refreshRoundedTextOutlines(root);
					expect(svg.querySelector('text')?.getAttribute('stroke-width')).toBe(`${width * 2}px`);
				}
			}
		}
	);

	it.each([
		['Georgia', 'All praise is for Allah'],
		['EffectsHafs', 'ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ'],
		['EffectsQpc1', '1:7']
	])('suit les lignes justifiées et les transformations de %s', async (font, sample) => {
		const root = await createText(font, sample);
		const paragraph = root.querySelector('p')!;
		paragraph.style.cssText +=
			'font-size:32px;width:330px;text-align:justify;transform:rotate(4deg);letter-spacing:1px;text-transform:uppercase;';
		const reference = await pixels(await captureExportOverlayBlob(root, { scale: 1 }));
		const css = generateEffects({
			'outline-enable': true,
			'text-outline': 10,
			'text-outline-color': '#ff0000'
		});
		paragraph.style.cssText += css;
		mountEffects(paragraph, css);
		const actual = await pixels(await captureExportOverlayBlob(root, { scale: 1 }));
		expect(countOutlineSpikes(reference, actual, 11.5)).toBe(0);
		const foreground = paragraph.querySelector<HTMLElement>('.native-text-foreground')!;
		foreground.querySelector('span')!.textContent = font === 'Georgia' ? 'Allah' : 'لَا';
		paragraph.style.width = '240px';
		paragraph.style.webkitTextStrokeWidth = '8px';
		await vi.waitFor(() => {
			const outlines = foreground.querySelectorAll('svg text');
			expect(outlines).toHaveLength(1);
			expect(outlines[0].getAttribute('stroke-width')).toBe('8px');
			expect(outlines[0].textContent).toBe(font === 'Georgia' ? 'ALLAH' : 'لَا');
		});
	});

	it('préserve les effets hérités sous un halo inline et le contour des composites', async () => {
		const root = await createText('EffectsQpc1', verseGlyphs('1:2'));
		const paragraph = root.querySelector('p')!;
		paragraph.style.cssText += generateEffects({
			'outline-enable': true,
			'text-outline': 2,
			'shadow-enable': true,
			'text-glow-enable': true,
			'text-neon-enable': true
		});
		const word = paragraph.querySelector('span')!;
		word.style.cssText =
			getWordGlowCss('#ff00aa', '8px') +
			getWordGlowCss('#2255ff', '6px', 'wbw') +
			'color:rgb(255, 255, 0);';
		const computed = getComputedStyle(word);
		expect(computed.webkitTextStrokeWidth).toBe('4px');
		expect(computed.color).toBe('rgb(255, 255, 0)');
		expect(computed.textShadow).toContain('rgb(255, 0, 170)');
		expect(computed.textShadow).toContain('rgb(34, 85, 255)');
		expect(computed.textShadow).toContain('rgb(0, 255, 0)');
		expect(computed.textShadow).toContain('rgb(0, 0, 0)');
		expect(computed.filter).toBe('none');
		const composite = new Style({
			valueType: 'composite',
			value: compositeDefinitions.map(
				(definition) =>
					new Style({
						...definition,
						value: definition.id.endsWith('enable') ? true : definition.value
					} as Partial<Style>)
			)
		});
		word.style.cssText = composite.generateCSSForComposite(0);
		expect(getComputedStyle(word).webkitTextStrokeWidth).toBe('8px');
		expect(getComputedStyle(word).textShadow).not.toBe('none');
	});

	it.each([
		['Georgia', 'All praise is for Allah'],
		['EffectsHafs', 'ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ'],
		['EffectsQpc1', '1:2']
	])('sépare le contour et les halos de %s sans dupliquer les fonds', async (font, sample) => {
		const root = await createText(font, sample);
		const paragraph = root.querySelector('p')!;
		const text = paragraph.textContent!;
		const css = generateEffects({
			'outline-enable': true,
			'text-outline': 2,
			'text-outline-color': '#ff0000',
			'shadow-enable': true,
			'text-glow-enable': true,
			'text-glow-color': '#00ffff'
		});
		paragraph.style.cssText += css;
		const height = paragraph.getBoundingClientRect().height;
		paragraph.replaceChildren();
		components.push(
			mount(NativeTextEffects, {
				target: paragraph,
				props: {
					css,
					children: createRawSnippet(() => ({
						render: () =>
							`<span style="background:rgba(100,50,0,.5);text-decoration:underline">${text}</span>`
					}))
				}
			})
		);
		flushSync();
		const shadows = paragraph.querySelector<HTMLElement>('.native-text-shadows')!;
		const foreground = paragraph.querySelector<HTMLElement>('.native-text-foreground')!;
		expect(shadows.getAttribute('aria-hidden')).toBe('true');
		expect(getComputedStyle(foreground.firstElementChild!).backgroundColor).toBe(
			'rgba(0, 0, 0, 0)'
		);
		expect(getComputedStyle(foreground.firstElementChild!).textShadow).toBe('none');
		expect(getComputedStyle(shadows.firstElementChild!).webkitTextStrokeWidth).toBe('0px');
		expect(getComputedStyle(shadows.firstElementChild!).textShadow).toContain('rgb(0, 255, 255)');
		expect(getComputedStyle(shadows.firstElementChild!).textDecorationLine).toBe('underline');
		expect(getComputedStyle(foreground.firstElementChild!).textDecorationLine).toBe('none');
		expect(shadows.getBoundingClientRect().toJSON()).toEqual(
			foreground.getBoundingClientRect().toJSON()
		);
		expect(paragraph.getBoundingClientRect().height).toBe(height);
		for (const blob of [
			await captureExportOverlayBlob(root, { scale: 1 }),
			new Blob([
				await captureMacOsOverlayPngBytes(root, 1, 800, 220, { compensateTextWeight: false })
			])
		]) {
			const image = await pixels(blob);
			let red = 0;
			let cyan = 0;
			for (let i = 0; i < image.data.length; i += 4) {
				if (image.data[i + 3] < 10) continue;
				if (image.data[i] > image.data[i + 1] + 50) red++;
				if (image.data[i + 1] > image.data[i] + 50 && image.data[i + 2] > image.data[i] + 50)
					cyan++;
			}
			expect(red).toBeGreaterThan(100);
			expect(cyan).toBeGreaterThan(100);
		}
	});

	it.each(['Georgia', 'EffectsHafs', 'EffectsQpc1'])(
		'retrace le contour de %s dans le chemin canvas macOS',
		async (font) => {
			const root = await createText(
				font,
				font === 'Georgia' ? 'Allah' : font === 'EffectsHafs' ? 'اللَّهِ' : verseGlyphs('1:2')
			);
			const paragraph = root.querySelector('p')!;
			paragraph.style.cssText += generateEffects({
				'outline-enable': true,
				'text-outline': 2,
				'text-outline-color': '#ff0000'
			});
			for (const scale of [1, 2]) {
				const image = await pixels(
					new Blob([
						await captureMacOsOverlayPngBytes(root, scale, 800 * scale, 220 * scale, {
							compensateTextWeight: false
						})
					])
				);
				let outline = 0;
				let fill = 0;
				for (let i = 0; i < image.data.length; i += 4) {
					if (image.data[i + 3] < 100) continue;
					if (image.data[i] > 200 && image.data[i + 1] < 80) outline++;
					if (image.data[i] > 245 && image.data[i + 1] > 245 && image.data[i + 2] > 245) fill++;
				}
				expect(outline).toBeGreaterThan(100);
				expect(fill).toBeGreaterThan(100);
			}
		}
	);
});
