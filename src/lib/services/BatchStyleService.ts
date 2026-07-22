import type { Batch, BatchProjectItem, Project } from '$lib/classes';
import type { SavedVideoStylePreset } from '$lib/classes/Settings.svelte';
import { BatchService } from './BatchService';
import { ProjectService } from './ProjectService';
import { runBatchWorkerPool } from './BatchWorkerPool';

export const BATCH_STYLE_CONCURRENCY = 3;

export interface BatchStyleProgress {
	active: number;
	completed: number;
	failed: number;
	remaining: number;
	total: number;
}

type BatchStyleUpdate = (item: BatchProjectItem, progress: BatchStyleProgress) => void;

export interface BatchStyleServiceOptions {
	loadProject?: (projectId: number) => Promise<Project>;
	saveProject?: (project: Project) => Promise<void>;
	saveBatch?: (batch: Batch) => Promise<void>;
	applyPreset?: (project: Project, preset: SavedVideoStylePreset) => Promise<void>;
	onUpdate?: BatchStyleUpdate;
}

export class BatchStyleService {
	private readonly loadProject: NonNullable<BatchStyleServiceOptions['loadProject']>;
	private readonly saveProject: NonNullable<BatchStyleServiceOptions['saveProject']>;
	private readonly saveBatch: NonNullable<BatchStyleServiceOptions['saveBatch']>;
	private readonly applyPreset: NonNullable<BatchStyleServiceOptions['applyPreset']>;
	private readonly onUpdate?: BatchStyleUpdate;
	private saveChain: Promise<void> = Promise.resolve();

	/**
	 * Crée l'orchestrateur project-scoped avec des dépendances injectables pour les tests.
	 * @param {BatchStyleServiceOptions} options Dépendances et callback de progression.
	 */
	constructor(options: BatchStyleServiceOptions = {}) {
		this.loadProject = options.loadProject ?? ProjectService.load.bind(ProjectService);
		this.saveProject = options.saveProject ?? ProjectService.save.bind(ProjectService);
		this.saveBatch = options.saveBatch ?? BatchService.save.bind(BatchService);
		this.applyPreset =
			options.applyPreset ??
			(async (project, preset) => {
				await project.content.videoStyle.importStyles(preset.data, project.content);
			});
		this.onUpdate = options.onUpdate;
	}

	/**
	 * Applique un preset unique aux projets fournis avec trois workers maximum.
	 * @param {Batch} batch Batch complet à modifier.
	 * @param {BatchProjectItem[]} selectedItems Projets cochés à modifier.
	 * @param {SavedVideoStylePreset} preset Preset local sélectionné.
	 * @returns {Promise<BatchStyleProgress>} Résumé final de l'exécution.
	 */
	async run(
		batch: Batch,
		selectedItems: BatchProjectItem[],
		preset: SavedVideoStylePreset
	): Promise<BatchStyleProgress> {
		const items = [...selectedItems].sort((left, right) => left.order - right.order);
		for (const item of items) {
			item.style = {
				status: 'queued',
				presetId: preset.id,
				presetName: preset.name,
				progress: 0,
				error: null,
				appliedAt: null
			};
		}
		await this.persist(batch);

		let active = 0;
		let completed = 0;
		let failed = 0;
		await runBatchWorkerPool(items, BATCH_STYLE_CONCURRENCY, async (item) => {
			active++;
			item.style.status = 'processing';
			item.style.progress = 10;
			this.notify(
				item,
				active,
				completed,
				failed,
				items.length - completed - failed - active,
				items.length
			);
			await this.persist(batch);
			try {
				const project = await this.loadProject(item.projectId);
				await this.applyPreset(project, preset);
				await this.saveProject(project);
				item.style.status = 'completed';
				item.style.progress = 100;
				item.style.appliedAt = new Date();
				completed++;
			} catch (error) {
				item.style.status = 'failed';
				item.style.progress = 0;
				item.style.error = String(error);
				failed++;
			} finally {
				active--;
				this.notify(
					item,
					active,
					completed,
					failed,
					items.length - completed - failed - active,
					items.length
				);
				await this.persist(batch);
			}
		});
		await this.saveChain;
		return { active: 0, completed, failed, remaining: 0, total: items.length };
	}

	/**
	 * Sérialise les écritures du manifeste produites par les workers concurrents.
	 * @param {Batch} batch Batch à persister.
	 * @returns {Promise<void>} Écriture ajoutée à la chaîne.
	 */
	private persist(batch: Batch): Promise<void> {
		batch.updatedAt = new Date();
		this.saveChain = this.saveChain.then(() => this.saveBatch(batch));
		return this.saveChain;
	}

	/**
	 * Publie un instantané stable de la progression globale.
	 * @param {BatchProjectItem} item Projet venant de changer.
	 * @param {number} active Nombre de workers actifs.
	 * @param {number} completed Nombre de succès.
	 * @param {number} failed Nombre d'échecs.
	 * @param {number} remaining Nombre de projets en attente.
	 * @param {number} total Nombre total de projets.
	 * @returns {void}
	 */
	private notify(
		item: BatchProjectItem,
		active: number,
		completed: number,
		failed: number,
		remaining: number,
		total: number
	): void {
		this.onUpdate?.(item, { active, completed, failed, remaining, total });
	}
}
