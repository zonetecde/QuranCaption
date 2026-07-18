import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, describe, expect, test } from 'vitest';

import BatchDetailCard from '$lib/components/batch/BatchDetailCard.svelte';
import { globalState } from '$lib/runes/main.svelte';

describe('BatchDetailCard', () => {
	afterEach(() => {
		cleanup();
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
				importedMediaCount: 0
			}
		});

		const card = component.container.querySelector('[data-batch-card="123"]') as HTMLButtonElement;
		expect(card).not.toBeNull();
		await card.click();
		expect(globalState.currentBatchId).toBe(123);
		expect(globalState.currentPage).toBe('batch-workspace');
	});
});
