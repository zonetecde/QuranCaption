import {
	Batch,
	Utilities,
	createDefaultBatchExportState,
	createDefaultBatchSegmentationState,
	createDefaultBatchStyleState,
	type BatchDetail,
	type BatchProjectItem
} from '$lib/classes';
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
		if (interruptedError) {
			await this.normalizeInterruptedMedia(batch, interruptedError);
			await this.normalizeInterruptedSegmentation(batch);
			await this.normalizeInterruptedTranslations(batch);
			await this.normalizeInterruptedStyle(batch);
			await this.normalizeInterruptedExport(batch);
		}
		return batch;
	}

	/**
	 * Charge tous les manifests de batch sauvegardés.
	 * @returns {Promise<Batch[]>} Batches restaurés dans leur format courant.
	 */
	static async loadAll(): Promise<Batch[]> {
		const batchesPath = await this.getBatchesFolderPath();
		const entries = await readDir(batchesPath);
		const batches: Batch[] = [];
		for (const entry of entries) {
			if (!entry.isFile || !entry.name?.endsWith('.json')) continue;
			const batchId = Number.parseInt(entry.name.replace('.json', ''), 10);
			if (Number.isFinite(batchId)) batches.push(await this.load(batchId));
		}
		return batches;
	}

	/**
	 * Importe des manifests de batch sans écraser ceux déjà présents.
	 * @param {Record<string, unknown>[]} batches Données Batch désérialisées du backup.
	 * @returns {Promise<{ imported: number; skipped: number; invalid: number }>} Résultat d'import.
	 */
	static async importBatchesBackup(batches: Record<string, unknown>[]): Promise<{
		imported: number;
		skipped: number;
		invalid: number;
	}> {
		if (!Array.isArray(batches)) throw new Error('Backup batches must be an array.');
		const batchesPath = await this.getBatchesFolderPath();
		const entries = await readDir(batchesPath);
		const existingIds = new Set(
			entries
				.filter((entry) => entry.isFile && entry.name?.endsWith('.json'))
				.map((entry) => Number.parseInt(entry.name!.replace('.json', ''), 10))
				.filter(Number.isFinite)
		);
		const seenBackupIds = new Set<number>();
		let imported = 0;
		let skipped = 0;
		let invalid = 0;
		for (const rawBatch of batches) {
			const batchId = rawBatch?.id;
			if (typeof batchId !== 'number' || !Number.isFinite(batchId)) {
				invalid++;
				continue;
			}
			if (existingIds.has(batchId) || seenBackupIds.has(batchId)) {
				skipped++;
				continue;
			}
			try {
				const batch = Batch.fromJSON(rawBatch) as Batch;
				await this.save(batch);
				existingIds.add(batchId);
				seenBackupIds.add(batchId);
				imported++;
			} catch (error) {
				console.warn(`Failed to import backup batch ${batchId}:`, error);
				invalid++;
			}
		}
		await this.loadUserBatchesDetails();
		return { imported, skipped, invalid };
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
	 * Convertit les segmentations abandonnées en échecs relançables sans supprimer leurs clips.
	 * @param {Batch} batch Batch venant d'être chargé.
	 * @returns {Promise<boolean>} `true` lorsqu'une sauvegarde a été nécessaire.
	 */
	static async normalizeInterruptedSegmentation(batch: Batch): Promise<boolean> {
		let changed = false;
		for (const project of batch.projects) {
			if (project.segmentation.status !== 'queued' && project.segmentation.status !== 'processing')
				continue;
			project.segmentation.status = 'failed';
			project.segmentation.error = 'SEGMENTATION_INTERRUPTED';
			project.segmentation.completedAt = new Date();
			changed = true;
		}
		if (changed) {
			batch.updatedAt = new Date();
			await this.save(batch);
		}
		return changed;
	}

	/**
	 * Convertit les opérations de traduction abandonnées en échecs relançables.
	 * @param {Batch} batch Batch venant d'être chargé.
	 * @returns {Promise<boolean>} `true` lorsqu'une sauvegarde a été nécessaire.
	 */
	static async normalizeInterruptedTranslations(batch: Batch): Promise<boolean> {
		let changed = false;
		for (const project of batch.projects) {
			for (const state of Object.values(project.translations)) {
				if (state.status !== 'adding' && state.status !== 'fetching') continue;
				state.status = 'failed';
				state.error = 'TRANSLATION_INTERRUPTED';
				state.progress = 0;
				changed = true;
			}
		}
		if (changed) {
			batch.updatedAt = new Date();
			await this.save(batch);
		}
		return changed;
	}

	/**
	 * Convertit une application de style abandonnée en échec relançable.
	 * @param {Batch} batch Batch venant d'être chargé.
	 * @returns {Promise<boolean>} `true` lorsqu'une sauvegarde a été nécessaire.
	 */
	static async normalizeInterruptedStyle(batch: Batch): Promise<boolean> {
		let changed = false;
		for (const project of batch.projects) {
			if (project.style.status !== 'queued' && project.style.status !== 'processing') continue;
			project.style.status = 'failed';
			project.style.error = 'STYLE_INTERRUPTED';
			project.style.progress = 0;
			changed = true;
		}
		if (changed) {
			batch.updatedAt = new Date();
			await this.save(batch);
		}
		return changed;
	}

	/**
	 * Convertit un export Batch abandonné en échec relançable.
	 * @param {Batch} batch Batch venant d'être chargé.
	 * @returns {Promise<boolean>} `true` lorsqu'une sauvegarde a été nécessaire.
	 */
	static async normalizeInterruptedExport(batch: Batch): Promise<boolean> {
		let changed = false;
		for (const project of batch.projects) {
			if (project.export.status !== 'queued' && project.export.status !== 'processing') continue;
			project.export.status = 'failed';
			project.export.error = 'EXPORT_INTERRUPTED';
			project.export.progress = 0;
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
					},
					segmentation: createDefaultBatchSegmentationState(),
					translations: {},
					style: createDefaultBatchStyleState(),
					export: createDefaultBatchExportState()
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
