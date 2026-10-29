import { cleanup, render } from 'vitest-browser-svelte';
import { page } from '@vitest/browser/context';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import '../../../../../src/app.css';
import { get } from 'svelte/store';
import LL, { setLocale } from '$lib/i18n/i18n-svelte';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { globalState } from '$lib/runes/main.svelte';
import Settings from '$lib/classes/Settings.svelte';
import {
	Category,
	Project,
	ProjectContent,
	ProjectDetail,
	ProjectEditorTabs,
	Style,
	StylesData,
	Timeline,
	TrackType,
	VideoStyle
} from '$lib/classes';
import { AssetTrack, CustomTextTrack, SubtitleTrack } from '$lib/classes/Track.svelte';
import { ProjectService } from '$lib/services/ProjectService';
import { AnalyticsService } from '$lib/services/AnalyticsService';
import { tick } from 'svelte';
import ModalManager from '$lib/components/modals/ModalManager';
import OnboardingTourHarness from './OnboardingTourHarness.svelte';
import ShortcutService from '$lib/services/ShortcutService';
import { invoke } from '@tauri-apps/api/core';

vi.mock('$lib/components/projectEditor/videoPreview/VideoOverlay.svelte', async () => ({
	default: (await import('../../../stubs/EmptyComponent.svelte')).default
}));

vi.mock('$lib/components/projectEditor/videoPreview/VideoPreviewControlsBar.svelte', async () => ({
	default: (await import('../../../stubs/EmptyComponent.svelte')).default
}));

vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tauri-apps/api/core')>()),
	invoke: vi.fn().mockResolvedValue({})
}));

beforeEach(async () => {
	vi.mocked(invoke).mockResolvedValue({});
	await page.viewport(1280, 900);
	loadLocale('en');
	setLocale('en');
	globalState.settings = new Settings();
	globalState.currentProject = null;
	globalState.uiState.isTourActive = true;
	globalState.userProjectsDetails = [];
	const videoStyle = new VideoStyle();
	videoStyle.styles = [
		new StylesData('global', [
			new Category({
				id: 'general',
				styles: [new Style({ id: 'video-dimension', value: { width: 1920, height: 1080 } })]
			})
		])
	];
	vi.spyOn(ProjectContent, 'getDefaultProjectContent').mockResolvedValue(
		new ProjectContent(
			new Timeline([
				new CustomTextTrack(),
				new SubtitleTrack(),
				new AssetTrack(TrackType.Video),
				new AssetTrack(TrackType.Audio)
			]),
			[],
			undefined,
			videoStyle
		)
	);
	vi.spyOn(ShortcutService, 'registerShortcut').mockImplementation(() => undefined);
	vi.spyOn(ShortcutService, 'unregisterShortcut').mockReturnValue(true);
	vi.spyOn(ProjectService, 'save').mockResolvedValue();
	vi.spyOn(Settings, 'save').mockResolvedValue();
	vi.spyOn(AnalyticsService, 'trackProjectCreated').mockImplementation(() => undefined);
	vi.spyOn(ModalManager, 'confirmModal');
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	globalState.currentProject = null;
	globalState.uiState.isTourActive = false;
	globalState.uiState.tourPreviewProject = null;
	globalState.userProjectsDetails = [];
});

/**
 * Wait for the tour to display a specific step.
 * @param {string} title Expected localized step title.
 * @returns {Promise<void>} Resolves once the step is visible.
 */
