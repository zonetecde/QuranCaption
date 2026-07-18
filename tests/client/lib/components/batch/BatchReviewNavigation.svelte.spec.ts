import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';

const batchMocks = vi.hoisted(() => ({ load: vi.fn() }));
const navigationMocks = vi.hoisted(() => ({
	navigate: vi.fn(async () => undefined),
	leave: vi.fn(async () => undefined)
}));

vi.mock('$lib/services/BatchService', () => ({ BatchService: batchMocks }));
vi.mock('$lib/services/BatchReviewNavigationService', () => ({
	navigateBatchReview: navigationMocks.navigate,
	leaveBatchReview: navigationMocks.leave
}));
vi.mock('$lib/services/BatchSegmentationReview', () => ({
	getBatchSegmentationReviewCounts: () => ({ pending: 1, lowConfidence: 1, coverage: 0 })
}));

import {
	Batch,
	ProjectEditorTabs,
	createDefaultBatchSegmentationState,
	createDefaultBatchExportState,
	createDefaultBatchStyleState,
	type BatchProjectItem,
	type Project
} from '$lib/classes';
import BatchReviewNavigation from '$lib/components/batch/BatchReviewNavigation.svelte';
import { globalState } from '$lib/runes/main.svelte';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';

/**
 * Construit une ligne signalée pour la navigation visuelle.
 * @param {number} id Identifiant du projet.
 * @param {number} order Position dans le Batch.
 * @returns {BatchProjectItem} Ligne signalée.
 */
function createItem(id: number, order: number): BatchProjectItem {
	const item = {
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
		segmentation: createDefaultBatchSegmentationState(),
		translations: {},
		style: createDefaultBatchStyleState(),
		export: createDefaultBatchExportState()
	} satisfies BatchProjectItem;
	item.segmentation.status = 'needs_review';
	return item;
}

describe('BatchReviewNavigation', () => {
	afterEach(() => {
		cleanup();
		globalState.currentProject = null;
		globalState.shared.batchReview.active = false;
		globalState.shared.batchReview.batchId = null;
		globalState.shared.batchReview.currentProjectId = null;
		globalState.shared.batchReview.isNavigating = false;
		vi.clearAllMocks();
	});

	test('shows the current flagged position and locks navigation while loading', async () => {
		loadLocale('en');
		setLocale('en');
		batchMocks.load.mockResolvedValue(new Batch('Batch', [createItem(1, 1), createItem(4, 2)], 10));
		globalState.currentProject = {
			detail: { id: 1, batchId: 10, name: '058 — Al-Mujadilah' },
			projectEditorState: { currentTab: ProjectEditorTabs.SubtitlesEditor }
		} as unknown as Project;
		globalState.shared.batchReview.active = true;
		globalState.shared.batchReview.batchId = 10;
		globalState.shared.batchReview.currentProjectId = 1;

		const component = render(BatchReviewNavigation);
		await vi.waitFor(() => expect(component.container.textContent).toContain('1 / 2'));
		expect(component.container.textContent).toContain('058 — Al-Mujadilah');
		const buttons = component.container.querySelectorAll<HTMLButtonElement>('button');
		expect(buttons).toHaveLength(3);
		expect(buttons[0].disabled).toBe(true);
		expect(buttons[1].disabled).toBe(false);
		expect(buttons[2].disabled).toBe(false);

		globalState.shared.batchReview.isNavigating = true;
		await vi.waitFor(() =>
			expect(Array.from(buttons).every((button) => button.disabled)).toBe(true)
		);
	});
});
