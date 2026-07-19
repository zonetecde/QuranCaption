import { describe, expect, it, vi } from 'vitest';

import {
	AiStreamChunkBuffer,
	formatAiWorkerOutput,
	runAiWorkerPool,
	scrollTextareaToBottom
} from '$lib/services/AiWorkerPool';

describe('AiWorkerPool', () => {
	it('starts the next item as soon as one of three workers is free', async () => {
		const startedItems: number[] = [];
		const resolvers: Array<() => void> = [];
		const blockers = Array.from(
			{ length: 4 },
			() => new Promise<void>((resolve) => resolvers.push(resolve))
		);

		const poolPromise = runAiWorkerPool([0, 1, 2, 3], 3, async (item) => {
			startedItems.push(item);
			await blockers[item];
		});

		await Promise.resolve();
		expect(startedItems).toEqual([0, 1, 2]);

		resolvers[1]();
		await Promise.resolve();
		await Promise.resolve();
		expect(startedItems).toEqual([0, 1, 2, 3]);

		resolvers[0]();
		resolvers[2]();
		resolvers[3]();
		await poolPromise;
	});

	it('scrolls a streamed textarea to its latest content', () => {
		const textarea = { scrollTop: 0, scrollHeight: 240 } as HTMLTextAreaElement;

		scrollTextareaToBottom(textarea);

		expect(textarea.scrollTop).toBe(240);
	});

	it('combines reasoning and response in the same worker output', () => {
		expect(
			formatAiWorkerOutput(
				{ reasoning: 'Checking ranges...', response: '{"segments":[]}' },
				'Reasoning'
			)
		).toBe('Reasoning\nChecking ranges...\n{"segments":[]}');
	});

	it('keeps the response untouched when no reasoning is streamed', () => {
		expect(formatAiWorkerOutput({ reasoning: '', response: '{"segments":[]}' }, 'Reasoning')).toBe(
			'{"segments":[]}'
		);
	});

	it('groups streamed deltas before updating the workers', () => {
		vi.useFakeTimers();
		const flushed: Array<{ batchId: string; reasoning: string; response: string }> = [];
		const buffer = new AiStreamChunkBuffer((chunks) => flushed.push(...chunks), 50);

		buffer.push('batch-1', 'reasoning', 'Checking ');
		buffer.push('batch-1', 'reasoning', 'ranges...');
		buffer.push('batch-1', 'response', '{"segments":[]}');

		expect(flushed).toEqual([]);
		vi.advanceTimersByTime(50);
		expect(flushed).toEqual([
			{
				batchId: 'batch-1',
				reasoning: 'Checking ranges...',
				response: '{"segments":[]}'
			}
		]);
		vi.useRealTimers();
	});
});
