import { Batch, Utilities, type BatchDetail, type BatchProjectItem } from '$lib/classes';
import type { ValidatedBatchRow } from '$lib/components/batch/batchCsv';
import { globalState } from '$lib/runes/main.svelte';
import { ProjectService } from '$lib/services/ProjectService';
import { DEFAULT_PROJECT_TYPE } from '$lib/types/projectType';
import { join } from '@tauri-apps/api/path';
import { exists, readDir, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs';

export class BatchService {
	private static batchesFolder = 'batches/';

	/**
	 * Retourne le dossier persistant des manifestes de batch.
	 * @returns {Promise<string>} Chemin absolu du dossier.
	 */
	static async getBatchesFolderPath(): Promise<string> {
		return ProjectService.ensureFolder(this.batchesFolder);
	}

	/**
	 * Sauvegarde un manifeste de batch.
	 * @param {Batch} batch Batch à sauvegarder.
	 * @returns {Promise<void>} Promesse résolue après l'écriture.
	 */
	static async save(batch: Batch): Promise<void> {
		const filePath = await join(await this.getBatchesFolderPath(), `${batch.id}.json`);
		await writeTextFile(filePath, JSON.stringify(batch.toJSON(), null, 2));
	}

	/**
	 * Charge un manifeste de batch.
	 * @param {number} batchId Identifiant du batch.
	 * @param {string | undefined} interruptedError Message utilisé lors de l'ouverture du workspace.
	 * @returns {Promise<Batch>} Batch désérialisé.
	 */
	static async load(batchId: number, interruptedError?: string): Promise<Batch> {
		const filePath = await join(await this.getBatchesFolderPath(), `${batchId}.json`);
		if (!(await exists(filePath))) throw new Error(`Batch with ID ${batchId} not found.`);
		const batch = Batch.fromJSON(JSON.parse(await readTextFile(filePath))) as Batch;
		if (batch.version !== 1) throw new Error(`Unsupported batch version: ${batch.version}`);
		if (interruptedError) await this.normalizeInterruptedMedia(batch, interruptedError);
		return batch;
	}

	/**
	 * Convertit les opérations média abandonnées en échecs relançables.
	 * @param {Batch} batch Batch venant d'être chargé.
	 * @param {string} error Message localisé à conserver dans le manifeste.
	 * @returns {Promise<boolean>} `true` lorsqu'une sauvegarde a été nécessaire.
	 */
	static async normalizeInterruptedMedia(batch: Batch, error: string): Promise<boolean> {
		let changed = false;
		for (const project of batch.projects) {
			if (project.media.status !== 'queued' && project.media.status !== 'processing') continue;
			project.media.status = 'failed';
			project.media.error = error;
			changed = true;
		}
		if (changed) {
			batch.updatedAt = new Date();
			await this.save(batch);
		}
		return changed;
	}

	/**
	 * Supprime uniquement le manifeste du batch demandé.
	 * @param {number} batchId Identifiant du batch.
	 * @returns {Promise<void>} Promesse résolue après la suppression éventuelle.
	 */
	static async delete(batchId: number): Promise<void> {
		const filePath = await join(await this.getBatchesFolderPath(), `${batchId}.json`);
		if (await exists(filePath)) await remove(filePath);
	}

	/**
	 * Charge les métadonnées légères de tous les batches pour la homepage.
	 * @returns {Promise<BatchDetail[]>} Détails triés par dernière modification.
	 */
	static async loadUserBatchesDetails(): Promise<BatchDetail[]> {
		try {
			const batchesPath = await this.getBatchesFolderPath();
			const entries = await readDir(batchesPath);
			const details = (
				await Promise.all(
					entries
						.filter((entry) => entry.isFile && entry.name?.endsWith('.json'))
						.map(async (entry) => {
							try {
								const batchId = Number.parseInt(entry.name!.replace('.json', ''), 10);
								return Number.isFinite(batchId) ? (await this.load(batchId)).toDetail() : null;
							} catch (error) {
								console.warn(`Impossible de charger le batch ${entry.name}:`, error);
								return null;
							}
						})
				)
			).filter((detail): detail is BatchDetail => detail !== null);
			details.sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
			globalState.userBatchDetails = details;
			return details;
		} catch {
			globalState.userBatchDetails = [];
			return [];
		}
	}

	/**
	 * Crée les projets validés puis leur manifeste, avec rollback en cas d'échec.
	 * @param {string} name Nom validé du batch.
	 * @param {ValidatedBatchRow[]} rows Lignes CSV validées dans leur ordre d'origine.
	 * @returns {Promise<Batch>} Batch créé et sauvegardé.
	 */
	static async createBatch(name: string, rows: ValidatedBatchRow[]): Promise<Batch> {
		const batch = new Batch(name.trim());
		const batchesPath = await this.getBatchesFolderPath();
		while (await exists(await join(batchesPath, `${batch.id}.json`))) {
			batch.id = Utilities.randomId();
		}
		const createdProjectIds: number[] = [];

		try {
			for (const row of rows) {
				const project = await ProjectService.createEmptyProject({
					name: row.projectName,
					reciter: row.reciter,
					projectType: DEFAULT_PROJECT_TYPE,
					batchId: batch.id,
					batchOrder: row.order
				});
				createdProjectIds.push(project.detail.id);
				const item: BatchProjectItem = {
					order: row.order,
					projectId: project.detail.id,
					projectName: row.projectName,
					reciter: row.reciter,
					source: row.batchSource,
					media: {
						status: 'pending',
						progress: 0,
						error: null,
						resolvedAssetPath: null,
						mode: null,
						assetId: null
					}
				};
				batch.projects.push(item);
			}

			await this.save(batch);
			await Promise.all([ProjectService.loadUserProjectsDetails(), this.loadUserBatchesDetails()]);
			return batch;
		} catch (error) {
			await Promise.allSettled(
				createdProjectIds.map((projectId) => ProjectService.delete(projectId))
			);
			await this.delete(batch.id).catch(() => undefined);
			throw error;
		}
	}
}
