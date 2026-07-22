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
	createDefaultBatchExportState,
	createDefaultBatchSegmentationState,
	createDefaultBatchStyleState,
	createDefaultBatchTranslationState
} from '$lib/classes';
import { BatchService } from '$lib/services/BatchService';
import { ProjectService, parseProjectsBackup } from '$lib/services/ProjectService';

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
				translations: {},
				style: createDefaultBatchStyleState(),
				export: createDefaultBatchExportState()
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
				translations: {},
				style: createDefaultBatchStyleState(),
				export: createDefaultBatchExportState()
			}
		]);

		await BatchService.save(batch);
		const restored = await BatchService.load(batch.id);

		expect(restored.projects.map((project) => project.order)).toEqual([2, 1]);
		expect(restored.projects[0].media).toEqual(batch.projects[0].media);
		expect(restored.projects[1].media).toEqual(batch.projects[1].media);
		expect((await BatchService.loadAll()).map((savedBatch) => savedBatch.id)).toEqual([batch.id]);
	});

	it('imports batch manifests non-destructively', async () => {
		const batch = new Batch('Imported batch');
		const firstImport = await BatchService.importBatchesBackup([
			batch.toJSON() as Record<string, unknown>
		]);
		const secondImport = await BatchService.importBatchesBackup([
			batch.toJSON() as Record<string, unknown>
		]);

		expect(firstImport).toEqual({ imported: 1, skipped: 0, invalid: 0 });
		expect(secondImport).toEqual({ imported: 0, skipped: 1, invalid: 0 });
		expect((await BatchService.load(batch.id)).name).toBe('Imported batch');
	});

	it('deletes every project before deleting its batch manifest', async () => {
		const batch = Batch.fromJSON({
			version: 1,
			id: 123,
			name: 'Delete batch',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			projects: [
				{
					order: 1,
					projectId: 456,
					projectName: 'Project',
					reciter: 'Reciter',
					source: { kind: 'url', value: 'https://example.com' },
					media: { status: 'completed', progress: 100 }
				}
			]
		}) as Batch;
		const deleteProject = vi.spyOn(ProjectService, 'delete').mockResolvedValue();
		await BatchService.save(batch);

		await BatchService.delete(batch.id);

		expect(deleteProject).toHaveBeenCalledOnce();
		expect(deleteProject).toHaveBeenCalledWith(456);
		expect(storage.has(`/app-data/batches/${batch.id}.json`)).toBe(false);
	});

	it('dissolves a batch without deleting its projects', async () => {
		const batch = Batch.fromJSON({
			version: 1,
			id: 125,
			name: 'Dissolve batch',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			projects: [
				{ order: 1, projectId: 10, projectName: 'First' },
				{ order: 2, projectId: 20, projectName: 'Second' }
			]
		}) as Batch;
		const projects = new Map(
			batch.projects.map((item) => [
				item.projectId,
				{
					detail: {
						batchId: batch.id,
						batchOrder: item.order,
						updateTimestamp: vi.fn()
					}
				}
			])
		);
		const loadProject = vi
			.spyOn(ProjectService, 'load')
			.mockImplementation(async (projectId) => projects.get(projectId) as never);
		const saveProject = vi.spyOn(ProjectService, 'save').mockResolvedValue();
		const deleteProject = vi.spyOn(ProjectService, 'delete').mockResolvedValue();
		vi.spyOn(ProjectService, 'loadUserProjectsDetails').mockResolvedValue([]);
		await BatchService.save(batch);

		await BatchService.dissolve(batch.id);

		expect(loadProject).toHaveBeenCalledTimes(2);
		expect(saveProject).toHaveBeenCalledTimes(2);
		expect(deleteProject).not.toHaveBeenCalled();
		expect(Array.from(projects.values()).every((project) => project.detail.batchId === null)).toBe(
			true
		);
		expect(
			Array.from(projects.values()).every((project) => project.detail.batchOrder === null)
		).toBe(true);
		expect(storage.has(`/app-data/batches/${batch.id}.json`)).toBe(false);
	});

	it('deletes selected projects and updates the batch manifest', async () => {
		const batch = Batch.fromJSON({
			version: 1,
			id: 124,
			name: 'Update batch',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			projects: [
				{ order: 1, projectId: 10, projectName: 'First' },
				{ order: 2, projectId: 20, projectName: 'Second' }
			]
		}) as Batch;
		const deleteProject = vi.spyOn(ProjectService, 'delete').mockResolvedValue();
		vi.spyOn(ProjectService, 'loadUserProjectsDetails').mockResolvedValue([]);
		await BatchService.save(batch);

		await BatchService.deleteProjects(batch, [20]);

		expect(deleteProject).toHaveBeenCalledWith(20);
		expect(
			(await BatchService.load(batch.id)).projects.map((project) => project.projectId)
		).toEqual([10]);
	});

	it('accepts legacy project arrays and version 2 backups', () => {
		const projects = [{ detail: { id: 1 } }];
		const batches = [{ version: 1, id: 2 }];

		expect(parseProjectsBackup(projects)).toEqual({ projects, batches: [] });
		expect(parseProjectsBackup({ version: 2, projects, batches })).toEqual({
			projects,
			batches
		});
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
		expect(batch.projects[0].style).toEqual(createDefaultBatchStyleState());
		expect(batch.projects[0].export).toEqual(createDefaultBatchExportState());
		batch.projects[0].segmentation.status = 'processing';
		batch.projects[0].style.status = 'processing';
		batch.projects[0].export.status = 'queued';
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
		expect(restored.projects[0].style.status).toBe('failed');
		expect(restored.projects[0].style.error).toBe('STYLE_INTERRUPTED');
		expect(restored.projects[0].export.status).toBe('failed');
		expect(restored.projects[0].export.error).toBe('EXPORT_INTERRUPTED');
	});
});
