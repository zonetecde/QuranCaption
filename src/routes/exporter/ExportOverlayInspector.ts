import { globalState } from '$lib/runes/main.svelte';
import {
	getBlankImageFileName,
	getBlankVisualStateKey,
	type ExportTimedOverlayCaptureClip
} from '$lib/services/ExportCaptureTiming';

/** Regroupe les décisions liées à la réutilisation visuelle des captures d'overlay. */
export class ExportOverlayInspector {
	/**
	 * Retourne le nom du blank déjà planifié pour l'état visuel courant.
	 * @param {Record<string, number>} blankFrames Blanks sources par état visuel.
	 * @param {number} timing Timing courant.
	 * @param {ExportTimedOverlayCaptureClip[]} timedOverlays Overlays temporels.
	 * @returns {string | null} Nom du blank sans extension.
	 */
	static getReusableBlankFileName(
		blankFrames: Record<string, number>,
		timing: number,
		timedOverlays: ExportTimedOverlayCaptureClip[]
	): string | null {
		const currentSurah = globalState.getSubtitleTrack.getCurrentSurah(timing);
		const key = getBlankVisualStateKey(currentSurah, timing, timedOverlays);
		return blankFrames[key] !== undefined ? getBlankImageFileName(key) : null;
	}

	/**
	 * Indique si l'overlay contient un fond ou une bordure de sous-titre visible.
	 * @param {HTMLElement} node Racine de l'overlay à capturer.
	 * @returns {boolean} true si le blank réutilisable ne convient pas.
	 */
	static hasVisibleSubtitleBackground(node: HTMLElement): boolean {
		const backgrounds = node.querySelector<HTMLElement>('#subtitles-backgrounds');
		if (!backgrounds || !this.isVisible(backgrounds)) return false;

		return Array.from(backgrounds.querySelectorAll<HTMLElement>('.subtitle')).some((element) => {
			const style = getComputedStyle(element);
			const hasBackground =
				(style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)') ||
				(style.backgroundImage && style.backgroundImage !== 'none');
			const hasBorder =
				Number.parseFloat(style.borderTopWidth) > 0 ||
				Number.parseFloat(style.borderRightWidth) > 0 ||
				Number.parseFloat(style.borderBottomWidth) > 0 ||
				Number.parseFloat(style.borderLeftWidth) > 0;
			return this.isVisible(element) && (hasBackground || hasBorder || style.boxShadow !== 'none');
		});
	}

	/**
	 * Vérifie la visibilité calculée d'un élément.
	 * @param {HTMLElement} element Élément à inspecter.
	 * @returns {boolean} true si l'élément participe visuellement au rendu.
	 */
	private static isVisible(element: HTMLElement): boolean {
		const style = getComputedStyle(element);
		return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0;
	}
}
