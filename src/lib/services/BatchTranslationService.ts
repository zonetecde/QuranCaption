import {
	Edition,
	createDefaultBatchTranslationState,
	isBatchProjectSegmentationVerified,
	type Batch,
	type BatchProjectItem,
	type BatchProjectTranslationState
} from '$lib/classes';
import { globalState } from '$lib/runes/main.svelte';
import { BatchService } from './BatchService';
import { ProjectService } from './ProjectService';
import {
	fetchTranslationsFromOtherProjects,
	getProjectSubtitleClips,
	getProjectTranslationReviewCounts
} from './TranslationFetchService';
import { runBatchWorkerPool } from './BatchWorkerPool';

export const BATCH_TRANSLATION_CONCURRENCY = 3;

export type BatchTranslationActivity = 'adding' | 'fetching' | 'saving';

export interface BatchTranslationServiceOptions {
	onUpdate?: (
		item: BatchProjectItem,
		editionName: string,
		activity: BatchTranslationActivity
	) => void;
	onProgress?: (progress: BatchTranslationQueueProgress) => void;
}

export interface BatchTranslationQueueProgress {
	active: number;
	completed: number;
	failed: number;
	skipped: number;
	remaining: number;
	progress: number;
	total: number;
}

export interface BatchTranslationRunResult {
	completed: number;
	failed: number;
	skipped: number;
}

/**
 * Copie une édition afin que chaque projet sauvegarde sa propre instance.
 * @param {Edition} edition Édition source.
 * @returns {Edition} Nouvelle instance équivalente.
 */
function cloneEdition(edition: Edition): Edition {
	return new Edition(
		edition.key,
		edition.name,
		edition.author,
		edition.language,
		edition.direction,
		edition.source,
		edition.comments,
		edition.link,
		edition.linkmin,
		edition.showInTranslationsEditor
	);
}

export class BatchTranslationService {
	private readonly onUpdate?: BatchTranslationServiceOptions['onUpdate'];
	private readonly onProgress?: BatchTranslationServiceOptions['onProgress'];
	private saveChain: Promise<void> = Promise.resolve();

	/**
	 * Crée le service d'orchestration des traductions Batch.
	 * @param {BatchTranslationServiceOptions} options Callback UI éventuel.
	 */
	constructor(options: BatchTranslationServiceOptions = {}) {
		this.onUpdate = options.onUpdate;
		this.onProgress = options.onProgress;
	}

	/**
	 * Sérialise les sauvegardes concurrentes du manifeste.
	 * @param {Batch} batch Manifeste à persister.
	 * @returns {Promise<void>} Résolution après l'écriture correspondante.
	 */
	private saveBatch(batch: Batch): Promise<void> {
		batch.updatedAt = new Date();
		this.saveChain = this.saveChain.then(() => BatchService.save(batch));
		return this.saveChain;
	}

	/**
	 * Retourne ou initialise le résumé d'une édition pour une ligne Batch.
	 * @param {BatchProjectItem} item Ligne cible.
	 * @param {Edition} edition Édition suivie.
	 * @returns {BatchProjectTranslationState} État persistant de l'édition.
	 */
	private getState(item: BatchProjectItem, edition: Edition): BatchProjectTranslationState {
		return (item.translations[edition.name] ??= createDefaultBatchTranslationState({
			editionName: edition.name,
			editionAuthor: edition.author,
			editionLanguage: edition.language
		}));
	}

