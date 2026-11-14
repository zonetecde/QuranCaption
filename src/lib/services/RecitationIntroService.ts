import { join } from '@tauri-apps/api/path';
import { exists } from '@tauri-apps/plugin-fs';
import { get } from 'svelte/store';
import {
	Asset,
	AssetClip,
	PredefinedSubtitleClip,
	SilenceClip,
	SourceType,
	SubtitleClip,
	TrackType
} from '$lib/classes';
import { CustomClip } from '$lib/classes/Clip.svelte';
import type { Style } from '$lib/classes/VideoStyle.svelte';
import LL from '$lib/i18n/i18n-svelte';
import type editor from '$lib/i18n/en/editor';
import { globalState } from '$lib/runes/main.svelte';
import { downloadFileWithProgress } from './DownloadWithProgress';
import { ProjectService } from './ProjectService';
import { refreshSegmentationContextFromTrack } from './autoSegmentation/context';
import { cancelWbwRealign } from './autoSegmentation/auto-realign.svelte';
import { ProjectHistoryManager } from './undoRedo/ProjectHistoryManager';

export const INTRO_RECITERS = [
	{ id: 'husary', folder: 'Husary_128kbps' },
	{ id: 'shatri', folder: 'Abu_Bakr_Ash-Shaatree_128kbps' },
	{ id: 'abdulBasit', folder: 'AbdulSamad_64kbps_QuranExplorer.Com' },
	{ id: 'basfar', folder: 'Abdullah_Basfar_64kbps' },
	{ id: 'ajmi', folder: 'Ahmed_ibn_Ali_al-Ajamy_64kbps_QuranExplorer.Com' },
	{ id: 'alafasy', folder: 'Alafasy_128kbps' },
	{ id: 'aliJaber', folder: 'Ali_Jaber_64kbps' },
	{ id: 'ghamdi', folder: 'Ghamadi_40kbps' },
	{ id: 'rifai', folder: 'Hani_Rifai_64kbps', basmalaFolder: 'Hani_Rifai_192kbps' },
	{ id: 'hudhaify', folder: 'Hudhaify_128kbps' },
	{ id: 'minshawi', folder: 'Menshawi_32kbps' },
	{ id: 'ayyoub', folder: 'Muhammad_Ayyoub_128kbps' },
	{ id: 'shuraym', folder: 'Saood_ash-Shuraym_128kbps' }
] as const;

export type IntroReciterId = (typeof INTRO_RECITERS)[number]['id'];
export type IntroFormula = "Isti'adha" | 'Basmala';
export type RecitationIntroTranslations = {
	[Key in Exclude<keyof typeof editor.recitationIntro, 'reciters'>]: () => string;
} & { reciters: Record<IntroReciterId, () => string> };

/**
 * Résout l'audio isolé de la formule dans le dossier EveryAyah du récitateur.
 * @param {IntroReciterId} reciterId Récitateur sélectionné.
 * @param {IntroFormula} formula Formule à écouter ou importer.
 * @returns {string} URL du MP3.
 */
export function getIntroAudioUrl(reciterId: IntroReciterId, formula: IntroFormula): string {
	const reciter = INTRO_RECITERS.find((entry) => entry.id === reciterId)!;
	const folder =
		formula === 'Basmala' && 'basmalaFolder' in reciter ? reciter.basmalaFolder : reciter.folder;
	return `https://everyayah.com/data/${folder}/${formula === 'Basmala' ? 'bismillah' : 'audhubillah'}.mp3`;
}

/**
 * Décale les apparitions et images clés sans changer les valeurs visuelles.
 * @param {Style} style Style existant à décaler.
 * @param {number} offsetMs Durée insérée au début du projet.
 * @param {Set<Style>} visited Styles déjà traités, y compris les catégories partagées.
 * @returns {void}
 */
function shiftStyleTiming(style: Style, offsetMs: number, visited: Set<Style>): void {
	if (visited.has(style)) return;
	visited.add(style);
	for (const keyframe of style.keyframes) keyframe.time += offsetMs;
	if (style.valueType === 'composite' && Array.isArray(style.value)) {
		for (const child of style.value as Style[]) shiftStyleTiming(child, offsetMs, visited);
	} else if (style.valueType === 'time-ranges' && Array.isArray(style.value)) {
		style.value = (style.value as { startTime: number; endTime: number }[]).map((range) => ({
			startTime: range.startTime + offsetMs,
			endTime: range.endTime + offsetMs
		}));
	} else if (/time-(appearance|disappearance)$/.test(style.id) && typeof style.value === 'number') {
		style.value += offsetMs;
	}
}

/**
 * Prépare les assets puis insère l'introduction et décale le projet en une seule action annulable.
 * @param {{reciterId: IntroReciterId; formulas: IntroFormula[]; paddingStartMs: number; paddingEndMs: number}} options Choix de la modale, espacements en millisecondes.
 * @returns {Promise<void>} Fin de l'insertion ; aucun clip n'est modifié en cas d'échec du téléchargement.
 */
