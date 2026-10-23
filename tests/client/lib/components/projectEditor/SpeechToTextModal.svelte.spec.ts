import { cleanup, render } from 'vitest-browser-svelte';
import { page } from '@vitest/browser/context';
import '../../../../../src/app.css';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
	Asset,
	AssetClip,
	Project,
	ProjectContent,
	ProjectDetail,
	SilenceClip,
	SubtitleClip,
	Timeline,
	TrackType
} from '$lib/classes';
import { AssetTrack, SubtitleTrack } from '$lib/classes/Track.svelte';
import Settings from '$lib/classes/Settings.svelte';
import { globalState } from '$lib/runes/main.svelte';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';
import SpeechToTextModal from '$lib/components/modals/tools/SpeechToTextModal.svelte';
import TranscriptKeySettings from '$lib/components/settings/TranscriptKeySettings.svelte';
import SettingsModal from '$lib/components/settings/Settings.svelte';
import { transcribeProjectAudio } from '$lib/services/SpeechToTextService';
import { rearrangeProjectSubtitles } from '$lib/services/SubtitleRearrangementService';
import RearrangeSubtitlesModal from '$lib/components/modals/tools/RearrangeSubtitlesModal.svelte';
import SubtitlesEditorSettings from '$lib/components/projectEditor/tabs/subtitlesEditor/SubtitlesEditorSettings.svelte';
import ModalManager from '$lib/components/modals/ModalManager';
import { openUrl } from '@tauri-apps/plugin-opener';

vi.mock('@tauri-apps/plugin-opener', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tauri-apps/plugin-opener')>()),
	openUrl: vi.fn(async () => {})
}));

vi.mock('$lib/services/SpeechToTextService', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/services/SpeechToTextService')>()),
	transcribeProjectAudio: vi.fn()
}));
vi.mock('$lib/services/SubtitleRearrangementService', () => ({
	rearrangeProjectSubtitles: vi.fn()
}));

const originalSettings = globalState.settings;
const applyRearrangement = vi.fn();

beforeEach(() => {
	loadLocale('en');
	setLocale('en');
	globalState.settings = new Settings();
	vi.spyOn(Settings, 'save').mockResolvedValue(undefined);
	vi.mocked(transcribeProjectAudio).mockResolvedValue({ count: 2 });
	applyRearrangement.mockReset().mockReturnValue({ count: 2, skipped: 0 });
	vi.mocked(rearrangeProjectSubtitles).mockImplementation(async () => ({
		before: globalState.getSubtitleClips,
		after: [new SubtitleClip(0, 3000, 'Proposed subtitle boundaries')],
		skipped: 0,
		apply: applyRearrangement
	}));
	const asset = new Asset();
	asset.id = 42;
	asset.fileName = 'lecture.wav';
	asset.filePath = '/lecture.wav';
	const audio = new AssetTrack(TrackType.Audio);
	audio.clips.push(new AssetClip(0, 10000, asset.id));
	globalState.currentProject = new Project(
		new ProjectDetail('Lecture', 'Speaker'),
		new ProjectContent(new Timeline([new SubtitleTrack(), audio]), [asset])
	);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.mocked(transcribeProjectAudio).mockReset();
	vi.mocked(rearrangeProjectSubtitles).mockReset();
	globalState.currentProject = null;
	globalState.settings = originalSettings;
	vi.mocked(openUrl).mockClear();
	globalState.uiState.isSettingsOpen = false;
});

test('shows both transcription key guides in settings and opens their key pages', async () => {
	const component = render(TranscriptKeySettings);
	await expect
		.element(component.getByText('Open Groq Console and sign in or create an account.'))
		.toBeVisible();
	await component.getByRole('button', { name: 'Open API keys page', exact: true }).nth(0).click();
	expect(openUrl).toHaveBeenLastCalledWith('https://console.groq.com/keys');
	await expect.element(component.getByText(/enable the Speech to Text permission/)).toBeVisible();
	await component.getByRole('button', { name: 'Open API keys page', exact: true }).nth(1).click();
	expect(openUrl).toHaveBeenLastCalledWith('https://elevenlabs.io/app/developers/api-keys');
	expect(transcribeProjectAudio).not.toHaveBeenCalled();
});

