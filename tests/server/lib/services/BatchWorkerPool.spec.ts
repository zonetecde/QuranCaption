import { describe, expect, it, vi } from 'vitest';
import { runBatchWorkerPool } from '$lib/services/BatchWorkerPool';

describe('runBatchWorkerPool', () => {
	it('borne la concurrence et conserve l’ordre de prise en charge', async () => {
		let active = 0;
		let maximumActive = 0;
		const started: number[] = [];
		const releases: Array<() => void> = [];

		const execution = runBatchWorkerPool([1, 2, 3], 2, async (item) => {
			started.push(item);
			active++;
			maximumActive = Math.max(maximumActive, active);
			await new Promise<void>((resolve) => releases.push(resolve));
			active--;
		});

		await vi.waitFor(() => expect(started).toEqual([1, 2]));
		releases.shift()?.();
		await vi.waitFor(() => expect(started).toEqual([1, 2, 3]));
		releases.splice(0).forEach((release) => release());
		await execution;

		expect(maximumActive).toBe(2);
	});
});
