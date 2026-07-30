import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { tick } from 'svelte';

import { globalState } from '$lib/runes/main.svelte';
import { PredefinedSubtitleClip, SubtitleClip } from '$lib/classes/Clip.svelte';
import { Quran } from '$lib/classes/Quran';
import WordsSelector from '$lib/components/projectEditor/tabs/subtitlesEditor/WordsSelector.svelte';
import {
	resetSubtitlesEditorProjectFixture,
	type TestSurahDefinition,
	seedSubtitlesEditorQuranFixture,
	setupSubtitlesEditorProjectFixture
} from '../../../../../fixtures/subtitlesEditor/projectFixture';

type WordsSelectorExports = {
	selectNextWord: () => Promise<void>;
	selectPreviousWord: () => Promise<void>;
	addSubtitle: () => Promise<void>;
};

const toastMock = vi.hoisted(() => ({
	error: vi.fn(),
	info: vi.fn(),
	success: vi.fn(),
	warning: vi.fn()
}));

vi.mock('svelte-5-french-toast', () => ({
	default: toastMock
}));

const punctuationQuranFixture: TestSurahDefinition[] = [
	{
		id: 1,
		name: 'Al-Fatihah',
		verses: [
			{
				id: 1,
				words: [
					{ arabic: 'P0 ۛ', transliteration: 'tr-P0', translation: 'tt-P0' },
					{ arabic: 'A1', transliteration: 'tr-A1', translation: 'tt-A1' },
					{ arabic: 'P2 ۘ', transliteration: 'tr-P2', translation: 'tt-P2' },
					{ arabic: 'A3', transliteration: 'tr-A3', translation: 'tt-A3' }
				]
			},
			{
				id: 2,
				words: [
					{ arabic: 'B1', transliteration: 'tr-B1', translation: 'tt-B1' },
					{ arabic: 'B2', transliteration: 'tr-B2', translation: 'tt-B2' }
				]
			}
		]
	},
	{
		id: 2,
		name: 'Al-Baqarah',
		verses: [
			{
				id: 1,
				words: [
					{ arabic: 'C1', transliteration: 'tr-C1', translation: 'tt-C1' },
					{ arabic: 'C2', transliteration: 'tr-C2', translation: 'tt-C2' }
				]
			},
			{
				id: 2,
				words: [
					{ arabic: 'D1', transliteration: 'tr-D1', translation: 'tt-D1' },
					{ arabic: 'D2', transliteration: 'tr-D2', translation: 'tt-D2' },
					{ arabic: 'D3', transliteration: 'tr-D3', translation: 'tt-D3' }
				]
			}
		]
	}
];

function getWordButtons(container: HTMLElement): HTMLButtonElement[] {
	return Array.from(container.querySelectorAll('button.word-button'));
}

function getWordButton(container: HTMLElement, label: string): HTMLButtonElement {
	const button = getWordButtons(container).find((node) =>
		node.querySelector('p')?.textContent?.includes(label)
	);
	if (!button) {
		throw new Error(`Word button "${label}" not found.`);
	}

	return button;
}

function getSelectedWordLabels(container: HTMLElement): string[] {
	return getWordButtons(container)
		.filter((button) => button.className.includes('word-selected'))
		.map((button) => button.querySelector('p')?.textContent?.trim() ?? '');
}

async function waitForWord(component: ReturnType<typeof render>, label: string) {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		const hasWord = getWordButtons(component.container).some((button) =>
			button.querySelector('p')?.textContent?.includes(label)
		);
		if (hasWord) {
			await tick();
			return;
		}

		await new Promise((resolve) => window.setTimeout(resolve, 20));
	}

	throw new Error(`Word "${label}" was not rendered in time.`);
}

