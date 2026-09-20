import { AssetType, TrackType } from './enums.js';
import {
	AssetClip,
	Clip,
	ClipWithTranslation,
	CustomClip,
	CustomImageClip,
	CustomTextClip,
	PredefinedSubtitleClip,
	SilenceClip,
	SubtitleClip,
	canonicalizePredefinedSubtitleType,
	normalizeTranscriptWordTimings,
	type PredefinedSubtitleType,
	type VisualMergeMode
} from './Clip.svelte.js';
import { SerializableBase } from './misc/SerializableBase.js';
import { Duration, type Asset } from './index.js';
import { globalState } from '$lib/runes/main.svelte.js';
import toast from 'svelte-5-french-toast';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';
import { Translation } from './Translation.svelte.js';
import ModalManager from '$lib/components/modals/ModalManager.js';
import type { Category } from './VideoStyle.svelte.js';
import { open } from '@tauri-apps/plugin-dialog';
import { resolveCurrentSurahFromClips } from '$lib/services/ExportCaptureTiming';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import { Quran, type Verse } from './Quran.js';
import { getTranscriptReferenceLogicalParts } from '$lib/services/TranscriptReferenceService';

export type VisualMergeSelection = {
	clips: SubtitleClip[];
	startIndex: number;
	endIndex: number;
};

export type VisualMergeGroup = {
	groupId: string;
	mode: VisualMergeMode;
	clips: SubtitleClip[];
	firstClip: SubtitleClip;
	lastClip: SubtitleClip;
	startTime: number;
	endTime: number;
};

type SubtitleSplitOptions = {
	forceExactCursor?: boolean;
	duplicateText?: boolean;
};

type WordBoundarySplitCandidate = {
	leftEndWordIndex: number;
	splitTimeMs: number;
};

/**
 * Recompose un texte de transcription marque apres une coupe entre deux mots.
 *
 * @param {string} text Texte source contenant des marqueurs Quran ou citation.
 * @param {number} leftWordCount Nombre de mots conserves dans la partie gauche.
 * @param {number} totalWordCount Nombre total de mots alignes du clip.
 * @returns {Promise<[string, string] | null>} Textes gauche et droit, ou `null` si le decoupage ne peut pas etre resolu.
 */
export async function splitTranscriptTextAtWordBoundary(
	text: string,
	leftWordCount: number,
	totalWordCount: number
): Promise<[string, string] | null> {
	const logicalParts = getTranscriptReferenceLogicalParts(text);
	if (
		!logicalParts ||
		leftWordCount <= 0 ||
		leftWordCount >= totalWordCount ||
		totalWordCount <= 1
	) {
		return null;
	}

	const counts = logicalParts.map((part) => part.wordCount);
	const unknownIndexes = counts.flatMap((count, index) => (count === null ? [index] : []));
	const knownCount = counts.reduce<number>((sum, count) => sum + (count ?? 0), 0);

	if (unknownIndexes.length === 1) {
		const inferredCount = totalWordCount - knownCount;
		if (inferredCount < 0) return null;
		counts[unknownIndexes[0]] = inferredCount;
	} else if (unknownIndexes.length > 1) {
		try {
			await Quran.load();
			for (const index of unknownIndexes) {
				const reference = logicalParts[index].quranReference;
				if (!reference) return null;
				const verse = await Quran.getVerse(reference.surah, reference.verse);
				if (!verse) return null;
				counts[index] = verse.words.length;
			}
		} catch {
			return null;
		}
	}

	const resolvedCounts = counts.map((count) => count ?? -1);
	if (resolvedCounts.some((count) => count < 0)) return null;
	if (resolvedCounts.reduce((sum, count) => sum + count, 0) !== totalWordCount) return null;

	const leftParts: string[] = [];
	const rightParts: string[] = [];
	let wordCursor = 0;
	for (const [index, part] of logicalParts.entries()) {
		const wordCount = resolvedCounts[index];
		if (wordCount === 0) continue;

		const leftCount = Math.max(0, Math.min(wordCount, leftWordCount - wordCursor));
		const rightCount = wordCount - leftCount;
		const words = part.text.trim().split(/\s+/).filter(Boolean);

		/**
		 * Ajoute la portion d'un marqueur qui appartient a un cote du split.
		 * @param {string[]} target Tableau de sortie a completer.
		 * @param {number} start Index local de debut.
		 * @param {number} count Nombre de mots a ajouter.
		 * @returns {boolean} `true` si la portion a ete reconstruite.
		 */
		const appendSlice = (target: string[], start: number, count: number): boolean => {
			if (count === 0) return true;
			if (part.referenceType === 'quran') {
				const reference = part.quranReference;
				if (!reference) return false;
				if (count === wordCount) {
					target.push(`{{${part.text}}}`);
					return true;
				}
				const referenceStart = reference.startWord ?? 1;
				const rangeStart = referenceStart + start;
				const rangeEnd = rangeStart + count - 1;
				target.push(`{{${reference.surah}:${reference.verse}:${rangeStart}-${rangeEnd}}}`);
				return true;
			}

			if (words.length !== wordCount) return false;
			const slice = words.slice(start, start + count).join(' ');
			target.push(part.referenceType === 'citation' ? `{{${slice}}}` : slice);
			return true;
		};

		if (!appendSlice(leftParts, 0, leftCount)) return null;
		if (!appendSlice(rightParts, leftCount, rightCount)) return null;
		wordCursor += wordCount;
	}

	const leftText = leftParts.join(' ').trim();
	const rightText = rightParts.join(' ').trim();
	return leftText && rightText ? [leftText, rightText] : null;
}

const trackClipIndexCache = new WeakMap<Track, Map<number, number>>();

/**
 * Indique si les clips sont triés par temps de début croissant.
 *
 * @param {Clip[]} clips Clips de la piste.
 * @returns {boolean} `true` si la piste peut utiliser une recherche binaire.
 */
function areClipsSortedByStartTime(clips: Clip[]): boolean {
	for (let index = 1; index < clips.length; index++) {
		if (clips[index].startTime < clips[index - 1].startTime) return false;
	}
	return true;
}

/**
 * Retourne l'index d'un clip par ID avec un cache faible non sérialisé.
 *
 * @param {Track} track Piste contenant les clips.
 * @param {number} clipId ID du clip cherché.
 * @returns {number} Index du clip, ou `-1`.
 */
function getClipIndexById(track: Track, clipId: number): number {
	let cache = trackClipIndexCache.get(track);
	if (!cache) {
		cache = new Map();
		trackClipIndexCache.set(track, cache);
	}

	const cachedIndex = cache.get(clipId);
	if (cachedIndex !== undefined && track.clips[cachedIndex]?.id === clipId) {
		return cachedIndex;
	}

	const index = track.clips.findIndex((clip) => clip.id === clipId);
	if (index !== -1) cache.set(clipId, index);
	else cache.delete(clipId);
	return index;
}

/**
 * Retourne l'index du clip actif à un temps donné.
 *
 * @param {Clip[]} clips Clips de la piste.
 * @param {number} timeMs Temps courant en millisecondes.
 * @returns {number} Index du clip actif, ou `-1`.
 */
function findClipIndexAtTime(clips: Clip[], timeMs: number): number {
	if (!areClipsSortedByStartTime(clips)) {
		return clips.findIndex((clip) => timeMs >= clip.startTime && timeMs <= clip.endTime);
	}

	let low = 0;
	let high = clips.length - 1;
	let candidate = -1;

	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		const clip = clips[mid];

		if (clip.startTime <= timeMs) {
			candidate = mid;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}

	if (candidate === -1) return -1;
	return timeMs <= clips[candidate].endTime ? candidate : -1;
}

/**
 * Retourne le premier index qui peut chevaucher une plage visible.
 *
 * @param {Clip[]} clips Clips triés par startTime.
 * @param {number} rangeStartMs Début de plage en millisecondes.
 * @returns {number} Index de départ.
 */
function findFirstVisibleClipIndex(clips: Clip[], rangeStartMs: number): number {
	let low = 0;
	let high = clips.length - 1;
	let result = clips.length;

	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		if (clips[mid].endTime >= rangeStartMs) {
			result = mid;
			high = mid - 1;
		} else {
			low = mid + 1;
		}
	}

	return result;
}

