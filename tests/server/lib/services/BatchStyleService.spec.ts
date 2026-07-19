import { describe, expect, it, vi } from 'vitest';
import {
	Batch,
	createDefaultBatchExportState,
	createDefaultBatchSegmentationState,
	createDefaultBatchStyleState,
	type BatchProjectItem,
	type Project
} from '$lib/classes';
import type { SavedVideoStylePreset } from '$lib/classes/Settings.svelte';
import { globalState } from '$lib/runes/main.svelte';
import { BATCH_STYLE_CONCURRENCY, BatchStyleService } from '$lib/services/BatchStyleService';

/**
 * Crée une ligne Batch minimale pour tester la queue de style.
 * @param {number} order Ordre du projet.
 * @returns {BatchProjectItem} Ligne initialisée.
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

const preset = {
	id: 42,
	name: 'Preset',
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	resolution: { width: 1920, height: 1080 },
	data: { videoStyle: {}, customClips: [] }
} satisfies SavedVideoStylePreset;

describe('BatchStyleService', () => {
	it('passes the loaded project content to the existing preset importer', async () => {
		const item = createItem(1);
		const importStyles = vi.fn(async () => undefined);
		const content = {
			videoStyle: { importStyles }
		};
		const project = { detail: { id: 1 }, content } as unknown as Project;
		const saveProject = vi.fn(async () => undefined);
		const service = new BatchStyleService({
			loadProject: async () => project,
			saveProject,
			saveBatch: async () => undefined
		});

		await service.run(new Batch('Batch', [item]), [item], preset);
		expect(importStyles).toHaveBeenCalledWith(preset.data, content);
		expect(saveProject).toHaveBeenCalledWith(project);
	});

	it('uses at most three workers, saves each project and continues after a failure', async () => {
		const items = [createItem(5), createItem(1), createItem(4), createItem(2), createItem(3)];
		let active = 0;
		let maximumActive = 0;
		const started: number[] = [];
		const saved: number[] = [];
		const visibleProject = { detail: { id: 999 } } as Project;
		globalState.currentProject = visibleProject;
		const service = new BatchStyleService({
			loadProject: async (projectId) => ({ detail: { id: projectId } }) as Project,
			applyPreset: async (project) => {
				started.push(project.detail.id);
				active++;
				maximumActive = Math.max(maximumActive, active);
				await Promise.resolve();
				active--;
				if (project.detail.id === 2) throw new Error('Invalid project');
			},
			saveProject: async (project) => {
				saved.push(project.detail.id);
			},
			saveBatch: async () => undefined
		});

		try {
			const result = await service.run(new Batch('Batch', items), items, preset);
			expect(maximumActive).toBeLessThanOrEqual(BATCH_STYLE_CONCURRENCY);
			expect(started).toEqual([1, 2, 3, 4, 5]);
			expect(saved.sort((left, right) => left - right)).toEqual([1, 3, 4, 5]);
			expect(result).toMatchObject({ completed: 4, failed: 1 });
			expect(items.find((item) => item.projectId === 2)?.style.status).toBe('failed');
			expect(items.find((item) => item.projectId === 5)?.style.presetId).toBe(preset.id);
			expect(globalState.currentProject).toBe(visibleProject);
		} finally {
			globalState.currentProject = null;
		}
	});

	it('leaves unselected project style states untouched', async () => {
		const selected = createItem(1);
		const ignored = createItem(2);
		const applied: number[] = [];
		const service = new BatchStyleService({
			loadProject: async (projectId) => ({ detail: { id: projectId } }) as Project,
			applyPreset: async (project) => {
				applied.push(project.detail.id);
			},
			saveProject: async () => undefined,
			saveBatch: async () => undefined
		});

		await service.run(new Batch('Batch', [selected, ignored]), [selected], preset);

		expect(applied).toEqual([selected.projectId]);
		expect(ignored.style).toEqual(createDefaultBatchStyleState());
	});
});
