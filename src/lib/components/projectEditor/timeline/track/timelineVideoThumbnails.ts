import { invoke } from '@tauri-apps/api/core';

const TIMELINE_THUMBNAIL_WIDTH_PX = 120;
const TIMELINE_THUMBNAIL_OUTPUT_WIDTH = 160;
const TIMELINE_THUMBNAIL_OUTPUT_HEIGHT = 72;
const MAX_VISIBLE_TIMELINE_THUMBNAILS = 32;
const MAX_MEMORY_CACHE_ENTRIES = 512;

type TimelineVideoThumbnailResponse = {
	timestampMs: number;
	path: string;
};

export type TimelineVideoThumbnailSlot = {
	key: string;
	timestampMs: number;
	leftPx: number;
	widthPx: number;
};

export type TimelineVideoThumbnailOptions = {
	clipStartMs: number;
	clipEndMs: number;
	sourceStartMs: number;
	sourceDurationMs: number;
	viewportStartMs: number;
	viewportEndMs: number;
	zoom: number;
	loop: boolean;
};

const thumbnailPathCache = new Map<string, string>();
const pendingThumbnailPaths = new Map<string, Promise<string | null>>();

/**
 * Retourne un intervalle 1/2/5 stable afin qu'un léger scroll ne change pas les timestamps.
 * @param {number} minimumIntervalMs Intervalle minimal demandé en millisecondes.
 * @returns {number} Intervalle arrondi vers le palier supérieur.
 */
function getStableThumbnailIntervalMs(minimumIntervalMs: number): number {
	const safeInterval = Math.max(1, minimumIntervalMs);
	const magnitude = 10 ** Math.floor(Math.log10(safeInterval));
	const normalized = safeInterval / magnitude;
	const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
	return factor * magnitude;
}

/**
 * Construit les emplacements de miniatures qui croisent réellement le viewport de la timeline.
 * @param {TimelineVideoThumbnailOptions} options Timings du clip, de la source et du viewport.
 * @returns {TimelineVideoThumbnailSlot[]} Emplacements visibles, limités à 32 éléments.
 */
export function getVisibleTimelineVideoThumbnailSlots(
	options: TimelineVideoThumbnailOptions
): TimelineVideoThumbnailSlot[] {
	const visibleStartMs = Math.max(options.clipStartMs, options.viewportStartMs);
	const visibleEndMs = Math.min(options.clipEndMs, options.viewportEndMs);
	if (visibleEndMs <= visibleStartMs || options.sourceDurationMs <= 0) return [];

	const zoom = Math.max(options.zoom, 0.0001);
	const intervalMs = getStableThumbnailIntervalMs((TIMELINE_THUMBNAIL_WIDTH_PX / zoom) * 1000);
	const firstIndex = Math.max(0, Math.floor((visibleStartMs - options.clipStartMs) / intervalMs));
	const lastIndex = Math.min(
		Math.ceil((visibleEndMs - options.clipStartMs) / intervalMs) - 1,
		firstIndex + MAX_VISIBLE_TIMELINE_THUMBNAILS - 1
	);
	const slots: TimelineVideoThumbnailSlot[] = [];

	for (let index = firstIndex; index <= lastIndex; index++) {
		const cellStartMs = options.clipStartMs + index * intervalMs;
		if (cellStartMs >= options.clipEndMs) break;
		const cellDurationMs = Math.min(intervalMs, options.clipEndMs - cellStartMs);
		const timelineSampleMs = cellStartMs + cellDurationMs / 2;
		let sourceTimeMs = options.sourceStartMs + timelineSampleMs - options.clipStartMs;
		if (options.loop) {
			sourceTimeMs =
				((sourceTimeMs % options.sourceDurationMs) + options.sourceDurationMs) %
				options.sourceDurationMs;
		} else {
			sourceTimeMs = Math.min(options.sourceDurationMs - 1, Math.max(0, sourceTimeMs));
		}
		const timestampMs = Math.round(sourceTimeMs);
		slots.push({
			key: `${index}-${timestampMs}`,
			timestampMs,
			leftPx: ((cellStartMs - options.clipStartMs) / 1000) * zoom,
			widthPx: Math.max(1, (cellDurationMs / 1000) * zoom + 1)
		});
	}

	return slots;
}

/**
 * Construit la clé du cache mémoire pour une frame vidéo précise.
 * @param {string} filePath Chemin de la vidéo source.
 * @param {number} mediaReloadToken Version runtime de l'asset.
 * @param {number} timestampMs Position source en millisecondes.
 * @returns {string} Clé stable du cache mémoire.
 */
function getThumbnailMemoryKey(
	filePath: string,
	mediaReloadToken: number,
	timestampMs: number
): string {
	return `${filePath}\0${mediaReloadToken}\0${timestampMs}`;
}

/**
 * Charge les chemins locaux des miniatures et déduplique les requêtes concurrentes.
 * @param {string} filePath Chemin de la vidéo source.
 * @param {number[]} timestampsMs Positions sources visibles.
 * @param {number} mediaReloadToken Version runtime de l'asset.
 * @returns {Promise<Map<number, string>>} Chemins de cache indexés par timestamp.
 */
export async function loadTimelineVideoThumbnailPaths(
	filePath: string,
	timestampsMs: number[],
	mediaReloadToken: number
): Promise<Map<number, string>> {
	const uniqueTimestamps = [...new Set(timestampsMs)].slice(0, MAX_VISIBLE_TIMELINE_THUMBNAILS);
	const missingTimestamps = uniqueTimestamps.filter((timestampMs) => {
		const key = getThumbnailMemoryKey(filePath, mediaReloadToken, timestampMs);
		return !thumbnailPathCache.has(key) && !pendingThumbnailPaths.has(key);
	});

	if (missingTimestamps.length > 0) {
		const batch = invoke<TimelineVideoThumbnailResponse[]>('get_video_timeline_thumbnails', {
			filePath,
			timestampsMs: missingTimestamps,
			width: TIMELINE_THUMBNAIL_OUTPUT_WIDTH,
			height: TIMELINE_THUMBNAIL_OUTPUT_HEIGHT
		});
		for (const timestampMs of missingTimestamps) {
			const key = getThumbnailMemoryKey(filePath, mediaReloadToken, timestampMs);
			const pending = batch
				.then((thumbnails) => {
					const path = thumbnails.find((thumbnail) => thumbnail.timestampMs === timestampMs)?.path;
					if (!path) return null;
					if (thumbnailPathCache.size >= MAX_MEMORY_CACHE_ENTRIES) {
						const oldestKey = thumbnailPathCache.keys().next().value;
						if (oldestKey !== undefined) thumbnailPathCache.delete(oldestKey);
					}
					thumbnailPathCache.set(key, path);
					return path;
				})
				.finally(() => pendingThumbnailPaths.delete(key));
			pendingThumbnailPaths.set(key, pending);
		}
	}

	const paths = new Map<number, string>();
	await Promise.all(
		uniqueTimestamps.map(async (timestampMs) => {
			const key = getThumbnailMemoryKey(filePath, mediaReloadToken, timestampMs);
			const path = thumbnailPathCache.get(key) ?? (await pendingThumbnailPaths.get(key));
			if (path) paths.set(timestampMs, path);
		})
	);
	return paths;
}
