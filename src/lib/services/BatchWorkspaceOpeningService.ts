import type { Batch } from '$lib/classes';
import { BatchService } from './BatchService';
import { reconcileBatchSegmentations } from './BatchSegmentationService';
import { reconcileBatchTranslations } from './BatchTranslationService';

interface BatchWorkspaceOpeningDependencies {
	loadBatch: (batchId: number, interruptedError: string) => Promise<Batch>;
	reconcileSegmentations: (batch: Batch) => Promise<boolean>;
	reconcileTranslations: (batch: Batch) => Promise<boolean>;
}

const DEFAULT_DEPENDENCIES: BatchWorkspaceOpeningDependencies = {
	loadBatch: BatchService.load.bind(BatchService),
	reconcileSegmentations: reconcileBatchSegmentations,
	reconcileTranslations: reconcileBatchTranslations
};

/**
 * Ouvre un Batch prêt à être utilisé après récupération et réconciliation de ses projets.
 * @param {number} batchId Identifiant du Batch à ouvrir.
 * @param {string} interruptedError Message localisé pour les imports média interrompus.
 * @param {BatchWorkspaceOpeningDependencies} dependencies Dépendances substituables pour les tests.
 * @returns {Promise<Batch>} Batch normalisé et réconcilié.
 */
export async function openBatchWorkspace(
	batchId: number,
	interruptedError: string,
	dependencies: BatchWorkspaceOpeningDependencies = DEFAULT_DEPENDENCIES
): Promise<Batch> {
	const batch = await dependencies.loadBatch(batchId, interruptedError);
	await dependencies.reconcileSegmentations(batch);
	await dependencies.reconcileTranslations(batch);
	return batch;
}
