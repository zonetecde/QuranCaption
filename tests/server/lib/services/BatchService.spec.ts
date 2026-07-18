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

import { Batch } from '$lib/classes';
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
					resolvedAssetPath: null
				}
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
					resolvedAssetPath: '/assets/001.mp3'
				}
			}
		]);

		await BatchService.save(batch);
		const restored = await BatchService.load(batch.id);

		expect(restored.projects.map((project) => project.order)).toEqual([2, 1]);
		expect(restored.projects[0].media).toEqual(batch.projects[0].media);
		expect(restored.projects[1].media).toEqual(batch.projects[1].media);
	});
});
