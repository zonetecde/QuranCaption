import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({
	load: vi.fn(),
	normalizeInterruptedMedia: vi.fn(async () => false),
	normalizeInterruptedSegmentation: vi.fn(async () => false),
	loadUserBatchesDetails: vi.fn(async () => [])
}));
const segmentationMocks = vi.hoisted(() => ({
	inspect: vi.fn(),
	reconcile: vi.fn(async () => false),
	run: vi.fn(),
	onUpdate: null as ((...args: unknown[]) => void) | null
}));

vi.mock('$lib/services/BatchService', () => ({ BatchService: serviceMocks }));
vi.mock('$lib/services/ProjectService', () => ({ ProjectService: { load: vi.fn() } }));
vi.mock('$lib/services/BatchSegmentationService', () => ({
	BatchSegmentationService: class {
		/**
		 * Conserve le callback UI fourni par le workspace.
		 * @param {{ onUpdate?: (...args: unknown[]) => void }} options Options du service simulé.
		 */
		constructor(options: { onUpdate?: (...args: unknown[]) => void }) {
			segmentationMocks.onUpdate = options.onUpdate ?? null;
		}

		/**
		 * Délègue l'exécution à la promesse contrôlée du test.
		 * @param {unknown[]} args Arguments transmis par le workspace.
		 * @returns {unknown} Promesse contrôlée du test.
		 */
		run(...args: unknown[]): unknown {
			return segmentationMocks.run(...args);
		}
	},
	inspectBatchSegmentationEligibility: segmentationMocks.inspect,
	reconcileBatchSegmentations: segmentationMocks.reconcile
}));
vi.mock('$lib/services/DiscordService', () => ({
	discordService: { setEditingState: vi.fn() }
}));
vi.mock('$lib/services/UserAttentionService', () => ({
	notifyLongTaskCompletion: vi.fn(async () => undefined)
}));

import { Batch, createDefaultBatchSegmentationState, type BatchProjectItem } from '$lib/classes';
import BatchWorkspace from '$lib/components/batch/BatchWorkspace.svelte';
import { globalState } from '$lib/runes/main.svelte';
import Settings from '$lib/classes/Settings.svelte';
import { setLocale } from '$lib/i18n/i18n-svelte';
import { loadLocale } from '$lib/i18n/i18n-util.sync';

/**
 * Construit une ligne média pour le test du workspace.
 * @param {number} id Identifiant du projet.
 * @param {BatchProjectItem['media']['status']} status État média initial.
 * @param {BatchProjectItem['source']} source Source média.
 * @returns {BatchProjectItem} Ligne prête à afficher.
 */
function createProject(
	id: number,
	status: BatchProjectItem['media']['status'],
	source: BatchProjectItem['source']
): BatchProjectItem {
	return {
		order: id,
		projectId: id,
		projectName: `Project ${id}`,
		reciter: 'Reciter',
		source,
		media: {
			status,
			progress: status === 'failed' ? 64 : 0,
			error: status === 'failed' ? 'Import failed' : null,
			resolvedAssetPath: null,
			mode: null,
			assetId: null
		},
		segmentation: createDefaultBatchSegmentationState()
	};
}

