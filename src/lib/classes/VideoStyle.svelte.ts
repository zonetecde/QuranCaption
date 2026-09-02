import { globalState } from '$lib/runes/main.svelte';
import { CustomTextClip, SubtitleClip } from '.';
import { ProjectEditorTabs, TrackType } from './enums';
import { SerializableBase } from './misc/SerializableBase';
import { Utilities } from './misc/Utilities';
import { CustomTextTrack } from './Track.svelte';
import QPCFontProvider from '$lib/services/FontProvider';
import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import ModalManager from '$lib/components/modals/ModalManager';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import { PredefinedSubtitleClip, getForcedFontForPredefinedSubtitle } from './Clip.svelte';
import type { ProjectContent } from './ProjectContent.svelte';
import {
	loadCompositeStyleDefinitions,
	loadCustomStyleCategoryDefinition,
	loadStyleCategoryDefinitions,
	type RawCategoryDefinition
} from '$lib/services/StyleDefinitionCatalog';
import {
	ensureCustomStyleSchema,
	exportCustomStyleClips,
	getCustomCompositeStyles
} from '$lib/services/ProjectStyleContentService';
import {
	applyStylePresetToProject,
	getPresetTranslationTargets
} from '$lib/services/StylePresetApplicationService';
import { getRiwayahFontFamily, isNonHafsRiwayah } from '$lib/services/RiwayahProvider';
import {
	getTimedOverlayRangesFromStyles,
	type TimedOverlayRange
} from '$lib/services/TimedOverlayRanges';

export type StyleValueType =
	| 'color'
	| 'number'
	| 'select'
	| 'brackets-font'
	| 'boolean'
	| 'text'
	| 'time'
	| 'dimension'
	| 'fade'
	| 'composite'
	| 'reciter'
	| 'file'
	| 'ayah-image'
	| 'time-ranges';

// Types spécifiques pour les catégories de styles
export type StyleCategoryName =
	| 'text'
	| 'positioning'
	| 'background'
	| 'shadow'
	| 'outline'
	| 'border'
	| 'line-background'
	| 'effects'
	| 'word-by-word-highlight'
	| 'general'
	| 'general'
	| 'overlay'
	| 'surah-name'
	| 'reciter-name'
	| 'verse-number'
	| 'ayah-container'
	| 'creator-text';

// Types spécifiques pour chaque catégorie de styles
export type GeneralStyleName =
	| 'show-subtitles'
	| 'show-verse-number'
	| 'verse-number-new-line'
	| 'show-decorative-brackets'
	| 'decorative-brackets-font-family'
	| 'riwayah'
	| 'mushaf-style'
	| 'basmala-style'
	| 'basmala-scale'
	| 'verse-number-format'
	| 'verse-number-position'
	| 'verse-number-numeral-system'
	| 'text-direction';

export type GlobalAnimationStyleName =
	| 'video-dimension'
	| 'media-fill'
	| 'media-scale'
	| 'media-position-x'
	| 'media-position-y'
	| 'fade-duration'
	| 'video-and-audio-fade'
	| 'video-clip-transition'
	| 'video-clip-transition-duration'
	| 'anti-collision'
	| 'spacing';

export type TextStyleName =
	| 'text-color'
	| 'verse-number-color'
	| 'font-size'
	| 'font-family'
	| 'font-weight'
	| 'enable-italic'
	| 'text-transform'
	| 'letter-spacing'
	| 'word-spacing'
	| 'line-height'
	| 'max-height'
	| 'max-line'
	| 'reactive-font-size'
	| 'reactive-y-position'
	| 'text-glow-enable'
	| 'text-glow-color'
	| 'text-glow-blur';

export type PositioningStyleName =
	| 'vertical-position'
	| 'horizontal-position'
	| 'width'
	| 'horizontal-text-alignment'
	| 'vertical-text-alignment';

export type BackgroundStyleName =
	| 'background-enable'
	| 'always-show'
	| 'time-appearance'
	| 'time-disappearance'
	| 'background-color'
	| 'background-opacity'
	| 'border-radius'
	| 'background-horizontal-padding';

export type ShadowStyleName =
	| 'shadow-enable'
	| 'text-shadow'
	| 'text-shadow-color'
	| 'box-shadow'
	| 'box-shadow-color';

export type OutlineStyleName = 'outline-enable' | 'text-outline' | 'text-outline-color';

export type BorderStyleName = 'border-enable' | 'border-width' | 'border-color' | 'border-style';

export type EffectsStyleName = 'opacity' | 'blur' | 'brightness' | 'contrast';

export type LineBackgroundStyleName =
	| 'line-background-enable'
	| 'line-background-color'
	| 'line-background-position'
	| 'line-background-height';

export type AnimationStyleName = 'scale' | 'rotation';

export type TimedOverlayStyleName =
	| 'time-ranges'
	| 'surah-name-time-ranges'
	| 'reciter-name-time-ranges'
	| 'ayah-container-time-ranges';

export type StyleOverrideValue = string | number | boolean | TimedOverlayRange[];

export type StyleKeyframe = {
	time: number;
	value: Style['value'];
};

export type WordByWordHighlightStyleName =
	| 'enable-wbw-highlight'
	| 'wbw-show-current-word-only'
	| 'wbw-color'
	| 'wbw-persist-color'
	| 'wbw-reveal-specific-word-style'
	| 'wbw-keep-specific-word-style'
	| 'wbw-reveal-on-recitation'
	| 'enable-wbw-background'
	| 'enable-wbw-line-background'
	| 'wbw-line-background-color'
	| 'wbw-line-background-position'
	| 'wbw-line-background-height'
	| 'wbw-line-background-padding'
	| 'enable-wbw-underline'
	| 'enable-wbw-glow'
	| 'wbw-bg-color'
	| 'wbw-glow-color'
	| 'wbw-glow-blur'
	| 'wbw-underline-thickness'
	| 'wbw-always-show-verse-number'
	| 'enable-wbw-current-word-opacity'
	| 'wbw-current-word-custom-css'
	| 'wbw-current-word-opacity';

export type OverlayStyleName =
	| 'overlay-enable'
	| 'overlay-color'
	| 'overlay-opacity'
	| 'background-overlay-mode'
	| 'background-overlay-fade-intensity'
	| 'background-overlay-fade-coverage'
	| 'background-overlay-fade-softness'
	| 'background-overlay-fade-curve'
	| 'background-overlay-fade-invert'
	| 'background-overlay-fade-position-x'
	| 'background-overlay-fade-position-y'
	| 'background-overlay-fade-width'
	| 'background-overlay-fade-height'
	| 'overlay-custom-css'
	| 'overlay-blur'
	| 'video-frame-enable'
	| 'video-frame-content-above'
	| 'video-frame-color'
	| 'video-frame-vertical-size'
	| 'video-frame-horizontal-size'
	| 'video-frame-radius'
	| 'video-frame-softness';

export type SurahNameStyleName =
	| 'show-surah-name'
	| 'surah-name-always-show'
	| 'surah-name-format'
	| 'surah-name-time-appearance'
	| 'surah-name-time-disappearance'
	| 'surah-show-arabic'
	| 'surah-name-vertical-position'
	| 'surah-name-horizontal-position'
	| 'surah-show-latin'
	| 'surah-calligraphy-style'
	| 'surah-size'
	| 'surah-opacity'
	| 'surah-latin-spacing'
	| 'surah-latin-text-style';

