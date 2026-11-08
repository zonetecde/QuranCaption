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
	TrackType,
	VerseRange
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
import AiBoldModal from '$lib/components/projectEditor/tabs/translationsEditor/modal/AiBoldModal.svelte';
import AiTranslationReviewModal from '$lib/components/projectEditor/tabs/translationsEditor/modal/AiTranslationReviewModal.svelte';
import AiWbwTranslationModal from '$lib/components/projectEditor/tabs/translationsEditor/modal/AiWbwTranslationModal.svelte';
import AiSubtitleSplitModal from '$lib/components/projectEditor/tabs/subtitlesEditor/AiSubtitleSplitModal.svelte';
import ExportVideo from '$lib/components/projectEditor/tabs/export/ExportVideo.svelte';
import { buildAiWbwTranslationCandidates } from '$lib/services/AiWbwTranslationMappingService';
import { buildAiSubtitleSplitCandidates } from '$lib/services/AiSubtitleSplittingService';
import { buildMeaningExportVerses } from '$lib/services/MeaningExportRangeService';

vi.mock('$lib/services/AiWbwTranslationMappingService', { spy: true });
vi.mock('$lib/services/AiSubtitleSplittingService', { spy: true });
vi.mock('$lib/services/MeaningExportRangeService', { spy: true });
vi.mock('$lib/components/projectEditor/tabs/styleEditor/Style.svelte', async () => ({
	default: (await import('../../../../../stubs/EmptyComponent.svelte')).default
}));

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
	vi.unstubAllGlobals();
	globalState.currentProject = null;
	globalState.settings = originalSettings;
});

/**
 * Wraps any feature response using the currently copied prompt identifier.
 * @param {unknown} result Feature-specific JSON result.
 * @returns {string} Complete response envelope.
 */
