import { globalState } from '$lib/runes/main.svelte.js';
import QPCFontProvider from '$lib/services/FontProvider.js';
import { getRiwayahFontFamily, isNonHafsRiwayah } from '$lib/services/RiwayahProvider.js';
import {
	PredefinedSubtitleClip,
	SubtitleClip,
	getForcedFontForPredefinedSubtitle
} from '../Clip.svelte.js';
import type { Category } from './Category.svelte.js';
import { RUNTIME_LAYOUT_STYLE_IDS } from './styleRuntime.js';
import type { StyleName } from './types.js';

export type StyleCssSource = {
	target: string;
	categories: Category[];
	getEffectiveValue: (styleId: StyleName, clipId?: number) => string | number | boolean;
};

/** Génère les représentations CSS et Tailwind d'une collection de styles. */
export class StyleCssGenerator {
	/**
	 * Génère les déclarations CSS actives d'une cible.
	 * @param {StyleCssSource} source Collection et résolveur de valeurs.
	 * @param {number} [clipId] Identifiant du clip dont les overrides doivent être appliqués.
	 * @param {string[]} excludedCategories Catégories à exclure.
	 * @returns {string} Déclarations CSS générées.
	 */
	static generate(
		source: StyleCssSource,
		clipId?: number,
		excludedCategories: string[] = []
	): string {
		let css = '';
		for (const category of source.categories) {
			for (const style of category.styles) {
				if (RUNTIME_LAYOUT_STYLE_IDS.has(style.id as StyleName)) continue;
				const effectiveValue = source.getEffectiveValue(style.id as StyleName, clipId);
				const isCategoryToggle =
					style.valueType === 'boolean' &&
					style.id.includes('enable') &&
					style.id !== 'enable-italic';
				if (isCategoryToggle) {
					if (!effectiveValue) break;
					continue;
				}
				if (style.id === 'enable-italic' && !effectiveValue) continue;
				if (excludedCategories.includes(style.getCategory())) continue;

				const fontRule = this.getArabicFontRule(source, style.id, effectiveValue, clipId);
				if (fontRule !== null) {
					css += fontRule;
					continue;
				}
				const scaleRule = this.getBasmalaScaleRule(source, style.id, clipId);
				if (scaleRule !== null) {
					css += scaleRule;
					continue;
				}
				if (style.id === 'font-family' && String(effectiveValue) === 'Hafs') continue;
				if (style.id === 'max-height' && effectiveValue === 0) {
					const maxLineValue = Number(source.getEffectiveValue('max-line', clipId));
					if (maxLineValue >= 1 && maxLineValue <= 4) continue;
					break;
				}
				if (style.tailwind) continue;
				const qpcRule = this.getQpcFontRule(source, style.id, effectiveValue, clipId);
				if (qpcRule !== null) {
					css += qpcRule;
					continue;
				}
				if (style.id === 'vertical-text-alignment' || style.id === 'horizontal-text-alignment') {
					const cssMap = style.css as unknown as Record<string, string>;
					css += (cssMap[String(effectiveValue)] ?? '') + '\n';
					continue;
				}
				if (
					style.id === 'background-color' &&
					typeof effectiveValue === 'string' &&
					effectiveValue.startsWith('#')
				) {
					const red = parseInt(effectiveValue.slice(1, 3), 16);
					const green = parseInt(effectiveValue.slice(3, 5), 16);
					const blue = parseInt(effectiveValue.slice(5, 7), 16);
					css += `background-color: rgba(${red}, ${green}, ${blue}, var(--background-opacity));\n`;
					continue;
				}
				if (style.id === 'show-subtitles' && !effectiveValue) return 'display: none;';
				if (style.id === 'text-direction' && !effectiveValue) continue;
				const cssRule = style.css.replaceAll(/{value}/g, String(effectiveValue));
				if (cssRule.trim()) css += cssRule + '\n';
			}
		}
		return css;
	}

	/**
	 * Génère les classes Tailwind actives d'une cible.
	 * @param {Category[]} categories Catégories à parcourir.
	 * @param {number} currentTime Position courante en millisecondes.
	 * @returns {string} Classes Tailwind concaténées.
	 */
	static generateTailwind(categories: Category[], currentTime: number): string {
		let classes = '';
		for (const category of categories) {
			for (const style of category.styles) {
				const effectiveValue = style.getValueAt(currentTime);
				if (style.id === 'font-family' && effectiveValue === 'Hafs') {
					classes += 'arabic ';
					continue;
				}
				if (!style.tailwind || !style.tailwindClass) continue;
				const tailwindClass = style.tailwindClass.replaceAll(/{value}/g, String(effectiveValue));
				if (tailwindClass.trim()) classes += tailwindClass + ' ';
			}
		}
		return classes.trim();
	}

