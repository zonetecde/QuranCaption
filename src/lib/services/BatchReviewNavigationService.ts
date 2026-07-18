import { ProjectEditorTabs, type Batch, type BatchProjectItem, type Project } from '$lib/classes';
import LL from '$lib/i18n/i18n-svelte';
import { globalState } from '$lib/runes/main.svelte';
import { get } from 'svelte/store';
import toast from 'svelte-5-french-toast';
import { BatchService } from './BatchService';
import { reconcileBatchProjectSegmentation } from './BatchSegmentationService';
import { ProjectService } from './ProjectService';

export type BatchReviewDirection = 'previous' | 'next';

/**
 * Résout un message localisé de revue avant la génération des types i18n.
 * @param {string} key Clé Batch à résoudre.
 * @param {Record<string, string | number>} params Paramètres du message.
 * @returns {string} Texte localisé.
 */
function reviewMessage(key: string, params: Record<string, string | number> = {}): string {
	const translator = Reflect.get(get(LL).batch, key) as
		| ((values?: Record<string, string | number>) => string)
		| undefined;
	return translator?.(params) ?? key;
}

/**
 * Active une session de revue Batch sans la sérialiser.
 * @param {number} batchId Identifiant du Batch.
 * @param {number} projectId Projet signalé initial.
 * @returns {void}
 */
export function startBatchReview(batchId: number, projectId: number): void {
	globalState.shared.batchReview.active = true;
	globalState.shared.batchReview.batchId = batchId;
	globalState.shared.batchReview.currentProjectId = projectId;
	globalState.shared.batchReview.isNavigating = false;
}

/**
 * Réinitialise complètement la session de revue courante.
 * @returns {void}
 */
export function stopBatchReview(): void {
	globalState.shared.batchReview.active = false;
	globalState.shared.batchReview.batchId = null;
	globalState.shared.batchReview.currentProjectId = null;
	globalState.shared.batchReview.isNavigating = false;
}

/**
 * Indique si une session de revue cohérente est active.
 * @returns {boolean} `true` lorsque la session possède un Batch.
 */
export function isBatchReviewActive(): boolean {
	return globalState.shared.batchReview.active && globalState.shared.batchReview.batchId !== null;
}

/**
 * Charge un projet signalé et force l'onglet Subtitles editor.
 * @param {number} projectId Identifiant du projet cible.
 * @param {number} batchId Identifiant du Batch attendu.
 * @returns {Promise<Project>} Projet chargé et préparé.
 */
async function loadReviewProject(projectId: number, batchId: number): Promise<Project> {
	const project = await ProjectService.load(projectId);
	if (project.detail.batchId !== batchId) throw new Error('INVALID_BATCH_REVIEW_PROJECT');
	project.projectEditorState.currentTab = ProjectEditorTabs.SubtitlesEditor;
	return project;
}

/**
 * Démarre la revue sur un projet `needs_review` précis.
 * @param {number} batchId Identifiant du Batch.
 * @param {number} projectId Identifiant du projet signalé.
 * @returns {Promise<boolean>} `true` lorsque le projet a été ouvert.
 */
export async function openBatchReviewProject(batchId: number, projectId: number): Promise<boolean> {
	try {
		const batch = await BatchService.load(batchId);
		const item = batch.projects.find(
			(project) => project.projectId === projectId && project.segmentation.status === 'needs_review'
		);
		if (!item) throw new Error('INVALID_BATCH_REVIEW_PROJECT');
		const project = await loadReviewProject(projectId, batchId);
		startBatchReview(batchId, projectId);
		globalState.currentBatchId = batchId;
		globalState.currentProject = project;
		return true;
	} catch {
		await abortInvalidSession(batchId, reviewMessage('reviewSessionInvalid'));
		return false;
	}
}

/**
 * Sauvegarde le projet courant puis réconcilie uniquement sa ligne Batch.
 * @returns {Promise<{ batch: Batch; item: BatchProjectItem }>} Manifeste et ligne actualisés.
 */
