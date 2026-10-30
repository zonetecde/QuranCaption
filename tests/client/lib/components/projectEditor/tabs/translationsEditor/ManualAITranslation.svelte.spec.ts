import { cleanup, render } from 'vitest-browser-svelte';
import { page } from '@vitest/browser/context';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import '../../../../../../../src/app.css';
import 'material-icons/iconfont/material-icons.css';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { listen } from '@tauri-apps/api/event';
import {
	Edition,
	Project,
	ProjectContent,
	ProjectDetail,
	SubtitleClip,
	Timeline,
	TrackType
} from '$lib/classes';
import { AssetTrack, SubtitleTrack } from '$lib/classes/Track.svelte';
import { VerseTranslation } from '$lib/classes/Translation.svelte';
import { initializeClassRegistry } from '$lib/classes/ClassRegistry';
import Settings from '$lib/classes/Settings.svelte';
import { globalState } from '$lib/runes/main.svelte';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import AskIAModal from '$lib/components/projectEditor/tabs/translationsEditor/modal/AskIAModal.svelte';

vi.mock('@tauri-apps/api/core', async (original) => ({
	...(await original<typeof import('@tauri-apps/api/core')>()),
	invoke: vi.fn()
}));
vi.mock('@tauri-apps/api/event', async (original) => ({
	...(await original<typeof import('@tauri-apps/api/event')>()),
	listen: vi.fn().mockResolvedValue(vi.fn())
}));
vi.mock('@tauri-apps/plugin-opener', async (original) => ({
	...(await original<typeof import('@tauri-apps/plugin-opener')>()),
	openUrl: vi.fn().mockResolvedValue(undefined)
}));

const edition = new Edition('key', 'edition', 'Author', 'English', 'ltr', '', '', '', '');
const originalSettings = globalState.settings;
let copied = '';

/**
 * Creates an untrimmed project using a controlled source translation.
 * @param {string} source Original edition text.
 * @param {number} verseCount Number of verses to include.
 * @returns {Project} Project opened in the editor.
 */
function setupProject(source = 'Source words', verseCount = 1): Project {
	const track = new SubtitleTrack();
	track.clips = Array.from({ length: verseCount }, (_, verse) => [
		new SubtitleClip(
			verse * 4000,
			verse * 4000 + 2000,
			1,
			verse + 1,
			0,
			0,
			'الأول',
			[],
			false,
			false,
			{ [edition.name]: new VerseTranslation(source, 'to review') }
		),
		new SubtitleClip(
			verse * 4000 + 2000,
			verse * 4000 + 4000,
			1,
			verse + 1,
			1,
			1,
			'الثاني',
			[],
			false,
			true,
			{ [edition.name]: new VerseTranslation(source, 'to review') }
		)
	]).flat();
	const project = new Project(
		new ProjectDetail('Manual translation', 'Speaker'),
		new ProjectContent(
			new Timeline([track, new AssetTrack(TrackType.Audio), new AssetTrack(TrackType.Video)])
		)
	);
	project.content.projectTranslation.addedTranslationEditions = [edition];
	project.content.projectTranslation.versesTranslations[edition.name] = Object.fromEntries(
		Array.from({ length: verseCount }, (_, index) => [`1:${index + 1}`, source])
	);
	globalState.currentProject = project;
	vi.spyOn(project, 'save').mockResolvedValue();
	vi.spyOn(project.detail, 'updatePercentageTranslated').mockImplementation(() => undefined);
	ProjectHistoryManager.resetForCurrentProject();
	return project;
}

/**
 * Builds a complete reply for the prompt currently copied to the clipboard.
 * @param {string} verseKey Verse returned by this batch.
 * @param {string[]} texts Translation spans for its two segments.
 * @returns {string} Reply with the exact prompt identifier.
 */
function reply(verseKey = '1:1', texts = ['Source', 'words']): string {
	return JSON.stringify({
		requestId: copied.match(/"requestId":"([^"]+)"/)![1],
		result: {
			verses: [{ verseKey, segments: texts.map((text, i) => ({ i, text })) }]
		}
	});
}

