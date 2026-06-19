import { invoke } from '@tauri-apps/api/core';
import { globalState } from '$lib/runes/main.svelte';
import ExportFileService from '$lib/services/ExportFileService';
import type { SavedVideoStylePreset } from '$lib/classes/Settings.svelte';
import type { VideoStyleFileData } from '$lib/classes/VideoStyle.svelte';
import type { CommunityStylePreset } from '$lib/services/StylePresetLibraryService';
import type { DimensionValue } from '../types';

/**
 * Récupère la résolution vidéo du projet courant, ou 1920x1080 par défaut.
 *
 * @returns {DimensionValue} Dimensions actuelles de la vidéo.
 */
export function getCurrentResolution(): DimensionValue {
	const value = globalState.getStyle('global', 'video-dimension')?.value;
	if (
		typeof value === 'object' &&
		value !== null &&
		'width' in value &&
		'height' in value &&
		typeof (value as DimensionValue).width === 'number' &&
		typeof (value as DimensionValue).height === 'number'
	) {
		return value as DimensionValue;
	}

	return { width: 1920, height: 1080 };
}

/**
 * Formate une résolution pour affichage compact.
 *
 * @param {DimensionValue} resolution Dimensions de la vidéo.
 * @returns {string} Label lisible (ex: "1080p Landscape").
 */
export function getResolutionLabel(resolution: DimensionValue): string {
	const { width, height } = resolution;
	const minDimension = Math.min(width, height);
	const orientation = width >= height ? 'Landscape' : 'Portrait';
	const standardQualities: Record<number, string> = {
		720: '720p',
		1080: '1080p',
		1440: '1440p',
		2160: '2160p'
	};

	if (standardQualities[minDimension]) {
		return `${standardQualities[minDimension]} ${orientation}`;
	}

	return `${width}x${height}`;
}

/**
 * Exporte les styles du projet courant.
 *
 * @param {Set<number>} includedClipIds IDs des clips customs à inclure.
 * @returns {VideoStyleFileData} Données de style prêtes pour l'import.
 */
export function buildStyleData(includedClipIds: Set<number>): VideoStyleFileData {
	return globalState.getVideoStyle.exportStylesData(includedClipIds);
}

/**
 * Construit le nom par défaut d'un preset à partir du nom du projet.
 *
 * @returns {string} Nom de preset par défaut.
 */
export function getDefaultPresetName(): string {
	const projectName = ExportFileService.getProjectNameForFile();
	return projectName ? `${projectName} style` : 'Video style';
}

/**
 * Construit un nom de fichier sûr pour l'export JSON.
 *
 * @param {string} name Nom du preset.
 * @returns {string} Nom de fichier d'export.
 */
