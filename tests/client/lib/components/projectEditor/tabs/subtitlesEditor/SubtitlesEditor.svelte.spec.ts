import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { tick } from 'svelte';

import SubtitlesList from '$lib/components/projectEditor/tabs/subtitlesEditor/SubtitlesList.svelte';
import SubtitlesWorkspace from '$lib/components/projectEditor/tabs/subtitlesEditor/SubtitlesWorkspace.svelte';

import { Quran } from '$lib/classes/Quran';
import { Edition } from '$lib/classes/Edition';
import { SubtitleClip } from '$lib/classes/Clip.svelte';
import { ProjectTranslation } from '$lib/classes/ProjectTranslation.svelte';
import { VerseTranslation } from '$lib/classes/Translation.svelte';
import QPCFontProvider from '$lib/services/FontProvider';
import { globalState } from '$lib/runes/main.svelte';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';
import {
	resetSubtitlesEditorProjectFixture,
	setupSubtitlesEditorProjectFixture,
	seedSubtitlesEditorQuranFixture
} from '../../../../../fixtures/subtitlesEditor/projectFixture';

vi.mock('$lib/services/ShortcutService', () => ({
	default: {
		registerShortcut: vi.fn(),
		unregisterShortcut: vi.fn()
	}
}));

vi.mock('svelte-5-french-toast', () => ({
	default: {
		error: vi.fn(),
		info: vi.fn(),
		success: vi.fn(),
		warning: vi.fn()
	}
}));

function createRenderedFixture(initialSurah: number = 2, initialVerse: number = 1) {
	const fixture = setupSubtitlesEditorProjectFixture({ initialSurah, initialVerse });
	const workspace = render(SubtitlesWorkspace);
	const list = render(SubtitlesList);

	return { ...fixture, workspace, list };
}

type SubtitleEditorFixture = ReturnType<typeof createRenderedFixture>;

async function waitForEditorReady(workspace: SubtitleEditorFixture['workspace'], surahId: number) {
	const surahName = Quran.getSurahsNames().find((surah) => surah.id === surahId)?.transliteration;
	if (!surahName) {
		throw new Error(`Missing surah ${surahId} in the test Quran fixture.`);
	}

	await expect.element(workspace.getByRole('textbox')).toHaveValue(`${surahId}. ${surahName}`);
	await tick();
}

