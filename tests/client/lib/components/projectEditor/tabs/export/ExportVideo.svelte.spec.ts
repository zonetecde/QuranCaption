import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { tick } from 'svelte';

import {
	Edition,
	Project,
	ProjectContent,
	ProjectDetail,
	ProjectEditorState,
	Timeline,
	VideoStyle
} from '$lib/classes';
import Settings from '$lib/classes/Settings.svelte';
import Exporter from '$lib/classes/Exporter';
import { initializeClassRegistry } from '$lib/classes/ClassRegistry';
import ModalManager from '$lib/components/modals/ModalManager';
import MeaningExportModal from '$lib/components/modals/tools/MeaningExportModal.svelte';
import { generateMeaningExportRanges } from '$lib/services/MeaningExportRangeService';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import { SubtitleClip } from '$lib/classes/Clip.svelte';
import { Category, Style, StylesData } from '$lib/classes/VideoStyle.svelte';
import { SubtitleTrack } from '$lib/classes/Track.svelte';
import { ProjectTranslation } from '$lib/classes/ProjectTranslation.svelte';
import { VerseTranslation } from '$lib/classes/Translation.svelte';
import ExportVideo from '$lib/components/projectEditor/tabs/export/ExportVideo.svelte';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';
import { globalState } from '$lib/runes/main.svelte';

vi.mock('$lib/components/projectEditor/tabs/styleEditor/Style.svelte', async () => ({
	default: (await import('../../../../../stubs/EmptyComponent.svelte')).default
}));
vi.mock('$lib/components/projectEditor/tabs/export/ExportFolderPicker.svelte', async () => ({
	default: (await import('../../../../../stubs/EmptyComponent.svelte')).default
}));
vi.mock('$lib/services/MeaningExportRangeService', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/services/MeaningExportRangeService')>()),
	generateMeaningExportRanges: vi.fn()
}));
const originalSettings = globalState.settings;
const meaningRanges = [
	{
		id: '1-2',
		startTime: 1000,
		endTime: 21000,
		title: 'A complete lesson',
		context: 'The question and its answer.'
	},
	{
		id: '3-4',
		startTime: 30000,
		endTime: 60000,
		title: 'Another complete lesson',
		context: 'The example and its conclusion.'
	}
];

