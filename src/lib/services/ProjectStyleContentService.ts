import { CustomImageClip, CustomTextClip, type CustomClip } from '$lib/classes/Clip.svelte';
import type { ProjectContent } from '$lib/classes/ProjectContent.svelte';
import { TrackType } from '$lib/classes/enums';
import { Utilities } from '$lib/classes/misc/Utilities';
import { CustomTextTrack } from '$lib/classes/Track.svelte';
import type { Style, StyleName } from '$lib/classes/VideoStyle.svelte';
import type { RawCategoryDefinition, RawStyleDefinition } from './StyleDefinitionCatalog';

/**
 * Retourne les contenus personnalisés stylés d'un projet.
 * @param {ProjectContent} projectContent Projet propriétaire des contenus.
 * @returns {CustomClip[]} Clips personnalisés du projet.
 */
export function getCustomStyleClips(projectContent: ProjectContent): CustomClip[] {
	if (!projectContent.timeline.doesTrackExist(TrackType.CustomClip)) return [];
	return projectContent.timeline.getFirstTrack(TrackType.CustomClip).clips as CustomClip[];
}

/**
 * Complète le schéma des textes personnalisés sans écraser les valeurs existantes.
 * @param {ProjectContent} projectContent Projet à mettre à niveau.
 * @param {RawCategoryDefinition} defaults Catégorie textuelle par défaut.
 * @param {RawStyleDefinition[]} compositeDefaults Valeurs composites par défaut.
 * @param {(definition: RawStyleDefinition) => Style} createStyle Fabrique du modèle propriétaire.
 * @returns {boolean} `true` si le projet a été complété.
 */
export function ensureCustomStyleSchema(
	projectContent: ProjectContent,
	defaults: RawCategoryDefinition,
	compositeDefaults: RawStyleDefinition[],
	createStyle: (definition: RawStyleDefinition) => Style
): boolean {
	let hasChanges = false;
	for (const clip of getCustomStyleClips(projectContent)) {
		if (!(clip instanceof CustomTextClip) || !clip.category) continue;

		for (const defaultStyle of defaults.styles ?? []) {
			if (defaultStyle.id === 'custom-text-composite') {
				const suffix = clip.category.id.startsWith('custom-text-')
					? clip.category.id.slice('custom-text-'.length)
					: '';
				const resolvedId = suffix ? `custom-text-composite-${suffix}` : defaultStyle.id;
				const exists = clip.category.styles.some(
					(style) =>
						style.id === defaultStyle.id ||
						style.id === resolvedId ||
						style.id.startsWith('custom-text-composite-')
				);
				if (!exists) {
					clip.category.styles.push(
						createStyle({
							...defaultStyle,
							id: resolvedId,
							value: compositeDefaults.map(createStyle)
						})
					);
					hasChanges = true;
				}
				continue;
			}

			if (!clip.category.styles.some((style) => style.id === defaultStyle.id)) {
				clip.category.styles.push(createStyle(defaultStyle));
				hasChanges = true;
			}
		}
	}
	return hasChanges;
}

/**
 * Retourne les valeurs d'un style composite appartenant à un texte personnalisé.
 * @param {ProjectContent} projectContent Projet à parcourir.
 * @param {string} compositeStyleId Identifiant composite recherché.
 * @returns {Style[]} Valeurs composites ou liste vide.
 */
export function getCustomCompositeStyles(
	projectContent: ProjectContent,
	compositeStyleId: string
): Style[] {
	for (const clip of getCustomStyleClips(projectContent)) {
		if (!(clip instanceof CustomTextClip)) continue;
		const style = clip.category?.getStyle(compositeStyleId as StyleName);
		if (style) return style.value as Style[];
	}
	return [];
}

/**
 * Sérialise uniquement les contenus personnalisés inclus dans un preset.
 * @param {ProjectContent} projectContent Projet source.
 * @param {Set<number>} includedClipIds Identifiants à inclure.
 * @returns {Array<Record<string, unknown>>} Clips sérialisés compatibles avec le format existant.
 */
export function exportCustomStyleClips(
	projectContent: ProjectContent,
	includedClipIds: Set<number>
): Array<Record<string, unknown>> {
	return getCustomStyleClips(projectContent)
		.filter((clip) => includedClipIds.has(clip.id))
		.map((clip) => JSON.parse(JSON.stringify(clip)) as Record<string, unknown>);
}

/**
 * Importe des contenus personnalisés sérialisés dans un projet.
 * @param {ProjectContent} projectContent Projet cible.
 * @param {Array<Record<string, unknown>>} rawClips Clips issus d'un preset existant.
 * @returns {void}
 */
export function importCustomStyleClips(
	projectContent: ProjectContent,
	rawClips: Array<Record<string, unknown>>
): void {
	if (rawClips.length === 0) return;
	if (!projectContent.timeline.doesTrackExist(TrackType.CustomClip)) {
		projectContent.timeline.addTrack(new CustomTextTrack());
	}
	const track = projectContent.timeline.getFirstTrack(TrackType.CustomClip);
	for (const rawClip of rawClips) {
		const clipData = structuredClone(rawClip);
		clipData.id = Utilities.randomId();
		const clip =
			clipData.type === 'Custom Text'
				? (CustomTextClip.fromJSON(clipData) as CustomTextClip)
				: (CustomImageClip.fromJSON(clipData) as CustomImageClip);
		track.clips.push(clip);
	}
}
