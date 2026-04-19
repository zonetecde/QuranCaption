import { PredefinedSubtitleClip, SubtitleClip } from '$lib/classes';
import { globalState } from '$lib/runes/main.svelte';

export type SubtitleNavigationDirection = 'previous' | 'next';

function getSubtitlePreviewStart(clip: SubtitleClip | PredefinedSubtitleClip): number {
	const fadeDuration = globalState.getStyle('global', 'fade-duration').value as number;
	const targetTime = clip.startTime + fadeDuration;
	return Math.min(clip.endTime, Math.max(1, targetTime));
}

/**
 * Déplace le curseur vers le sous-titre précédent/suivant
 */
export function goToAdjacentSubtitleFromCursor(direction: SubtitleNavigationDirection): void {
	const subtitleTrack = globalState.getSubtitleTrack;
	const cursorPosition = globalState.getTimelineState.cursorPosition;
	if (!subtitleTrack || subtitleTrack.clips.length === 0) return;

	const clipUnderCursor = subtitleTrack.getCurrentClip(cursorPosition);
	let targetClip: SubtitleClip | PredefinedSubtitleClip | null = null;

	if (clipUnderCursor) {
		const currentIndex = subtitleTrack.clips.indexOf(clipUnderCursor);
		targetClip =
			direction === 'previous'
				? subtitleTrack.getSubtitleBefore(currentIndex, true)
				: subtitleTrack.getSubtitleAfter(currentIndex, true);
	} else {
		const subtitles = subtitleTrack.clips.filter(
			(clip) => clip instanceof SubtitleClip || clip instanceof PredefinedSubtitleClip
		) as (SubtitleClip | PredefinedSubtitleClip)[];
		const isPrevious = direction === 'previous';
		const targetList = subtitles
			.filter((clip) =>
				isPrevious ? clip.startTime < cursorPosition : clip.startTime > cursorPosition
			)
			.sort((a, b) => (isPrevious ? b.startTime - a.startTime : a.startTime - b.startTime));
		targetClip = targetList[0] ?? null;
	}

	if (!targetClip) return;
	const previewStart = getSubtitlePreviewStart(targetClip);
	globalState.getTimelineState.cursorPosition = previewStart;
	globalState.getTimelineState.movePreviewTo = previewStart;
	globalState.getVideoPreviewState.scrollTimelineToCursor();
}
