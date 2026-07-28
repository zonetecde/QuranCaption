import type { StyleName, StylesData } from '$lib/classes/VideoStyle.svelte';

export type OverlayVisualState = {
	enable: boolean;
	blur: number;
	opacity: number;
	color: string;
	mode: string;
	fadeIntensity: number;
	fadeCoverage: number;
	fadeSoftness: number;
	fadeCurve: string;
	fadeInvert: boolean;
	fadePositionX: number;
	fadePositionY: number;
	fadeWidth: number;
	fadeHeight: number;
	customCSS: string;
};

export type TimedVisualState = {
	enabled: boolean;
	alwaysShow: boolean;
	startTime: number;
	endTime: number;
};

export type TimedStyleIds = {
	enabled?: StyleName;
	alwaysShow: StyleName;
	startTime: StyleName;
	endTime: StyleName;
};

export type ResolveStyleValue = (styleId: string) => string | number | boolean;

/**
 * Résout tous les paramètres visuels de l'overlay pour un clip vidéo.
 * @param {StylesData} styles Styles globaux effectifs.
 * @param {number | undefined} clipId Clip portant les overrides éventuels.
 * @returns {OverlayVisualState} État unique consommable par l'aperçu et l'export.
 */
export function resolveOverlayVisualState(styles: StylesData, clipId?: number): OverlayVisualState {
	const fadeSoftness = styles.getEffectiveValue('background-overlay-fade-softness', clipId);
	const fadeCurve = styles.getEffectiveValue('background-overlay-fade-curve', clipId);
	const fadePositionX = styles.getEffectiveValue('background-overlay-fade-position-x', clipId);
	const fadePositionY = styles.getEffectiveValue('background-overlay-fade-position-y', clipId);
	const fadeWidth = styles.getEffectiveValue('background-overlay-fade-width', clipId);
	const fadeHeight = styles.getEffectiveValue('background-overlay-fade-height', clipId);

	return {
		enable: Boolean(styles.getEffectiveValue('overlay-enable', clipId)),
		blur: Number(styles.getEffectiveValue('overlay-blur', clipId)),
		opacity: Number(styles.getEffectiveValue('overlay-opacity', clipId)),
		color: String(styles.getEffectiveValue('overlay-color', clipId)),
		mode: String(styles.getEffectiveValue('background-overlay-mode', clipId)),
		fadeIntensity: Number(styles.getEffectiveValue('background-overlay-fade-intensity', clipId)),
		fadeCoverage: Number(styles.getEffectiveValue('background-overlay-fade-coverage', clipId)),
		fadeSoftness: fadeSoftness === '' ? 1 : Number(fadeSoftness),
		fadeCurve: fadeCurve === '' ? 'linear' : String(fadeCurve),
		fadeInvert: Boolean(styles.getEffectiveValue('background-overlay-fade-invert', clipId)),
		fadePositionX: fadePositionX === '' ? 0.5 : Number(fadePositionX),
		fadePositionY: fadePositionY === '' ? 0.5 : Number(fadePositionY),
		fadeWidth: fadeWidth === '' ? 1 : Number(fadeWidth),
		fadeHeight: fadeHeight === '' ? 1 : Number(fadeHeight),
		customCSS: String(styles.getEffectiveValue('overlay-custom-css', clipId))
	};
}

/**
 * Résout la visibilité temporelle d'un élément stylé.
 * @param {StylesData} styles Styles portant les valeurs effectives.
 * @param {TimedStyleIds} ids Identifiants décrivant l'élément.
 * @param {number | undefined} clipId Clip portant les overrides éventuels.
 * @returns {TimedVisualState} État temporel normalisé.
 */
export function resolveTimedVisualState(
	styles: StylesData,
	ids: TimedStyleIds,
	clipId?: number
): TimedVisualState {
	return {
		enabled: ids.enabled ? Boolean(styles.getEffectiveValue(ids.enabled, clipId)) : true,
		alwaysShow: Boolean(styles.getEffectiveValue(ids.alwaysShow, clipId)),
		startTime: Number(styles.getEffectiveValue(ids.startTime, clipId)),
		endTime: Number(styles.getEffectiveValue(ids.endTime, clipId))
	};
}

/**
 * Indique si au moins un effet WBW nécessite le rendu mot à mot.
 * @param {ResolveStyleValue} getStyleValue Lecteur de styles effectifs.
 * @returns {boolean} `true` si un effet WBW est actif.
 */
export function isWordByWordVisualEnabled(getStyleValue: ResolveStyleValue): boolean {
	const currentWordCustomCss = String(getStyleValue('wbw-current-word-custom-css') ?? '').trim();
	return (
		Boolean(getStyleValue('wbw-show-current-word-only')) ||
		Boolean(getStyleValue('enable-wbw-highlight')) ||
		Boolean(getStyleValue('enable-wbw-underline')) ||
		Boolean(getStyleValue('enable-wbw-glow')) ||
		Boolean(getStyleValue('wbw-reveal-specific-word-style')) ||
		Boolean(getStyleValue('wbw-reveal-on-recitation')) ||
		Boolean(getStyleValue('enable-wbw-background')) ||
		Boolean(getStyleValue('enable-wbw-line-background')) ||
		currentWordCustomCss.length > 0 ||
		Boolean(getStyleValue('enable-wbw-current-word-opacity'))
	);
}
