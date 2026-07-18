import { beforeEach, describe, expect, it, vi } from 'vitest';

const batchMocks = vi.hoisted(() => ({ save: vi.fn(async () => undefined) }));
const projectMocks = vi.hoisted(() => ({ load: vi.fn(), loadUserProjectsDetails: vi.fn() }));
const translationMocks = vi.hoisted(() => ({
	getClips: vi.fn(),
	getCounts: vi.fn(),
	fetch: vi.fn()
}));

vi.mock('$lib/services/BatchService', () => ({ BatchService: batchMocks }));
vi.mock('$lib/services/ProjectService', () => ({ ProjectService: projectMocks }));
vi.mock('$lib/services/TranslationFetchService', () => ({
	getProjectSubtitleClips: translationMocks.getClips,
	getProjectTranslationReviewCounts: translationMocks.getCounts,
	fetchTranslationsFromOtherProjects: translationMocks.fetch
}));

import {
	Batch,
	Edition,
	createDefaultBatchSegmentationState,
	type BatchProjectItem,
	type Project
} from '$lib/classes';
import { globalState } from '$lib/runes/main.svelte';
import {
	BATCH_TRANSLATION_CONCURRENCY,
	BatchTranslationService
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
		translations: {}
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
		translationMocks.getClips.mockReturnValue([{}]);
		translationMocks.getCounts.mockReturnValue({
			total: 1,
			complete: 0,
			pending: 1,
			fetched: 0,
			toReview: 1,
			errors: 0
		});
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
});
