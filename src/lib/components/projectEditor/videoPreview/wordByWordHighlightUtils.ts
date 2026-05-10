import type { SubtitleClip } from '$lib/classes/Clip.svelte';
import { Utilities } from '$lib/classes/misc/Utilities';
import type { SegmentationWordTimestamp } from '$lib/services/AutoSegmentation';

export type WordByWordHighlightState = {
	enabled: boolean;
	activeWordIndex: number;
	persistColor: boolean;
	revealWordsOnRecitation: boolean;
	baseColor: string;
	color: string;
	backgroundEnabled: boolean;
	backgroundColor: string;
	underlineEnabled: boolean;
	underlineThickness: number;
	clipStartTimeS: number;
	cursorTimeS: number;
	words: SegmentationWordTimestamp[];
};

type ResolveStyleValue = (styleId: string) => string | number | boolean;

/**
 * Retourne l'état désactivé par défaut du highlight mot à mot.
 * @returns {WordByWordHighlightState} Etat inactif.
 */
export function getDisabledWordByWordHighlightState(): WordByWordHighlightState {
	return {
		enabled: false,
		activeWordIndex: -1,
		persistColor: false,
		revealWordsOnRecitation: false,
		baseColor: '',
		color: '',
		backgroundEnabled: false,
		backgroundColor: '',
		underlineEnabled: false,
		underlineThickness: 1,
		clipStartTimeS: 0,
		cursorTimeS: 0,
		words: []
	};
}

/**
 * Indique si le rendu arabe peut être animé mot à mot sans casser le rendu Mushaf actuel.
 * @param {SubtitleClip | null} subtitle Clip Quran courant.
 * @param {boolean} isArabicMerged Indique si le rendu arabe est merge visuellement.
 * @returns {boolean} `true` si le rendu mot à mot est fiable.
 */
export function canRenderWordByWordHighlight(
	subtitle: SubtitleClip | null,
	isArabicMerged: boolean
): boolean {
	if (!subtitle) return false;
	if (isArabicMerged) return false;
	if ((subtitle.alignmentMetadata?.words.length ?? 0) === 0) return false;

	return true;
}

/**
 * Calcule l'etat du highlight mot a mot pour le clip arabe courant.
 * @param {object} params Parametres de calcul.
 * @param {SubtitleClip | null} params.subtitle Clip Quran courant.
 * @param {boolean} params.isArabicMerged Indique si le rendu arabe est merge visuellement.
 * @param {string} params.mushafStyle Style Mushaf courant.
 * @param {number} params.cursorTimeS Temps courant de la timeline en secondes.
 * @param {ResolveStyleValue} params.getStyleValue Lecteur de styles effectifs.
 * @returns {WordByWordHighlightState} Etat de rendu du highlight.
 */
export function getWordByWordHighlightState(params: {
	subtitle: SubtitleClip | null;
	isArabicMerged: boolean;
	mushafStyle: string;
	cursorTimeS: number;
	getStyleValue: ResolveStyleValue;
}): WordByWordHighlightState {
	const { subtitle, isArabicMerged, cursorTimeS, getStyleValue } = params;
	if (!canRenderWordByWordHighlight(subtitle, isArabicMerged)) {
		return getDisabledWordByWordHighlightState();
	}

	const isEnabled = Boolean(getStyleValue('enable-wbw-highlight'));
	if (!isEnabled) return getDisabledWordByWordHighlightState();

	const clipStartTimeS = subtitle!.alignmentMetadata?.timeFrom ?? 0;
	const words = subtitle!.alignmentMetadata?.words ?? [];
	let activeWordIndex = words.findIndex((word) => {
		const wordStartTimeS = clipStartTimeS + word.start;
		const wordEndTimeS = clipStartTimeS + word.end;
		return cursorTimeS >= wordStartTimeS && cursorTimeS <= wordEndTimeS;
	});
	if (
		activeWordIndex === -1 &&
		words.length > 0 &&
		cursorTimeS > clipStartTimeS + words[words.length - 1].end
	) {
		activeWordIndex = words.length;
	}

	return {
		enabled: activeWordIndex !== -1,
		activeWordIndex,
		persistColor: Boolean(getStyleValue('wbw-persist-color')),
		revealWordsOnRecitation: Boolean(getStyleValue('wbw-reveal-on-recitation')),
		baseColor: String(getStyleValue('text-color') ?? ''),
		color: String(getStyleValue('wbw-color') ?? ''),
		backgroundEnabled: Boolean(getStyleValue('enable-wbw-background')),
		backgroundColor: String(getStyleValue('wbw-bg-color') ?? ''),
		underlineEnabled: Boolean(getStyleValue('enable-wbw-underline')),
		underlineThickness: Number(getStyleValue('wbw-underline-thickness') ?? 1),
		clipStartTimeS,
		cursorTimeS,
		words
	};
}

