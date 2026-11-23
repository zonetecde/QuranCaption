import { describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import type { Project } from '$lib/classes/Project';
import { applySegmentationResponseToProject } from '$lib/services/autoSegmentation/apply-segmentation';
import RiwayahProvider from '$lib/services/RiwayahProvider';

import {
	resolveIncludeWbwTimestamps,
	runAutoSegmentation,
	runAutoSegmentationForProject
} from '$lib/services/autoSegmentation/run-segmentation';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('svelte-5-french-toast', () => ({ default: vi.fn() }));
vi.mock('$lib/services/autoSegmentation/audio', () => ({
	getAutoSegmentationAudioInfo: () => ({
		filePath: 'audio.mp3',
		fileName: 'audio.mp3',
		clipCount: 1
	}),
	getAutoSegmentationAudioClips: () => [
		{ filePath: 'audio.mp3', startMs: 0, endMs: 1000, sourceStartMs: 0 }
	]
}));
vi.mock('$lib/services/autoSegmentation/audio-normalize.svelte', () => ({
	normalizeAudioForProject: vi.fn()
}));
vi.mock('$lib/services/autoSegmentation/apply-segmentation', () => ({
	applySegmentationResponseToProject: vi.fn()
}));

/**
 * `shouldRetryCloudOnCpu` et `resolveContextModelName` sont des fonctions privées
 * dans run-segmentation.ts. Leurs comportements sont validés via le flow
 * d'intégration et les tests manuels.
 */
describe('runAutoSegmentation exports', () => {
	it('converts cloud Warsh references before creating subtitle clips', async () => {
		vi.resetAllMocks();
		const prefetch = vi.spyOn(RiwayahProvider, 'prefetch').mockResolvedValue(undefined);
		const mapping = vi
			.spyOn(RiwayahProvider, 'getHafsWordMapping')
			.mockImplementation((_riwayah, _surah, _verse, word) => ({
				locations: [`55:2:${word - 1}`],
				text: `word-${word}`
			}));
		try {
			const project = {
				content: { timeline: { getFirstTrack: () => ({ clips: [] }) } }
			} as unknown as Project;
			vi.mocked(invoke).mockResolvedValueOnce({ configured: false, valid: false });
			vi.mocked(invoke).mockResolvedValueOnce({
				segments: [
					{
						ref_from: '55:1:2',
						ref_to: '55:1:3',
						time_from: 5.08,
						time_to: 10.38,
						words: [{ location: '55:1:2', start: 0.14, end: 0.97 }]
					}
				]
			});
			vi.mocked(applySegmentationResponseToProject).mockResolvedValueOnce({ status: 'cancelled' });
			await runAutoSegmentationForProject(project, { riwayah: 'warsh' }, 'api', { headless: true });
			expect(applySegmentationResponseToProject).toHaveBeenCalledWith(
				expect.objectContaining({
					response: {
						segments: [
							{
								ref_from: '55:2:1',
								ref_to: '55:2:2',
								time_from: 5.08,
								time_to: 10.38,
								words: [{ location: '55:2:1', start: 0.14, end: 0.97, word: 'word-2' }]
							}
						]
					}
				})
			);
		} finally {
			prefetch.mockRestore();
			mapping.mockRestore();
		}
	});

	it('is a function', () => {
		expect(typeof runAutoSegmentation).toBe('function');
	});

	it('always keeps cloud word timestamps', () => {
		expect(resolveIncludeWbwTimestamps(false, 'align')).toBe(true);
		expect(resolveIncludeWbwTimestamps(false, 'replace')).toBe(true);
	});
});
