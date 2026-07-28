import { Utilities } from '$lib/classes/misc/Utilities';

/**
 * Paramètres de l'overlay d'arrière-plan (flou, couleur, dégradé).
 */
export interface OverlaySettings {
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
}

type FadeCurve = 'linear' | 'ease-in' | 'ease-out' | 'smooth';

const FADE_CURVES = new Set<FadeCurve>(['linear', 'ease-in', 'ease-out', 'smooth']);
const OVERLAY_MODES = new Set([
	'uniform',
	'fade-up',
	'fade-down',
	'fade-center',
	'fade-left',
	'fade-right',
	'fade-left-right',
	'fade-top-bottom',
	'fade-four-corners',
	'fade-four-sides',
	'fade-vignette',
	'fade-top-left',
	'fade-top-right',
	'fade-bottom-left',
	'fade-bottom-right'
]);
const CURVE_SAMPLES = [0, 0.25, 0.5, 0.75, 1];

/**
 * Contraint une dimension de fade dans l'intervalle supporté.
 * @param {number} value Dimension demandée.
 * @returns {number} Dimension comprise entre 0.1 et 2.
 */
function clampFadeDimension(value: number): number {
	if (!Number.isFinite(value)) return 1;
	return Math.min(2, Math.max(0.1, value));
}

/**
 * Applique la courbe sélectionnée à une progression normalisée.
 * @param {number} progress Progression comprise entre 0 et 1.
 * @param {FadeCurve} curve Courbe de fade normalisée.
 * @returns {number} Progression transformée.
 */
function applyFadeCurve(progress: number, curve: FadeCurve): number {
	if (curve === 'ease-in') return progress * progress;
	if (curve === 'ease-out') return 1 - (1 - progress) * (1 - progress);
	if (curve === 'smooth') return progress * progress * (3 - 2 * progress);
	return progress;
}

/**
 * Formate un stop de masque CSS.
 * @param {number} opacity Opacité du masque.
 * @param {number} position Position du stop en pourcentage.
 * @returns {string} Stop CSS utilisant le canal alpha.
 */
function formatMaskStop(opacity: number, position: number): string {
	return `rgba(0, 0, 0, ${Utilities.clamp01(opacity)}) ${Math.min(100, Math.max(0, position))}%`;
}

/**
 * Génère les stops d'une transition partant d'un bord ou d'un centre.
 * @param {number} fromOpacity Opacité au début du gradient.
 * @param {number} toOpacity Opacité après la transition.
 * @param {number} fadeEnd Fin de la zone de fade en pourcentage.
 * @param {number} softness Part de la zone utilisée pour la transition.
 * @param {FadeCurve} curve Courbe appliquée à la transition.
 * @returns {string} Liste de stops CSS.
 */
function getOneWayFadeStops(
	fromOpacity: number,
	toOpacity: number,
	fadeEnd: number,
	softness: number,
	curve: FadeCurve
): string {
	const end = Math.min(100, Math.max(0, fadeEnd));
	const transitionStart = end * (1 - softness);
	const stops = [formatMaskStop(fromOpacity, 0)];

	if (transitionStart > 0) stops.push(formatMaskStop(fromOpacity, transitionStart));
	for (const sample of CURVE_SAMPLES) {
		const position = transitionStart + (end - transitionStart) * sample;
		const opacity = fromOpacity + (toOpacity - fromOpacity) * applyFadeCurve(sample, curve);
		stops.push(formatMaskStop(opacity, position));
	}
	stops.push(formatMaskStop(toOpacity, 100));
	return stops.join(', ');
}

/**
 * Génère les stops symétriques d'un fade appliqué aux deux bords d'un axe.
 * @param {number} edgeOpacity Opacité aux deux extrémités.
 * @param {number} centerOpacity Opacité dans la zone centrale.
 * @param {number} fadeCoverage Étendue totale du fade.
 * @param {number} softness Part de la zone utilisée pour la transition.
 * @param {FadeCurve} curve Courbe appliquée à la transition.
 * @returns {string} Liste de stops CSS symétriques.
 */
