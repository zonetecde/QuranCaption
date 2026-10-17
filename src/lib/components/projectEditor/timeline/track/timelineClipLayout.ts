import type { Project } from '$lib/classes/Project';

export type TimelinePositionedClip<T> = {
	clip: T;
	laneIndex: number;
};

export type TimelineClipLayout<T> = {
	clips: TimelinePositionedClip<T>[];
	laneCount: number;
};

/**
 * Répartit des clips temporels dans le minimum de sous-pistes sans chevauchement.
 * @param {T[]} clips Clips à répartir.
 * @param {(clip: T) => number} getStartTime Résout le début effectif d'un clip.
 * @param {(clip: T) => number} getEndTime Résout la fin effective d'un clip.
 * @returns {TimelineClipLayout<T>} Clips positionnés et nombre de sous-pistes.
 */
export function getTimelineClipLayout<T>(
	clips: T[],
	getStartTime: (clip: T) => number,
	getEndTime: (clip: T) => number
): TimelineClipLayout<T> {
	const laneEndTimes: number[] = [];
	const orderedClips = clips
		.map((clip, originalIndex) => ({ clip, originalIndex }))
		.sort(
			(left, right) =>
				getStartTime(left.clip) - getStartTime(right.clip) ||
				left.originalIndex - right.originalIndex
		);

	const positionedClips = orderedClips.map(({ clip }) => {
		const startTime = getStartTime(clip);
		const endTime = getEndTime(clip);
		let laneIndex = laneEndTimes.findIndex((laneEndTime) => startTime > laneEndTime);

		if (laneIndex === -1) {
			laneIndex = laneEndTimes.length;
			laneEndTimes.push(endTime);
		} else {
			laneEndTimes[laneIndex] = endTime;
		}

		return { clip, laneIndex };
	});

	return { clips: positionedClips, laneCount: laneEndTimes.length };
}

/**
 * Calcule la largeur d'affichage sans introduire de dépendance UI dans les clips.
 * @param {{ duration: number; type?: string; getAlwaysShow?: () => boolean }} clip Clip ou adaptateur visuel.
 * @param {Project | null} project Projet affiché dans la timeline.
 * @returns {number} Largeur en pixels au zoom courant.
 */
export function getTimelineClipWidth(
	clip: { duration: number; type?: string; getAlwaysShow?: () => boolean },
	project: Project | null
): number {
	const zoom = project?.projectEditorState.timeline.zoom ?? 0;
	if (clip.getAlwaysShow?.() || (clip.duration === 0 && clip.type === 'Asset')) {
		return (project?.content.timeline.getLongestTrackDuration().toSeconds() ?? 0) * zoom;
	}
	return (clip.duration / 1000) * zoom;
}
