import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/api/path', () => ({ basename: vi.fn(), join: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ exists: vi.fn(), remove: vi.fn() }));

import {
	Asset,
	AssetType,
	Batch,
	createDefaultBatchSegmentationState,
	createDefaultBatchExportState,
	createDefaultBatchStyleState,
	Duration,
	TrackType,
	type BatchProjectItem,
	type Project
} from '$lib/classes';
import { AssetTrack } from '$lib/classes/Track.svelte';
import { DEFAULT_IMAGE_CLIP_DURATION_MS } from '$lib/classes/tracks/AssetTrack.svelte';
import ModalManager from '$lib/components/modals/ModalManager';
import { globalState } from '$lib/runes/main.svelte';
import {
	BatchMediaService,
	getBatchDownloadType,
	getLocalBatchMediaType,
	isBatchMediaModeCompatible
} from '$lib/services/BatchMediaService';

interface Deferred<T> {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (reason: Error) => void;
}

/**
 * Crée une promesse contrôlée sans temporisation arbitraire.
 * @returns {Deferred<T>} Promesse et contrôleurs associés.
 */
function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});
	return { promise, resolve, reject };
}

/**
 * Construit une ligne batch minimale pour le pool de workers.
 * @param {number} order Ordre et identifiant de test.
 * @returns {BatchProjectItem} Ligne en attente.
 */
function createItem(order: number): BatchProjectItem {
	return {
		order,
		projectId: order,
		projectName: `Project ${order}`,
		reciter: 'Reciter',
		source: { kind: 'url', value: `https://example.com/${order}` },
		media: {
			status: 'pending',
			progress: 0,
			error: null,
			resolvedAssetPath: null,
			mode: null,
			assetId: null
		},
		segmentation: createDefaultBatchSegmentationState(),
		translations: {},
		style: createDefaultBatchStyleState(),
		export: createDefaultBatchExportState()
	};
}

describe('BatchMediaService worker pool', () => {
	it('starts the fourth item as soon as one of the first three workers is free', async () => {
		const items = [1, 2, 3, 4, 5].map(createItem);
		const controls = new Map(
			items.map((item) => [
				item.projectId,
				deferred<{ resolvedAssetPath: string; assetId: number }>()
			])
		);
		const starts: number[] = [];
		let active = 0;
		let maxActive = 0;
		const firstThreeStarted = deferred<void>();
		const fourthStarted = deferred<void>();
		const savedStates: string[][] = [];
		const service = new BatchMediaService({
			processItem: async (_batch, item) => {
				starts.push(item.projectId);
				active++;
				maxActive = Math.max(maxActive, active);
				if (starts.length === 3) firstThreeStarted.resolve();
				if (starts.length === 4) fourthStarted.resolve();
				try {
					return await controls.get(item.projectId)!.promise;
				} finally {
					active--;
				}
			},
			saveBatch: async (batch) => {
				savedStates.push(batch.projects.map((item) => item.media.status));
			}
		});
		const run = service.run(new Batch('Batch', items), items, 'audio_only');

		await firstThreeStarted.promise;
		expect(starts).toEqual([1, 2, 3]);
		expect(maxActive).toBe(3);

		controls.get(2)!.reject(new Error('Project 2 failed'));
		await fourthStarted.promise;
		expect(starts).toEqual([1, 2, 3, 4]);

		controls.get(1)!.resolve({ resolvedAssetPath: '/1.mp3', assetId: 1 });
		controls.get(3)!.resolve({ resolvedAssetPath: '/3.mp3', assetId: 3 });
		controls.get(4)!.resolve({ resolvedAssetPath: '/4.mp3', assetId: 4 });
		controls.get(5)!.resolve({ resolvedAssetPath: '/5.mp3', assetId: 5 });
		await run;

		expect(maxActive).toBe(3);
		expect(items.map((item) => item.media.status)).toEqual([
			'completed',
			'failed',
			'completed',
			'completed',
			'completed'
		]);
		expect(items[1].media.error).toBe('Project 2 failed');
		expect(savedStates.at(-1)).toEqual(items.map((item) => item.media.status));
	});
});

