import { PredefinedSubtitleClip, SubtitleClip } from '$lib/classes';
import { globalState } from '$lib/runes/main.svelte';

export type SubtitleNavigationDirection = 'previous' | 'next';

function getSubtitlePreviewStart(clip: SubtitleClip | PredefinedSubtitleClip): number {
	const fadeDuration = globalState.getStyle('global', 'fade-duration').value as number;
	const targetTime = clip.startTime + fadeDuration;
	return Math.min(clip.endTime, Math.max(1, targetTime));
}

/**
 * Déplace le curseur et la preview vers un sous-titre donné.
 * @param {SubtitleClip | PredefinedSubtitleClip} clip Sous-titre cible.
 * @returns {void}
 */
export function goToSubtitleClip(clip: SubtitleClip | PredefinedSubtitleClip): void {
	const previewStart = getSubtitlePreviewStart(clip);
	globalState.getTimelineState.cursorPosition = previewStart;
	globalState.getTimelineState.movePreviewTo = previewStart;
	globalState.getVideoPreviewState.scrollTimelineToCursor();
}

/**
 * Trouve le premier sous-titre Quran correspondant à une clé `sourate:verset`.
 * @param {string} verseKey Clé de verset au format `sourate:verset`.
 * @returns {SubtitleClip | null} Premier sous-titre correspondant, ou `null`.
 */
export function findFirstSubtitleByVerseKey(verseKey: string): SubtitleClip | null {
	const [surahRaw, verseRaw] = verseKey.split(':').map((part) => part.trim());
	const surah = Number(surahRaw);
	const verse = Number(verseRaw);
	if (!Number.isInteger(surah) || !Number.isInteger(verse)) return null;

	return (
		globalState.getSubtitleClips.find((clip) => clip.surah === surah && clip.verse === verse) ??
		null
	);
}

/**
 * Retourne la clé lisible d'un sous-titre Quran.
 * @param {SubtitleClip} clip Sous-titre Quran.
 * @returns {string} Clé au format `sourate:verset`.
 */
export function getSubtitleVerseKeyLabel(clip: SubtitleClip): string {
	return clip.getVerseKey();
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
	goToSubtitleClip(targetClip);
}
