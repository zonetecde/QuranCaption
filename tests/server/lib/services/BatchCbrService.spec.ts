import { describe, expect, it, vi } from 'vitest';

const tauriMocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
const projectMocks = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauriMocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: tauriMocks.listen }));
vi.mock('$lib/services/ProjectService', () => ({ ProjectService: projectMocks }));

import {
	Batch,
	createDefaultBatchExportState,
	createDefaultBatchSegmentationState,
	createDefaultBatchStyleState,
	type BatchProjectItem
} from '$lib/classes';
import { BatchCbrService } from '$lib/services/BatchCbrService';

/**
 * Construit une ligne dont le média Batch est prêt.
 * @param {number} order Ordre et identifiant de la ligne.
 * @returns {BatchProjectItem} Ligne prête à convertir.
 */
function createItem(order: number): BatchProjectItem {
	return {
		order,
		projectId: order,
		projectName: `Project ${order}`,
		reciter: 'Reciter',
		source: { kind: 'url', value: `https://example.com/${order}` },
		media: {
			status: 'completed',
			progress: 100,
			error: null,
			resolvedAssetPath: `/${order}.mp3`,
			mode: 'audio_only',
			assetId: order
		},
		segmentation: createDefaultBatchSegmentationState(),
		translations: {},
		style: createDefaultBatchStyleState(),
		export: createDefaultBatchExportState()
	};
}

describe('BatchCbrService', () => {
	it('converts sequentially, reports global progress and continues after failures', async () => {
		const items = [createItem(3), createItem(1), createItem(2)];
		const starts: number[] = [];
		const updates: number[] = [];
		const service = new BatchCbrService({
			processItem: async (_batch, item, report) => {
				starts.push(item.projectId);
				report(50);
				if (item.projectId === 2) throw new Error('conversion failed');
			},
			onUpdate: (_item, _activity, progress) => updates.push(progress.progress)
		});

		const result = await service.run(new Batch('Batch', items), items);

		expect(starts).toEqual([1, 2, 3]);
		expect(result).toEqual({
			activeProjectId: null,
			completed: 2,
			failed: 1,
			remaining: 0,
			progress: 100,
			total: 3
		});
		expect(updates).toContain(17);
		expect(updates.at(-1)).toBe(100);
	});

	it('uses the imported asset and converts its file in place', async () => {
		const item = createItem(1);
		const unlisten = vi.fn();
		const asset = {
			id: 1,
			filePath: '/1.mp3'
		};
		const project = { content: { assets: [asset] } };
		projectMocks.load.mockResolvedValue(project);
		tauriMocks.listen.mockResolvedValue(unlisten);
		tauriMocks.invoke.mockImplementation(async (command: string) =>
			command === 'is_constant_bitrate' ? false : undefined
		);

		const result = await new BatchCbrService().run(new Batch('Batch', [item]), [item]);

		expect(tauriMocks.invoke).toHaveBeenCalledWith('convert_audio_to_cbr', {
			filePath: '/1.mp3',
			conversionRequestId: expect.stringContaining('batch-cbr-1-')
		});
		expect(unlisten).toHaveBeenCalledOnce();
		expect(result.failed).toBe(0);
	});
});
