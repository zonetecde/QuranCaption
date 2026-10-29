import { cleanup, render } from 'vitest-browser-svelte';
import { page } from '@vitest/browser/context';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import '../../../../../src/app.css';
import 'material-icons/iconfont/material-icons.css';
import {
	Asset,
	AssetClip,
	AssetType,
	Project,
	ProjectContent,
	ProjectDetail,
	SubtitleClip,
	Timeline,
	TrackType
} from '$lib/classes';
import { AssetTrack, SubtitleTrack } from '$lib/classes/Track.svelte';
import Settings from '$lib/classes/Settings.svelte';
import { globalState } from '$lib/runes/main.svelte';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';
import CorrectTranscriptionModal from '$lib/components/modals/tools/CorrectTranscriptionModal.svelte';
import {
	detectSubtitleCorrections,
	applySubtitleCorrections,
	type SubtitleCorrectionPlan
} from '$lib/services/SubtitleCorrectionService';

vi.mock('$lib/services/SubtitleCorrectionService', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/services/SubtitleCorrectionService')>()),
	detectSubtitleCorrections: vi.fn(),
	applySubtitleCorrections: vi.fn()
}));
const originalSettings = globalState.settings;
let project: Project;
let clips: SubtitleClip[];

/**
 * Prépare deux propositions à approuver sans requête réseau.
 * @returns {SubtitleCorrectionPlan} Corrections liées aux sous-titres du test.
 */
function makePlan(): SubtitleCorrectionPlan {
	return {
		project,
		snapshot: '',
		warnings: [],
		skipped: 0,
		proposals: clips.map((clip, index) => ({
			id: index + 1,
			clip,
			before: clip.text,
			after: ['He read a message.', 'Then he wrote a reply.'][index],
			reason: 'A likely speech recognition confusion in context.'
		}))
	};
}

beforeEach(() => {
	loadLocale('en');
	setLocale('en');
	globalState.settings = new Settings();
	globalState.settings.aiTranslationSettings.openAiApiKey = 'personal-key';
	clips = [
		new SubtitleClip(1000, 3000, 'He read a massage.'),
		new SubtitleClip(4000, 6000, 'Then he rote a reply.')
	];
	const track = new SubtitleTrack();
	track.clips = clips;
	const audioTrack = new AssetTrack(TrackType.Audio);
	audioTrack.clips = [new AssetClip(0, 10000, 1)];
	project = new Project(
		new ProjectDetail('Corrections', 'speaker'),
		new ProjectContent(new Timeline([track, audioTrack]))
	);
	const asset = new Asset();
	asset.id = 1;
	asset.type = AssetType.Audio;
	project.content.assets = [asset];
	globalState.currentProject = project;
	project.projectEditorState.videoPreview.togglePlayPause = vi.fn(() => {
		project.projectEditorState.videoPreview.isPlaying =
			!project.projectEditorState.videoPreview.isPlaying;
	});
	vi.mocked(detectSubtitleCorrections).mockResolvedValue(makePlan());
	vi.mocked(applySubtitleCorrections).mockReturnValue(1);
});

afterEach(() => {
	cleanup();
	vi.mocked(detectSubtitleCorrections).mockReset();
	vi.mocked(applySubtitleCorrections).mockReset();
	globalState.currentProject = null;
	globalState.settings = originalSettings;
	globalState.uiState.isSettingsOpen = false;
});

test('previews before/after without applying and lets users approve a subset', async () => {
	await page.viewport(1280, 900);
	const close = vi.fn();
	const component = render(CorrectTranscriptionModal, { close });
	await component.getByRole('button', { name: 'Find likely errors' }).click();
	await expect.element(component.getByText('He read a message.', { exact: true })).toBeVisible();
	await expect.element(component.getByText('He read a massage.', { exact: true })).toBeVisible();
	expect(clips[0].text).toBe('He read a massage.');
	expect(applySubtitleCorrections).not.toHaveBeenCalled();
	await component.getByRole('checkbox', { name: 'Select correction 2', exact: true }).click();
	await component
		.getByRole('button', { name: 'Apply selected corrections (1)', exact: true })
		.click();
	expect(vi.mocked(applySubtitleCorrections).mock.calls[0][2]).toEqual([1]);
	expect(close).toHaveBeenCalledOnce();
	await expect
		.element(component.getByRole('status'))
		.toHaveTextContent('Corrections applied. You can undo this change. (1)');
});

