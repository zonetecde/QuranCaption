import type { Style, StyleName, VideoStyle } from '$lib/classes/VideoStyle.svelte';
import type {
	DimensionValue,
	FadeValue
} from '$lib/components/projectEditor/tabs/subtitlesEditor/modal/autoSegmentation/types';
import { ProjectHistoryManager } from './undoRedo/ProjectHistoryManager';

export type StyleMutationResult = {
	refreshPreview: boolean;
	showTajweedWarning: boolean;
};

/**
 * Démarre une interaction de style regroupant plusieurs valeurs intermédiaires.
 * @param {string} label Libellé de la transaction undo/redo.
 * @returns {void}
 */
export function beginStyleMutation(label: string): void {
	ProjectHistoryManager.begin(label);
}

/**
 * Termine l'interaction de style courante.
 * @returns {void}
 */
export function commitStyleMutation(): void {
	ProjectHistoryManager.commit();
}

type StyleMutationOptions = {
	videoStyle: VideoStyle;
	style: Style;
	target?: string;
	clipIds: number[];
	value: unknown;
	applyBaseValue: (value: Style['value']) => void;
};

const PREVIEW_LAYOUT_STYLE_IDS = new Set([
	'max-height',
	'max-line',
	'font-size',
	'word-spacing',
	'font-family'
]);

/**
 * Normalise une valeur de dimensions issue d'un style.
 * @param {unknown} value Valeur à normaliser.
 * @returns {DimensionValue} Dimensions exploitables par le contrôle et le modèle.
 */
export function asDimensionValue(value: unknown): DimensionValue {
	if (
		typeof value === 'object' &&
		value !== null &&
		'width' in value &&
		'height' in value &&
		typeof (value as DimensionValue).width === 'number' &&
		typeof (value as DimensionValue).height === 'number'
	) {
		return value as DimensionValue;
	}
	return { width: 1920, height: 1080 };
}

/**
 * Normalise une valeur de fondu issue d'un style.
 * @param {unknown} value Valeur à normaliser.
 * @returns {FadeValue} Configuration de fondu complète.
 */
export function asFadeValue(value: unknown): FadeValue {
	const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<FadeValue>;
	return {
		fadeDurationMs: typeof raw.fadeDurationMs === 'number' ? raw.fadeDurationMs : 1000,
		videoFadeInEnabled: !!raw.videoFadeInEnabled,
		videoFadeOutEnabled: !!raw.videoFadeOutEnabled,
		audioFadeInEnabled: !!raw.audioFadeInEnabled,
		audioFadeOutEnabled: !!raw.audioFadeOutEnabled
	};
}

/**
 * Normalise une valeur selon le type déclaré par sa définition de style.
 * @param {Style} style Style portant le type attendu.
 * @param {unknown} value Valeur brute issue d'un contrôle.
 * @returns {Style['value']} Valeur compatible avec le modèle.
 */
export function coerceStyleValue(style: Style, value: unknown): Style['value'] {
	if (style.valueType === 'number') return Number(value);
	if (style.valueType === 'boolean') return Boolean(value);
	if (style.valueType === 'dimension') return asDimensionValue(value);
	if (style.valueType === 'fade') return asFadeValue(value);
	return value as Style['value'];
}

/**
 * Applique une mutation utilisateur avec sa portée, ses invariants et une transaction d'historique.
 * @param {StyleMutationOptions} options Contexte complet de la mutation.
 * @returns {StyleMutationResult} Effets UI que l'adapter appelant doit déclencher.
 */
export function applyStyleMutation(options: StyleMutationOptions): StyleMutationResult {
	return ProjectHistoryManager.track('set style value', () => {
		const value = coerceStyleValue(options.style, options.value);
		const result = applyArabicStyleInvariants(options, value);
		if (!result.handled) applyScopedValue(options, value);

		return {
			refreshPreview:
				result.refreshPreview || PREVIEW_LAYOUT_STYLE_IDS.has(options.style.id as StyleName),
			showTajweedWarning: result.showTajweedWarning
		};
	});
}

/**
 * Applique la valeur à la sélection locale ou à la valeur de base.
 * @param {StyleMutationOptions} options Contexte de mutation.
 * @param {Style['value']} value Valeur normalisée.
 * @returns {void}
 */
function applyScopedValue(options: StyleMutationOptions, value: Style['value']): void {
	if (
		options.target &&
		options.clipIds.length > 0 &&
		(typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
	) {
		options.videoStyle
			.getStylesOfTarget(options.target)
			.setStyleForClips(options.clipIds, options.style.id as StyleName, value);
		return;
	}
	options.applyBaseValue(value);
}

/**
 * Maintient la cohérence entre le mushaf et la police arabe.
 * @param {StyleMutationOptions} options Contexte de mutation.
 * @param {Style['value']} value Valeur normalisée.
 * @returns {{handled: boolean; refreshPreview: boolean; showTajweedWarning: boolean}} Résultat de l'invariant.
 */
function applyArabicStyleInvariants(
	options: StyleMutationOptions,
	value: Style['value']
): { handled: boolean; refreshPreview: boolean; showTajweedWarning: boolean } {
	if (options.target !== 'arabic' || typeof value !== 'string') {
		return { handled: false, refreshPreview: false, showTajweedWarning: false };
	}

	const arabicStyles = options.videoStyle.getStylesOfTarget('arabic');
	if (options.style.id === 'mushaf-style') {
		arabicStyles.setStyle('mushaf-style', value);
		const font =
			value === 'Indopak'
				? 'IndoPak'
				: value === 'Tajweed'
					? 'QPC2'
					: value === 'Soosi'
						? 'Soosi'
						: 'Hafs';
		arabicStyles.setStyle('font-family', font);
		return { handled: true, refreshPreview: true, showTajweedWarning: value === 'Tajweed' };
	}

	if (options.style.id === 'font-family' && options.clipIds.length === 0) {
		if (value === 'IndoPak') arabicStyles.setStyle('mushaf-style', 'Indopak');
		else if (value === 'Soosi') arabicStyles.setStyle('mushaf-style', 'Soosi');
		else if (arabicStyles.findStyle('mushaf-style')?.value === 'Tajweed' && value !== 'QPC2') {
			arabicStyles.setStyle('mushaf-style', 'Uthmani');
		}
	}

	return { handled: false, refreshPreview: false, showTajweedWarning: false };
}
