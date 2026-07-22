import type { ProjectContent } from '$lib/classes/ProjectContent.svelte';
import type { StylesData, VideoStyle, VideoStyleFileData } from '$lib/classes/VideoStyle.svelte';
import { importCustomStyleClips } from './ProjectStyleContentService';

type ApplyStylePresetOptions = {
	videoStyle: VideoStyle;
	projectContent: ProjectContent;
	data: VideoStyleFileData;
	translationAssignments?: Record<string, string>;
};

/**
 * Retourne les cibles de traduction disponibles dans un preset.
 * @param {VideoStyleFileData} data Données de preset existantes.
 * @returns {string[]} Identifiants de traductions disponibles.
 */
export function getPresetTranslationTargets(data: VideoStyleFileData): string[] {
	const styles = Array.isArray(data.videoStyle.styles) ? data.videoStyle.styles : [];
	return styles.flatMap((candidate) => {
		if (!candidate || typeof candidate !== 'object') return [];
		const target = (candidate as { target?: unknown }).target;
		return typeof target === 'string' && target !== 'arabic' && target !== 'global' ? [target] : [];
	});
}

/**
 * Applique un preset de manière déterministe à un projet explicite.
 * @param {ApplyStylePresetOptions} options Projet, styles et affectations à appliquer.
 * @returns {Promise<void>} Promesse résolue après la mise à niveau du schéma.
 */
export async function applyStylePresetToProject(options: ApplyStylePresetOptions): Promise<void> {
	const videoStyleConstructor = options.videoStyle.constructor as unknown as {
		fromJSON(data: Record<string, unknown>): VideoStyle;
	};
	const imported = videoStyleConstructor.fromJSON(options.data.videoStyle);
	const projectTranslations = options.projectContent.projectTranslation.addedTranslationEditions;

	for (const importedStyles of imported.styles) {
		if (importedStyles.target === 'arabic' || importedStyles.target === 'global') {
			replaceTargetStyles(options.videoStyle, importedStyles.target, importedStyles);
			continue;
		}
		if (projectTranslations.some((translation) => translation.name === importedStyles.target)) {
			replaceTargetStyles(options.videoStyle, importedStyles.target, importedStyles);
		}
	}

	for (const [target, source] of Object.entries(options.translationAssignments ?? {})) {
		const sourceStyles = imported.styles.find((styles) => styles.target === source);
		if (!sourceStyles) continue;
		const stylesConstructor = sourceStyles.constructor as unknown as {
			fromJSON(data: Record<string, unknown>): StylesData;
		};
		const copied = stylesConstructor.fromJSON(
			JSON.parse(JSON.stringify(sourceStyles)) as Record<string, unknown>
		);
		copied.target = target;
		replaceTargetStyles(options.videoStyle, target, copied);
	}

	importCustomStyleClips(
		options.projectContent,
		options.data.customClips?.length
			? options.data.customClips
			: (options.data.customTextClips ?? [])
	);
	await options.videoStyle.ensureStylesSchemaUpToDate(options.projectContent);
}

/**
 * Remplace ou ajoute les styles d'une cible sans modifier le format persistant.
 * @param {VideoStyle} videoStyle Aggregate de styles cible.
 * @param {string} target Cible à remplacer.
 * @param {StylesData} styles Nouvelles valeurs.
 * @returns {void}
 */
function replaceTargetStyles(videoStyle: VideoStyle, target: string, styles: StylesData): void {
	const index = videoStyle.styles.findIndex((candidate) => candidate.target === target);
	if (index === -1) videoStyle.styles.push(styles);
	else videoStyle.styles[index] = styles;
}
