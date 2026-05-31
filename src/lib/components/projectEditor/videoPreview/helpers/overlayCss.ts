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