test('automatically saves both keys independently and preserves them when saving transcription preferences', async () => {
	await page.viewport(1024, 900);
	const keySettings = render(TranscriptKeySettings);
	await keySettings.getByLabelText('Groq API key', { exact: true }).fill('groq-personal');
	await vi.waitFor(() => expect(Settings.save).toHaveBeenCalled());
	await keySettings.getByLabelText('ElevenLabs API key', { exact: true }).fill('eleven-personal');
	await vi.waitFor(() =>
		expect(globalState.settings!.speechToTextSettings.elevenLabsApiKey).toBe('eleven-personal')
	);
	cleanup();
	const component = render(SpeechToTextModal, { close: vi.fn() });
	globalState.settings!.speechToTextSettings.groqApiKey = 'updated-groq-key';
	await component.getByRole('combobox', { name: 'Provider' }).selectOptions('elevenlabs');
	await component.getByRole('combobox', { name: 'Model' }).selectOptions('scribe_v1');
	await component.getByRole('button', { name: 'Save', exact: true }).click();
	expect(globalState.settings!.speechToTextSettings).toMatchObject({
		groqApiKey: 'updated-groq-key',
		elevenLabsApiKey: 'eleven-personal',
		provider: 'elevenlabs',
		elevenLabsModel: 'scribe_v1'
	});
	expect(component.container.querySelector('input[type="password"]')).toBeNull();
});

test('opens the separate transcription keys tab when the provider key is missing', async () => {
	const close = vi.fn();
	const component = render(SpeechToTextModal, { close });
	await expect
		.element(component.getByRole('button', { name: 'Transcribe and add subtitles' }))
		.toBeDisabled();
	await component.getByRole('button', { name: 'Transcription key settings' }).click();
	expect(globalState.uiState.settingsTab).toBe('transcript-key');
	expect(globalState.uiState.isSettingsOpen).toBe(true);
	expect(close).toHaveBeenCalledOnce();
});

test('separates text AI settings and transcription keys in the settings sidebar', async () => {
	globalState.uiState.settingsTab = 'transcript-key';
	const component = render(SettingsModal, { resolve: vi.fn() });
	await expect
		.element(component.getByRole('heading', { name: 'Transcription keys', exact: true }))
		.toBeVisible();
	await expect.element(component.getByLabelText('Groq API key', { exact: true })).toBeVisible();
	await component.getByRole('button', { name: /Text AI key/ }).click();
	await expect
		.element(component.getByRole('heading', { name: 'Text AI key', exact: true }))
		.toBeVisible();
	await expect
		.element(component.getByLabelText('Groq API key', { exact: true }))
		.not.toBeInTheDocument();
});

test('flushes a pending key save when leaving settings and reports save failures', async () => {
	const component = render(TranscriptKeySettings);
	vi.mocked(Settings.save).mockRejectedValueOnce(new Error('Disk error'));
	await component.getByLabelText('Groq API key', { exact: true }).fill('groq-personal');
	await expect
		.element(component.getByRole('alert'))
		.toHaveTextContent('Unable to save your transcription settings.');
	await component.getByLabelText('Groq API key', { exact: true }).fill('updated-groq-key');
	vi.mocked(Settings.save).mockClear();
	cleanup();
	expect(Settings.save).toHaveBeenCalledOnce();
});

test.each([true, false])(
	'asks before overwriting existing subtitles: confirmed=%s',
	async (confirmed) => {
		globalState.settings!.speechToTextSettings.groqApiKey = 'groq-personal';
		const original = new SubtitleClip(0, 1000, 'Existing subtitle');
		globalState.getSubtitleTrack.clips = [original];
		const confirm = vi.spyOn(ModalManager, 'confirmModal').mockResolvedValue(confirmed);
		const close = vi.fn();
		const component = render(SpeechToTextModal, { close });
		await component.getByRole('button', { name: 'Transcribe and add subtitles' }).click();
		expect(confirm).toHaveBeenCalledOnce();
		expect(confirm.mock.calls[0][0]).toContain('Replace all existing subtitles');
		if (confirmed) {
			await vi.waitFor(() => expect(transcribeProjectAudio).toHaveBeenCalledOnce());
			expect(vi.mocked(transcribeProjectAudio).mock.calls[0][5]).toBe(true);
			await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
		} else {
			expect(transcribeProjectAudio).not.toHaveBeenCalled();
			expect(globalState.getSubtitleTrack.clips).toEqual([original]);
			expect(close).not.toHaveBeenCalled();
		}
	}
);

