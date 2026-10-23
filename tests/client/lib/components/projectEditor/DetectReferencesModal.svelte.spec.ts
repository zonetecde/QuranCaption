import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import '../../../../../src/app.css';
import { Project, ProjectContent, ProjectDetail, SubtitleClip, Timeline } from '$lib/classes';
import { SubtitleTrack } from '$lib/classes/Track.svelte';
import Settings from '$lib/classes/Settings.svelte';
import { globalState } from '$lib/runes/main.svelte';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';
import DetectReferencesModal from '$lib/components/modals/tools/DetectReferencesModal.svelte';
import {
	detectProjectReferences,
	applyReferenceAnnotations,
	type ReferenceDetectionPlan
} from '$lib/services/ReferenceDetectionService';

vi.mock('$lib/services/ReferenceDetectionService', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/services/ReferenceDetectionService')>()),
	detectProjectReferences: vi.fn(),
	applyReferenceAnnotations: vi.fn()
}));
const originalSettings = globalState.settings;
let clip: SubtitleClip;

/**
 * Prépare un aperçu réaliste comprenant une proposition confirmée et une incertaine.
 * @returns {ReferenceDetectionPlan} Plan utilisé par le modal sans requête réseau.
 */
function makePlan(): ReferenceDetectionPlan {
	return {
		project: globalState.currentProject!,
		snapshot: '',
		originalTexts: new Map([[clip, clip.text]]),
		skipped: 0,
		words: ['quoted', 'words', 'plus'].map((text, i) => ({
			id: i + 1,
			text,
			clip,
			start: [0, 7, 13][i],
			end: [6, 12, 17][i],
			protected: false
		})),
		proposals: [
			{
				id: 0,
				kind: 'citation',
				status: 'confirmed',
				from: 1,
				to: 2,
				reference: null,
				reason: 'Reported wording.',
				source: 'quoted words',
				canonical: ''
			},
			{
				id: 1,
				kind: 'quran',
				status: 'uncertain',
				from: 3,
				to: 3,
				reference: null,
				reason: 'Insufficient evidence.',
				source: 'plus',
				canonical: ''
			}
		]
	};
}

beforeEach(() => {
	loadLocale('en');
	setLocale('en');
	globalState.settings = new Settings();
	globalState.settings.aiTranslationSettings.openAiApiKey = 'personal-key';
	clip = new SubtitleClip(0, 2000, 'quoted words plus');
	const track = new SubtitleTrack();
	track.clips = [clip];
	globalState.currentProject = new Project(
		new ProjectDetail('Detection', 'speaker'),
		new ProjectContent(new Timeline([track]))
	);
	vi.mocked(detectProjectReferences).mockResolvedValue(makePlan());
	vi.mocked(applyReferenceAnnotations).mockReturnValue(1);
});
afterEach(() => {
	cleanup();
	vi.mocked(detectProjectReferences).mockReset();
	vi.mocked(applyReferenceAnnotations).mockReset();
	globalState.currentProject = null;
	globalState.settings = originalSettings;
	globalState.uiState.isSettingsOpen = false;
});

test('requires a key and a selected category before detecting', async () => {
	globalState.settings!.aiTranslationSettings.openAiApiKey = '';
	const component = render(DetectReferencesModal, { close: vi.fn() });
	const start = component.getByRole('button', { name: 'Find quotations', exact: true });
	await expect.element(start).toBeDisabled();
	globalState.settings!.aiTranslationSettings.openAiApiKey = 'personal-key';
	await expect.element(start).not.toBeDisabled();
	await component.getByRole('checkbox', { name: 'Quran quotations', exact: true }).click();
	await component.getByRole('checkbox', { name: 'Other quotations', exact: true }).click();
	await expect.element(start).toBeDisabled();
});

test('previews confirmed selections before applying and prevents uncertain proposals from being selected', async () => {
	const close = vi.fn();
	const component = render(DetectReferencesModal, { close });
	await expect
		.element(component.getByText('quoted words plus', { exact: true }))
		.not.toBeInTheDocument();
	await component.getByRole('textbox', { name: 'Additional preferences' }).fill('Include poetry.');
	await component.getByRole('button', { name: 'Find quotations', exact: true }).click();
	await expect.element(component.getByText('quoted words', { exact: true })).toBeVisible();
	await expect
		.element(component.getByText('{{quoted words}} plus', { exact: true }))
		.not.toBeInTheDocument();
	expect(clip.text).toBe('quoted words plus');
	expect(applyReferenceAnnotations).not.toHaveBeenCalled();
	expect(vi.mocked(detectProjectReferences).mock.calls[0][1]).toMatchObject({
		detectQuran: true,
		detectCitations: true,
		additionalPreferences: 'Include poetry.'
	});
	await expect
		.element(component.getByRole('checkbox', { name: 'Select proposal 2', exact: true }))
		.toBeDisabled();
	const selection = component.getByRole('checkbox', { name: 'Select proposal 1', exact: true });
	await selection.click();
	await expect
		.element(component.getByRole('button', { name: /Apply selected annotations/ }))
		.toBeDisabled();
	await selection.click();
	await component.getByRole('button', { name: /Apply selected annotations/ }).click();
	expect(applyReferenceAnnotations).toHaveBeenCalledOnce();
	expect(vi.mocked(applyReferenceAnnotations).mock.calls[0][2]).toEqual([0]);
	expect(close).toHaveBeenCalledOnce();
	await expect
		.element(component.getByRole('status'))
		.toHaveTextContent('Annotations applied. You can undo this change. (1)');
});

