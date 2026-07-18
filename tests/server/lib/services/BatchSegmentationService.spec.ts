import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ exists: vi.fn() }));

import {
	Batch,
	createDefaultBatchSegmentationState,
	VerseRange,
	type BatchProjectItem
} from '$lib/classes';
import type { Project } from '$lib/classes/Project';
import { globalState } from '$lib/runes/main.svelte';
import { AutoSegmentationExecutionCoordinator } from '$lib/services/AutoSegmentationExecutionCoordinator';
import { BatchSegmentationService } from '$lib/services/BatchSegmentationService';
import type { BatchSegmentationRunConfiguration } from '$lib/services/BatchSegmentationSettings';

interface Deferred<T> {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (reason: Error) => void;
}

/**
 * Crée une promesse contrôlée sans délai arbitraire.
 * @returns {Deferred<T>} Promesse et contrôleurs.
 */
function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});
	return { promise, resolve, reject };
}

/**
 * Construit un projet Batch prêt pour la segmentation.
 * @param {number} order Ordre du projet.
 * @returns {BatchProjectItem} Ligne Batch minimale.
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
			resolvedAssetPath: `/audio/${order}.mp3`,
			mode: 'audio_only',
			assetId: order
		},
		segmentation: createDefaultBatchSegmentationState(),
		translations: {}
	};
}

const configuration = {
	snapshot: Object.freeze({
		runtime: 'api',
		mode: 'multi_aligner',
		model: 'Base',
		device: null,
		includeWbwTimestamps: false,
		minSilenceMs: 200,
		minSpeechMs: 1000,
		padMs: 100,
		fillBySilence: true,
		extendBeforeSilence: false,
		extendBeforeSilenceMs: 0,
		surahSplitterSurah: null
	}),
	mode: 'api',
	options: Object.freeze({})
} satisfies BatchSegmentationRunConfiguration;

describe('BatchSegmentationService', () => {
	it('runs sequentially, continues after failure and always releases its listener and lock', async () => {
		const items = [createItem(2), createItem(1), createItem(3)];
		const controls = new Map(items.map((item) => [item.projectId, deferred<void>()]));
		const started: number[] = [];
		let active = 0;
		let maximumActive = 0;
		const saves: string[] = [];
		const unlisten = vi.fn();
		const service = new BatchSegmentationService({
			listenStatus: async () => unlisten,
			saveBatch: async (batch) => {
				saves.push(batch.projects.map((item) => item.segmentation.status).join(','));
			},
			processItem: async (item) => {
				started.push(item.projectId);
				active += 1;
				maximumActive = Math.max(maximumActive, active);
				try {
					await controls.get(item.projectId)!.promise;
				} finally {
					active -= 1;
				}
				return {
					segmentsApplied: 1,
					review: {
						total: 0,
						pending: 0,
						lowConfidence: 0,
						coverage: 0,
						long: 0,
						wbwTimestamps: 0
					}
				};
			}
		});
		const batch = new Batch('Batch', items);
		const run = service.run(batch, items, configuration, false);

		await vi.waitFor(() => expect(started).toEqual([1]));
		service.handleStatus({ message: 'Running', progress: 150 });
		expect(items.find((item) => item.projectId === 1)!.segmentation.progress).toBe(90);
		controls.get(1)!.reject(new Error('First failed'));
		await vi.waitFor(() => expect(started).toEqual([1, 2]));
		controls.get(2)!.resolve();
		await vi.waitFor(() => expect(started).toEqual([1, 2, 3]));
		controls.get(3)!.resolve();
		await run;

		expect(maximumActive).toBe(1);
		expect(items.find((item) => item.projectId === 1)!.segmentation.status).toBe('failed');
		expect(items.find((item) => item.projectId === 2)!.segmentation.status).toBe('auto_verified');
		expect(items.find((item) => item.projectId === 3)!.segmentation.status).toBe('auto_verified');
		expect(
			items.every((item) => item.segmentation.settingsSnapshot === configuration.snapshot)
		).toBe(true);
		expect(saves.length).toBeGreaterThan(5);
		expect(unlisten).toHaveBeenCalledOnce();
		expect(AutoSegmentationExecutionCoordinator.activeSource).toBeNull();
		const finishedProgress = items[2].segmentation.progress;
		service.handleStatus({ progress: 5 });
		expect(items[2].segmentation.progress).toBe(finishedProgress);
	});

	it('loads and saves the explicit project without replacing the global project', async () => {
		const item = createItem(1);
		const visibleProject = { detail: { id: 999 } } as Project;
		const childProject = {
			detail: { updateTimestamp: vi.fn() },
			projectEditorState: { subtitlesEditor: { segmentationContext: null } }
		} as unknown as Project;
		const savedProjects: Project[] = [];
		globalState.currentProject = visibleProject;
		const service = new BatchSegmentationService({
			listenStatus: async () => () => undefined,
			saveBatch: async () => undefined,
			loadProject: async (projectId) => {
				expect(projectId).toBe(item.projectId);
				return childProject;
			},
			runForProject: async (project, receivedConfiguration, overwrite, onApplying) => {
				expect(project).toBe(childProject);
				expect(receivedConfiguration).toBe(configuration);
				expect(overwrite).toBe(false);
				onApplying();
				project.projectEditorState.subtitlesEditor.segmentationContext = {
					audioId: 'child',
					source: 'api',
					effectiveMode: 'api',
					modelName: 'Base',
					device: null,
					includeWbwTimestamps: false,
					alignedSegments: []
				};
				return {
					status: 'completed',
					segmentsApplied: 2,
					lowConfidenceSegments: 0,
					coverageGapSegments: 0,
					verseRange: new VerseRange()
				};
			},
			getReview: () => ({
				total: 0,
				pending: 0,
				lowConfidence: 0,
				coverage: 0,
				long: 0,
				wbwTimestamps: 0
			}),
			saveProject: async (project) => {
				savedProjects.push(project);
			}
		});

		try {
			await service.run(new Batch('Batch', [item]), [item], configuration, false);
			expect(globalState.currentProject).toBe(visibleProject);
			expect(savedProjects).toEqual([childProject]);
			expect(childProject.projectEditorState.subtitlesEditor.segmentationContext?.audioId).toBe(
				'child'
			);
		} finally {
			globalState.currentProject = null;
		}
	});
});
