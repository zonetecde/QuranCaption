import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Edition } from './Edition';
import { VerseTranslation } from './Translation.svelte';
import { globalState } from '$lib/runes/main.svelte';

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
