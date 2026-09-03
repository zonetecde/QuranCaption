import { AssetType, TrackType } from '../enums.js';
import { AssetClip, Clip } from '../Clip.svelte.js';
import { SerializableBase } from '../misc/SerializableBase.js';
import { Duration } from '../Duration.js';
import { globalState } from '$lib/runes/main.svelte.js';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import toast from 'svelte-5-french-toast';
import LL from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';
import { TrackClipQueries } from './TrackClipQueries.js';
import { VideoTrackTiming } from './VideoTrackTiming.js';

/**
 * Retourne l'index d'un clip par identifiant.
 * @param {Track} track Piste contenant le clip.
 * @param {number} clipId Identifiant recherché.
 * @returns {number} Index du clip, ou `-1`.
 */
export function getClipIndexById(track: Track, clipId: number): number {
	return TrackClipQueries.getClipIndexById(track, clipId);
}

/** Représente une piste générique et orchestre ses mutations. */
export class Track extends SerializableBase {
	type: TrackType = $state(TrackType.Unknown);
	clips: Clip[] = $state([]);

	/**
	 * Initialise une piste vide du type demandé.
	 * @param {TrackType} type Type fonctionnel de la piste.
	 */
	constructor(type: TrackType) {
		super();
		this.type = type;
		this.clips = [];
	}

