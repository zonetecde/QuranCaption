import { globalState } from '$lib/runes/main.svelte';
import { Utilities } from '../misc/Utilities';
import type { RawCategoryDefinition } from '$lib/services/StyleDefinitionCatalog';
import type { Style } from './Style.svelte.js';
import type { StylesData } from './StylesData.svelte.js';
import type { OverlayStyleName, StyleKeyframe, StyleName } from './types.js';

/**
 * Retourne les catégories compatibles avec les traductions.
 * @param {RawCategoryDefinition[]} categories Categories source.
 * @returns {RawCategoryDefinition[]} Categories compatibles avec une traduction.
 */
export function getNonArabicSubtitleCategories(
	categories: RawCategoryDefinition[]
): RawCategoryDefinition[] {
	return categories;
}

export const GLOBAL_OVERLAY_STYLE_IDS = new Set<OverlayStyleName>([
	'overlay-enable',
	'overlay-color',
	'overlay-opacity',
	'background-overlay-mode',
	'background-overlay-fade-intensity',
	'background-overlay-fade-coverage',
	'background-overlay-fade-softness',
	'background-overlay-fade-curve',
	'background-overlay-fade-invert',
	'background-overlay-fade-position-x',
	'background-overlay-fade-position-y',
	'background-overlay-fade-width',
	'background-overlay-fade-height',
	'overlay-custom-css',
	'overlay-blur'
]);

export const RUNTIME_LAYOUT_STYLE_IDS = new Set<StyleName>([
	'reactive-font-size',
	'reactive-y-position'
]);

export const styleLookupCache = new WeakMap<StylesData, Map<StyleName, Style>>();

/**
 * Résout la dernière image clé atteinte ou conserve la valeur de repli.
 * @param {StyleKeyframe[]} keyframes Images clés ordonnées dans le temps.
 * @param {number} time Position absolue dans la timeline, en millisecondes.
 * @param {Style['value']} fallback Valeur utilisée avant la première image clé.
 * @returns {Style['value']} Valeur active à la position demandée.
 */
export function resolveKeyframeValue(
	keyframes: StyleKeyframe[],
	time: number,
	fallback: Style['value']
): Style['value'] {
	let value = fallback;
	for (const keyframe of keyframes) {
		if (keyframe.time > time) break;
		value = keyframe.value;
	}
	return value;
}

/**
 * Retourne la durée de fondu des images clés uniquement dans la preview interactive.
 * @returns {number} Durée du fondu en millisecondes, ou zéro pendant l'export.
 */
export function getPreviewKeyframeFadeDuration(): number {
	if (typeof window === 'undefined' || window.location.pathname.includes('/exporter')) return 0;
	const fadeStyle = globalState.currentProject?.content?.videoStyle
		?.getStylesOfTarget('global')
		.findStyle('fade-duration');
	return Math.max(0, Number(fadeStyle?.value ?? 0));
}

/**
 * Calcule la transition qui se termine sur la prochaine image clé.
 * @param {StyleKeyframe[]} keyframes Images clés ordonnées.
 * @param {number} time Temps courant en millisecondes.
 * @param {Style['value']} fallback Valeur précédant la première image clé.
 * @param {number} fadeDuration Durée du fondu en millisecondes.
 * @returns {{ from: Style['value']; to: Style['value']; progress: number } | null} Transition active.
 */
export function getActiveKeyframeTransition(
	keyframes: StyleKeyframe[],
	time: number,
	fallback: Style['value'],
	fadeDuration: number
): { from: Style['value']; to: Style['value']; progress: number } | null {
	if (fadeDuration <= 0) return null;
	let from = fallback;
	for (const keyframe of keyframes) {
		if (time > keyframe.time) {
			from = keyframe.value;
			continue;
		}
		const fadeStart = keyframe.time - fadeDuration;
		if (time < fadeStart) return null;
		return {
			from,
			to: keyframe.value,
			progress: Utilities.clamp01((time - fadeStart) / fadeDuration)
		};
	}
	return null;
}

/**
 * Lit le canal alpha d'une couleur CSS prise en charge par l'éditeur.
 * @param {string} color Couleur hexadécimale, RGB ou RGBA.
 * @returns {number} Alpha normalisé entre zéro et un.
 */
export function getCssColorAlpha(color: string): number {
	const normalized = color.trim();
	const rgba = normalized.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)$/i);
	if (rgba) return Utilities.clamp01(Number(rgba[1]));
	if (/^#[0-9a-f]{8}$/i.test(normalized)) return parseInt(normalized.slice(7, 9), 16) / 255;
	return 1;
}

