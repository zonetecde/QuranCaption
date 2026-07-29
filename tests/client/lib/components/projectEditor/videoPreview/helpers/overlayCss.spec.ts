import { describe, expect, test } from 'vitest';
import {
	getOverlayLayerCss,
	getBackgroundHorizontalPaddingCss,
	type OverlaySettings
} from '$lib/components/projectEditor/videoPreview/helpers/overlayCss';

/** Construit un OverlaySettings avec les valeurs par défaut de test. */
function makeSettings(overrides: Partial<OverlaySettings> = {}): OverlaySettings {
	return {
		enable: true,
		blur: 0,
		opacity: 0.5,
		color: '#000000',
		mode: 'uniform',
		fadeIntensity: 0,
		fadeCoverage: 0,
		fadeSoftness: 1,
		fadeCurve: 'linear',
		fadeInvert: false,
		fadePositionX: 0.5,
		fadePositionY: 0.5,
		fadeWidth: 1,
		fadeHeight: 1,
		customCSS: '',
		...overrides
	};
}

describe('overlayCss', () => {
	describe('getOverlayLayerCss', () => {
		// --- Mode uniforme ---
		test('mode uniforme : génère un background-color avec opacité', () => {
			const css = getOverlayLayerCss(makeSettings({ opacity: 0.5, color: '#000000' }));
			expect(css).toContain('background-color: #000000');
			expect(css).toContain('opacity: 0.5');
		});

		test('mode uniforme : clamp les opacités hors limites', () => {
			const css = getOverlayLayerCss(makeSettings({ opacity: 2.5 }));
			expect(css).toContain('opacity: 1');
		});

		test('mode uniforme : opacité négative clampée à 0', () => {
			const css = getOverlayLayerCss(makeSettings({ opacity: -0.5 }));
			expect(css).toContain('opacity: 0');
		});

		test('mode uniforme : couleur personnalisée respectée', () => {
			const css = getOverlayLayerCss(makeSettings({ color: '#FF0000' }));
			expect(css).toContain('background-color: #FF0000');
		});

		// --- Mode fade-up ---
		test('mode fade-up : génère un gradient linear-gradient vers le bas', () => {
			const css = getOverlayLayerCss(
				makeSettings({
					mode: 'fade-up',
					opacity: 1,
					color: '#FF0000',
					fadeIntensity: 0.5,
					fadeCoverage: 0.3
				})
			);
			expect(css).toContain('linear-gradient(to bottom');
			expect(css).toContain('rgba(255, 0, 0');
		});

		test('mode fade-up : avec fadeIntensity 0, edge et center ont la même opacité', () => {
			const css = getOverlayLayerCss(
				makeSettings({
					mode: 'fade-up',
					opacity: 1,
					color: '#FFFFFF',
					fadeIntensity: 0,
					fadeCoverage: 0.5
				})
			);
			// edgeOpacity = 1 * (1 - 0) = 1, centerOpacity = 1
			// Donc les deux rgba doivent avoir la même opacité
			expect(css).toContain('rgba(255, 255, 255, 1)');
		});

		// --- Mode fade-down ---
		test('mode fade-down : génère un gradient avec fondu vers le bas', () => {
			const css = getOverlayLayerCss(
				makeSettings({ mode: 'fade-down', opacity: 1, color: '#000' })
			);
			expect(css).toContain('linear-gradient(to bottom');
		});

		// --- Mode fade-center ---
		test('mode fade-center : génère un gradient avec fondu au centre', () => {
			const css = getOverlayLayerCss(
				makeSettings({ mode: 'fade-center', opacity: 1, color: '#000' })
			);
			expect(css).toContain('linear-gradient(to bottom');
		});

		test.each([
			['uniform', 'background-color'],
			['fade-up', 'linear-gradient(to bottom'],
			['fade-down', 'linear-gradient(to bottom'],
			['fade-center', 'linear-gradient(to bottom'],
			['fade-left', 'linear-gradient(to right'],
			['fade-right', 'linear-gradient(to left'],
			['fade-left-right', 'linear-gradient(to right'],
			['fade-top-bottom', 'linear-gradient(to bottom'],
			['fade-four-corners', 'radial-gradient'],
			['fade-four-sides', 'linear-gradient'],
			['fade-vignette', 'radial-gradient'],
			['fade-top-left', 'radial-gradient'],
			['fade-top-right', 'radial-gradient'],
			['fade-bottom-left', 'radial-gradient'],
			['fade-bottom-right', 'radial-gradient']
		])('mode %s : génère la géométrie attendue', (mode, expectedCss) => {
			const css = getOverlayLayerCss(
				makeSettings({
					mode,
					opacity: 0.8,
					fadeIntensity: 1,
					fadeCoverage: 0.75
				})
			);
			expect(css).toContain(expectedCss);
		});

		test.each([
			[
				'fade-up',
				'background: linear-gradient(to bottom, rgba(255, 0, 0, 0.5) 0%, rgba(255, 0, 0, 1) 30%, rgba(255, 0, 0, 1) 100%); opacity: 1;'
			],
			[
				'fade-down',
				'background: linear-gradient(to bottom, rgba(255, 0, 0, 1) 0%, rgba(255, 0, 0, 1) 70%, rgba(255, 0, 0, 0.5) 100%); opacity: 1;'
			],
			[
				'fade-center',
				'background: linear-gradient(to bottom, rgba(255, 0, 0, 0.5) 0%, rgba(255, 0, 0, 1) 15%, rgba(255, 0, 0, 1) 85%, rgba(255, 0, 0, 0.5) 100%); opacity: 1;'
			]
		])('mode historique %s : conserve son CSS par défaut', (mode, expectedCss) => {
			expect(
				getOverlayLayerCss(
					makeSettings({
						mode,
						opacity: 1,
						color: '#FF0000',
						fadeIntensity: 0.5,
						fadeCoverage: 0.3
					})
				)
			).toBe(expectedCss);
		});

		test('inverse les zones fortes et légères', () => {
			const normal = getOverlayLayerCss(
				makeSettings({
					mode: 'fade-left',
					fadeIntensity: 1,
					fadeCoverage: 1,
					fadeInvert: false
				})
			);
			const inverted = getOverlayLayerCss(
				makeSettings({
					mode: 'fade-left',
					fadeIntensity: 1,
					fadeCoverage: 1,
					fadeInvert: true
				})
			);
			expect(normal).toContain('rgba(0, 0, 0, 1) 0%');
			expect(inverted).toContain('rgba(0, 0, 0, 0) 0%');
		});

		test.each([
			['linear', 'rgba(0, 0, 0, 0.75) 25%'],
			['ease-in', 'rgba(0, 0, 0, 0.9375) 25%'],
			['ease-out', 'rgba(0, 0, 0, 0.5625) 25%'],
			['smooth', 'rgba(0, 0, 0, 0.84375) 25%']
		])('courbe %s : applique les stops normalisés', (fadeCurve, expectedStop) => {
			const css = getOverlayLayerCss(
				makeSettings({
					mode: 'fade-left',
					fadeIntensity: 1,
					fadeCoverage: 1,
					fadeCurve
				})
			);
			expect(css).toContain(expectedStop);
		});

		test('courbe inconnue : revient à linear', () => {
			const settings = {
				mode: 'fade-left',
				fadeIntensity: 1,
				fadeCoverage: 1
			};
			expect(getOverlayLayerCss(makeSettings({ ...settings, fadeCurve: 'unknown' }))).toBe(
				getOverlayLayerCss(makeSettings({ ...settings, fadeCurve: 'linear' }))
			);
		});

		test('softness 0 crée une transition nette à la fin de la couverture', () => {
			const css = getOverlayLayerCss(
				makeSettings({
					mode: 'fade-left',
					fadeIntensity: 1,
					fadeCoverage: 0.5,
					fadeSoftness: 0
				})
			);
			expect(css).toContain('rgba(0, 0, 0, 1) 50%');
			expect(css).toContain('rgba(0, 0, 0, 0) 50%');
		});

		test('clamp la position et les dimensions de la vignette', () => {
			const css = getOverlayLayerCss(
				makeSettings({
					mode: 'fade-vignette',
					fadePositionX: -1,
					fadePositionY: 2,
					fadeWidth: 0,
					fadeHeight: 5
				})
			);
			expect(css).toContain('ellipse 5% 100% at 0% 100%');
		});

		test('distingue les quatre coins, les quatre côtés et la vignette', () => {
			const corners = getOverlayLayerCss(makeSettings({ mode: 'fade-four-corners' }));
			const sides = getOverlayLayerCss(makeSettings({ mode: 'fade-four-sides' }));
			const vignette = getOverlayLayerCss(makeSettings({ mode: 'fade-vignette' }));

			expect(corners).toContain('mask-size: 50% 50%');
			expect(corners).toContain('left top, right top, left bottom, right bottom');
			expect(sides).toContain('mask-composite: add');
			expect(sides).not.toContain('border');
			expect(vignette).toContain('radial-gradient(ellipse');
			expect(vignette).not.toContain('mask-size: 50% 50%');
		});

		// --- Mode inconnu / fallback ---
		test('mode inconnu : fallback sur le mode uniforme', () => {
			const css = getOverlayLayerCss(
				makeSettings({ mode: 'unknown', opacity: 0.5, color: '#333333' })
			);
			expect(css).toContain('background-color: #333333');
			expect(css).toContain('opacity: 0.5');
		});

		// --- Mode par défaut (vide) ---
		test('mode undefined : traité comme uniform', () => {
			const settings = makeSettings({ opacity: 1, color: '#111' });
			delete (settings as { mode?: string }).mode;
			const css = getOverlayLayerCss(settings);
			expect(css).toContain('background-color: #111');
		});
	});

	describe('getBackgroundHorizontalPaddingCss', () => {
		test('retourne une chaîne vide si le fond est désactivé', () => {
			expect(getBackgroundHorizontalPaddingCss(false, 10)).toBe('');
		});

		test('retourne une chaîne vide si le padding est 0', () => {
			expect(getBackgroundHorizontalPaddingCss(true, 0)).toBe('');
		});

		test('retourne une chaîne vide si le padding est négatif', () => {
			expect(getBackgroundHorizontalPaddingCss(true, -5)).toBe('');
		});

		test('retourne une chaîne vide si le padding est NaN', () => {
			expect(getBackgroundHorizontalPaddingCss(true, NaN)).toBe('');
		});

		test('retourne une chaîne vide si le padding est Infinity', () => {
			expect(getBackgroundHorizontalPaddingCss(true, Infinity)).toBe('');
		});

		test('retourne le padding correct si activé avec une valeur positive', () => {
			const css = getBackgroundHorizontalPaddingCss(true, 15);
			expect(css).toContain('padding-left: 15px');
			expect(css).toContain('padding-right: 15px');
		});

		test('retourne le padding pour une valeur fractionnaire', () => {
			const css = getBackgroundHorizontalPaddingCss(true, 5.5);
			expect(css).toContain('padding-left: 5.5px');
			expect(css).toContain('padding-right: 5.5px');
		});
	});
});