	/**
	 * Ajoute plusieurs éditions aux projets avec trois workers au maximum.
	 * @param {Batch} batch Manifeste parent.
	 * @param {BatchProjectItem[]} items Projets sélectionnés dans l'ordre du Batch.
	 * @param {Edition[]} editions Éditions choisies.
	 * @param {boolean} skipExisting Ignore les éditions déjà présentes.
	 * @returns {Promise<BatchTranslationRunResult>} Résumé de la queue.
	 */
	async addEditions(
		batch: Batch,
		items: BatchProjectItem[],
		editions: Edition[],
		skipExisting: boolean = true
	): Promise<BatchTranslationRunResult> {
		const result: BatchTranslationRunResult = { completed: 0, failed: 0, skipped: 0 };
		await runBatchWorkerPool(items, BATCH_TRANSLATION_CONCURRENCY, async (item) => {
			if (!isBatchProjectSegmentationVerified(item)) {
				result.skipped++;
				return;
			}
			try {
				const project = await ProjectService.load(item.projectId);
				if (getProjectSubtitleClips(project).length === 0) {
					result.skipped++;
					return;
				}
				for (const sourceEdition of editions) {
					const edition = cloneEdition(sourceEdition);
					const exists = project.content.projectTranslation.addedTranslationEditions.some(
						(candidate) => candidate.name === edition.name
					);
					if (exists && skipExisting) {
						const state = this.getState(item, edition);
						state.review = getProjectTranslationReviewCounts(project, edition.name);
						state.status = state.review.pending === 0 ? 'auto_verified' : 'ready_to_fetch';
						state.progress = 100;
						await this.saveBatch(batch);
						this.onUpdate?.(item, edition.name, 'saving');
						result.skipped++;
						continue;
					}
					const state = this.getState(item, edition);
					state.status = 'adding';
					state.progress = 0;
					state.error = null;
					this.onUpdate?.(item, edition.name, 'adding');
					await this.saveBatch(batch);

					const translations =
						await project.content.projectTranslation.getAllProjectSubtitlesTranslationsForProject(
							project,
							edition
						);
					state.progress = 80;
					this.onUpdate?.(item, edition.name, 'adding');
					await project.content.projectTranslation.addTranslationToProject(
						project,
						edition,
						translations,
						{ replaceExisting: exists && !skipExisting }
					);
					state.progress = 95;
					this.onUpdate?.(item, edition.name, 'saving');
					await project.save();
					state.review = getProjectTranslationReviewCounts(project, edition.name);
					state.status = state.review.pending === 0 ? 'auto_verified' : 'ready_to_fetch';
					state.progress = 100;
					state.addedAt ??= new Date();
					state.completedAt = state.review.pending === 0 ? new Date() : null;
					await this.saveBatch(batch);
					this.onUpdate?.(item, edition.name, 'saving');
					result.completed++;
				}
			} catch (error) {
				for (const edition of editions) {
					const state = this.getState(item, edition);
					if (!['not_added', 'adding'].includes(state.status)) continue;
					state.status = 'failed';
					state.error = String(error);
					state.progress = 0;
					this.onUpdate?.(item, edition.name, 'adding');
				}
				await this.saveBatch(batch);
				result.failed++;
			}
		});
		await this.saveChain;
		return result;
	}

