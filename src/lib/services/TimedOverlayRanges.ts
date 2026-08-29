export type TimedOverlayRange = {
	startTime: number;
	endTime: number;
};

export const MIN_TIMED_OVERLAY_DURATION = 100;

/**
 * Convertit une valeur inconnue en temps fini et positif.
 * @param {unknown} value Valeur à convertir.
 * @returns {number | null} Temps exploitable ou `null`.
 */
function toTimedOverlayTime(value: unknown): number | null {
	if (typeof value !== 'number' || !Number.isFinite(value)) return null;
	return Math.max(0, value);
}

/**
 * Nettoie une liste de plages temporelles et la trie si nécessaire.
 * @param {unknown} value Valeur potentiellement issue d'un projet sérialisé.
 * @param {boolean} [sort=true] Trie les plages par apparition.
 * @returns {TimedOverlayRange[]} Plages valides.
 */
export function normalizeTimedOverlayRanges(value: unknown, sort = true): TimedOverlayRange[] {
	if (!Array.isArray(value)) return [];

	const ranges = value.flatMap((item): TimedOverlayRange[] => {
		if (!item || typeof item !== 'object') return [];
		const raw = item as { startTime?: unknown; endTime?: unknown };
		const startTime = toTimedOverlayTime(raw.startTime);
		const endTime = toTimedOverlayTime(raw.endTime);
		return startTime !== null && endTime !== null && endTime > startTime
			? [{ startTime, endTime }]
			: [];
	});

	return sort ? ranges.sort((left, right) => left.startTime - right.startTime) : ranges;
}

/**
 * Retourne les plages modernes ou reconstruit l'ancienne plage `start/end`.
 * @param {unknown} value Valeur du style `time-ranges`.
 * @param {unknown} legacyStartTime Ancienne valeur de début.
 * @param {unknown} legacyEndTime Ancienne valeur de fin.
 * @param {boolean} [sort=true] Trie les plages par apparition.
 * @returns {TimedOverlayRange[]} Plages temporelles normalisées.
 */
export function getTimedOverlayRanges(
	value: unknown,
	legacyStartTime?: unknown,
	legacyEndTime?: unknown,
	sort = true
): TimedOverlayRange[] {
	const ranges = normalizeTimedOverlayRanges(value, sort);
	if (ranges.length > 0) return ranges;

	const startTime = toTimedOverlayTime(legacyStartTime);
	const endTime = toTimedOverlayTime(legacyEndTime);
	return startTime !== null && endTime !== null && endTime > startTime
		? [{ startTime, endTime }]
		: [];
}

/**
 * Résout les plages d'une collection de styles, avec compatibilité legacy.
 * @param {{id: string; value?: unknown}[]} styles Styles d'une catégorie.
 * @param {boolean} [sort=true] Trie les plages par apparition.
 * @returns {TimedOverlayRange[]} Plages temporelles normalisées.
 */
export function getTimedOverlayRangesFromStyles(
	styles: Array<{ id: string; value?: unknown }>,
	sort = true
): TimedOverlayRange[] {
	const rangeStyle = styles.find((style) => style.id.endsWith('time-ranges'));
	const startStyle = styles.find((style) => style.id.endsWith('time-appearance'));
	const endStyle = styles.find((style) => style.id.endsWith('time-disappearance'));
	return getTimedOverlayRanges(rangeStyle?.value, startStyle?.value, endStyle?.value, sort);
}

/**
 * Maintient la première plage legacy synchronisée avec les plages modernes.
 * @param {{id: string; value?: unknown}[]} styles Styles d'une catégorie ou d'une cible.
 * @param {TimedOverlayRange | undefined} range Première plage à recopier.
 * @returns {void}
 */
export function syncTimedOverlayLegacyRange(
	styles: Array<{ id: string; value?: unknown }>,
	range?: TimedOverlayRange
): void {
	if (!range) return;
	const startStyle = styles.find((style) => style.id.endsWith('time-appearance'));
	const endStyle = styles.find((style) => style.id.endsWith('time-disappearance'));
	if (startStyle) startStyle.value = range.startTime;
	if (endStyle) endStyle.value = range.endTime;
}

/**
 * Modifie une borne sans invalider la durée minimale de la plage.
 * @param {TimedOverlayRange[]} ranges Plages actuelles.
 * @param {number} index Index de la plage à modifier.
 * @param {'startTime' | 'endTime'} field Borne à modifier.
 * @param {number} value Nouvelle valeur en millisecondes.
 * @returns {TimedOverlayRange[]} Nouvelles plages indépendantes de l'entrée.
 */
export function updateTimedOverlayRange(
	ranges: TimedOverlayRange[],
	index: number,
	field: 'startTime' | 'endTime',
	value: number
): TimedOverlayRange[] {
	if (!Number.isFinite(value) || !ranges[index]) return ranges.map((range) => ({ ...range }));

	const nextRanges = ranges.map((range) => ({ ...range }));
	const current = nextRanges[index];

	if (field === 'startTime') {
		const maximum = current.endTime - MIN_TIMED_OVERLAY_DURATION;
		current.startTime = Math.min(maximum, Math.max(0, value));
	} else {
		const minimum = current.startTime + MIN_TIMED_OVERLAY_DURATION;
		current.endTime = Math.max(minimum, value);
	}

	return nextRanges;
}

/**
 * Ajoute une plage après la dernière plage existante.
 * @param {TimedOverlayRange[]} ranges Plages actuelles.
 * @returns {TimedOverlayRange[]} Plages avec une nouvelle apparition.
 */
export function appendTimedOverlayRange(ranges: TimedOverlayRange[]): TimedOverlayRange[] {
	const normalizedRanges = normalizeTimedOverlayRanges(ranges);
	const startTime = (normalizedRanges.at(-1)?.endTime ?? 0) + 1000;
	return [...normalizedRanges, { startTime, endTime: startTime + 3000 }];
}
