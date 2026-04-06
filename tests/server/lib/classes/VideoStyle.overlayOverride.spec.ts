import { describe, expect, it } from 'vitest';

import { Category, Style, StylesData } from '$lib/classes/VideoStyle.svelte';

describe('StylesData overlay overrides on global target', () => {
	function createGlobalStylesData() {
		return new StylesData('global', [
			new Category({
				id: 'overlay',
				styles: [
					new Style({ id: 'overlay-opacity', value: 0.65 }),
					new Style({ id: 'overlay-enable', value: true })
				]
			}),
			new Category({
				id: 'general',
				styles: [new Style({ id: 'fade-duration', value: 500 })]
			})
		]);
	}

	it('allows per-clip override for global overlay styles', () => {
		const styles = createGlobalStylesData();
		styles.setStyleForClips([1001], 'overlay-opacity', 0.3);

		expect(styles.getEffectiveValue('overlay-opacity', 1001)).toBe(0.3);
		expect(styles.getEffectiveValue('overlay-opacity', 1002)).toBe(0.65);
		expect(styles.hasOverrideForAny([1001], 'overlay-opacity')).toBe(true);
	});

	it('rejects per-clip override for non-overlay global styles', () => {
		const styles = createGlobalStylesData();
		styles.setStyleForClips([1001], 'fade-duration', 750);

		expect(styles.getEffectiveValue('fade-duration', 1001)).toBe(500);
		expect(styles.hasOverrideForAny([1001], 'fade-duration')).toBe(false);
	});

	it('clears overlay override and falls back to global value', () => {
		const styles = createGlobalStylesData();
		styles.setStyleForClips([1001], 'overlay-enable', false);
		expect(styles.getEffectiveValue('overlay-enable', 1001)).toBe(false);

		styles.clearStyleForClips([1001], 'overlay-enable');
		expect(styles.getEffectiveValue('overlay-enable', 1001)).toBe(true);
		expect(styles.hasOverrideForAny([1001], 'overlay-enable')).toBe(false);
	});
});