export type ReciterNameStyleName =
	| 'show-reciter-name'
	| 'reciter-name-always-show'
	| 'reciter-name-format'
	| 'reciter-name-time-appearance'
	| 'reciter-name-time-disappearance'
	| 'reciter-show-arabic'
	| 'reciter-name-vertical-position'
	| 'reciter-name-horizontal-position'
	| 'reciter-show-latin'
	| 'reciter-size'
	| 'reciter-opacity'
	| 'reciter-latin-spacing'
	| 'reciter-latin-text-style';

// Nouvelle définition pour les styles du Creator Text
export type CreatorTextStyleName = 'creator-text' | 'creator-text-composite';

export type CustomTextStyleName =
	| 'time-appearance'
	| 'time-disappearance'
	| 'text'
	| 'filepath'
	| 'opacity'
	| 'above-overlay'
	| 'always-show'
	| 'custom-css'
	| 'custom-text-composite';

export type VerseNumberStyleName =
	| 'verse-number'
	| 'show-verse-number'
	| 'verse-number-vertical-position'
	| 'verse-number-horizontal-position'
	| 'verse-number-format'
	| 'verse-number-text-style';

export type AyahContainerStyleName =
	| 'ayah-container-image'
	| 'ayah-container-vertical-position'
	| 'ayah-container-horizontal-position'
	| 'always-show'
	| 'time-appearance'
	| 'time-disappearance'
	| 'ayah-container-width'
	| 'ayah-container-height'
	| 'ayah-container-stretch';

// Union type pour tous les noms de styles
export type StyleName =
	| GeneralStyleName
	| TextStyleName
	| PositioningStyleName
	| BackgroundStyleName
	| ShadowStyleName
	| OutlineStyleName
	| BorderStyleName
	| EffectsStyleName
	| LineBackgroundStyleName
	| AnimationStyleName
	| TimedOverlayStyleName
	| WordByWordHighlightStyleName
	| OverlayStyleName
	| SurahNameStyleName
	| ReciterNameStyleName
	| CreatorTextStyleName
	| CustomTextStyleName
	| GlobalAnimationStyleName
	| VerseNumberStyleName
	| AyahContainerStyleName;

export type StyleEditorPanelMetadata = {
	id: string;
	icon: string;
	label: string;
	order: number;
	categoryOrder: number;
	categoryNavigation?: boolean;
};

export type StyleEditorGroupMetadata = {
	id: string;
	styleIds: string[];
	shared?: boolean;
};

export type StyleCategoryUiMetadata = {
	panel: StyleEditorPanelMetadata;
	groups?: StyleEditorGroupMetadata[];
	headerStyle?: string;
};

/**
 * Retourne les catégories compatibles avec les traductions.
 * @param {RawCategoryDefinition[]} categories Categories source.
 * @returns {RawCategoryDefinition[]} Categories compatibles avec une traduction.
 */
function getNonArabicSubtitleCategories(
	categories: RawCategoryDefinition[]
): RawCategoryDefinition[] {
	return categories;
}