describe('Batch media modes', () => {
	it('asks whether the first image should cover the full video', async () => {
		const previousProject = globalState.currentProject;
		const addAsset = vi.fn(() => true);
		const confirm = vi.spyOn(ModalManager, 'confirmModal').mockResolvedValue(false);
		globalState.currentProject = {
			content: {
				timeline: {
					getFirstTrack: () => ({ clips: [], addAsset })
				}
			}
		} as unknown as Project;

		try {
			const image = new Asset('background.png');
			await image.addToTimeline(true, false);

			expect(confirm).toHaveBeenCalledOnce();
			expect(addAsset).toHaveBeenCalledWith(image, false);
		} finally {
			globalState.currentProject = previousProject;
			confirm.mockRestore();
		}
	});

	it('maps each URL mode to exactly one download type', () => {
		expect(getBatchDownloadType('audio_only')).toBe('audio');
		expect(getBatchDownloadType('audio_video')).toBe('video');
	});

	it('detects local audio and video compatibility without probing the file', () => {
		const audio = createItem(1);
		audio.source = { kind: 'file', value: 'C:\\media\\recitation.MP3' };
		const video = createItem(2);
		video.source = { kind: 'file', value: '/media/recitation.mp4' };

		expect(getLocalBatchMediaType(audio.source.value)).toBe('audio');
		expect(getLocalBatchMediaType(video.source.value)).toBe('video');
		expect(isBatchMediaModeCompatible(audio, 'audio_only')).toBe(true);
		expect(isBatchMediaModeCompatible(audio, 'audio_video')).toBe(false);
		expect(isBatchMediaModeCompatible(video, 'audio_only')).toBe(true);
		expect(isBatchMediaModeCompatible(video, 'audio_video')).toBe(true);
	});

	it('uses the same video asset on the audio and video tracks', () => {
		const asset = {
			id: 42,
			type: AssetType.Video,
			duration: new Duration(1_000)
		} as Asset;
		const audioTrack = new AssetTrack(TrackType.Audio);
		const videoTrack = new AssetTrack(TrackType.Video);

		expect(audioTrack.addAssetHeadless(asset)).toBe('added');
		expect(videoTrack.addAssetHeadless(asset)).toBe('added');
		expect(Reflect.get(audioTrack.clips[0], 'assetId')).toBe(42);
		expect(Reflect.get(videoTrack.clips[0], 'assetId')).toBe(42);
	});

	it('keeps a first image global or gives it the default clip duration', () => {
		const image = {
			id: 43,
			type: AssetType.Image,
			duration: new Duration(0)
		} as Asset;
		const backgroundTrack = new AssetTrack(TrackType.Video);
		const timedTrack = new AssetTrack(TrackType.Video);

		expect(backgroundTrack.addAssetHeadless(image)).toBe('added');
		expect(backgroundTrack.clips[0]).toMatchObject({ startTime: 0, endTime: 0, duration: 0 });

		expect(timedTrack.addAssetHeadless(image, false)).toBe('added');
		expect(timedTrack.clips[0]).toMatchObject({
			startTime: 0,
			endTime: DEFAULT_IMAGE_CLIP_DURATION_MS,
			duration: DEFAULT_IMAGE_CLIP_DURATION_MS
		});
	});

	it('turns a global image into a timed clip before appending another image', () => {
		const firstImage = {
			id: 44,
			type: AssetType.Image,
			duration: new Duration(0)
		} as Asset;
		const secondImage = {
			id: 45,
			type: AssetType.Image,
			duration: new Duration(0)
		} as Asset;
		const videoTrack = new AssetTrack(TrackType.Video);

		videoTrack.addAssetHeadless(firstImage);
		videoTrack.addAssetHeadless(secondImage);

		expect(videoTrack.clips[0]).toMatchObject({
			startTime: 0,
			endTime: DEFAULT_IMAGE_CLIP_DURATION_MS,
			duration: DEFAULT_IMAGE_CLIP_DURATION_MS
		});
		expect(videoTrack.clips[1]).toMatchObject({
			startTime: DEFAULT_IMAGE_CLIP_DURATION_MS + 1,
			endTime: DEFAULT_IMAGE_CLIP_DURATION_MS * 2 + 1,
			duration: DEFAULT_IMAGE_CLIP_DURATION_MS
		});
	});

	it('appends an image for ten seconds after an existing video', () => {
		const video = {
			id: 46,
			type: AssetType.Video,
			duration: new Duration(5_000)
		} as Asset;
		const image = {
			id: 47,
			type: AssetType.Image,
			duration: new Duration(0)
		} as Asset;
		const videoTrack = new AssetTrack(TrackType.Video);

		videoTrack.addAssetHeadless(video);
		videoTrack.addAssetHeadless(image);

		expect(videoTrack.clips[1]).toMatchObject({
			startTime: 5_001,
			endTime: 15_001,
			duration: DEFAULT_IMAGE_CLIP_DURATION_MS
		});
	});
});
