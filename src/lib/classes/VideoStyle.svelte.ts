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
import {
	CustomImageClip,
	PredefinedSubtitleClip,
	getForcedFontForPredefinedSubtitle
} from './Clip.svelte';
import type { Clip } from './Clip.svelte';
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
	| 'show-decorative-brackets'
	| 'decorative-brackets-font-family'
	| 'mushaf-style'
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

export type WordByWordHighlightStyleName =
	| 'enable-wbw-highlight'
	| 'wbw-show-current-word-only'
	| 'wbw-color'
	| 'wbw-persist-color'
	| 'wbw-reveal-specific-word-style'
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
	| 'surah-name-time-ranges'
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
	| 'reciter-name-time-ranges'
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
	| 'ayah-container-time-ranges'
	| 'time-ranges'
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
	| WordByWordHighlightStyleName
	| OverlayStyleName
	| SurahNameStyleName
	| ReciterNameStyleName
	| CreatorTextStyleName
	| CustomTextStyleName
	| GlobalAnimationStyleName
	| VerseNumberStyleName
	| AyahContainerStyleName;

export type StyleOverrideValue = string | number | boolean | TimedOverlayRange[];

export type StyleKeyframe = {
	time: number;
	value: Style['value'];
};

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

type RawStyle = Partial<Style> & { id: string };
type RawCategory = Partial<Category> & { id: string; styles?: RawStyle[] };

/**
 * Retourne les catégories compatibles avec les traductions.
 * @param {RawCategory[]} categories Categories source.
 * @returns {RawCategory[]} Categories compatibles avec une traduction.
 */
function getNonArabicSubtitleCategories(categories: RawCategory[]): RawCategory[] {
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
 * Resolves the latest keyframe reached at a timeline position.
 * @param {StyleKeyframe[]} keyframes Ordered style keyframes.
 * @param {number} time Absolute timeline position in milliseconds.
 * @param {Style['value']} fallback Value used before the first keyframe.
 * @returns {Style['value']} Value active at the requested position.
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
 * Returns the preview-only keyframe transition duration.
 * @returns {number} Transition duration in milliseconds, or zero during export.
 */
function getPreviewKeyframeFadeDuration(): number {
	if (typeof window === 'undefined' || window.location.pathname.includes('/exporter')) return 0;
	const fadeStyle = globalState.currentProject?.content?.videoStyle
		?.getStylesOfTarget('global')
		.findStyle('fade-duration');
	return Math.max(0, Number(fadeStyle?.value ?? 0));
}

/**
 * Finds the transition ending at the next keyframe.
 * @param {StyleKeyframe[]} keyframes Ordered keyframes.
 * @param {number} time Current timeline position in milliseconds.
 * @param {Style['value']} fallback Value before the first keyframe.
 * @param {number} fadeDuration Transition duration in milliseconds.
 * @returns {{ from: Style['value']; to: Style['value']; progress: number } | null} Active transition.
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
 * Reads the alpha channel from an editor-supported CSS color.
 * @param {string} color Hex, RGB or RGBA color.
 * @returns {number} Normalized alpha channel.
 */
function getCssColorAlpha(color: string): number {
	const normalized = color.trim();
	const rgba = normalized.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)$/i);
	if (rgba) return Utilities.clamp01(Number(rgba[1]));
	if (/^#[0-9a-f]{8}$/i.test(normalized)) return parseInt(normalized.slice(7, 9), 16) / 255;
	return 1;
}