export function getExportFileName(name: string): string {
	const safeName = name
		.trim()
		.replace(/[<>:"/\\|?*]+/g, '-')
		.replace(/\s+/g, '_');
	return `exported_styles_${safeName || ExportFileService.getProjectNameForFile()}.json`;
}

/**
 * Génère un libellé lisible pour un clip custom.
 *
 * @param {object} clip Clip custom (texte ou image).
 * @param {number} clip.id Identifiant du clip.
 * @param {string} clip.type Type du clip ('Custom Text' | 'Custom Image').
 * @param {object} [clip.category] Catégorie associée au clip.
 * @param {string} [clip.category.name] Nom de la catégorie.
 * @param {function} [clip.category.getStyle] Accesseur de style.
 * @returns {string} Libellé affichable.
 */
export function getClipLabel(clip: {
	id: number;
	type: string;
	category?: { name: string; getStyle: (id: string) => { value: unknown } | undefined };
}): string {
	if (clip.type === 'Custom Text') {
		const text = clip.category?.getStyle('text')?.value as string | undefined;
		return `Custom Text: ${text || clip.category?.name || 'Unnamed'}`;
	}
	const filepath = clip.category?.getStyle('filepath')?.value as string | undefined;
	const filename = filepath?.split(/[/\\]/).pop() || clip.category?.name || 'Unnamed';
	return `Custom Image: ${filename}`;
}

/**
 * Construit un preset local à partir des styles du projet courant.
 *
 * @param {string} name Nom du preset.
 * @param {Set<number>} includedClipIds IDs des clips customs à inclure.
 * @returns {SavedVideoStylePreset} Preset local prêt à être sauvegardé.
 */
export function buildLocalPreset(
	name: string,
	includedClipIds: Set<number>
): SavedVideoStylePreset {
	const now = new Date().toISOString();
	return {
		id: Date.now() + Math.floor(Math.random() * 1000),
		name,
		createdAt: now,
		updatedAt: now,
		resolution: getCurrentResolution(),
		data: buildStyleData(includedClipIds)
	};
}

/**
 * Construit un preset local à partir d'un preset communauté téléchargé.
 *
 * @param {CommunityStylePreset} preset Métadonnées du preset communauté.
 * @param {VideoStyleFileData} data Données de style téléchargées.
 * @returns {SavedVideoStylePreset} Preset local prêt à être sauvegardé.
 */
export function buildCommunityPresetData(
	preset: CommunityStylePreset,
	data: VideoStyleFileData
): SavedVideoStylePreset {
	const now = new Date().toISOString();
	return {
		id: Date.now() + Math.floor(Math.random() * 1000),
		communityPresetId: preset.id,
		name: preset.name,
		createdAt: now,
		updatedAt: now,
		resolution: preset.resolution,
		data
	};
}

/**
 * Parse l'input de tags de publication en tableau normalisé.
 *
 * @param {string} input Chaîne brute saisie par l'utilisateur (séparateur: virgule).
 * @returns {string[]} Tags normalisés (minuscule, sans doublons, max 12).
 */
export function getPublishTags(input: string): string[] {
	return [
		...new Set(
			input
				.split(',')
				.map((tag) => tag.trim().toLowerCase())
				.filter(Boolean)
		)
	].slice(0, 12);
}

/**
 * Vérifie si deux ensembles de nombres sont égaux.
 *
 * @param {Set<number>} a Premier ensemble.
 * @param {Set<number>} b Second ensemble.
 * @returns {boolean} True si les ensembles contiennent les mêmes éléments.
 */
export function setsEqual(a: Set<number>, b: Set<number>): boolean {
	return a.size === b.size && [...a].every((id) => b.has(id));
}

/**
 * Attend un délai donné (utile pour laisser le navigateur render après un seek).
 *
 * @param {number} ms Délai en millisecondes.
 * @returns {Promise<void>}
 */
export function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retourne la liste des clips customs affichables pour les checkboxes d'inclusion.
 *
 * @returns {Array<{id: number; type: string; category?: object}>} Clips customs.
 */
export function getCustomClipsForUI(): {
	id: number;
	type: string;
	category?: { name: string; getStyle: (id: string) => { value: unknown } | undefined };
}[] {
	return globalState.getCustomClipTrack.clips.map((clip) => ({
		id: clip.id,
		type: clip.type,
		category: (
			clip as {
				category?: { name: string; getStyle: (id: string) => { value: unknown } | undefined };
			}
		).category
	}));
}

/**
 * Vérifie les polices utilisées par un preset et retourne celles absentes du système.
 *
 * Les polices embarquées (QPC1, QPC2, Hafs, IndoPak, etc.) sont ignorées
 * car tous les utilisateurs les possèdent.
 *
 * @param {VideoStyleFileData} styleData Données de style du preset importé.
 * @returns {Promise<string[]>} Noms des polices que l'utilisateur doit installer.
 */
export async function checkMissingFonts(styleData: VideoStyleFileData): Promise<string[]> {
	const fonts = new Set<string>();

	// Parcourt récursivement les styles pour extraire les font-family utilisées
	const videoStyle = styleData.videoStyle as {
		styles?: { categories?: { styles?: { id: string; value: string }[] }[] }[];
	};
	for (const styleGroup of videoStyle.styles ?? []) {
		for (const category of styleGroup.categories ?? []) {
			for (const style of category.styles ?? []) {
				if (style.id === 'font-family' && typeof style.value === 'string') {
					fonts.add(style.value);
				}
			}
		}
	}

	// Polices toujours disponibles (embarquées dans l'app)
	const builtin = ['Hafs', 'IndoPak', 'Reciters', 'Surahs', 'Surahs2', 'QPC1BSML', 'QPC2BSML'];
	const isBuiltin = (font: string) =>
		builtin.includes(font) ||
		font.startsWith('QPC1') ||
		font.startsWith('QPC2') ||
		/^p\d+-v4$/.test(font);

	const toCheck = [...fonts].filter((f) => !isBuiltin(f));
	if (toCheck.length === 0) return [];

	const systemFonts = await invoke<string[]>('get_system_fonts');
	return toCheck.filter((f) => !systemFonts.includes(f));
}