function getTwoEdgeFadeStops(
	edgeOpacity: number,
	centerOpacity: number,
	fadeCoverage: number,
	softness: number,
	curve: FadeCurve
): string {
	const fadeEnd = fadeCoverage * 50;
	const transitionStart = fadeEnd * (1 - softness);
	const stops = [formatMaskStop(edgeOpacity, 0)];

	if (transitionStart > 0) stops.push(formatMaskStop(edgeOpacity, transitionStart));
	for (const sample of CURVE_SAMPLES) {
		const position = transitionStart + (fadeEnd - transitionStart) * sample;
		const opacity = edgeOpacity + (centerOpacity - edgeOpacity) * applyFadeCurve(sample, curve);
		stops.push(formatMaskStop(opacity, position));
	}
	stops.push(formatMaskStop(centerOpacity, 100 - fadeEnd));
	for (const sample of CURVE_SAMPLES) {
		const position = 100 - fadeEnd + (fadeEnd - transitionStart) * sample;
		const opacity = centerOpacity + (edgeOpacity - centerOpacity) * applyFadeCurve(sample, curve);
		stops.push(formatMaskStop(opacity, position));
	}
	stops.push(formatMaskStop(edgeOpacity, 100));
	return stops.join(', ');
}

/**
 * Assemble le CSS commun d'un overlay piloté par un masque de gradient.
 * @param {string} color Couleur de l'overlay.
 * @param {number} opacity Opacité maximale de l'overlay.
 * @param {string} maskImage Un ou plusieurs gradients de masque.
 * @param {string} maskOptions Propriétés complémentaires du masque.
 * @returns {string} CSS complet de la couche d'overlay.
 */
function getMaskedOverlayCss(
	color: string,
	opacity: number,
	maskImage: string,
	maskOptions = ''
): string {
	return `background-color: ${color}; opacity: ${opacity}; -webkit-mask-image: ${maskImage}; mask-image: ${maskImage}; ${maskOptions}`;
}

/**
 * Génère le CSS de la couche d'overlay (fond coloré ou dégradé) appliquée
 * sur toute la surface de la vidéo derrière les sous-titres.
 *
 * @param {OverlaySettings} settings Paramètres de l'overlay issus du state global.
 * @returns {string} Une chaîne CSS complète pour le style de l'overlay.
 */
