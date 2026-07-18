import { ProjectEditorTabs, type Batch, type BatchProjectItem, type Project } from '$lib/classes';
import LL from '$lib/i18n/i18n-svelte';
import { globalState } from '$lib/runes/main.svelte';
import { get } from 'svelte/store';
import toast from 'svelte-5-french-toast';
import { BatchService } from './BatchService';
import { reconcileBatchProjectSegmentation } from './BatchSegmentationService';
import { ProjectService } from './ProjectService';
import {
	getProjectSubtitleClips,
	getProjectTranslationReviewCounts
} from './TranslationFetchService';
import type { VerseTranslation } from '$lib/classes/Translation.svelte';

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
 * @param {'segmentation' | 'translation'} kind Étape métier en cours de revue.
 * @param {string | null} editionName Édition ciblée pour une revue de traduction.
 * @returns {void}
 */
export function startBatchReview(
	batchId: number,
	projectId: number,
	kind: 'segmentation' | 'translation' = 'segmentation',
	editionName: string | null = null
): void {
	globalState.shared.batchReview.active = true;
	globalState.shared.batchReview.kind = kind;
	globalState.shared.batchReview.batchId = batchId;
	globalState.shared.batchReview.currentProjectId = projectId;
	globalState.shared.batchReview.editionName = editionName;
	globalState.shared.batchReview.isNavigating = false;
}

/**
 * Réinitialise complètement la session de revue courante.
 * @returns {void}
 */
export function stopBatchReview(): void {
	globalState.shared.batchReview.active = false;
	globalState.shared.batchReview.kind = null;
	globalState.shared.batchReview.batchId = null;
	globalState.shared.batchReview.currentProjectId = null;
	globalState.shared.batchReview.editionName = null;
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
 * Charge un projet signalé et force l'onglet adapté à la revue.
 * @param {number} projectId Identifiant du projet cible.
 * @param {number} batchId Identifiant du Batch attendu.
 * @param {'segmentation' | 'translation'} kind Étape métier en cours de revue.
 * @param {string | null} editionName Édition ciblée pour une revue de traduction.
 * @returns {Promise<Project>} Projet chargé et préparé.
 */
async function loadReviewProject(
	projectId: number,
	batchId: number,
	kind: 'segmentation' | 'translation' = 'segmentation',
	editionName: string | null = null
): Promise<Project> {
	const project = await ProjectService.load(projectId);
	if (project.detail.batchId !== batchId) throw new Error('INVALID_BATCH_REVIEW_PROJECT');
	project.projectEditorState.currentTab =
		kind === 'translation' ? ProjectEditorTabs.Translations : ProjectEditorTabs.SubtitlesEditor;
	if (kind === 'translation' && editionName) {
		if (!getProjectSubtitleClips(project).some((clip) => !!clip.translations[editionName]))
			throw new Error('INVALID_BATCH_REVIEW_EDITION');
		const editor = project.projectEditorState.translationsEditor;
		editor.checkOnlyFilters(['to review', 'ai error', 'error', 'undefined']);
		editor.searchQuery = '';
		editor.onlyShowOverlappingSubtitles = false;
		const firstPending = getProjectSubtitleClips(project).find((clip) => {
			const translation = clip.translations[editionName] as VerseTranslation | undefined;
			return !!translation && !translation.isStatusComplete();
		});
		globalState.shared.translationScrollTargetClipId = firstPending?.id ?? null;
	}
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
 * Démarre une revue de traduction pour un projet et une édition précis.
 * @param {number} batchId Identifiant du Batch.
 * @param {number} projectId Identifiant du projet signalé.
 * @param {string} editionName Édition focalisée.
 * @returns {Promise<boolean>} `true` lorsque le projet a été ouvert.
 */
export async function openBatchTranslationReviewProject(
	batchId: number,
	projectId: number,
	editionName: string
): Promise<boolean> {
	try {
		const batch = await BatchService.load(batchId);
		const item = batch.projects.find(
			(project) =>
				project.projectId === projectId &&
				project.translations[editionName]?.status === 'needs_review'
		);
		if (!item) throw new Error('INVALID_BATCH_REVIEW_PROJECT');
		const project = await loadReviewProject(projectId, batchId, 'translation', editionName);
		startBatchReview(batchId, projectId, 'translation', editionName);
		globalState.shared.batchTranslationEditionName = editionName;
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
	if (session.kind === 'translation' && session.editionName) {
		const state = item.translations[session.editionName];
		if (!state) throw new Error('INVALID_BATCH_REVIEW_EDITION');
		state.review = getProjectTranslationReviewCounts(project, session.editionName);
		state.status = state.review.pending === 0 ? 'manually_verified' : 'needs_review';
		state.progress = 100;
		state.completedAt = state.review.pending === 0 ? new Date() : null;
		batch.updatedAt = new Date();
		await BatchService.save(batch);
	} else if (await reconcileBatchProjectSegmentation(batch, item, project)) {
		await BatchService.save(batch);
	}
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
		const remaining = batch.projects.filter((project) =>
			session.kind === 'translation' && session.editionName
				? project.translations[session.editionName]?.status === 'needs_review'
				: project.segmentation.status === 'needs_review'
		);
		if (remaining.length === 0) {
			const completedKind = session.kind;
			stopBatchReview();
			globalState.currentProject = null;
			globalState.currentBatchId = batch.id;
			globalState.currentPage = 'batch-workspace';
			await BatchService.loadUserBatchesDetails();
			toast.success(
				reviewMessage(
					completedKind === 'translation' ? 'translationReviewCompleted' : 'reviewCompleted'
				)
			);
			return;
		}
		const currentIndex = batch.projects.indexOf(item);
		const candidates =
			direction === 'next'
				? batch.projects.slice(currentIndex + 1)
				: batch.projects.slice(0, currentIndex).reverse();
		const target = candidates.find((project) =>
			session.kind === 'translation' && session.editionName
				? project.translations[session.editionName]?.status === 'needs_review'
				: project.segmentation.status === 'needs_review'
		);
		if (!target) return;
		const project = await loadReviewProject(
			target.projectId,
			batch.id,
			session.kind ?? 'segmentation',
			session.editionName
		);
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
