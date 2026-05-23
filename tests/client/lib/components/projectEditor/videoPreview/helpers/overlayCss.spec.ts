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
