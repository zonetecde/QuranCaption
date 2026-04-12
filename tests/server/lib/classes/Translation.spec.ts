import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { globalState } from '$lib/runes/main.svelte';
import { Edition } from '$lib/classes/Edition';
import {
	buildTranslationInlineTextSegments,
	normalizeTranslationInlineStyleRuns,
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
});

describe('translation inline style runs', () => {
	it('adds a style range to an empty translation', () => {
		const runs = toggleTranslationInlineStyleRuns(
			[],
			5,
			1,
			3,
			{ bold: true, italic: false, underline: false }
		);

		expect(runs).toEqual([
			{
				startWordIndex: 1,
				endWordIndex: 3,
				bold: true,
				italic: false,
				underline: false
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
				underline: false
			},
			{
				startWordIndex: 3,
				endWordIndex: 4,
				bold: true,
				italic: false,
				underline: false
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
				underline: false
			},
			{
				startWordIndex: 1,
				endWordIndex: 2,
				bold: true,
				italic: true,
				underline: false
			},
			{
				startWordIndex: 3,
				endWordIndex: 3,
				bold: true,
				italic: false,
				underline: false
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
				underline: false
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
				underline: false
			},
			{
				text: 'two three',
				bold: true,
				italic: false,
				underline: true
			}
		]);
	});
});