describe('Subtitles editor workflow', () => {
	beforeEach(() => {
		seedSubtitlesEditorQuranFixture();
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		resetSubtitlesEditorProjectFixture();
	});

	test('renders Quran references and quotations with their resolved translations in the segment list', async () => {
		loadLocale('en');
		setLocale('en');
		vi.spyOn(QPCFontProvider, 'loadQPC2Data').mockResolvedValue(undefined);
		const subtitle = new SubtitleClip(0, 1000, 'Before {{1:1:1-2}} {{quotation}} after');
		const fixture = setupSubtitlesEditorProjectFixture({ clips: [subtitle] });
		const translations = new ProjectTranslation();
		const edition = new Edition(
			'english',
			'english',
			'English',
			'English',
			'ltr',
			'test',
			'',
			'',
			''
		);
		translations.addedTranslationEditions = [edition];
		translations.versesTranslations.english = { '1:1': 'one two three' };
		globalState.currentProject!.content.projectTranslation = translations;
		const translation = new VerseTranslation(
			'Translated {{1:1:1-2}} {{translated quotation}} end',
			'ai translated'
		);
		translation.isStructuredTranslation = true;
		const settings = translation.getOrCreateQuranSegment('quran-0', '1:1:1-2', 2);
		settings.startUnitIndex = 1;
		settings.endUnitIndex = 2;
		subtitle.translations.english = translation;
		const component = render(SubtitlesList);

		await vi.waitFor(() => {
			expect(component.container.textContent).toContain('{W1V1-1 W1V1-2}');
			expect(component.container.textContent).toContain(
				'Translated {two three} translated quotation end'
			);
		});
		expect(component.container.textContent).not.toContain('{{');
		expect(
			getComputedStyle(component.container.querySelector('.text-emerald-200')!).fontFamily
		).toContain('Hafs');
		expect(component.container.textContent).not.toContain('W1V1-3');
		expect(component.container.querySelector('.text-amber-200')?.textContent).toBe('quotation');

		translation.quranSegments['quran-0'].isBruteForce = true;
		translation.quranSegments['quran-0'].manualText = 'Manual verse translation';
		await tick();
		expect(component.container.textContent).toContain(
			'Translated {Manual verse translation} translated quotation end'
		);
		expect(fixture.subtitleTrack.clips[0].text).toBe('Before {{1:1:1-2}} {{quotation}} after');
		expect(translation.text).toBe('Translated {{1:1:1-2}} {{translated quotation}} end');
		fixture.spies.getStyle.mockReturnValue({ value: true } as never);
		subtitle.text = 'Before {{1:1}} {{quotation}} after';
		await vi.waitFor(() => {
			expect(component.container.textContent).toContain('{W1V1-1 W1V1-2 W1V1-3 1}');
		});
		expect(component.container.textContent).not.toContain('\u06dd');

		subtitle.text = 'Before{{1:1}}{{quotation}}after';
		translation.text = 'Translated{{1:1}}{{translated quotation}}end';
		await vi.waitFor(() => {
			expect(component.container.textContent).toContain(
				'Before {W1V1-1 W1V1-2 W1V1-3 1} quotation after'
			);
			expect(component.container.textContent).toContain(
				'Translated {Manual verse translation} translated quotation end'
			);
		});
		expect(subtitle.text).toBe('Before{{1:1}}{{quotation}}after');
		expect(translation.text).toBe('Translated{{1:1}}{{translated quotation}}end');
	});

	test('saves a transcript without any speaker controls or speaker argument', async () => {
		loadLocale('en');
		setLocale('en');
		const { subtitleTrack } = setupSubtitlesEditorProjectFixture({
			clips: [],
			timelineCursorPosition: 1000
		});
		globalState.currentProject!.detail.speaker = 'Only speaker';
		const addTranscript = vi.spyOn(subtitleTrack, 'addTranscript').mockReturnValue(true);
		const workspace = render(SubtitlesWorkspace);
		await tick();
		expect(workspace.container.textContent).not.toContain('Add speaker');
		expect(workspace.container.textContent).not.toContain('Only speaker');
		const input = workspace.getByRole('textbox');
		await input.fill('A single spoken passage');
		input.element().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await expect.poll(() => addTranscript.mock.calls.length).toBe(1);
		expect(addTranscript).toHaveBeenCalledWith('A single spoken passage');
	});

	test('shows the saved surah on mount and updates the verse words after a new surah selection', async () => {
		const { workspace, list } = createRenderedFixture(2, 1);

		await waitForEditorReady(workspace, 2);

		await expect.element(workspace.getByPlaceholder('1')).toHaveValue(1);
		expect(list.container.querySelectorAll('[data-subtitle-id]')).toHaveLength(3);

		const surahInput = workspace.getByRole('textbox');
		await surahInput.fill('1');
		await expect.element(workspace.getByText('1. Al-Fatihah')).toBeVisible();
		await workspace.getByText('1. Al-Fatihah').click();

		await expect.element(surahInput).toHaveValue('1. Al-Fatihah');
		await expect.element(workspace.getByPlaceholder('1')).toHaveValue(1);
		await expect.element(workspace.getByText('W1V1-1', { exact: true }).first()).toBeVisible();

		const verseInput = workspace.getByPlaceholder('1');
		await verseInput.fill('2');
		await expect.element(verseInput).toHaveValue(2);
		await expect.element(workspace.getByText('W1V2-1', { exact: true }).first()).toBeVisible();
		await expect.element(workspace.getByText('W1V2-2', { exact: true }).first()).toBeVisible();
	});

	test('clicking an added subtitle syncs the selected verse and word range', async () => {
		const { workspace, list, clips } = createRenderedFixture(1, 1);

		await waitForEditorReady(workspace, 1);

		const targetClip = clips[2];
		const targetSubtitle = list.container.querySelector(
			`[data-subtitle-id="${targetClip.id}"]`
		) as HTMLElement | null;

		expect(targetSubtitle).not.toBeNull();
		targetSubtitle!.click();
		await tick();

		await expect.element(workspace.getByRole('textbox')).toHaveValue('2. Al-Baqarah');
		await expect.element(workspace.getByPlaceholder('1')).toHaveValue(2);

		const selectedWords = Array.from(workspace.container.querySelectorAll('.word-selected')).map(
			(node) => node.textContent?.replace(/\s+/g, ' ').trim()
		);

		expect(selectedWords).toHaveLength(2);
		expect(selectedWords.join(' ')).toContain('W2V2-2');
		expect(selectedWords.join(' ')).toContain('W2V2-3');
	});
});
