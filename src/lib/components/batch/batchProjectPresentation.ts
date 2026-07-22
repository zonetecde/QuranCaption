import type {
	BatchMediaMode,
	BatchMediaStatus,
	BatchProjectItem,
	BatchSegmentationStatus,
	BatchTranslationStatus
} from '$lib/classes';
import LL from '$lib/i18n/i18n-svelte';
import type { BatchMediaActivity } from '$lib/services/BatchMediaService';
import type {
	BatchSegmentationActivity,
	BatchSegmentationLiveStatus
} from '$lib/services/BatchSegmentationService';
import { get } from 'svelte/store';

/**
 * Résout une traduction Batch sans dépendre immédiatement des types générés au pre-commit.
 * @param {string} key Clé du message Batch.
 * @param {Record<string, string | number>} params Paramètres éventuels du message.
 * @returns {string} Message localisé.
 */
export function batchMessage(key: string, params: Record<string, string | number> = {}): string {
	const translator = Reflect.get(get(LL).batch, key) as
		| ((values?: Record<string, string | number>) => string)
		| undefined;
	return translator?.(params) ?? key;
}

/**
 * Traduit l'état média persistant d'un projet du Batch.
 * @param {BatchMediaStatus} status État média à afficher.
 * @returns {string} Libellé localisé.
 */
export function getBatchMediaLabel(status: BatchMediaStatus): string {
	const messages = get(LL).batch;
	switch (status) {
		case 'pending':
			return messages.notImported();
		case 'queued':
			return messages.queued();
		case 'processing':
			return messages.processing();
		case 'completed':
			return messages.completed();
		case 'failed':
			return messages.failed();
	}
}

/**
 * Traduit l'activité média temps réel ou reprend l'état persistant.
 * @param {BatchProjectItem} project Projet affiché.
 * @param {BatchMediaActivity | undefined} activity Activité temps réel éventuelle.
 * @returns {string} Libellé localisé.
 */
export function getBatchMediaActivityLabel(
	project: BatchProjectItem,
	activity?: BatchMediaActivity
): string {
	if (project.media.status !== 'processing' || !activity) {
		return getBatchMediaLabel(project.media.status);
	}
	switch (activity) {
		case 'downloading':
			return batchMessage('downloading');
		case 'copying':
			return batchMessage('copyingLocal');
		case 'finalizing':
			return batchMessage('addingTimeline');
		case 'saving':
			return batchMessage('savingProject');
		default:
			return getBatchMediaLabel(project.media.status);
	}
}

/**
 * Traduit le mode média persistant d'une ligne.
 * @param {BatchMediaMode | null} mode Mode à afficher.
 * @returns {string} Libellé localisé ou chaîne vide.
 */
export function getBatchMediaModeLabel(mode: BatchMediaMode | null): string {
	if (!mode) return '';
	return batchMessage(mode === 'audio_only' ? 'audioOnly' : 'audioVideo');
}

/**
 * Traduit l'activité ou le statut de segmentation d'une ligne.
 * @param {BatchProjectItem} project Projet affiché.
 * @param {BatchSegmentationActivity | undefined} activity Activité locale éventuelle.
 * @param {BatchSegmentationLiveStatus | undefined} live Statut backend éventuel.
 * @returns {string} Libellé affichable.
 */
export function getBatchSegmentationActivityLabel(
	project: BatchProjectItem,
	activity?: BatchSegmentationActivity,
	live?: BatchSegmentationLiveStatus
): string {
	if (project.segmentation.status === 'processing' && live?.message) return live.message;
	if (project.segmentation.status === 'processing' && activity === 'applying') {
		return batchMessage('segmentationApplying');
	}
	if (project.segmentation.status === 'processing' && activity === 'saving') {
		return batchMessage('segmentationSaving');
	}
	const keys: Record<BatchSegmentationStatus, string> = {
		not_started: 'segmentationNotStarted',
		queued: 'segmentationQueued',
		processing: 'segmentationProcessing',
		auto_verified: 'segmentationAutoVerified',
		needs_review: 'segmentationNeedsReview',
		manually_verified: 'segmentationManuallyVerified',
		failed: 'segmentationFailed'
	};
	return batchMessage(keys[project.segmentation.status]);
}

/**
 * Traduit les erreurs techniques persistées connues.
 * @param {string | null} errorValue Erreur brute ou code stable.
 * @returns {string} Message affichable.
 */
export function getBatchSegmentationError(errorValue: string | null): string {
	if (errorValue === 'SEGMENTATION_INTERRUPTED') return batchMessage('segmentationInterrupted');
	if (errorValue === 'SEGMENTATION_ALREADY_RUNNING') {
		return batchMessage('segmentationAlreadyRunning');
	}
	return errorValue ?? '';
}

/**
 * Traduit le statut d'une édition suivie dans une ligne Batch.
 * @param {BatchTranslationStatus} status Statut persistant.
 * @returns {string} Libellé localisé.
 */
export function getBatchTranslationStatusLabel(status: BatchTranslationStatus): string {
	const keys: Record<BatchTranslationStatus, string> = {
		not_added: 'translationNotAdded',
		adding: 'translationAdding',
		ready_to_fetch: 'translationReadyToFetch',
		fetching: 'translationFetching',
		auto_verified: 'translationAutoVerified',
		needs_review: 'translationNeedsReview',
		manually_verified: 'translationManuallyVerified',
		failed: 'translationFailed'
	};
	return batchMessage(keys[status]);
}
