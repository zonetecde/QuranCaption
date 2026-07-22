import type { SubtitleClip } from '$lib/classes/Clip.svelte';
import { Utilities } from '$lib/classes/misc/Utilities';
import type { SegmentationWordTimestamp } from '$lib/services/AutoSegmentation';
import {
	isWordByWordVisualEnabled,
	type ResolveStyleValue
} from '$lib/services/StyleVisualResolver';
export { isWordByWordVisualEnabled as isWordByWordHighlightEnabled } from '$lib/services/StyleVisualResolver';

export type WordByWordHighlightState = {
	enabled: boolean;
	highlightEnabled: boolean;
	showCurrentWordOnly: boolean;
	activeWordIndex: number;
	persistColor: boolean;
	revealSpecificWordStyle: boolean;
	revealWordsOnRecitation: boolean;
	alwaysShowVerseNumber: boolean;
	baseOpacity: number;
	baseColor: string;
	verseNumberColor: string;
	color: string;
	backgroundEnabled: boolean;
	backgroundColor: string;
	lineBackgroundEnabled: boolean;
	lineBackgroundColor: string;
	lineBackgroundPosition: number;
	lineBackgroundHeight: number;
	lineBackgroundPadding: number;
	underlineEnabled: boolean;
	underlineThickness: number;
	glowEnabled: boolean;
	glowColor: string;
	glowBlur: number;
	currentWordOpacityEnabled: boolean;
	currentWordCustomCss: string;
	currentWordOpacity: number;
	clipStartTimeS: number;
	cursorTimeS: number;
	words: SegmentationWordTimestamp[];
};

/**
 * Retourne l'état désactivé par défaut du highlight mot à mot.
 * @returns {WordByWordHighlightState} Etat inactif.
 */