test('supports deselecting, selecting and applying all suggestions', async () => {
	const close = vi.fn();
	const component = render(CorrectTranscriptionModal, { close });
	await component.getByRole('button', { name: 'Find likely errors' }).click();
	await component.getByRole('button', { name: 'Deselect All', exact: true }).click();
	await expect
		.element(component.getByRole('button', { name: 'Apply selected corrections (0)' }))
		.toBeDisabled();
	await component.getByRole('button', { name: 'Select All', exact: true }).click();
	await expect
		.element(component.getByRole('checkbox', { name: 'Select correction 1', exact: true }))
		.toBeChecked();
	await component.getByRole('button', { name: 'Deselect All', exact: true }).click();
	await component.getByRole('button', { name: 'Apply all corrections', exact: true }).click();
	expect(vi.mocked(applySubtitleCorrections).mock.calls[0][2]).toEqual([1, 2]);
	expect(close).toHaveBeenCalledOnce();
});

test('shows suggested corrections before editable warnings without a mark-as-reviewed action', async () => {
	const plan = makePlan();
	plan.proposals = plan.proposals.slice(0, 1);
	plan.warnings = [
		{ id: 2, clip: clips[1], text: clips[1].text, reason: 'Uncertain transcription.' }
	];
	vi.mocked(detectSubtitleCorrections).mockResolvedValue(plan);
	const component = render(CorrectTranscriptionModal, { close: vi.fn() });
	await component.getByRole('button', { name: 'Find likely errors' }).click();
	const suggestion = component.getByText('He read a message.', { exact: true }).element();
	const warning = component
		.getByRole('textbox', { name: 'Transcription to correct 2', exact: true })
		.element();
	expect(
		suggestion.compareDocumentPosition(warning) & Node.DOCUMENT_POSITION_FOLLOWING
	).toBeTruthy();
	expect(component.container.textContent).not.toContain('Mark as reviewed');
});

test('keeps mixed Arabic explanations in the interface direction instead of the first quoted word direction', async () => {
	const result = makePlan();
	result.proposals = result.proposals.slice(0, 1);
	result.proposals[0].reason = 'اللهم is the quoted word; this explanation is in English.';
	result.warnings = [
		{
			id: 2,
			clip: clips[1],
			text: clips[1].text,
			reason: 'اللهم appears garbled. Listen to the recording.'
		}
	];
	vi.mocked(detectSubtitleCorrections).mockResolvedValue(result);
	const component = render(CorrectTranscriptionModal, { close: vi.fn() });
	await component.getByRole('button', { name: 'Find likely errors' }).click();
	for (const text of [result.proposals[0].reason, result.warnings[0].reason]) {
		await expect.element(component.getByText(text, { exact: true })).toHaveAttribute('dir', 'ltr');
		expect(getComputedStyle(component.getByText(text, { exact: true }).element()).direction).toBe(
			'ltr'
		);
	}
	loadLocale('ar');
	setLocale('ar');
	for (const text of [result.proposals[0].reason, result.warnings[0].reason]) {
		await expect.element(component.getByText(text, { exact: true })).toHaveAttribute('dir', 'rtl');
	}
});

test('keeps the correction preview open when applying fails', async () => {
	const close = vi.fn();
	const component = render(CorrectTranscriptionModal, { close });
	await component.getByRole('button', { name: 'Find likely errors' }).click();
	vi.mocked(applySubtitleCorrections).mockImplementationOnce(() => {
		throw new Error('Source changed.');
	});
	await component.getByRole('button', { name: 'Apply all corrections', exact: true }).click();
	await expect.element(component.getByRole('alert')).toHaveTextContent('Source changed.');
	expect(close).not.toHaveBeenCalled();
	await expect.element(component.getByText('He read a message.', { exact: true })).toBeVisible();
});

test('seeks, pauses, resumes, switches passage and stops playback at the subtitle end', async () => {
	clips[0].startTime = 0;
	const component = render(CorrectTranscriptionModal, { close: vi.fn() });
	await component.getByRole('button', { name: 'Find likely errors' }).click();
	const timeline = project.projectEditorState.timeline;
	const preview = project.projectEditorState.videoPreview;
	await component.getByRole('button', { name: 'Play subtitle audio 1', exact: true }).click();
	expect(timeline.movePreviewTo).toBe(1);
	expect(preview.isPlaying).toBe(true);
	timeline.cursorPosition = 1500;
	await component.getByRole('button', { name: 'Pause subtitle audio 1', exact: true }).click();
	expect(preview.isPlaying).toBe(false);
	await component.getByRole('button', { name: 'Play subtitle audio 1', exact: true }).click();
	expect(timeline.cursorPosition).toBe(1500);
	expect(preview.isPlaying).toBe(true);
	await component.getByRole('button', { name: 'Play subtitle audio 2', exact: true }).click();
	expect(timeline.movePreviewTo).toBe(4000);
	timeline.cursorPosition = 6000;
	await expect.poll(() => preview.isPlaying).toBe(false);
	await expect
		.element(component.getByRole('button', { name: 'Play subtitle audio 2', exact: true }))
		.toBeVisible();
});