describe('WordsSelector', () => {
	beforeEach(() => {
		seedSubtitlesEditorQuranFixture();
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		resetSubtitlesEditorProjectFixture();
	});

	test('renders the current verse, selection classes, translations and transliterations', async () => {
		setupSubtitlesEditorProjectFixture({
			quranSurahs: punctuationQuranFixture,
			initialSurah: 1,
			initialVerse: 1,
			startWordIndex: 1,
			endWordIndex: 3,
			showWordTranslation: true,
			showWordTransliteration: true
		});

		const component = render(WordsSelector);

		await waitForWord(component, 'A1');
		await expect.element(component.getByText('tt-A1')).toBeVisible();
		await expect.element(component.getByText('tr-A1')).toBeVisible();

		const first = getWordButton(component.container, 'A1');
		const middle = getWordButton(component.container, 'P2 ۘ');
		const last = getWordButton(component.container, 'A3');

		expect(first.className).toContain('word-selected');
		expect(first.className).toContain('word-last-selected');
		expect(middle.className).toContain('word-middle-selected');
		expect(last.className).toContain('word-first-selected');
	});

	test('updates the selected word range when clicking before, after and inside the current selection', async () => {
		setupSubtitlesEditorProjectFixture({
			quranSurahs: punctuationQuranFixture,
			initialSurah: 1,
			initialVerse: 1,
			startWordIndex: 1,
			endWordIndex: 2
		});

		const component = render(WordsSelector);

		await waitForWord(component, 'A1');

		await getWordButton(component.container, 'P0 ۛ').click();
		expect(globalState.getSubtitlesEditorState.startWordIndex).toBe(0);
		expect(globalState.getSubtitlesEditorState.endWordIndex).toBe(0);

		await getWordButton(component.container, 'P2 ۘ').click();
		expect(globalState.getSubtitlesEditorState.startWordIndex).toBe(0);
		expect(globalState.getSubtitlesEditorState.endWordIndex).toBe(2);

		await getWordButton(component.container, 'A1').click();
		expect(globalState.getSubtitlesEditorState.startWordIndex).toBe(0);
		expect(globalState.getSubtitlesEditorState.endWordIndex).toBe(1);
		expect(getSelectedWordLabels(component.container)).toEqual(['P0 ۛ', 'A1']);
	});

	test('hides translations or transliterations when their toggles are disabled', async () => {
		setupSubtitlesEditorProjectFixture({
			quranSurahs: punctuationQuranFixture,
			initialSurah: 1,
			initialVerse: 1,
			showWordTranslation: false,
			showWordTransliteration: false
		});

		const component = render(WordsSelector);

		await waitForWord(component, 'P0 ۛ');

		expect(component.container.textContent).not.toContain('tt-P0');
		expect(component.container.textContent).not.toContain('tr-P0');
	});

	test('highlights editing mode and syncs selection from a subtitle clip only', async () => {
		const fixture = setupSubtitlesEditorProjectFixture({
			initialSurah: 1,
			initialVerse: 1,
			editSubtitle: new SubtitleClip(0, 500, 2, 2, 1, 2, 'Clip', [], false, false)
		});

		const component = render(WordsSelector);

		await waitForWord(component, 'W2V2-2');

		expect(component.container.querySelector('section')?.className).toContain('border-yellow-500');
		expect(globalState.getSubtitlesEditorState.selectedSurah).toBe(2);
		expect(globalState.getSubtitlesEditorState.selectedVerse).toBe(2);
		expect(getSelectedWordLabels(component.container)).toEqual(['W2V2-2', 'W2V2-3']);

		cleanup();
		resetSubtitlesEditorProjectFixture();
		seedSubtitlesEditorQuranFixture();

		const predefined = new PredefinedSubtitleClip(0, 500, 'Basmala');
		setupSubtitlesEditorProjectFixture({
			initialSurah: 1,
			initialVerse: 1,
			editSubtitle: predefined
		});

		const secondComponent = render(WordsSelector);
		await waitForWord(secondComponent, 'W1V1-1');

		expect(globalState.getSubtitlesEditorState.selectedSurah).toBe(1);
		expect(globalState.getSubtitlesEditorState.selectedVerse).toBe(1);
		expect(fixture.spies.updateVideoDetailAttributes).not.toHaveBeenCalled();
	});

	test('navigates to the next verse and then the next surah with the mobile action', async () => {
		setupSubtitlesEditorProjectFixture({
			quranSurahs: punctuationQuranFixture,
			initialSurah: 1,
			initialVerse: 1,
			startWordIndex: 3,
			endWordIndex: 3
		});

		const component = render(WordsSelector);

		await waitForWord(component, 'A3');
		await (component.component as unknown as WordsSelectorExports).selectNextWord();

		expect(globalState.getSubtitlesEditorState.selectedVerse).toBe(2);
		expect(globalState.getSubtitlesEditorState.startWordIndex).toBe(0);
		expect(globalState.getSubtitlesEditorState.endWordIndex).toBe(0);
		await waitForWord(component, 'B1');

		globalState.getSubtitlesEditorState.selectedVerse = 2;
		globalState.getSubtitlesEditorState.startWordIndex = 1;
		globalState.getSubtitlesEditorState.endWordIndex = 1;
		await tick();

		await (component.component as unknown as WordsSelectorExports).selectNextWord();

		expect(globalState.getSubtitlesEditorState.selectedSurah).toBe(2);
		expect(globalState.getSubtitlesEditorState.selectedVerse).toBe(1);
		expect(globalState.getSubtitlesEditorState.startWordIndex).toBe(0);
		expect(globalState.getSubtitlesEditorState.endWordIndex).toBe(0);
		await waitForWord(component, 'C1');
	});

	test('navigates backward within the range, verse and surah with the mobile action', async () => {
		setupSubtitlesEditorProjectFixture({
			quranSurahs: punctuationQuranFixture,
			initialSurah: 2,
			initialVerse: 1,
			startWordIndex: 0,
			endWordIndex: 1
		});

		const component = render(WordsSelector);

		await waitForWord(component, 'C1');

		await (component.component as unknown as WordsSelectorExports).selectPreviousWord();
		expect(globalState.getSubtitlesEditorState.startWordIndex).toBe(0);
		expect(globalState.getSubtitlesEditorState.endWordIndex).toBe(0);

		globalState.getSubtitlesEditorState.startWordIndex = 1;
		globalState.getSubtitlesEditorState.endWordIndex = 1;
		await tick();
		await (component.component as unknown as WordsSelectorExports).selectPreviousWord();
		expect(globalState.getSubtitlesEditorState.startWordIndex).toBe(0);
		expect(globalState.getSubtitlesEditorState.endWordIndex).toBe(0);

		await (component.component as unknown as WordsSelectorExports).selectPreviousWord();
		expect(globalState.getSubtitlesEditorState.selectedSurah).toBe(1);
		expect(globalState.getSubtitlesEditorState.selectedVerse).toBe(2);
		expect(globalState.getSubtitlesEditorState.startWordIndex).toBe(1);
		expect(globalState.getSubtitlesEditorState.endWordIndex).toBe(1);
		await waitForWord(component, 'B2');
	});

	test('adds a subtitle with the selected verse and does not advance on failure', async () => {
		const fixture = setupSubtitlesEditorProjectFixture({
			quranSurahs: punctuationQuranFixture,
			initialSurah: 1,
			initialVerse: 1,
			startWordIndex: 1,
			endWordIndex: 2
		});

		const component = render(WordsSelector);
		await waitForWord(component, 'P0 ۛ');

		await (component.component as unknown as WordsSelectorExports).addSubtitle();
		expect(fixture.spies.addSubtitle).toHaveBeenCalledTimes(1);
		expect(fixture.spies.addSubtitle.mock.calls[0][1]).toBe(1);
		expect(fixture.spies.addSubtitle.mock.calls[0][2]).toBe(2);
		expect(fixture.spies.addSubtitle.mock.calls[0][3]).toBe(1);
		expect(globalState.getSubtitlesEditorState.startWordIndex).toBe(3);
		expect(globalState.getSubtitlesEditorState.endWordIndex).toBe(3);

		fixture.spies.addSubtitle.mockResolvedValueOnce(false);
		globalState.getSubtitlesEditorState.startWordIndex = 0;
		globalState.getSubtitlesEditorState.endWordIndex = 0;
		await tick();
		await (component.component as unknown as WordsSelectorExports).addSubtitle();
		expect(globalState.getSubtitlesEditorState.startWordIndex).toBe(0);
		expect(globalState.getSubtitlesEditorState.endWordIndex).toBe(0);
	});
});
