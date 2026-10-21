import { describe, expect, test } from 'vitest';
import { collapseSalawatDisplaySegments } from '$lib/components/projectEditor/videoPreview/helpers/salawat';

describe('Salawat display', () => {
	test.each([
		'صلى الله عليه وسلم',
		'صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ',
		'عليه الصلاة والسلام',
		'عَلَيْهِ الصَّلَاةُ وَالسَّلَامُ',
		'صلي الله عليه و سلم',
		'عليه الصلاه و السلام'
	])('recognizes %s without changing its surrounding text', (formula) => {
		const result = collapseSalawatDisplaySegments(
			[{ text: `قال النبي ${formula} اليوم.` }],
			(parts, text) => ({ ...parts[0], text })
		);
		expect(result.map((part) => part.text).join('')).toBe('قال النبي ﷺ اليوم.');
	});

	test('preserves other blessings, incomplete formulas, existing symbols and Quran parts', () => {
		const parts = [
			{ text: 'عليه السلام وعليهم الصلاة والسلام صلى الله ﷺ ' },
			{ text: 'صلى الله عليه وسلم', referenceType: 'quran' }
		];
		expect(collapseSalawatDisplaySegments(parts, (items, text) => ({ ...items[0], text }))).toEqual(
			parts
		);
	});

	test('collapses styled fragments while preserving outside styles and source records', () => {
		const parts = [
			{ text: 'قال صلى ', color: 'red' },
			{ text: 'الله عليه وسلم اليوم', color: 'blue' }
		];
		const result = collapseSalawatDisplaySegments(parts, (items, text) => ({ ...items[0], text }));
		expect(result).toEqual([
			{ text: 'قال ', color: 'red' },
			{ text: 'ﷺ', color: 'red' },
			{ text: ' اليوم', color: 'blue' }
		]);
		expect(parts[0].text).toBe('قال صلى ');
	});

	test('keeps punctuation attached to a collapsed word and exposes all source words to timing merge', () => {
		const parts = ['قال', '(صلى', 'الله', 'عليه', 'وسلم)،', 'ثم', 'عليه', 'الصلاة', 'والسلام'].map(
			(text, index) => ({ text, indexes: [index] })
		);
		const result = collapseSalawatDisplaySegments(
			parts,
			(items, text) => ({ text, indexes: items.flatMap((item) => item.indexes) }),
			' '
		);
		expect(result).toEqual([
			{ text: 'قال', indexes: [0] },
			{ text: '(ﷺ)،', indexes: [1, 2, 3, 4] },
			{ text: 'ثم', indexes: [5] },
			{ text: 'ﷺ', indexes: [6, 7, 8] }
		]);
	});
});
