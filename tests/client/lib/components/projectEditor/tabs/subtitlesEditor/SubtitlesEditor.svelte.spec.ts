import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { tick } from 'svelte';

import SubtitlesList from '$lib/components/projectEditor/tabs/subtitlesEditor/SubtitlesList.svelte';
import SubtitlesWorkspace from '$lib/components/projectEditor/tabs/subtitlesEditor/SubtitlesWorkspace.svelte';

import { Quran } from '$lib/classes/Quran';
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
		await expect.element(workspace.getByText('W1V1-1', { exact: true })).toBeVisible();

		const verseInput = workspace.getByPlaceholder('1');
		await verseInput.fill('2');
		await expect.element(verseInput).toHaveValue(2);
		await expect.element(workspace.getByText('W1V2-1', { exact: true })).toBeVisible();
		await expect.element(workspace.getByText('W1V2-2', { exact: true })).toBeVisible();
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