/**
 * Convertit une couleur CSS courante vers un objet RGBA.
 * @param {string} color Couleur CSS source.
 * @returns {{ r: number; g: number; b: number; a: number } | null} Couleur parsee, ou `null`.
 */
function parseColorToRgba(color: string): { r: number; g: number; b: number; a: number } | null {
	const normalized = String(color).trim();
	if (!normalized) return null;

	if (/^#[0-9a-fA-F]{8}$/.test(normalized)) {
		return {
			r: parseInt(normalized.slice(1, 3), 16),
			g: parseInt(normalized.slice(3, 5), 16),
			b: parseInt(normalized.slice(5, 7), 16),
			a: parseInt(normalized.slice(7, 9), 16) / 255
		};
	}

	const rgba = normalized.match(
		/^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*([\d.]+)\s*\)$/i
	);
	if (rgba) {
		return {
			r: Number(rgba[1]),
			g: Number(rgba[2]),
			b: Number(rgba[3]),
			a: Utilities.clamp01(Number(rgba[4]))
		};
	}

	const [r, g, b] = Utilities.parseColorToRgb(normalized);
	if (normalized.startsWith('#') || normalized.startsWith('rgb')) {
		return { r, g, b, a: 1 };
	}

	return null;
}

/**
 * Interpole deux couleurs CSS vers une couleur RGBA finale.
 * @param {string} fromColor Couleur de départ.
 * @param {string} toColor Couleur d'arrivée.
 * @param {number} progress Progression normalisée entre 0 et 1.
 * @returns {string} Couleur CSS interpolée.
 */
function interpolateCssColor(fromColor: string, toColor: string, progress: number): string {
	const from = parseColorToRgba(fromColor);
	const to = parseColorToRgba(toColor);
	if (!to) return fromColor;
	if (!from) {
		return `rgba(${to.r}, ${to.g}, ${to.b}, ${Utilities.clamp01(progress) * to.a})`;
	}

	const clampedProgress = Utilities.clamp01(progress);
	const mix = (start: number, end: number) => start + (end - start) * clampedProgress;
	return `rgba(${Math.round(mix(from.r, to.r))}, ${Math.round(mix(from.g, to.g))}, ${Math.round(
		mix(from.b, to.b)
	)}, ${mix(from.a, to.a)})`;
}

/**
 * Retourne la progression de highlight d'un mot au temps courant.
 * @param {number} wordIndex Index du mot dans le clip.
 * @param {WordByWordHighlightState} state Etat de highlight courant.
 * @param {number} fadeDurationMs Durée de fade à réutiliser pour la preview.
 * @returns {number} Progression normalisée entre 0 et 1.
 */