/**
 * Interpole deux couleurs CSS vers une valeur RGBA.
 * @param {string} fromColor Couleur de départ.
 * @param {string} toColor Couleur d'arrivée.
 * @param {number} progress Progression normalisée.
 * @returns {string} Couleur interpolée, ou couleur cible à la fin du fondu.
 */
export function interpolateKeyframeColor(
	fromColor: string,
	toColor: string,
	progress: number
): string {
	if (progress <= 0) return fromColor;
	if (progress >= 1) return toColor;
	const from = Utilities.parseColorToRgb(fromColor);
	const to = Utilities.parseColorToRgb(toColor);
	const mix = (start: number, end: number) => start + (end - start) * progress;
	return `rgba(${Math.round(mix(from[0], to[0]))}, ${Math.round(mix(from[1], to[1]))}, ${Math.round(mix(from[2], to[2]))}, ${Number(mix(getCssColorAlpha(fromColor), getCssColorAlpha(toColor)).toFixed(3))})`;
}

/**
 * Résout une valeur avec interpolation limitée aux couleurs et aux opacités.
 * @param {Style} style Style décrivant la valeur.
 * @param {StyleKeyframe[]} keyframes Images clés à résoudre.
 * @param {number} time Temps courant en millisecondes.
 * @param {Style['value']} fallback Valeur précédant la première image clé.
 * @param {number} fadeDuration Durée du fondu en millisecondes.
 * @returns {Style['value']} Valeur interpolée ou valeur par paliers.
 */
export function resolvePreviewKeyframeValue(
	style: Style,
	keyframes: StyleKeyframe[],
	time: number,
	fallback: Style['value'],
	fadeDuration: number
): Style['value'] {
	const transition = getActiveKeyframeTransition(keyframes, time, fallback, fadeDuration);
	if (!transition) return resolveKeyframeValue(keyframes, time, fallback);
	if (
		style.valueType === 'color' &&
		typeof transition.from === 'string' &&
		typeof transition.to === 'string'
	) {
		return interpolateKeyframeColor(transition.from, transition.to, transition.progress);
	}
	if (
		style.id.includes('opacity') &&
		typeof transition.from === 'number' &&
		typeof transition.to === 'number'
	) {
		return transition.from + (transition.to - transition.from) * transition.progress;
	}
	return resolveKeyframeValue(keyframes, time, fallback);
}

/**
 * Résout un changement de visibilité sous forme d'opacité.
 * @param {StyleKeyframe[]} keyframes Images clés booléennes.
 * @param {number} time Temps courant en millisecondes.
 * @param {Style['value']} fallback Visibilité précédant la première image clé.
 * @param {number} fadeDuration Durée du fondu en millisecondes.
 * @returns {number} Opacité de visibilité entre zéro et un.
 */
export function resolveKeyframeVisibilityOpacity(
	keyframes: StyleKeyframe[],
	time: number,
	fallback: Style['value'],
	fadeDuration: number
): number {
	const transition = getActiveKeyframeTransition(keyframes, time, fallback, fadeDuration);
	if (!transition) return resolveKeyframeValue(keyframes, time, fallback) ? 1 : 0;
	const from = transition.from ? 1 : 0;
	const to = transition.to ? 1 : 0;
	return from + (to - from) * transition.progress;
}

/**
 * Collecte récursivement les temps d'un style et de ses sous-styles composites.
 * @param {Style} style Style racine à parcourir.
 * @returns {number[]} Temps trouvés en millisecondes.
 */
export function collectStyleKeyframeTimes(style: Style): number[] {
	const ownTimes = style.keyframes.map((keyframe) => keyframe.time);
	if (style.valueType !== 'composite' || !Array.isArray(style.value)) return ownTimes;
	const nestedTimes = (style.value as Style[]).flatMap(collectStyleKeyframeTimes);
	return [...ownTimes, ...nestedTimes];
}

/**
 * Vérifie si un style appartient aux réglages globaux de l'overlay.
 * @param {StyleName} styleId Identifiant du style à vérifier.
 * @returns {boolean} `true` lorsque l'identifiant désigne un style d'overlay global.
 */
export function isGlobalOverlayStyleId(styleId: StyleName): styleId is OverlayStyleName {
	return GLOBAL_OVERLAY_STYLE_IDS.has(styleId as OverlayStyleName);
}
