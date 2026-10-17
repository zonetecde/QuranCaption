import { CustomTextTrack } from '$lib/classes/Track.svelte';
import type { Project } from '$lib/classes/Project';
import {
	StylesData,
	VideoStyle,
	type StyleName,
	type VideoStyleFileData
} from '$lib/classes/VideoStyle.svelte';
import { CustomImageClip, CustomTextClip } from '$lib/classes/clips/CustomClip.svelte';
import { TrackType } from '$lib/classes/enums';
import { Utilities } from '$lib/classes/misc/Utilities';
import { ProjectHistoryManager } from './undoRedo/ProjectHistoryManager';

export const SOURCE_STYLE_TARGETS = ['arabic', 'arabic-quran', 'arabic-citation', 'global'];

/**
 * Prépare un preset hors du projet puis l'applique dans une seule action annulable.
 * @param {Project} project Projet propriétaire.
 * @param {VideoStyleFileData} data Preset à importer.
 * @param {Record<string, string>} [translationSources] Cibles des styles choisis pour les traductions absentes.
 * @returns {Promise<void>} Fin de l'application, refusée si le projet actif a changé.
 */
export async function applyStylePreset(
	project: Project,
	data: VideoStyleFileData,
	translationSources: Record<string, string> = {}
): Promise<void> {
	const current = project.content.videoStyle;
	const prepared = VideoStyle.fromJSON(current.toJSON()) as VideoStyle;
	prepared.copyStyleEditorUiMetadataFrom(current);
	const imported = VideoStyle.fromJSON(data.videoStyle) as VideoStyle;
	const editions = project.content.projectTranslation.addedTranslationEditions;
	const translationTargets = editions.flatMap(({ name }) => [
		name,
		`${name}-quran`,
		`${name}-citation`
	]);
	for (const styles of imported.styles) {
		if (
			!SOURCE_STYLE_TARGETS.includes(styles.target) &&
			!translationTargets.includes(styles.target)
		)
			continue;
		const index = prepared.styles.findIndex((candidate) => candidate.target === styles.target);
		if (index < 0) prepared.styles.push(styles);
		else prepared.styles[index] = styles;
	}
	for (const [target, source] of Object.entries(translationSources)) {
		if (!translationTargets.includes(target)) continue;
		const sourceStyle = imported.styles.find((candidate) => candidate.target === source);
		if (!sourceStyle) continue;
		const replacement = StylesData.fromJSON(sourceStyle.toJSON()) as StylesData;
		replacement.target = target;
		const index = prepared.styles.findIndex((candidate) => candidate.target === target);
		if (index < 0) prepared.styles.push(replacement);
		else prepared.styles[index] = replacement;
	}
	const customTrack = project.content.timeline.tracks.find(
		(track) => track.type === TrackType.CustomClip
	);
	const newClips = (data.customClips || data.customTextClips || []).map((clipData) => {
		const constructor = clipData.type === 'Custom Text' ? CustomTextClip : CustomImageClip;
		return constructor.fromJSON({ ...clipData, id: Utilities.randomId() }) as
			| CustomTextClip
			| CustomImageClip;
	});
	// La migration travaille sur des copies afin qu'un échec ou un changement de projet reste sans effet.
	const existingClips = (customTrack?.clips ?? []).map((clip) =>
		clip instanceof CustomTextClip
			? (CustomTextClip.fromJSON(clip.toJSON()) as CustomTextClip)
			: (CustomImageClip.fromJSON(clip.toJSON()) as CustomImageClip)
	);
	await prepared.ensureStylesSchemaUpToDate([...existingClips, ...newClips]);
	ProjectHistoryManager.track(
		'import styles',
		() => {
			const previousGlobalStyles = current.getStylesOfTarget('global');
			const globalStyles = prepared.getStylesOfTarget('global');
			const preservedStyleIds: StyleName[] = [
				'video-clip-transition',
				'video-clip-transition-duration',
				'media-position-x',
				'media-position-y',
				'media-scale',
				'media-rotation'
			];
			for (const id of preservedStyleIds) {
				const previous = previousGlobalStyles.findStyle(id);
				const next = globalStyles.findStyle(id);
				if (previous && next) {
					next.value = previous.value;
					next.keyframes = previous.keyframes;
				}
				for (const key of ['overrides', 'overrideKeyframes'] as const) {
					const clipIds = new Set([
						...Object.keys(previousGlobalStyles[key]),
						...Object.keys(globalStyles[key])
					]);
					for (const clipId of clipIds) {
						const value = previousGlobalStyles[key][Number(clipId)]?.[id];
						if (value === undefined) delete globalStyles[key][Number(clipId)]?.[id];
						else (globalStyles[key][Number(clipId)] ??= {})[id] = value;
					}
				}
			}
			project.content.videoStyle = prepared;
			if (customTrack) customTrack.clips = [...existingClips, ...newClips];
			else if (newClips.length) {
				const track = new CustomTextTrack();
				track.clips = newClips;
				project.content.timeline.addTrack(track);
			}
		},
		project
	);
}
