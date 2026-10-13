import type { SegmentationSegment } from './types';

/** Silence minimal conservé entre deux segments voisins, comme côté aligneur (30 ms). */
const MIN_GAP_S = 0.03;

/**
 * Élargit les bornes des segments comme l'aligneur cloud (`pad_left_ms` / `pad_right_ms`).
 *
 * Les extrémités reçoivent le padding complet ; un écart interne est partagé entre ses deux
 * voisins au prorata gauche/droite, en gardant au moins `MIN_GAP_S` de silence. Les mots,
 * relatifs au début du segment, sont décalés pour rester à la même position absolue.
 *
 * @param {SegmentationSegment[]} segments Segments triés par temps (modifiés en place).
 * @param {number} padLeftMs Avance du début de chaque segment (ms).
 * @param {number} padRightMs Retard de la fin de chaque segment (ms).
 * @param {number} [audioDurationS] Durée de l'audio, pour borner la fin du dernier segment.
 * @returns {void}
 */
export function padSegmentBoundaries(
	segments: SegmentationSegment[],
	padLeftMs: number,
	padRightMs: number,
	audioDurationS?: number
): void {
	const padLeftS = Math.max(0, padLeftMs) / 1000;
	const padRightS = Math.max(0, padRightMs) / 1000;
	const want = padLeftS + padRightS;
	const timed = segments.filter(
		(segment) => typeof segment.time_from === 'number' && typeof segment.time_to === 'number'
	);
	if (timed.length === 0 || want === 0) return;

	const leftPad = timed.map(() => 0);
	const rightPad = timed.map(() => 0);
	leftPad[0] = padLeftS;
	rightPad[timed.length - 1] = padRightS;
	for (let i = 0; i < timed.length - 1; i += 1) {
		const gap = Math.max(0, timed[i + 1].time_from! - timed[i].time_to!);
		const budget = Math.max(0, gap - MIN_GAP_S);
		const share = budget >= want ? 1 : budget / want;
		rightPad[i] = padRightS * share;
		leftPad[i + 1] = padLeftS * share;
	}

	timed.forEach((segment, i) => {
		const timeFrom = Math.max(0, segment.time_from! - leftPad[i]);
		const timeTo = segment.time_to! + rightPad[i];
		const shiftS = segment.time_from! - timeFrom;
		segment.time_from = timeFrom;
		segment.time_to = audioDurationS ? Math.min(audioDurationS, timeTo) : timeTo;
		if (shiftS > 0 && segment.words) {
			segment.words = segment.words.map((word) => ({
				...word,
				start: word.start + shiftS,
				end: word.end + shiftS
			}));
		}
	});
}