function featureReply(result: unknown): string {
	return JSON.stringify({ requestId: copied.match(/"requestId":"([^"]+)"/)![1], result });
}

test('runs manual bold with the API validator and supports undo', async () => {
	const close = vi.fn();
	const component = render(AiBoldModal, { close });
	await component.getByRole('button', { name: 'Prepare prompts', exact: true }).click();
	await component.getByRole('button', { name: 'Copy prompt', exact: true }).click();
	const input = component.getByRole('textbox', { name: '2. Paste the full reply here' });
	await input.fill(featureReply({ segments: [{ segmentIndex: 0, boldWordIndexes: [99] }] }));
	await component.getByRole('button', { name: 'Check reply and continue' }).click();
	await expect.element(component.getByRole('button', { name: 'Copy retry prompt' })).toBeVisible();
	await input.fill(
		featureReply({
			segments: [
				{ segmentIndex: 0, boldWordIndexes: [0] },
				{ segmentIndex: 1, boldWordIndexes: [] }
			]
		})
	);
	await component.getByRole('button', { name: 'Check reply and continue' }).click();
	await expect.poll(() => close.mock.calls.length).toBe(1);
	expect(
		(globalState.getSubtitleClips[0].translations[edition.name] as VerseTranslation)
			.inlineStyleRuns?.[0].bold
	).toBe(true);
	expect(
		vi.mocked(invoke).mock.calls.every(([command]) => command === 'prepare_manual_ai_prompt')
	).toBe(true);
	expect(vi.mocked(invoke).mock.calls[0][1]).toMatchObject({ kind: 'translation_bold' });
	expect(ProjectHistoryManager.undo()).toBe(true);
	expect(
		(globalState.getSubtitleClips[0].translations[edition.name] as VerseTranslation).inlineStyleRuns
	).toEqual([]);
});

test('reviews translations manually using the existing issue marking and undo', async () => {
	globalState.getSubtitleClips.forEach((clip) => {
		clip.translations[edition.name].status = 'ai trimmed';
	});
	const close = vi.fn();
	const component = render(AiTranslationReviewModal, { close });
	await component.getByRole('button', { name: 'Prepare prompts', exact: true }).click();
	await component.getByRole('button', { name: 'Copy prompt', exact: true }).click();
	await component.getByRole('textbox', { name: '2. Paste the full reply here' }).fill(
		featureReply({
			issues: [{ id: 0, reason: 'semantic_mismatch' }]
		})
	);
	await component.getByRole('button', { name: 'Check reply and continue' }).click();
	await expect.poll(() => close.mock.calls.length).toBe(1);
	expect(
		globalState.getSubtitleClips.map((clip) => clip.translations[edition.name].status)
	).toEqual(['to review', 'ai trimmed']);
	expect(ProjectHistoryManager.undo()).toBe(true);
	expect(globalState.getSubtitleClips[0].translations[edition.name].status).toBe('ai trimmed');
});

test('maps WBW manually with the same indexed ranges and undo', async () => {
	const subtitle = globalState.getSubtitleClips[0];
	vi.mocked(buildAiWbwTranslationCandidates).mockResolvedValue([
		{
			segmentIndex: 0,
			verseKey: '1:1',
			startTime: 0,
			endTime: 2000,
			segmentArabic: subtitle.text,
			arabicWords: [{ index: 0, arabic: subtitle.text, helper: 'Source' }],
			translationText: 'Source words',
			translationIndexed: '0:Source 1:words',
			translationUnits: ['Source', 'words'],
			wordCount: 2,
			arabicWordCount: 1,
			subtitle
		}
	]);
	const close = vi.fn();
	const component = render(AiWbwTranslationModal, { close });
	await expect
		.element(component.getByRole('button', { name: 'Prepare prompts', exact: true }))
		.toBeEnabled();
	await component.getByRole('button', { name: 'Prepare prompts', exact: true }).click();
	await component.getByRole('button', { name: 'Copy prompt', exact: true }).click();
	await component.getByRole('textbox', { name: '2. Paste the full reply here' }).fill(
		featureReply({
			s: [{ i: 0, r: [{ i: 0, s: 0, e: 1 }] }]
		})
	);
	await component.getByRole('button', { name: 'Check reply and continue' }).click();
	await expect.poll(() => close.mock.calls.length).toBe(1);
	expect((subtitle.translations[edition.name] as VerseTranslation).wbwRanges).toEqual([
		{ arabicWordIndex: 0, startUnitIndex: 0, endUnitIndex: 1 }
	]);
	expect(ProjectHistoryManager.undo()).toBe(true);
	expect(
		(globalState.getSubtitleClips[0].translations[edition.name] as VerseTranslation).wbwRanges
	).toEqual([]);
});

test('validates semantic split boundaries manually and cancels without editing subtitles', async () => {
	const subtitle = globalState.getSubtitleClips[0];
	subtitle.endWordIndex = 5;
	vi.mocked(buildAiSubtitleSplitCandidates).mockResolvedValue([
		{
			segmentIndex: 0,
			verseKey: '1:1',
			startTime: 0,
			endTime: 2000,
			wordCount: 6,
			maxWords: 5,
			words: Array.from({ length: 6 }, (_, index) => ({ index, arabic: `word${index}` })),
			subtitle
		}
	]);
	const component = render(AiSubtitleSplitModal, { close: vi.fn() });
	await expect
		.element(component.getByRole('button', { name: 'Prepare prompts', exact: true }))
		.toBeEnabled();
	await component.getByRole('button', { name: 'Prepare prompts', exact: true }).click();
	await component.getByRole('button', { name: 'Copy prompt', exact: true }).click();
	await component
		.getByRole('textbox', { name: '2. Paste the full reply here' })
		.fill(featureReply({ s: [{ i: 0, e: [5] }] }));
	await component.getByRole('button', { name: 'Check reply and continue' }).click();
	await expect.element(component.getByRole('button', { name: 'Copy retry prompt' })).toBeVisible();
	await component.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect
		.element(component.getByRole('button', { name: 'Prepare prompts', exact: true }))
		.toBeEnabled();
	expect(globalState.getSubtitleClips).toHaveLength(2);
	expect(subtitle.endWordIndex).toBe(5);
});

test.each(['missing-key', 'quota-error', 'success'])(
	'opens the meaning export manual modal only when needed: %s',
	async (mode) => {
		vi.spyOn(VerseRange.prototype, 'toString').mockReturnValue('Surah 1: 1');
		vi.mocked(buildMeaningExportVerses).mockResolvedValue([
			{
				key: '1:1',
				surah: 1,
				verse: 1,
				startTime: 0,
				endTime: 4000,
				durationMs: 4000,
				arabic: 'Source'
			}
		]);
		globalState.getExportState.exportRangeMode = 'meaning';
		globalState.settings!.persistentUiState.videoExportFolder = 'C:/exports';
		globalState.settings!.aiTranslationSettings.openAiApiKey =
			mode === 'missing-key' ? '' : 'test-key';
		const fetchMock = vi.fn().mockResolvedValue(
			mode === 'quota-error'
				? new Response('', { status: 429 })
				: Response.json({
						choices: [{ message: { content: '{"ranges":[{"start":"1:1","end":"1:1"}]}' } }]
					})
		);
		vi.stubGlobal('fetch', fetchMock);
		const component = render(ExportVideo);
		await component.getByRole('button', { name: 'Generate meaning ranges', exact: true }).click();
		if (mode !== 'success') {
			await expect
				.element(page.getByRole('button', { name: 'Copy prompt', exact: true }))
				.toBeVisible();
			await page.getByRole('button', { name: 'Copy prompt', exact: true }).click();
			expect(copied).toContain('You are a Quran video semantic range assistant.');
			await page
				.getByRole('textbox', { name: '2. Paste the full reply here' })
				.fill(featureReply({ ranges: [{ start: '1:1', end: '1:1' }] }));
			await page.getByRole('button', { name: 'Check reply and continue' }).click();
		}
		await expect.poll(() => globalState.getExportState.meaningRanges.length).toBe(1);
		expect(document.querySelector('.modal-wrapper')).toBeNull();
		expect(fetchMock).toHaveBeenCalledTimes(mode === 'missing-key' ? 0 : 1);
		expect(ProjectHistoryManager.undo()).toBe(true);
		expect(globalState.getExportState.meaningRanges).toEqual([]);
	}
);

test('keeps the API workflow and automatically applies the final reply in one undoable operation', async () => {
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
	expect(globalState.getSubtitleClips.map((clip) => clip.translations[edition.name].text)).toEqual([
		'Source words',
		'Source words'
	]);
	expect(
		vi.mocked(invoke).mock.calls.every(([command]) => command === 'prepare_manual_ai_prompt')
	).toBe(true);
	await component.getByRole('button', { name: 'Check reply and continue' }).click();
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

test.each([
	['```json\n', '\n```'],
	['Here is the JSON response:\n', '\nThe response is complete.'],
	['Here is the response:\n```json\n', '\n```\nThe response is complete.']
])('cleans pasted replies wrapped in %s and %s before validation', async (prefix, suffix) => {
	const close = vi.fn();
	const component = render(AskIAModal, { close, edition });
	await component.getByRole('tab', { name: 'Without API key' }).click();
	await component.getByRole('button', { name: 'Prepare prompts', exact: true }).click();
	await component.getByRole('button', { name: 'Copy prompt', exact: true }).click();
	const input = component.getByRole('textbox', { name: '2. Paste the full reply here' });
	const json = reply();
	await input.fill(prefix + json + suffix);
	await expect.element(input).toHaveValue(prefix + json + suffix);
	await component.getByRole('button', { name: 'Check reply and continue' }).click();
	await expect.poll(() => close.mock.calls.length).toBe(1);
});

test('repairs Gemini text quotes before removing unit indexes and automatically applying translations', async () => {
	setupProject('He said: "Hello".');
	const close = vi.fn();
	const component = render(AskIAModal, { close, edition });
	await component.getByRole('tab', { name: 'Without API key' }).click();
	await component.getByRole('button', { name: 'Prepare prompts', exact: true }).click();
	await component.getByRole('button', { name: 'Copy prompt', exact: true }).click();
	const response = reply('1:1', ['0:He 1:said:', '2:"Hello".']).replace(/\\"/g, '"');
	const input = component.getByRole('textbox', { name: '2. Paste the full reply here' });
	await input.fill(response);
	await expect.element(input).toHaveValue(response);
	await component.getByRole('button', { name: 'Check reply and continue' }).click();
	await expect.poll(() => close.mock.calls.length).toBe(1);
	expect(globalState.getSubtitleClips.map((clip) => clip.translations[edition.name].text)).toEqual([
		'He said:',
		'"Hello".'
	]);
	expect(
		globalState.getSubtitleClips.map((clip) => clip.translations[edition.name].status)
	).toEqual(['ai trimmed', 'ai trimmed']);
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
		.fill(reply('1:2', ['words']));
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

test.each([
	['missing coverage', ['Source', 'Source']],
	['unmappable text', ['Source words', 'Source invented']]
])(
	'accepts content errors and marks only affected translations on application: %s',
	async (_, texts) => {
		const close = vi.fn();
		const component = render(AskIAModal, { close, edition });
		await component.getByRole('tab', { name: 'Without API key' }).click();
		await component.getByRole('button', { name: 'Prepare prompts', exact: true }).click();
		await component.getByRole('button', { name: 'Copy prompt', exact: true }).click();
		await component
			.getByRole('textbox', { name: '2. Paste the full reply here' })
			.fill(reply('1:1', texts));
		expect(
			globalState.getSubtitleClips.map((clip) => clip.translations[edition.name].status)
		).toEqual(['to review', 'to review']);
		await component.getByRole('button', { name: 'Check reply and continue' }).click();
		await expect.poll(() => close.mock.calls.length).toBe(1);
		expect(
			globalState.getSubtitleClips.map((clip) => clip.translations[edition.name].status)
		).toEqual(['ai trimmed', 'ai error']);
		expect(ProjectHistoryManager.undo()).toBe(true);
		expect(
			globalState.getSubtitleClips.map((clip) => clip.translations[edition.name].status)
		).toEqual(['to review', 'to review']);
		expect(ProjectHistoryManager.redo()).toBe(true);
		expect(
			globalState.getSubtitleClips.map((clip) => clip.translations[edition.name].status)
		).toEqual(['ai trimmed', 'ai error']);
	}
);

test('waits for every batch before automatically applying and saving once', async () => {
	const words = Array.from({ length: 101 }, (_, index) => `word${index}`);
	const source = words.join(' ');
	const project = setupProject(source, 2);
	const close = vi.fn();
	const component = render(AskIAModal, { close, edition });
	await component.getByRole('tab', { name: 'Without API key' }).click();
	const slider = component.container.querySelector('#manual-ai-batch-size') as HTMLInputElement;
	slider.value = '100';
	slider.dispatchEvent(new Event('input', { bubbles: true }));
	await component.getByRole('button', { name: 'Prepare prompts', exact: true }).click();
	const texts = [words.slice(0, 50).join(' '), words.slice(50).join(' ')];
	await component.getByRole('button', { name: 'Copy prompt', exact: true }).click();
	await component
		.getByRole('textbox', { name: '2. Paste the full reply here' })
		.fill(reply('1:1', texts));
	await component.getByRole('button', { name: 'Check reply and continue' }).click();
	await expect.poll(() => vi.mocked(invoke).mock.calls.length).toBe(2);
	expect(project.save).not.toHaveBeenCalled();
	expect(close).not.toHaveBeenCalled();
	expect(
		globalState.getSubtitleClips.every((clip) => clip.translations[edition.name].text === source)
	).toBe(true);
	await component.getByRole('button', { name: 'Copy prompt', exact: true }).click();
	await component
		.getByRole('textbox', { name: '2. Paste the full reply here' })
		.fill(reply('1:2', texts));
	await component.getByRole('button', { name: 'Check reply and continue' }).click();
	await expect.poll(() => close.mock.calls.length).toBe(1);
	expect(project.save).toHaveBeenCalledTimes(1);
	expect(globalState.getSubtitleClips.map((clip) => clip.translations[edition.name].text)).toEqual([
		...texts,
		...texts
	]);
	expect(ProjectHistoryManager.undo()).toBe(true);
	expect(
		globalState.getSubtitleClips.every((clip) => clip.translations[edition.name].text === source)
	).toBe(true);
	expect(ProjectHistoryManager.undo()).toBe(false);
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

test('rejects replies after a subtitle changes without applying translations', async () => {
	const component = render(AskIAModal, { close: vi.fn(), edition });
	await component.getByRole('tab', { name: 'Without API key' }).click();
	await component.getByRole('button', { name: 'Prepare prompts', exact: true }).click();
	await component.getByRole('button', { name: 'Copy prompt', exact: true }).click();
	await component.getByRole('textbox', { name: '2. Paste the full reply here' }).fill(reply());
	globalState.getSubtitleClips[0].text = 'Changed source';
	await component.getByRole('button', { name: 'Check reply and continue' }).click();
	await expect
		.element(
			component.getByText('The project, subtitles or translations changed.', { exact: false })
		)
		.toBeVisible();
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
