import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';

import BatchDetailCard from '$lib/components/batch/BatchDetailCard.svelte';
import { globalState } from '$lib/runes/main.svelte';
import { Status } from '$lib/classes/Status';
import { BatchService } from '$lib/services/BatchService';

describe('BatchDetailCard', () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		globalState.currentBatchId = null;
		globalState.currentPage = 'home';
	});

	test('renders a batch card and opens its workspace', async () => {
		const component = render(BatchDetailCard, {
			batchDetail: {
				id: 123,
				name: 'Complete Quran',
				createdAt: new Date('2026-01-01T00:00:00.000Z'),
				updatedAt: new Date('2026-01-02T00:00:00.000Z'),
				projectCount: 114,
				reciter: 'Nasser Al-Qatami',
				importedMediaCount: 0,
				status: Status.NOT_SET
			}
		});

		const card = component.container.querySelector('[data-batch-card="123"]') as HTMLButtonElement;
		expect(card).not.toBeNull();
		await card.click();
		expect(globalState.currentBatchId).toBe(123);
		expect(globalState.currentPage).toBe('batch-workspace');
	});

	test('opens batch actions without opening the workspace', async () => {
		const component = render(BatchDetailCard, {
			batchDetail: {
				id: 123,
				name: 'Complete Quran',
				createdAt: new Date('2026-01-01T00:00:00.000Z'),
				updatedAt: new Date('2026-01-02T00:00:00.000Z'),
				projectCount: 114,
				reciter: 'Nasser Al-Qatami',
				importedMediaCount: 0,
				status: Status.NOT_SET
			}
		});

		await (component.container.querySelector('[data-batch-actions]') as HTMLButtonElement).click();

		expect(globalState.currentBatchId).toBeNull();
		expect(globalState.currentPage).toBe('home');
		expect(document.body.textContent).toContain('file_download');
		expect(document.body.textContent).toContain('call_split');
		expect(document.body.textContent).toContain('delete');
	});

	test('changes the batch status without opening the workspace', async () => {
		const saveDetail = vi.spyOn(BatchService, 'saveDetail').mockResolvedValue();
		const batchDetail = {
			id: 123,
			name: 'Complete Quran',
			createdAt: new Date('2026-01-01T00:00:00.000Z'),
			updatedAt: new Date('2026-01-02T00:00:00.000Z'),
			projectCount: 114,
			reciter: 'Nasser Al-Qatami',
			importedMediaCount: 0,
			status: Status.NOT_SET
		};
		const component = render(BatchDetailCard, { batchDetail });

		await (component.container.querySelector('[data-batch-status]') as HTMLButtonElement).click();
		await (
			component.container.querySelector(
				'[data-batch-status-option="To Translate"]'
			) as HTMLButtonElement
		).click();

		expect(saveDetail).toHaveBeenCalledOnce();
		expect(saveDetail.mock.calls[0][0].status).toBe(Status.TO_TRANSLATE);
		expect(globalState.currentBatchId).toBeNull();
	});
});