/**
 * Interpolates two CSS colors as RGBA.
 * @param {string} fromColor Start color.
 * @param {string} toColor End color.
 * @param {number} progress Normalized transition progress.
 * @returns {string} Interpolated color.
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
 * Resolves a keyframe value with color and opacity interpolation.
 * @param {Style} style Style describing the value.
 * @param {StyleKeyframe[]} keyframes Keyframes to resolve.
 * @param {number} time Current timeline position in milliseconds.
 * @param {Style['value']} fallback Value before the first keyframe.
 * @param {number} fadeDuration Transition duration in milliseconds.
 * @returns {Style['value']} Interpolated or stepped value.
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
 * Resolves a boolean visibility keyframe as a smooth opacity.
 * @param {StyleKeyframe[]} keyframes Boolean keyframes.
 * @param {number} time Current timeline position in milliseconds.
 * @param {Style['value']} fallback Visibility before the first keyframe.
 * @param {number} fadeDuration Transition duration in milliseconds.
 * @returns {number} Visibility opacity from zero to one.
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
 * Collects keyframe times recursively, including composite child styles.
 * @param {Style} style Style to inspect.
 * @returns {number[]} Keyframe times in milliseconds.
 */
function collectStyleKeyframeTimes(style: Style): number[] {
	const ownTimes = style.keyframes.map((keyframe) => keyframe.time);
	if (style.valueType !== 'composite' || !Array.isArray(style.value)) return ownTimes;
	return [...ownTimes, ...(style.value as Style[]).flatMap(collectStyleKeyframeTimes)];
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
	 * Adds or replaces a keyframe at the requested timeline position.
	 * @param {number} time Absolute timeline position in milliseconds.
	 * @param {Style['value']} value Value active from this position.
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
	 * Returns the value active at a timeline position.
	 * @param {number} time Absolute timeline position in milliseconds.
	 * @returns {Style['value']} Base value or the latest reached keyframe value.
	 */
	getValueAt(time: number, fadeDuration = getPreviewKeyframeFadeDuration()): Style['value'] {
		return resolvePreviewKeyframeValue(this, this.keyframes, time, this.value, fadeDuration);
	}

	/**
	 * Resolves boolean keyframes as a preview visibility opacity.
	 * @param {number} time Absolute timeline position in milliseconds.
	 * @param {number} fadeDuration Transition duration in milliseconds.
	 * @returns {number} Visibility opacity from zero to one.
	 */
	getVisibilityOpacityAt(time: number, fadeDuration = getPreviewKeyframeFadeDuration()): number {
		return resolveKeyframeVisibilityOpacity(this.keyframes, time, this.value, fadeDuration);
	}

	/**
	 * Checks whether a keyframe exists at a timeline position.
	 * @param {number} time Absolute timeline position in milliseconds.
	 * @returns {boolean} Whether the position contains a keyframe.
	 */
	hasKeyframeAt(time: number): boolean {
		const normalizedTime = Math.max(0, Math.floor(time));
		return this.keyframes.some((keyframe) => keyframe.time === normalizedTime);
	}

	/**
	 * Removes the keyframe at a timeline position.
	 * @param {number} time Absolute timeline position in milliseconds.
	 * @returns {void}
	 */
	removeKeyframe(time: number): void {
		const normalizedTime = Math.max(0, Math.floor(time));
		this.keyframes = this.keyframes.filter((keyframe) => keyframe.time !== normalizedTime);
	}

	/**
	 * Returns the keyframe immediately before a timeline position.
	 * @param {number} time Absolute timeline position in milliseconds.
	 * @returns {number | undefined} Previous keyframe time, if any.
	 */
	getPreviousKeyframeTime(time: number): number | undefined {
		return this.keyframes.findLast((keyframe) => keyframe.time < time)?.time;
	}

	/**
	 * Returns the keyframe immediately after a timeline position.
	 * @param {number} time Absolute timeline position in milliseconds.
	 * @returns {number | undefined} Next keyframe time, if any.
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

	constructor(init?: Partial<Category>) {
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
	 * Collects keyframe times from every style in the category.
	 * @returns {number[]} Keyframe times in milliseconds.
	 */
	getAllKeyframeTimes(): number[] {
		return this.styles.flatMap(collectStyleKeyframeTimes);
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
	 * Si la catégorie contient un style composite, le load avec
	 * ses valeurs par défaut.
	 */
	async loadCompositeStyle() {
		for (const style of this.styles) {
			if (style.valueType === 'composite' && !(style.value instanceof Array)) {
				// Charge les styles composites (JSON brut)
				const raw = (await (await fetch('./styles/compositeStyles.json')).json()) as Array<
					Style | Partial<Style>
				>;
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

	constructor(target: 'global' | 'arabic' | string, categories: Category[] = []) {
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
					const mushafStyle = String(globalState.getStyle('arabic', 'mushaf-style')?.value ?? '');

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

					// Le mushaf Soosi force la police Soosi.
					if (mushafStyle === 'Soosi' && subtitleClip instanceof SubtitleClip) {
						css += `font-family: Soosi, sans-serif;\n`;
						continue;
					}

					if (subtitleClip instanceof PredefinedSubtitleClip) {
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

				// Propriétés spécifiques à ignorer
				if (style.id === 'font-family' && String(effectiveValue) === 'Hafs') continue; // Gérer par une classe Tailwind
				if (
					['line-height', 'max-height', 'max-line'].includes(style.id) &&
					(this.target.endsWith('-quran') || this.target.endsWith('-citation'))
				)
					continue;
				if (style.id === 'max-height' && effectiveValue === 0) {
					const maxLineValue = Number(this.getEffectiveValue('max-line', clipId));
					if (maxLineValue >= 1 && maxLineValue <= 4) continue;
					break; // Ignore les propriétés après qui dépendent de max-height
				}
				if (style.id === 'max-height') {
					css += `max-height: ${effectiveValue}px; height: ${effectiveValue}px;\n`;
					continue;
				}
				if (style.id === 'font-size') {
					css += `font-size: calc(${effectiveValue}px * var(--reactive-font-scale, 1));\n`;
					continue;
				}
				if (style.tailwind) continue; // Ignore les styles Tailwind, qui sont appliqués différemment

				// Cas particulier: pour la police d'écriture QPC1 ou QPC2, alors on met la bonne
				// police d'écriture en fonction du verset
				if (
					this.target === 'arabic' &&
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
	 * Adds or replaces a global or per-clip style keyframe.
	 * @param {StyleName} styleId Style identifier to animate.
	 * @param {number} time Absolute timeline position in milliseconds.
	 * @param {Style['value']} value Value active from this position.
	 * @param {number[]} clipIds Clips receiving a local animation, when applicable.
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
	 * Returns unique keyframe times for a style and optional clip overrides.
	 * @param {StyleName} styleId Style identifier to inspect.
	 * @param {number[]} clipIds Clips to inspect, or empty for the base style.
	 * @returns {number[]} Sorted keyframe times in milliseconds.
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
	 * Collects all keyframe times for this style target, including clip overrides.
	 * @returns {number[]} Sorted unique keyframe times in milliseconds.
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
	 * Checks whether a style has a keyframe at a timeline position.
	 * @param {StyleName} styleId Style identifier to inspect.
	 * @param {number} time Absolute timeline position in milliseconds.
	 * @param {number[]} clipIds Clips to inspect, or empty for the base style.
	 * @returns {boolean} Whether a keyframe exists at the position.
	 */
	hasKeyframeAt(styleId: StyleName, time: number, clipIds: number[] = []): boolean {
		const normalizedTime = Math.max(0, Math.floor(time));
		return this.getKeyframeTimes(styleId, clipIds).includes(normalizedTime);
	}

	/**
	 * Removes a global or per-clip style keyframe.
	 * @param {StyleName} styleId Style identifier to modify.
	 * @param {number} time Absolute timeline position in milliseconds.
	 * @param {number[]} clipIds Clips to modify, or empty for the base style.
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
				const keyframesByClip = this.overrideKeyframes[clipId];
				if (!byClip && !keyframesByClip) continue;

				// Supprime l'override pour ce style sur ce clip
				if (byClip?.[styleId] !== undefined) {
					delete byClip[styleId];
				}

				// Nettoyage de l'objet clip s'il est vide
				if (Object.keys(byClip ?? {}).length === 0) {
					delete this.overrides[clipId];
				}

				if (keyframesByClip?.[styleId]) delete keyframesByClip[styleId];
				if (keyframesByClip && Object.keys(keyframesByClip).length === 0) {
					delete this.overrideKeyframes[clipId];
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
		let value = style ? style.getValueAt(currentTime) : '';
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
	 * Resolves a boolean style as a visibility opacity for preview rendering.
	 * @param {StyleName} styleId Visibility style identifier.
	 * @param {number | undefined} clipId Clip carrying a local override.
	 * @param {number | undefined} time Absolute timeline position in milliseconds.
	 * @param {number} fadeDuration Transition duration in milliseconds.
	 * @returns {number} Visibility opacity from zero to one.
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
			const keyframes = this.overrideKeyframes[clipId]?.[styleId];
			return !!((byClip && byClip[styleId] !== undefined) || (keyframes && keyframes.length > 0));
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

		// Chaque override pour un clip est un objet plat { styleId: value },
		// donc il suffit de vérifier s'il y a au moins une clé.
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
				[styleId in StyleName]?: string | number | boolean;
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
	 * Collects all style keyframe times needed by preview and export.
	 * @returns {number[]} Sorted unique keyframe times in milliseconds.
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
		const [globalDefaults, subtitleDefaults] = (await Promise.all([
			fetch('./styles/globalStyles.json').then((response) => response.json()),
			fetch('./styles/styles.json').then((response) => response.json())
		])) as [RawCategory[], RawCategory[]];

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
		const subtitleStyles = await (await fetch('./styles/styles.json')).json();

		// Ajoute les styles par défaut pour chaque target
		videoStyle.styles.push(
			new StylesData('global', await (await fetch('./styles/globalStyles.json')).json())
		);
		videoStyle.styles.push(new StylesData('arabic', subtitleStyles));
		videoStyle.styles.push(new StylesData('arabic-quran', subtitleStyles));
		videoStyle.styles.push(new StylesData('arabic-citation', subtitleStyles));

		// Set les styles par défaut pour l'arabe
		videoStyle.getStylesOfTarget('arabic').setStyle('font-family', 'Noto Sans Arabic');
		// videoStyle.getStylesOfTarget('arabic').setStyle('max-height', 220); // Une ligne max
		videoStyle.getStylesOfTarget('arabic').setStyle('line-height', 1.6);
		videoStyle.getStylesOfTarget('arabic').setStyle('font-size', 90);
		videoStyle.getStylesOfTarget('arabic').setStyle('vertical-position', -110);
		videoStyle.getStylesOfTarget('arabic-quran').setStyle('font-family', 'QPC2');
		videoStyle.getStylesOfTarget('arabic-quran').setStyle('text-color', '#ffffff');
		videoStyle.getStylesOfTarget('arabic-quran').setStyle('text-glow-enable', true);
		videoStyle.getStylesOfTarget('arabic-quran').setStyle('text-glow-color', '#ffffff');
		videoStyle.getStylesOfTarget('arabic-quran').setStyle('text-glow-blur', 50);
		videoStyle.getStylesOfTarget('arabic-quran').setStyle('font-size', 90);
		videoStyle.getStylesOfTarget('arabic-quran').setStyle('line-height', 1.6);
		videoStyle.getStylesOfTarget('arabic-citation').setStyle('font-family', 'Noto Sans Arabic');
		videoStyle.getStylesOfTarget('arabic-citation').setStyle('text-color', '#f7ff8a');
		videoStyle.getStylesOfTarget('arabic-citation').setStyle('font-size', 90);
		videoStyle.getStylesOfTarget('arabic-citation').setStyle('line-height', 1.6);

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
		const defaultStyles = getNonArabicSubtitleCategories(
			await (await fetch('./styles/styles.json')).json()
		);

		for (const target of [
			translationEdition,
			`${translationEdition}-quran`,
			`${translationEdition}-citation`
		]) {
			if (this.doesTargetStyleExist(target)) continue;

			const stylesData = new StylesData(
				target,
				defaultStyles.map((category) => new Category(category))
			);

			// Styles par défaut pour les traductions
			stylesData.setStyle('font-family', 'Georgia'); // Définit la police par défaut
			// stylesData.setStyle('max-height', 280); // 3 lignes max
			stylesData.setStyle('font-size', 60); // Définit la taille de police par défaut
			stylesData.setStyle('vertical-position', 70); // Définit la hauteur de ligne par défaut
			// Styles spécifiques pour les traductions du Coran et les citations
			if (target === `${translationEdition}-quran`) {
				stylesData.setStyle('text-color', '#ffffff');
				stylesData.setStyle('text-glow-enable', true);
				stylesData.setStyle('text-glow-color', '#ffffff');
				stylesData.setStyle('text-glow-blur', 50);
			}
			if (target === `${translationEdition}-citation`) {
				stylesData.setStyle('text-color', '#f7ff8a');
			}

			this.styles.push(stylesData);
		}
	}

	/**
	 * Merge les styles manquants avec les JSON par défaut, sans écraser les valeurs existantes.
	 * Utile quand de nouveaux styles sont ajoutés dans une update.
	 * @param customClips Clips personnalisés du projet en cours de migration.
	 */
	async ensureStylesSchemaUpToDate(customClips?: Clip[]): Promise<boolean> {
		let hasChanges = false;

		const globalDefaults = await (await fetch('./styles/globalStyles.json')).json();
		hasChanges = this.mergeMissingStylesForTarget('global', globalDefaults) || hasChanges;

		const subtitleDefaults = await (await fetch('./styles/styles.json')).json();
		const missingQuranStyles = !this.doesTargetStyleExist('arabic-quran');
		const missingCitationStyles = !this.doesTargetStyleExist('arabic-citation');
		for (const target of ['arabic-quran', 'arabic-citation']) {
			hasChanges = this.mergeMissingStylesForTarget(target, subtitleDefaults) || hasChanges;
		}
		if (missingQuranStyles) {
			this.getStylesOfTarget('arabic-quran').setStyle('font-family', 'QPC2');
			this.getStylesOfTarget('arabic-quran').setStyle('text-color', '#ffffff');
			this.getStylesOfTarget('arabic-quran').setStyle('text-glow-enable', true);
			this.getStylesOfTarget('arabic-quran').setStyle('text-glow-color', '#ffffff');
			this.getStylesOfTarget('arabic-quran').setStyle('text-glow-blur', 50);
			this.getStylesOfTarget('arabic-quran').setStyle('font-size', 90);
			this.getStylesOfTarget('arabic-quran').setStyle('line-height', 1.6);
		}
		if (missingCitationStyles) {
			this.getStylesOfTarget('arabic-citation').setStyle('font-family', 'Noto Sans Arabic');
			this.getStylesOfTarget('arabic-citation').setStyle('text-color', '#f7ff8a');
			this.getStylesOfTarget('arabic-citation').setStyle('font-size', 90);
			this.getStylesOfTarget('arabic-citation').setStyle('line-height', 1.6);
		}
		for (const stylesData of this.styles) {
			if (stylesData.target === 'global') continue;
			const targetDefaults = ['arabic', 'arabic-quran', 'arabic-citation'].includes(
				stylesData.target
			)
				? subtitleDefaults
				: getNonArabicSubtitleCategories(subtitleDefaults);
			hasChanges =
				this.mergeMissingStylesForTarget(stylesData.target, targetDefaults) || hasChanges;
		}

		// Migration minimale: ajouter tous les styles manquants de customText.json
		// aux custom texts existants.
		const customTextDefaults = (await (
			await fetch('./styles/customText.json')
		).json()) as RawCategory;
		const customImageDefaults = (await (
			await fetch('./styles/customImage.json')
		).json()) as RawCategory;
		const compositeDefaults = (await (
			await fetch('./styles/compositeStyles.json')
		).json()) as RawStyle[];
		const customTextDefaultStyles = customTextDefaults.styles || [];
		const customImageDefaultStyles = customImageDefaults.styles || [];

		const projectCustomClips =
			customClips ??
			globalState.currentProject?.content?.timeline.tracks.find(
				(track) => track.type === TrackType.CustomClip
			)?.clips ??
			[];

		for (const clip of projectCustomClips) {
			if (!(clip instanceof CustomTextClip || clip instanceof CustomImageClip) || !clip.category)
				continue;
			const defaultStyles =
				clip instanceof CustomImageClip ? customImageDefaultStyles : customTextDefaultStyles;

			for (const defaultStyle of defaultStyles) {
				if (defaultStyle.id === 'custom-text-composite') {
					const suffix = clip.category.id.startsWith('custom-text-')
						? clip.category.id.slice('custom-text-'.length)
						: '';
					const resolvedCompositeId = suffix ? `custom-text-composite-${suffix}` : defaultStyle.id;

					const hasCompositeStyle = clip.category.styles.some(
						(s) =>
							s.id === 'custom-text-composite' ||
							s.id === resolvedCompositeId ||
							s.id.startsWith('custom-text-composite-')
					);

					if (!hasCompositeStyle) {
						clip.category.styles.push(
							new Style({
								...defaultStyle,
								id: resolvedCompositeId,
								value: compositeDefaults.map((s) => new Style(s))
							})
						);
						hasChanges = true;
					}
					continue;
				}

				const hasStyle = clip.category.styles.some((s) => s.id === defaultStyle.id);
				if (!hasStyle) {
					const migratedRanges =
						defaultStyle.id === 'time-ranges'
							? getTimedOverlayRangesFromStyles(clip.category.styles)
							: [];
					clip.category.styles.push(
						new Style({
							...defaultStyle,
							value: migratedRanges.length > 0 ? migratedRanges : defaultStyle.value
						})
					);
					hasChanges = true;
				}
			}
		}

		return hasChanges;
	}

	private mergeMissingStylesForTarget(
		target: string,
		defaultCategoriesRaw: RawCategory[]
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
					targetCategory.styles.push(new Style(defaultStyleRaw));
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
		const raw = await (await fetch('./styles/customText.json')).json();
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
		const raw = await (await fetch('./styles/customImage.json')).json();
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
	 * @returns
	 */
	getCustomTextCompositeStyles(customTextId: string): Style[] {
		for (const clip of globalState.getCustomClipTrack.clips) {
			if (!(clip instanceof CustomTextClip)) continue;
			const style = clip.category!.getStyle(customTextId as StyleName);
			if (style) return style.value as Style[];
		}
		return [];
	}

	/**
	 * Exporte les styles vers un fichier
	 * @param includedExportClips Optionnellement, une liste des customs-text à inclure
	 * @return Les données exportées en format JSON
	 */
	exportStylesData(includedExportClips: Set<number>): VideoStyleFileData {
		const serializedVideoStyle = JSON.parse(JSON.stringify(this)) as Record<string, unknown> & {
			styles: Array<{ overrides: Record<string, unknown> }>;
		};
		const exportData: VideoStyleFileData = {
			videoStyle: serializedVideoStyle,
			customClips: []
		};
		// Enlève tout les overrides
		for (const style of serializedVideoStyle.styles) {
			style.overrides = {};
		}
		// Ajoute les customs texts clips
		for (const clip of globalState.getCustomClipTrack.clips) {
			if (includedExportClips.has(clip.id)) {
				const _clip = JSON.parse(JSON.stringify(clip));
				exportData.customClips.push(_clip);
			}
		}
		return exportData;
	}

	exportStyles(includedExportClips: Set<number>): string {
		return JSON.stringify(this.exportStylesData(includedExportClips), null, 2);
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

	async importStyles(json: VideoStyleFileData) {
		ProjectHistoryManager.begin('import styles');
		try {
			// Crée une nouvelle instance VideoStyle à partir des données JSON
			const importedVideoStyle = VideoStyle.fromJSON(
				json.videoStyle as unknown as Record<string, unknown>
			) as VideoStyle;
			const currentProjectTranslations = globalState.getProjectTranslation.addedTranslationEditions;

			// Gérer l'import des styles 'arabic' et 'global' (toujours override)
			for (const importedStyle of importedVideoStyle.styles) {
				if (importedStyle.target === 'arabic' || importedStyle.target === 'global') {
					// Override automatiquement les styles arabic et global
					const existingStyle = this.getStylesOfTarget(importedStyle.target);
					if (existingStyle) {
						// Remplace complètement les styles existants
						const index = this.styles.findIndex((s) => s.target === importedStyle.target);
						if (index !== -1) {
							this.styles[index] = importedStyle;
						}
					} else {
						this.styles.push(importedStyle);
					}
				}
			}

			// Gérer l'import des traductions
			for (const importedStyle of importedVideoStyle.styles) {
				if (importedStyle.target === 'arabic' || importedStyle.target === 'global') continue;

				// Chercher si cette traduction existe déjà dans le projet
				const existingProjectTranslation = currentProjectTranslations.find(
					(t) => t.name === importedStyle.target
				);

				if (existingProjectTranslation) {
					// 1. Même traduction trouvée -> override automatiquement
					const existingStyleIndex = this.styles.findIndex(
						(s) => s.target === importedStyle.target
					);
					if (existingStyleIndex !== -1) {
						this.styles[existingStyleIndex] = importedStyle;
					} else {
						this.styles.push(importedStyle);
					}
				}
			}

			// 3. Gérer les traductions du projet qui n'existent PAS dans le fichier importé
			for (const projectTranslation of currentProjectTranslations) {
				const existsInImported = importedVideoStyle.styles.some(
					(importedStyle) =>
						importedStyle.target === projectTranslation.name &&
						importedStyle.target !== 'arabic' &&
						importedStyle.target !== 'global'
				);

				if (!existsInImported) {
					// Cette traduction du projet n'existe pas dans le fichier importé
					// Proposer d'appliquer les styles disponibles dans le fichier importé
					const availableImportedTranslations = importedVideoStyle.styles.filter(
						(s) => s.target !== 'arabic' && s.target !== 'global'
					);

					for (const importedStyle of availableImportedTranslations) {
						const confirm = await ModalManager.confirmModal(
							get(LL).translations.translationNoStyles({ name: projectTranslation.name }),
							true
						);

						if (confirm) {
							// Créer une copie du style importé avec le nouveau target
							const newStyle = JSON.parse(JSON.stringify(importedStyle));
							newStyle.target = projectTranslation.name;

							// Ajouter ou remplacer le style pour cette traduction
							const existingStyleIndex = this.styles.findIndex(
								(s) => s.target === projectTranslation.name
							);
							const parsedStyle = StylesData.fromJSON(
								newStyle as unknown as Record<string, unknown>
							) as StylesData;
							if (existingStyleIndex !== -1) {
								this.styles[existingStyleIndex] = parsedStyle;
							} else {
								this.styles.push(parsedStyle);
							}

							break; // Arrêter dès qu'un style est appliqué
						}
					}
				}
			}

			// Ajoute les customs text clips en créant des instances correctes
			for (const clipData of json.customClips || json.customTextClips || []) {
				clipData.id = Utilities.randomId(); // Assure qu'il a un ID unique

				// Crée une nouvelle instance CustomTextClip à partir des données JSON
				const clip: CustomTextClip | CustomImageClip =
					clipData.type === 'Custom Text'
						? (CustomTextClip.fromJSON(
								clipData as unknown as Record<string, unknown>
							) as CustomTextClip)
						: (CustomImageClip.fromJSON(
								clipData as unknown as Record<string, unknown>
							) as CustomImageClip);
				globalState.getCustomClipTrack.clips.push(clip);
			}

			// Garantit que les styles ajoutes dans les nouvelles versions existent aussi apres import
			// d'un ancien fichier de styles.
			await this.ensureStylesSchemaUpToDate();
		} finally {
			ProjectHistoryManager.commit();
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