export function getWordByWordHighlightProgress(
	wordIndex: number,
	state: WordByWordHighlightState,
	fadeDurationMs: number
): number {
	if (!state.enabled) return 0;

	const word = state.words[wordIndex];
	if (!word) return 0;

	if (state.persistColor && wordIndex < state.activeWordIndex) return 1;

	const fadeDurationS = Math.max(0, fadeDurationMs) / 1000;
	const wordStartTimeS = state.clipStartTimeS + word.start;
	const wordEndTimeS = state.clipStartTimeS + word.end;
	const currentTimeS = state.cursorTimeS;

	if (state.persistColor && wordIndex === state.activeWordIndex) {
		if (fadeDurationS === 0) return currentTimeS >= wordStartTimeS ? 1 : 0;
		return Utilities.clamp01((currentTimeS - wordStartTimeS) / fadeDurationS);
	}

	if (fadeDurationS === 0) {
		return currentTimeS >= wordStartTimeS && currentTimeS <= wordEndTimeS ? 1 : 0;
	}

	if (currentTimeS < wordStartTimeS || currentTimeS > wordEndTimeS + fadeDurationS) return 0;
	if (currentTimeS <= wordStartTimeS + fadeDurationS) {
		return Utilities.clamp01((currentTimeS - wordStartTimeS) / fadeDurationS);
	}
	if (currentTimeS <= wordEndTimeS) return 1;
	return Utilities.clamp01(1 - (currentTimeS - wordEndTimeS) / fadeDurationS);
}

/**
 * Retourne le CSS inline applique à un mot surligné.
 * @param {WordByWordHighlightState} state Etat de highlight courant.
 * @param {number} highlightProgress Progression du highlight entre 0 et 1.
 * @param {number} fadeDurationMs Durée de fade à réutiliser pour la preview.
 * @returns {string} CSS inline du mot.
 */
export function getWordByWordWordCss(
	wordIndex: number,
	state: WordByWordHighlightState,
	highlightProgress: number,
	fadeDurationMs: number
): string {
	const parts: string[] = [];
	const clampedProgress = Utilities.clamp01(highlightProgress);
	const opacity = getWordByWordWordOpacity(wordIndex, state, fadeDurationMs);

	if (state.underlineEnabled) {
		parts.push('text-decoration-line: underline;');
		parts.push(`text-decoration-thickness: ${Math.max(1, state.underlineThickness)}px;`);
		parts.push('text-underline-offset: 0.18em;');
		parts.push(`text-decoration-color: ${interpolateCssColor('', state.color, clampedProgress)};`);
	}

	if (clampedProgress === 0 || fadeDurationMs < 0) {
		if (state.revealWordsOnRecitation) {
			parts.push(`opacity: ${opacity};`);
		}
		return parts.join(' ');
	}

	if (state.color) {
		parts.push(`color: ${interpolateCssColor(state.baseColor, state.color, clampedProgress)};`);
	}
	if (state.backgroundEnabled && state.backgroundColor && state.backgroundColor !== '#00000000') {
		parts.push(
			`background-color: ${interpolateCssColor('', state.backgroundColor, clampedProgress)};`
		);
	}
	if (state.revealWordsOnRecitation) {
		parts.push(`opacity: ${opacity};`);
	}
	return parts.join(' ');
}

/**
 * Retourne l'opacité à appliquer à un mot WBW selon son état de recitation.
 * @param {WordByWordHighlightState} state Etat de highlight courant.
 * @param {number} fadeDurationMs Durée de fade à réutiliser pour la preview.
 * @returns {number} Opacité normalisée entre 0 et 1.
 */
function getWordByWordWordOpacity(
	wordIndex: number,
	state: WordByWordHighlightState,
	fadeDurationMs: number
): number {
	if (!state.revealWordsOnRecitation || !state.enabled) return 1;

	const word = state.words[wordIndex];
	if (!word) return 0;
	if (wordIndex < state.activeWordIndex) return 1;
	if (wordIndex > state.activeWordIndex) return 0;
	if (state.activeWordIndex >= state.words.length) return 1;

	const fadeDurationS = Math.max(0, fadeDurationMs) / 1000;
	const currentTimeS = state.cursorTimeS;
	const wordStartTimeS = state.clipStartTimeS + word.start;
	const wordEndTimeS = state.clipStartTimeS + word.end;

	if (fadeDurationS === 0) {
		return currentTimeS >= wordStartTimeS ? 1 : 0;
	}

	if (currentTimeS < wordStartTimeS) return 0;
	if (currentTimeS <= wordStartTimeS + fadeDurationS) {
		return Utilities.clamp01((currentTimeS - wordStartTimeS) / fadeDurationS);
	}
	if (currentTimeS <= wordEndTimeS) return 1;
	return 1;
}
