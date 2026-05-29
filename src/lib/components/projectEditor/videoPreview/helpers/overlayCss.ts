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
	customCSS: string;
}

/**
 * Génère le CSS de la couche d'overlay (fond coloré ou dégradé) appliquée
 * sur toute la surface de la vidéo derrière les sous-titres.
 *
 * Deux modes sont supportés :
 * - **uniform** : couleur unie avec opacité
 * - **fade-up / fade-down / fade-center** : dégradé linéaire avec
 *   intensité et couverture de fondu configurables.
 *
 * @param settings - Paramètres de l'overlay issus du state global.
 * @returns Une chaîne CSS complète pour le style de l'overlay.
 */
export function getOverlayLayerCss(settings: OverlaySettings): string {
	const mode = String(settings.mode || 'uniform');
	const opacity = Utilities.clamp01(Number(settings.opacity));

	if (mode === 'uniform') {
		return `background-color: ${settings.color}; opacity: ${opacity};`;
	}

	const intensity = Utilities.clamp01(Number(settings.fadeIntensity));
	const fadeCoverage = Utilities.clamp01(Number(settings.fadeCoverage));
	const [r, g, b] = Utilities.parseColorToRgb(String(settings.color || '#000000'));
	const edgeOpacity = opacity * (1 - intensity);
	const centerOpacity = opacity;

	let gradient = '';

	if (mode === 'fade-up') {
		// Le fondu part du haut (edge) vers le bas (center)
		const fadeEndPct = Math.max(0, Math.min(100, fadeCoverage * 100));
		gradient = `linear-gradient(to bottom, rgba(${r}, ${g}, ${b}, ${edgeOpacity}) 0%, rgba(${r}, ${g}, ${b}, ${centerOpacity}) ${fadeEndPct}%, rgba(${r}, ${g}, ${b}, ${centerOpacity}) 100%)`;
	} else if (mode === 'fade-down') {
		// Le fondu part du bas (edge) vers le haut (center)
		const fadeStartPct = Math.max(0, Math.min(100, 100 - fadeCoverage * 100));
		gradient = `linear-gradient(to bottom, rgba(${r}, ${g}, ${b}, ${centerOpacity}) 0%, rgba(${r}, ${g}, ${b}, ${centerOpacity}) ${fadeStartPct}%, rgba(${r}, ${g}, ${b}, ${edgeOpacity}) 100%)`;
	} else if (mode === 'fade-center') {
		// Le fondu est au centre, les bords sont atténués
		const fadeEdgePct = Math.max(0, Math.min(50, fadeCoverage * 50));
		const centerStartPct = fadeEdgePct;
		const centerEndPct = 100 - fadeEdgePct;
		gradient = `linear-gradient(to bottom, rgba(${r}, ${g}, ${b}, ${edgeOpacity}) 0%, rgba(${r}, ${g}, ${b}, ${centerOpacity}) ${centerStartPct}%, rgba(${r}, ${g}, ${b}, ${centerOpacity}) ${centerEndPct}%, rgba(${r}, ${g}, ${b}, ${edgeOpacity}) 100%)`;
	} else {
		// Fallback uniforme pour les modes inconnus
		return `background-color: ${settings.color}; opacity: ${opacity};`;
	}

	return `background: ${gradient}; opacity: 1;`;
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
 * Calcule le décalage vertical du texte quand l'export force `display: block`.
 *
 * @param {HTMLElement} element Élément de sous-titre mesuré.
 * @param {string} verticalAlignment Alignement vertical demandé.
 * @returns {number} Décalage vertical en pixels CSS.
 */
export function getExportVerticalAlignmentOffset(
	element: HTMLElement,
	verticalAlignment: string
): number {
	if (verticalAlignment === 'top') return 0;

	const elementHeight = element.clientHeight;
	if (!Number.isFinite(elementHeight) || elementHeight <= 0) return 0;

	const range = document.createRange();
	range.selectNodeContents(element);

	try {
		const rects = Array.from(range.getClientRects()).filter(
			(rect) => rect.width > 0 && rect.height > 0
		);
		if (rects.length === 0) return 0;

		const top = Math.min(...rects.map((rect) => rect.top));
		const bottom = Math.max(...rects.map((rect) => rect.bottom));
		const elementRect = element.getBoundingClientRect();
		const scaleY = elementRect.height > 0 ? elementRect.height / elementHeight : 1;
		const contentHeight = (bottom - top) / (Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1);
		const availableHeight = Math.max(0, elementHeight - contentHeight);

		return verticalAlignment === 'bottom' ? availableHeight : availableHeight / 2;
	} finally {
		range.detach();
	}
}

/**
 * Génère le CSS d'export qui garde le flux texte compatible avec `modern-screenshot`.
 *
 * @param {number} verticalOffsetPx Décalage vertical en pixels CSS.
 * @returns {string} CSS de layout export.
 */
export function getExportCaptureLayoutCss(verticalOffsetPx: number): string {
	return `display: block; transform: translate(var(--translate-x, 0px), calc(var(--translate-y, 0px) + ${verticalOffsetPx}px)) rotate(var(--rotation, 0deg)) scale(var(--scale, 1));`;
}
