import { describe, expect, it, vi } from 'vitest';
import { Batch } from '$lib/classes';
import { openBatchWorkspace } from '$lib/services/BatchWorkspaceOpeningService';

describe('openBatchWorkspace', () => {
	it('retourne le Batch uniquement après ses deux réconciliations', async () => {
		const batch = new Batch('Batch');
		const calls: string[] = [];

		const result = await openBatchWorkspace(42, 'Interrupted', {
			loadBatch: vi.fn(async () => {
				calls.push('load');
				return batch;
			}),
			reconcileSegmentations: vi.fn(async () => {
				calls.push('segmentation');
				return true;
			}),
			reconcileTranslations: vi.fn(async () => {
				calls.push('translation');
				return true;
			})
		});

		expect(result).toBe(batch);
		expect(calls).toEqual(['load', 'segmentation', 'translation']);
	});
});
