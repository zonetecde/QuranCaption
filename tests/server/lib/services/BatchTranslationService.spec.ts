import { beforeEach, describe, expect, it, vi } from 'vitest';

const batchMocks = vi.hoisted(() => ({ save: vi.fn(async () => undefined) }));
const projectMocks = vi.hoisted(() => ({ load: vi.fn(), loadUserProjectsDetails: vi.fn() }));
const translationMocks = vi.hoisted(() => ({
	getClips: vi.fn(),
	getCounts: vi.fn(),
	fetch: vi.fn()
}));
const aiSplitMocks = vi.hoisted(() => ({
	buildCandidates: vi.fn(),
	buildBatches: vi.fn(),
	run: vi.fn(),
	validate: vi.fn(),
	apply: vi.fn()
}));
const aiTrimMocks = vi.hoisted(() => ({
	buildCandidates: vi.fn(),
	buildBatches: vi.fn(),
	run: vi.fn(),
	validate: vi.fn(),
	apply: vi.fn()
}));

vi.mock('$lib/services/BatchService', () => ({ BatchService: batchMocks }));
vi.mock('$lib/services/ProjectService', () => ({ ProjectService: projectMocks }));
vi.mock('$lib/services/TranslationFetchService', () => ({
	getProjectSubtitleClips: translationMocks.getClips,
	getProjectTranslationReviewCounts: translationMocks.getCounts,
	fetchTranslationsFromOtherProjects: translationMocks.fetch
}));
vi.mock('$lib/services/AiSubtitleSplittingService', () => ({
	buildAiSubtitleSplitCandidates: aiSplitMocks.buildCandidates,
	buildAiSubtitleSplitBatches: aiSplitMocks.buildBatches,
	runAiSubtitleSplitBatchStreaming: aiSplitMocks.run,
	validateAiSubtitleSplitBatchResult: aiSplitMocks.validate,
	applyAiSubtitleSplitValidationSuccess: aiSplitMocks.apply
}));
vi.mock('$lib/services/AdvancedAITrimming', () => ({
	buildAdvancedTrimVerseCandidates: aiTrimMocks.buildCandidates,
	buildAdvancedTrimBatches: aiTrimMocks.buildBatches,
	runAdvancedTrimBatchStreaming: aiTrimMocks.run,
	validateAdvancedTrimBatchResult: aiTrimMocks.validate,
	applyAdvancedTrimValidationSuccess: aiTrimMocks.apply
}));

import {
	Batch,
	Edition,
	createDefaultBatchSegmentationState,
	createDefaultBatchExportState,
	createDefaultBatchStyleState,
	type BatchProjectItem,
	type Project
} from '$lib/classes';
import { globalState } from '$lib/runes/main.svelte';
import {
	BATCH_TRANSLATION_CONCURRENCY,
	BatchTranslationService,
	reconcileBatchTranslations,
	type BatchTranslationQueueProgress
} from '$lib/services/BatchTranslationService';

const edition = new Edition('key', 'edition', 'Author', 'English', 'ltr', '', '', '', '');
const secondEdition = new Edition(
	'key-2',
	'edition-2',
	'Author 2',
	'French',
	'ltr',
	'',
	'',
	'',
	''
);
const aiSettings = {
	omitPromptPrefix: false,
	openAiApiKey: 'key',
	textAiApiEndpoint: 'https://example.com',
	advancedTrimModel: 'model',
	advancedTrimReasoningEffort: 'none' as const,
	advancedAlsoAskReviewed: false,
	aiBoldCustomNote: '',
	aiWbwTranslationCustomNote: '',
	activeModalTab: 'advanced' as const
};

/**
 * Construit une ligne Batch prête pour les traductions.
 * @param {number} id Identifiant et ordre du projet.
 * @returns {BatchProjectItem} Ligne validée côté segmentation.
 */
function createItem(id: number): BatchProjectItem {
	const item: BatchProjectItem = {
		order: id,
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
	};
	item.segmentation.status = 'auto_verified';
	return item;
}

