import type { BatchSegmentationReviewCounts, BatchSegmentationStatus } from '$lib/classes';
import type { Project } from '$lib/classes/Project';
import type { ClipWithTranslation } from '$lib/classes/Clip.svelte';
import {
	getClipPrimaryReviewIssueCategory,
	hasClipReviewIssue,
	isClipPendingVerification
} from '$lib/classes/Clip.svelte';
import { TrackType } from '$lib/classes/enums';

/**
 * Calcule les compteurs de revue depuis les vrais clips du projet.
 * @param {Project} project Projet chargé à inspecter.
 * @returns {BatchSegmentationReviewCounts} Compteurs canoniques de revue.
 */
export function getBatchSegmentationReviewCounts(project: Project): BatchSegmentationReviewCounts {
	const clips = project.content.timeline
		.getFirstTrack(TrackType.Subtitle)
		.clips.filter(
			(clip) => clip.type === 'Subtitle' || clip.type === 'Pre-defined Subtitle'
		) as ClipWithTranslation[];
	const review: BatchSegmentationReviewCounts = {
		total: 0,
		pending: 0,
		lowConfidence: 0,
		coverage: 0,
		long: 0,
		wbwTimestamps: 0
	};
	for (const clip of clips) {
		if (hasClipReviewIssue(clip)) review.total += 1;
		if (!isClipPendingVerification(clip)) continue;
		review.pending += 1;
		const category = getClipPrimaryReviewIssueCategory(clip);
		if (category === 'coverage') review.coverage += 1;
		else if (category === 'low-confidence') review.lowConfidence += 1;
		else if (category === 'long') review.long += 1;
		else if (category === 'wbw-timestamps') review.wbwTimestamps += 1;
	}
	return review;
}

/**
 * Détermine le statut persistant après segmentation ou réconciliation.
 * @param {BatchSegmentationStatus} previousStatus Statut avant le calcul.
 * @param {BatchSegmentationReviewCounts} review Compteurs actuels.
 * @returns {BatchSegmentationStatus} Statut vérifié résultant.
 */
export function classifyBatchSegmentationStatus(
	previousStatus: BatchSegmentationStatus,
	review: BatchSegmentationReviewCounts
): BatchSegmentationStatus {
	if (review.pending > 0) return 'needs_review';
	if (previousStatus === 'needs_review' || previousStatus === 'manually_verified') {
		return 'manually_verified';
	}
	return 'auto_verified';
}
