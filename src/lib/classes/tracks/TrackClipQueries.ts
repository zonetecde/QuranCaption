import type { Clip } from '../Clip.svelte.js';

type ClipOwner = { clips: Clip[] };

export type TrackRangeQuery = {
	startMs: number;
	endMs: number;
	isBackgroundImageClip: (clip: Clip | undefined) => boolean;
	useVisualTiming: boolean;
	getVisualStartTime: (clipIndex: number) => number;
	getVisualEndTime: (clipIndex: number) => number;
};

const clipIndexCache = new WeakMap<ClipOwner, Map<number, number>>();

/** Centralise les recherches sans mutation dans les collections de clips. */
export class TrackClipQueries {
	/**
	 * Retourne l'index d'un clip par identifiant avec un cache faible non sérialisé.
	 * @param {ClipOwner} owner Objet qui possède la collection de clips.
	 * @param {number} clipId Identifiant recherché.
	 * @returns {number} Index du clip, ou `-1`.
	 */
	static getClipIndexById(owner: ClipOwner, clipId: number): number {
		let cache = clipIndexCache.get(owner);
		if (!cache) {
			cache = new Map();
			clipIndexCache.set(owner, cache);
		}
		const cachedIndex = cache.get(clipId);
		if (cachedIndex !== undefined && owner.clips[cachedIndex]?.id === clipId) return cachedIndex;
		const index = owner.clips.findIndex((clip) => clip.id === clipId);
		if (index === -1) cache.delete(clipId);
		else cache.set(clipId, index);
		return index;
	}

	/**
	 * Retourne l'index du clip actif à un temps donné.
	 * @param {Clip[]} clips Clips de la piste.
	 * @param {number} timeMs Temps courant en millisecondes.
	 * @returns {number} Index du clip actif, ou `-1`.
	 */
	static findClipIndexAtTime(clips: Clip[], timeMs: number): number {
		if (!this.areSortedByStartTime(clips)) {
			return clips.findIndex((clip) => timeMs >= clip.startTime && timeMs <= clip.endTime);
		}
		let low = 0;
		let high = clips.length - 1;
		let candidate = -1;
		while (low <= high) {
			const middle = Math.floor((low + high) / 2);
			if (clips[middle].startTime <= timeMs) {
				candidate = middle;
				low = middle + 1;
			} else {
				high = middle - 1;
			}
		}
		return candidate !== -1 && timeMs <= clips[candidate].endTime ? candidate : -1;
	}

	/**
	 * Retourne les clips qui chevauchent une plage de timeline.
	 * @param {Clip[]} clips Clips de la piste.
	 * @param {TrackRangeQuery} query Règles temporelles de la recherche.
	 * @returns {Array<{ clip: Clip; clipIndex: number }>} Clips visibles avec leur index.
	 */
	static getClipsInRange(
		clips: Clip[],
		query: TrackRangeQuery
	): Array<{ clip: Clip; clipIndex: number }> {
		if (!Number.isFinite(query.startMs) || !Number.isFinite(query.endMs)) {
			return clips.map((clip, clipIndex) => ({ clip, clipIndex }));
		}
		if (!this.areSortedByStartTime(clips)) {
			return clips
				.map((clip, clipIndex) => ({ clip, clipIndex }))
				.filter(
					({ clip }) =>
						query.isBackgroundImageClip(clip) ||
						(clip.endTime >= query.startMs && clip.startTime <= query.endMs)
				);
		}
		if (query.useVisualTiming) {
			return clips
				.map((clip, clipIndex) => ({ clip, clipIndex }))
				.filter(
					({ clip, clipIndex }) =>
						query.isBackgroundImageClip(clip) ||
						(query.getVisualEndTime(clipIndex) >= query.startMs &&
							query.getVisualStartTime(clipIndex) <= query.endMs)
				);
		}

		const visible = query.isBackgroundImageClip(clips[0]) ? [{ clip: clips[0], clipIndex: 0 }] : [];
		const startIndex = this.findFirstVisibleClipIndex(clips, query.startMs);
		for (let clipIndex = startIndex; clipIndex < clips.length; clipIndex++) {
			const clip = clips[clipIndex];
			if (clip.startTime > query.endMs) break;
			if (clip.endTime >= query.startMs && !query.isBackgroundImageClip(clip)) {
				visible.push({ clip, clipIndex });
			}
		}
		return visible;
	}

	/**
	 * Indique si les clips sont triés par temps de début croissant.
	 * @param {Clip[]} clips Clips à vérifier.
	 * @returns {boolean} `true` lorsque la recherche binaire est sûre.
	 */
	private static areSortedByStartTime(clips: Clip[]): boolean {
		return clips.every(
			(clip, index) => index === 0 || clip.startTime >= clips[index - 1].startTime
		);
	}

	/**
	 * Retourne le premier index susceptible de chevaucher la plage visible.
	 * @param {Clip[]} clips Clips triés par début.
	 * @param {number} rangeStartMs Début de la plage.
	 * @returns {number} Premier index potentiel.
	 */
	private static findFirstVisibleClipIndex(clips: Clip[], rangeStartMs: number): number {
		let low = 0;
		let high = clips.length - 1;
		let result = clips.length;
		while (low <= high) {
			const middle = Math.floor((low + high) / 2);
			if (clips[middle].endTime >= rangeStartMs) {
				result = middle;
				high = middle - 1;
			} else {
				low = middle + 1;
			}
		}
		return result;
	}
}
