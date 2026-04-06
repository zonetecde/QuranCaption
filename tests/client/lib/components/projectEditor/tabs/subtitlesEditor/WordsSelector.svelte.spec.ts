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

const shortcutMock = vi.hoisted(() => {
	type ShortcutHandler = {
		description: string;
		onKeyDown: (event: KeyboardEvent) => unknown;
		onKeyUp?: (event: KeyboardEvent) => unknown;
	};

	const shortcuts = new Map<string, ShortcutHandler>();
	const registerShortcut = vi.fn(
		(options: {
			key: { keys: string[]; description: string };
			onKeyDown: (event: KeyboardEvent) => unknown;
			onKeyUp?: (event: KeyboardEvent) => unknown;
		}) => {
			for (const key of options.key.keys) {
				shortcuts.set(key.toLowerCase(), {
					description: options.key.description,
					onKeyDown: options.onKeyDown,
					onKeyUp: options.onKeyUp
				});
			}
		}
	);

	const unregisterShortcut = vi.fn((key: { keys: string[]; description: string }) => {
		let deleted = false;
		for (const shortcutKey of key.keys) {
			deleted = shortcuts.delete(shortcutKey.toLowerCase()) || deleted;
		}
		return deleted;
	});

	const reset = () => {
		shortcuts.clear();
		registerShortcut.mockClear();
		unregisterShortcut.mockClear();
	};

	return { shortcuts, registerShortcut, unregisterShortcut, reset };
});

const toastMock = vi.hoisted(() => ({
	error: vi.fn(),
	info: vi.fn(),
	success: vi.fn(),
	warning: vi.fn()
}));