test('stops audio when unmounted and disables listening when no source overlaps', async () => {
	const component = render(CorrectTranscriptionModal, { close: vi.fn() });
	await component.getByRole('button', { name: 'Find likely errors' }).click();
	await component.getByRole('button', { name: 'Play subtitle audio 1', exact: true }).click();
	cleanup();
	expect(project.projectEditorState.videoPreview.isPlaying).toBe(false);
	project.content.timeline.getFirstTrack(TrackType.Audio).clips = [];
	const reopened = render(CorrectTranscriptionModal, { close: vi.fn() });
	await reopened.getByRole('button', { name: 'Find likely errors' }).click();
	await expect
		.element(reopened.getByRole('button', { name: 'Play subtitle audio 1', exact: true }))
		.toBeDisabled();
});

test('requires a key, shows failures and retries without changing subtitles', async () => {
	globalState.settings!.aiTranslationSettings.openAiApiKey = '';
	const component = render(CorrectTranscriptionModal, { close: vi.fn() });
	const start = component.getByRole('button', { name: 'Find likely errors' });
	await expect.element(start).toBeDisabled();
	globalState.settings!.aiTranslationSettings.openAiApiKey = 'personal-key';
	vi.mocked(detectSubtitleCorrections).mockRejectedValueOnce(new Error('Request failed.'));
	await start.click();
	await expect.element(component.getByRole('alert')).toHaveTextContent('Request failed.');
	await start.click();
	await expect
		.element(component.getByRole('button', { name: 'Apply all corrections', exact: true }))
		.toBeVisible();
});

test('cancels pending analysis and ignores late results', async () => {
	let resolve!: (plan: SubtitleCorrectionPlan) => void;
	vi.mocked(detectSubtitleCorrections).mockReturnValue(
		new Promise((done) => {
			resolve = done;
		})
	);
	const close = vi.fn();
	const component = render(CorrectTranscriptionModal, { close });
	const start = component.getByRole('button', { name: 'Find likely errors' });
	await start.click();
	await expect.element(start).toBeDisabled();
	await component.getByRole('button', { name: 'Cancel', exact: true }).click();
	expect(vi.mocked(detectSubtitleCorrections).mock.calls[0][1].aborted).toBe(true);
	expect(close).toHaveBeenCalledOnce();
	resolve(makePlan());
	await expect
		.element(component.getByRole('button', { name: 'Apply all corrections', exact: true }))
		.not.toBeInTheDocument();
	expect(applySubtitleCorrections).not.toHaveBeenCalled();
});

test('shows a clear empty state and opens existing text AI settings', async () => {
	vi.mocked(detectSubtitleCorrections).mockResolvedValue({ ...makePlan(), proposals: [] });
	const close = vi.fn();
	const component = render(CorrectTranscriptionModal, { close });
	await component.getByRole('button', { name: 'Find likely errors' }).click();
	await expect
		.element(component.getByRole('heading', { name: 'No obvious transcription errors found' }))
		.toBeVisible();
	await component.getByRole('button', { name: 'Text AI settings' }).click();
	expect(globalState.uiState.settingsTab).toBe('ai-key');
	expect(globalState.uiState.isSettingsOpen).toBe(true);
	expect(close).toHaveBeenCalledOnce();
});

test('reviews Arabic corrections and keeps approval reachable on a narrow window', async () => {
	await page.viewport(540, 900);
	clips[0].text = 'إنما الأعمال بالنياب';
	const result = makePlan();
	result.proposals = [
		{
			...result.proposals[0],
			after: 'إنما الأعمال بالنيات',
			reason: 'التباس في الكلمة الأخيرة أثناء التفريغ.'
		}
	];
	vi.mocked(detectSubtitleCorrections).mockResolvedValue(result);
	const component = render(CorrectTranscriptionModal, { close: vi.fn() });
	await component.getByRole('button', { name: 'Find likely errors' }).click();
	await expect.element(component.getByText('إنما الأعمال بالنيات', { exact: true })).toBeVisible();
	const dialog = component.getByRole('dialog').element();
	expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
	await component
		.getByRole('button', { name: 'Apply selected corrections (1)', exact: true })
		.click();
	expect(applySubtitleCorrections).toHaveBeenCalledOnce();
});
