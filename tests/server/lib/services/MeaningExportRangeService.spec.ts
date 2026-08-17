import { describe, expect, it } from 'vitest';

import type { SubtitleClip } from '$lib/classes/Clip.svelte';
import {
	buildMeaningExportPrompts,
	buildMeaningExportVerses,
	validateMeaningExportRanges,
	type MeaningExportVerse
} from '$lib/services/MeaningExportRangeService';

/**
 * Construit un faux sous-titre minimal pour tester le regroupement des versets.
 * @param {number} surah Numéro de sourate.
 * @param {number} verse Numéro de verset.
 * @param {number} startTime Début en millisecondes.
 * @param {number} endTime Fin en millisecondes.
 * @param {number} startWordIndex Premier mot du fragment.
 * @param {number} endWordIndex Dernier mot du fragment.
 * @returns {SubtitleClip} Sous-titre de test.
 */
function subtitle(
	surah: number,
	verse: number,
	startTime: number,
	endTime: number,
	startWordIndex = 0,
	endWordIndex = 0
): SubtitleClip {
	return { surah, verse, startTime, endTime, startWordIndex, endWordIndex } as SubtitleClip;
}

/**
 * Retourne des versets de test avec des durées déterministes.
 * @returns {MeaningExportVerse[]} Versets de test ordonnés.
 */
function verses(): MeaningExportVerse[] {
	return [
		{
			key: '1:1',
			surah: 1,
			verse: 1,
			startTime: 0,
			endTime: 1200,
			durationMs: 1200,
			arabic: 'الف'
		},
		{
			key: '1:2',
			surah: 1,
			verse: 2,
			startTime: 1200,
			endTime: 2800,
			durationMs: 1600,
			arabic: 'باء'
		},
		{
			key: '1:3',
			surah: 1,
			verse: 3,
			startTime: 2800,
			endTime: 5000,
			durationMs: 2200,
			arabic: 'تاء'
		},
		{
			key: '1:4',
			surah: 1,
			verse: 4,
			startTime: 5000,
			endTime: 6000,
			durationMs: 1000,
			arabic: 'ثاء'
		}
	];
}

describe('MeaningExportRangeService', () => {
	it('merges contiguous fragments while preserving repeated verse occurrences', async () => {
		const result = await buildMeaningExportVerses(
			[
				subtitle(1, 2, 300, 900, 0, 3),
				subtitle(1, 1, 0, 100, 0, 2),
				subtitle(1, 2, 850, 1200, 4, 5),
				subtitle(1, 1, 950, 1100, 0, 2)
			],
			async (surah, verse) => `${surah}:${verse}`
		);

		expect(result).toEqual([
			{
				key: '1:1',
				surah: 1,
				verse: 1,
				startTime: 0,
				endTime: 100,
				durationMs: 100,
				arabic: '1:1'
			},
			{
				key: '1:2',
				surah: 1,
				verse: 2,
				startTime: 300,
				endTime: 1200,
				durationMs: 900,
				arabic: '1:2'
			},
			{
				key: '1:1',
				surah: 1,
				verse: 1,
				startTime: 950,
				endTime: 1100,
				durationMs: 150,
				arabic: '1:1'
			}
		]);
	});

	it('sends one compact Arabic verse list with verse durations to the AI prompt', () => {
		const result = buildMeaningExportPrompts(verses(), 60, true);

		expect(result.userPrompt).toContain('"o":1');
		expect(result.userPrompt).toContain('"v":"1:1"');
		expect(result.userPrompt).toContain('"t":"الف"');
		expect(result.userPrompt).toContain('"d":"1200ms"');
		expect(result.userPrompt).not.toContain('startTime');
		expect(result.userPrompt).not.toContain('endTime');
		expect(result.systemPrompt).toContain('"ranges":[{"start":"1:1","end":"1:4"}]');
	});

	it('accepts ordered ranges and marks ranges whose real duration exceeds the limit', () => {
		const result = validateMeaningExportRanges(
			{
				ranges: [
					{ start: '1:1', end: '1:2' },
					{ start: '1:3', end: '1:4' }
				]
			},
			verses(),
			3,
			true
		);

		expect(result.skippedCount).toBe(0);
		expect(result.missingVerseKeys).toEqual([]);
		expect(result.ranges.map((range) => range.id)).toEqual(['1:1-1:2-0-1', '1:3-1:4-2-3']);
		expect(result.ranges.map((range) => range.exceedsMaxDuration)).toEqual([false, true]);
	});

	it('ignores unknown, reversed, overlapping, and duplicate ranges', () => {
		const result = validateMeaningExportRanges(
			{
				ranges: [
					{ start: '1:9', end: '1:9' },
					{ start: '1:1', end: '1:2' },
					{ start: '1:2', end: '1:3' },
					{ start: '1:1', end: '1:2' },
					{ start: '1:4', end: '1:3' }
				]
			},
			verses(),
			60,
			false
		);

		expect(result.ranges.map((range) => range.id)).toEqual(['1:1-1:2-0-1']);
		expect(result.skippedCount).toBe(4);
	});

	it('resolves repeated references to the closest occurrence after the previous range', () => {
		const repeatedVerses: MeaningExportVerse[] = [
			{
				key: '1:1',
				surah: 1,
				verse: 1,
				startTime: 0,
				endTime: 100,
				durationMs: 100,
				arabic: 'الف'
			},
			{
				key: '1:2',
				surah: 1,
				verse: 2,
				startTime: 100,
				endTime: 200,
				durationMs: 100,
				arabic: 'باء'
			},
			{
				key: '1:1',
				surah: 1,
				verse: 1,
				startTime: 1000,
				endTime: 1100,
				durationMs: 100,
				arabic: 'الف'
			},
			{
				key: '1:2',
				surah: 1,
				verse: 2,
				startTime: 1100,
				endTime: 1200,
				durationMs: 100,
				arabic: 'باء'
			}
		];
		const result = validateMeaningExportRanges(
			{
				ranges: [
					{ start: '1:1', end: '1:2' },
					{ start: '1:1', end: '1:2' }
				]
			},
			repeatedVerses,
			60,
			true
		);

		expect(result.skippedCount).toBe(0);
		expect(result.missingVerseKeys).toEqual([]);
		expect(result.ranges.map((range) => [range.startTime, range.endTime])).toEqual([
			[0, 200],
			[1000, 1200]
		]);
	});

	it('rejects an incomplete response when all verses are required', () => {
		const result = validateMeaningExportRanges(
			{ ranges: [{ start: '1:1', end: '1:2' }] },
			verses(),
			60,
			true
		);

		expect(result.ranges).toEqual([]);
		expect(result.missingVerseKeys).toEqual(['1:3', '1:4']);
	});

	it('allows uncovered verses when all verses are not required', () => {
		const result = validateMeaningExportRanges(
			{
				ranges: [
					{ start: '1:1', end: '1:1' },
					{ start: '1:4', end: '1:4' }
				]
			},
			verses(),
			60,
			false
		);

		expect(result.ranges).toHaveLength(2);
		expect(result.missingVerseKeys).toEqual([]);
	});
});