async function expectStep(title: string): Promise<void> {
	await expect.element(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
}

test('presents every tab with Next without creating a saved project or importing media', async () => {
	const close = vi.fn();
	render(OnboardingTourHarness, { close });
	const messages = get(LL);
	await expectStep(messages.tour.stepCreateProjectTitle());
	await page.getByRole('button', { name: /Next/ }).click();
	await expectStep(messages.tour.stepVideoEditorTitle());
	const preview = globalState.currentProject!;
	expect(preview).toBe(globalState.uiState.tourPreviewProject);
	await preview.save();
	expect(ProjectService.save).not.toHaveBeenCalled();
	const steps = [
		[messages.tour.stepAddToTimelineTitle(), ProjectEditorTabs.VideoEditor],
		[messages.tour.stepSubtitlesEditorTitle(), ProjectEditorTabs.Transcription],
		[messages.tour.stepManualSegmentationTitle(), ProjectEditorTabs.Transcription],
		[messages.tour.stepShortcutsTitle(), ProjectEditorTabs.Transcription],
		[messages.tour.stepTranslationsTitle(), ProjectEditorTabs.Translations],
		[messages.tour.stepAdaptingTranslationsTitle(), ProjectEditorTabs.Translations],
		[messages.tour.stepStyleTitle(), ProjectEditorTabs.Style],
		[messages.tour.stepStyleCategoriesTitle(), ProjectEditorTabs.Style],
		[messages.tour.stepExportTitle(), ProjectEditorTabs.Export],
		[messages.tour.stepExportVideoTitle(), ProjectEditorTabs.Export]
	];
	for (const [title, tab] of steps) {
		await page.getByRole('button', { name: /Next/ }).click();
		await expectStep(title);
		expect(preview.projectEditorState.currentTab).toBe(tab);
	}
	expect(preview.content.assets).toHaveLength(0);
	expect(preview.content.timeline.tracks.every((track) => track.clips.length === 0)).toBe(true);
	expect(globalState.userProjectsDetails).toHaveLength(0);
	expect(AnalyticsService.trackProjectCreated).not.toHaveBeenCalled();
	expect(ModalManager.confirmModal).not.toHaveBeenCalled();
	await page.getByRole('button', { name: /Finish/ }).click();
	await expect.poll(() => close.mock.calls.length).toBe(1);
	await expect.poll(() => globalState.currentProject).toBeNull();
	expect(globalState.uiState.tourPreviewProject).toBeNull();
	expect(globalState.settings!.persistentUiState.hasSeenTour).toBe(true);
	expect(Settings.save).toHaveBeenCalledTimes(1);
	expect(ProjectService.save).not.toHaveBeenCalled();
});

test('switches tabs on Next and Back while preserving an existing project and its pending dialog', async () => {
	const project = new Project(new ProjectDetail('Existing', 'Speaker'));
	globalState.currentProject = project;
	const content = project.content.toJSON();
	const answer = ModalManager.confirmModal('Keep video dimensions?', true);
	const close = vi.fn();
	render(OnboardingTourHarness, { close });
	const messages = get(LL);
	await expectStep(messages.tour.stepVideoEditorTitle());
	await page.getByRole('button', { name: /Next/ }).click();
	await expectStep(messages.tour.stepAddToTimelineTitle());
	await page.getByRole('button', { name: /Next/ }).click();
	await expectStep(messages.tour.stepSubtitlesEditorTitle());
	expect(project.projectEditorState.currentTab).toBe(ProjectEditorTabs.Transcription);
	await page.getByRole('button', { name: /Back/ }).click();
	await expectStep(messages.tour.stepAddToTimelineTitle());
	expect(project.projectEditorState.currentTab).toBe(ProjectEditorTabs.VideoEditor);
	await page.getByTitle(messages.tour.skipTutorial()).click();
	await expect.poll(() => close.mock.calls.length).toBe(1);
	expect(globalState.currentProject).toBe(project);
	expect(globalState.uiState.tourPreviewProject).toBeNull();
	expect(project.content.toJSON()).toEqual(content);
	expect(project.projectEditorState.hasAnsweredVideoDimensionPrompt).toBe(false);
	await page.getByRole('button', { name: 'Yes', exact: true }).click();
	await expect(answer).resolves.toBe(true);
	await project.save();
	expect(ProjectService.save).toHaveBeenCalledWith(project);
});

test('restarts an open project on the video editor and finds a target mounted later', async () => {
	globalState.currentProject = new Project(new ProjectDetail('Existing', 'Speaker'));
	globalState.currentProject.projectEditorState.currentTab = ProjectEditorTabs.Export;
	render(OnboardingTourHarness, { close: vi.fn(), targetDelay: 200 });
	await expectStep(get(LL).tour.stepVideoEditorTitle());
	expect(globalState.currentProject.projectEditorState.currentTab).toBe(
		ProjectEditorTabs.VideoEditor
	);
	await expect
		.poll(() => {
			const rect = document.querySelector('#tour-spotlight-mask rect[fill="black"]');
			return Number(rect?.getAttribute('width'));
		})
		.toBe(620);
	await expect.element(page.getByRole('button', { name: /Back/ })).not.toBeInTheDocument();
});

test('discards the temporary preview when skipping the tour', async () => {
	render(OnboardingTourHarness, { close: vi.fn() });
	await expectStep(get(LL).tour.stepCreateProjectTitle());
	await page.getByRole('button', { name: /Next/ }).click();
	await expectStep(get(LL).tour.stepVideoEditorTitle());
	await page.getByTitle(get(LL).tour.skipTutorial()).click();
	await expect.poll(() => globalState.currentProject).toBeNull();
	expect(globalState.uiState.tourPreviewProject).toBeNull();
	expect(globalState.userProjectsDetails).toHaveLength(0);
	expect(ProjectService.save).not.toHaveBeenCalled();
});

test.each(['skip', 'finish'])(
	'cleans up the video player after %s closes the preview project',
	async (action) => {
		render(OnboardingTourHarness, { close: vi.fn(), showVideoPreview: true });
		await expectStep(get(LL).tour.stepCreateProjectTitle());
		await page.getByRole('button', { name: /Next/ }).click();
		await expectStep(get(LL).tour.stepVideoEditorTitle());
		await expect
			.element(page.elementLocator(document.getElementById('video-preview-section')!))
			.toBeInTheDocument();
		vi.mocked(invoke).mockClear();
		if (action === 'finish') {
			for (let step = 1; step < 11; step++) {
				await page.getByRole('button', { name: /Next/ }).click();
			}
			await page.getByRole('button', { name: /Finish/ }).click();
		} else {
			await page.getByTitle(get(LL).tour.skipTutorial()).click();
		}
		await expect.poll(() => globalState.currentProject).toBeNull();
		await expect.element(page.getByTitle(get(LL).tour.skipTutorial())).not.toBeInTheDocument();
		expect(ShortcutService.unregisterShortcut).toHaveBeenCalledTimes(6);
		expect(invoke).toHaveBeenCalledWith(
			'control_preview_audio',
			expect.objectContaining({ action: 'unload' })
		);
	}
);

test('does not open a preview after skipping while it is still loading', async () => {
	let resolvePreview!: (content: ProjectContent) => void;
	vi.mocked(ProjectContent.getDefaultProjectContent).mockReturnValue(
		new Promise((resolve) => {
			resolvePreview = resolve;
		})
	);
	const close = vi.fn();
	render(OnboardingTourHarness, { close });
	await expectStep(get(LL).tour.stepCreateProjectTitle());
	await page.getByRole('button', { name: /Next/ }).click();
	await expect.element(page.getByRole('button', { name: /Next/ })).toBeDisabled();
	await page.getByTitle(get(LL).tour.skipTutorial()).click();
	await expect.poll(() => close.mock.calls.length).toBe(1);
	resolvePreview(new ProjectContent());
	await tick();
	expect(globalState.currentProject).toBeNull();
	expect(globalState.uiState.tourPreviewProject).toBeNull();
});

test('closes when skipping even if saving completion fails', async () => {
	const close = vi.fn();
	const error = new Error('Save unavailable');
	vi.mocked(Settings.save).mockRejectedValue(error);
	const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
	render(OnboardingTourHarness, { close });
	await expectStep(get(LL).tour.stepCreateProjectTitle());
	await page.getByTitle(get(LL).tour.skipTutorial()).click();
	await expect.poll(() => close.mock.calls.length).toBe(1);
	expect(log).toHaveBeenCalledWith('Failed to save tutorial completion', error);
});