test('passes segmentation preferences to the workflow and disables duplicate submissions', async () => {
	globalState.settings!.speechToTextSettings.groqApiKey = 'groq-personal';
	let finish!: (value: { count: number }) => void;
	vi.mocked(transcribeProjectAudio).mockReturnValue(
		new Promise((resolve) => {
			finish = resolve;
		})
	);
	const close = vi.fn();
	const component = render(SpeechToTextModal, { close });
	await component.getByRole('button', { name: 'Transcribe and add subtitles' }).click();
	await vi.waitFor(() => expect(transcribeProjectAudio).toHaveBeenCalledOnce());
	await expect
		.element(component.getByRole('button', { name: 'Transcribe and add subtitles' }))
		.toBeDisabled();
	expect(vi.mocked(transcribeProjectAudio).mock.calls[0][2]).toMatchObject({
		maxWords: 8,
		maxDuration: 6
	});
	finish({ count: 2 });
	await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
});

test('shows subtitle preferences without speaker selection or semantic segmentation', async () => {
	const component = render(SpeechToTextModal, { close: vi.fn() });
	await expect
		.element(component.getByRole('heading', { name: 'Subtitles preferences' }))
		.toBeVisible();
	await expect
		.element(component.getByLabelText('Speaker', { exact: true }))
		.not.toBeInTheDocument();
	await expect
		.element(component.getByRole('checkbox', { name: 'Segment by meaning' }))
		.not.toBeInTheDocument();
});

test('lists existing subtitles and requires a text AI key before enabling rearrangement', async () => {
	globalState.getSubtitleTrack.clips = [
		new SubtitleClip(2000, 3000, 'Second passage'),
		new SilenceClip(1001, 1999),
		new SubtitleClip(0, 1000, 'First passage')
	];
	const close = vi.fn();
	const component = render(RearrangeSubtitlesModal, { close });
	const action = component.getByRole('button', { name: 'Rearrange subtitles', exact: true });
	await expect.element(component.getByText('First passage', { exact: true })).toBeVisible();
	await expect.element(component.getByText('Second passage', { exact: true })).toBeVisible();
	await expect.element(action).toBeDisabled();
	globalState.settings!.aiTranslationSettings.openAiApiKey = '  ';
	await expect.element(action).toBeDisabled();
	globalState.settings!.aiTranslationSettings.openAiApiKey = 'text-ai-key';
	await expect.element(action).not.toBeDisabled();
	await action.click();
	await expect
		.element(component.getByText('Proposed subtitle boundaries', { exact: true }))
		.toBeVisible();
	expect(applyRearrangement).not.toHaveBeenCalled();
	expect(close).not.toHaveBeenCalled();
	expect(rearrangeProjectSubtitles).toHaveBeenCalledOnce();
	expect(globalState.getSubtitleTrack.clips).toHaveLength(3);
	expect(transcribeProjectAudio).not.toHaveBeenCalled();
	await component.getByRole('button', { name: 'Apply all proposed changes', exact: true }).click();
	expect(applyRearrangement).toHaveBeenCalledOnce();
	expect(close).toHaveBeenCalledOnce();
});

test('passes additional preferences, prevents duplicate requests and cancels on close', async () => {
	globalState.getSubtitleTrack.clips = [new SubtitleClip(0, 1000, 'A passage')];
	globalState.settings!.aiTranslationSettings.openAiApiKey = 'text-ai-key';
	vi.mocked(rearrangeProjectSubtitles).mockReturnValue(new Promise(() => {}));
	const close = vi.fn();
	const component = render(RearrangeSubtitlesModal, { close });
	await component
		.getByRole('textbox', { name: 'Additional preferences' })
		.fill('Keep poetic lines together.');
	const action = component.getByRole('button', { name: 'Rearrange subtitles', exact: true });
	await action.click();
	await expect.element(action).toBeDisabled();
	expect(vi.mocked(rearrangeProjectSubtitles).mock.calls[0][1]).toMatchObject({
		maxWords: 8,
		maxDuration: 6,
		additionalPreferences: 'Keep poetic lines together.'
	});
	const signal = vi.mocked(rearrangeProjectSubtitles).mock.calls[0][2];
	await component.getByRole('button', { name: 'Cancel', exact: true }).click();
	expect(signal.aborted).toBe(true);
	expect(close).toHaveBeenCalledOnce();
});

test('shows rearrangement errors and allows retrying', async () => {
	globalState.getSubtitleTrack.clips = [new SubtitleClip(0, 1000, 'A passage')];
	globalState.settings!.aiTranslationSettings.openAiApiKey = 'text-ai-key';
	vi.mocked(rearrangeProjectSubtitles).mockRejectedValueOnce(
		new Error('The AI returned invalid subtitle boundaries.')
	);
	const component = render(RearrangeSubtitlesModal, { close: vi.fn() });
	const action = component.getByRole('button', { name: 'Rearrange subtitles', exact: true });
	await action.click();
	await expect
		.element(component.getByRole('alert'))
		.toHaveTextContent('The AI returned invalid subtitle boundaries.');
	await action.click();
	await expect
		.element(component.getByRole('button', { name: 'Apply all proposed changes', exact: true }))
		.toBeVisible();
});