async function saveAndReconcileCurrent(): Promise<{ batch: Batch; item: BatchProjectItem }> {
	const session = globalState.shared.batchReview;
	const project = globalState.currentProject;
	if (
		!session.active ||
		session.batchId === null ||
		session.currentProjectId === null ||
		!project ||
		globalState.currentBatchId !== session.batchId ||
		project.detail.id !== session.currentProjectId ||
		project.detail.batchId !== session.batchId
	)
		throw new Error('INVALID_BATCH_REVIEW_SESSION');
	await project.save();
	const batch = await BatchService.load(session.batchId);
	const item = batch.projects.find((candidate) => candidate.projectId === project.detail.id);
	if (!item) throw new Error('INVALID_BATCH_REVIEW_PROJECT');
	if (await reconcileBatchProjectSegmentation(batch, item, project)) await BatchService.save(batch);
	return { batch, item };
}

/**
 * Termine proprement une session invalide vers le meilleur écran disponible.
 * @param {number | null} batchId Batch à conserver si son manifeste existe.
 * @param {string} message Message localisé à afficher.
 * @returns {Promise<void>}
 */
async function abortInvalidSession(batchId: number | null, message: string): Promise<void> {
	stopBatchReview();
	globalState.currentProject = null;
	if (batchId !== null) {
		try {
			await BatchService.load(batchId);
			globalState.currentBatchId = batchId;
			globalState.currentPage = 'batch-workspace';
			toast.error(message);
			return;
		} catch {
			// Le Batch n'existe plus : retour homepage ci-dessous.
		}
	}
	globalState.currentBatchId = null;
	globalState.currentPage = 'home';
	toast.error(message);
}

/**
 * Navigue vers le projet signalé adjacent, sans boucler aux extrémités.
 * @param {BatchReviewDirection} direction Sens de navigation demandé.
 * @returns {Promise<void>} Résolution après sauvegarde, réconciliation et chargement.
 */
export async function navigateBatchReview(direction: BatchReviewDirection): Promise<void> {
	const session = globalState.shared.batchReview;
	if (!isBatchReviewActive() || session.isNavigating) return;
	const batchId = session.batchId;
	if (batchId === null) return;
	session.isNavigating = true;
	try {
		const { batch, item } = await saveAndReconcileCurrent();
		const remaining = batch.projects.filter(
			(project) => project.segmentation.status === 'needs_review'
		);
		if (remaining.length === 0) {
			stopBatchReview();
			globalState.currentProject = null;
			globalState.currentBatchId = batch.id;
			globalState.currentPage = 'batch-workspace';
			await BatchService.loadUserBatchesDetails();
			toast.success(reviewMessage('reviewCompleted'));
			return;
		}
		const currentIndex = batch.projects.indexOf(item);
		const candidates =
			direction === 'next'
				? batch.projects.slice(currentIndex + 1)
				: batch.projects.slice(0, currentIndex).reverse();
		const target = candidates.find((project) => project.segmentation.status === 'needs_review');
		if (!target) return;
		const project = await loadReviewProject(target.projectId, batch.id);
		globalState.currentProject = project;
		session.currentProjectId = target.projectId;
	} catch {
		await abortInvalidSession(batchId, reviewMessage('reviewUnableToLoadProject'));
	} finally {
		globalState.shared.batchReview.isNavigating = false;
	}
}

/**
 * Sauvegarde la revue courante puis retourne au Batch ou à la homepage.
 * @param {'batch' | 'home'} destination Écran de sortie.
 * @returns {Promise<void>} Résolution après la sauvegarde et la réconciliation.
 */
export async function leaveBatchReview(destination: 'batch' | 'home'): Promise<void> {
	const batchId = globalState.shared.batchReview.batchId;
	if (globalState.shared.batchReview.isNavigating) return;
	globalState.shared.batchReview.isNavigating = true;
	try {
		if (isBatchReviewActive() && globalState.currentProject) {
			const { batch } = await saveAndReconcileCurrent();
			if (destination === 'batch') await BatchService.loadUserBatchesDetails();
			globalState.currentBatchId = destination === 'batch' ? batch.id : null;
		}
		stopBatchReview();
		globalState.currentProject = null;
		globalState.currentPage = destination === 'batch' ? 'batch-workspace' : 'home';
	} catch {
		await abortInvalidSession(batchId, reviewMessage('reviewSessionInvalid'));
	} finally {
		globalState.shared.batchReview.isNavigating = false;
	}
}