vi.mock('$lib/services/ShortcutService', () => ({
	default: {
		registerShortcut: shortcutMock.registerShortcut,
		unregisterShortcut: shortcutMock.unregisterShortcut
	}
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

async function triggerShortcut(key: string) {
	const shortcut = shortcutMock.shortcuts.get(key.toLowerCase());
	if (!shortcut) {
		throw new Error(`Shortcut "${key}" is not registered.`);
	}

	await Promise.resolve(shortcut.onKeyDown(new KeyboardEvent('keydown', { key, bubbles: true })));
	await tick();
}

describe('WordsSelector', () => {
	beforeEach(() => {
		seedSubtitlesEditorQuranFixture();
		shortcutMock.reset();
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		resetSubtitlesEditorProjectFixture();
		shortcutMock.reset();
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
		expect(globalState.getSubtitlesEditorState.startWordIndex).toBe(1);
		expect(globalState.getSubtitlesEditorState.endWordIndex).toBe(1);
		expect(getSelectedWordLabels(component.container)).toEqual(['A1']);
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
		shortcutMock.reset();
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

	test('renders an error state when loading the verse fails', async () => {
		setupSubtitlesEditorProjectFixture();
		vi.spyOn(Quran, 'getVerse').mockRejectedValue(new Error('Boom'));

		const component = render(WordsSelector);

		await expect.element(component.getByText('Error loading verse: Boom')).toBeVisible();
	});

	test('registers every shortcut on mount and unregisters them on unmount', async () => {
		setupSubtitlesEditorProjectFixture();
		const component = render(WordsSelector);

		await tick();

		for (const key of ['arrowright', 'arrowleft', 'home', 'a', 'end', 'pageup', 'enter']) {
			expect(shortcutMock.shortcuts.has(key)).toBe(true);
		}
		expect(shortcutMock.shortcuts.has('escape')).toBe(true);
		expect(shortcutMock.registerShortcut).toHaveBeenCalled();

		component.unmount();

		expect(shortcutMock.shortcuts.size).toBe(0);
		expect(shortcutMock.unregisterShortcut).toHaveBeenCalled();
	});

	test('navigates to the next verse and then the next surah with SELECT_NEXT_WORD', async () => {
		setupSubtitlesEditorProjectFixture({
			quranSurahs: punctuationQuranFixture,
			initialSurah: 1,
			initialVerse: 1,
			startWordIndex: 3,
			endWordIndex: 3
		});

		const component = render(WordsSelector);

		await waitForWord(component, 'A3');
		await triggerShortcut('ArrowRight');

		expect(globalState.getSubtitlesEditorState.selectedVerse).toBe(2);
		expect(globalState.getSubtitlesEditorState.startWordIndex).toBe(0);
		expect(globalState.getSubtitlesEditorState.endWordIndex).toBe(0);
		await waitForWord(component, 'B1');

		globalState.getSubtitlesEditorState.selectedVerse = 2;
		globalState.getSubtitlesEditorState.startWordIndex = 1;
		globalState.getSubtitlesEditorState.endWordIndex = 1;
		await tick();

		await triggerShortcut('ArrowRight');

		expect(globalState.getSubtitlesEditorState.selectedSurah).toBe(2);
		expect(globalState.getSubtitlesEditorState.selectedVerse).toBe(1);
		expect(globalState.getSubtitlesEditorState.startWordIndex).toBe(0);
		expect(globalState.getSubtitlesEditorState.endWordIndex).toBe(0);
		await waitForWord(component, 'C1');
	});

	test('navigates backward within the range, within the verse and across surahs with SELECT_PREVIOUS_WORD', async () => {
		setupSubtitlesEditorProjectFixture({
			quranSurahs: punctuationQuranFixture,
			initialSurah: 2,
			initialVerse: 1,
			startWordIndex: 0,
			endWordIndex: 1
		});

		const component = render(WordsSelector);

		await waitForWord(component, 'C1');

		await triggerShortcut('ArrowLeft');
		expect(globalState.getSubtitlesEditorState.startWordIndex).toBe(0);
		expect(globalState.getSubtitlesEditorState.endWordIndex).toBe(0);

		globalState.getSubtitlesEditorState.startWordIndex = 1;
		globalState.getSubtitlesEditorState.endWordIndex = 1;
		await tick();
		await triggerShortcut('ArrowLeft');
		expect(globalState.getSubtitlesEditorState.startWordIndex).toBe(0);
		expect(globalState.getSubtitlesEditorState.endWordIndex).toBe(0);

		await triggerShortcut('ArrowLeft');
		expect(globalState.getSubtitlesEditorState.selectedSurah).toBe(1);
		expect(globalState.getSubtitlesEditorState.selectedVerse).toBe(2);
		expect(globalState.getSubtitlesEditorState.startWordIndex).toBe(1);
		expect(globalState.getSubtitlesEditorState.endWordIndex).toBe(1);
		await waitForWord(component, 'B2');
	});

	test('supports reset, select-all and punctuation shortcuts', async () => {
		setupSubtitlesEditorProjectFixture({
			quranSurahs: punctuationQuranFixture,
			initialSurah: 1,
			initialVerse: 1,
			startWordIndex: 1,
			endWordIndex: 3
		});

		const component = render(WordsSelector);
		await waitForWord(component, 'A1');

		await triggerShortcut('Home');
		expect(globalState.getSubtitlesEditorState.startWordIndex).toBe(3);
		expect(globalState.getSubtitlesEditorState.endWordIndex).toBe(3);

		await triggerShortcut('A');
		expect(globalState.getSubtitlesEditorState.startWordIndex).toBe(0);
		expect(globalState.getSubtitlesEditorState.endWordIndex).toBe(3);

		globalState.getSubtitlesEditorState.startWordIndex = 0;
		globalState.getSubtitlesEditorState.endWordIndex = 0;
		await tick();
		await triggerShortcut('End');
		expect(globalState.getSubtitlesEditorState.endWordIndex).toBe(2);

		globalState.getSubtitlesEditorState.startWordIndex = 3;
		globalState.getSubtitlesEditorState.endWordIndex = 3;
		await tick();
		await triggerShortcut('PageUp');
		expect(globalState.getSubtitlesEditorState.startWordIndex).toBe(2);
		expect(globalState.getSubtitlesEditorState.endWordIndex).toBe(2);

		globalState.getSubtitlesEditorState.startWordIndex = 0;
		globalState.getSubtitlesEditorState.endWordIndex = 0;
		await tick();
		await triggerShortcut('PageUp');
		expect(globalState.getSubtitlesEditorState.endWordIndex).toBe(0);
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

		await triggerShortcut('Enter');
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
		await triggerShortcut('Enter');
		expect(globalState.getSubtitlesEditorState.startWordIndex).toBe(0);
		expect(globalState.getSubtitlesEditorState.endWordIndex).toBe(0);
	});

	test('edits the current subtitle, removes edited or last clips, and toggles edit mode shortcuts', async () => {
		const fixture = setupSubtitlesEditorProjectFixture({
			initialSurah: 1,
			initialVerse: 1,
			startWordIndex: 0,
			endWordIndex: 0,
			editSubtitle: new SubtitleClip(0, 500, 1, 1, 0, 0, 'Editing', [], false, false),
			timelineCursorPosition: 1500
		});

		render(WordsSelector);
		await tick();

		await triggerShortcut('Enter');
		expect(fixture.spies.editSubtitle).toHaveBeenCalledTimes(1);
		expect(globalState.getSubtitlesEditorState.editSubtitle).toBeNull();
		expect(globalState.getSubtitlesEditorState.startWordIndex).toBe(1);
		expect(globalState.getSubtitlesEditorState.endWordIndex).toBe(1);

		globalState.getSubtitlesEditorState.editSubtitle = fixture.clips[0];
		await tick();
		await triggerShortcut('Backspace');
		expect(fixture.spies.removeClip).toHaveBeenCalledWith(fixture.clips[0].id, true);
		expect(globalState.getSubtitlesEditorState.editSubtitle).toBeNull();

		await triggerShortcut('Backspace');
		expect(fixture.spies.removeLastClip).toHaveBeenCalledTimes(1);

		await triggerShortcut('E');
		expect(globalState.getSubtitlesEditorState.editSubtitle?.id).toBe(fixture.clips[1].id);
		await triggerShortcut('E');
		expect(globalState.getSubtitlesEditorState.editSubtitle).toBeNull();

		globalState.getTimelineState.cursorPosition = 5000;
		await tick();
		await triggerShortcut('E');
		expect(globalState.getSubtitlesEditorState.editSubtitle?.id).toBe(
			fixture.subtitleTrack.getLastClip()?.id
		);
	});

	test('handles silence, predefined subtitle and escape shortcuts', async () => {
		const fixture = setupSubtitlesEditorProjectFixture({
			editSubtitle: new SubtitleClip(0, 100, 1, 1, 0, 0, 'Edit', [], false, false),
			pendingSplitEditNextId: 123
		});

		render(WordsSelector);
		await tick();

		await triggerShortcut('S');
		expect(fixture.spies.addSilence).toHaveBeenCalledTimes(1);

		await triggerShortcut('B');
		await triggerShortcut('I');
		await triggerShortcut('M');
		await triggerShortcut('T');
		await triggerShortcut('H');
		await triggerShortcut('L');
		await triggerShortcut('D');
		expect(fixture.spies.addPredefinedSubtitle.mock.calls.map(([type]) => type)).toEqual([
			'Basmala',
			"Isti'adha",
			'Amin',
			'Takbir',
			'Tahmeed',
			'Tasleem',
			'Sadaqa'
		]);

		await triggerShortcut('Escape');
		expect(globalState.getSubtitlesEditorState.editSubtitle).toBeNull();
		expect(globalState.getSubtitlesEditorState.pendingSplitEditNextId).toBeNull();
	});

	test('adds a custom text clip with the expected time range in all supported cursor scenarios', async () => {
		const fixture = setupSubtitlesEditorProjectFixture({
			timelineCursorPosition: 5000
		});

		render(WordsSelector);
		await tick();

		await triggerShortcut('C');
		expect(fixture.spies.addCustomClip).toHaveBeenLastCalledWith('text', 2999, 5000);

		globalState.getTimelineState.cursorPosition = 2500;
		await tick();
		await triggerShortcut('C');
		expect(fixture.spies.addCustomClip).toHaveBeenLastCalledWith('text', 0, 2500);

		globalState.getTimelineState.cursorPosition = 50;
		await tick();
		await triggerShortcut('C');
		expect(fixture.spies.addCustomClip).toHaveBeenLastCalledWith('text', 0, 50);
	});
});
