import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { globalState } from '$lib/runes/main.svelte';
import { Edition } from '$lib/classes/Edition';
import {
	buildTranslationInlineTextSegments,
	getTranslationTrimUnits,
	normalizeTranslationInlineStyleRuns,
	replaceBoldWordIndexesInInlineStyleRuns,
	sliceTranslationTrimUnits,
	toggleTranslationInlineStyleRuns,
	VerseTranslation
} from '$lib/classes/Translation.svelte';

describe('VerseTranslation.tryRecalculateTranslationIndexes', () => {
	const edition = new Edition('test', 'test', 'Test Author', 'en', 'ltr', 'test', '', '', '');

	const originalCurrentProject = globalState.currentProject;

	beforeEach(() => {
		globalState.currentProject = {
			content: {
				projectTranslation: {
					getVerseTranslation: () => ''
				}
			}
		} as never;
	});

	afterEach(() => {
		globalState.currentProject = originalCurrentProject;
	});

	function mockSourceTranslation(sourceText: string): void {
		globalState.currentProject = {
			content: {
				projectTranslation: {
					getVerseTranslation: () => sourceText
				}
			}
		} as never;
	}

	it('keeps exact contiguous matching when the AI text already exists verbatim in source', () => {
		mockSourceTranslation('This is the Book there is no doubt about it a guide for the mindful');

		const translation = new VerseTranslation('there is no doubt about it', 'to review');
		translation.startWordIndex = 4;
		translation.endWordIndex = 9;

		translation.tryRecalculateTranslationIndexes(edition, '2:2');

		expect(translation.isBruteForce).toBe(false);
		expect(translation.startWordIndex).toBe(4);
		expect(translation.endWordIndex).toBe(9);
	});

	it('accepts a contiguous fuzzy match above 95% similarity for tiny formatting differences', () => {
		mockSourceTranslation('confirming what came before it—a guide for the mindful');

		const translation = new VerseTranslation(
			'confirming what came before it— a guide',
			'to review'
		);
		translation.startWordIndex = 0;
		translation.endWordIndex = 5;

		translation.tryRecalculateTranslationIndexes(edition, '2:97');

		expect(translation.isBruteForce).toBe(false);
		expect(translation.startWordIndex).toBe(0);
		expect(translation.endWordIndex).toBe(5);
	});

	it('keeps AI Error fallback when no exact or fuzzy contiguous range is close enough', () => {
		mockSourceTranslation('confirming what came before it a guide for the mindful');

		const translation = new VerseTranslation('totally unrelated wording here', 'to review');
		translation.startWordIndex = 0;
		translation.endWordIndex = 3;

		translation.tryRecalculateTranslationIndexes(edition, '2:97');

		expect(translation.isBruteForce).toBe(true);
	});

	it('recalculates indexes for contiguous Chinese text without spaces', () => {
		mockSourceTranslation('一切赞颂，全归安拉，养育众世界的主，');

		const translation = new VerseTranslation('全归安拉，', 'to review');

		translation.tryRecalculateTranslationIndexes(edition, '1:2');

		expect(translation.isBruteForce).toBe(false);
		expect(translation.startWordIndex).toBe(5);
		expect(translation.endWordIndex).toBe(9);
	});

	it('keeps Chinese opening quotes with the following trimmed segment', () => {
		mockSourceTranslation('主說：「穆薩啊！你把它扔下。」');

		const firstTranslation = new VerseTranslation('主說', 'to review');
		firstTranslation.tryRecalculateTranslationIndexes(edition, '20:19');

		expect(firstTranslation.isBruteForce).toBe(false);
		expect(firstTranslation.startWordIndex).toBe(0);
		expect(firstTranslation.endWordIndex).toBe(2);

		const secondTranslation = new VerseTranslation('穆薩啊！你把它扔下。', 'to review');
		secondTranslation.tryRecalculateTranslationIndexes(edition, '20:19');

		expect(secondTranslation.isBruteForce).toBe(false);
		expect(secondTranslation.startWordIndex).toBe(3);
		expect(secondTranslation.endWordIndex).toBe(14);
	});
});

