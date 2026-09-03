import type { Clip } from '../Clip.svelte.js';
import { TrackType } from '../enums.js';

/** Calcule la timeline visuelle des clips vidéo et de leurs crossfades. */
export class VideoTrackTiming {
	/**
	 * Indique si les positions décrivent explicitement des chevauchements ou espaces.
	 * @param {Clip[]} clips Clips vidéo.
	 * @param {TrackType} trackType Type de la piste.
	 * @returns {boolean} `true` lorsque le timing n'est plus séquentiel.
	 */
	static hasExplicitTiming(clips: Clip[], trackType: TrackType): boolean {
		return (
			trackType === TrackType.Video &&
			clips.some((clip, index) =>
				index === 0 ? clip.startTime !== 0 : clip.startTime !== clips[index - 1].endTime + 1
			)
		);
	}

	/**
	 * Indique si le timing visuel du crossfade doit être utilisé.
	 * @param {Clip[]} clips Clips vidéo.
	 * @param {TrackType} trackType Type de la piste.
	 * @param {string} transitionMode Mode de transition configuré.
	 * @param {number} fadeDurationMs Durée configurée du fondu.
	 * @returns {boolean} `true` lorsque le crossfade est actif.
	 */
	static shouldUseCrossfade(
		clips: Clip[],
		trackType: TrackType,
		transitionMode: string,
		fadeDurationMs: number
	): boolean {
		return (
			trackType === TrackType.Video &&
			clips.length > 1 &&
			transitionMode === 'crossfade' &&
			(fadeDurationMs > 0 || this.hasExplicitTiming(clips, trackType))
		);
	}

	/**
	 * Retourne le décalage cumulé avant un clip en crossfade.
	 * @param {Clip[]} clips Clips vidéo.
	 * @param {number} clipIndex Index du clip.
	 * @param {boolean} useCrossfade Indique si le crossfade est actif.
	 * @param {boolean} explicitTiming Indique si les timings sont explicites.
	 * @param {number} fadeDurationMs Durée configurée du fondu.
	 * @returns {number} Décalage cumulé en millisecondes.
	 */
	static getCrossfadeOffsetBeforeClip(
		clips: Clip[],
		clipIndex: number,
		useCrossfade: boolean,
		explicitTiming: boolean,
		fadeDurationMs: number
	): number {
		if (!useCrossfade || explicitTiming || clipIndex <= 0) return 0;
		let offsetMs = 0;
		let currentDurationMs = Math.max(1, clips[0]?.duration ?? 1);
		for (let index = 0; index < clipIndex; index++) {
			const nextDurationMs = Math.max(1, clips[index + 1]?.duration ?? 1);
			const fadeMs = Math.min(fadeDurationMs, currentDurationMs, nextDurationMs);
			offsetMs += fadeMs;
			currentDurationMs += nextDurationMs - fadeMs;
		}
		return offsetMs;
	}

	/**
	 * Retourne la durée du crossfade précédant un clip.
	 * @param {Clip[]} clips Clips vidéo.
	 * @param {number} clipIndex Index du clip.
	 * @param {boolean} explicitTiming Indique si les timings sont explicites.
	 * @param {number} fadeDurationMs Durée configurée du fondu.
	 * @returns {number} Durée effective du crossfade.
	 */
	static getCrossfadeDurationBeforeClip(
		clips: Clip[],
		clipIndex: number,
		explicitTiming: boolean,
		fadeDurationMs: number
	): number {
		if (clipIndex <= 0 || clipIndex >= clips.length) return 0;
		const previousClip = clips[clipIndex - 1];
		const clip = clips[clipIndex];
		return explicitTiming
			? Math.max(
					0,
					Math.min(previousClip.endTime - clip.startTime, previousClip.duration, clip.duration)
				)
			: Math.min(fadeDurationMs, previousClip.duration, clip.duration);
	}
}