test('discards a rearrangement preview when preferences change and keeps failed applications open', async () => {
	globalState.getSubtitleTrack.clips = [new SubtitleClip(0, 1000, 'A passage')];
	globalState.settings!.aiTranslationSettings.openAiApiKey = 'text-ai-key';
	const close = vi.fn();
	const component = render(RearrangeSubtitlesModal, { close });
	await component.getByRole('button', { name: 'Rearrange subtitles', exact: true }).click();
	const applyAll = component.getByRole('button', {
		name: 'Apply all proposed changes',
		exact: true
	});
	await expect.element(applyAll).toBeVisible();
	await component.getByRole('textbox', { name: 'Additional preferences' }).fill('Shorter lines');
	await expect.element(applyAll).not.toBeInTheDocument();
	expect(applyRearrangement).not.toHaveBeenCalled();
	await component.getByRole('button', { name: 'Rearrange subtitles', exact: true }).click();
	applyRearrangement.mockImplementationOnce(() => {
		throw new Error('The subtitles changed.');
	});
	await applyAll.click();
	await expect.element(component.getByRole('alert')).toHaveTextContent('The subtitles changed.');
	expect(close).not.toHaveBeenCalled();
});

test('shows the rearrangement entry only after subtitles exist', async () => {
	const transcribe = vi.spyOn(ModalManager, 'speechToTextModal').mockResolvedValue(undefined);
	const open = vi.spyOn(ModalManager, 'rearrangeSubtitlesModal').mockResolvedValue(undefined);
	const detect = vi.spyOn(ModalManager, 'detectReferencesModal').mockResolvedValue(undefined);
	const correct = vi.spyOn(ModalManager, 'correctTranscriptionModal').mockResolvedValue(undefined);
	const component = render(SubtitlesEditorSettings);
	const transcriptionEntry = component.getByRole('button', {
		name: 'Automatic transcription',
		exact: true
	});
	await expect.element(transcriptionEntry).toHaveClass('bg-accent-primary');
	const entry = component.getByRole('button', { name: 'Rearrange subtitles by meaning' });
	await expect.element(entry).not.toBeInTheDocument();
	const referenceEntry = component.getByRole('button', { name: 'Detect quotes and Quran verses' });
	await expect.element(referenceEntry).not.toBeInTheDocument();
	const correctionEntry = component.getByRole('button', { name: 'Correct transcription errors' });
	await expect.element(correctionEntry).not.toBeInTheDocument();
	globalState.getSubtitleTrack.clips.push(new SubtitleClip(0, 1000, 'A passage'));
	await expect.element(entry).toBeVisible();
	await expect.element(transcriptionEntry).toHaveClass('btn');
	expect(component.container.querySelectorAll('div[aria-hidden="true"]')).toHaveLength(3);
	await expect.element(correctionEntry).toHaveClass('bg-accent-primary');
	await expect.element(entry).toHaveClass('bg-accent-primary');
	await expect.element(referenceEntry).toHaveClass('bg-accent-primary');
	globalState.getSubtitlesEditorState.completedAiSteps = {
		correction: true,
		rearrangement: true,
		references: true
	};
	await expect.element(correctionEntry).toHaveClass('btn');
	await expect.element(entry).toHaveClass('btn');
	await expect.element(referenceEntry).toHaveClass('btn');
	await transcriptionEntry.click();
	expect(transcribe).toHaveBeenCalledOnce();
	await correctionEntry.click();
	expect(correct).toHaveBeenCalledOnce();
	expect(
		correctionEntry.element().compareDocumentPosition(entry.element()) &
			Node.DOCUMENT_POSITION_FOLLOWING
	).toBeTruthy();
	await entry.click();
	expect(open).toHaveBeenCalledOnce();
	await referenceEntry.click();
	expect(detect).toHaveBeenCalledOnce();
});

test('opens existing text AI settings from the rearrangement modal', async () => {
	const close = vi.fn();
	const component = render(RearrangeSubtitlesModal, { close });
	await component.getByRole('button', { name: 'Text AI settings' }).click();
	await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
	expect(globalState.uiState.settingsTab).toBe('ai-key');
	expect(globalState.uiState.isSettingsOpen).toBe(true);
	globalState.uiState.isSettingsOpen = false;
});
