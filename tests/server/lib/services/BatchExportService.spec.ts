import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/path', () => ({
	join: vi.fn(async (...parts: string[]) => parts.join('/'))
}));

import {
	Batch,
	createDefaultBatchExportState,
	createDefaultBatchSegmentationState,
	createDefaultBatchStyleState,
	type BatchProjectItem,
	type Project
} from '$lib/classes';
import {
	BATCH_EXPORT_CONCURRENCY,
	BatchExportService,
	sanitizeBatchExportFileName,
	type BatchExportEligibility
} from '$lib/services/BatchExportService';

/**
 * Crée une ligne Batch exportable.
 * @param {number} order Ordre du projet.
 * @param {string} name Nom utilisé pour le fichier.
 * @returns {BatchProjectItem} Ligne initialisée.
 */
function createItem(order: number, name: string = 'Same'): BatchProjectItem {
	return {
		order,
		projectId: order,
		projectName: name,
		reciter: 'Reciter',
		source: { kind: 'url', value: `https://example.com/${order}` },
		media: {
			status: 'completed',
			progress: 100,
			error: null,
			resolvedAssetPath: `/audio/${order}.mp3`,
			mode: 'audio_only',
			assetId: order
		},
		segmentation: createDefaultBatchSegmentationState(),
		translations: {},
		style: createDefaultBatchStyleState(),
		export: createDefaultBatchExportState()
	};
}

/**
 * Crée un projet minimal portant des réglages vidéo sauvegardés.
 * @param {BatchProjectItem} item Ligne correspondante.
 * @returns {Project} Projet simulé.
 */
function createProject(item: BatchProjectItem): Project {
	const project = {
		detail: { id: item.projectId, name: item.projectName },
		projectEditorState: {
			export: {
				exportOnlyRecitation: false,
				recitationCutMarginMs: 25,
				recitationMinimumSilenceMs: 500,
				exportWithoutBackground: false,
				transparentExportFormat: 'mov_prores_4444'
			}
		}
	} as Project;
	(project as unknown as { clone: () => Project }).clone = vi.fn(
		() =>
			({
				...project,
				projectEditorState: {
					export: { ...project.projectEditorState.export }
				}
			}) as Project
	);
	return project;
}

describe('BatchExportService', () => {
	it('preserves Batch order, runs one export at a time and reserves collision-free paths', async () => {
		expect(BATCH_EXPORT_CONCURRENCY).toBe(1);
		const items = [createItem(2), createItem(1), createItem(3)];
		const inspection: BatchExportEligibility[] = items.map((item) => ({
			item,
			project: createProject(item),
			reason: null
		}));
		const queued: Array<{ id: number; path: string }> = [];
		let active = 0;
		let maximumActive = 0;
		const service = new BatchExportService({
			saveProject: async () => undefined,
			saveBatch: async () => undefined,
			pathExists: async (path) => path === '/out/Same.mp4',
			queueProject: async (project, _fileName, outputPath) => {
				queued.push({ id: project.detail.id, path: outputPath });
				return project.detail.id;
			},
			waitForExport: async (exportId, report) => {
				active++;
				maximumActive = Math.max(maximumActive, active);
				report(55);
				active--;
				if (exportId === 2) throw new Error('Encoding failed');
			}
		});

		const result = await service.run(new Batch('Batch', items), inspection, '/out');
		expect(maximumActive).toBe(1);
		expect(queued.map((entry) => entry.id)).toEqual([1, 2, 3]);
		expect(queued.map((entry) => entry.path)).toEqual([
			'/out/Same-1.mp4',
			'/out/Same-2.mp4',
			'/out/Same-3.mp4'
		]);
		expect(result).toMatchObject({ completed: 2, failed: 1 });
		expect(items.find((item) => item.projectId === 2)?.export.status).toBe('failed');
		expect(items.find((item) => item.projectId === 3)?.export.status).toBe('completed');
	});

	it('queues loadable non-ready projects only when explicitly enabled', async () => {
		const ready = createItem(1, 'Ready');
		const nonReady = createItem(2, 'Non-ready');
		const active = createItem(3, 'Active');
		const missing = createItem(4, 'Missing');
		const queued: number[] = [];
		const inspection: BatchExportEligibility[] = [
			{ item: ready, project: createProject(ready), reason: null },
			{ item: nonReady, project: createProject(nonReady), reason: 'SUBTITLES_MISSING' },
			{ item: active, project: createProject(active), reason: 'EXPORT_ACTIVE' },
			{ item: missing, project: null, reason: 'PROJECT_MISSING' }
		];
		const service = new BatchExportService({
			saveProject: async () => undefined,
			saveBatch: async () => undefined,
			pathExists: async () => false,
			queueProject: async (project) => {
				queued.push(project.detail.id);
				return project.detail.id;
			},
			waitForExport: async () => undefined
		});

		const result = await service.run(
			new Batch('Batch', [ready, nonReady, active, missing]),
			inspection,
			'/out',
			true
		);
		expect(queued).toEqual([1, 2]);
		expect(result).toMatchObject({ completed: 2, failed: 0, total: 2 });
		expect(nonReady.export.status).toBe('completed');
		expect(active.export.status).toBe('failed');
		expect(missing.export.status).toBe('failed');
	});

	it('forces default recitation-only settings on export copies without changing projects', async () => {
		const item = createItem(1, 'Recitation');
		const project = createProject(item);
		const queuedSettings: Array<Project['projectEditorState']['export']> = [];
		const service = new BatchExportService({
			saveProject: async () => undefined,
			saveBatch: async () => undefined,
			pathExists: async () => false,
			queueProject: async (queuedProject) => {
				queuedSettings.push(queuedProject.projectEditorState.export);
				return queuedProject.detail.id;
			},
			waitForExport: async () => undefined
		});

		await service.run(
			new Batch('Batch', [item]),
			[{ item, project, reason: null }],
			'/out',
			false,
			true
		);

		expect(queuedSettings[0]).toMatchObject({
			exportOnlyRecitation: true,
			recitationCutMarginMs: 350,
			recitationMinimumSilenceMs: 3000
		});
		expect(project.projectEditorState.export).toMatchObject({
			exportOnlyRecitation: false,
			recitationCutMarginMs: 25,
			recitationMinimumSilenceMs: 500
		});
	});

	it('sanitizes forbidden filesystem characters without producing an empty name', () => {
		expect(sanitizeBatchExportFileName('  001: Al/Fatiha. ')).toBe('001_ Al_Fatiha');
		expect(sanitizeBatchExportFileName('...')).toBe('project');
		expect(sanitizeBatchExportFileName('CON')).toBe('_CON');
	});
});
