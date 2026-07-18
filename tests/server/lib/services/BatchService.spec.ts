import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map<string, string>());

vi.mock('@tauri-apps/plugin-fs', () => ({
	exists: vi.fn(async (path: string) => storage.has(path)),
	readDir: vi.fn(async () =>
		Array.from(storage.keys()).map((path) => ({
			name: path.split('/').at(-1),
			isFile: true
		}))
	),
	readTextFile: vi.fn(async (path: string) => storage.get(path)!),
	remove: vi.fn(async (path: string) => storage.delete(path)),
	writeTextFile: vi.fn(async (path: string, content: string) => storage.set(path, content)),
	mkdir: vi.fn()
}));

vi.mock('@tauri-apps/api/path', () => ({
	appDataDir: vi.fn(async () => '/app-data'),
	join: vi.fn(async (...parts: string[]) => parts.join('/').replaceAll('//', '/'))
}));

import {
	Batch,
	createDefaultBatchSegmentationState,
	createDefaultBatchTranslationState
} from '$lib/classes';
import { BatchService } from '$lib/services/BatchService';
import { ProjectService } from '$lib/services/ProjectService';

describe('BatchService persistence', () => {
	beforeEach(() => {
		storage.clear();
		vi.spyOn(ProjectService, 'ensureFolder').mockResolvedValue('/app-data/batches');
	});

	it('saves and reloads a batch while preserving order and media state', async () => {
		const batch = new Batch('Complete Quran', [
			{
				order: 2,
				projectId: 22,
				projectName: 'Al-Baqara',
				reciter: 'Reciter',
				source: { kind: 'file', value: 'C:\\002.mp3' },
				media: {
					status: 'processing',
					progress: 42,
					error: null,
					resolvedAssetPath: null,
					mode: 'audio_only',
					assetId: null
				},
				segmentation: createDefaultBatchSegmentationState(),
				translations: {}
			},
			{
				order: 1,
				projectId: 11,
				projectName: 'Al-Fatiha',
				reciter: 'Reciter',
				source: { kind: 'url', value: 'https://example.com/001' },
				media: {
					status: 'completed',
					progress: 100,
					error: null,
					resolvedAssetPath: '/assets/001.mp3',
					mode: 'audio_only',
					assetId: 99
				},
				segmentation: createDefaultBatchSegmentationState(),
				translations: {}
			}
		]);

		await BatchService.save(batch);
		const restored = await BatchService.load(batch.id);

		expect(restored.projects.map((project) => project.order)).toEqual([2, 1]);
		expect(restored.projects[0].media).toEqual(batch.projects[0].media);
		expect(restored.projects[1].media).toEqual(batch.projects[1].media);
	});

	it('normalizes old media fields and interrupted operations', async () => {
		const batch = Batch.fromJSON({
			version: 1,
			id: 12,
			name: 'Old batch',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			projects: [
				{
					order: 1,
					projectId: 1,
					projectName: 'Project',
					reciter: 'Reciter',
					source: { kind: 'url', value: 'https://example.com' },
					media: { status: 'queued', progress: 20, error: null, resolvedAssetPath: null }
				}
			]
		}) as Batch;

		expect(batch.projects[0].media.mode).toBeNull();
		expect(batch.projects[0].media.assetId).toBeNull();
		expect(batch.projects[0].segmentation.status).toBe('not_started');
		expect(batch.projects[0].translations).toEqual({});
		batch.projects[0].segmentation.status = 'processing';
		batch.projects[0].translations.edition = {
			...createDefaultBatchTranslationState({
				editionName: 'edition',
				editionAuthor: 'Author',
				editionLanguage: 'English'
			}),
			status: 'adding'
		};
		await BatchService.save(batch);
		const restored = await BatchService.load(batch.id, 'Interrupted');
		expect(restored.projects[0].media.status).toBe('failed');
		expect(restored.projects[0].media.error).toBe('Interrupted');
		expect(restored.projects[0].segmentation.status).toBe('failed');
		expect(restored.projects[0].segmentation.error).toBe('SEGMENTATION_INTERRUPTED');
		expect(restored.projects[0].translations.edition.status).toBe('failed');
		expect(restored.projects[0].translations.edition.error).toBe('TRANSLATION_INTERRUPTED');
	});
});