describe('BatchWorkspace media import', () => {
	afterEach(() => {
		cleanup();
		globalState.currentBatchId = null;
		globalState.currentPage = 'home';
		serviceMocks.load.mockReset();
		segmentationMocks.inspect.mockReset();
		segmentationMocks.run.mockReset();
		segmentationMocks.onUpdate = null;
	});

	test('selects retryable rows and blocks video mode for local audio', async () => {
		loadLocale('en');
		setLocale('en');
		const projects = [
			createProject(1, 'pending', { kind: 'file', value: 'C:\\media\\recitation.mp3' }),
			createProject(2, 'failed', { kind: 'url', value: 'https://example.com/video' }),
			createProject(3, 'completed', { kind: 'url', value: 'https://example.com/done' }),
			createProject(4, 'processing', { kind: 'url', value: 'https://example.com/active' })
		];
		serviceMocks.load.mockResolvedValue(new Batch('Batch', projects, 99));
		globalState.currentBatchId = 99;

		const component = render(BatchWorkspace);
		await vi.waitFor(() => {
			expect(component.container.querySelectorAll('tbody tr')).toHaveLength(4);
		});

		const rowCheckboxes = component.container.querySelectorAll<HTMLInputElement>(
			'tbody input[type="checkbox"]'
		);
		expect(rowCheckboxes[0].checked).toBe(true);
		expect(rowCheckboxes[1].checked).toBe(true);
		expect(rowCheckboxes[2].checked).toBe(true);
		expect(rowCheckboxes[3].disabled).toBe(true);
		expect(component.container.textContent).toContain('Import failed');
		expect(component.container.textContent).toContain('64%');

		const importButton =
			component.container.querySelector<HTMLButtonElement>('header .btn-accent')!;
		await importButton.click();
		let modal!: Element;
		await vi.waitFor(() => {
			modal = component.container.querySelector('[role="dialog"]')!;
			expect(modal).not.toBeNull();
		});
		const radios = modal.querySelectorAll<HTMLInputElement>('input[type="radio"]');
		expect(radios).toHaveLength(2);
		await radios[1].click();
		expect(modal.textContent).toContain('Project 1');
		const modalButtons = modal.querySelectorAll<HTMLButtonElement>('button');
		expect(modalButtons[modalButtons.length - 1].disabled).toBe(true);

		const openButtons = component.container.querySelectorAll<HTMLButtonElement>('tbody button');
		expect(openButtons[3].disabled).toBe(true);
	});

	test('shows the saved segmentation model and summary for eligible projects', async () => {
		loadLocale('en');
		setLocale('en');
		const project = createProject(1, 'completed', {
			kind: 'url',
			value: 'https://example.com/done'
		});
		serviceMocks.load.mockResolvedValue(new Batch('Batch', [project], 100));
		segmentationMocks.inspect.mockResolvedValue([
			{ item: project, project: {}, reason: null, hasExistingSubtitles: false }
		]);
		let finishSegmentation!: () => void;
		segmentationMocks.run.mockImplementation(
			async (_batch: unknown, rawItems: unknown): Promise<void> => {
				const item = (rawItems as BatchProjectItem[])[0];
				item.segmentation.status = 'processing';
				item.segmentation.progress = 25;
				segmentationMocks.onUpdate?.(
					item,
					'processing',
					{ active: 1, completed: 0, needsReview: 0, failed: 0, remaining: 0 },
					{ message: 'Running test segmentation', indeterminate: false }
				);
				await new Promise<void>((resolve) => {
					finishSegmentation = resolve;
				});
				item.segmentation.status = 'auto_verified';
				item.segmentation.progress = 100;
				item.segmentation.segmentsApplied = 2;
				segmentationMocks.onUpdate?.(
					item,
					'completed',
					{ active: 0, completed: 1, needsReview: 0, failed: 0, remaining: 0 },
					{ message: null, indeterminate: false }
				);
			}
		);
		globalState.settings = new Settings();
		globalState.currentBatchId = 100;

		const component = render(BatchWorkspace);
		await vi.waitFor(() =>
			expect(component.container.querySelectorAll('tbody tr')).toHaveLength(1)
		);
		expect(component.container.textContent).toContain('Completed');
		expect(component.container.textContent).toContain('Ready for translations: 0 / 1');
		expect(component.container.querySelector('header .btn-accent')).toBeNull();
		expect(
			Array.from(component.container.querySelectorAll('thead th')).map((cell) => cell.textContent)
		).toContain('Media');
		const segmentationButton =
			component.container.querySelector<HTMLButtonElement>('header .btn-primary')!;
		expect(segmentationButton.disabled).toBe(false);
		await segmentationButton.click();

		let modal!: Element;
		await vi.waitFor(() => {
			modal = component.container.querySelector('[role="dialog"]')!;
			expect(modal?.textContent).toContain('1 eligible project');
		});
		expect(modal.textContent).toContain('Model: Base');
		expect(modal.textContent).toContain('Projects are processed one at a time.');
		expect(modal.querySelectorAll<HTMLButtonElement>('button')[1].disabled).toBe(false);
		await modal.querySelectorAll<HTMLButtonElement>('button')[1].click();
		await vi.waitFor(() => {
			expect(component.container.textContent).toContain('Running test segmentation');
			expect(component.container.textContent).toContain('1 active');
			const headers = Array.from(component.container.querySelectorAll('thead th')).map(
				(cell) => cell.textContent
			);
			expect(headers).toContain('AI Segmentation');
			expect(headers).not.toContain('Media');
		});
		finishSegmentation();
		await vi.waitFor(() => {
			expect(component.container.textContent).toContain('Automatically verified');
			expect(component.container.textContent).toContain('Ready for translations: 1 / 1');
		});
	});
});
