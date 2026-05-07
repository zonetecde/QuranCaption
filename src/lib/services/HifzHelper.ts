import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { mkdir } from '@tauri-apps/plugin-fs';

import {
	Asset,
	AssetClip,
	Duration,
	PredefinedSubtitleClip,
	SilenceClip,
	SourceType,
	SubtitleClip,
	type Translation
} from '$lib/classes';
import type { VisualMergeMode } from '$lib/classes/Clip.svelte';
import { globalState } from '$lib/runes/main.svelte';
import { ProjectService } from '$lib/services/ProjectService';
import {
	createEmptySegmentationContext,
	getAutoSegmentationAudioClips,
	type AutoSegmentationAudioClip
} from '$lib/services/AutoSegmentation';

export type HifzRepeatTarget = 'verse' | 'subtitle';

export type HifzAudioSegment = {
	startMs: number;
	endMs: number;
	repeatCount: number;
	silenceBetweenRepetitionsMs?: number;
};

type HifzSegmentationMetadata = {
	repeatCount: number;
	repeatTarget: HifzRepeatTarget;
	silenceBetweenRepetitionsMultiplier: number;
	sourceAudioClips: AutoSegmentationAudioClip[];
	createdAt: string;
};

type HifzSourceSubtitleClip = SubtitleClip | PredefinedSubtitleClip;

export type HifzToolSummary = {
	subtitleCount: number;
	audioClipCount: number;
	sourceAudioFileName: string | null;
	currentAudioUsesGeneratedSource: boolean;
};

export type HifzToolResult =
	| {
			status: 'completed';
			subtitleCount: number;
			durationMs: number;
			audioFileName: string;
	  }
	| {
			status: 'failed';
			message: string;
	  };

type HifzPlacement = {
	sourceIndex: number;
	startMs: number;
	endMs: number;
	repetition: number;
	visualMergeGroupId?: string;
	visualMergeMode?: VisualMergeMode;
};

type HifzSilencePlacement = {
	startMs: number;
	endMs: number;
};

export type HifzPlanTemplateInput = {
	kind: 'subtitle' | 'predefined';
	originalStartMs: number;
	originalEndMs: number;
	surah?: number;
	verseNumber?: number;
	startWordIndex?: number;
	isFullVerse?: boolean;
	isLastWordsOfVerse?: boolean;
	visualMergeGroupId?: string | null;
	visualMergeMode?: VisualMergeMode | null;
};

type HifzPlanGroup = {
	templateIndices: number[];
	startMs: number;
	endMs: number;
	repeatCount: number;
	silenceBetweenRepetitionsMs?: number;
	visualMergeGroupId?: string;
	visualMergeMode?: VisualMergeMode;
};

/**
 * Convertit une valeur inconnue en chaine non vide.
 *
 * @param {unknown} value Valeur a convertir.
 * @returns {string | undefined} Chaine nettoyee, sinon undefined.
 */
