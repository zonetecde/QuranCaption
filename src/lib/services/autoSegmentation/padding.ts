import type { SegmentationSegment } from './types';

/**
 * Élargit les bornes des segments comme l'aligneur cloud (`pad_left_ms` / `pad_right_ms`).
 *
 * Chaque début recule de `padLeftMs` et chaque fin avance de `padRightMs`, sans jamais
 * chevaucher le segment voisin. Les mots, relatifs au début du segment, sont décalés
 * pour rester à la même position absolue.
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
	const timed = segments.filter(
		(segment) => typeof segment.time_from === 'number' && typeof segment.time_to === 'number'
	);
	let previousEndS = 0;

	timed.forEach((segment, i) => {
		const originalFromS = segment.time_from!;
		const nextFromS = timed[i + 1]?.time_from ?? audioDurationS ?? Infinity;
		const timeFrom = Math.min(originalFromS, Math.max(previousEndS, originalFromS - padLeftS));
		const timeTo = Math.max(segment.time_to!, Math.min(nextFromS, segment.time_to! + padRightS));
		segment.time_from = timeFrom;
		segment.time_to = timeTo;
		previousEndS = timeTo;

		const shiftS = originalFromS - timeFrom;
		if (shiftS > 0 && segment.words) {
			segment.words = segment.words.map((word) => ({
				...word,
				start: word.start + shiftS,
				end: word.end + shiftS
			}));
		}
	});
}