export function getDisabledWordByWordHighlightState(): WordByWordHighlightState {
	return {
		enabled: false,
		highlightEnabled: false,
		showCurrentWordOnly: false,
		activeWordIndex: -1,
		persistColor: false,
		revealSpecificWordStyle: false,
		revealWordsOnRecitation: false,
		alwaysShowVerseNumber: false,
		baseOpacity: 1,
		baseColor: '',
		verseNumberColor: '',
		color: '',
		backgroundEnabled: false,
		backgroundColor: '',
		lineBackgroundEnabled: false,
		lineBackgroundColor: '',
		lineBackgroundPosition: 0,
		lineBackgroundHeight: 1,
		lineBackgroundPadding: 0,
		underlineEnabled: false,
		underlineThickness: 1,
		glowEnabled: false,
		glowColor: '',
		glowBlur: 10,
		currentWordOpacityEnabled: false,
		currentWordCustomCss: '',
		currentWordOpacity: 1,
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
	isArabicMerged: boolean,
	hasMergedWordSource: boolean = false
): boolean {
	if (!subtitle) return false;
	if (isArabicMerged && !hasMergedWordSource) return false;
	if (!hasMergedWordSource && (subtitle.alignmentMetadata?.words.length ?? 0) === 0) return false;

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
	words?: SegmentationWordTimestamp[];
	clipStartTimeS?: number;
	baseOpacity?: number;
}): WordByWordHighlightState {
	const { subtitle, isArabicMerged, cursorTimeS, getStyleValue } = params;
	const words = params.words ?? subtitle?.alignmentMetadata?.words ?? [];
	const clipStartTimeS = params.clipStartTimeS ?? subtitle?.alignmentMetadata?.timeFrom ?? 0;
	if (!canRenderWordByWordHighlight(subtitle, isArabicMerged, words.length > 0)) {
		return getDisabledWordByWordHighlightState();
	}

	const highlightEnabled = Boolean(getStyleValue('enable-wbw-highlight'));
	const showCurrentWordOnly = Boolean(getStyleValue('wbw-show-current-word-only'));
	const underlineEnabled = Boolean(getStyleValue('enable-wbw-underline'));
	const glowEnabled = Boolean(getStyleValue('enable-wbw-glow'));
	const revealSpecificWordStyle = Boolean(getStyleValue('wbw-reveal-specific-word-style'));
	const revealWordsOnRecitation = Boolean(getStyleValue('wbw-reveal-on-recitation'));
	const backgroundEnabled = Boolean(getStyleValue('enable-wbw-background'));
	const lineBackgroundEnabled = Boolean(getStyleValue('enable-wbw-line-background'));
	const globalLineBackgroundEnabled = Boolean(getStyleValue('line-background-enable'));
	const isEnabled = isWordByWordVisualEnabled(getStyleValue);
	const currentWordOpacityEnabled = Boolean(getStyleValue('enable-wbw-current-word-opacity'));
	const currentWordCustomCss = String(getStyleValue('wbw-current-word-custom-css') ?? '');
	const currentWordOpacityValue = Number(getStyleValue('wbw-current-word-opacity') ?? 1);
	const currentWordOpacity = Number.isFinite(currentWordOpacityValue)
		? Utilities.clamp01(currentWordOpacityValue)
		: 1;
	if (!isEnabled) return getDisabledWordByWordHighlightState();

	const wbwTimingEpsilonS = 0.0005;
	let activeWordIndex = words.findIndex((word) => {
		const wordStartTimeS = clipStartTimeS + word.start;
		const wordEndTimeS = clipStartTimeS + word.end;
		return (
			cursorTimeS + wbwTimingEpsilonS >= wordStartTimeS &&
			cursorTimeS <= wordEndTimeS + wbwTimingEpsilonS
		);
	});
	if (activeWordIndex === -1 && words.length > 0) {
		activeWordIndex =
			words.findLastIndex((word) => cursorTimeS >= clipStartTimeS + word.end - wbwTimingEpsilonS) +
			1;
	}
	if (
		activeWordIndex === -1 &&
		words.length > 0 &&
		cursorTimeS > clipStartTimeS + words[words.length - 1].end
	) {
		activeWordIndex = words.length;
	}

	return {
		enabled: words.length > 0,
		highlightEnabled: showCurrentWordOnly ? false : highlightEnabled,
		showCurrentWordOnly,
		activeWordIndex,
		persistColor: showCurrentWordOnly ? false : Boolean(getStyleValue('wbw-persist-color')),
		revealSpecificWordStyle: showCurrentWordOnly ? false : revealSpecificWordStyle,
		revealWordsOnRecitation: showCurrentWordOnly ? false : revealWordsOnRecitation,
		alwaysShowVerseNumber: showCurrentWordOnly
			? false
			: Boolean(getStyleValue('wbw-always-show-verse-number')),
		baseOpacity: Utilities.clamp01(Number(params.baseOpacity ?? 1)),
		baseColor: String(getStyleValue('text-color') ?? ''),
		verseNumberColor: String(getStyleValue('verse-number-color') ?? ''),
		color: String(getStyleValue('wbw-color') ?? ''),
		backgroundEnabled: showCurrentWordOnly ? false : backgroundEnabled,
		backgroundColor: String(getStyleValue('wbw-bg-color') ?? ''),
		lineBackgroundEnabled,
		lineBackgroundColor: String(getStyleValue('wbw-line-background-color') ?? ''),
		lineBackgroundPosition: Number(
			getStyleValue(
				globalLineBackgroundEnabled ? 'line-background-position' : 'wbw-line-background-position'
			) ?? 0
		),
		lineBackgroundHeight: Math.max(
			1,
			Number(
				getStyleValue(
					globalLineBackgroundEnabled ? 'line-background-height' : 'wbw-line-background-height'
				) ?? 1
			)
		),
		lineBackgroundPadding: Math.max(0, Number(getStyleValue('wbw-line-background-padding') ?? 0)),
		underlineEnabled: showCurrentWordOnly ? false : underlineEnabled,
		underlineThickness: Number(getStyleValue('wbw-underline-thickness') ?? 1),
		glowEnabled: showCurrentWordOnly ? false : glowEnabled,
		glowColor: String(getStyleValue('wbw-glow-color') ?? ''),
		glowBlur: Number(getStyleValue('wbw-glow-blur') ?? 10),
		currentWordOpacityEnabled,
		currentWordCustomCss,
		currentWordOpacity,
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
export function interpolateCssColor(fromColor: string, toColor: string, progress: number): string {
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
	fadeDurationMs: number,
	baseColorOverride?: string
): string {
	const parts: string[] = [];
	const clampedProgress = Utilities.clamp01(highlightProgress);
	const opacity = getWordByWordWordOpacity(wordIndex, state, fadeDurationMs, true, clampedProgress);
	const effectiveBaseColor = baseColorOverride ?? state.baseColor;
	const customCss = wordIndex === state.activeWordIndex ? state.currentWordCustomCss : '';
	const shouldWriteOpacity =
		state.revealWordsOnRecitation ||
		state.showCurrentWordOnly ||
		state.currentWordOpacityEnabled ||
		state.baseOpacity !== 1;

	if (state.underlineEnabled) {
		parts.push('text-decoration-line: underline;');
		parts.push(`text-decoration-thickness: ${Math.max(1, state.underlineThickness)}px;`);
		parts.push('text-underline-offset: 0.18em;');
		parts.push(`text-decoration-color: ${interpolateCssColor('', state.color, clampedProgress)};`);
	}

	if (clampedProgress === 0 || fadeDurationMs < 0) {
		if (shouldWriteOpacity) {
			parts.push(`opacity: ${opacity};`);
		}
		if (customCss.trim()) parts.push(customCss);
		return parts.join(' ');
	}

	if (state.highlightEnabled && state.color) {
		parts.push(`color: ${interpolateCssColor(effectiveBaseColor, state.color, clampedProgress)};`);
	}
	if (state.backgroundEnabled && state.backgroundColor && state.backgroundColor !== '#00000000') {
		parts.push(
			`background-color: ${interpolateCssColor('', state.backgroundColor, clampedProgress)};`
		);
	}
	if (
		state.lineBackgroundEnabled &&
		state.lineBackgroundColor &&
		state.lineBackgroundColor !== '#00000000'
	) {
		parts.push(
			`--wbw-line-background-color: ${interpolateCssColor('', state.lineBackgroundColor, clampedProgress)};`
		);
		parts.push(`--wbw-line-background-position: ${state.lineBackgroundPosition}px;`);
		parts.push(`--wbw-line-background-height: ${state.lineBackgroundHeight}px;`);
		parts.push(`--wbw-line-background-padding: ${state.lineBackgroundPadding}px;`);
	}
	if (state.glowEnabled && state.glowColor && state.glowColor !== '#00000000') {
		const glowColor = interpolateCssColor('', state.glowColor, clampedProgress);
		const glowBlur = Math.max(0, state.glowBlur);
		parts.push(
			`text-shadow: 0 0 ${glowBlur * 0.5}px ${glowColor}, 0 0 ${glowBlur}px ${glowColor}, 0 0 ${glowBlur * 1.5}px ${glowColor}, 0 0 ${glowBlur * 2}px ${glowColor};`
		);
	}
	if (shouldWriteOpacity) {
		parts.push(`opacity: ${opacity};`);
	}
	if (customCss.trim()) parts.push(customCss);
	return parts.join(' ');
}

/**
 * Retourne les classes de barre WBW d'un mot selon ses voisins actuellement surlignés.
 * @param {number} wordIndex Index du mot dans le clip.
 * @param {WordByWordHighlightState} state Etat de highlight courant.
 * @param {number} highlightProgress Progression du highlight entre 0 et 1.
 * @param {number} fadeDurationMs Durée de fade à réutiliser pour la preview.
 * @param {{ previous: boolean; next: boolean }} [connectedNeighbors] Connexions visuelles déjà résolues.
 * @returns {string} Classes CSS de la barre WBW, ou chaîne vide.
 */
export function getWordByWordLineBackgroundClass(
	wordIndex: number,
	state: WordByWordHighlightState,
	highlightProgress: number,
	fadeDurationMs: number,
	connectedNeighbors?: { previous: boolean; next: boolean }
): string {
	if (
		!state.lineBackgroundEnabled ||
		!state.lineBackgroundColor ||
		state.lineBackgroundColor === '#00000000' ||
		highlightProgress <= 0 ||
		fadeDurationMs < 0
	) {
		return '';
	}

	if (!state.persistColor && !connectedNeighbors) {
		return 'wbw-line-background wbw-line-background-single';
	}

	const hasPrevious =
		connectedNeighbors?.previous ??
		getWordByWordHighlightProgress(wordIndex - 1, state, fadeDurationMs) > 0;
	const hasNext =
		connectedNeighbors?.next ??
		getWordByWordHighlightProgress(wordIndex + 1, state, fadeDurationMs) >= 1;

	if (!hasPrevious && !hasNext) return 'wbw-line-background wbw-line-background-single';
	if (!hasPrevious) return 'wbw-line-background wbw-line-background-start';
	if (!hasNext) return 'wbw-line-background wbw-line-background-end';
	return 'wbw-line-background';
}

/**
 * Retourne l'opacité à appliquer à un mot WBW selon son état de recitation.
 * @param {WordByWordHighlightState} state Etat de highlight courant.
 * @param {number} fadeDurationMs Durée de fade à réutiliser pour la preview.
 * @param {boolean} useCurrentWordOpacity Indique si l'opacité custom du mot courant doit être appliquée.
 * @param {number | null} highlightProgress Progression WBW à utiliser pour interpoler l'opacité custom.
 * @returns {number} Opacité normalisée entre 0 et 1.
 */
export function getWordByWordWordOpacity(
	wordIndex: number,
	state: WordByWordHighlightState,
	fadeDurationMs: number,
	useCurrentWordOpacity: boolean = true,
	highlightProgress: number | null = null
): number {
	if (!state.enabled) return 1;

	const activeWordOpacity =
		useCurrentWordOpacity && state.currentWordOpacityEnabled
			? state.baseOpacity +
				(state.currentWordOpacity - state.baseOpacity) * Utilities.clamp01(highlightProgress ?? 0)
			: state.baseOpacity;
	if (!state.revealWordsOnRecitation && !state.showCurrentWordOnly) return activeWordOpacity;

	const word = state.words[wordIndex];
	if (!word) return 0;
	const fadeDurationS = Math.max(0, fadeDurationMs) / 1000;
	const currentTimeS = state.cursorTimeS;
	const wordStartTimeS = state.clipStartTimeS + word.start;
	const wordEndTimeS = state.clipStartTimeS + word.end;

	if (state.showCurrentWordOnly) {
		if (fadeDurationS === 0) {
			return currentTimeS >= wordStartTimeS && currentTimeS <= wordEndTimeS ? activeWordOpacity : 0;
		}

		const wordDurationS = Math.max(0, wordEndTimeS - wordStartTimeS);
		const effectiveFadeDurationS = Math.min(fadeDurationS, wordDurationS / 2);
		if (effectiveFadeDurationS <= 0) {
			return currentTimeS >= wordStartTimeS && currentTimeS <= wordEndTimeS ? activeWordOpacity : 0;
		}

		if (currentTimeS < wordStartTimeS || currentTimeS > wordEndTimeS) return 0;
		if (currentTimeS <= wordStartTimeS + effectiveFadeDurationS) {
			return (
				Utilities.clamp01((currentTimeS - wordStartTimeS) / effectiveFadeDurationS) *
				activeWordOpacity
			);
		}
		if (currentTimeS >= wordEndTimeS - effectiveFadeDurationS) {
			return (
				Utilities.clamp01((wordEndTimeS - currentTimeS) / effectiveFadeDurationS) *
				activeWordOpacity
			);
		}
		return activeWordOpacity;
	}

	if (wordIndex < state.activeWordIndex) return state.baseOpacity;
	if (wordIndex > state.activeWordIndex) return 0;
	if (state.activeWordIndex >= state.words.length) return state.baseOpacity;

	if (fadeDurationS === 0) {
		return currentTimeS >= wordStartTimeS ? activeWordOpacity : 0;
	}

	if (currentTimeS < wordStartTimeS) return 0;
	if (currentTimeS <= wordStartTimeS + fadeDurationS) {
		return Utilities.clamp01((currentTimeS - wordStartTimeS) / fadeDurationS) * activeWordOpacity;
	}
	if (currentTimeS <= wordEndTimeS) return activeWordOpacity;
	return activeWordOpacity;
}
