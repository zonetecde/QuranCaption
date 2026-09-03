import type { ProjectContent } from '../ProjectContent.svelte.js';
import { exportCustomStyleClips } from '$lib/services/ProjectStyleContentService.js';
import type { VideoStyleFileData } from './types.js';

/** Sérialise les presets de styles sans leurs overrides propres aux clips. */
export class VideoStylePresetSerializer {
	/**
	 * Construit les données historiques d'un preset.
	 * @param {unknown} videoStyle Instance de styles à sérialiser.
	 * @param {Set<number>} includedExportClips Clips personnalisés à inclure.
	 * @param {ProjectContent | undefined} projectContent Contenu associé au preset.
	 * @returns {VideoStyleFileData} Données prêtes à être écrites en JSON.
	 */
	static serialize(
		videoStyle: unknown,
		includedExportClips: Set<number>,
		projectContent?: ProjectContent
	): VideoStyleFileData {
		const serialized = JSON.parse(JSON.stringify(videoStyle)) as Record<string, unknown> & {
			styles: Array<{ overrides: Record<string, unknown> }>;
		};
		for (const style of serialized.styles) style.overrides = {};
		return {
			videoStyle: serialized,
			customClips: projectContent ? exportCustomStyleClips(projectContent, includedExportClips) : []
		};
	}
}
