import { PredefinedSubtitleClip, SilenceClip, SubtitleClip } from '$lib/classes';
import { SMALL_GAP_MS } from './types';

/**
 * Définit silencieusement le temps de début d'un clip (sans notifier les observateurs si possible).
 *
 * @param {SubtitleClip | PredefinedSubtitleClip | SilenceClip} clip Clip à modifier.
 * @param {number} newStartTime Nouveau temps de début en ms.
 */
export function setClipStartTime(
	clip: SubtitleClip | PredefinedSubtitleClip | SilenceClip,
	newStartTime: number
): void {
	if (clip instanceof SubtitleClip && typeof clip.setStartTimeSilently === 'function') {
		clip.setStartTimeSilently(newStartTime);
	} else {
		clip.setStartTime(newStartTime);
	}
}

/**
 * Définit silencieusement le temps de fin d'un clip (sans notifier les observateurs si possible).
 *
 * @param {SubtitleClip | PredefinedSubtitleClip | SilenceClip} clip Clip à modifier.
 * @param {number} newEndTime Nouveau temps de fin en ms.
 */
export function setClipEndTime(
	clip: SubtitleClip | PredefinedSubtitleClip | SilenceClip,
	newEndTime: number
): void {
	if (clip instanceof SubtitleClip && typeof clip.setEndTimeSilently === 'function') {
		clip.setEndTimeSilently(newEndTime);
	} else {
		clip.setEndTime(newEndTime);
	}
}

/**
 * Élimine les micro-gaps en recollant le début du clip suivant à la fin du clip précédent.
 * Utile pour éviter les "micro-silences" causés par les arrondis de segmentation.
 *
 * @param {Array<SubtitleClip | PredefinedSubtitleClip>} clips Clips à ajuster.
 * @param {number} maxGapMs Gap maximum à fermer (par défaut SMALL_GAP_MS).
 */
export function closeSmallSubtitleGaps(
	clips: Array<SubtitleClip | PredefinedSubtitleClip>,
	maxGapMs: number = SMALL_GAP_MS
): void {
	const ordered: Array<SubtitleClip | PredefinedSubtitleClip> = [...clips].sort(
		(a, b) => a.startTime - b.startTime
	);

	for (let i: number = 0; i < ordered.length - 1; i += 1) {
		const current: SubtitleClip | PredefinedSubtitleClip = ordered[i];
		const next: SubtitleClip | PredefinedSubtitleClip = ordered[i + 1];

		const gapMs: number = next.startTime - current.endTime - 1;
		if (gapMs > 0 && gapMs < maxGapMs) {
			setClipStartTime(next, current.endTime + 1);
		}
	}
}

/**
 * Insère des SilenceClip explicites dans les gaps suffisamment longs.
 * Garantit une timeline cohérente pour le rendu et l'export.
 *
 * @param {Array<SubtitleClip | PredefinedSubtitleClip | SilenceClip>} clips Clips de la timeline.
 * @param {number} minGapMs Gap minimum pour insérer un SilenceClip (par défaut SMALL_GAP_MS).
 * @returns {Array<SubtitleClip | PredefinedSubtitleClip | SilenceClip>} Nouveau tableau avec les silences insérés.
 */
export function insertSilenceClips(
	clips: Array<SubtitleClip | PredefinedSubtitleClip | SilenceClip>,
	minGapMs: number = SMALL_GAP_MS
): Array<SubtitleClip | PredefinedSubtitleClip | SilenceClip> {
	const ordered: Array<SubtitleClip | PredefinedSubtitleClip | SilenceClip> = [...clips].sort(
		(a, b) => a.startTime - b.startTime
	);

	const result: Array<SubtitleClip | PredefinedSubtitleClip | SilenceClip> = [];
	if (ordered.length === 0) return result;

	const first = ordered[0];

	// Normalise le début de la timeline à 0, ou insère un silence initial.
	if (first.startTime < minGapMs) {
		setClipStartTime(first, 0);
	} else {
		result.push(new SilenceClip(0, first.startTime - 1));
	}

	result.push(first);

	for (let i: number = 1; i < ordered.length; i += 1) {
		const prev = result[result.length - 1];
		const next = ordered[i];

		const gapMs: number = next.startTime - prev.endTime - 1;
		if (gapMs >= minGapMs) {
			result.push(new SilenceClip(prev.endTime + 1, next.startTime - 1));
		}

		result.push(next);
	}

	return result;
}

/**
 * Étend les sous-titres dans le silence qui les suit d'une durée fixe.
 * Les SilenceClip sont raccourcis d'autant pour garder la timeline cohérente.
 *
 * @param {Array<SubtitleClip | PredefinedSubtitleClip | SilenceClip>} clips Clips de la timeline.
 * @param {number} extendMs Durée d'extension en ms.
 */
export function extendSubtitlesBeforeSilence(
	clips: Array<SubtitleClip | PredefinedSubtitleClip | SilenceClip>,
	extendMs: number
): void {
	if (extendMs <= 0) return;

	const ordered = [...clips].sort((a, b) => a.startTime - b.startTime);

	for (let i = 1; i < ordered.length; i += 1) {
		const current = ordered[i];
		if (!(current instanceof SilenceClip)) continue;

		const prev = ordered[i - 1];
		if (!(prev instanceof SubtitleClip || prev instanceof PredefinedSubtitleClip)) continue;

		const silenceDuration = current.endTime - current.startTime + 1;
		if (silenceDuration <= extendMs) continue;
		const delta = extendMs;

		setClipEndTime(prev, prev.endTime + delta);
		setClipStartTime(current, current.startTime + delta);
	}
}

/**
 * Étend les fins de sous-titres pour remplir les gaps (sans insérer de SilenceClip).
 * La fin de chaque sous-titre est étendue jusqu'au début du suivant - 1ms.
 *
 * @param {Array<SubtitleClip | PredefinedSubtitleClip>} clips Clips de la timeline.
 */
export function extendSubtitlesToFillGaps(
	clips: Array<SubtitleClip | PredefinedSubtitleClip>
): void {
	if (clips.length === 0) return;

	const ordered = [...clips].sort((a, b) => a.startTime - b.startTime);

	for (let i: number = 0; i < ordered.length - 1; i += 1) {
		const current = ordered[i];
		const next = ordered[i + 1];

		if (current.endTime < next.startTime - 1) {
			setClipEndTime(current, next.startTime - 1);
		}
	}
}