describe('translation trim units', () => {
	it('splits Chinese text into selectable units without requiring spaces', () => {
		const units = getTranslationTrimUnits('奉至仁至慈的安拉之名');

		expect(units.map((unit) => unit.text)).toEqual([
			'奉',
			'至',
			'仁',
			'至',
			'慈',
			'的',
			'安',
			'拉',
			'之',
			'名'
		]);
	});

	it('slices Chinese text without inserting spaces', () => {
		const text = '一切赞颂，全归安拉，养育众世界的主，';

		expect(sliceTranslationTrimUnits(text, 5, 9)).toBe('全归安拉，');
	});

	it('keeps Chinese punctuation as selectable units', () => {
		const units = getTranslationTrimUnits('一切讚頌，全歸安拉，');

		expect(units.map((unit) => unit.text)).toEqual([
			'一',
			'切',
			'讚',
			'頌',
			'，',
			'全',
			'歸',
			'安',
			'拉',
			'，'
		]);
	});

	it('keeps space-separated text behavior', () => {
		const text = 'This is the Book';

		expect(getTranslationTrimUnits(text).map((unit) => unit.text)).toEqual([
			'This',
			'is',
			'the',
			'Book'
		]);
		expect(sliceTranslationTrimUnits(text, 1, 2)).toBe('is the');
	});
});