function asNonEmptyString(value: unknown): string | undefined {
	// Les metadonnees peuvent venir d'anciens projets, donc on valide avant usage.
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Convertit une valeur inconnue en nombre fini.
 *
 * @param {unknown} value Valeur a convertir.
 * @returns {number | undefined} Nombre fini, sinon undefined.
 */
function asFiniteNumber(value: unknown): number | undefined {
	// Les nombres serialises en chaine sont acceptes pour garder la compatibilite projet.
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string') {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
}

/**
 * Normalise un clip audio stocke dans les metadonnees Hifz.
 *
 * @param {unknown} value Valeur brute lue depuis les metadonnees de l'asset audio.
 * @returns {AutoSegmentationAudioClip | null} Clip audio valide, sinon null.
 */
function normalizeStoredAudioClip(value: unknown): AutoSegmentationAudioClip | null {
	// Une entree incomplete est ignoree pour ne pas casser le fallback vers l'audio courant.
	if (!value || typeof value !== 'object') return null;

	const filePath = asNonEmptyString((value as { filePath?: unknown }).filePath);
	if (!filePath) return null;

	const startMs = asFiniteNumber((value as { startMs?: unknown }).startMs);
	const endMs = asFiniteNumber((value as { endMs?: unknown }).endMs);
	if (startMs === undefined || endMs === undefined) return null;

	return {
		filePath,
		fileName: filePath.split(/[/\\]/).pop() || filePath,
		startMs: Math.max(0, Math.round(startMs)),
		endMs: Math.max(Math.max(0, Math.round(startMs)), Math.round(endMs))
	};
}

/**
 * Recupere les clips audio source d'une piste audio Hifz deja generee.
 *
 * @returns {AutoSegmentationAudioClip[] | null} Clips source tries, sinon null.
 */
function getHifzSourceAudioClipsFromTrack(): AutoSegmentationAudioClip[] | null {
	// Seule une piste constituee d'un unique asset Hifz peut porter l'audio source original.
	const project = globalState.currentProject;
	const audioTrack = globalState.getAudioTrack;
	if (!project || !audioTrack || audioTrack.clips.length !== 1) return null;

	const clip = audioTrack.clips[0];
	if (!(clip instanceof AssetClip)) return null;

	const audioAsset = project.content.getAssetById(clip.assetId);
	const rawSourceClips = (audioAsset?.metadata as { hifzSegmentation?: HifzSegmentationMetadata })
		?.hifzSegmentation?.sourceAudioClips;
	if (!Array.isArray(rawSourceClips)) return null;

	const normalized = rawSourceClips
		.map((entry) => normalizeStoredAudioClip(entry))
		.filter((entry): entry is AutoSegmentationAudioClip => !!entry);
	return normalized.length > 0 ? normalized.sort((a, b) => a.startMs - b.startMs) : null;
}

/**
 * Retourne les clips audio a utiliser pour generer une piste Hifz.
 *
 * @returns {AutoSegmentationAudioClip[]} Clips source, en privilegiant l'audio original si la piste courante est deja generee.
 */
function getHifzGenerationAudioClips(): AutoSegmentationAudioClip[] {
	// Regenerer depuis une piste Hifz doit repartir de l'audio original, pas du MP3 repete.
	return getHifzSourceAudioClipsFromTrack() ?? getAutoSegmentationAudioClips();
}

/**
 * Indique si deux templates appartiennent au meme bloc de verset Hifz.
 *
 * @param {HifzPlanTemplateInput} current Template precedent.
 * @param {HifzPlanTemplateInput} next Template suivant.
 * @returns {boolean} True quand les deux templates sont dans le meme verset.
 */
function areTemplatesInSameVerseBlock(
	current: HifzPlanTemplateInput,
	next: HifzPlanTemplateInput
): boolean {
	// Les predefined ne doivent jamais etre repetes comme des versets Quran.
	if (current.kind !== 'subtitle' || next.kind !== 'subtitle') return false;
	if (!Number.isFinite(current.surah) || !Number.isFinite(current.verseNumber)) return false;
	if (!Number.isFinite(next.surah) || !Number.isFinite(next.verseNumber)) return false;
	return current.surah === next.surah && current.verseNumber === next.verseNumber;
}

/**
 * Retourne les indices consecutifs d'un merge visuel preserve.
 *
 * @param {HifzPlanTemplateInput[]} templates Templates sources du projet.
 * @param {number} startIndex Index de depart potentiel du merge.
 * @returns {number[]} Indices du merge, ou liste vide si aucun merge valide.
 */
function getPreservedVisualMergeIndices(
	templates: HifzPlanTemplateInput[],
	startIndex: number
): number[] {
	// On ne preserve un merge qu'en partant de son premier clip pour eviter les demi-groupes.
	const template = templates[startIndex];
	if (
		template?.kind !== 'subtitle' ||
		!template.visualMergeGroupId ||
		!template.visualMergeMode
	) {
		return [];
	}

	const previousTemplate = templates[startIndex - 1];
	if (
		previousTemplate?.kind === 'subtitle' &&
		previousTemplate.visualMergeGroupId === template.visualMergeGroupId &&
		previousTemplate.visualMergeMode === template.visualMergeMode
	) {
		return [];
	}

	const indices: number[] = [];
	for (let index = startIndex; index < templates.length; index += 1) {
		const candidate = templates[index];
		if (
			candidate.kind !== 'subtitle' ||
			candidate.visualMergeGroupId !== template.visualMergeGroupId ||
			candidate.visualMergeMode !== template.visualMergeMode
		) {
			break;
		}
		indices.push(index);
	}

	return indices.length > 1 ? indices : [];
}

/**
 * Indique si un merge visuel contient uniquement des versets complets.
 *
 * @param {HifzPlanTemplateInput[]} templates Templates du merge visuel.
 * @returns {boolean} True si chaque verset du merge est complet.
 */
function isCompleteVerseVisualMerge(templates: HifzPlanTemplateInput[]): boolean {
	// En mode verset, un merge cross-verse partiel doit etre repete clip par clip.
	if (templates.length <= 1 || templates.some((template) => template.kind !== 'subtitle')) {
		return false;
	}

	const verseStates = new Map<string, { hasStart: boolean; hasEnd: boolean }>();
	for (const template of templates) {
		if (!Number.isFinite(template.surah) || !Number.isFinite(template.verseNumber)) return false;

		const verseKey = `${template.surah}:${template.verseNumber}`;
		const state = verseStates.get(verseKey) ?? { hasStart: false, hasEnd: false };
		state.hasStart ||= template.isFullVerse === true || template.startWordIndex === 0;
		state.hasEnd ||= template.isFullVerse === true || template.isLastWordsOfVerse === true;
		verseStates.set(verseKey, state);
	}

	return [...verseStates.values()].every((state) => state.hasStart && state.hasEnd);
}

/**
 * Regroupe les templates Hifz selon la granularite demandee.
 *
 * @param {HifzPlanTemplateInput[]} templates Templates sources du projet.
 * @param {number} repeatCount Nombre de repetitions demande.
 * @param {HifzRepeatTarget} repeatTarget Granularite des repetitions.
 * @param {boolean} preserveVisualMerges Indique si les merges visuels valides doivent etre conserves.
 * @param {number} silenceBetweenRepetitionsMultiplier Multiplicateur de silence entre repetitions.
 * @returns {HifzPlanGroup[]} Groupes temporels a repeter.
 */
function buildHifzPlanGroups(
	templates: HifzPlanTemplateInput[],
	repeatCount: number,
	repeatTarget: HifzRepeatTarget,
	preserveVisualMerges: boolean,
	silenceBetweenRepetitionsMultiplier: number
): HifzPlanGroup[] {
	// La normalisation empeche un plan invalide si la valeur vient d'un input libre.
	const safeRepeatCount = Math.max(2, Math.round(repeatCount || 2));
	const safeSilenceMultiplier = normalizeSilenceBetweenRepetitionsMultiplier(
		silenceBetweenRepetitionsMultiplier
	);
	const groups: HifzPlanGroup[] = [];

	for (let index = 0; index < templates.length; index += 1) {
		const template = templates[index];
		const normalizedStartMs = Math.max(0, Math.round(template.originalStartMs));
		const normalizedEndMs = Math.max(normalizedStartMs + 1, Math.round(template.originalEndMs));
		const mergeIndices = preserveVisualMerges
			? getPreservedVisualMergeIndices(templates, index)
			: [];
		const shouldPreserveMerge =
			mergeIndices.length > 0 &&
			(repeatTarget === 'subtitle' ||
				isCompleteVerseVisualMerge(mergeIndices.map((mergeIndex) => templates[mergeIndex])));

		if (shouldPreserveMerge) {
			const mergeTemplates = mergeIndices.map((mergeIndex) => templates[mergeIndex]);
			groups.push({
				templateIndices: mergeIndices,
				startMs: Math.min(
					...mergeTemplates.map((entry) => Math.max(0, Math.round(entry.originalStartMs)))
				),
				endMs: Math.max(
					...mergeTemplates.map((entry) =>
						Math.max(
							Math.max(0, Math.round(entry.originalStartMs)) + 1,
							Math.round(entry.originalEndMs)
						)
					)
				),
				repeatCount: safeRepeatCount,
				visualMergeGroupId: template.visualMergeGroupId ?? undefined,
				visualMergeMode: template.visualMergeMode ?? undefined
			});
			index = mergeIndices[mergeIndices.length - 1];
			continue;
		}

		const lastGroup = groups[groups.length - 1];
		const lastTemplate =
			lastGroup && lastGroup.templateIndices.length > 0
				? templates[lastGroup.templateIndices[lastGroup.templateIndices.length - 1]]
				: null;

		if (
			repeatTarget === 'verse' &&
			lastGroup &&
			lastTemplate &&
			areTemplatesInSameVerseBlock(lastTemplate, template)
		) {
			lastGroup.templateIndices.push(index);
			lastGroup.endMs = Math.max(lastGroup.endMs, normalizedEndMs);
			continue;
		}

		groups.push({
			templateIndices: [index],
			startMs: normalizedStartMs,
			endMs: normalizedEndMs,
			repeatCount: template.kind === 'subtitle' ? safeRepeatCount : 1
		});
	}

	for (const group of groups) {
		group.silenceBetweenRepetitionsMs = getSilenceBetweenRepetitionsMs(
			group.endMs - group.startMs,
			safeSilenceMultiplier
		);
	}

	return groups;
}

/**
 * Normalise le multiplicateur de silence entre repetitions.
 *
 * @param {number} multiplier Multiplicateur brut saisi dans la modale.
 * @returns {number} Multiplicateur positif arrondi au quart.
 */
export function normalizeSilenceBetweenRepetitionsMultiplier(multiplier: number): number {
	// Le pas de 0.25 garde l'UI et le plan audio parfaitement previsibles.
	const safeMultiplier = Number.isFinite(multiplier) ? multiplier : 0;
	return Math.max(0, Math.round(safeMultiplier * 4) / 4);
}

/**
 * Calcule le silence a inserer entre deux repetitions d'un meme bloc.
 *
 * @param {number} previousSegmentDurationMs Duree du bloc repete juste avant.
 * @param {number} multiplier Multiplicateur de silence.
 * @returns {number} Silence a inserer en millisecondes.
 */
function getSilenceBetweenRepetitionsMs(
	previousSegmentDurationMs: number,
	multiplier: number
): number {
	// Le silence est base sur la duree du bloc precedent, comme demande dans la modale.
	return Math.max(0, Math.round(Math.max(0, previousSegmentDurationMs) * multiplier));
}

/**
 * Construit le plan de repetitions Hifz pour les sous-titres et l'audio.
 *
 * @param {HifzPlanTemplateInput[]} templates Templates sources du projet.
 * @param {number} repeatCount Nombre de repetitions par bloc.
 * @param {HifzRepeatTarget} repeatTarget Granularite des repetitions.
 * @param {boolean} preserveVisualMerges Indique si les merges visuels valides doivent etre conserves.
 * @param {number} silenceBetweenRepetitionsMultiplier Multiplicateur de silence entre repetitions.
 * @returns {{ placements: HifzPlacement[]; silencePlacements: HifzSilencePlacement[]; audioSegments: HifzAudioSegment[]; totalDurationMs: number }} Plan complet de generation.
 */
export function buildHifzRepetitionPlan(
	templates: HifzPlanTemplateInput[],
	repeatCount: number,
	repeatTarget: HifzRepeatTarget = 'verse',
	preserveVisualMerges: boolean = false,
	silenceBetweenRepetitionsMultiplier: number = 0
): {
	placements: HifzPlacement[];
	silencePlacements: HifzSilencePlacement[];
	audioSegments: HifzAudioSegment[];
	totalDurationMs: number;
} {
	const placements: HifzPlacement[] = [];
	const silencePlacements: HifzSilencePlacement[] = [];
	const audioSegments: HifzAudioSegment[] = [];
	const groups = buildHifzPlanGroups(
		templates,
		repeatCount,
		repeatTarget,
		preserveVisualMerges,
		silenceBetweenRepetitionsMultiplier
	);
	let cursorMs = 0;

	for (const group of groups) {
		const groupDurationMs = Math.max(1, group.endMs - group.startMs);
		const silenceBetweenRepetitionsMs = Math.max(0, group.silenceBetweenRepetitionsMs ?? 0);
		audioSegments.push({
			startMs: group.startMs,
			endMs: group.endMs,
			repeatCount: group.repeatCount,
			...(silenceBetweenRepetitionsMs > 0 ? { silenceBetweenRepetitionsMs } : {})
		});

		for (let repetition = 1; repetition <= group.repeatCount; repetition += 1) {
			const repeatedBlockStartMs = cursorMs;
			const visualMergeGroupId = group.visualMergeGroupId
				? `hifz-${group.visualMergeGroupId}-${repetition}-${repeatedBlockStartMs}`
				: undefined;
			for (const sourceIndex of group.templateIndices) {
				const template = templates[sourceIndex];
				const normalizedStartMs = Math.max(0, Math.round(template.originalStartMs));
				const normalizedEndMs = Math.max(normalizedStartMs + 1, Math.round(template.originalEndMs));
				placements.push({
					sourceIndex,
					startMs: repeatedBlockStartMs + (normalizedStartMs - group.startMs),
					endMs: repeatedBlockStartMs + (normalizedEndMs - group.startMs),
					repetition,
					...(visualMergeGroupId && group.visualMergeMode
						? { visualMergeGroupId, visualMergeMode: group.visualMergeMode }
						: {})
				});
			}
			// Le curseur suit exactement l'audio: bloc repete, puis silence optionnel apres chaque repetition.
			cursorMs = repeatedBlockStartMs + groupDurationMs;
			if (group.repeatCount > 1 && silenceBetweenRepetitionsMs > 0) {
				silencePlacements.push({
					startMs: cursorMs,
					endMs: cursorMs + silenceBetweenRepetitionsMs
				});
				cursorMs += silenceBetweenRepetitionsMs;
			}
		}
	}

	return {
		placements,
		silencePlacements,
		audioSegments,
		totalDurationMs: cursorMs
	};
}

/**
 * Cree les metadonnees permettant de retrouver l'audio source apres generation Hifz.
 *
 * @param {AutoSegmentationAudioClip[]} sourceAudioClips Clips audio source.
 * @param {number} repeatCount Nombre de repetitions utilise.
 * @param {HifzRepeatTarget} repeatTarget Granularite des repetitions.
 * @param {number} silenceBetweenRepetitionsMultiplier Multiplicateur de silence entre repetitions.
 * @returns {HifzSegmentationMetadata} Metadonnees a stocker sur l'asset genere.
 */
function buildGeneratedHifzAudioMetadata(
	sourceAudioClips: AutoSegmentationAudioClip[],
	repeatCount: number,
	repeatTarget: HifzRepeatTarget,
	silenceBetweenRepetitionsMultiplier: number
): HifzSegmentationMetadata {
	// Les clips source sont copies pour figer la provenance de l'asset genere.
	return {
		repeatCount,
		repeatTarget,
		silenceBetweenRepetitionsMultiplier: normalizeSilenceBetweenRepetitionsMultiplier(
			silenceBetweenRepetitionsMultiplier
		),
		sourceAudioClips: sourceAudioClips.map((clip) => ({ ...clip })),
		createdAt: new Date().toISOString()
	};
}

/**
 * Genere l'asset audio repete pour le tool Hifz.
 *
 * @param {HifzAudioSegment[]} audioSegments Segments audio a concatener.
 * @param {number} repeatCount Nombre de repetitions utilise.
 * @param {HifzRepeatTarget} repeatTarget Granularite des repetitions.
 * @param {number} silenceBetweenRepetitionsMultiplier Multiplicateur de silence entre repetitions.
 * @returns {Promise<{ asset: Asset; durationMs: number }>} Asset genere et duree finale.
 */
async function generateHifzAudioAsset(
	audioSegments: HifzAudioSegment[],
	repeatCount: number,
	repeatTarget: HifzRepeatTarget,
	silenceBetweenRepetitionsMultiplier: number
): Promise<{ asset: Asset; durationMs: number }> {
	// L'asset est ajoute au projet seulement apres generation ffmpeg reussie.
	const project = globalState.currentProject;
	if (!project) throw new Error('No active project found.');

	const sourceAudioClips = getHifzGenerationAudioClips();
	const audioInfo = sourceAudioClips[0] ?? null;

	const assetFolder = await ProjectService.getAssetFolderForProject(project.detail.id);
	await mkdir(assetFolder, { recursive: true });

	const sourceFileName = (audioInfo?.fileName ?? 'audio').replace(/\.[^/.]+$/, '');
	const safeBaseName = sourceFileName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_') || 'audio';
	const outputPath = await join(
		assetFolder,
		`${safeBaseName}_hifz_${repeatTarget}_x${repeatCount}_${Date.now()}.mp3`
	);

	const result = (await invoke('generate_hifz_audio', {
		audioPath: audioInfo?.filePath ?? null,
		audioClips: sourceAudioClips.map((clip) => ({
			path: clip.filePath,
			startMs: clip.startMs,
			endMs: clip.endMs
		})),
		segments: audioSegments,
		outputPath
	})) as { outputPath: string; durationMs: number };

	const asset = new Asset(result.outputPath, undefined, SourceType.Local, {
		hifzSegmentation: buildGeneratedHifzAudioMetadata(
			sourceAudioClips,
			repeatCount,
			repeatTarget,
			silenceBetweenRepetitionsMultiplier
		)
	} satisfies { hifzSegmentation: HifzSegmentationMetadata });
	asset.duration = new Duration(result.durationMs);
	asset.durationLoadState = 'success';
	asset.durationLoadError = null;
	project.content.assets.unshift(asset);

	return { asset, durationMs: result.durationMs };
}

/**
 * Clone une table de traductions pour eviter de partager les memes objets entre repetitions.
 *
 * @param {{ [key: string]: Translation }} translations Traductions du clip source.
 * @returns {{ [key: string]: Translation }} Copie independante des traductions.
 */
function cloneHifzTranslations(translations: { [key: string]: Translation }): {
	[key: string]: Translation;
} {
	// Chaque repetition doit pouvoir etre editee sans modifier ses copies voisines.
	return Object.fromEntries(
		Object.entries(translations).map(([key, translation]) => [
			key,
			typeof translation.clone === 'function'
				? translation.clone()
				: (JSON.parse(JSON.stringify(translation)) as Translation)
		])
	);
}

/**
 * Retourne les clips de sous-titres utilisables comme source Hifz.
 *
 * @returns {HifzSourceSubtitleClip[]} Clips Quran et predefinis tries par temps.
 */
function getHifzSourceSubtitleClips(): HifzSourceSubtitleClip[] {
	// Les silences et customs ne portent pas de contenu memorisable.
	return globalState.getSubtitleTrack.clips
		.filter(
			(clip): clip is HifzSourceSubtitleClip =>
				clip instanceof SubtitleClip || clip instanceof PredefinedSubtitleClip
		)
		.sort((left, right) => left.startTime - right.startTime);
}

/**
 * Transforme les clips de sous-titres existants en entrees du plan Hifz.
 *
 * @param {HifzSourceSubtitleClip[]} clips Clips source du projet.
 * @returns {HifzPlanTemplateInput[]} Entrees temporelles minimales pour le plan.
 */
function buildHifzPlanTemplatesFromClips(
	clips: HifzSourceSubtitleClip[]
): HifzPlanTemplateInput[] {
	// Le plan ne garde que les champs necessaires au regroupement et au timing.
	return clips.map((clip) =>
		clip instanceof SubtitleClip
			? {
					kind: 'subtitle',
					originalStartMs: clip.startTime,
					originalEndMs: clip.endTime,
					surah: clip.surah,
					verseNumber: clip.verse,
					startWordIndex: clip.startWordIndex,
					isFullVerse: clip.isFullVerse,
					isLastWordsOfVerse: clip.isLastWordsOfVerse,
					visualMergeGroupId: clip.visualMergeGroupId,
					visualMergeMode: clip.visualMergeMode
				}
			: {
					kind: 'predefined',
					originalStartMs: clip.startTime,
					originalEndMs: clip.endTime
				}
	);
}

/**
 * Clone un clip predefini pour une nouvelle plage Hifz.
 *
 * @param {PredefinedSubtitleClip} clip Clip source.
 * @param {number} startMs Nouveau debut.
 * @param {number} endMs Nouvelle fin.
 * @returns {PredefinedSubtitleClip} Clip clone.
 */
function clonePredefinedClipForHifz(
	clip: PredefinedSubtitleClip,
	startMs: number,
	endMs: number
): PredefinedSubtitleClip {
	// Le constructeur regenere les traductions par defaut, donc on restaure ensuite celles du clip source.
	const clonedClip = new PredefinedSubtitleClip(
		startMs,
		endMs,
		clip.predefinedSubtitleType,
		clip.text,
		clip.comeFromIA,
		clip.confidence
	);
	clonedClip.translations = cloneHifzTranslations(clip.translations);
	clonedClip.arabicInlineStyleRuns = JSON.parse(JSON.stringify(clip.arabicInlineStyleRuns ?? []));
	clonedClip.associatedImagePath = clip.associatedImagePath;
	clonedClip.needsLongReview = clip.needsLongReview;
	clonedClip.needsReview = clip.needsReview;
	clonedClip.needsCoverageReview = clip.needsCoverageReview;
	clonedClip.hasBeenVerified = clip.hasBeenVerified;
	clonedClip.comeFromIA = clip.comeFromIA;
	clonedClip.confidence = clip.confidence;
	return clonedClip;
}

/**
 * Clone un clip source Hifz avec une nouvelle plage temporelle.
 *
 * @param {HifzSourceSubtitleClip} clip Clip source.
 * @param {number} startMs Nouveau debut.
 * @param {number} endMs Nouvelle fin.
 * @param {string | undefined} visualMergeGroupId Identifiant de merge a appliquer au clone.
 * @param {VisualMergeMode | undefined} visualMergeMode Mode de merge a appliquer au clone.
 * @returns {HifzSourceSubtitleClip} Clip clone et detache du clip source.
 */
function cloneHifzSubtitleClip(
	clip: HifzSourceSubtitleClip,
	startMs: number,
	endMs: number,
	visualMergeGroupId?: string,
	visualMergeMode?: VisualMergeMode
): HifzSourceSubtitleClip {
	// Les predefined ne participent pas au merge visuel Quran.
	if (clip instanceof PredefinedSubtitleClip) {
		return clonePredefinedClipForHifz(clip, startMs, endMs);
	}

	const clonedClip = clip.cloneWithTimes(startMs, endMs);
	clonedClip.visualMergeGroupId = visualMergeGroupId ?? null;
	clonedClip.visualMergeMode = visualMergeMode ?? null;
	if (clonedClip.alignmentMetadata) {
		clonedClip.alignmentMetadata = {
			...clonedClip.alignmentMetadata,
			timeFrom: startMs / 1000,
			timeTo: endMs / 1000
		};
	}
	return clonedClip;
}

/**
 * Resume l'etat courant du tool Hifz pour la modale.
 *
 * @returns {HifzToolSummary} Informations d'audio et de sous-titres disponibles.
 */
export function getHifzToolSummary(): HifzToolSummary {
	// Le resume utilise le meme choix d'audio que la generation effective.
	const sourceAudioClips = getHifzGenerationAudioClips();
	const generatedSourceClips = getHifzSourceAudioClipsFromTrack();
	return {
		subtitleCount: getHifzSourceSubtitleClips().length,
		audioClipCount: sourceAudioClips.length,
		sourceAudioFileName: sourceAudioClips[0]?.fileName ?? null,
		currentAudioUsesGeneratedSource: generatedSourceClips !== null
	};
}

/**
 * Applique la repetition Hifz aux sous-titres et remplace la piste audio courante.
 *
 * @param {number} repeatCount Nombre de repetitions par bloc.
 * @param {HifzRepeatTarget} repeatTarget Granularite de repetition.
 * @param {boolean} preserveVisualMerges Indique si les merges visuels valides doivent etre conserves.
 * @param {number} silenceBetweenRepetitionsMultiplier Multiplicateur de silence entre repetitions.
 * @returns {Promise<HifzToolResult>} Resultat de generation.
 */
export async function applyHifzRepetitionToProject(
	repeatCount: number,
	repeatTarget: HifzRepeatTarget,
	preserveVisualMerges: boolean = false,
	silenceBetweenRepetitionsMultiplier: number = 0
): Promise<HifzToolResult> {
	try {
		// Les mutations projet ne commencent qu'apres validation du contexte courant.
		const project = globalState.currentProject;
		if (!project) return { status: 'failed', message: 'No active project found.' };

		const sourceClips = getHifzSourceSubtitleClips();
		if (sourceClips.length === 0) {
			return { status: 'failed', message: 'No subtitle clips found in the project.' };
		}

		const safeRepeatCount = Math.max(2, Math.round(repeatCount || 2));
		const templates = buildHifzPlanTemplatesFromClips(sourceClips);
		const repetitionPlan = buildHifzRepetitionPlan(
			templates,
			safeRepeatCount,
			repeatTarget,
			preserveVisualMerges,
			silenceBetweenRepetitionsMultiplier
		);
		if (repetitionPlan.placements.length === 0) {
			return { status: 'failed', message: 'No Hifz repetition plan could be generated.' };
		}

		// On genere l'audio avant de modifier la timeline pour garder le projet intact en cas d'erreur.
		const generatedAudio = await generateHifzAudioAsset(
			repetitionPlan.audioSegments,
			safeRepeatCount,
			repeatTarget,
			silenceBetweenRepetitionsMultiplier
		);
		const repeatedClips = repetitionPlan.placements
			.map((placement) => {
				const sourceClip = sourceClips[placement.sourceIndex];
				if (!sourceClip) return null;
				return cloneHifzSubtitleClip(
					sourceClip,
					placement.startMs,
					placement.endMs,
					placement.visualMergeGroupId,
					placement.visualMergeMode
				);
			})
			.filter((clip): clip is HifzSourceSubtitleClip => !!clip)
			.sort((left, right) => left.startTime - right.startTime);
		const silenceClips = repetitionPlan.silencePlacements.map(
			(placement) => new SilenceClip(placement.startMs, placement.endMs)
		);

		globalState.getSubtitleTrack.clips = [...repeatedClips, ...silenceClips].sort(
			(left, right) => left.startTime - right.startTime
		);
		globalState.getAudioTrack.clips = [
			new AssetClip(0, Math.max(0, generatedAudio.durationMs), generatedAudio.asset.id)
		];
		globalState.getStylesState.clearSelection();
		globalState.getSubtitlesEditorState.editSubtitle = null;
		globalState.getSubtitlesEditorState.segmentationContext = createEmptySegmentationContext();
		globalState.currentProject?.detail.updateVideoDetailAttributes();
		globalState.updateVideoPreviewUI();

		return {
			status: 'completed',
			subtitleCount: repeatedClips.length,
			durationMs: generatedAudio.durationMs,
			audioFileName: generatedAudio.asset.fileName
		};
	} catch (error) {
		return { status: 'failed', message: error instanceof Error ? error.message : String(error) };
	}
}
