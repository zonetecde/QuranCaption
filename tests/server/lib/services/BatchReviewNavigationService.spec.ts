import { afterEach, describe, expect, it, vi } from 'vitest';

const batchMocks = vi.hoisted(() => ({
	load: vi.fn(),
	save: vi.fn(async () => undefined),
	loadUserBatchesDetails: vi.fn(async () => [])
}));
const projectMocks = vi.hoisted(() => ({ load: vi.fn() }));
const reviewMocks = vi.hoisted(() => ({ reconcile: vi.fn() }));

vi.mock('$lib/services/BatchService', () => ({ BatchService: batchMocks }));
vi.mock('$lib/services/ProjectService', () => ({ ProjectService: projectMocks }));
vi.mock('$lib/services/BatchSegmentationService', () => ({
	reconcileBatchProjectSegmentation: reviewMocks.reconcile
}));
vi.mock('svelte-5-french-toast', () => ({
	default: { success: vi.fn(), error: vi.fn() }
}));

import {
	navigateBatchReview,
	openBatchReviewProject,
	startBatchReview,
	stopBatchReview
} from '$lib/services/BatchReviewNavigationService';
import {
	Batch,
	ProjectEditorTabs,
	createDefaultBatchSegmentationState,
	type BatchProjectItem,
	type Project
} from '$lib/classes';
import { globalState } from '$lib/runes/main.svelte';

/**
 * Construit une ligne Batch signalée.
 * @param {number} id Identifiant du projet.
 * @param {number} order Position dans le Batch.
 * @returns {BatchProjectItem} Ligne prête à naviguer.
 */
function createItem(id: number, order: number): BatchProjectItem {
	const item: BatchProjectItem = {
		order,
		projectId: id,
		projectName: `Project ${id}`,
		reciter: 'Reciter',
		source: { kind: 'url', value: `https://example.com/${id}` },
		media: {
			status: 'completed',
			progress: 100,
			error: null,
			resolvedAssetPath: null,
			mode: 'audio_only',
			assetId: null
		},
		segmentation: createDefaultBatchSegmentationState()
	};
	item.segmentation.status = 'needs_review';
	return item;
}

/**
 * Construit un projet minimal sauvegardable.
 * @param {number} id Identifiant du projet.
 * @param {number} batchId Identifiant du Batch parent.
 * @returns {Project} Projet structurel utilisable par le service.
 */
function createProject(id: number, batchId: number): Project {
	return {
		detail: { id, batchId, name: `Project ${id}` },
		projectEditorState: { currentTab: ProjectEditorTabs.VideoEditor },
		save: vi.fn(async () => undefined)
	} as unknown as Project;
}

describe('Batch review navigation', () => {
	afterEach(() => {
		stopBatchReview();
		globalState.currentBatchId = null;
		globalState.currentProject = null;
		globalState.currentPage = 'home';
		vi.clearAllMocks();
	});

	it('starts on the requested flagged project and forces the subtitles editor', async () => {
		const item = createItem(4, 2);
		const batch = new Batch('Batch', [createItem(1, 1), item], 10);
		const project = createProject(4, 10);
		batchMocks.load.mockResolvedValue(batch);
		projectMocks.load.mockResolvedValue(project);

		expect(await openBatchReviewProject(10, 4)).toBe(true);

		expect(globalState.shared.batchReview).toMatchObject({
			active: true,
			batchId: 10,
			currentProjectId: 4,
			isNavigating: false
		});
		expect(globalState.currentBatchId).toBe(10);
		expect(globalState.currentProject).toBe(project);
		expect(project.projectEditorState.currentTab).toBe(ProjectEditorTabs.SubtitlesEditor);
	});

	it('manually verifies a resolved project before opening the next flagged one', async () => {
		const first = createItem(1, 1);
		const second = createItem(4, 2);
		const batch = new Batch('Batch', [first, second], 10);
		const current = createProject(1, 10);
		const next = createProject(4, 10);
		batchMocks.load.mockResolvedValue(batch);
		projectMocks.load.mockResolvedValue(next);
		reviewMocks.reconcile.mockImplementation(async (_batch, item: BatchProjectItem) => {
			item.segmentation.status = 'manually_verified';
			return true;
		});
		globalState.currentBatchId = 10;
		globalState.currentProject = current;
		startBatchReview(10, 1);

		await navigateBatchReview('next');

		expect(current.save).toHaveBeenCalledOnce();
		expect(reviewMocks.reconcile).toHaveBeenCalledWith(batch, first, current);
		expect(batchMocks.save).toHaveBeenCalledWith(batch);
		expect(globalState.currentProject).toBe(next);
		expect(next.projectEditorState.currentTab).toBe(ProjectEditorTabs.SubtitlesEditor);
		expect(globalState.shared.batchReview.currentProjectId).toBe(4);
	});

	it('keeps an unresolved project flagged while still allowing next navigation', async () => {
		const first = createItem(1, 1);
		const second = createItem(4, 2);
		const batch = new Batch('Batch', [first, second], 10);
		const current = createProject(1, 10);
		const next = createProject(4, 10);
		batchMocks.load.mockResolvedValue(batch);
		projectMocks.load.mockResolvedValue(next);
		reviewMocks.reconcile.mockResolvedValue(false);
		globalState.currentBatchId = 10;
		globalState.currentProject = current;
		startBatchReview(10, 1);

		await navigateBatchReview('next');

		expect(first.segmentation.status).toBe('needs_review');
		expect(globalState.currentProject).toBe(next);
	});

	it('returns to the batch workspace after resolving the final flagged project', async () => {
		const item = createItem(1, 1);
		const batch = new Batch('Batch', [item], 10);
		const current = createProject(1, 10);
		batchMocks.load.mockResolvedValue(batch);
		reviewMocks.reconcile.mockImplementation(async () => {
			item.segmentation.status = 'manually_verified';
			return true;
		});
		globalState.currentBatchId = 10;
		globalState.currentProject = current;
		startBatchReview(10, 1);

		await navigateBatchReview('next');

		expect(globalState.shared.batchReview.active).toBe(false);
		expect(globalState.currentProject).toBeNull();
		expect(globalState.currentPage).toBe('batch-workspace');
		expect(globalState.currentBatchId).toBe(10);
	});
});
