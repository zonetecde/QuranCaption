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
const reviewNavigationMocks = vi.hoisted(() => ({ open: vi.fn(async () => true) }));
const translationMocks = vi.hoisted(() => ({
	reconcile: vi.fn(async () => false),
	add: vi.fn(),
	fetch: vi.fn(),
	onUpdate: null as ((...args: unknown[]) => void) | null
}));
const cbrMocks = vi.hoisted(() => ({
	run: vi.fn(),
	onUpdate: null as ((...args: unknown[]) => void) | null
}));
const globalActionMocks = vi.hoisted(() => ({
	inspectExports: vi.fn<(items: unknown[]) => Promise<unknown[]>>(async () => []),
	styleRun: vi.fn(),
	exportRun: vi.fn()
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
vi.mock('$lib/services/BatchReviewNavigationService', () => ({
	openBatchReviewProject: reviewNavigationMocks.open,
	openBatchTranslationReviewProject: reviewNavigationMocks.open
}));
vi.mock('$lib/services/BatchTranslationService', () => ({
	BatchTranslationService: class {
		/**
		 * Conserve le callback de traduction fourni par le workspace.
		 * @param {{ onUpdate?: (...args: unknown[]) => void }} options Options simulées.
		 */
		constructor(options: { onUpdate?: (...args: unknown[]) => void }) {
			translationMocks.onUpdate = options.onUpdate ?? null;
		}

		/** @returns {unknown} Résultat contrôlé du test. */
		addEditions(...args: unknown[]): unknown {
			return translationMocks.add(...args);
		}

		/** @returns {unknown} Résultat contrôlé du test. */
		fetchEdition(...args: unknown[]): unknown {
			return translationMocks.fetch(...args);
		}
	},
	reconcileBatchTranslations: translationMocks.reconcile
}));
vi.mock('$lib/services/QdcTranslationService', () => ({
	QdcTranslationService: { getAvailableTranslations: vi.fn(async () => ({})) }
}));
vi.mock('$lib/services/TranslationFetchService', () => ({
	getProjectSubtitleClips: vi.fn(() => [])
}));
vi.mock('$lib/services/BatchCbrService', () => ({
	BatchCbrService: class {
		/**
		 * Conserve le callback de progression fourni par le workspace.
		 * @param {{ onUpdate?: (...args: unknown[]) => void }} options Options simulées.
		 */
		constructor(options: { onUpdate?: (...args: unknown[]) => void }) {
			cbrMocks.onUpdate = options.onUpdate ?? null;
		}

		/**
		 * Délègue l'exécution à la promesse contrôlée du test.
		 * @param {unknown[]} args Arguments du workspace.
		 * @returns {unknown} Résultat contrôlé.
		 */
		run(...args: unknown[]): unknown {
			return cbrMocks.run(...args);
		}
	}
}));
vi.mock('$lib/services/BatchStyleService', () => ({
	BatchStyleService: class {
		/** @param {unknown} _options Options simulées. */
		constructor(_options: unknown) {}

		/** @returns {unknown} Résultat contrôlé du test. */
		run(...args: unknown[]): unknown {
			return globalActionMocks.styleRun(...args);
		}
	}
}));
vi.mock('$lib/services/BatchExportService', () => ({
	BatchExportService: class {
		/** @param {unknown} _options Options simulées. */
		constructor(_options: unknown) {}

		/** @returns {unknown} Résultat contrôlé du test. */
		run(...args: unknown[]): unknown {
			return globalActionMocks.exportRun(...args);
		}
	},
	inspectBatchExportEligibility: globalActionMocks.inspectExports
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('svelte-5-french-toast', () => ({
	default: { success: vi.fn(), error: vi.fn() }
}));

import {
	Batch,
	createDefaultBatchSegmentationState,
	createDefaultBatchExportState,
	createDefaultBatchStyleState,
	createDefaultBatchTranslationState,
	type BatchProjectItem
} from '$lib/classes';
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
		segmentation: createDefaultBatchSegmentationState(),
		translations: {},
		style: createDefaultBatchStyleState(),
		export: createDefaultBatchExportState()
	};
}

describe('BatchWorkspace media import', () => {
	afterEach(() => {
		cleanup();
		globalState.currentBatchId = null;
		globalState.currentPage = 'home';
		globalState.shared.batchTranslationEditionName = null;
		serviceMocks.load.mockReset();
		segmentationMocks.inspect.mockReset();
		segmentationMocks.run.mockReset();
		segmentationMocks.onUpdate = null;
		reviewNavigationMocks.open.mockClear();
		cbrMocks.run.mockReset();
		cbrMocks.onUpdate = null;
		translationMocks.reconcile.mockClear();
		translationMocks.add.mockReset();
		translationMocks.fetch.mockReset();
		translationMocks.onUpdate = null;
		globalActionMocks.inspectExports.mockClear();
		globalActionMocks.styleRun.mockReset();
		globalActionMocks.exportRun.mockReset();
	});

	test('keeps distinct accessible global actions visible throughout every workflow stage', async () => {
		loadLocale('en');
		setLocale('en');
		const project = createProject(1, 'pending', {
			kind: 'url',
			value: 'https://example.com/1'
		});
		serviceMocks.load.mockResolvedValue(new Batch('Batch', [project], 90));
		globalState.currentBatchId = 90;

		let component = render(BatchWorkspace);
		await vi.waitFor(() =>
			expect(component.container.querySelectorAll('tbody tr')).toHaveLength(1)
		);
		let globalGroup = component.container.querySelector('[data-batch-global-actions]')!;
		expect(globalGroup).not.toBeNull();
		expect(globalGroup.classList.contains('ml-auto')).toBe(true);
		expect(globalGroup.parentElement?.classList.contains('w-full')).toBe(true);
		expect(component.container.querySelector('[data-batch-context-actions]')).not.toBeNull();
		expect(globalGroup.querySelector('[aria-label="Apply style to all projects"]')).not.toBeNull();
		expect(globalGroup.querySelector('[aria-label="Export all projects"]')).not.toBeNull();

		cleanup();
		project.media.status = 'completed';
		project.segmentation.status = 'processing';
		component = render(BatchWorkspace);
		await vi.waitFor(() => expect(component.container.textContent).toContain('Processing'));
		globalGroup = component.container.querySelector('[data-batch-global-actions]')!;
		expect(globalGroup.querySelectorAll('button')).toHaveLength(2);

		cleanup();
		project.segmentation.status = 'auto_verified';
		project.translations.edition = {
			...createDefaultBatchTranslationState({
				editionName: 'edition',
				editionAuthor: 'Author',
				editionLanguage: 'English'
			}),
			status: 'ready_to_fetch'
		};
		component = render(BatchWorkspace);
		await vi.waitFor(() => expect(component.container.textContent).toContain('Translations'));
		globalGroup = component.container.querySelector('[data-batch-global-actions]')!;
		expect(globalGroup.querySelectorAll('button')).toHaveLength(2);
		expect(component.container.querySelector('thead')?.textContent).not.toContain('Style');
		expect(component.container.querySelector('thead')?.textContent).not.toContain('Export');
	});

	test('requires a saved preset and explicit overwrite confirmation for the whole Batch', async () => {
		loadLocale('en');
		setLocale('en');
		const projects = [
			createProject(1, 'pending', { kind: 'url', value: 'https://example.com/1' }),
			createProject(2, 'pending', { kind: 'url', value: 'https://example.com/2' })
		];
		serviceMocks.load.mockResolvedValue(new Batch('Batch', projects, 91));
		globalState.settings = new Settings();
		globalState.settings.savedVideoStylePresets = [
			{
				id: 10,
				name: 'Local preset',
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				resolution: { width: 1920, height: 1080 },
				data: { videoStyle: {}, customClips: [] }
			}
		];
		globalActionMocks.styleRun.mockResolvedValue({
			active: 0,
			completed: 2,
			failed: 0,
			remaining: 0,
			total: 2
		});
		globalState.currentBatchId = 91;

		const component = render(BatchWorkspace);
		await vi.waitFor(() =>
			expect(component.container.querySelectorAll('tbody tr')).toHaveLength(2)
		);
		await component.container
			.querySelector<HTMLButtonElement>('[aria-label="Apply style to all projects"]')!
			.click();
		const modal = component.container.querySelector('[role="dialog"]')!;
		expect(modal.textContent).toContain('all 2 projects');
		const applyButton = modal.querySelector<HTMLButtonElement>('.btn-accent')!;
		expect(applyButton.disabled).toBe(true);
		await modal.querySelector<HTMLInputElement>('input[type="radio"]')!.click();
		expect(applyButton.disabled).toBe(true);
		await modal.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
		expect(applyButton.disabled).toBe(false);
		await applyButton.click();
		await vi.waitFor(() => expect(globalActionMocks.styleRun).toHaveBeenCalledOnce());
		expect(globalActionMocks.styleRun.mock.calls[0][0].projects).toHaveLength(2);
		expect(globalActionMocks.styleRun.mock.calls[0][1].id).toBe(10);
	});

	test('inspects every project and keeps export confirmation disabled without a folder', async () => {
		loadLocale('en');
		setLocale('en');
		const ready = createProject(1, 'completed', {
			kind: 'url',
			value: 'https://example.com/1'
		});
		const ignored = createProject(2, 'pending', {
			kind: 'url',
			value: 'https://example.com/2'
		});
		serviceMocks.load.mockResolvedValue(new Batch('Batch', [ready, ignored], 92));
		globalActionMocks.inspectExports.mockResolvedValue([
			{ item: ready, project: {} as never, reason: null },
			{ item: ignored, project: {} as never, reason: 'MEDIA_NOT_READY' }
		]);
		globalState.currentBatchId = 92;

		const component = render(BatchWorkspace);
		await vi.waitFor(() =>
			expect(component.container.querySelectorAll('tbody tr')).toHaveLength(2)
		);
		await component.container
			.querySelector<HTMLButtonElement>('[aria-label="Export all projects"]')!
			.click();
		await vi.waitFor(() => {
			const modal = component.container.querySelector('[role="dialog"]')!;
			expect(modal.textContent).toContain('Ready to export: 1');
			expect(modal.textContent).toContain('Not ready to export: 1');
			expect(modal.textContent).toContain('Media is missing');
			expect(modal.querySelector<HTMLButtonElement>('.btn-accent')?.disabled).toBe(true);
		});
		const modal = component.container.querySelector('[role="dialog"]')!;
		await modal.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
		expect(modal.textContent).toContain('Export 2 project(s)');
		expect(globalActionMocks.inspectExports.mock.calls[0][0]).toHaveLength(2);
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

		const importButton = component.container.querySelector<HTMLButtonElement>(
			'[data-batch-context-actions] .btn-accent'
		)!;
		expect(
			component.container.querySelector('[data-batch-context-actions] .btn-primary')
		).toBeNull();
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
		segmentationMocks.inspect.mockImplementation(async (items: BatchProjectItem[]) => [
			{ item: items[0], project: {}, reason: null, hasExistingSubtitles: false }
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
		expect(
			component.container.querySelector('[data-batch-context-actions] .btn-accent')
		).toBeNull();
		expect(
			Array.from(component.container.querySelectorAll('thead th')).map((cell) => cell.textContent)
		).toContain('Media');
		const segmentationButton = component.container.querySelector<HTMLButtonElement>(
			'[data-batch-context-actions] .btn-primary'
		)!;
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
			expect(component.container.textContent).toContain('1 active');
			const headers = Array.from(component.container.querySelectorAll('thead th')).map(
				(cell) => cell.textContent
			);
			expect(headers).toContain('AI Segmentation');
			expect(headers).not.toContain('Media');
		});
		finishSegmentation();
		await vi.waitFor(() => {
			expect(component.container.textContent).not.toContain('1 active');
		});
	});

	test('starts review from the first flagged project or the clicked row', async () => {
		loadLocale('en');
		setLocale('en');
		const first = createProject(1, 'completed', { kind: 'url', value: 'https://example.com/1' });
		const second = createProject(4, 'completed', { kind: 'url', value: 'https://example.com/4' });
		first.segmentation.status = 'needs_review';
		second.segmentation.status = 'needs_review';
		serviceMocks.load.mockResolvedValue(new Batch('Batch', [first, second], 200));
		globalState.currentBatchId = 200;

		const component = render(BatchWorkspace);
		await vi.waitFor(() =>
			expect(component.container.querySelectorAll('tbody tr')).toHaveLength(2)
		);
		const reviewButtons = Array.from(
			component.container.querySelectorAll<HTMLButtonElement>('button')
		).filter((button) => button.textContent?.includes('Review'));
		await reviewButtons[0].click();
		expect(reviewNavigationMocks.open).toHaveBeenLastCalledWith(200, 1);
		await reviewButtons[2].click();
		expect(reviewNavigationMocks.open).toHaveBeenLastCalledWith(200, 4);
	});

	test('shows Batch CBR progress after every media import is completed', async () => {
		loadLocale('en');
		setLocale('en');
		const project = createProject(1, 'completed', {
			kind: 'url',
			value: 'https://example.com/1'
		});
		serviceMocks.load.mockResolvedValue(new Batch('Batch', [project], 300));
		let finishCbr!: () => void;
		cbrMocks.run.mockImplementation(async () => {
			cbrMocks.onUpdate?.(project, 'converting', {
				activeProjectId: 1,
				completed: 0,
				failed: 0,
				remaining: 0,
				progress: 45,
				total: 1
			});
			await new Promise<void>((resolve) => {
				finishCbr = resolve;
			});
			return {
				activeProjectId: null,
				completed: 1,
				failed: 0,
				remaining: 0,
				progress: 100,
				total: 1
			};
		});
		globalState.currentBatchId = 300;

		const component = render(BatchWorkspace);
		await vi.waitFor(() =>
			expect(component.container.querySelectorAll('tbody tr')).toHaveLength(1)
		);
		const cbrButton = Array.from(
			component.container.querySelectorAll<HTMLButtonElement>('header button')
		).find((button) => button.textContent?.includes('Convert all audio to CBR'))!;
		expect(cbrButton).toBeDefined();
		await cbrButton.click();

		await vi.waitFor(() => {
			expect(component.container.textContent).toContain('Converting Project 1');
			expect(component.container.textContent).toContain('45%');
			expect(
				component.container.querySelector<HTMLButtonElement>(
					'[data-batch-context-actions] .btn-primary'
				)?.disabled
			).toBe(true);
		});
		finishCbr();
		await vi.waitFor(() =>
			expect(component.container.textContent).not.toContain('Converting Project 1')
		);
	});

	test('switches from segmentation actions to the edition-scoped translation stage', async () => {
		loadLocale('en');
		setLocale('en');
		const project = createProject(1, 'completed', {
			kind: 'url',
			value: 'https://example.com/1'
		});
		project.segmentation.status = 'auto_verified';
		serviceMocks.load.mockResolvedValue(new Batch('Batch', [project], 400));
		globalState.currentBatchId = 400;

		let component = render(BatchWorkspace);
		await vi.waitFor(() =>
			expect(component.container.querySelectorAll('tbody tr')).toHaveLength(1)
		);
		expect(component.container.textContent).toContain('Add translations to projects');
		expect(component.container.textContent).toContain('Fetch translations from other projects');
		expect(component.container.textContent).not.toContain('Convert all audio to CBR');
		expect(
			Array.from(component.container.querySelectorAll('header button')).some((button) =>
				button.textContent?.includes('AI Segmentation')
			)
		).toBe(false);
		expect(component.container.querySelector('thead')?.textContent).toContain('AI Segmentation');
		expect(component.container.textContent).not.toContain('Ask AI');

		cleanup();
		project.translations.edition = {
			...createDefaultBatchTranslationState({
				editionName: 'edition',
				editionAuthor: 'Author',
				editionLanguage: 'English'
			}),
			status: 'ready_to_fetch'
		};
		serviceMocks.load.mockResolvedValue(new Batch('Batch', [project], 400));
		component = render(BatchWorkspace);
		await vi.waitFor(() =>
			expect(component.container.querySelector('thead')?.textContent).toContain('Translations')
		);
		expect(component.container.querySelector('thead')?.textContent).not.toContain(
			'AI Segmentation'
		);
	});

	test('reloads final translation states immediately after fetch completion', async () => {
		loadLocale('en');
		setLocale('en');
		const displayedProject = createProject(1, 'completed', {
			kind: 'url',
			value: 'https://example.com/1'
		});
		displayedProject.segmentation.status = 'auto_verified';
		displayedProject.translations.edition = {
			...createDefaultBatchTranslationState({
				editionName: 'edition',
				editionAuthor: 'Author',
				editionLanguage: 'English'
			}),
			status: 'failed',
			error: 'TRANSLATION_INTERRUPTED'
		};
		const persistedProject = structuredClone(displayedProject);
		persistedProject.translations.edition.status = 'needs_review';
		persistedProject.translations.edition.error = null;
		persistedProject.translations.edition.progress = 100;
		persistedProject.translations.edition.review = {
			total: 5,
			complete: 3,
			pending: 2,
			fetched: 3,
			toReview: 2,
			errors: 0
		};
		serviceMocks.load
			.mockResolvedValueOnce(new Batch('Batch', [displayedProject], 500))
			.mockResolvedValueOnce(new Batch('Batch', [persistedProject], 500));
		translationMocks.fetch.mockResolvedValue({ completed: 1, failed: 0, skipped: 0 });
		globalState.currentBatchId = 500;

		const component = render(BatchWorkspace);
		await vi.waitFor(() =>
			expect(component.container.textContent).toContain('Translation operation interrupted')
		);
		const fetchButton = Array.from(
			component.container.querySelectorAll<HTMLButtonElement>('header button')
		).find((button) => button.textContent?.includes('Fetch translations'))!;
		await fetchButton.click();
		let modal!: Element;
		await vi.waitFor(() => {
			modal = component.container.querySelector('[role="dialog"]')!;
			expect(modal).not.toBeNull();
		});
		const modalButtons = modal.querySelectorAll<HTMLButtonElement>('button');
		await modalButtons[modalButtons.length - 1].click();

		await vi.waitFor(() => {
			expect(component.container.textContent).toContain('Translations need review');
			expect(component.container.textContent).toContain('2 remaining');
			expect(component.container.textContent).not.toContain('Translation operation interrupted');
		});
		expect(serviceMocks.load).toHaveBeenCalledTimes(2);
	});
});