beforeEach(async () => {
	await page.viewport(1280, 900);
	loadLocale('en');
	setLocale('en');
	initializeClassRegistry();
	globalState.settings = new Settings();
	vi.spyOn(Settings, 'save').mockResolvedValue();
	vi.mocked(invoke).mockResolvedValue('Hidden instructions');
	vi.mocked(listen).mockResolvedValue(vi.fn());
	vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(async (text) => {
		copied = text;
	});
	copied = '';
	setupProject();
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.mocked(invoke).mockReset();
	globalState.currentProject = null;
	globalState.settings = originalSettings;
});

test('keeps the API workflow and validates manual replies before one undoable application', async () => {
	const close = vi.fn();
	const component = render(AskIAModal, { close, edition });
	await expect
		.element(component.getByRole('button', { name: 'Run Advanced AI Trimming' }))
		.toBeVisible();
	expect(component.container.textContent).not.toContain('Legacy AI Mapping');
	await component.getByRole('tab', { name: 'Without API key' }).click();
	await component.getByRole('button', { name: 'Prepare prompts', exact: true }).click();
	const input = component.getByRole('textbox', { name: '2. Paste the full reply here' });
	await expect.element(input).toBeVisible();
	await expect
		.element(component.getByRole('button', { name: 'Check reply and continue' }))
		.toBeDisabled();
	expect(component.container.textContent).not.toContain('Hidden instructions');
	await component.getByRole('button', { name: 'Open ChatGPT' }).click();
	expect(openUrl).toHaveBeenCalledWith('https://chatgpt.com/');
	await component.getByRole('button', { name: 'Copy prompt', exact: true }).click();
	await input.fill('{incomplete');
	await component.getByRole('button', { name: 'Check reply and continue' }).click();
	await expect.element(component.getByRole('button', { name: 'Copy retry prompt' })).toBeVisible();
	await input.fill(reply().replace(/"requestId":"[^"]+"/, '"requestId":"wrong"'));
	await component.getByRole('button', { name: 'Check reply and continue' }).click();
	await expect
		.element(component.getByText('This reply does not match this prompt.', { exact: false }))
		.toBeVisible();
	await input.fill(reply());
	await component.getByRole('button', { name: 'Check reply and continue' }).click();
	await expect.element(component.getByText('All replies have been checked')).toBeVisible();
	expect(globalState.getSubtitleClips.map((clip) => clip.translations[edition.name].text)).toEqual([
		'Source words',
		'Source words'
	]);
	expect(
		vi.mocked(invoke).mock.calls.every(([command]) => command === 'prepare_manual_ai_prompt')
	).toBe(true);
	await component.getByRole('button', { name: 'Apply translations' }).click();
	await expect.poll(() => close.mock.calls.length).toBe(1);
	expect(globalState.getSubtitleClips.map((clip) => clip.translations[edition.name].text)).toEqual([
		'Source',
		'words'
	]);
	expect(ProjectHistoryManager.undo()).toBe(true);
	expect(globalState.getSubtitleClips.map((clip) => clip.translations[edition.name].text)).toEqual([
		'Source words',
		'Source words'
	]);
});

test('keeps accepted batches when the next reply must be regenerated, then cancels without partial edits', async () => {
	const words = Array.from({ length: 101 }, (_, index) => `word${index}`);
	const source = words.join(' ');
	const project = setupProject(source, 2);
	const component = render(AskIAModal, { close: vi.fn(), edition });
	await component.getByRole('tab', { name: 'Without API key' }).click();
	const slider = component.container.querySelector('#manual-ai-batch-size') as HTMLInputElement;
	slider.value = '100';
	slider.dispatchEvent(new Event('input', { bubbles: true }));
	await component.getByRole('button', { name: 'Prepare prompts', exact: true }).click();
	await component.getByRole('button', { name: 'Copy prompt', exact: true }).click();
	const firstReply = reply('1:1', [words.slice(0, 50).join(' '), words.slice(50).join(' ')]);
	await component.getByRole('textbox', { name: '2. Paste the full reply here' }).fill(firstReply);
	await component.getByRole('button', { name: 'Check reply and continue' }).click();
	await expect.poll(() => vi.mocked(invoke).mock.calls.length).toBe(2);
	await component.getByRole('button', { name: 'Copy prompt', exact: true }).click();
	await component
		.getByRole('textbox', { name: '2. Paste the full reply here' })
		.fill(reply('1:2', ['invented', 'words']));
	await component.getByRole('button', { name: 'Check reply and continue' }).click();
	await expect.element(component.getByRole('button', { name: 'Copy retry prompt' })).toBeVisible();
	await component.getByRole('button', { name: 'Prompt 1', exact: true }).click();
	expect((component.getByRole('textbox').element() as HTMLTextAreaElement).value).toBe(firstReply);
	await component.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect
		.element(component.getByRole('button', { name: 'Prepare prompts', exact: true }))
		.toBeEnabled();
	expect(
		globalState.getSubtitleClips.every((clip) => clip.translations[edition.name].text === source)
	).toBe(true);
	expect(project.save).not.toHaveBeenCalled();
});

test('selects every verse by default and counts the chosen verses when their timings overlap', async () => {
	setupProject('Source words', 3);
	// An earlier verse can extend beyond the last one when it occurs again in the timeline.
	globalState.getSubtitleClips[3].endTime = 14000;
	const component = render(AskIAModal, { close: vi.fn(), edition });
	await component.getByRole('tab', { name: 'Without API key' }).click();
	const end = component.getByRole('slider', { name: 'To Ayah', exact: true });
	await expect.element(end).toHaveAttribute('aria-valuetext', '1:3');
	expect((end.element() as HTMLElement).style.left).toBe('100%');
	await expect.element(component.getByText('3 items selected', { exact: true })).toBeVisible();
	end.element().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
	await expect.element(end).toHaveAttribute('aria-valuetext', '1:2');
	await expect.element(component.getByText('2 items selected', { exact: true })).toBeVisible();
	component
		.getByRole('slider', { name: 'From Ayah', exact: true })
		.element()
		.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
	await expect.element(component.getByText('1 items selected', { exact: true })).toBeVisible();
	await component.getByRole('button', { name: 'Prepare prompts', exact: true }).click();
	await expect.poll(() => vi.mocked(invoke).mock.calls.length).toBe(1);
	expect(vi.mocked(invoke).mock.calls[0][1]).toMatchObject({
		request: { batch: { verses: [{ verseKey: '1:2' }] } }
	});
});

test('rejects stale previews after a subtitle changes', async () => {
	const component = render(AskIAModal, { close: vi.fn(), edition });
	await component.getByRole('tab', { name: 'Without API key' }).click();
	await component.getByRole('button', { name: 'Prepare prompts', exact: true }).click();
	await component.getByRole('button', { name: 'Copy prompt', exact: true }).click();
	await component.getByRole('textbox', { name: '2. Paste the full reply here' }).fill(reply());
	await component.getByRole('button', { name: 'Check reply and continue' }).click();
	await expect.element(component.getByRole('button', { name: 'Apply translations' })).toBeVisible();
	globalState.getSubtitleClips[0].text = 'Changed source';
	await component.getByRole('button', { name: 'Apply translations' }).click();
	await expect
		.element(component.getByRole('alert'))
		.toHaveTextContent('The project, subtitles or translations changed.');
	expect(globalState.getSubtitleClips[0].translations[edition.name].text).toBe('Source words');
});

test('supports keyboard tabs and keeps retry controls reachable in a narrow window', async () => {
	await page.viewport(540, 900);
	const component = render(AskIAModal, { close: vi.fn(), edition });
	const apiTab = component.getByRole('tab', { name: 'With API', exact: true }).element();
	apiTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
	await expect
		.element(component.getByRole('tab', { name: 'Without API key' }))
		.toHaveAttribute('aria-selected', 'true');
	await component.getByRole('button', { name: 'Prepare prompts', exact: true }).click();
	await component.getByRole('textbox', { name: '2. Paste the full reply here' }).fill('invalid');
	await component.getByRole('button', { name: 'Check reply and continue' }).click();
	await expect.element(component.getByRole('button', { name: 'Copy retry prompt' })).toBeVisible();
	const shell = component.container.firstElementChild as HTMLElement;
	expect(shell.scrollWidth).toBeLessThanOrEqual(shell.clientWidth);
});