const GLOBAL_OVERLAY_STYLE_IDS = new Set<OverlayStyleName>([
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

const RUNTIME_LAYOUT_STYLE_IDS = new Set<StyleName>(['reactive-font-size', 'reactive-y-position']);

const styleLookupCache = new WeakMap<StylesData, Map<StyleName, Style>>();

/**
 * Résout la dernière image clé atteinte ou conserve la valeur de repli.
 * @param {StyleKeyframe[]} keyframes Images clés ordonnées dans le temps.
 * @param {number} time Position absolue dans la timeline, en millisecondes.
 * @param {Style['value']} fallback Valeur utilisée avant la première image clé.
 * @returns {Style['value']} Valeur active à la position demandée.
 */
function resolveKeyframeValue(
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
function getPreviewKeyframeFadeDuration(): number {
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
function getActiveKeyframeTransition(
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
function getCssColorAlpha(color: string): number {
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
function interpolateKeyframeColor(fromColor: string, toColor: string, progress: number): string {
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
function resolvePreviewKeyframeValue(
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
function resolveKeyframeVisibilityOpacity(
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
function collectStyleKeyframeTimes(style: Style): number[] {
	const ownTimes = style.keyframes.map((keyframe) => keyframe.time);
	if (style.valueType !== 'composite' || !Array.isArray(style.value)) return ownTimes;
	const nestedTimes = (style.value as Style[]).flatMap(collectStyleKeyframeTimes);
	return [...ownTimes, ...nestedTimes];
}

function isGlobalOverlayStyleId(styleId: StyleName): styleId is OverlayStyleName {
	return GLOBAL_OVERLAY_STYLE_IDS.has(styleId as OverlayStyleName);
}

export class Style extends SerializableBase {
	id: string = $state('');
	name: string = '';
	description: string = '';
	value:
		| string
		| number
		| boolean
		| { width: number; height: number }
		| {
				fadeDurationMs: number;
				videoFadeInEnabled: boolean;
				videoFadeOutEnabled: boolean;
				audioFadeInEnabled: boolean;
				audioFadeOutEnabled: boolean;
		  }
		| TimedOverlayRange[]
		| Style[] = $state('');
	valueType: StyleValueType = 'text';
	valueMin?: number = $state(-540);
	valueMax?: number = $state(540);
	step?: number;
	options?: string[];
	css: string = '';
	tailwind?: boolean;
	tailwindClass?: string;
	icon: string = '';
	keyframes: StyleKeyframe[] = $state([]);

	constructor(init?: Partial<Style>) {
		super();
		if (!init) return;
		Object.assign(this, init);
	}

	/**
	 * Ajoute ou remplace l'image clé située au temps demandé.
	 * @param {number} time Position absolue dans la timeline, en millisecondes.
	 * @param {Style['value']} value Valeur active à partir de cette position.
	 * @returns {void}
	 */
	setKeyframe(time: number, value: Style['value']): void {
		const normalizedTime = Math.max(0, Math.floor(time));
		const existing = this.keyframes.find((keyframe) => keyframe.time === normalizedTime);
		if (existing) existing.value = value;
		else this.keyframes.push({ time: normalizedTime, value });
		this.keyframes.sort((a, b) => a.time - b.time);
	}

	/**
	 * Résout la valeur active à une position de la timeline.
	 * @param {number} time Position absolue dans la timeline, en millisecondes.
	 * @returns {Style['value']} Valeur de base ou dernière image clé atteinte.
	 */
	getValueAt(time: number, fadeDuration = getPreviewKeyframeFadeDuration()): Style['value'] {
		return resolvePreviewKeyframeValue(this, this.keyframes, time, this.value, fadeDuration);
	}

	/**
	 * Résout les images clés booléennes sous forme d'opacité de visibilité.
	 * @param {number} time Position absolue dans la timeline.
	 * @param {number} fadeDuration Durée du fondu en millisecondes.
	 * @returns {number} Opacité entre zéro et un.
	 */
	getVisibilityOpacityAt(time: number, fadeDuration = getPreviewKeyframeFadeDuration()): number {
		return resolveKeyframeVisibilityOpacity(this.keyframes, time, this.value, fadeDuration);
	}

	/**
	 * Indique si une image clé existe au temps demandé.
	 * @param {number} time Position absolue dans la timeline, en millisecondes.
	 * @returns {boolean} `true` si le temps contient une image clé.
	 */
	hasKeyframeAt(time: number): boolean {
		const normalizedTime = Math.max(0, Math.floor(time));
		return this.keyframes.some((keyframe) => keyframe.time === normalizedTime);
	}

	/**
	 * Supprime l'image clé située au temps demandé.
	 * @param {number} time Position absolue dans la timeline, en millisecondes.
	 * @returns {void}
	 */
	removeKeyframe(time: number): void {
		const normalizedTime = Math.max(0, Math.floor(time));
		this.keyframes = this.keyframes.filter((keyframe) => keyframe.time !== normalizedTime);
	}

	/**
	 * Retourne l'image clé précédant strictement la position courante.
	 * @param {number} time Position absolue dans la timeline, en millisecondes.
	 * @returns {number | undefined} Temps précédent, ou `undefined`.
	 */
	getPreviousKeyframeTime(time: number): number | undefined {
		return this.keyframes.findLast((keyframe) => keyframe.time < time)?.time;
	}

	/**
	 * Retourne l'image clé suivant strictement la position courante.
	 * @param {number} time Position absolue dans la timeline, en millisecondes.
	 * @returns {number | undefined} Temps suivant, ou `undefined`.
	 */
	getNextKeyframeTime(time: number): number | undefined {
		return this.keyframes.find((keyframe) => keyframe.time > time)?.time;
	}

	getCategory(): string {
		for (const category of globalState.getVideoStyle.getStylesOfTarget('arabic').categories) {
			if (category.styles.some((style) => style.id === this.id)) {
				return category.id;
			}
		}
		for (const category of globalState.getVideoStyle.getStylesOfTarget('global').categories) {
			if (category.styles.some((style) => style.id === this.id)) {
				return category.id;
			}
		}
		return '';
	}

	/**
	 * Méthode utile uniquement si valueType est composite.
	 * Génère le CSS d'un style composite
	 * @returns Le CSS de ce style composite
	 */
	generateCSSForComposite(time?: number): string {
		// Récupère tous les styles composites pour un style donné
		const compositeStyles = this.value as Style[];
		const currentTime =
			time ?? globalState.currentProject?.projectEditorState?.timeline.cursorPosition ?? 0;

		let css = '';
		for (let i = 0; i < compositeStyles.length; i++) {
			const element = compositeStyles[i];
			const effectiveValue = element.getValueAt(currentTime);

			if (element.id === 'outline-enable' && !effectiveValue) {
				// Si on désactive l'outline, alors on skip les 3 styles concernant l'outline
				// (en comptant celui là)
				i += 2;
				continue;
			}

			if (element.id === 'text-glow-enable' && !effectiveValue) {
				// Si on désactive le glow, alors on skip les 3 styles concernant le glow
				// (en comptant celui là)
				i += 2;
				continue;
			}

			if (element.id === 'enable-italic' && !effectiveValue) {
				continue;
			}

			if (element.id && element.css)
				css += element.css.replaceAll('{value}', String(effectiveValue)) + '\n';
		}

		return css;
	}

	/**
	 * Méthode utile uniquement si valueType est composite.
	 * @param styleId Le nom du style
	 * @param value La nouvelle valeur à appliquer
	 */
	setCompositeStyleValue(styleId: StyleName, value: string | number | boolean) {
		if (this.valueType === 'composite') {
			const style = this.getCompositeStyle(styleId);
			if (style) {
				style.value = value;
			}
		}
	}

	/**
	 * Méthode utile uniquement si valueType est composite.
	 * Récupère un style composite par son ID
	 * @param styleId L'ID du style à récupérer
	 * @returns Le style composite correspondant ou undefined
	 */
	getCompositeStyle(styleId: StyleName): Style | undefined {
		if (this.valueType === 'composite' && this.value instanceof Array) {
			const v = (this.value as Style[]).find((s) => s.id === styleId);
			if (v) return v;
		}

		// Le style composite n'a toujours pas été chargé
		return new Style({ id: styleId, value: 0 });
	}
}

export class Category extends SerializableBase {
	id: string = $state('');
	name: string = '';
	description: string = '';
	icon: string = '';
	styles: Style[] = $state([]);
	declare ui?: StyleCategoryUiMetadata;

	constructor(init?: Partial<Category> | RawCategoryDefinition) {
		super();
		if (!init) return;
		// assign simples
		const { styles, ui, ...rest } = init;
		Object.assign(this, rest);
		this.setUiMetadata(ui);

		// s'assurer que les styles sont des instances de Style
		if (Array.isArray(styles)) {
			this.styles = styles.map((s) => (s instanceof Style ? s : new Style(s)));
		}
	}

	/**
	 * Attache les métadonnées d'éditeur sans les sérialiser dans le projet.
	 * @param {StyleCategoryUiMetadata | undefined} ui Métadonnées issues du JSON statique.
	 * @returns {void}
	 */
	setUiMetadata(ui: StyleCategoryUiMetadata | undefined): void {
		Object.defineProperty(this, 'ui', {
			configurable: true,
			enumerable: false,
			writable: true,
			value: ui
		});
	}

	getStyle(styleId: StyleName): Style | undefined {
		return this.styles.find((style) => style.id === styleId);
	}

	getCompositeStyle(): Style | undefined {
		for (const style of this.styles) {
			if (style.valueType === 'composite') {
				return style;
			}
		}
		return undefined;
	}

	/**
	 * Collecte les images clés de tous les styles de la catégorie.
	 * @returns {number[]} Temps trouvés en millisecondes.
	 */
	getAllKeyframeTimes(): number[] {
		return this.styles.flatMap(collectStyleKeyframeTimes);
	}

	/**
	 * Si la catégorie contient un style composite, le load avec
	 * ses valeurs par défaut.
	 */
	async loadCompositeStyle() {
		for (const style of this.styles) {
			if (style.valueType === 'composite' && !(style.value instanceof Array)) {
				// Charge les styles composites (JSON brut)
				const raw = await loadCompositeStyleDefinitions();
				// Transforme chaque entrée en véritable instance de Style
				style.value = raw.map((s) => (s instanceof Style ? s : new Style(s)));

				if (style.id === 'surah-latin-text-style' || style.id === 'reciter-latin-text-style') {
					style.setCompositeStyleValue('font-size', 30);
				}
			}
		}
	}
}

export class StylesData extends SerializableBase {
	categories: Category[] = $state([]);
	target: 'global' | 'arabic' | string = $state('');

	// Overrides spécifiques aux clips sélectionnés
	overrides: { [clipId: number]: { [styleId in StyleName]?: StyleOverrideValue } } = $state({});
	overrideKeyframes: {
		[clipId: number]: { [styleId in StyleName]?: StyleKeyframe[] };
	} = $state({});

	constructor(
		target: 'global' | 'arabic' | string,
		categories: Array<Category | RawCategoryDefinition> = []
	) {
		super();
		this.target = target;
		// S'assurer que chaque élément passé est bien une instance de Category
		// (les JSON importés depuis les fichiers contiennent seulement les attributs)
		this.categories = (categories || []).map((c) => (c instanceof Category ? c : new Category(c)));
	}

	/**
	 * Génère le CSS pour tous les styles actifs (fusion globale + overrides clip si fournis)
	 */
	generateCSS(clipId?: number, excludedCategories: string[] = []): string {
		let css = '';

		for (const category of this.categories) {
			let skipCategory = false;

			for (const style of category.styles) {
				if (RUNTIME_LAYOUT_STYLE_IDS.has(style.id as StyleName)) continue;

				const effectiveValue = this.getEffectiveValue(style.id as StyleName, clipId);

				// Pour les catégories de styles qui peuvent être désactivées (border, outline, ...),
				// si la propriété d'activation est false, on ne génère pas le CSS des autres styles
				const isCategoryToggle =
					style.valueType === 'boolean' &&
					style.id.includes('enable') &&
					style.id !== 'enable-italic';

				if (isCategoryToggle) {
					if (!effectiveValue) {
						skipCategory = true;
						break;
					} else {
						continue; // ne pas générer la règle pour le flag lui-même
					}
				}

				if (style.id === 'enable-italic' && !effectiveValue) {
					continue;
				}

				// Si la catégorie est dans la liste des catégories à exclure, on skip tout le CSS
				if (excludedCategories.includes(style.getCategory())) {
					continue;
				}

				if (skipCategory) break;

				// Gestion des polices pour les sous-titres prédéfinis
				// On force une certaine police pour afficher par exemple "Sadaqallahul Azim" ou les autres textes arabes
				if (this.target === 'arabic' && style.id === 'font-family' && clipId) {
					const subtitleClip = globalState.getSubtitleTrack.getClipById(clipId);
					const mushafStyle = String(this.getEffectiveValue('mushaf-style', clipId) ?? '');
					const riwayah = this.getEffectiveValue('riwayah', clipId);

					if (isNonHafsRiwayah(riwayah) && subtitleClip instanceof SubtitleClip) {
						css += `font-family: ${getRiwayahFontFamily(riwayah)}, sans-serif;\n`;
						continue;
					}

					// Le mushaf Tajweed est rendu avec les glyphes QPC + la police Tajweed v4 (par page).
					if (mushafStyle === 'Tajweed' && subtitleClip instanceof SubtitleClip) {
						const tajweedFontName = QPCFontProvider.getTajweedFontNameForVerse(
							subtitleClip.surah,
							subtitleClip.verse
						);
						const qpc2FallbackFontName = QPCFontProvider.getFontNameForVerse(
							subtitleClip.surah,
							subtitleClip.verse,
							'2'
						);
						css += `font-family: ${tajweedFontName}, ${qpc2FallbackFontName};\n`;
						continue;
					}

					// Le mushaf IndoPak force la police IndoPak.
					if (mushafStyle === 'Indopak' && subtitleClip instanceof SubtitleClip) {
						css += `font-family: IndoPak, sans-serif;\n`;
						continue;
					}

					if (subtitleClip instanceof PredefinedSubtitleClip) {
						const basmalaStyle = String(
							this.getEffectiveValue('basmala-style', subtitleClip.id) ?? 'current-font'
						);
						if (
							subtitleClip.predefinedSubtitleType === 'Basmala' &&
							basmalaStyle !== 'current-font'
						) {
							css += `font-family: Basmalah;\n`;
							continue;
						}

						const forcedFont = getForcedFontForPredefinedSubtitle(
							subtitleClip.predefinedSubtitleType,
							String(effectiveValue)
						);
						if (forcedFont) {
							if (forcedFont === 'Hafs') css += `font-family: 'Hafs', sans-serif;\n`;
							else css += `font-family: ${forcedFont};\n`;
							continue;
						}
					}
				}

				if (this.target === 'arabic' && style.id === 'scale' && clipId) {
					const subtitleClip = globalState.getSubtitleTrack.getClipById(clipId);
					const basmalaStyle = String(
						this.getEffectiveValue('basmala-style', clipId) ?? 'current-font'
					);
					if (
						subtitleClip instanceof PredefinedSubtitleClip &&
						subtitleClip.predefinedSubtitleType === 'Basmala' &&
						basmalaStyle !== 'current-font'
					) {
						css += `--scale: ${this.getEffectiveValue('basmala-scale', clipId) ?? 100}%;\n`;
						continue;
					}
				}

				// Propriétés spécifiques à ignorer
				if (style.id === 'font-family' && String(effectiveValue) === 'Hafs') continue; // Gérer par une classe Tailwind
				if (style.id === 'max-height' && effectiveValue === 0) {
					const maxLineValue = Number(this.getEffectiveValue('max-line', clipId));
					if (maxLineValue >= 1 && maxLineValue <= 4) continue;
					break; // Ignore les propriétés après qui dépendent de max-height
				}

				if (style.tailwind) continue; // Ignore les styles Tailwind, qui sont appliqués différemment

				// Cas particulier: pour la police d'écriture QPC1 ou QPC2, alors on met la bonne
				// police d'écriture en fonction du verset
				if (
					style.id === 'font-family' &&
					(String(effectiveValue) === 'QPC1' || String(effectiveValue) === 'QPC2') &&
					clipId
				) {
					const subtitleClip = globalState.getSubtitleTrack.getClipById(clipId);
					let fontname = '';
					if (subtitleClip instanceof SubtitleClip) {
						fontname = QPCFontProvider.getFontNameForVerse(
							subtitleClip.surah,
							subtitleClip.verse,
							String(effectiveValue) === 'QPC1' ? '1' : '2'
						);
					} else {
						// Met le font contenant tout les glyphes spéciaux du Coran
						// (notamment si subtitleClip instanceof PredefinedSubtitle alors pour la basmala ce sera le bon font)
						fontname = String(effectiveValue) === 'QPC1' ? 'QPC1BSML' : 'QPC2BSML';
					}

					css += `font-family: ${fontname};\n`;
					continue;
				}

				// Cas particulier pour l'alignement vertical/horizontal du texte
				if (style.id === 'vertical-text-alignment' || style.id === 'horizontal-text-alignment') {
					const cssMap = style.css as unknown as Record<string, string>;
					css += (cssMap[String(effectiveValue)] ?? '') + '\n';
					continue;
				}

				// Cas particulier pour background-color
				if (style.id === 'background-color') {
					// Il faut convertir la couleur de l'hex en rgb
					if (typeof effectiveValue === 'string' && effectiveValue.startsWith('#')) {
						const r = parseInt(effectiveValue.slice(1, 3), 16);
						const g = parseInt(effectiveValue.slice(3, 5), 16);
						const b = parseInt(effectiveValue.slice(5, 7), 16);
						const valeur = `rgba(${r}, ${g}, ${b}, var(--background-opacity))`;

						css += 'background-color: ' + valeur + ';\n';
						continue;
					}
				}

				// Cas particulier pour `show-subtitles`
				if (style.id === 'show-subtitles') {
					if (!effectiveValue) {
						return 'display: none;';
					}
				}

				if (style.id === 'text-direction' && !effectiveValue) {
					continue;
				}

				// Remplace {value} par la valeur effective
				let cssRule = '';

				cssRule = style.css.replaceAll(/{value}/g, String(effectiveValue));

				if (cssRule.trim()) {
					css += cssRule + '\n';
				}
			}
		}

		return css;
	}

	/**
	 * Génère les classes Tailwind pour tous les styles actifs
	 * @returns Une chaîne de classes Tailwind
	 */
	generateTailwind(): string {
		let tailwindClasses = '';
		const currentTime =
			globalState.currentProject?.projectEditorState?.timeline.cursorPosition ?? 0;

		for (const category of this.categories) {
			for (const style of category.styles) {
				const effectiveValue = style.getValueAt(currentTime);
				if (style.id === 'font-family' && effectiveValue === 'Hafs') {
					// Utilise la police Hafs pour les styles de texte
					tailwindClasses += 'arabic ';
					continue;
				}

				// Ignore les styles qui ne sont pas des classes Tailwind
				if (!style.tailwind || !style.tailwindClass) continue;

				// Remplace {value} par la valeur actuelle
				const tailwindClass = style.tailwindClass.replaceAll(/{value}/g, String(effectiveValue));

				if (tailwindClass.trim()) {
					tailwindClasses += tailwindClass + ' ';
				}
			}
		}

		return tailwindClasses.trim();
	}

	/**
	 * Définit la valeur d'un style
	 * @param styleId L'ID du style à modifier
	 * @param value La nouvelle valeur à appliquer
	 */
	setStyle(styleId: StyleName, value: Style['value']): void {
		ProjectHistoryManager.begin('set style');
		try {
			// Trouve le style
			const style = this.findStyle(styleId);
			if (style) {
				style.value = value;
				styleLookupCache.delete(this);
			}
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/**
	 * Trouve un style par son ID
	 * @param styleId L'ID du style à trouver
	 * @returns Le style correspondant ou undefined s'il n'est pas trouvé
	 */
	findStyle(styleId: StyleName): Style | undefined {
		let cache = styleLookupCache.get(this);
		if (!cache) {
			cache = new Map();
			styleLookupCache.set(this, cache);
		}

		const cachedStyle = cache.get(styleId);
		if (cachedStyle) return cachedStyle;

		for (const category of this.categories) {
			const style = category.styles.find((s) => s.id === styleId);
			if (style) {
				cache.set(styleId, style);
				return style;
			}
		}
		return undefined;
	}

	/**
	 * Ajoute ou remplace une image clé globale ou propre aux clips indiqués.
	 * @param {StyleName} styleId Identifiant du style à animer.
	 * @param {number} time Position absolue dans la timeline, en millisecondes.
	 * @param {Style['value']} value Valeur active à partir de cette position.
	 * @param {number[]} clipIds Clips recevant une animation locale, si nécessaire.
	 * @returns {void}
	 */
	setKeyframe(
		styleId: StyleName,
		time: number,
		value: Style['value'],
		clipIds: number[] = []
	): void {
		if (clipIds.length === 0) {
			this.findStyle(styleId)?.setKeyframe(time, value);
			return;
		}
		if (this.target === 'global' && !isGlobalOverlayStyleId(styleId)) return;
		const normalizedTime = Math.max(0, Math.floor(time));
		for (const clipId of clipIds) {
			this.overrideKeyframes[clipId] ??= {};
			const keyframes = (this.overrideKeyframes[clipId][styleId] ??= []);
			const existing = keyframes.find((keyframe) => keyframe.time === normalizedTime);
			if (existing) existing.value = value;
			else keyframes.push({ time: normalizedTime, value });
			keyframes.sort((a, b) => a.time - b.time);
		}
	}

	/**
	 * Retourne les temps uniques des images clés pour la portée demandée.
	 * @param {StyleName} styleId Identifiant du style inspecté.
	 * @param {number[]} clipIds Clips inspectés, ou liste vide pour le style de base.
	 * @returns {number[]} Temps triés en millisecondes.
	 */
	getKeyframeTimes(styleId: StyleName, clipIds: number[] = []): number[] {
		const times =
			clipIds.length === 0
				? (this.findStyle(styleId)?.keyframes.map((keyframe) => keyframe.time) ?? [])
				: clipIds.flatMap((clipId) =>
						(this.overrideKeyframes[clipId]?.[styleId] ?? []).map((keyframe) => keyframe.time)
					);
		return Array.from(new Set(times)).sort((a, b) => a - b);
	}

	/**
	 * Collecte toutes les images clés de cette cible, overrides inclus.
	 * @returns {number[]} Temps uniques triés en millisecondes.
	 */
	getAllKeyframeTimes(): number[] {
		const baseTimes = this.categories.flatMap((category) => category.getAllKeyframeTimes());
		const overrideTimes = Object.values(this.overrideKeyframes).flatMap((byStyle) =>
			Object.values(byStyle).flatMap((keyframes) =>
				(keyframes ?? []).map((keyframe) => keyframe.time)
			)
		);
		return Array.from(new Set([...baseTimes, ...overrideTimes])).sort((a, b) => a - b);
	}

	/**
	 * Indique si la portée demandée contient une image clé au temps courant.
	 * @param {StyleName} styleId Identifiant du style inspecté.
	 * @param {number} time Position absolue dans la timeline, en millisecondes.
	 * @param {number[]} clipIds Clips inspectés, ou liste vide pour le style de base.
	 * @returns {boolean} `true` si une image clé existe à cette position.
	 */
	hasKeyframeAt(styleId: StyleName, time: number, clipIds: number[] = []): boolean {
		const normalizedTime = Math.max(0, Math.floor(time));
		return this.getKeyframeTimes(styleId, clipIds).includes(normalizedTime);
	}

	/**
	 * Supprime une image clé globale ou locale au temps demandé.
	 * @param {StyleName} styleId Identifiant du style modifié.
	 * @param {number} time Position absolue dans la timeline, en millisecondes.
	 * @param {number[]} clipIds Clips modifiés, ou liste vide pour le style de base.
	 * @returns {void}
	 */
	removeKeyframe(styleId: StyleName, time: number, clipIds: number[] = []): void {
		if (clipIds.length === 0) {
			this.findStyle(styleId)?.removeKeyframe(time);
			return;
		}
		const normalizedTime = Math.max(0, Math.floor(time));
		for (const clipId of clipIds) {
			const byStyle = this.overrideKeyframes[clipId];
			if (!byStyle?.[styleId]) continue;
			byStyle[styleId] = byStyle[styleId].filter((keyframe) => keyframe.time !== normalizedTime);
			if (byStyle[styleId].length === 0) delete byStyle[styleId];
			if (Object.keys(byStyle).length === 0) delete this.overrideKeyframes[clipId];
		}
	}

	/**
	 * Définit un style pour un ou plusieurs clips sélectionnés (override partiel)
	 */
	setStyleForClips(clipIds: number[], styleId: StyleName, value: StyleOverrideValue) {
		ProjectHistoryManager.begin('set clip style override');
		try {
			// Cas spécial: sur le target global, on n'autorise les overrides que pour la catégorie overlay.
			if (this.target === 'global' && !isGlobalOverlayStyleId(styleId)) {
				return;
			}

			for (const clipId of clipIds) {
				// Créez un nouvel objet d'override pour le clip s'il n'existe pas
				if (!this.overrides[clipId]) {
					this.overrides[clipId] = {} as Partial<Record<StyleName, StyleOverrideValue>>;
				}

				// Regarde si pour la valeur qu'on veut appliquer à ce style pour ces clip
				// si c'est la valeur par déjà du style
				const baseValue = this.findStyle(styleId)?.value;
				const isSameValue =
					Array.isArray(baseValue) && Array.isArray(value)
						? JSON.stringify(baseValue) === JSON.stringify(value)
						: baseValue === value;
				if (isSameValue) {
					// Enlève l'override pour ce style, car c'est la valeur déjà de son parent
					delete this.overrides[clipId][styleId];
				} else {
					// Applique l'override avec la valeur
					this.overrides[clipId][styleId] = value;
				}
			}
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/**
	 * Supprime l'override pour un style donné sur une liste de clips
	 * @param clipIds L'ID des clips à modifier
	 * @param styleId L'ID du style à supprimer
	 */
	clearStyleForClips(clipIds: number[], styleId: StyleName): void {
		ProjectHistoryManager.begin('clear clip style override');
		try {
			// Cas spécial: sur le target global, on n'autorise les overrides que pour la catégorie overlay.
			if (this.target === 'global' && !isGlobalOverlayStyleId(styleId)) {
				return;
			}

			for (const clipId of clipIds) {
				const byClip = this.overrides[clipId];
				if (!byClip) continue;

				// Supprime l'override pour ce style sur ce clip
				if (byClip[styleId] !== undefined) {
					delete byClip[styleId];
				}

				// Nettoyage de l'objet clip s'il est vide
				if (Object.keys(byClip).length === 0) {
					delete this.overrides[clipId];
				}
			}
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/**
	 * Retourne la valeur effective (override clip si présent, sinon valeur du StylesData)
	 * @param styleId L'ID du style à récupérer
	 * @param clipId L'ID du clip à vérifier
	 * @returns La valeur effective du style
	 */
	getEffectiveValue(
		styleId: StyleName,
		clipId?: number,
		time?: number,
		fadeDuration = getPreviewKeyframeFadeDuration()
	): string | number | boolean {
		const style = this.findStyle(styleId);
		const currentTime =
			time ?? globalState.currentProject?.projectEditorState?.timeline.cursorPosition ?? 0;

		const canUseClipOverride =
			this.target !== 'global' || (this.target === 'global' && isGlobalOverlayStyleId(styleId));

		// Structure des overrides pour StylesData : overrides[clipId][styleId] = value
		let value = style ? style.getValueAt(currentTime, fadeDuration) : '';
		if (
			canUseClipOverride &&
			clipId !== undefined &&
			this.overrides[clipId] &&
			this.overrides[clipId][styleId] !== undefined
		) {
			value = this.overrides[clipId][styleId]!;
		}
		const keyframes = clipId === undefined ? undefined : this.overrideKeyframes[clipId]?.[styleId];
		return (
			keyframes && style
				? resolvePreviewKeyframeValue(style, keyframes, currentTime, value, fadeDuration)
				: value
		) as string | number | boolean;
	}

	/**
	 * Résout un style booléen sous forme d'opacité pour la preview.
	 * @param {StyleName} styleId Identifiant du style de visibilité.
	 * @param {number | undefined} clipId Clip portant un éventuel override.
	 * @param {number | undefined} time Position absolue dans la timeline.
	 * @param {number} fadeDuration Durée du fondu en millisecondes.
	 * @returns {number} Opacité de visibilité entre zéro et un.
	 */
	getEffectiveVisibilityOpacity(
		styleId: StyleName,
		clipId?: number,
		time?: number,
		fadeDuration = getPreviewKeyframeFadeDuration()
	): number {
		const style = this.findStyle(styleId);
		if (!style) return 0;
		const currentTime =
			time ?? globalState.currentProject?.projectEditorState?.timeline.cursorPosition ?? 0;
		const staticOverride = clipId === undefined ? undefined : this.overrides[clipId]?.[styleId];
		const localKeyframes =
			clipId === undefined ? undefined : this.overrideKeyframes[clipId]?.[styleId];
		if (!localKeyframes) {
			return staticOverride === undefined
				? style.getVisibilityOpacityAt(currentTime, fadeDuration)
				: staticOverride
					? 1
					: 0;
		}
		const fallback = staticOverride ?? style.getValueAt(currentTime, 0);
		return resolveKeyframeVisibilityOpacity(localKeyframes, currentTime, fallback, fadeDuration);
	}

	/**
	 * Vérifie si un clip a un override pour un style donné
	 * @param clipIds L'ID du clip à vérifier
	 * @param styleId L'ID du style à vérifier
	 * @returns true si le clip a un override pour le style, false sinon
	 */
	hasOverrideForAny(clipIds: number[], styleId: StyleName): boolean {
		if (this.target === 'global' && !isGlobalOverlayStyleId(styleId)) return false;

		return clipIds.some((clipId) => {
			const byClip = this.overrides[clipId];
			return !!(byClip && byClip[styleId] !== undefined);
		});
	}

	/**
	 * Indique si un clip possède au moins un override de style.
	 * @param clipId L'ID du clip à vérifier
	 * @returns true si le clip a au moins un override de style, false sinon
	 */
	hasAnyOverrideForClip(clipId: number): boolean {
		const byClip = this.overrides?.[clipId];
		const keyframesByClip = this.overrideKeyframes?.[clipId];
		if (!byClip && !keyframesByClip) return false;

		// Une valeur fixe ou une animation locale suffit à marquer le clip comme personnalisé.
		return Object.keys(byClip ?? {}).length > 0 || Object.keys(keyframesByClip ?? {}).length > 0;
	}

	/**
	 * Créer les styles composites s'ils n'existent pas déjà
	 */
	async loadCompositeStyles() {
		for (const category of this.categories) {
			await category.loadCompositeStyle();
		}
	}

	/**
	 * Get - et créer si nécessaire - les styles composites pour un style donné
	 * @param compositeStyleId L'identifiant du style composite
	 */
	getCompositeStyles(compositeStyleId: StyleName): Style[] {
		// Try catch au cas où le style composite n'a toujours pas été créé
		const style = this.findStyle(compositeStyleId);

		if (style) {
			if (style.value instanceof Array) return style.value as Style[];
			// Style par défaut non encore créé si on arrive là.
		}

		// Si non trouvé, alors cherche parmis les textes composites des customs text
		return globalState.getVideoStyle.getCustomTextCompositeStyles(compositeStyleId);
	}
}

// Stockage des overrides par clip
export type ClipStyleOverrides = {
	[clipId: number]: {
		[target: string]: {
			[categoryId in StyleCategoryName]?: {
				[styleId in StyleName]?: StyleOverrideValue;
			};
		};
	};
};

export class VideoStyle extends SerializableBase {
	styles: StylesData[] = $state([]);

	lastUpdated: Date = $state(new Date());

	constructor() {
		super();
	}

	/**
	 * Collecte les changements temporels nécessaires à l'aperçu et à l'export.
	 * @returns {number[]} Temps uniques triés en millisecondes.
	 */
	getAllKeyframeTimes(): number[] {
		const times = this.styles.flatMap((styles) => styles.getAllKeyframeTimes());
		return Array.from(new Set(times)).sort((a, b) => a - b);
	}

	/**
	 * Recharge la configuration visuelle de l'éditeur depuis les JSON statiques.
	 * @returns {Promise<void>}
	 */
	async hydrateStyleEditorUiMetadata(): Promise<void> {
		const [globalDefaults, subtitleDefaults] = await Promise.all([
			loadStyleCategoryDefinitions('global'),
			loadStyleCategoryDefinitions('subtitle')
		]);

		for (const stylesData of this.styles) {
			const defaults = stylesData.target === 'global' ? globalDefaults : subtitleDefaults;
			for (const category of stylesData.categories) {
				category.setUiMetadata(defaults.find((candidate) => candidate.id === category.id)?.ui);
			}
		}
	}

	/**
	 * Recopie les métadonnées UI non persistées lors d'une restauration undo/redo.
	 * @param {VideoStyle} source Styles du projet actuellement chargé.
	 * @returns {void}
	 */
	copyStyleEditorUiMetadataFrom(source: VideoStyle): void {
		for (const stylesData of this.styles) {
			const sourceStyles = source.styles.find(
				(candidate) => candidate.target === stylesData.target
			);
			for (const category of stylesData.categories) {
				category.setUiMetadata(
					sourceStyles?.categories.find((candidate) => candidate.id === category.id)?.ui
				);
			}
		}
	}

	/**
	 * Retourne les styles par défaut d'un projet
	 * @returns Les styles par défaut d'une vidéo
	 */
	static async getDefaultVideoStyle(): Promise<VideoStyle> {
		// Créer un nouveau objet VideoStyle
		const videoStyle = new VideoStyle();

		// Ajoute les styles par défaut pour chaque target
		videoStyle.styles.push(new StylesData('global', await loadStyleCategoryDefinitions('global')));
		videoStyle.styles.push(
			new StylesData('arabic', await loadStyleCategoryDefinitions('subtitle'))
		);

		// Set les styles par défaut pour l'arabe
		videoStyle.getStylesOfTarget('arabic').setStyle('font-family', 'QPC2');
		// videoStyle.getStylesOfTarget('arabic').setStyle('max-height', 220); // Une ligne max
		videoStyle.getStylesOfTarget('arabic').setStyle('line-height', 1.6);
		videoStyle.getStylesOfTarget('arabic').setStyle('font-size', 90);
		videoStyle.getStylesOfTarget('arabic').setStyle('vertical-position', -110);

		// Load les styles composites
		await videoStyle.getStylesOfTarget('global').loadCompositeStyles();

		// S'il manque des styles à une traduction, on les ajoute
		if (globalState.currentProject)
			for (const translation of globalState.getProjectTranslation.addedTranslationEditions) {
				await videoStyle.addStylesForEdition(translation.name);
			}

		return videoStyle;
	}

	/**
	 * Obtient les styles d'une cible spécifique
	 * @param target La cible à interroger (global, arabic, ou une traduction)
	 * @returns Les styles de la cible
	 */
	getStylesOfTarget(target: 'global' | 'arabic' | string): StylesData {
		const styles = this.styles.find((s) => s.target === target);
		return styles ? styles : new StylesData(target);
	}

	/**
	 * Update la valeur d'un style d'un custom text (depuis la track Custom Text)
	 * @param customTextId L'ID du texte custom
	 * @param styleId L'ID du style à obtenir
	 * @param value La nouvelle valeur à appliquer
	 */
	setCustomTextStyle(
		customTextId: StyleCategoryName,
		styleId: StyleName,
		value: Style['value']
	): void {
		ProjectHistoryManager.begin('set custom text style');
		try {
			// Trouve donc le clip correspondant pour update sa valeur
			const clip = globalState.getCustomClipTrack.clips.find(
				(c) => (c as CustomTextClip).category?.id === customTextId
			) as CustomTextClip | undefined;
			if (clip) {
				clip.setStyle(styleId, value);
			}
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	doesTargetStyleExist(target: string): boolean {
		return this.styles.find((style) => style.target === target) !== undefined;
	}

	async addStylesForEdition(translationEdition: string) {
		if (this.doesTargetStyleExist(translationEdition)) return;

		const defaultStyles = getNonArabicSubtitleCategories(
			await loadStyleCategoryDefinitions('subtitle')
		);

		const stylesData = new StylesData(
			translationEdition,
			defaultStyles.map((category) => new Category(category))
		);

		// Styles par défaut pour les traductions
		stylesData.setStyle('font-family', 'Georgia'); // Définit la police par défaut
		// stylesData.setStyle('max-height', 280); // 3 lignes max
		stylesData.setStyle('font-size', 60); // Définit la taille de police par défaut
		stylesData.setStyle('vertical-position', 70); // Définit la hauteur de ligne par défaut

		this.styles.push(stylesData);
	}

	/**
	 * Merge les styles manquants avec les JSON par défaut, sans écraser les valeurs existantes.
	 * Utile quand de nouveaux styles sont ajoutés dans une update.
	 * @param {ProjectContent | undefined} projectContent Contenu explicite pour les clips personnalisés.
	 * @returns {Promise<boolean>} `true` lorsque le schéma a été complété.
	 */
	async ensureStylesSchemaUpToDate(projectContent?: ProjectContent): Promise<boolean> {
		let hasChanges = false;
		const arabicStyles = this.styles.find((stylesData) => stylesData.target === 'arabic');
		const hadRiwayah = Boolean(arabicStyles?.findStyle('riwayah'));
		const legacyMushaf = arabicStyles?.findStyle('mushaf-style')?.value;

		const globalDefaults = await loadStyleCategoryDefinitions('global');
		hasChanges = this.mergeMissingStylesForTarget('global', globalDefaults) || hasChanges;

		const subtitleDefaults = await loadStyleCategoryDefinitions('subtitle');
		for (const stylesData of this.styles) {
			if (stylesData.target === 'global') continue;
			const targetDefaults =
				stylesData.target === 'arabic'
					? subtitleDefaults
					: getNonArabicSubtitleCategories(subtitleDefaults);
			hasChanges =
				this.mergeMissingStylesForTarget(stylesData.target, targetDefaults) || hasChanges;
		}

		if (!hadRiwayah && legacyMushaf === 'Warsh' && arabicStyles) {
			arabicStyles.setStyle('riwayah', 'Warsh');
			arabicStyles.setStyle('mushaf-style', 'Uthmani');
			arabicStyles.setStyle('font-family', 'warsh10');
			hasChanges = true;
		}

		// Migration minimale: ajouter les styles manquants aux contenus personnalisés existants.
		const customTextDefaults = await loadCustomStyleCategoryDefinition('text');
		const compositeDefaults = await loadCompositeStyleDefinitions();
		const content = projectContent ?? globalState.currentProject?.content;
		if (content) {
			hasChanges =
				ensureCustomStyleSchema(
					content,
					customTextDefaults,
					compositeDefaults,
					(definition) => new Style(definition)
				) || hasChanges;
		}

		return hasChanges;
	}

	private mergeMissingStylesForTarget(
		target: string,
		defaultCategoriesRaw: RawCategoryDefinition[]
	): boolean {
		let hasChanges = false;

		const targetStyles = this.styles.find((s) => s.target === target);
		if (!targetStyles) {
			this.styles.push(
				new StylesData(
					target,
					defaultCategoriesRaw.map((c) => new Category(c))
				)
			);
			return true;
		}

		for (const defaultCategoryRaw of defaultCategoriesRaw) {
			const targetCategory = targetStyles.categories.find((c) => c.id === defaultCategoryRaw.id);

			if (!targetCategory) {
				targetStyles.categories.push(new Category(defaultCategoryRaw));
				hasChanges = true;
				continue;
			}
			targetCategory.setUiMetadata(defaultCategoryRaw.ui);

			for (const defaultStyleRaw of defaultCategoryRaw.styles || []) {
				const existingStyle = targetCategory.styles.find((s) => s.id === defaultStyleRaw.id);
				if (!existingStyle) {
					const migratedRanges = defaultStyleRaw.id.endsWith('time-ranges')
						? getTimedOverlayRangesFromStyles(targetCategory.styles)
						: [];
					targetCategory.styles.push(
						new Style({
							...defaultStyleRaw,
							value: migratedRanges.length > 0 ? migratedRanges : defaultStyleRaw.value
						})
					);
					hasChanges = true;
					continue;
				}

				// Refresh select option lists from defaults so newly added options
				// (e.g. a new mushaf variant) appear in older projects.
				if (
					defaultStyleRaw.valueType === 'select' &&
					Array.isArray(defaultStyleRaw.options) &&
					Array.isArray(existingStyle.options) &&
					(existingStyle.options.length !== defaultStyleRaw.options.length ||
						existingStyle.options.some((o, i) => o !== defaultStyleRaw.options![i]))
				) {
					existingStyle.options = [...defaultStyleRaw.options];
					hasChanges = true;
				}
			}
		}

		return hasChanges;
	}

	async getDefaultCustomTextCategory(): Promise<Category> {
		// Récupère le JSON brut
		const raw = await loadCustomStyleCategoryDefinition('text');
		// Instancie correctement la catégorie (ce constructeur instancie aussi les Style internes)
		const category = new Category(raw);
		// Ajoute un suffixe unique pour éviter collisions lorsque plusieurs custom texts sont ajoutés
		const randomId = Utilities.randomId();
		category.id += '-' + randomId;
		const composite = category.getStyle('custom-text-composite')!;
		composite.id += '-' + randomId;

		await category.loadCompositeStyle();

		return category;
	}

	async getDefaultCustomImageCategory(): Promise<Category> {
		// Récupère le JSON brut
		const raw = await loadCustomStyleCategoryDefinition('image');
		// Instancie correctement la catégorie (ce constructeur instancie aussi les Style internes)
		const category = new Category(raw);
		// Ajoute un suffixe unique pour éviter collisions lorsque plusieurs custom texts sont ajoutés
		const randomId = Utilities.randomId();
		category.id += '-' + randomId;

		return category;
	}

	/**
	 * Ajoute un clip personnalisé au projet dans les styles globaux
	 */
	async addCustomClip(
		clipType: 'text' | 'image',
		startTime?: number,
		endTime?: number
	): Promise<void> {
		ProjectHistoryManager.begin('add custom clip');
		try {
			// Ajoute la track Custom Text si non existante
			if (!globalState.currentProject!.content.timeline.doesTrackExist(TrackType.CustomClip)) {
				globalState.currentProject!.content.timeline.addTrack(new CustomTextTrack());
			}

			// Ajoute le custom text au projet
			const customTextCategory =
				clipType === 'text'
					? await this.getDefaultCustomTextCategory()
					: await this.getDefaultCustomImageCategory();

			globalState.getCustomClipTrack.addCustomClip(
				customTextCategory,
				clipType,
				startTime,
				endTime
			);

			setTimeout(() => {
				globalState.updateVideoPreviewUI();
			}, 10); // 10ms nécessaire
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/**
	 * Recherche parmis tout les targets qu'on a s'il existe un override pour
	 * un clip donné
	 * @param id L'ID du clip à vérifier
	 */
	hasAnyOverrideForClip(id: number, includeGlobal: boolean = false): boolean {
		for (const stylesData of this.styles) {
			if (!includeGlobal && stylesData.target === 'global') continue;
			if (stylesData.hasAnyOverrideForClip(id)) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Retourne les styles du style composite d'un custom text
	 * @param customTextId L'id du customText
	 * @param {ProjectContent | undefined} projectContent Projet explicite à parcourir.
	 * @returns
	 */
	getCustomTextCompositeStyles(customTextId: string, projectContent?: ProjectContent): Style[] {
		const content = projectContent ?? globalState.currentProject?.content;
		return content ? getCustomCompositeStyles(content, customTextId) : [];
	}

	/**
	 * Exporte les styles vers un fichier
	 * @param includedExportClips Optionnellement, une liste des customs-text à inclure
	 * @param {ProjectContent | undefined} projectContent Projet explicite lors d'un export headless.
	 * @return Les données exportées en format JSON
	 */
	exportStylesData(
		includedExportClips: Set<number>,
		projectContent?: ProjectContent
	): VideoStyleFileData {
		const serializedVideoStyle = JSON.parse(JSON.stringify(this)) as Record<string, unknown> & {
			styles: Array<{ overrides: Record<string, unknown> }>;
		};
		const exportData: VideoStyleFileData = {
			videoStyle: serializedVideoStyle,
			customClips:
				projectContent || globalState.currentProject
					? exportCustomStyleClips(
							projectContent ?? globalState.currentProject!.content,
							includedExportClips
						)
					: []
		};
		// Enlève tout les overrides
		for (const style of serializedVideoStyle.styles) {
			style.overrides = {};
		}
		return exportData;
	}

	/**
	 * Sérialise un preset de styles au format JSON historique.
	 * @param {Set<number>} includedExportClips Contenus personnalisés à inclure.
	 * @param {ProjectContent | undefined} projectContent Projet explicite lors d'un export headless.
	 * @returns {string} Preset JSON formaté.
	 */
	exportStyles(includedExportClips: Set<number>, projectContent?: ProjectContent): string {
		return JSON.stringify(this.exportStylesData(includedExportClips, projectContent), null, 2);
	}

	async importStylesFromFile() {
		// Open a dialog
		const file = await open({
			multiple: false,
			directory: false
		});

		if (!file) return;

		try {
			const json = JSON.parse((await readTextFile(file)).toString());
			await globalState.getVideoStyle.importStyles(json);
		} catch (error) {
			ModalManager.errorModal(
				get(LL).settings.errorImportingStyles(),
				get(LL).settings.stylesFileInvalid(),
				JSON.stringify(error, Object.getOwnPropertyNames(error))
			);
		}
	}

	/**
	 * Importe un preset dans le style courant, éventuellement pour un projet chargé hors interface.
	 * @param {VideoStyleFileData} json Données du preset.
	 * @param {ProjectContent | undefined} projectContent Contenu explicite à modifier sans état global.
	 * @returns {Promise<void>} Promesse résolue après la mise à jour du schéma.
	 */
	async importStyles(json: VideoStyleFileData, projectContent?: ProjectContent): Promise<void> {
		if (!projectContent) ProjectHistoryManager.begin('import styles');
		try {
			const content = projectContent ?? globalState.currentProject?.content;
			if (!content) throw new Error('Cannot import styles without a project');
			const translationAssignments: Record<string, string> = {};
			if (!projectContent) {
				const availableTargets = getPresetTranslationTargets(json);
				for (const translation of content.projectTranslation.addedTranslationEditions) {
					if (availableTargets.includes(translation.name)) continue;
					for (const sourceTarget of availableTargets) {
						const confirm = await ModalManager.confirmModal(
							get(LL).translations.translationNoStyles({ name: translation.name }),
							true
						);
						if (!confirm) continue;
						translationAssignments[translation.name] = sourceTarget;
						break;
					}
				}
			}

			await applyStylePresetToProject({
				videoStyle: this,
				projectContent: content,
				data: json,
				translationAssignments
			});
		} finally {
			if (!projectContent) ProjectHistoryManager.commit();
		}
	}

	/**
	 * Highlight dans le gestionnaire de style la catégorie en paramètre
	 * @param target La cible à highlight
	 * @param categoryName La catégorie à highlight
	 */
	highlightCategory(target: string, categoryName: StyleCategoryName) {
		if (globalState.currentProject!.projectEditorState.currentTab !== ProjectEditorTabs.Style) {
			globalState.currentProject!.projectEditorState.currentTab = ProjectEditorTabs.Style;
		}

		setTimeout(() => {
			if (target === 'arabic' || target === 'global') {
				globalState.getStylesState.currentSelection = target;
			} else {
				globalState.getStylesState.currentSelection = 'translation';
				setTimeout(() => {
					globalState.getStylesState.currentSelectionTranslation = categoryName;
				}, 0);
			}

			setTimeout(() => {
				globalState.getStylesState.scrollAndHighlight = categoryName;
			}, 0);
		}, 0);
	}

	async resetStyles() {
		ProjectHistoryManager.begin('reset styles');
		try {
			const confirmation = await ModalManager.confirmModal(
				get(LL).translations.resetAllStylesConfirm(),
				false
			);
			if (!confirmation) return;

			// Réinitialise les styles
			globalState.currentProject!.content.videoStyle = await VideoStyle.getDefaultVideoStyle();
		} finally {
			ProjectHistoryManager.commit();
		}
	}
}

export interface VideoStyleFileData {
	videoStyle: Record<string, unknown>;
	customClips: Array<Record<string, unknown>>;
	customTextClips?: Array<Record<string, unknown>>;
}

SerializableBase.registerChildClass(VideoStyle, 'styles', StylesData);
SerializableBase.registerChildClass(StylesData, 'categories', Category);
SerializableBase.registerChildClass(Category, 'styles', Style);