export async function prependRecitationIntro(options: {
	reciterId: IntroReciterId;
	formulas: IntroFormula[];
	paddingStartMs: number;
	paddingEndMs: number;
}): Promise<void> {
	const project = globalState.currentProject;
	const copy = Reflect.get(get(LL).editor, 'recitationIntro') as RecitationIntroTranslations;
	const { reciterId, paddingStartMs, paddingEndMs } = options;
	const formulas = (["Isti'adha", 'Basmala'] as const).filter((formula) =>
		options.formulas.includes(formula)
	);
	if (
		!project ||
		!formulas.length ||
		!INTRO_RECITERS.some((entry) => entry.id === reciterId) ||
		![paddingStartMs, paddingEndMs].every((value) => Number.isSafeInteger(value) && value >= 0)
	) {
		throw new Error(copy.invalidSettings());
	}
	const audioTrack = project.content.timeline.getFirstTrack(TrackType.Audio);
	const subtitleTrack = project.content.timeline.getFirstTrack(TrackType.Subtitle);
	const folder = await ProjectService.getAssetFolderForProject(project.detail.id);
	const prepared: { asset: Asset; formula: IntroFormula }[] = [];
	for (const formula of formulas) {
		const url = getIntroAudioUrl(reciterId, formula);
		let asset = project.content.assets.find((candidate) => candidate.sourceUrl === url);
		if (!asset || !(await exists(asset.filePath))) {
			const path = await join(
				folder,
				`intro_${reciterId}_${formula === 'Basmala' ? 'basmala' : 'istiadha'}.mp3`
			);
			await downloadFileWithProgress(url, path);
			asset = new Asset(path, url, SourceType.Local, {
				recitationIntro: { reciterId, formula },
				suppressUiEffects: true
			});
		}
		await asset.ensureDurationLoaded();
		if (!Number.isFinite(asset.duration.ms) || asset.duration.ms <= 0)
			throw new Error(copy.downloadError());
		prepared.push({ asset, formula });
	}
	if (globalState.currentProject !== project) throw new Error(copy.projectChanged());
	let startTime = paddingStartMs;
	const intro = prepared.map(({ asset, formula }) => {
		const endTime = startTime + Math.round(asset.duration.ms);
		const audio = new AssetClip(startTime, endTime, asset.id);
		const subtitle = new PredefinedSubtitleClip(
			startTime,
			endTime,
			formula,
			'',
			false,
			null,
			project.content.projectTranslation
		);
		// Les bornes des clips sont inclusives : éviter un chevauchement d'une milliseconde.
		startTime = endTime + 1;
		return { asset, audio, subtitle };
	});
	const offsetMs = startTime + paddingEndMs;
	if (!Number.isSafeInteger(offsetMs)) throw new Error(copy.invalidSettings());
	ProjectHistoryManager.track(copy.title(), () => {
		cancelWbwRealign(subtitleTrack.clips.filter((clip) => clip instanceof SubtitleClip));
		const visited = new Set<Style>();
		for (const track of project.content.timeline.tracks) {
			for (const clip of track.clips) {
				// L'image de fond sans durée couvre déjà tout le projet, introduction comprise.
				if (track.type === TrackType.Video && track.clips.length === 1 && clip.endTime === 0)
					continue;
				clip.startTime += offsetMs;
				clip.endTime += offsetMs;
				if (
					(clip instanceof SubtitleClip || clip instanceof PredefinedSubtitleClip) &&
					clip.alignmentMetadata
				) {
					clip.alignmentMetadata = {
						...clip.alignmentMetadata,
						timeFrom: clip.alignmentMetadata.timeFrom + offsetMs / 1000,
						timeTo: clip.alignmentMetadata.timeTo + offsetMs / 1000
					};
				}
				if (clip instanceof CustomClip) {
					for (const style of clip.category?.styles ?? [])
						shiftStyleTiming(style, offsetMs, visited);
				}
			}
		}
		for (const collection of project.content.videoStyle.styles) {
			for (const category of collection.categories) {
				for (const style of category.styles) shiftStyleTiming(style, offsetMs, visited);
			}
			for (const overrides of Object.values(collection.overrideKeyframes)) {
				for (const keyframes of Object.values(overrides)) {
					for (const keyframe of keyframes ?? []) keyframe.time += offsetMs;
				}
			}
		}
		for (const { asset } of intro) {
			if (!project.content.assets.includes(asset)) project.content.assets.unshift(asset);
		}
		audioTrack.clips.unshift(...intro.map((entry) => entry.audio));
		subtitleTrack.clips.unshift(
			...(paddingStartMs > 0 ? [new SilenceClip(0, paddingStartMs - 1)] : []),
			...intro.map((entry) => entry.subtitle),
			...(paddingEndMs > 0 ? [new SilenceClip(startTime, offsetMs - 1)] : [])
		);
		project.detail.updateVideoDetailAttributes();
		refreshSegmentationContextFromTrack(true);
		project.projectEditorState.videoPreview.isPlaying = false;
		project.projectEditorState.timeline.cursorPosition = paddingStartMs;
		project.projectEditorState.timeline.movePreviewTo = paddingStartMs;
		project.projectEditorState.timeline.scrollX = 0;
	});
	globalState.updateVideoPreviewUI();
}