describe('Export translation warning', () => {
	let edition: Edition;

	beforeEach(() => {
		loadLocale('en');
		setLocale('en');
		globalState.settings = new Settings();
		edition = new Edition('english', 'english', 'English', 'English', 'ltr', '', '', '', '');
		const projectTranslation = new ProjectTranslation();
		projectTranslation.addedTranslationEditions = [edition];
		const videoStyle = new VideoStyle();
		videoStyle.styles.push(
			new StylesData(edition.name, [
				new Category({
					id: 'general',
					styles: [new Style({ id: 'show-subtitles', value: true })]
				})
			])
		);
		const projectEditorState = new ProjectEditorState();
		projectEditorState.export.videoStartTime = 1000;
		projectEditorState.export.videoEndTime = 2000;
		globalState.currentProject = {
			projectEditorState,
			content: { projectTranslation, videoStyle, timeline: new Timeline([new SubtitleTrack()]) },
			detail: new ProjectDetail('Export test', 'Speaker')
		} as never;
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		vi.mocked(generateMeaningExportRanges).mockReset();
		ProjectHistoryManager.clear();
		globalState.currentProject = null;
		globalState.settings = originalSettings;
	});

	test.each([
		{ text: 'AI translation', status: 'ai translated', missing: false },
		{ text: 'Translation', status: 'to translate', missing: false },
		{ text: '', status: 'reviewed', missing: true },
		{ text: '   ', status: 'ai translated', missing: true },
		{ text: undefined, status: 'to translate', missing: true },
		{ text: '{{}}', status: 'reviewed', missing: true },
		{ text: '{{Translated quotation}}', status: 'ai translated', missing: false },
		{ text: '{{2:255}}', status: 'to translate', missing: false }
	] as const)(
		'checks rendered text, not status: $text / $status',
		async ({ text, status, missing }) => {
			const subtitle = new SubtitleClip(
				1000,
				2000,
				text?.includes('2:255') ? '{{2:255}}' : '{{quotation}}'
			);
			if (text !== undefined) {
				const translation = new VerseTranslation(text, status);
				translation.isStructuredTranslation = true;
				subtitle.translations[edition.name] = translation;
			}
			globalState.getProjectTranslation.versesTranslations[edition.name] = {
				'2:255': 'Quran translation'
			};
			globalState.getSubtitleTrack.clips.push(subtitle);
			const component = render(ExportVideo);
			await tick();
			expect(component.container.querySelector('[role="alert"]') !== null).toBe(missing);
			if (missing) {
				expect(component.container.textContent).toContain('1 translation(s) are missing');
			}
		}
	);

	test('counts only visible languages and subtitles overlapping the export range', async () => {
		globalState.getSubtitleTrack.clips.push(
			new SubtitleClip(0, 1000, 'Before'),
			new SubtitleClip(500, 1500, 'Overlapping'),
			new SubtitleClip(1500, 2000, 'Inside'),
			new SubtitleClip(2000, 3000, 'After')
		);
		const component = render(ExportVideo);
		await tick();
		expect(component.container.textContent).toContain('2 translation(s) are missing');

		globalState.getVideoStyle.getStylesOfTarget(edition.name).findStyle('show-subtitles')!.value =
			false;
		await tick();
		expect(component.container.querySelector('[role="alert"]')).toBeNull();

		globalState.getVideoStyle.getStylesOfTarget(edition.name).findStyle('show-subtitles')!.value =
			true;
		for (const subtitle of globalState.getSubtitleClips) {
			subtitle.translations[edition.name] = new VerseTranslation('Translation', 'ai translated');
		}
		await tick();
		expect(component.container.querySelector('[role="alert"]')).toBeNull();
	});

	test('opens the two-tab assistant without automatically starting AI', async () => {
		globalState.getSubtitleTrack.clips.push(new SubtitleClip(1000, 2000, 'A complete lesson'));
		vi.spyOn(ProjectHistoryManager, 'track').mockImplementation((_label, action) => action());
		const open = vi.spyOn(ModalManager, 'meaningExportModal').mockResolvedValue(undefined);
		const component = render(ExportVideo);
		await component.getByRole('button', { name: 'By meaning', exact: true }).click();
		expect(open).not.toHaveBeenCalled();
		await component.getByRole('button', { name: 'Suggest excerpts' }).click();
		expect(open).toHaveBeenCalledOnce();
		expect(generateMeaningExportRanges).not.toHaveBeenCalled();
		const modal = render(MeaningExportModal, { close: vi.fn() });
		await expect.element(modal.getByRole('tab', { name: 'With API', exact: true })).toBeVisible();
		await expect.element(modal.getByRole('tab', { name: 'Without API key' })).toBeVisible();
		await expect
			.element(modal.getByRole('spinbutton', { name: 'Maximum excerpt duration (seconds)' }))
			.toHaveValue(90);
		expect(modal.container.textContent).not.toContain('Include all verses');
		expect(generateMeaningExportRanges).not.toHaveBeenCalled();
	});

	test.each([false, true])(
		'generates only on request and applies suggestions with undo/redo (manual: %s)',
		async (manual) => {
			initializeClassRegistry();
			const current = globalState.currentProject!;
			const project = new Project(
				current.detail,
				new ProjectContent(
					current.content.timeline,
					[],
					current.content.projectTranslation,
					current.content.videoStyle
				)
			);
			globalState.currentProject = project;
			ProjectHistoryManager.resetForCurrentProject();
			globalState.settings!.aiTranslationSettings.openAiApiKey = manual ? '' : 'personal-key';
			const assertCurrent = vi.fn();
			vi.mocked(generateMeaningExportRanges).mockResolvedValue({
				ranges: meaningRanges,
				assertCurrent
			});
			const close = vi.fn();
			const modal = render(MeaningExportModal, { close });
			if (manual) await modal.getByRole('tab', { name: 'Without API key' }).click();
			expect(generateMeaningExportRanges).not.toHaveBeenCalled();
			await modal.getByRole('spinbutton').fill('60');
			await modal
				.getByRole('textbox', { name: 'Additional preferences' })
				.fill('Focus on patience.');
			await modal
				.getByRole('button', { name: manual ? 'Prepare prompts' : 'Suggest excerpts', exact: true })
				.click();
			await expect.element(modal.getByText('A complete lesson', { exact: true })).toBeVisible();
			expect(generateMeaningExportRanges).toHaveBeenCalledWith(
				project,
				60,
				expect.any(AbortSignal),
				manual ? expect.anything() : undefined,
				'Focus on patience.'
			);
			expect(project.projectEditorState.export.meaningRanges).toHaveLength(0);
			await modal.getByRole('button', { name: 'Use these suggestions' }).click();
			expect(close).toHaveBeenCalledOnce();
			expect(assertCurrent).toHaveBeenCalledOnce();
			expect(project.projectEditorState.export.meaningRanges).toEqual(meaningRanges);
			expect(project.projectEditorState.export.meaningMaxDurationSeconds).toBe(60);
			expect(ProjectHistoryManager.undo()).toBe(true);
			expect(globalState.getExportState.meaningRanges).toHaveLength(0);
			expect(globalState.getExportState.meaningMaxDurationSeconds).toBe(90);
			expect(ProjectHistoryManager.redo()).toBe(true);
			expect(globalState.getExportState.meaningRanges).toEqual(meaningRanges);
		}
	);

	test('selects multiple suggestions and exports each range separately', async () => {
		globalState.getExportState.meaningRanges = meaningRanges;
		globalState.getVideoStyle.getStylesOfTarget(edition.name).findStyle('show-subtitles')!.value =
			false;
		vi.spyOn(ProjectHistoryManager, 'track').mockImplementation((_label, action) => action());
		const exportVideo = vi.spyOn(Exporter, 'exportVideo').mockResolvedValue(undefined);
		const component = render(ExportVideo);
		await component.getByRole('button', { name: 'By meaning', exact: true }).click();
		await component
			.getByRole('button', { name: 'A complete lesson', exact: false })
			.first()
			.click();
		expect(globalState.getExportState.videoStartTime).toBe(1000);
		expect(globalState.getExportState.videoEndTime).toBe(21000);
		await component.getByRole('button', { name: 'Another complete lesson' }).click();
		component
			.getByRole('button', { name: 'A complete lesson', exact: false })
			.first()
			.element()
			.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
		expect(globalState.getExportState.videoStartTime).toBe(1000);
		expect(globalState.getExportState.videoEndTime).toBe(21000);
		await component.getByRole('button', { name: 'Export selected excerpts', exact: true }).click();
		expect(exportVideo).toHaveBeenCalledWith(meaningRanges);
	});
});