export function getOverlayLayerCss(settings: OverlaySettings): string {
	const requestedMode = String(settings.mode || 'uniform');
	const mode = OVERLAY_MODES.has(requestedMode) ? requestedMode : 'uniform';
	const opacity = Utilities.clamp01(Number(settings.opacity));

	if (mode === 'uniform') {
		return `background-color: ${settings.color}; opacity: ${opacity};`;
	}

	const intensity = Utilities.clamp01(Number(settings.fadeIntensity));
	const fadeCoverage = Utilities.clamp01(Number(settings.fadeCoverage));
	const fadeSoftness = Utilities.clamp01(Number(settings.fadeSoftness ?? 1));
	const requestedCurve = String(settings.fadeCurve ?? 'linear') as FadeCurve;
	const fadeCurve = FADE_CURVES.has(requestedCurve) ? requestedCurve : 'linear';
	const fadeInvert = Boolean(settings.fadeInvert ?? false);
	const fadePositionX = Utilities.clamp01(Number(settings.fadePositionX ?? 0.5));
	const fadePositionY = Utilities.clamp01(Number(settings.fadePositionY ?? 0.5));
	const fadeWidth = clampFadeDimension(Number(settings.fadeWidth ?? 1));
	const fadeHeight = clampFadeDimension(Number(settings.fadeHeight ?? 1));
	const [r, g, b] = Utilities.parseColorToRgb(String(settings.color || '#000000'));
	const edgeOpacity = opacity * (1 - intensity);
	const centerOpacity = opacity;

	// Préserve à l'identique le CSS et le rendu des trois modes historiques.
	if (!fadeInvert && fadeSoftness === 1 && fadeCurve === 'linear') {
		if (mode === 'fade-up') {
			const fadeEndPct = Math.max(0, Math.min(100, fadeCoverage * 100));
			const gradient = `linear-gradient(to bottom, rgba(${r}, ${g}, ${b}, ${edgeOpacity}) 0%, rgba(${r}, ${g}, ${b}, ${centerOpacity}) ${fadeEndPct}%, rgba(${r}, ${g}, ${b}, ${centerOpacity}) 100%)`;
			return `background: ${gradient}; opacity: 1;`;
		}
		if (mode === 'fade-down') {
			const fadeStartPct = Math.max(0, Math.min(100, 100 - fadeCoverage * 100));
			const gradient = `linear-gradient(to bottom, rgba(${r}, ${g}, ${b}, ${centerOpacity}) 0%, rgba(${r}, ${g}, ${b}, ${centerOpacity}) ${fadeStartPct}%, rgba(${r}, ${g}, ${b}, ${edgeOpacity}) 100%)`;
			return `background: ${gradient}; opacity: 1;`;
		}
		if (mode === 'fade-center') {
			const fadeEdgePct = Math.max(0, Math.min(50, fadeCoverage * 50));
			const centerStartPct = fadeEdgePct;
			const centerEndPct = 100 - fadeEdgePct;
			const gradient = `linear-gradient(to bottom, rgba(${r}, ${g}, ${b}, ${edgeOpacity}) 0%, rgba(${r}, ${g}, ${b}, ${centerOpacity}) ${centerStartPct}%, rgba(${r}, ${g}, ${b}, ${centerOpacity}) ${centerEndPct}%, rgba(${r}, ${g}, ${b}, ${edgeOpacity}) 100%)`;
			return `background: ${gradient}; opacity: 1;`;
		}
	}

	const weakMaskOpacity = 1 - intensity;
	const namedOpacity = fadeInvert ? weakMaskOpacity : 1;
	const otherOpacity = fadeInvert ? 1 : weakMaskOpacity;
	const fadeEnd = fadeCoverage * 100;

	/**
	 * Génère les stops du fade courant dans une direction.
	 * @param {number} fromOpacity Opacité au début du gradient.
	 * @param {number} toOpacity Opacité après la zone de fade.
	 * @returns {string} Liste de stops CSS.
	 */
	const oneWayStops = (fromOpacity: number, toOpacity: number) =>
		getOneWayFadeStops(fromOpacity, toOpacity, fadeEnd, fadeSoftness, fadeCurve);
	let maskImage = '';
	let maskOptions = '-webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;';

	if (mode === 'fade-up') {
		maskImage = `linear-gradient(to bottom, ${oneWayStops(otherOpacity, namedOpacity)})`;
	} else if (mode === 'fade-down') {
		maskImage = `linear-gradient(to top, ${oneWayStops(otherOpacity, namedOpacity)})`;
	} else if (mode === 'fade-center') {
		maskImage = `linear-gradient(to bottom, ${getTwoEdgeFadeStops(otherOpacity, namedOpacity, fadeCoverage, fadeSoftness, fadeCurve)})`;
	} else if (mode === 'fade-left') {
		maskImage = `linear-gradient(to right, ${oneWayStops(namedOpacity, otherOpacity)})`;
	} else if (mode === 'fade-right') {
		maskImage = `linear-gradient(to left, ${oneWayStops(namedOpacity, otherOpacity)})`;
	} else if (mode === 'fade-left-right') {
		maskImage = `linear-gradient(to right, ${getTwoEdgeFadeStops(namedOpacity, otherOpacity, fadeCoverage, fadeSoftness, fadeCurve)})`;
	} else if (mode === 'fade-top-bottom') {
		maskImage = `linear-gradient(to bottom, ${getTwoEdgeFadeStops(namedOpacity, otherOpacity, fadeCoverage, fadeSoftness, fadeCurve)})`;
	} else if (mode === 'fade-vignette') {
		const radialSoftness = fadeCoverage * fadeSoftness;
		const stops = getOneWayFadeStops(otherOpacity, namedOpacity, 100, radialSoftness, fadeCurve);
		maskImage = `radial-gradient(ellipse ${fadeWidth * 50}% ${fadeHeight * 50}% at ${fadePositionX * 100}% ${fadePositionY * 100}%, ${stops})`;
	} else if (mode === 'fade-four-sides') {
		const sideStops = oneWayStops(namedOpacity, fadeInvert ? 1 : 0);
		maskImage = [
			`linear-gradient(to bottom, ${sideStops})`,
			`linear-gradient(to top, ${sideStops})`,
			`linear-gradient(to right, ${sideStops})`,
			`linear-gradient(to left, ${sideStops})`,
			...(fadeInvert
				? []
				: [
						`linear-gradient(${formatMaskStop(otherOpacity, 0)}, ${formatMaskStop(otherOpacity, 100)})`
					])
		].join(', ');
		maskOptions += fadeInvert
			? ' -webkit-mask-composite: source-in; mask-composite: intersect;'
			: ' -webkit-mask-composite: source-over; mask-composite: add;';
	} else {
		const cornerPositions: Record<string, string> = {
			'fade-top-left': 'left top',
			'fade-top-right': 'right top',
			'fade-bottom-left': 'left bottom',
			'fade-bottom-right': 'right bottom'
		};
		const cornerStops = oneWayStops(namedOpacity, otherOpacity);

		if (mode === 'fade-four-corners') {
			maskImage = [
				`radial-gradient(ellipse ${fadeWidth * 100}% ${fadeHeight * 100}% at left top, ${cornerStops})`,
				`radial-gradient(ellipse ${fadeWidth * 100}% ${fadeHeight * 100}% at right top, ${cornerStops})`,
				`radial-gradient(ellipse ${fadeWidth * 100}% ${fadeHeight * 100}% at left bottom, ${cornerStops})`,
				`radial-gradient(ellipse ${fadeWidth * 100}% ${fadeHeight * 100}% at right bottom, ${cornerStops})`
			].join(', ');
			maskOptions +=
				' -webkit-mask-size: 50% 50%, 50% 50%, 50% 50%, 50% 50%; mask-size: 50% 50%, 50% 50%, 50% 50%, 50% 50%; -webkit-mask-position: left top, right top, left bottom, right bottom; mask-position: left top, right top, left bottom, right bottom;';
		} else {
			const corner = cornerPositions[mode];
			maskImage = `radial-gradient(ellipse ${fadeWidth * 100}% ${fadeHeight * 100}% at ${corner}, ${cornerStops})`;
		}
	}

	return getMaskedOverlayCss(String(settings.color || '#000000'), opacity, maskImage, maskOptions);
}