export class Track extends SerializableBase {
	type: TrackType = $state(TrackType.Unknown);
	clips: Clip[] = $state([]);

	constructor(type: TrackType) {
		super();
		this.type = type;
		this.clips = [];
	}

	/**
	 * Supprime un clip de la piste.
	 * @param id L'ID du clip à supprimer.
	 * @param makeNextClipStartAtThisClipStartTime Si vrai, le prochain clip commencera à l'heure de début de ce clip plutôt que de tout décaler.
	 * * Si faux, les clips suivants seront décalés pour combler l'espace laissé par le clip supprimé.
	 * */
	removeClip(id: number, makeNextClipStartAtThisClipStartTime: boolean = false) {
		ProjectHistoryManager.begin('remove clip');
		try {
			const index = this.clips.findIndex((clip) => clip.id === id);
			if (index !== -1) {
				const clipToRemoveStartTime = this.clips[index].startTime;
				this.clips.splice(index, 1);
				if (this.type === TrackType.Audio) {
					globalState.updateVideoPreviewUI();
					return;
				}

				if (!makeNextClipStartAtThisClipStartTime) {
					// Met à jour les timestamps des clips suivants
					for (let i = index; i < this.clips.length; i++) {
						const clip = this.clips[i];
						clip.startTime = i === 0 ? 0 : this.clips[i - 1].endTime + 1;
						clip.endTime = clip.startTime + clip.duration;
					}
				} else {
					// Trouve le clip suivant et met à jour son startTime
					const nextClip = this.clips[index];
					if (nextClip) {
						nextClip.setStartTime(clipToRemoveStartTime);
					}
				}
			}

			globalState.updateVideoPreviewUI();
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	removeLastClip() {
		ProjectHistoryManager.begin('remove last clip');
		try {
			if (this.clips.length === 0) {
				return;
			}

			this.clips.pop();
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	getClipById(clipId: number): Clip {
		const index = getClipIndexById(this, clipId);
		return this.clips[index]!;
	}

	getName(): string {
		switch (this.type) {
			case TrackType.Video:
				return 'Video';
			case TrackType.Audio:
				return 'Audio';
			case TrackType.Subtitle:
				return 'Subtitles';
			case TrackType.CustomClip:
				return 'Custom Clips';
			default:
				return 'Unknown Track';
		}
	}

	getIcon(): string {
		switch (this.type) {
			case TrackType.Video:
				return 'movie';
			case TrackType.Audio:
				return 'music_note';
			case TrackType.Subtitle:
				return 'subtitles';
			case TrackType.CustomClip:
				return 'text_fields';
			default:
				return 'help_outline';
		}
	}

	getAcceptableAssetType(): AssetType {
		switch (this.type) {
			case TrackType.Video:
				return AssetType.Video;
			case TrackType.Audio:
				return AssetType.Audio;
			default:
				return AssetType.Unknown;
		}
	}

	getPixelPerSecond() {
		return globalState.currentProject?.projectEditorState.timeline.zoom ?? 1;
	}

	getDuration(): Duration {
		if (this.clips.length === 0) {
			return new Duration(0);
		}
		return new Duration(Math.max(...this.clips.map((clip) => clip.endTime)));
	}

	getCurrentClip(cursorPos?: number): Clip | null {
		const currentTime =
			cursorPos ?? globalState.currentProject?.projectEditorState.timeline.cursorPosition ?? 0;
		if (this.type === TrackType.Audio) return this.getCurrentClips(currentTime)[0] ?? null;
		const index = findClipIndexAtTime(this.clips, currentTime);
		return index === -1 ? null : this.clips[index];
	}

	/**
	 * Retourne tous les clips actifs à un instant, notamment pour les sous-pistes audio.
	 * @param {number} [cursorPos] Position à inspecter en millisecondes.
	 * @returns {Clip[]} Clips actifs dans l'ordre de la piste.
	 */
	getCurrentClips(cursorPos?: number): Clip[] {
		const currentTime =
			cursorPos ?? globalState.currentProject?.projectEditorState.timeline.cursorPosition ?? 0;
		return this.clips
			.filter((clip) => currentTime >= clip.startTime && currentTime <= clip.endTime)
			.sort((left, right) => left.startTime - right.startTime);
	}

	/**
	 * Retourne le clip actif sur la timeline visuelle avec chevauchement crossfade.
	 *
	 * @param {number} cursorPos Position du curseur en millisecondes.
	 * @returns {Clip | null} Clip actif, ou `null`.
	 */
	getCurrentVisualClip(cursorPos?: number): Clip | null {
		const currentTime =
			cursorPos ?? globalState.currentProject?.projectEditorState.timeline.cursorPosition ?? 0;
		if (!this.shouldUseVideoCrossfadeVisualTiming()) return this.getCurrentClip(currentTime);

		for (let index = this.clips.length - 1; index >= 0; index--) {
			const clip = this.clips[index];
			if (
				currentTime >= this.getVisualClipStartTime(index) &&
				currentTime <= this.getVisualClipEndTime(index)
			) {
				return clip;
			}
		}

		return null;
	}

	/**
	 * Retourne le début visuel d'un clip, en tenant compte du crossfade vidéo.
	 *
	 * @param {number} clipIndex Index du clip dans la piste.
	 * @returns {number} Début visuel en millisecondes.
	 */
	getVisualClipStartTime(clipIndex: number): number {
		const clip = this.clips[clipIndex];
		if (!clip) return 0;
		if (this.hasExplicitVideoClipTiming()) return clip.startTime;
		return clip.startTime - this.getVideoCrossfadeOffsetBeforeClip(clipIndex);
	}

	/**
	 * Retourne la fin visuelle d'un clip, en tenant compte du crossfade vidéo.
	 *
	 * @param {number} clipIndex Index du clip dans la piste.
	 * @returns {number} Fin visuelle en millisecondes.
	 */
	getVisualClipEndTime(clipIndex: number): number {
		const clip = this.clips[clipIndex];
		if (!clip) return 0;
		return this.getVisualClipStartTime(clipIndex) + clip.duration;
	}

	/**
	 * Retourne le décalage cumulé avant un clip vidéo crossfade.
	 *
	 * @param {number} clipIndex Index du clip dans la piste.
	 * @returns {number} Décalage cumulé en millisecondes.
	 */
	getVideoCrossfadeOffsetBeforeClip(clipIndex: number): number {
		if (
			!this.shouldUseVideoCrossfadeVisualTiming() ||
			this.hasExplicitVideoClipTiming() ||
			clipIndex <= 0
		) {
			return 0;
		}

		const requestedFadeMs = this.getVideoCrossfadeDurationMs();
		let offsetMs = 0;
		let currentDurationMs = Math.max(1, this.clips[0]?.duration ?? 1);

		for (let index = 0; index < clipIndex; index++) {
			const nextDurationMs = Math.max(1, this.clips[index + 1]?.duration ?? 1);
			const fadeMs = Math.min(requestedFadeMs, currentDurationMs, nextDurationMs);
			offsetMs += fadeMs;
			currentDurationMs = currentDurationMs + nextDurationMs - fadeMs;
		}

		return offsetMs;
	}

	/**
	 * Indique si les positions vidéo décrivent explicitement des chevauchements ou des espaces.
	 *
	 * @returns {boolean} `true` quand la disposition ne suit plus la séquence historique continue.
	 */
	hasExplicitVideoClipTiming(): boolean {
		return (
			this.type === TrackType.Video &&
			this.clips.some((clip, index) => {
				if (index === 0) return clip.startTime !== 0;
				return clip.startTime !== this.clips[index - 1].endTime + 1;
			})
		);
	}

	/**
	 * Retourne la durée du crossfade précédant un clip vidéo.
	 *
	 * @param {number} clipIndex Index du clip dans la piste.
	 * @returns {number} Durée du chevauchement ou durée configurée, en millisecondes.
	 */
	getVideoCrossfadeDurationBeforeClip(clipIndex: number): number {
		if (clipIndex <= 0 || clipIndex >= this.clips.length) return 0;

		const previousClip = this.clips[clipIndex - 1];
		const clip = this.clips[clipIndex];
		if (this.hasExplicitVideoClipTiming()) {
			return Math.max(
				0,
				Math.min(previousClip.endTime - clip.startTime, previousClip.duration, clip.duration)
			);
		}

		return Math.min(this.getVideoCrossfadeDurationMs(), previousClip.duration, clip.duration);
	}

	/**
	 * Indique si la piste vidéo doit afficher le timing visuel du crossfade.
	 *
	 * @returns {boolean} `true` si le crossfade vidéo est actif.
	 */
	shouldUseVideoCrossfadeVisualTiming(): boolean {
		return (
			this.type === TrackType.Video &&
			this.clips.length > 1 &&
			String(globalState.getStyle('global', 'video-clip-transition')?.value ?? 'none') ===
				'crossfade' &&
			(this.getVideoCrossfadeDurationMs() > 0 || this.hasExplicitVideoClipTiming())
		);
	}

	/**
	 * Retourne la durée configurée du crossfade vidéo.
	 *
	 * @returns {number} Durée du crossfade en millisecondes.
	 */
	private getVideoCrossfadeDurationMs(): number {
		return Math.max(
			0,
			Number(globalState.getStyle('global', 'video-clip-transition-duration')?.value ?? 0)
		);
	}

	getClipBefore(id: number) {
		const index = getClipIndexById(this, id);
		return index > 0 ? this.clips[index - 1] : null;
	}

	getClipAfter(id: number) {
		const index = getClipIndexById(this, id);
		return index !== -1 && index < this.clips.length - 1 ? this.clips[index + 1] : null;
	}

	getLastClip() {
		return this.clips[this.clips.length - 1] || null;
	}

	/**
	 * Retourne les clips qui chevauchent une plage de timeline.
	 *
	 * @param {number} startMs Début de plage visible en millisecondes.
	 * @param {number} endMs Fin de plage visible en millisecondes.
	 * @returns {Array<{ clip: Clip; clipIndex: number }>} Clips visibles avec leur index.
	 */
	getClipsInRange(startMs: number, endMs: number): Array<{ clip: Clip; clipIndex: number }> {
		if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
			return this.clips.map((clip, clipIndex) => ({ clip, clipIndex }));
		}

		if (!areClipsSortedByStartTime(this.clips)) {
			return this.clips
				.map((clip, clipIndex) => ({ clip, clipIndex }))
				.filter(
					({ clip }) =>
						this.isBackgroundImageClip(clip) || (clip.endTime >= startMs && clip.startTime <= endMs)
				);
		}

		if (this.shouldUseVideoCrossfadeVisualTiming()) {
			return this.clips
				.map((clip, clipIndex) => ({ clip, clipIndex }))
				.filter(
					({ clip, clipIndex }) =>
						this.isBackgroundImageClip(clip) ||
						(this.getVisualClipEndTime(clipIndex) >= startMs &&
							this.getVisualClipStartTime(clipIndex) <= endMs)
				);
		}

		const visibleClips: Array<{ clip: Clip; clipIndex: number }> = this.isBackgroundImageClip(
			this.clips[0]
		)
			? [{ clip: this.clips[0], clipIndex: 0 }]
			: [];
		const startIndex = findFirstVisibleClipIndex(this.clips, startMs);

		for (let clipIndex = startIndex; clipIndex < this.clips.length; clipIndex++) {
			const clip = this.clips[clipIndex];
			if (clip.startTime > endMs) break;
			if (clip.endTime >= startMs && !this.isBackgroundImageClip(clip)) {
				visibleClips.push({ clip, clipIndex });
			}
		}

		return visibleClips;
	}

	/**
	 * Coupe un clip audio ou vidéo au niveau du curseur de la timeline.
	 * @param {number} clipId Identifiant du clip à couper.
	 * @returns {boolean} `true` si le clip a été coupé.
	 */
	splitAssetClip(clipId: number): boolean {
		ProjectHistoryManager.begin('split asset clip');
		try {
			if (this.type !== TrackType.Video && this.type !== TrackType.Audio) return false;

			const clipIndex = this.clips.findIndex((clip) => clip.id === clipId);
			const clip = this.clips[clipIndex];
			if (!(clip instanceof AssetClip) || clip.loopUntilAudioEnd) return false;

			const splitTime = globalState.getTimelineState.cursorPosition;
			if (splitTime <= clip.startTime || splitTime >= clip.endTime) return false;
			if (splitTime - clip.startTime < 100 || clip.endTime - splitTime < 100) {
				toast.error(get(LL).editor.clipsTooShort());
				return false;
			}

			const originalStartTime = clip.startTime;
			const originalEndTime = clip.endTime;
			const originalSourceStartTime = clip.sourceStartTime ?? 0;

			clip.setEndTime(splitTime);

			const newClip = new AssetClip(splitTime, originalEndTime, clip.assetId);
			newClip.sourceStartTime = originalSourceStartTime + (splitTime - originalStartTime);
			newClip.showWaveform = clip.showWaveform;
			newClip.volumePercent = clip.volumePercent;
			this.clips.splice(clipIndex + 1, 0, newClip);

			return true;
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/**
	 * Indique si un clip vidéo à durée nulle représente l'image de fond de toute la timeline.
	 *
	 * @param {Clip | undefined} clip Clip à tester.
	 * @returns {boolean} true si le clip doit rester visible même hors plage virtualisée.
	 */
	private isBackgroundImageClip(clip: Clip | undefined): boolean {
		return (
			clip !== undefined &&
			this.type === TrackType.Video &&
			this.clips.length === 1 &&
			clip instanceof AssetClip &&
			clip.endTime === 0
		);
	}
}

export const DEFAULT_IMAGE_CLIP_DURATION_MS = 10_000;

export class AssetTrack extends Track {
	volumePercent: number = $state(100);

	constructor(type: TrackType) {
		super(type);
	}

	/** Ajoute un asset à la piste, avec une durée de dix secondes pour les images de timeline. */
	addAsset(asset: Asset, imageAsFullBackground: boolean = true): boolean {
		ProjectHistoryManager.begin('add asset clip');
		try {
			// Récupère le dernier clip de la piste, s'il existe
			const lastClip = this.clips.length > 0 ? this.clips[this.clips.length - 1] : null;

			if (lastClip) {
				// Prevent adding if an existing clip has the loop option enabled
				if (this.clips.some((c) => c instanceof AssetClip && (c as AssetClip).loopUntilAudioEnd)) {
					ModalManager.errorModal(
						get(LL).editor.clipAdditionError(),
						get(LL).editor.cannotAddMoreClips()
					);
					return false;
				}

				if (
					this.type === TrackType.Video &&
					this.clips.length === 1 &&
					lastClip instanceof AssetClip &&
					lastClip.endTime === 0
				) {
					lastClip.endTime = DEFAULT_IMAGE_CLIP_DURATION_MS;
					lastClip.duration = DEFAULT_IMAGE_CLIP_DURATION_MS;
				}

				if (this.type === TrackType.Audio && this.clips.length === 2) {
					const overlapHint = Reflect.get(get(LL).editor, 'audioOverlapHint') as () => string;
					toast(overlapHint(), { icon: '💡', duration: 6000, position: 'bottom-left' });
				}

				const startTime =
					this.type === TrackType.Audio ? this.getDuration().ms + 1 : lastClip.endTime + 1;
				const duration =
					asset.type === AssetType.Image ? DEFAULT_IMAGE_CLIP_DURATION_MS : asset.duration.ms;
				this.clips.push(new AssetClip(startTime, startTime + duration, asset.id));
			} else {
				const duration =
					asset.type === AssetType.Image && !imageAsFullBackground
						? DEFAULT_IMAGE_CLIP_DURATION_MS
						: asset.duration.ms;
				this.clips.push(new AssetClip(0, duration, asset.id));
			}

			// Trigger la réactivité dans la videopreview pour afficher le clip ajouté (si le curseur est dessus)
			setTimeout(() => {
				if (!globalState.currentProject) return;

				globalState.getTimelineState.movePreviewTo =
					globalState.getTimelineState.cursorPosition + 1;
			}, 0);

			return true;
		} finally {
			ProjectHistoryManager.commit();
		}
	}
}

export class SubtitleTrack extends Track {
	constructor() {
		super(TrackType.Subtitle);
	}

	/**
	 * Calcule les métadonnées nécessaires à un segment Qur'an.
	 * @param {Verse} verse Verset source.
	 * @param {number} firstWordIndex Premier mot inclus.
	 * @param {number} lastWordIndex Dernier mot inclus.
	 * @param {number} _surah Numéro de sourate conservé pour compatibilité.
	 * @returns {Promise<{isFullVerse: boolean; isLastWordsOfVerse: boolean; translations: Record<string, Translation>}>} Métadonnées du segment.
	 */
	async getSubtitlesProperties(
		verse: Verse,
		firstWordIndex: number,
		lastWordIndex: number,
		_surah: number
	): Promise<{
		isFullVerse: boolean;
		isLastWordsOfVerse: boolean;
		translations: { [key: string]: Translation };
	}> {
		const isFullVerse = verse.words.length === lastWordIndex - firstWordIndex + 1;
		const isLastWordsOfVerse = verse.words.length - lastWordIndex - 1 === 0;
		const text = verse.getArabicTextBetweenTwoIndexes(firstWordIndex, lastWordIndex);
		const translations = globalState.currentProject
			? globalState.getProjectTranslation.createTranslationsForSubtitleText(text)
			: {};
		return { isFullVerse, isLastWordsOfVerse, translations };
	}

	/**
	 * Ajoute un segment Qur'an à la fin de la piste.
	 * @param {Verse} verse Verset source.
	 * @param {number} firstWordIndex Premier mot inclus.
	 * @param {number} lastWordIndex Dernier mot inclus.
	 * @param {number} surah Numéro de sourate.
	 * @returns {Promise<boolean>} `true` si le segment a été ajouté.
	 */
	async addSubtitle(
		verse: Verse,
		firstWordIndex: number,
		lastWordIndex: number,
		surah: number
	): Promise<boolean> {
		ProjectHistoryManager.begin('add subtitle');
		try {
			const startTime = this.getDuration().ms + 1;
			const endTime = globalState.currentProject?.projectEditorState.timeline.cursorPosition ?? -1;
			if (endTime < startTime) {
				toast.error(get(LL).editor.endTimeMustBeGreater());
				return false;
			}

			const properties = await this.getSubtitlesProperties(
				verse,
				firstWordIndex,
				lastWordIndex,
				surah
			);
			this.clips.push(
				new SubtitleClip(
					startTime,
					endTime,
					surah,
					verse.id,
					firstWordIndex,
					lastWordIndex,
					verse.getArabicTextBetweenTwoIndexes(firstWordIndex, lastWordIndex),
					verse.getWordByWordTranslationBetweenTwoIndexes(firstWordIndex, lastWordIndex),
					properties.isFullVerse,
					properties.isLastWordsOfVerse,
					properties.translations,
					verse.getArabicTextBetweenTwoIndexes(firstWordIndex, lastWordIndex, 'indopak')
				)
			);
			return true;
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/**
	 * Modifie un segment Qur'an existant ou remplace un clip non-Qur'an.
	 * @param {SubtitleClip | PredefinedSubtitleClip | SilenceClip | ClipWithTranslation | null} subtitle Clip à modifier.
	 * @param {Verse} verse Nouveau verset source.
	 * @param {number} firstWordIndex Premier mot inclus.
	 * @param {number} lastWordIndex Dernier mot inclus.
	 * @param {number} surah Numéro de sourate.
	 * @returns {Promise<void>} Promesse terminée après la modification.
	 */
	async editSubtitle(
		subtitle: SubtitleClip | PredefinedSubtitleClip | SilenceClip | ClipWithTranslation | null,
		verse: Verse,
		firstWordIndex: number,
		lastWordIndex: number,
		surah: number
	): Promise<void> {
		if (!subtitle) return;
		ProjectHistoryManager.begin('edit subtitle');
		try {
			if (subtitle instanceof SubtitleClip && subtitle.visualMergeGroupId) {
				this.unmergeVisualGroup(subtitle.visualMergeGroupId, false);
			}
			const properties = await this.getSubtitlesProperties(
				verse,
				firstWordIndex,
				lastWordIndex,
				surah
			);
			if (!(subtitle instanceof SubtitleClip)) {
				const replacement = new SubtitleClip(
					subtitle.startTime,
					subtitle.endTime,
					surah,
					verse.id,
					firstWordIndex,
					lastWordIndex,
					verse.getArabicTextBetweenTwoIndexes(firstWordIndex, lastWordIndex),
					verse.getWordByWordTranslationBetweenTwoIndexes(firstWordIndex, lastWordIndex),
					properties.isFullVerse,
					properties.isLastWordsOfVerse,
					properties.translations,
					verse.getArabicTextBetweenTwoIndexes(firstWordIndex, lastWordIndex, 'indopak')
				);
				if (subtitle instanceof ClipWithTranslation) {
					replacement.associatedImagePath = subtitle.associatedImagePath;
				}
				const index = this.clips.findIndex((clip) => clip.id === subtitle.id);
				if (index !== -1) this.clips[index] = replacement;
				return;
			}

			subtitle.surah = surah;
			subtitle.verse = verse.id;
			subtitle.startWordIndex = firstWordIndex;
			subtitle.endWordIndex = lastWordIndex;
			subtitle.text = verse.getArabicTextBetweenTwoIndexes(firstWordIndex, lastWordIndex);
			subtitle.indopakText = verse.getArabicTextBetweenTwoIndexes(
				firstWordIndex,
				lastWordIndex,
				'indopak'
			);
			subtitle.wbwTranslation = verse.getWordByWordTranslationBetweenTwoIndexes(
				firstWordIndex,
				lastWordIndex
			);
			subtitle.isFullVerse = properties.isFullVerse;
			subtitle.isLastWordsOfVerse = properties.isLastWordsOfVerse;
			subtitle.translations = properties.translations;
			subtitle.clearArabicInlineStyles();
			subtitle.markAsManualEdit();
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/**
	 * Applique les flags d'edition manuelle sans supprimer les timestamps mot par mot.
	 *
	 * @param {SubtitleClip | PredefinedSubtitleClip} clip Clip a marquer comme manuel.
	 * @returns {void}
	 */
	private markSplitClipAsManualEdit(clip: SubtitleClip | PredefinedSubtitleClip): void {
		clip.comeFromIA = false;
		clip.confidence = null;
		clip.needsReview = false;
		clip.needsCoverageReview = false;
		clip.needsLongReview = false;
		clip.hasBeenVerified = false;
	}

	/**
	 * Cherche la limite de mot la plus proche du curseur.
	 *
	 * @param {SubtitleClip} clip Segment de transcription a couper.
	 * @param {number} splitTimeMs Position actuelle du curseur.
	 * @returns {WordBoundarySplitCandidate | null} Limite retenue, ou `null` sans timestamps mot par mot.
	 */
	private getNearestWordBoundarySplitCandidate(
		clip: SubtitleClip,
		splitTimeMs: number
	): WordBoundarySplitCandidate | null {
		const metadata = clip.alignmentMetadata;
		if (!metadata || metadata.words.length < 2) return null;

		let bestCandidate: WordBoundarySplitCandidate | null = null;
		let bestDistance = Number.POSITIVE_INFINITY;

		for (let index = 0; index < metadata.words.length - 1; index += 1) {
			const word = metadata.words[index];
			const nextWord = metadata.words[index + 1];
			const boundaryOffsetS = Math.max(
				word.end,
				Math.min(nextWord.start, (word.end + nextWord.start) / 2)
			);
			const candidate: WordBoundarySplitCandidate = {
				leftEndWordIndex: index,
				splitTimeMs: Math.round((metadata.timeFrom + boundaryOffsetS) * 1000)
			};
			const distance = Math.abs(candidate.splitTimeMs - splitTimeMs);
			if (distance < bestDistance) {
				bestDistance = distance;
				bestCandidate = candidate;
			}
		}

		return bestCandidate;
	}

	/**
	 * Choisit la repartition des mots quand on force un split a la position exacte du curseur.
	 *
	 * @param {SubtitleClip} clip Segment de transcription a couper.
	 * @param {number} splitTimeMs Position actuelle du curseur.
	 * @returns {number | null} Index du dernier mot a garder a gauche, ou `null` si aucun choix fiable n'est possible.
	 */
	private getExactCursorSplitWordIndex(clip: SubtitleClip, splitTimeMs: number): number | null {
		const metadata = clip.alignmentMetadata;
		if (!metadata || metadata.words.length < 2) return null;

		const splitOffsetS = splitTimeMs / 1000 - metadata.timeFrom;
		let leftEndWordIndex = -1;

		for (let index = 0; index < metadata.words.length; index += 1) {
			const word = metadata.words[index];
			if (splitOffsetS <= word.start) {
				leftEndWordIndex = index - 1;
				break;
			}
			if (splitOffsetS >= word.end) {
				leftEndWordIndex = index;
				continue;
			}

			const midpoint = word.start + (word.end - word.start) / 2;
			leftEndWordIndex = splitOffsetS >= midpoint ? index : index - 1;
			break;
		}

		return Math.max(0, Math.min(metadata.words.length - 2, leftEndWordIndex));
	}

	/**
	 * Coupe un segment de transcription en conservant les mots et leurs timestamps.
	 *
	 * @param {number} clipIndex Index du clip dans la piste.
	 * @param {SubtitleClip} clip Segment de transcription a couper.
	 * @param {number} splitTimeMs Position de coupe finale sur la timeline.
	 * @param {number} leftEndWordIndex Dernier mot a conserver dans la partie gauche.
	 * @returns {Promise<boolean>} `true` si la coupe a ete appliquee.
	 */
	private async splitSubtitleClipWithWordBoundaries(
		clipIndex: number,
		clip: SubtitleClip,
		splitTimeMs: number,
		leftEndWordIndex: number
	): Promise<boolean> {
		const metadata = clip.alignmentMetadata;
		if (!metadata || metadata.words.length < 2) return false;
		if (leftEndWordIndex < 0 || leftEndWordIndex >= metadata.words.length - 1) return false;

		const originalEndTime = clip.endTime;
		const originalStartTime = clip.startTime;
		const splitOffsetS = splitTimeMs / 1000 - metadata.timeFrom;
		const leftDurationS = Math.max(0, (splitTimeMs - originalStartTime) / 1000);
		const rightDurationS = Math.max(0, (originalEndTime - splitTimeMs) / 1000);
		const leftWords = metadata.words.slice(0, leftEndWordIndex + 1).map((word, index, words) => ({
			...word,
			start: index === 0 ? 0 : Math.max(0, Math.min(leftDurationS, word.start)),
			end:
				index === words.length - 1 ? leftDurationS : Math.max(0, Math.min(leftDurationS, word.end))
		}));
		const rightWords = metadata.words.slice(leftEndWordIndex + 1).map((word, index, words) => ({
			...word,
			start: index === 0 ? 0 : Math.max(0, Math.min(rightDurationS, word.start - splitOffsetS)),
			end:
				index === words.length - 1
					? rightDurationS
					: Math.max(0, Math.min(rightDurationS, word.end - splitOffsetS))
		}));
		if (leftWords.length === 0 || rightWords.length === 0) return false;

		const rightClip = clip.cloneWithTimes(splitTimeMs, originalEndTime);
		const splitText = await splitTranscriptTextAtWordBoundary(
			clip.text,
			leftWords.length,
			metadata.words.length
		);
		clip.setEndTimeSilently(splitTimeMs);
		clip.text =
			splitText?.[0] ??
			leftWords
				.map((word) => word.word)
				.join(' ')
				.trim();
		rightClip.text =
			splitText?.[1] ??
			rightWords
				.map((word) => word.word)
				.join(' ')
				.trim();
		clip.clearArabicInlineStyles();
		rightClip.clearArabicInlineStyles();
		clip.alignmentMetadata = {
			...metadata,
			timeFrom: originalStartTime / 1000,
			timeTo: splitTimeMs / 1000,
			words: normalizeTranscriptWordTimings(leftWords, leftDurationS)
		};
		rightClip.alignmentMetadata = {
			...metadata,
			timeFrom: splitTimeMs / 1000,
			timeTo: originalEndTime / 1000,
			words: normalizeTranscriptWordTimings(rightWords, rightDurationS)
		};

		this.markSplitClipAsManualEdit(clip);
		this.markSplitClipAsManualEdit(rightClip);
		this.clips.splice(clipIndex + 1, 0, rightClip);
		return true;
	}

	/**
	 * Indique si la timeline contient au moins un sous-titre avec des timestamps mot a mot.
	 * @returns {boolean} `true` si au moins un `SubtitleClip` porte des mots alignes.
	 */
	hasWordByWordTimestamps(): boolean {
		return this.clips.some(
			(clip) => clip instanceof SubtitleClip && (clip.alignmentMetadata?.words.length ?? 0) > 0
		);
	}

	/**
	 * Supprime un clip de sous-titre et retire d'abord son merge visuel si necessaire.
	 * @param {number} id L'identifiant du clip a supprimer.
	 * @param {boolean} makeNextClipStartAtThisClipStartTime Indique si le clip suivant doit reprendre son start.
	 * @returns {void}
	 */
	override removeClip(id: number, makeNextClipStartAtThisClipStartTime: boolean = false): void {
		ProjectHistoryManager.begin('remove subtitle clip');
		try {
			const clipToRemove = this.clips.find((clip) => clip.id === id);
			if (clipToRemove instanceof SubtitleClip && clipToRemove.visualMergeGroupId) {
				this.unmergeVisualGroup(clipToRemove.visualMergeGroupId, false);
			}

			super.removeClip(id, makeNextClipStartAtThisClipStartTime);
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/**
	 * Verifie si une selection peut etre mergee visuellement.
	 * @param {Array<SubtitleClip | PredefinedSubtitleClip>} selection Selection courante.
	 * @returns {VisualMergeSelection | null} Les clips tries si la selection est eligible, sinon `null`.
	 */
	getVisualMergeSelection(
		selection: Array<SubtitleClip | PredefinedSubtitleClip>
	): VisualMergeSelection | null {
		if (selection.length <= 1) return null;
		if (!selection.every((clip) => clip instanceof SubtitleClip)) return null;

		const clipsWithIndexes = selection
			.map((clip) => ({
				clip,
				index: this.clips.findIndex((trackClip) => trackClip.id === clip.id)
			}))
			.sort((a, b) => a.index - b.index);

		if (clipsWithIndexes.some(({ index }) => index === -1)) return null;

		for (let index = 1; index < clipsWithIndexes.length; index++) {
			if (clipsWithIndexes[index].index !== clipsWithIndexes[index - 1].index + 1) {
				return null;
			}
		}

		return {
			clips: clipsWithIndexes.map(({ clip }) => clip),
			startIndex: clipsWithIndexes[0].index,
			endIndex: clipsWithIndexes[clipsWithIndexes.length - 1].index
		};
	}

	/**
	 * Verifie si une selection consecutive suit une continuite logique de mots Quran.
	 * Les chevauchements sont autorises, mais aucun trou n'est accepte.
	 *
	 * @param {SubtitleClip[]} clips Clips Quran consecutifs tries par timeline.
	 * @returns {boolean} `true` si la chaine arabe est continue.
	 */
	canUseArabicVisualMerge(clips: SubtitleClip[]): boolean {
		if (clips.length <= 1) return true;

		for (let index = 1; index < clips.length; index++) {
			const previousClip = clips[index - 1];
			const currentClip = clips[index];

			// Meme verset: aucun trou entre les indexes de mots.
			if (previousClip.surah === currentClip.surah && previousClip.verse === currentClip.verse) {
				if (currentClip.startWordIndex > previousClip.endWordIndex + 1) {
					return false;
				}
				continue;
			}

			// Verset suivant de la meme sourate: le clip precedent doit finir le verset
			// et le nouveau clip doit commencer au premier mot.
			if (
				previousClip.surah === currentClip.surah &&
				currentClip.verse === previousClip.verse + 1
			) {
				if (!previousClip.isLastWordsOfVerse || currentClip.startWordIndex !== 0) {
					return false;
				}
				continue;
			}

			// Tout autre saut casse la continuite arabe.
			return false;
		}

		return true;
	}

	/**
	 * Retourne le groupe de merge visuel actif pour un clip donne.
	 * @param {number} clipId L'identifiant du clip courant.
	 * @returns {VisualMergeGroup | null} Le groupe valide ou `null`.
	 */
	getVisualMergeGroupForClipId(clipId: number): VisualMergeGroup | null {
		const clipIndex = getClipIndexById(this, clipId);
		const clip = clipIndex === -1 ? null : this.clips[clipIndex];

		if (!(clip instanceof SubtitleClip) || !clip.visualMergeGroupId || !clip.visualMergeMode) {
			return null;
		}

		const mergedClips = this.clips
			.map((trackClip, index) => ({ clip: trackClip, index }))
			.filter(
				(entry): entry is { clip: SubtitleClip; index: number } =>
					entry.clip instanceof SubtitleClip &&
					entry.clip.visualMergeGroupId === clip.visualMergeGroupId &&
					entry.clip.visualMergeMode === clip.visualMergeMode
			);

		if (mergedClips.length <= 1) return null;

		for (let index = 1; index < mergedClips.length; index++) {
			if (mergedClips[index].index !== mergedClips[index - 1].index + 1) return null;
		}

		return {
			groupId: clip.visualMergeGroupId,
			mode: clip.visualMergeMode,
			clips: mergedClips.map((entry) => entry.clip),
			firstClip: mergedClips[0].clip,
			lastClip: mergedClips[mergedClips.length - 1].clip,
			startTime: mergedClips[0].clip.startTime,
			endTime: mergedClips[mergedClips.length - 1].clip.endTime
		};
	}

	/**
	 * Applique un merge visuel a une selection de sous-titres Quran consecutifs.
	 * @param {Array<SubtitleClip | PredefinedSubtitleClip>} selection Selection a merger.
	 * @param {VisualMergeMode} mode Mode de merge a appliquer.
	 * @returns {boolean} `true` si le merge a ete applique.
	 */
	applyVisualMerge(
		selection: Array<SubtitleClip | PredefinedSubtitleClip>,
		mode: VisualMergeMode
	): boolean {
		ProjectHistoryManager.begin('apply visual merge');
		try {
			const mergeSelection = this.getVisualMergeSelection(selection);
			if (!mergeSelection) return false;
			if (!this.canUseArabicVisualMerge(mergeSelection.clips)) {
				return false;
			}

			const touchedGroupIds = new Set(
				mergeSelection.clips
					.map((clip) => clip.visualMergeGroupId)
					.filter((groupId): groupId is string => !!groupId)
			);

			for (const groupId of touchedGroupIds) {
				this.unmergeVisualGroup(groupId, false);
			}

			const groupId = `visual-merge-${Date.now()}-${mergeSelection.clips[0].id}`;
			for (const clip of mergeSelection.clips) {
				clip.setVisualMerge(groupId, mode);
			}

			if (globalState.currentProject) {
				const selectedSubtitleIds = new Set(
					globalState.getStylesState.selectedSubtitles.map((subtitle) => subtitle.id)
				);
				if (mergeSelection.clips.some((clip) => selectedSubtitleIds.has(clip.id))) {
					globalState.getStylesState.selectedSubtitles =
						globalState.getStylesState.normalizeSubtitleSelection(
							globalState.getStylesState.selectedSubtitles
						);
				}
			}

			globalState.updateVideoPreviewUI();
			return true;
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/**
	 * Retire le merge visuel de tout un groupe.
	 * @param {string} groupId Identifiant du groupe a casser.
	 * @param {boolean} updatePreview Indique s'il faut rafraichir la preview ensuite.
	 * @returns {void}
	 */
	unmergeVisualGroup(groupId: string, updatePreview: boolean = true): void {
		ProjectHistoryManager.begin('unmerge visual group');
		try {
			for (const clip of this.clips) {
				if (clip instanceof SubtitleClip && clip.visualMergeGroupId === groupId) {
					clip.clearVisualMerge();
				}
			}

			if (updatePreview) {
				globalState.updateVideoPreviewUI();
			}
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/**
	 * Coupe un groupe de merge visuel entre deux sous-titres adjacents.
	 * @param {SubtitleClip} leftClip Clip à gauche de la coupure.
	 * @param {SubtitleClip} rightClip Clip à droite de la coupure.
	 * @returns {boolean} `true` si le groupe a été coupé.
	 */
	splitVisualMergeBetween(leftClip: SubtitleClip, rightClip: SubtitleClip): boolean {
		if (
			!leftClip.visualMergeGroupId ||
			leftClip.visualMergeGroupId !== rightClip.visualMergeGroupId ||
			leftClip.visualMergeMode !== rightClip.visualMergeMode ||
			!leftClip.visualMergeMode
		) {
			return false;
		}

		const mergeGroup = this.getVisualMergeGroupForClipId(leftClip.id);
		if (!mergeGroup || mergeGroup.groupId !== leftClip.visualMergeGroupId) return false;

		const leftIndex = mergeGroup.clips.findIndex((clip) => clip.id === leftClip.id);
		if (leftIndex === -1 || mergeGroup.clips[leftIndex + 1]?.id !== rightClip.id) return false;

		const mode = leftClip.visualMergeMode;
		const leftSide = mergeGroup.clips.slice(0, leftIndex + 1);
		const rightSide = mergeGroup.clips.slice(leftIndex + 1);

		for (const clip of mergeGroup.clips) {
			clip.clearVisualMerge();
		}

		for (const side of [leftSide, rightSide]) {
			if (side.length <= 1) continue;
			const groupId = `visual-merge-${Date.now()}-${side[0].id}`;
			for (const clip of side) {
				clip.setVisualMerge(groupId, mode);
			}
		}

		globalState.updateVideoPreviewUI();
		return true;
	}

	/**
	 * Modifie un sous-titre existant pour le transformer en un sous-titre pré-défini (Silence, Istiadhah, Basmala).
	 * @param subtitle Le sous-titre à modifier.
	 * @param presetChoice Le type de sous-titre pré-défini à appliquer.
	 */
	editSubtitleToSpecial(
		subtitle: SubtitleClip | PredefinedSubtitleClip | SilenceClip,
		presetChoice:
			| 'Silence'
			| 'Basmala'
			| "Isti'adha"
			| 'Amin'
			| 'Takbir'
			| 'Tahmeed'
			| 'Tasleem'
			| 'Sadaqa'
	) {
		let newSubtitleClip: SilenceClip | PredefinedSubtitleClip | undefined = undefined;

		if (subtitle instanceof SubtitleClip && subtitle.visualMergeGroupId) {
			this.unmergeVisualGroup(subtitle.visualMergeGroupId, false);
		}

		if (presetChoice === 'Silence') {
			newSubtitleClip = new SilenceClip(subtitle.startTime, subtitle.endTime);
		} else if (presetChoice === 'Basmala') {
			newSubtitleClip = new PredefinedSubtitleClip(subtitle.startTime, subtitle.endTime, 'Basmala');
		} else {
			newSubtitleClip = new PredefinedSubtitleClip(
				subtitle.startTime,
				subtitle.endTime,
				canonicalizePredefinedSubtitleType(presetChoice)
			);
		}

		// Modiife le clip existant ou le remplace par le nouveau clip pré-défini
		if (newSubtitleClip) {
			if (
				newSubtitleClip instanceof ClipWithTranslation &&
				subtitle instanceof ClipWithTranslation
			) {
				newSubtitleClip.associatedImagePath = subtitle.associatedImagePath;
			}

			const clipIndex = this.clips.findIndex((clip) => clip.id === subtitle.id);
			if (clipIndex !== -1) {
				this.clips[clipIndex] = newSubtitleClip;
			}
		}
	}

	/**
	 * Ajoute un segment de transcription entre la fin de la piste et la position actuelle du curseur.
	 * @param {string} text Texte prononcé.
	 * @param {string} speaker Intervenant associé au segment.
	 * @returns {boolean} `true` lorsque le segment a été ajouté.
	 */
	addTranscript(text: string, speaker: string): boolean {
		const normalizedText = text.trim();
		const normalizedSpeaker = speaker.trim();
		if (!normalizedText) {
			toast.error(get(LL).editor.transcriptCannotBeEmpty());
			return false;
		}
		if (!normalizedSpeaker) {
			toast.error(get(LL).editor.speakerCannotBeEmpty());
			return false;
		}

		ProjectHistoryManager.begin('add transcript');
		try {
			const startTime = this.getDuration().ms + 1;
			const endTime = globalState.currentProject?.projectEditorState.timeline.cursorPosition ?? -1;
			if (endTime < startTime) {
				toast.error(get(LL).editor.endTimeMustBeGreater());
				return false;
			}

			this.clips.push(new SubtitleClip(startTime, endTime, normalizedText, normalizedSpeaker));
			return true;
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/**
	 * Met à jour le texte et l'intervenant d'un segment de transcription.
	 * @param {SubtitleClip} clip Segment à modifier.
	 * @param {string} text Nouveau texte.
	 * @param {string} speaker Nouvel intervenant.
	 * @returns {boolean} `true` lorsque le segment a été modifié.
	 */
	editTranscript(clip: SubtitleClip, text: string, speaker: string): boolean {
		const normalizedText = text.trim();
		const normalizedSpeaker = speaker.trim();
		if (!normalizedText) {
			toast.error(get(LL).editor.transcriptCannotBeEmpty());
			return false;
		}
		if (!normalizedSpeaker) {
			toast.error(get(LL).editor.speakerCannotBeEmpty());
			return false;
		}

		ProjectHistoryManager.begin('edit transcript');
		try {
			if (clip.visualMergeGroupId) this.unmergeVisualGroup(clip.visualMergeGroupId, false);
			const textChanged = clip.text !== normalizedText;
			clip.text = normalizedText;
			clip.speaker = normalizedSpeaker;
			if (textChanged) {
				clip.clearArabicInlineStyles();
				clip.alignmentMetadata = clip.alignmentMetadata
					? { ...clip.alignmentMetadata, matchedText: normalizedText, words: [] }
					: null;
				clip.wbwTimestampsManuallyEdited = false;
			}
			clip.markAsManualEdit();
			return true;
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	async splitSubtitle(clipId: number, options: SubtitleSplitOptions = {}): Promise<boolean> {
		ProjectHistoryManager.begin('split subtitle');
		try {
			const clipIndex = this.clips.findIndex((clip) => clip.id === clipId);
			if (clipIndex === -1) return false;

			const clip = this.clips[clipIndex] as SubtitleClip | PredefinedSubtitleClip | SilenceClip;
			const splitTime = globalState.getTimelineState.cursorPosition;

			if (
				!(
					clip instanceof SubtitleClip ||
					clip instanceof PredefinedSubtitleClip ||
					clip instanceof SilenceClip
				)
			) {
				return false;
			}

			// Check if the split time is within the clip
			if (splitTime <= clip.startTime || splitTime >= clip.endTime) {
				toast.error(get(LL).editor.cursorMustBeInsideSubtitle());
				return false;
			}

			// Minimum duration check (e.g. 100ms) for both parts
			if (splitTime - clip.startTime < 100 || clip.endTime - splitTime < 100) {
				toast.error(get(LL).editor.clipsTooShort());
				return false;
			}

			if (clip instanceof SubtitleClip && clip.visualMergeGroupId) {
				this.unmergeVisualGroup(clip.visualMergeGroupId, false);
			}

			if (clip instanceof SubtitleClip && !options.duplicateText) {
				const wordBoundaryCandidate = options.forceExactCursor
					? null
					: this.getNearestWordBoundarySplitCandidate(clip, splitTime);
				const exactSplitWordIndex = this.getExactCursorSplitWordIndex(clip, splitTime);

				if (wordBoundaryCandidate) {
					if (
						wordBoundaryCandidate.splitTimeMs - clip.startTime < 100 ||
						clip.endTime - wordBoundaryCandidate.splitTimeMs < 100
					) {
						toast.error(get(LL).editor.clipsTooShort());
						return false;
					}

					return await this.splitSubtitleClipWithWordBoundaries(
						clipIndex,
						clip,
						wordBoundaryCandidate.splitTimeMs,
						wordBoundaryCandidate.leftEndWordIndex
					);
				}

				if (exactSplitWordIndex !== null) {
					return await this.splitSubtitleClipWithWordBoundaries(
						clipIndex,
						clip,
						splitTime,
						exactSplitWordIndex
					);
				}
			}

			const originalEndTime = clip.endTime;

			// Update le temps de fin du premier clip
			clip.setEndTime(splitTime);

			let newClip: SubtitleClip | PredefinedSubtitleClip | SilenceClip;
			if (clip instanceof SubtitleClip) {
				// Créer le deuxième clip avec les mêmes propriétés
				newClip = clip.cloneWithTimes(splitTime, originalEndTime);
			} else if (clip instanceof PredefinedSubtitleClip) {
				const newPredefinedClip = new PredefinedSubtitleClip(
					splitTime,
					originalEndTime,
					clip.predefinedSubtitleType,
					clip.text,
					clip.comeFromIA,
					clip.confidence
				);
				const clonedTranslations: Record<string, Translation> = {};
				for (const [key, t] of Object.entries(clip.translations || {})) {
					clonedTranslations[key] = t.clone();
				}
				newPredefinedClip.translations = clonedTranslations;
				newPredefinedClip.associatedImagePath = clip.associatedImagePath;
				newClip = newPredefinedClip;
			} else {
				newClip = new SilenceClip(splitTime, originalEndTime);
			}

			// Insérer le nouveau clip après le clip original
			if (clip instanceof SubtitleClip || clip instanceof PredefinedSubtitleClip) {
				clip.markAsManualEdit();
			}
			if (newClip instanceof SubtitleClip || newClip instanceof PredefinedSubtitleClip) {
				newClip.markAsManualEdit();
			}

			this.clips.splice(clipIndex + 1, 0, newClip);

			return true;
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/**
	 * Retourne la sourate actuellement lue à la position du curseur (pour l'affiche du nom de la
	 * sourate sur la vidéo)
	 */
	getCurrentSurah(time?: number): number {
		const cursorPos = time !== undefined ? time : globalState.getTimelineState.cursorPosition;

		return resolveCurrentSurahFromClips(this.clips, cursorPos);
	}

	/**
	 * Ajoute un clip de silence à la piste.
	 * @param beforeClipOfId Si spécifié, ajoute le silence avant le clip avec cet ID.
	 * @returns true si le silence a été ajouté, false sinon.
	 */
	addSilence(beforeClipOfId: number = -1): boolean {
		ProjectHistoryManager.begin('add silence');
		try {
			if (beforeClipOfId === -1) {
				const startTime = this.getDuration().ms + 1;
				const endTime =
					globalState.currentProject?.projectEditorState.timeline.cursorPosition || -1;

				if (endTime < startTime) {
					toast.error(get(LL).editor.endTimeMustBeGreater());
					return false;
				}

				this.clips.push(new SilenceClip(startTime, endTime));

				return true;
			} else {
				// Trouve le clip avant lequel ajouter le silence
				for (let i = 0; i < this.clips.length; i++) {
					const element = this.clips[i];

					if (element.id === beforeClipOfId) {
						const previousClip = i > 0 ? this.clips[i - 1] : null;

						if (previousClip) {
							const startTime = previousClip.endTime + 1;
							const endTime = startTime + 500; // Durée de 500ms par défaut

							// Vérifie si le clip actuel fera moins de 100ms
							if (element.endTime - (endTime + 1) < 100) {
								toast.error(get(LL).editor.cannotAddSilenceTooShort());
								return false;
							}

							// Insert le clip silence avant le clip spécifié
							this.clips.splice(i, 0, new SilenceClip(startTime, endTime));

							// Change le startTime du clip spécifié pour éviter les chevauchements
							element.setStartTime(endTime + 1);
							return true;
						} else {
							// Ajoute le silence au début de la piste
							const startTime = 0;
							const endTime = 500; // Durée de 500ms par défaut
							if (element.endTime - (endTime + 1) < 100) {
								toast.error(get(LL).editor.cannotAddSilenceTooShort());
								return false;
							}
							this.clips.unshift(new SilenceClip(startTime, endTime));
							// Change le startTime du clip spécifié pour éviter les chevauchements
							element.setStartTime(endTime + 1);
							return true;
						}
					}
				}
			}

			return false;
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	addPredefinedSubtitle(type: PredefinedSubtitleType): boolean {
		ProjectHistoryManager.begin('add predefined subtitle');
		try {
			const startTime = this.getDuration().ms + 1;
			const endTime = globalState.currentProject?.projectEditorState.timeline.cursorPosition || -1;

			if (endTime < startTime) {
				toast.error(get(LL).editor.endTimeMustBeGreater());
				return false;
			}

			this.clips.push(new PredefinedSubtitleClip(startTime, endTime, type));

			return true;
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/**
	 * Renvoie le clip de sous-titre avant l'index spécifié.
	 * @param i L'index du clip pour lequel on veut trouver le clip de sous-titre précédent.
	 * @returns Le clip de sous-titre précédent ou null s'il n'existe pas.
	 */
	getSubtitleBefore(i: number, allowPredefined: boolean = false): SubtitleClip | null {
		if (i <= 0) {
			return null;
		}

		do {
			i--;
		} while (
			i >= 0 &&
			!(
				this.clips[i] instanceof SubtitleClip ||
				(allowPredefined && this.clips[i] instanceof PredefinedSubtitleClip)
			)
		);

		return this.clips[i] as SubtitleClip | null;
	}

	/**
	 * Renvoie le clip de sous-titre après l'index spécifié.
	 * @param i L'index du clip pour lequel on veut trouver le clip de sous-titre suivant.
	 * @returns Le clip de sous-titre suivant ou null s'il n'existe pas.
	 */
	getSubtitleAfter(i: number, allowPredefined: boolean = false): SubtitleClip | null {
		if (i < 0 || i >= this.clips.length - 1) {
			return null;
		}

		do {
			i++;
		} while (
			i < this.clips.length &&
			!(
				this.clips[i] instanceof SubtitleClip ||
				(allowPredefined && this.clips[i] instanceof PredefinedSubtitleClip)
			)
		);

		return this.clips[i] as SubtitleClip | null;
	}

	getCurrentSubtitleToDisplay(
		anyType: boolean = false
	): SubtitleClip | PredefinedSubtitleClip | null | Clip {
		const cursorPos = globalState.getTimelineState.cursorPosition;
		const clip = this.getCurrentClip(cursorPos);

		if (
			clip &&
			(anyType || clip instanceof SubtitleClip || clip instanceof PredefinedSubtitleClip)
		) {
			return clip;
		}

		return null;
	}

	/**
	 * Décale les sous-titres de la piste d'un certain temps. Si `fromMs` est
	 * fourni, seuls les clips dont `startTime >= fromMs` sont décalés ; les
	 * autres restent à leur position. Si `fromMs` vaut 0 (par défaut), tous
	 * les clips sont décalés (comportement historique).
	 * @param offsetMs Le décalage en millisecondes (positif ou négatif).
	 * @param fromMs Optionnel — point de coupure. Seuls les clips démarrant
	 *               à `fromMs` ou après sont décalés.
	 * @returns true si le décalage a été appliqué, false sinon (ex: temps négatif,
	 *          chevauchement avec la zone non-décalée).
	 */
	shiftAllClips(offsetMs: number, fromMs: number = 0): boolean {
		ProjectHistoryManager.begin('shift subtitles');
		try {
			if (!Number.isFinite(offsetMs) || !Number.isFinite(fromMs)) {
				toast.error(get(LL).editor.cannotShiftInvalidTiming());
				return false;
			}

			if (this.clips.length === 0) return true;

			const cutoffMs = Math.max(0, fromMs);
			const targets = this.clips.filter((clip) => clip.startTime >= cutoffMs);
			if (targets.length === 0) {
				toast(get(LL).editor.noSubtitlesToShift(), { icon: 'ℹ️' });
				return true;
			}

			// Vérification : est-ce que le décalage rendrait un temps négatif ?
			for (const clip of targets) {
				if (clip.startTime + offsetMs < 0) {
					toast.error(get(LL).editor.cannotShiftBeforeZero());
					return false;
				}
			}

			// Vérification : décalage arrière qui chevaucherait la zone non-décalée.
			// On autorise ce cas si le clip bloquant juste avant la coupure peut être
			// raccourci, ou supprimé s'il s'agit d'un silence.
			if (offsetMs < 0 && targets.length < this.clips.length) {
				let lastNonShiftedClip: Clip | null = null;
				let firstShiftedStart = Number.POSITIVE_INFINITY;

				for (const clip of this.clips) {
					if (clip.startTime >= cutoffMs) {
						firstShiftedStart = Math.min(firstShiftedStart, clip.startTime + offsetMs);
					} else {
						if (!lastNonShiftedClip || clip.endTime > lastNonShiftedClip.endTime) {
							lastNonShiftedClip = clip;
						}
					}
				}

				if (lastNonShiftedClip && firstShiftedStart <= lastNonShiftedClip.endTime) {
					if (lastNonShiftedClip instanceof SilenceClip) {
						this.clips.splice(this.clips.indexOf(lastNonShiftedClip), 1);
					} else {
						const newBlockingEndTime = firstShiftedStart - 1;
						const newBlockingDuration = newBlockingEndTime - lastNonShiftedClip.startTime;

						if (newBlockingDuration < 100) {
							toast.error(get(LL).editor.cannotShiftBackward());
							return false;
						}

						lastNonShiftedClip.setEndTime(newBlockingEndTime);
					}
				}
			}

			// Applique le décalage. Les clips ciblés bougent tous ensemble, donc
			// les chevauchements internes ne changent pas. clip.startTime/endTime
			// sont des $state, donc réactifs.
			for (const clip of targets) {
				clip.startTime += offsetMs;
				clip.endTime += offsetMs;
			}

			return true;
		} finally {
			ProjectHistoryManager.commit();
		}
	}
}

export class CustomTextTrack extends Track {
	constructor() {
		super(TrackType.CustomClip);
	}

	async addCustomClip(
		customClipCategory: Category,
		clipType: 'text' | 'image',
		startTime?: number,
		endTime?: number
	) {
		ProjectHistoryManager.begin('add custom clip');
		try {
			// Si des durées sont spécifiées, alors on désactive l'option "always show"
			if (startTime !== undefined && endTime !== undefined) {
				customClipCategory.getStyle('always-show')!.value = false;
				const rangesStyle = customClipCategory.getStyle('time-ranges');
				if (rangesStyle) rangesStyle.value = [{ startTime, endTime }];
				customClipCategory.getStyle('time-appearance')!.value = startTime;
				customClipCategory.getStyle('time-disappearance')!.value = endTime;
			}

			let clip: CustomImageClip | CustomTextClip;
			if (clipType === 'image') {
				// Ajoute un clip image

				// Ouvre la modale de sélection d'image
				let imagePath = '';

				const result = await open({
					multiple: false,
					directory: false,
					filters: [
						{
							name: 'Image Files',
							extensions: ['png', 'jpg', 'jpeg', 'gif']
						}
					]
				});

				if (result) {
					imagePath = result as string;
					customClipCategory.getStyle('filepath')!.value = imagePath;
				} else {
					return; // Annule l'ajout du clip si aucun fichier n'est sélectionné
				}

				clip = new CustomImageClip(customClipCategory);
			} else {
				clip = new CustomTextClip(customClipCategory);
			}

			// Set les temps si spécifiés
			if (startTime !== undefined && endTime !== undefined) {
				clip.startTime = startTime;
				clip.endTime = endTime;
			}

			this.clips.push(clip);

			// Trigger la réactivité dans la videopreview pour afficher le clip ajouté (si le curseur est dessus)
			globalState.updateVideoPreviewUI();
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	getCurrentClips(): CustomClip[] {
		// Retourne tout les clips à afficher
		const currentTime = globalState.currentProject?.projectEditorState.timeline.cursorPosition ?? 0;
		const clips: CustomClip[] = [];

		for (let index = 0; index < this.clips.length; index++) {
			const element = this.clips[index] as CustomClip;
			if (
				element.getAlwaysShow() ||
				element
					.getTimedOverlayRanges()
					.some((range) => currentTime >= range.startTime && currentTime <= range.endTime)
			) {
				clips.push(element);
			}
		}

		return clips;
	}

	getCustomTextWithId(categoryId: string) {
		return this.clips.find(
			(clip) => clip instanceof CustomTextClip && clip.category!.id === categoryId
		) as CustomTextClip | undefined;
	}

	getCustomClipWithId(categoryId: string) {
		return this.clips.find(
			(clip) => clip instanceof CustomClip && clip.category?.id === categoryId
		) as CustomClip | undefined;
	}
}

// Enregistre les classes enfants pour la désérialisation automatique
SerializableBase.registerChildClass(Track, 'clips', Clip);
