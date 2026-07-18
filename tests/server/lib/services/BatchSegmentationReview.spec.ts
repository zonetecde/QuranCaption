import { describe, expect, it } from 'vitest';
import type { ClipWithTranslation } from '$lib/classes/Clip.svelte';
import type { Project } from '$lib/classes/Project';
import {
	classifyBatchSegmentationStatus,
	getBatchSegmentationReviewCounts
} from '$lib/services/BatchSegmentationReview';

/**
 * Construit un projet minimal dont la piste de sous-titres contient les clips fournis.
 * @param {Partial<ClipWithTranslation>[]} clips Flags de revue à tester.
 * @returns {Project} Projet structurel minimal.
 */
function createProject(clips: Partial<ClipWithTranslation>[]): Project {
	return {
		content: {
			timeline: {
				getFirstTrack: () => ({
					clips: clips.map((clip) => ({ type: 'Subtitle', ...clip }))
				})
			}
		}
	} as unknown as Project;
}

describe('Batch segmentation review classification', () => {
	it('automatically verifies projects without review flags', () => {
		const review = getBatchSegmentationReviewCounts(createProject([{}]));
		expect(review.pending).toBe(0);
		expect(classifyBatchSegmentationStatus('processing', review)).toBe('auto_verified');
	});

	it('counts canonical pending categories', () => {
		const review = getBatchSegmentationReviewCounts(
			createProject([
				{ needsReview: true },
				{ needsCoverageReview: true },
				{ needsLongReview: true },
				{ needsWbwTimestampReview: true }
			])
		);
		expect(review).toEqual({
			total: 4,
			pending: 4,
			lowConfidence: 1,
			coverage: 1,
			long: 1,
			wbwTimestamps: 1
		});
		expect(classifyBatchSegmentationStatus('processing', review)).toBe('needs_review');
	});

	it('marks a previously reviewed project as manually verified once nothing is pending', () => {
		const verifiedFlags = getBatchSegmentationReviewCounts(
			createProject([{ needsReview: true, hasBeenVerified: true }])
		);
		const correctedFlags = getBatchSegmentationReviewCounts(createProject([{}]));
		expect(classifyBatchSegmentationStatus('needs_review', verifiedFlags)).toBe(
			'manually_verified'
		);
		expect(classifyBatchSegmentationStatus('needs_review', correctedFlags)).toBe(
			'manually_verified'
		);
		expect(classifyBatchSegmentationStatus('auto_verified', correctedFlags)).toBe('auto_verified');
	});
});