/**
 * Construit un projet dont les opérations de traduction sont observables.
 * @param {number} id Identifiant du projet.
 * @param {() => Promise<void>} waitForDownload Barrière simulant le téléchargement.
 * @returns {Project} Projet project-scoped de test.
 */
function createProject(id: number, waitForDownload: () => Promise<void>): Project {
	const projectTranslation = {
		addedTranslationEditions: [],
		getAllProjectSubtitlesTranslationsForProject: vi.fn(async () => {
			await waitForDownload();
			return { '1:1': 'Text' };
		}),
		addTranslationToProject: vi.fn(async (_project: Project, selectedEdition: Edition) => {
			projectTranslation.addedTranslationEditions.push(selectedEdition as never);
			return true;
		}),
		updateProjectPercentage: vi.fn()
	};
	return {
		detail: { id },
		content: { projectTranslation },
		save: vi.fn(async () => undefined)
	} as unknown as Project;
}

describe('BatchTranslationService', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		globalState.userProjectsDetails = [];
		translationMocks.getClips.mockReturnValue([{}]);
		translationMocks.getCounts.mockReturnValue({
			total: 1,
			complete: 0,
			pending: 1,
			fetched: 0,
			toReview: 1,
			errors: 0
		});
		aiSplitMocks.buildCandidates.mockResolvedValue([]);
		aiSplitMocks.buildBatches.mockReturnValue([]);
		aiTrimMocks.buildCandidates.mockReturnValue([]);
		aiTrimMocks.buildBatches.mockReturnValue([]);
	});

	it('limits addition to three projects and never changes the current project', async () => {
		let active = 0;
		let maximumActive = 0;
		const waitForDownload = async (): Promise<void> => {
			active++;
			maximumActive = Math.max(maximumActive, active);
			await new Promise((resolve) => setTimeout(resolve, 5));
			active--;
		};
		const items = Array.from({ length: 6 }, (_, index) => createItem(index + 1));
		const projects = new Map(
			items.map((item) => [item.projectId, createProject(item.projectId, waitForDownload)])
		);
		projectMocks.load.mockImplementation(async (id: number) => projects.get(id));
		const currentProject = { detail: { id: 999 } } as Project;
		globalState.currentProject = currentProject;

		const result = await new BatchTranslationService().addEditions(
			new Batch('Batch', items, 10),
			items,
			[edition, secondEdition]
		);

		expect(BATCH_TRANSLATION_CONCURRENCY).toBe(3);
		expect(maximumActive).toBe(3);
		expect(globalState.currentProject).toBe(currentProject);
		expect(globalState.userProjectsDetails.map((detail) => detail.id).sort()).toEqual([
			1, 2, 3, 4, 5, 6
		]);
		expect(result).toEqual({ completed: 12, failed: 0, skipped: 0 });
		expect(items.every((item) => item.translations[edition.name].status === 'ready_to_fetch')).toBe(
			true
		);
		expect(
			items.every((item) => item.translations[secondEdition.name].status === 'ready_to_fetch')
		).toBe(true);
		for (const project of projects.values()) {
			expect(project.content.projectTranslation.addTranslationToProject).toHaveBeenCalledWith(
				project,
				expect.objectContaining({ name: edition.name }),
				{ '1:1': 'Text' },
				{ replaceExisting: false }
			);
			expect(project.save).toHaveBeenCalledTimes(2);
		}
	});

	it('continues after an individual error and classifies full verses as auto verified', async () => {
		const items = [createItem(1), createItem(2)];
		const completeProject = createProject(1, async () => undefined);
		const failedProject = createProject(2, async () => {
			throw new Error('download failed');
		});
		projectMocks.load.mockImplementation(async (id: number) =>
			id === 1 ? completeProject : failedProject
		);
		translationMocks.getCounts.mockReturnValue({
			total: 1,
			complete: 1,
			pending: 0,
			fetched: 0,
			toReview: 0,
			errors: 0
		});

		const result = await new BatchTranslationService().addEditions(
			new Batch('Batch', items, 10),
			items,
			[edition]
		);

		expect(result).toEqual({ completed: 1, failed: 1, skipped: 0 });
		expect(items[0].translations[edition.name].status).toBe('auto_verified');
		expect(items[1].translations[edition.name].status).toBe('failed');
	});

	it('skips an edition already present by default', async () => {
		const item = createItem(1);
		const project = createProject(1, async () => undefined);
		project.content.projectTranslation.addedTranslationEditions.push(edition);
		projectMocks.load.mockResolvedValue(project);

		const result = await new BatchTranslationService().addEditions(
			new Batch('Batch', [item], 10),
			[item],
			[edition]
		);

		expect(result).toEqual({ completed: 0, failed: 0, skipped: 1 });
		expect(project.content.projectTranslation.addTranslationToProject).not.toHaveBeenCalled();
		expect(item.translations.edition.status).toBe('ready_to_fetch');
	});

	it('counts every edition when a project is ineligible or has no subtitles', async () => {
		const ineligibleItem = createItem(1);
		ineligibleItem.segmentation.status = 'not_started';
		const emptyItem = createItem(2);
		projectMocks.load.mockResolvedValue(createProject(2, async () => undefined));
		translationMocks.getClips.mockReturnValue([]);

		const result = await new BatchTranslationService().addEditions(
			new Batch('Batch', [ineligibleItem, emptyItem], 10),
			[ineligibleItem, emptyItem],
			[edition, secondEdition]
		);

		expect(result).toEqual({ completed: 0, failed: 0, skipped: 4 });
	});

	it('counts only still unresolved editions as failed after a partial project error', async () => {
		const item = createItem(1);
		const project = createProject(1, async () => undefined);
		vi.mocked(project.content.projectTranslation.getAllProjectSubtitlesTranslationsForProject)
			.mockResolvedValueOnce({ '1:1': 'Text' })
			.mockRejectedValueOnce(new Error('download failed'));
		projectMocks.load.mockResolvedValue(project);

		const result = await new BatchTranslationService().addEditions(
			new Batch('Batch', [item], 10),
			[item],
			[edition, secondEdition]
		);

		expect(result).toEqual({ completed: 1, failed: 1, skipped: 0 });
		expect(item.translations[edition.name].status).toBe('ready_to_fetch');
		expect(item.translations[secondEdition.name].status).toBe('failed');
	});

	it('counts every unresolved edition when loading a project fails', async () => {
		const item = createItem(1);
		projectMocks.load.mockRejectedValue(new Error('project load failed'));

		const result = await new BatchTranslationService().addEditions(
			new Batch('Batch', [item], 10),
			[item],
			[edition, secondEdition]
		);

		expect(result).toEqual({ completed: 0, failed: 2, skipped: 0 });
		expect(item.translations[edition.name].status).toBe('failed');
		expect(item.translations[secondEdition.name].status).toBe('failed');
	});

	it('classifies each project after an edition-scoped fetch', async () => {
		const items = [createItem(1), createItem(2)];
		for (const item of items) {
			item.translations.edition = {
				editionName: 'edition',
				editionAuthor: 'Author',
				editionLanguage: 'English',
				status: 'ready_to_fetch',
				progress: 100,
				error: null,
				review: { total: 1, complete: 0, pending: 1, fetched: 0, toReview: 1, errors: 0 },
				addedAt: new Date(),
				fetchedAt: null,
				completedAt: null
			};
		}
		const projects = items.map((item) => createProject(item.projectId, async () => undefined));
		for (const project of projects) {
			project.content.projectTranslation.addedTranslationEditions.push(edition);
		}
		projectMocks.load.mockImplementation(async (id: number) => projects[id - 1]);
		translationMocks.fetch.mockImplementation(
			async ({ targetProject }: { targetProject: Project }) => {
				const pending = targetProject.detail.id === 1 ? 0 : 1;
				return {
					fetched: pending === 0 ? 1 : 0,
					review: {
						total: 1,
						complete: 1 - pending,
						pending,
						fetched: 1 - pending,
						toReview: pending,
						errors: 0
					}
				};
			}
		);

		await new BatchTranslationService().fetchEdition(
			new Batch('Batch', items, 10),
			items,
			'edition'
		);

		expect(items[0].translations.edition.status).toBe('auto_verified');
		expect(items[1].translations.edition.status).toBe('needs_review');
	});

	it('AI-splits every eligible project without replacing the current project', async () => {
		const items = [createItem(1), createItem(2)];
		const projects = items.map((item) => createProject(item.projectId, async () => undefined));
		projectMocks.load.mockImplementation(async (id: number) => projects[id - 1]);
		aiSplitMocks.buildCandidates.mockImplementation(async (_maxWords: number, project: Project) =>
			project.detail.id === 1 ? [{ segmentIndex: 0 }] : []
		);
		const splitBatch = { request: { s: [] }, segments: [{ segmentIndex: 0 }] };
		aiSplitMocks.buildBatches.mockReturnValue([splitBatch]);
		aiSplitMocks.run.mockResolvedValue({ parsed: { s: [] } });
		aiSplitMocks.validate.mockReturnValue({ validSegments: [{}], errors: [] });
		aiSplitMocks.apply.mockResolvedValue({
			appliedSegments: 1,
			appliedSplits: 1,
			erroredSegments: 0,
			errors: []
		});
		const currentProject = { detail: { id: 999 } } as Project;
		globalState.currentProject = currentProject;

		const result = await new BatchTranslationService().aiSplitLongSubtitles(
			new Batch('Batch', items, 10),
			items,
			5,
			aiSettings
		);

		expect(result).toEqual({ completed: 1, failed: 0, skipped: 1 });
		expect(aiSplitMocks.apply).toHaveBeenCalledWith([{}], projects[0]);
		expect(projects[0].save).toHaveBeenCalledOnce();
		expect(projects[1].save).not.toHaveBeenCalled();
		expect(globalState.currentProject).toBe(currentProject);
	});

	it('AI-trims the selected edition and skips projects where it is absent', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const items = [createItem(1), createItem(2)];
		items[0].translations.edition = {
			editionName: edition.name,
			editionAuthor: edition.author,
			editionLanguage: edition.language,
			status: 'needs_review',
			progress: 100,
			error: null,
			review: { total: 1, complete: 0, pending: 1, fetched: 0, toReview: 1, errors: 0 },
			addedAt: new Date(),
			fetchedAt: null,
			completedAt: null
		};
		const projects = items.map((item) => createProject(item.projectId, async () => undefined));
		projects[0].content.projectTranslation.addedTranslationEditions.push(edition);
		projectMocks.load.mockImplementation(async (id: number) => projects[id - 1]);
		aiTrimMocks.buildCandidates.mockReturnValue([{ verseKey: '1:1' }]);
		const trimBatch = { request: { verses: [] }, verses: [{ verseKey: '1:1' }] };
		aiTrimMocks.buildBatches.mockReturnValue([trimBatch]);
		aiTrimMocks.run.mockResolvedValue({ parsed: { verses: [] } });
		aiTrimMocks.validate.mockReturnValue({ validVerses: [{}], errors: [] });
		aiTrimMocks.apply.mockReturnValue({
			appliedSegments: 1,
			alignedSegments: 0,
			erroredSegments: 1,
			alignedVerses: 0,
			erroredVerses: 1,
			errors: ['The segment requires review.']
		});
		const currentProject = { detail: { id: 999 } } as Project;
		globalState.currentProject = currentProject;

		const result = await new BatchTranslationService().aiTrimEdition(
			new Batch('Batch', items, 10),
			items,
			edition.name,
			aiSettings
		);

		expect(result).toEqual({ completed: 1, failed: 0, skipped: 1 });
		expect(aiTrimMocks.apply).toHaveBeenCalledWith(edition, [{}], projects[0]);
		expect(items[0].translations.edition.status).toBe('needs_review');
		expect(items[0].translations.edition.error).toBeNull();
		expect(warn).toHaveBeenCalledWith(
			'[Batch AI Trim] Segments require review',
			expect.objectContaining({ projectId: 1, warnings: ['The segment requires review.'] })
		);
		expect(projects[0].save).toHaveBeenCalledOnce();
		expect(projects[1].save).not.toHaveBeenCalled();
		expect(globalState.currentProject).toBe(currentProject);
		warn.mockRestore();
	});

	it('reconciles a stale ready-to-fetch state when every translation is complete', async () => {
		const item = createItem(1);
		item.translations.edition = {
			editionName: edition.name,
			editionAuthor: edition.author,
			editionLanguage: edition.language,
			status: 'ready_to_fetch',
			progress: 100,
			error: null,
			review: { total: 5, complete: 3, pending: 2, fetched: 3, toReview: 2, errors: 0 },
			addedAt: new Date(),
			fetchedAt: null,
			completedAt: null
		};
		const project = createProject(1, async () => undefined);
		project.content.projectTranslation.addedTranslationEditions.push(edition);
		projectMocks.load.mockResolvedValue(project);
		translationMocks.getCounts.mockReturnValue({
			total: 5,
			complete: 5,
			pending: 0,
			fetched: 3,
			toReview: 0,
			errors: 0
		});
		const batch = new Batch('Batch', [item], 10);

		expect(await reconcileBatchTranslations(batch)).toBe(true);

		expect(item.translations.edition.status).toBe('auto_verified');
		expect(item.translations.edition.review.pending).toBe(0);
		expect(item.translations.edition.completedAt).toBeInstanceOf(Date);
		expect(batchMocks.save).toHaveBeenCalledWith(batch);
	});

	it('refills free fetch workers immediately and reports their aggregate progress', async () => {
		const items = Array.from({ length: 4 }, (_, index) => createItem(index + 1));
		for (const item of items) {
			item.translations.edition = {
				editionName: 'edition',
				editionAuthor: 'Author',
				editionLanguage: 'English',
				status: 'ready_to_fetch',
				progress: 100,
				error: null,
				review: { total: 1, complete: 0, pending: 1, fetched: 0, toReview: 1, errors: 0 },
				addedAt: new Date(),
				fetchedAt: null,
				completedAt: null
			};
		}
		const projects = items.map((item) => createProject(item.projectId, async () => undefined));
		for (const project of projects) {
			project.content.projectTranslation.addedTranslationEditions.push(edition);
		}
		projectMocks.load.mockImplementation(async (id: number) => projects[id - 1]);
		const started: number[] = [];
		const release = new Map<number, () => void>();
		translationMocks.fetch.mockImplementation(
			({
				targetProject,
				onProgress
			}: {
				targetProject: Project;
				onProgress?: (progress: number) => void;
			}) => {
				started.push(targetProject.detail.id);
				onProgress?.(50);
				return new Promise((resolve) => {
					release.set(targetProject.detail.id, () =>
						resolve({
							fetched: 1,
							review: {
								total: 1,
								complete: 1,
								pending: 0,
								fetched: 1,
								toReview: 0,
								errors: 0
							}
						})
					);
				});
			}
		);
		const progress: BatchTranslationQueueProgress[] = [];
		const run = new BatchTranslationService({
			onProgress: (value) => progress.push(value)
		}).fetchEdition(new Batch('Batch', items, 10), items, 'edition');

		await vi.waitFor(() => expect(started).toEqual([1, 2, 3]));
		release.get(1)!();
		await vi.waitFor(() => expect(started).toEqual([1, 2, 3, 4]));
		for (const id of [2, 3, 4]) release.get(id)!();
		await run;

		expect(progress.some((value) => value.active === 3 && value.progress > 0)).toBe(true);
		expect(progress.at(-1)).toMatchObject({
			active: 0,
			completed: 4,
			remaining: 0,
			progress: 100,
			total: 4
		});
	});
});