describe('translation inline style runs', () => {
	it('adds a style range to an empty translation', () => {
		const runs = toggleTranslationInlineStyleRuns([], 5, 1, 3, {
			bold: true,
			italic: false,
			underline: false
		});

		expect(runs).toEqual([
			{
				startWordIndex: 1,
				endWordIndex: 3,
				bold: true,
				italic: false,
				underline: false,
				color: null
			}
		]);
	});

	it('toggles off a style on an already styled subrange', () => {
		const runs = toggleTranslationInlineStyleRuns(
			[
				{
					startWordIndex: 0,
					endWordIndex: 4,
					bold: true,
					italic: false,
					underline: false
				}
			],
			5,
			1,
			2,
			{ bold: true, italic: false, underline: false }
		);

		expect(runs).toEqual([
			{
				startWordIndex: 0,
				endWordIndex: 0,
				bold: true,
				italic: false,
				underline: false,
				color: null
			},
			{
				startWordIndex: 3,
				endWordIndex: 4,
				bold: true,
				italic: false,
				underline: false,
				color: null
			}
		]);
	});

	it('preserves unrelated flags when toggling another style', () => {
		const runs = toggleTranslationInlineStyleRuns(
			[
				{
					startWordIndex: 0,
					endWordIndex: 3,
					bold: true,
					italic: false,
					underline: false
				}
			],
			4,
			1,
			2,
			{ bold: false, italic: true, underline: false }
		);

		expect(runs).toEqual([
			{
				startWordIndex: 0,
				endWordIndex: 0,
				bold: true,
				italic: false,
				underline: false,
				color: null
			},
			{
				startWordIndex: 1,
				endWordIndex: 2,
				bold: true,
				italic: true,
				underline: false,
				color: null
			},
			{
				startWordIndex: 3,
				endWordIndex: 3,
				bold: true,
				italic: false,
				underline: false,
				color: null
			}
		]);
	});

	it('normalizes and merges adjacent runs with identical flags', () => {
		const runs = normalizeTranslationInlineStyleRuns(
			[
				{
					startWordIndex: 0,
					endWordIndex: 1,
					bold: true,
					italic: false,
					underline: false
				},
				{
					startWordIndex: 2,
					endWordIndex: 3,
					bold: true,
					italic: false,
					underline: false
				}
			],
			4
		);

		expect(runs).toEqual([
			{
				startWordIndex: 0,
				endWordIndex: 3,
				bold: true,
				italic: false,
				underline: false,
				color: null
			}
		]);
	});

	it('clears inline styles when the translation text changes manually', () => {
		const translation = new VerseTranslation('alpha beta gamma', 'reviewed');
		translation.inlineStyleRuns = [
			{
				startWordIndex: 0,
				endWordIndex: 1,
				bold: true,
				italic: true,
				underline: false
			}
		];

		translation.setTextAndClearInlineStyles('delta epsilon');

		expect(translation.text).toBe('delta epsilon');
		expect(translation.inlineStyleRuns).toEqual([]);
	});

	it('keeps inline styles when setTextAndClearInlineStyles receives the same text', () => {
		const translation = new VerseTranslation('alpha beta gamma', 'reviewed');
		translation.inlineStyleRuns = [
			{
				startWordIndex: 0,
				endWordIndex: 1,
				bold: true,
				italic: false,
				underline: true,
				color: '#ff0000'
			}
		];

		translation.setTextAndClearInlineStyles('alpha beta gamma');

		expect(translation.text).toBe('alpha beta gamma');
		expect(translation.inlineStyleRuns).toEqual([
			{
				startWordIndex: 0,
				endWordIndex: 1,
				bold: true,
				italic: false,
				underline: true,
				color: '#ff0000'
			}
		]);
	});

	it('preserves whitespace while rendering inline styled segments', () => {
		const segments = buildTranslationInlineTextSegments('one two three', [
			{
				startWordIndex: 1,
				endWordIndex: 2,
				bold: true,
				italic: false,
				underline: true
			}
		]);

		expect(segments).toEqual([
			{
				text: 'one ',
				bold: false,
				italic: false,
				underline: false,
				color: null
			},
			{
				text: 'two three',
				bold: true,
				italic: false,
				underline: true,
				color: null
			}
		]);
	});

	it('marks a word as a line break endpoint', () => {
		const runs = toggleTranslationInlineStyleRuns([], 3, 1, 1, {
			bold: false,
			italic: false,
			underline: false,
			lineBreak: true
		});

		expect(runs).toEqual([
			{
				startWordIndex: 1,
				endWordIndex: 1,
				bold: false,
				italic: false,
				underline: false,
				lineBreak: true,
				color: null
			}
		]);

		expect(buildTranslationInlineTextSegments('one two three', runs)).toEqual([
			{
				text: 'one ',
				bold: false,
				italic: false,
				underline: false,
				color: null
			},
			{
				text: 'two',
				bold: false,
				italic: false,
				underline: false,
				lineBreak: true,
				color: null
			},
			{
				text: 'three',
				bold: false,
				italic: false,
				underline: false,
				color: null
			}
		]);
	});

	it('keeps Chinese punctuation before an inline line break', () => {
		const segments = buildTranslationInlineTextSegments('一切讚頌，全歸安拉，養育眾世界的主，', [
			{
				startWordIndex: 9,
				endWordIndex: 9,
				bold: false,
				italic: false,
				underline: false,
				lineBreak: true
			}
		]);

		expect(segments).toEqual([
			{
				text: '一切讚頌，全歸安拉',
				bold: false,
				italic: false,
				underline: false,
				color: null
			},
			{
				text: '，',
				bold: false,
				italic: false,
				underline: false,
				lineBreak: true,
				color: null
			},
			{
				text: '養育眾世界的主，',
				bold: false,
				italic: false,
				underline: false,
				color: null
			}
		]);
	});

	it('replaces bold while preserving italic and underline flags', () => {
		const runs = replaceBoldWordIndexesInInlineStyleRuns(
			[
				{
					startWordIndex: 0,
					endWordIndex: 2,
					bold: true,
					italic: false,
					underline: false
				},
				{
					startWordIndex: 1,
					endWordIndex: 3,
					bold: false,
					italic: true,
					underline: true
				}
			],
			4,
			[3]
		);

		expect(runs).toEqual([
			{
				startWordIndex: 1,
				endWordIndex: 2,
				bold: false,
				italic: true,
				underline: true,
				color: null
			},
			{
				startWordIndex: 3,
				endWordIndex: 3,
				bold: true,
				italic: true,
				underline: true,
				color: null
			}
		]);
	});
});
