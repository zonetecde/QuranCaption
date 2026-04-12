import { describe, expect, it } from 'vitest';

import {
	applyManualReviewToTelemetryItem,
	extractAdvancedAiTranslations,
	reconstructTranslationFromRange,
	upsertTelemetryItem,
	type AiTranslationTelemetryItem
} from '$lib/services/AiTranslationTelemetryService';

describe('AiTranslationTelemetryService helpers', () => {
	it('reconstructs the actual translation text from source word indices', () => {
		expect(
			reconstructTranslationFromRange(
				[
					{ i: 0, w: 'In' },
					{ i: 1, w: 'the' },
					{ i: 2, w: 'name' },
					{ i: 3, w: 'of' },
					{ i: 4, w: 'Allah' }
				],
				[2, 4]
			)
		).toBe('name of Allah');
	});

	it('returns an empty string when the AI range is invalid or missing', () => {
		expect(reconstructTranslationFromRange([{ i: 0, w: 'Only' }], null)).toBe('');
		expect(reconstructTranslationFromRange([{ i: 0, w: 'Only' }], [2, 1])).toBe('');
	});

	it('upserts without duplicates and resets prior manual review/upload markers', () => {
		const initialItem: AiTranslationTelemetryItem = {
			id: '1:edition:10:legacy',
			projectId: 1,
			editionKey: 'edition',
			editionName: 'Edition',
			verseKey: '1:1',
			subtitleId: 10,
			sourceMode: 'legacy',
			status: 'ai trimmed',
			segment: 'arabic',
			aiTranslation: 'first',
			manualReview: 'reviewed once',
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
			uploadedAt: '2026-01-01T00:05:00.000Z'
		};

		const updated = upsertTelemetryItem([initialItem], {
			...initialItem,
			id: '',
			aiTranslation: 'second',
			updatedAt: '2026-01-02T00:00:00.000Z'
		});

		expect(updated).toHaveLength(1);
		expect(updated[0].aiTranslation).toBe('second');
		expect(updated[0].manualReview).toBeUndefined();
		expect(updated[0].uploadedAt).toBeUndefined();
		expect(updated[0].createdAt).toBe('2026-01-01T00:00:00.000Z');
	});

	it('stores only the latest distinct manual review text', () => {
		const baseItem: AiTranslationTelemetryItem = {
			id: '1:edition:10:legacy',
			projectId: 1,
			editionKey: 'edition',
			editionName: 'Edition',
			verseKey: '1:1',
			subtitleId: 10,
			sourceMode: 'legacy',
			status: 'ai error',
			segment: 'arabic',
			aiTranslation: 'trimmed translation',
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
			uploadedAt: '2026-01-01T00:05:00.000Z'
		};

		const updated = applyManualReviewToTelemetryItem(
			baseItem,
			'manually corrected translation',
			'2026-01-02T00:00:00.000Z'
		);
		expect(updated.manualReview).toBe('manually corrected translation');
		expect(updated.uploadedAt).toBeUndefined();

		const resetToAiText = applyManualReviewToTelemetryItem(
			updated,
			'trimmed translation',
			'2026-01-03T00:00:00.000Z'
		);
		expect(resetToAiText.manualReview).toBeUndefined();
	});

	it('supports manual-only reviewed telemetry items without aiTranslation', () => {
		const manualItem: AiTranslationTelemetryItem = {
			id: '1:edition:10:manual',
			projectId: 1,
			editionKey: 'edition',
			editionName: 'Edition',
			verseKey: '1:1',
			subtitleId: 10,
			sourceMode: 'manual',
			status: 'reviewed',
			segment: 'arabic',
			manualReview: 'manual translation',
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z'
		};

		const updated = applyManualReviewToTelemetryItem(
			manualItem,
			'manual translation revised',
			'2026-01-02T00:00:00.000Z'
		);

		expect(updated.status).toBe('reviewed');
		expect(updated.sourceMode).toBe('manual');
		expect(updated.aiTranslation).toBeUndefined();
		expect(updated.manualReview).toBe('manual translation revised');
	});

	it('supports non-AI completed statuses for local telemetry items', () => {
		const automaticallyTrimmedItem: AiTranslationTelemetryItem = {
			id: '1:edition:11:manual',
			projectId: 1,
			editionKey: 'edition',
			editionName: 'Edition',
			verseKey: '1:2',
			subtitleId: 11,
			sourceMode: 'manual',
			status: 'automatically trimmed',
			segment: 'arabic auto',
			manualReview: 'auto trimmed translation',
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z'
		};

		const fetchedItem: AiTranslationTelemetryItem = {
			id: '1:edition:12:manual',
			projectId: 1,
			editionKey: 'edition',
			editionName: 'Edition',
			verseKey: '1:3',
			subtitleId: 12,
			sourceMode: 'manual',
			status: 'fetched',
			segment: 'arabic fetched',
			manualReview: 'fetched translation',
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z'
		};

		expect(automaticallyTrimmedItem.status).toBe('automatically trimmed');
		expect(fetchedItem.status).toBe('fetched');
	});

	it('extracts advanced AI segment texts from the parsed response payload', () => {
		const extracted = extractAdvancedAiTranslations({
			verses: [
				{
					verseKey: '2:1',
					segments: [
						{ i: 0, text: 'first advanced segment' },
						{ i: 1, text: 'second advanced segment' }
					]
				}
			]
		});

		expect(extracted.get('2:1')?.get(0)).toBe('first advanced segment');
		expect(extracted.get('2:1')?.get(1)).toBe('second advanced segment');
	});
});