	/**
	 * Supprime un clip de la piste.
	 * @param {number} id L'ID du clip à supprimer.
	 * @param {boolean} makeNextClipStartAtThisClipStartTime Fait reprendre le clip suivant au même début.
	 * @returns {void}
	 */
	removeClip(id: number, makeNextClipStartAtThisClipStartTime: boolean = false): void {
		ProjectHistoryManager.begin('remove clip');
		try {
			const index = this.clips.findIndex((clip) => clip.id === id);
			if (index !== -1) {
				const removedStartTime = this.clips[index].startTime;
				this.clips.splice(index, 1);
				if (this.type === TrackType.Audio) {
					globalState.updateVideoPreviewUI();
					return;
				}
				if (!makeNextClipStartAtThisClipStartTime) {
					for (let clipIndex = index; clipIndex < this.clips.length; clipIndex++) {
						const clip = this.clips[clipIndex];
						clip.startTime = clipIndex === 0 ? 0 : this.clips[clipIndex - 1].endTime + 1;
						clip.endTime = clip.startTime + clip.duration;
					}
				} else {
					this.clips[index]?.setStartTime(removedStartTime);
				}
			}
			globalState.updateVideoPreviewUI();
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/** Supprime le dernier clip dans une transaction d'historique. @returns {void} */
	removeLastClip(): void {
		ProjectHistoryManager.begin('remove last clip');
		try {
			if (this.clips.length) this.clips.pop();
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/** Retourne un clip par identifiant. @param {number} clipId Identifiant recherché. @returns {Clip} Clip correspondant. */
	getClipById(clipId: number): Clip {
		return this.clips[getClipIndexById(this, clipId)]!;
	}

	/** Retourne le nom technique de la piste. @returns {string} Nom de la piste. */
	getName(): string {
		if (this.type === TrackType.Video) return 'Video';
		if (this.type === TrackType.Audio) return 'Audio';
		if (this.type === TrackType.Subtitle) return 'Subtitles';
		if (this.type === TrackType.CustomClip) return 'Custom Clips';
		return 'Unknown Track';
	}

	/** Retourne l'icône Material de la piste. @returns {string} Nom de l'icône. */
	getIcon(): string {
		if (this.type === TrackType.Video) return 'movie';
		if (this.type === TrackType.Audio) return 'music_note';
		if (this.type === TrackType.Subtitle) return 'subtitles';
		if (this.type === TrackType.CustomClip) return 'text_fields';
		return 'help_outline';
	}

	/** Retourne le type de ressource accepté. @returns {AssetType} Type accepté. */
	getAcceptableAssetType(): AssetType {
		if (this.type === TrackType.Video) return AssetType.Video;
		if (this.type === TrackType.Audio) return AssetType.Audio;
		return AssetType.Unknown;
	}

	/** Retourne le zoom courant de la timeline. @returns {number} Pixels par seconde. */
	getPixelPerSecond(): number {
		return globalState.currentProject?.projectEditorState.timeline.zoom ?? 1;
	}

	/** Calcule la durée totale de la piste. @returns {Duration} Durée de la piste. */
	getDuration(): Duration {
		return new Duration(
			this.clips.length ? Math.max(...this.clips.map((clip) => clip.endTime)) : 0
		);
	}

	/**
	 * Retourne le clip actif à une position.
	 * @param {number} [cursorPos] Position en millisecondes.
	 * @returns {Clip | null} Clip actif ou `null`.
	 */
	getCurrentClip(cursorPos?: number): Clip | null {
		const time =
			cursorPos ?? globalState.currentProject?.projectEditorState.timeline.cursorPosition ?? 0;
		if (this.type === TrackType.Audio) return this.getCurrentClips(time)[0] ?? null;
		const index = TrackClipQueries.findClipIndexAtTime(this.clips, time);
		return index === -1 ? null : this.clips[index];
	}

	/**
	 * Retourne tous les clips actifs à une position.
	 * @param {number} [cursorPos] Position en millisecondes.
	 * @returns {Clip[]} Clips actifs triés.
	 */
	getCurrentClips(cursorPos?: number): Clip[] {
		const time =
			cursorPos ?? globalState.currentProject?.projectEditorState.timeline.cursorPosition ?? 0;
		return this.clips
			.filter((clip) => time >= clip.startTime && time <= clip.endTime)
			.sort((left, right) => left.startTime - right.startTime);
	}

	/**
	 * Retourne le clip actif selon le timing visuel des crossfades.
	 * @param {number} [cursorPos] Position en millisecondes.
	 * @returns {Clip | null} Clip visuel actif ou `null`.
	 */
	getCurrentVisualClip(cursorPos?: number): Clip | null {
		const time =
			cursorPos ?? globalState.currentProject?.projectEditorState.timeline.cursorPosition ?? 0;
		if (!this.shouldUseVideoCrossfadeVisualTiming()) return this.getCurrentClip(time);
		for (let index = this.clips.length - 1; index >= 0; index--) {
			if (time >= this.getVisualClipStartTime(index) && time <= this.getVisualClipEndTime(index)) {
				return this.clips[index];
			}
		}
		return null;
	}

	/** Retourne le début visuel d'un clip. @param {number} clipIndex Index du clip. @returns {number} Début en millisecondes. */
	getVisualClipStartTime(clipIndex: number): number {
		const clip = this.clips[clipIndex];
		if (!clip) return 0;
		return this.hasExplicitVideoClipTiming()
			? clip.startTime
			: clip.startTime - this.getVideoCrossfadeOffsetBeforeClip(clipIndex);
	}

	/** Retourne la fin visuelle d'un clip. @param {number} clipIndex Index du clip. @returns {number} Fin en millisecondes. */
	getVisualClipEndTime(clipIndex: number): number {
		return this.clips[clipIndex]
			? this.getVisualClipStartTime(clipIndex) + this.clips[clipIndex].duration
			: 0;
	}

	/** Retourne le décalage cumulé avant un clip. @param {number} clipIndex Index du clip. @returns {number} Décalage en millisecondes. */
	getVideoCrossfadeOffsetBeforeClip(clipIndex: number): number {
		return VideoTrackTiming.getCrossfadeOffsetBeforeClip(
			this.clips,
			clipIndex,
			this.shouldUseVideoCrossfadeVisualTiming(),
			this.hasExplicitVideoClipTiming(),
			this.getVideoCrossfadeDurationMs()
		);
	}

	/** Indique si les timings vidéo sont explicites. @returns {boolean} Résultat du contrôle. */
	hasExplicitVideoClipTiming(): boolean {
		return VideoTrackTiming.hasExplicitTiming(this.clips, this.type);
	}

	/** Retourne le crossfade précédant un clip. @param {number} clipIndex Index du clip. @returns {number} Durée en millisecondes. */
	getVideoCrossfadeDurationBeforeClip(clipIndex: number): number {
		return VideoTrackTiming.getCrossfadeDurationBeforeClip(
			this.clips,
			clipIndex,
			this.hasExplicitVideoClipTiming(),
			this.getVideoCrossfadeDurationMs()
		);
	}

	/** Indique si le timing visuel du crossfade est actif. @returns {boolean} Résultat du contrôle. */
	shouldUseVideoCrossfadeVisualTiming(): boolean {
		return VideoTrackTiming.shouldUseCrossfade(
			this.clips,
			this.type,
			String(globalState.getStyle('global', 'video-clip-transition')?.value ?? 'none'),
			this.getVideoCrossfadeDurationMs()
		);
	}

	/** Retourne le clip précédent. @param {number} id Identifiant de référence. @returns {Clip | null} Clip précédent. */
	getClipBefore(id: number): Clip | null {
		const index = getClipIndexById(this, id);
		return index > 0 ? this.clips[index - 1] : null;
	}

	/** Retourne le clip suivant. @param {number} id Identifiant de référence. @returns {Clip | null} Clip suivant. */
	getClipAfter(id: number): Clip | null {
		const index = getClipIndexById(this, id);
		return index !== -1 && index < this.clips.length - 1 ? this.clips[index + 1] : null;
	}

	/** Retourne le dernier clip. @returns {Clip | null} Dernier clip ou `null`. */
	getLastClip(): Clip | null {
		return this.clips[this.clips.length - 1] || null;
	}

	/**
	 * Retourne les clips qui chevauchent une plage.
	 * @param {number} startMs Début de plage.
	 * @param {number} endMs Fin de plage.
	 * @returns {Array<{ clip: Clip; clipIndex: number }>} Clips visibles avec leur index.
	 */
	getClipsInRange(startMs: number, endMs: number): Array<{ clip: Clip; clipIndex: number }> {
		return TrackClipQueries.getClipsInRange(this.clips, {
			startMs,
			endMs,
			isBackgroundImageClip: this.isBackgroundImageClip.bind(this),
			useVisualTiming: this.shouldUseVideoCrossfadeVisualTiming(),
			getVisualStartTime: this.getVisualClipStartTime.bind(this),
			getVisualEndTime: this.getVisualClipEndTime.bind(this)
		});
	}

	/** Coupe un clip multimédia au curseur. @param {number} clipId Identifiant du clip. @returns {boolean} `true` si coupé. */
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
			newClip.sourceStartTime = originalSourceStartTime + splitTime - originalStartTime;
			newClip.showWaveform = clip.showWaveform;
			newClip.volumePercent = clip.volumePercent;
			this.clips.splice(clipIndex + 1, 0, newClip);
			return true;
		} finally {
			ProjectHistoryManager.commit();
		}
	}

	/** Retourne la durée configurée du crossfade. @returns {number} Durée en millisecondes. */
	private getVideoCrossfadeDurationMs(): number {
		return Math.max(
			0,
			Number(globalState.getStyle('global', 'video-clip-transition-duration')?.value ?? 0)
		);
	}

	/** Indique si le clip est l'image de fond globale. @param {Clip | undefined} clip Clip à tester. @returns {boolean} Résultat du contrôle. */
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