	/**
	 * Résout les polices arabes imposées par la riwayah ou un sous-titre prédéfini.
	 * @param {StyleCssSource} source Collection de styles.
	 * @param {string} styleId Identifiant du style courant.
	 * @param {string | number | boolean} effectiveValue Valeur résolue du style.
	 * @param {number} [clipId] Identifiant du clip courant.
	 * @returns {string | null} Règle CSS, ou `null` lorsque ce cas ne s'applique pas.
	 */
	private static getArabicFontRule(
		source: StyleCssSource,
		styleId: string,
		effectiveValue: string | number | boolean,
		clipId?: number
	): string | null {
		if (source.target !== 'arabic' || styleId !== 'font-family' || !clipId) return null;
		const clip = globalState.getSubtitleTrack.getClipById(clipId);
		const mushafStyle = String(source.getEffectiveValue('mushaf-style', clipId) ?? '');
		const riwayah = source.getEffectiveValue('riwayah', clipId);
		if (isNonHafsRiwayah(riwayah) && clip instanceof SubtitleClip) {
			return `font-family: ${getRiwayahFontFamily(riwayah)}, sans-serif;\n`;
		}
		if (mushafStyle === 'Tajweed' && clip instanceof SubtitleClip) {
			const tajweed = QPCFontProvider.getTajweedFontNameForVerse(clip.surah, clip.verse);
			const fallback = QPCFontProvider.getFontNameForVerse(clip.surah, clip.verse, '2');
			return `font-family: ${tajweed}, ${fallback};\n`;
		}
		if (mushafStyle === 'Indopak' && clip instanceof SubtitleClip) {
			return 'font-family: IndoPak, sans-serif;\n';
		}
		if (!(clip instanceof PredefinedSubtitleClip)) return null;
		const basmalaStyle = String(
			source.getEffectiveValue('basmala-style', clip.id) ?? 'current-font'
		);
		if (clip.predefinedSubtitleType === 'Basmala' && basmalaStyle !== 'current-font') {
			return 'font-family: Basmalah;\n';
		}
		const forcedFont = getForcedFontForPredefinedSubtitle(
			clip.predefinedSubtitleType,
			String(effectiveValue)
		);
		if (!forcedFont) return null;
		return forcedFont === 'Hafs'
			? "font-family: 'Hafs', sans-serif;\n"
			: `font-family: ${forcedFont};\n`;
	}

	/**
	 * Résout l'échelle calligraphique particulière de la basmala.
	 * @param {StyleCssSource} source Collection de styles.
	 * @param {string} styleId Identifiant du style courant.
	 * @param {number} [clipId] Identifiant du clip courant.
	 * @returns {string | null} Règle CSS, ou `null` lorsque ce cas ne s'applique pas.
	 */
	private static getBasmalaScaleRule(
		source: StyleCssSource,
		styleId: string,
		clipId?: number
	): string | null {
		if (source.target !== 'arabic' || styleId !== 'scale' || !clipId) return null;
		const clip = globalState.getSubtitleTrack.getClipById(clipId);
		const basmalaStyle = String(
			source.getEffectiveValue('basmala-style', clipId) ?? 'current-font'
		);
		return clip instanceof PredefinedSubtitleClip &&
			clip.predefinedSubtitleType === 'Basmala' &&
			basmalaStyle !== 'current-font'
			? `--scale: ${source.getEffectiveValue('basmala-scale', clipId) ?? 100}%;\n`
			: null;
	}

	/**
	 * Résout la police QPC dépendante de la page du verset.
	 * @param {StyleCssSource} source Collection de styles.
	 * @param {string} styleId Identifiant du style courant.
	 * @param {string | number | boolean} effectiveValue Valeur résolue du style.
	 * @param {number} [clipId] Identifiant du clip courant.
	 * @returns {string | null} Règle CSS, ou `null` lorsque ce cas ne s'applique pas.
	 */
	private static getQpcFontRule(
		source: StyleCssSource,
		styleId: string,
		effectiveValue: string | number | boolean,
		clipId?: number
	): string | null {
		const font = String(effectiveValue);
		if (styleId !== 'font-family' || (font !== 'QPC1' && font !== 'QPC2') || !clipId) {
			return null;
		}
		const clip = globalState.getSubtitleTrack.getClipById(clipId);
		const fontName =
			clip instanceof SubtitleClip
				? QPCFontProvider.getFontNameForVerse(clip.surah, clip.verse, font === 'QPC1' ? '1' : '2')
				: font === 'QPC1'
					? 'QPC1BSML'
					: 'QPC2BSML';
		return `font-family: ${fontName};\n`;
	}
}
