import { PredefinedSubtitleClip, SubtitleClip, type VisualMergeMode } from '$lib/classes/Clip.svelte';
import type { SubtitleTrack, VisualMergeSelection } from '$lib/classes/Track.svelte';

/**
 * Retourne le mode merge actif si la selection correspond exactement a un groupe.
 * @param {Array<SubtitleClip | PredefinedSubtitleClip>} selectedSubtitles Selection courante.
 * @param {SubtitleTrack} subtitleTrack Piste de sous-titres.
 * @returns {VisualMergeMode | null} Mode actif, sinon `null`.
 */
export function getActiveVisualMergeMode(
	selectedSubtitles: Array<SubtitleClip | PredefinedSubtitleClip>,
	subtitleTrack: SubtitleTrack
): VisualMergeMode | null {
	if (selectedSubtitles.length === 0) return null;
	const firstSelected = selectedSubtitles[0];
	if (!(firstSelected instanceof SubtitleClip) || !firstSelected.visualMergeGroupId) return null;

	const mergeGroup = subtitleTrack.getVisualMergeGroupForClipId(firstSelected.id);
	if (!mergeGroup) return null;

	const selectedIds = new Set(selectedSubtitles.map((subtitle) => subtitle.id));
	const groupIds = new Set(mergeGroup.clips.map((subtitle) => subtitle.id));

	if (selectedIds.size !== groupIds.size) return null;
	if (![...groupIds].every((id) => selectedIds.has(id))) return null;
	return mergeGroup.mode;
}

/**
 * Retourne l'identifiant du groupe merge actif.
 * @param {Array<SubtitleClip | PredefinedSubtitleClip>} selectedSubtitles Selection courante.
 * @param {VisualMergeMode | null} activeMode Mode merge actif.
 * @returns {string | null} Id du groupe actif, sinon `null`.
 */
export function getActiveVisualMergeGroupId(
	selectedSubtitles: Array<SubtitleClip | PredefinedSubtitleClip>,
	activeMode: VisualMergeMode | null
): string | null {
	if (!activeMode || selectedSubtitles.length === 0) return null;
	const firstSelected = selectedSubtitles[0];
	if (!(firstSelected instanceof SubtitleClip) || !firstSelected.visualMergeGroupId) return null;
	return firstSelected.visualMergeGroupId;
}

/**
 * Indique si les modes merge impliquant l'arabe sont autorises.
 * @param {VisualMergeSelection | null} mergeSelection Selection merge candidate.
 * @param {SubtitleTrack} subtitleTrack Piste de sous-titres.
 * @returns {boolean} `true` si l'arabe est mergeable.
 */
export function canMergeArabicVisualModes(
	mergeSelection: VisualMergeSelection | null,
	subtitleTrack: SubtitleTrack
): boolean {
	if (!mergeSelection) return false;
	return subtitleTrack.canUseArabicVisualMerge(mergeSelection.clips);
}