	/**
	 * Fetch une édition précise dans les projets avec trois workers au maximum.
	 * @param {Batch} batch Manifeste parent.
	 * @param {BatchProjectItem[]} items Projets sélectionnés.
	 * @param {string} editionName Édition cible unique.
	 * @returns {Promise<BatchTranslationRunResult>} Résumé de la queue.
	 */
	async fetchEdition(
		batch: Batch,
		items: BatchProjectItem[],
		editionName: string
	): Promise<BatchTranslationRunResult> {
		const result: BatchTranslationRunResult = { completed: 0, failed: 0, skipped: 0 };
		const progressByProject = new Map(items.map((item) => [item.projectId, 0]));
		let active = 0;
		/**
		 * Publie l'avancement agrégé des projets de cette exécution uniquement.
		 * @returns {void}
		 */
		const reportProgress = (): void => {
			const processed = result.completed + result.failed + result.skipped;
			this.onProgress?.({
				active,
				completed: result.completed,
				failed: result.failed,
				skipped: result.skipped,
				remaining: Math.max(items.length - active - processed, 0),
				progress: Math.round(
					[...progressByProject.values()].reduce((sum, progress) => sum + progress, 0) /
						Math.max(items.length, 1)
				),
				total: items.length
			});
		};
		reportProgress();
		if (globalState.userProjectsDetails.length === 0)
			await ProjectService.loadUserProjectsDetails();
		await runBatchWorkerPool(items, BATCH_TRANSLATION_CONCURRENCY, async (item) => {
			const state = item.translations[editionName];
			if (!state) {
				result.skipped++;
				progressByProject.set(item.projectId, 100);
				reportProgress();
				return;
			}
			active++;
			reportProgress();
			try {
				const project = await ProjectService.load(item.projectId);
				const edition = project.content.projectTranslation.addedTranslationEditions.find(
					(candidate) => candidate.name === editionName
				);
				if (!edition) {
					result.skipped++;
					return;
				}
				state.status = 'fetching';
				state.progress = 0;
				state.error = null;
				this.onUpdate?.(item, editionName, 'fetching');
				await this.saveBatch(batch);
				const fetchResult = await fetchTranslationsFromOtherProjects({
					targetProject: project,
					edition,
					sourceProjectDetails: globalState.userProjectsDetails,
					onProgress: (progress) => {
						state.progress = Math.round(progress * 0.9);
						progressByProject.set(item.projectId, state.progress);
						this.onUpdate?.(item, editionName, 'fetching');
						reportProgress();
					}
				});
				state.progress = 90;
				progressByProject.set(item.projectId, state.progress);
				state.review = fetchResult.review;
				this.onUpdate?.(item, editionName, 'fetching');
				project.content.projectTranslation.updateProjectPercentage(project, edition);
				state.progress = 98;
				progressByProject.set(item.projectId, state.progress);
				this.onUpdate?.(item, editionName, 'saving');
				await project.save();
				state.status = state.review.pending === 0 ? 'auto_verified' : 'needs_review';
				state.progress = 100;
				state.fetchedAt = new Date();
				state.completedAt = state.review.pending === 0 ? new Date() : null;
				await this.saveBatch(batch);
				this.onUpdate?.(item, editionName, 'saving');
				result.completed++;
			} catch (error) {
				state.status = 'failed';
				state.error = String(error);
				state.progress = 0;
				this.onUpdate?.(item, editionName, 'fetching');
				await this.saveBatch(batch);
				result.failed++;
			} finally {
				active--;
				progressByProject.set(item.projectId, 100);
				reportProgress();
			}
		});
		await this.saveChain;
		return result;
	}
}

/**
 * Réconcilie uniquement les résumés de traduction susceptibles d'être obsolètes.
 * @param {Batch} batch Manifeste à vérifier.
 * @returns {Promise<boolean>} `true` si le manifeste a changé.
 */
export async function reconcileBatchTranslations(batch: Batch): Promise<boolean> {
	let changed = false;
	for (const item of batch.projects) {
		const states = Object.values(item.translations).filter(
			(state) =>
				state.status === 'ready_to_fetch' ||
				state.status === 'needs_review' ||
				state.review.total === 0 ||
				state.error === 'TRANSLATION_INTERRUPTED'
		);
		if (states.length === 0) continue;
		try {
			const project = await ProjectService.load(item.projectId);
			for (const state of states) {
				const edition = project.content.projectTranslation.addedTranslationEditions.find(
					(candidate) => candidate.name === state.editionName
				);
				if (!edition) continue;
				const review = getProjectTranslationReviewCounts(project, state.editionName);
				if (JSON.stringify(review) !== JSON.stringify(state.review)) {
					state.review = review;
					changed = true;
				}
				if (
					review.total > 0 &&
					(state.status === 'not_added' || state.error === 'TRANSLATION_INTERRUPTED')
				) {
					state.status = review.pending === 0 ? 'auto_verified' : 'ready_to_fetch';
					state.error = null;
					state.progress = 100;
					state.addedAt ??= new Date();
					state.completedAt = review.pending === 0 ? new Date() : null;
					changed = true;
				}
				if (state.status === 'ready_to_fetch' && review.pending === 0) {
					state.status = 'auto_verified';
					state.completedAt = new Date();
					changed = true;
				}
				if (state.status === 'needs_review' && review.pending === 0) {
					state.status = 'manually_verified';
					state.completedAt = new Date();
					changed = true;
				}
			}
		} catch {
			// Un projet illisible conserve son résumé; les actions afficheront l'erreur à l'exécution.
		}
	}
	if (changed) {
		batch.updatedAt = new Date();
		await BatchService.save(batch);
	}
	return changed;
}
