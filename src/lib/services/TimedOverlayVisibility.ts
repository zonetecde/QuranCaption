import { getTimedOverlayRanges, type TimedOverlayRange } from './TimedOverlayRanges';

export type TimedOverlayVisibilityParams = {
	alwaysShow: boolean;
	maxOpacity: number;
	currentTime: number;
	fadeDuration: number;
	ranges?: TimedOverlayRange[] | null;
	startTime?: number | null;
	endTime?: number | null;
};

/**
 * Calcule l'opacité d'une seule plage temporelle.
 * @param {TimedOverlayRange} range Plage à évaluer.
 * @param {number} currentTime Temps courant en millisecondes.
 * @param {number} fadeDuration Durée du fondu en millisecondes.
 * @param {number} maxOpacity Opacité maximale.
 * @returns {number} Opacité de la plage.
 */
function getTimedOverlayRangeOpacity(
	range: TimedOverlayRange,
	currentTime: number,
	fadeDuration: number,
	maxOpacity: number
): number {
	const { startTime, endTime } = range;

	// Avant l'apparition
	if (currentTime < startTime) return 0;

	// Bascule instantanée quand le fondu est désactivé
	if (fadeDuration <= 0) {
		if (currentTime >= startTime && currentTime <= endTime) return maxOpacity;
		return 0;
	}

	// Fondu d'entrée
	if (currentTime >= startTime && currentTime < startTime + fadeDuration) {
		const t = (currentTime - startTime) / fadeDuration;
		return Math.max(0, Math.min(1, t)) * maxOpacity;
	}

	// Opacité complète
	if (currentTime >= startTime + fadeDuration && currentTime < endTime - fadeDuration) {
		return maxOpacity;
	}

	// Fondu de sortie
	if (currentTime >= endTime - fadeDuration && currentTime <= endTime) {
		const t = (endTime - currentTime) / fadeDuration;
		return Math.max(0, Math.min(1, t)) * maxOpacity;
	}

	// Après la disparition
	return 0;
}

/**
 * Computes overlay opacity using the same timing model as custom text/image overlays.
 * @param {TimedOverlayVisibilityParams} options Paramètres de visibilité temporelle.
 * @returns {number} Opacité calculée.
 */
export function getTimedOverlayOpacity({
	alwaysShow,
	maxOpacity,
	currentTime,
	fadeDuration,
	ranges,
	startTime,
	endTime
}: TimedOverlayVisibilityParams): number {
	if (alwaysShow) return maxOpacity;

	const resolvedRanges = getTimedOverlayRanges(ranges, startTime, endTime);
	return resolvedRanges.reduce(
		(maximumOpacity, range) =>
			Math.max(
				maximumOpacity,
				getTimedOverlayRangeOpacity(range, currentTime, fadeDuration, maxOpacity)
			),
		0
	);
}
