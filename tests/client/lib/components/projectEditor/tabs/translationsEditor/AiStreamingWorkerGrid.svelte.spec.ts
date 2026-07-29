import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, describe, expect, test } from 'vitest';

import AiStreamingWorkerGrid from '$lib/components/projectEditor/tabs/translationsEditor/modal/shared/AiStreamingWorkerGrid.svelte';
import type { AiStreamWorker } from '$lib/services/AiWorkerPool';

const workers: AiStreamWorker[] = Array.from({ length: 3 }, (_, index) => ({
	workerId: index + 1,
	batchId: `batch-${index + 1}`,
	batchLabel: `Batch ${index + 1}/9`,
	step: 'streaming',
	reasoning: '',
	response: `response-${index + 1}`
}));

describe('AiStreamingWorkerGrid', () => {
	afterEach(cleanup);

	test('stacks the three workers when a single-column layout is requested', () => {
		const component = render(AiStreamingWorkerGrid, {
			workers,
			columnsClass: 'grid-cols-1'
		});

		expect(component.container.firstElementChild?.classList.contains('grid-cols-1')).toBe(true);
		expect(component.container.querySelectorAll('textarea')).toHaveLength(3);
		expect(component.container.textContent).toContain('Batch 1/9');
		expect(component.container.textContent).toContain('Batch 3/9');
	});
});
