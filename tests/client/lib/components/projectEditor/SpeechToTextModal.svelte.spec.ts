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
import { transcribeProjectAudio } from '$lib/services/SpeechToTextService';
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

const originalSettings = globalState.settings;

beforeEach(() => {
	loadLocale('en');
	setLocale('en');
	globalState.settings = new Settings();
	vi.spyOn(Settings, 'save').mockResolvedValue(undefined);
	vi.mocked(transcribeProjectAudio).mockResolvedValue({ count: 2 });
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
	globalState.currentProject = null;
	globalState.settings = originalSettings;
	vi.mocked(openUrl).mockClear();
	globalState.uiState.isSettingsOpen = false;
});

test('shows API key instructions and opens the keys page for the selected provider', async () => {
	const component = render(SpeechToTextModal, { close: vi.fn() });
	const help = component.getByRole('button', { name: 'How do I get an API key?' });
	await help.click();
	await expect.element(help).toHaveAttribute('aria-expanded', 'true');
	await expect
		.element(component.getByText('Open Groq Console and sign in or create an account.'))
		.toBeVisible();
	await component.getByRole('button', { name: 'Open API keys page' }).click();
	expect(openUrl).toHaveBeenLastCalledWith('https://console.groq.com/keys');
	await component.getByRole('combobox', { name: 'Provider' }).selectOptions('elevenlabs');
	await expect.element(component.getByText(/enable the Speech to Text permission/)).toBeVisible();
	await component.getByRole('button', { name: 'Open API keys page' }).click();
	expect(openUrl).toHaveBeenLastCalledWith('https://elevenlabs.io/app/developers/api-keys');
	await help.click();
	await expect.element(help).toHaveAttribute('aria-expanded', 'false');
	expect(transcribeProjectAudio).not.toHaveBeenCalled();
});

test('saves independent provider keys and restores them when switching providers', async () => {
	await page.viewport(1024, 900);
	const component = render(SpeechToTextModal, { close: vi.fn() });
	await expect.element(component.getByRole('dialog')).toBeVisible();
	await component.getByLabelText(/AI API key/).fill('groq-personal');
	await component.getByRole('combobox', { name: 'Provider' }).selectOptions('elevenlabs');
	await component.getByLabelText(/AI API key/).fill('eleven-personal');
	await component.getByRole('combobox', { name: 'Model' }).selectOptions('scribe_v1');
	await component.getByRole('button', { name: 'Save', exact: true }).click();
	expect(globalState.settings!.speechToTextSettings).toMatchObject({
		groqApiKey: 'groq-personal',
		elevenLabsApiKey: 'eleven-personal',
		provider: 'elevenlabs',
		elevenLabsModel: 'scribe_v1'
	});
	await component.getByRole('combobox', { name: 'Provider' }).selectOptions('groq');
	await expect.element(component.getByLabelText(/AI API key/)).toHaveValue('groq-personal');
});

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
	const component = render(RearrangeSubtitlesModal, { close: vi.fn() });
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
		.element(component.getByRole('status'))
		.toHaveTextContent('Rearranging subtitles by meaning is not available yet.');
	expect(globalState.getSubtitleTrack.clips).toHaveLength(3);
	expect(transcribeProjectAudio).not.toHaveBeenCalled();
});

test('shows the rearrangement entry only after subtitles exist', async () => {
	const open = vi.spyOn(ModalManager, 'rearrangeSubtitlesModal').mockResolvedValue(undefined);
	const component = render(SubtitlesEditorSettings);
	const entry = component.getByRole('button', { name: 'Rearrange subtitles by meaning' });
	await expect.element(entry).not.toBeInTheDocument();
	globalState.getSubtitleTrack.clips.push(new SubtitleClip(0, 1000, 'A passage'));
	await expect.element(entry).toBeVisible();
	await entry.click();
	expect(open).toHaveBeenCalledOnce();
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
