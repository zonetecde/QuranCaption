import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/api/path', () => ({ basename: vi.fn(), join: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ exists: vi.fn(), remove: vi.fn() }));

import {
	AssetType,
	Batch,
	createDefaultBatchSegmentationState,
	createDefaultBatchExportState,
	createDefaultBatchStyleState,
	Duration,
	TrackType,
	type Asset,
	type BatchProjectItem
} from '$lib/classes';
import { AssetTrack } from '$lib/classes/Track.svelte';
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
});
