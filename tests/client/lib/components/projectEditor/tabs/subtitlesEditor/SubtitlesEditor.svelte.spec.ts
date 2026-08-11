import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { tick } from 'svelte';

import SubtitlesList from '$lib/components/projectEditor/tabs/subtitlesEditor/SubtitlesList.svelte';
import SubtitlesWorkspace from '$lib/components/projectEditor/tabs/subtitlesEditor/SubtitlesWorkspace.svelte';

import { Quran } from '$lib/classes/Quran';
import Settings from '$lib/classes/Settings.svelte';
import { setLocale } from '$lib/i18n/i18n-svelte';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { globalState } from '$lib/runes/main.svelte';
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

function createRenderedFixture(
	initialSurah: number = 2,
	initialVerse: number = 1,
	showPlaybackControls: boolean = false
) {
	const fixture = setupSubtitlesEditorProjectFixture({ initialSurah, initialVerse });
	const workspace = render(SubtitlesWorkspace, { showPlaybackControls });
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
		loadLocale('en');
		setLocale('en');
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
		expect(document.activeElement).not.toBe(
			workspace.container.querySelector('input[type="text"]')
		);
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

	test('adds subtitles from the player controls and persists their collapsed state', async () => {
		const saveSettings = vi.spyOn(Settings, 'save').mockResolvedValue();
		const { workspace, spies } = createRenderedFixture(1, 1, true);

		await waitForEditorReady(workspace, 1);

		const addSubtitleButton = workspace.container.querySelector(
			'.playback-control-button-confirm'
		) as HTMLButtonElement;
		expect(workspace.container.querySelector('.words-content')!.classList).toContain(
			'playback-controls-expanded'
		);
		expect(addSubtitleButton.getAttribute('data-help')).toContain('Enter');
		addSubtitleButton.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
		await tick();
		const controlDescription = workspace.container.querySelector(
			'[data-tour-id="subtitles-control-description"]'
		)!;
		expect(controlDescription.classList).toContain('active');
		expect(controlDescription.textContent).toContain('Enter');
		const helpButton = workspace.container.querySelector('[data-tour-id="subtitles-help-button"]')!;
		helpButton.dispatchEvent(new MouseEvent('mouseenter'));
		await tick();
		expect(workspace.container.querySelector('.subtitles-workspace')!.classList).not.toContain(
			'control-help-active'
		);
		const commandHelpToggle = workspace.container.querySelector(
			'[data-tour-id="subtitles-command-help-toggle"]'
		) as HTMLButtonElement;
		commandHelpToggle.click();
		await tick();
		expect(workspace.container.querySelector('.subtitles-workspace')!.classList).toContain(
			'control-help-active'
		);
		commandHelpToggle.click();
		await tick();
		addSubtitleButton.click();
		await vi.waitFor(() => expect(spies.addSubtitle).toHaveBeenCalledOnce());

		(workspace.container.querySelector('.controls-notch-handle') as HTMLButtonElement).click();
		await tick();

		expect(globalState.settings!.persistentUiState.subtitlesPlaybackControlsCollapsed).toBe(true);
		expect(workspace.container.querySelector('.playback-controls')).toBeNull();
		expect(workspace.container.querySelector('.words-content')!.classList).not.toContain(
			'playback-controls-expanded'
		);
		expect(saveSettings).toHaveBeenCalledOnce();
	});
});