/**
 * Calcule le padding horizontal CSS à appliquer au conteneur de texte
 * quand le fond (background) du sous-titre est activé.
 *
 * @param isBackgroundEnabled - Si le fond est activé pour cette cible.
 * @param paddingPx - Valeur de padding en pixels.
 * @returns Chaîne CSS `padding-left/right` ou chaîne vide si non applicable.
 */
export function getBackgroundHorizontalPaddingCss(
	isBackgroundEnabled: boolean,
	paddingPx: number
): string {
	if (!isBackgroundEnabled) return '';

	if (!Number.isFinite(paddingPx) || paddingPx <= 0) return '';

	return `padding-left: ${paddingPx}px; padding-right: ${paddingPx}px;`;
}

/**
 * Génère le CSS block compatible avec `modern-screenshot` et aligne
 * verticalement le contenu dans son conteneur.
 *
 * @param {string} verticalAlignment Alignement vertical demandé.
 * @returns {string} CSS de layout export.
 */
export function getExportCaptureLayoutCss(verticalAlignment: string): string {
	const alignContent =
		verticalAlignment === 'bottom' ? 'end' : verticalAlignment === 'top' ? 'start' : 'center';

	return `display: block; align-content: ${alignContent}; transform: translate(var(--translate-x, 0px), var(--translate-y, 0px)) rotate(var(--rotation, 0deg)) scale(var(--scale, 1));`;
}