test('shows only detected passages and applies all confirmed annotations before closing', async () => {
	globalState.getSubtitleTrack.clips.push(new SubtitleClip(2100, 3000, 'Unrelated subtitle'));
	const result = makePlan();
	result.proposals.push({
		...result.proposals[0],
		id: 2,
		kind: 'none',
		status: 'rejected',
		source: 'Rejected ordinary speech'
	});
	vi.mocked(detectProjectReferences).mockResolvedValue(result);
	const close = vi.fn();
	const component = render(DetectReferencesModal, { close });
	await component.getByRole('button', { name: 'Find quotations', exact: true }).click();
	await expect
		.element(component.getByText('Unrelated subtitle', { exact: true }))
		.not.toBeInTheDocument();
	await expect
		.element(component.getByText('Rejected ordinary speech', { exact: true }))
		.not.toBeInTheDocument();
	await component.getByRole('checkbox', { name: 'Select proposal 1', exact: true }).click();
	await component
		.getByRole('button', { name: 'Apply all detected annotations (1)', exact: true })
		.click();
	expect(vi.mocked(applyReferenceAnnotations).mock.calls[0][2]).toEqual([0]);
	expect(close).toHaveBeenCalledOnce();
});

test('keeps detected passages open when applying annotations fails', async () => {
	const close = vi.fn();
	const component = render(DetectReferencesModal, { close });
	await component.getByRole('button', { name: 'Find quotations', exact: true }).click();
	vi.mocked(applyReferenceAnnotations).mockImplementationOnce(() => {
		throw new Error('Source changed.');
	});
	await component
		.getByRole('button', { name: 'Apply all detected annotations (1)', exact: true })
		.click();
	await expect.element(component.getByRole('alert')).toHaveTextContent('Source changed.');
	expect(close).not.toHaveBeenCalled();
});

test('discards a preview when preferences change', async () => {
	const component = render(DetectReferencesModal, { close: vi.fn() });
	await component.getByRole('button', { name: 'Find quotations', exact: true }).click();
	await expect
		.element(component.getByRole('button', { name: /Apply selected annotations/ }))
		.toBeVisible();
	await component.getByRole('checkbox', { name: 'Quran quotations', exact: true }).click();
	await expect
		.element(component.getByRole('button', { name: /Apply selected annotations/ }))
		.not.toBeInTheDocument();
});

test('disables duplicate requests and cancels pending work on close', async () => {
	vi.mocked(detectProjectReferences).mockReturnValue(new Promise(() => {}));
	const close = vi.fn();
	const component = render(DetectReferencesModal, { close });
	const start = component.getByRole('button', { name: 'Find quotations', exact: true });
	await start.click();
	await expect.element(start).toBeDisabled();
	await component.getByRole('button', { name: 'Cancel', exact: true }).click();
	expect(vi.mocked(detectProjectReferences).mock.calls[0][2].aborted).toBe(true);
	expect(close).toHaveBeenCalledOnce();
	expect(applyReferenceAnnotations).not.toHaveBeenCalled();
});

test('shows failures and lets the user retry', async () => {
	vi.mocked(detectProjectReferences).mockRejectedValueOnce(new Error('Invalid quotation ranges.'));
	const component = render(DetectReferencesModal, { close: vi.fn() });
	const start = component.getByRole('button', { name: 'Find quotations', exact: true });
	await start.click();
	await expect.element(component.getByRole('alert')).toHaveTextContent('Invalid quotation ranges.');
	await start.click();
	await expect
		.element(component.getByRole('button', { name: /Apply selected annotations/ }))
		.toBeVisible();
});

test('opens the existing Text AI settings', async () => {
	const close = vi.fn();
	const component = render(DetectReferencesModal, { close });
	await component.getByRole('button', { name: 'Text AI settings' }).click();
	expect(globalState.uiState.settingsTab).toBe('ai-key');
	expect(globalState.uiState.isSettingsOpen).toBe(true);
	expect(close).toHaveBeenCalledOnce();
});
