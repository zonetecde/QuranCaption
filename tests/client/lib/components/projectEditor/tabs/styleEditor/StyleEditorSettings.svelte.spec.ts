import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';

import StyleEditorSettings from '$lib/components/projectEditor/tabs/styleEditor/StyleEditorSettings.svelte';
import { ProjectEditorState } from '$lib/classes/ProjectEditorState.svelte';
import { Timeline } from '$lib/classes/Timeline.svelte';
import { SubtitleClip, PredefinedSubtitleClip } from '$lib/classes/Clip.svelte';
import { SubtitleTrack } from '$lib/classes/Track.svelte';
import { globalState } from '$lib/runes/main.svelte';

vi.mock('$lib/components/projectEditor/Section.svelte', async () => ({
	default: (await import('../../../../../stubs/EmptyComponent.svelte')).default
}));

vi.mock('$lib/components/projectEditor/tabs/styleEditor/Style.svelte', async () => ({
	default: (await import('../../../../../stubs/EmptyComponent.svelte')).default
}));

vi.mock('$lib/components/projectEditor/tabs/styleEditor/ImportExportStyle.svelte', async () => ({
	default: (await import('../../../../../stubs/EmptyComponent.svelte')).default
}));

type MockStyleTarget = {
	categories: unknown[];
};

function createMockVideoStyle() {
	const target: MockStyleTarget = {
		categories: []
	};

	return {
		ensureStylesSchemaUpToDate: vi.fn().mockResolvedValue(undefined),
		doesTargetStyleExist: vi.fn().mockReturnValue(true),
		addStylesForEdition: vi.fn().mockResolvedValue(undefined),
		getStylesOfTarget: vi.fn().mockReturnValue(target)
	};
}

function createSubtitle(startTime: number, endTime: number, verse: number): SubtitleClip {
	return new SubtitleClip(startTime, endTime, 1, verse, 0, 0, `Verse ${verse}`, [], true, true);
}

describe('style editor visual merge actions', () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		globalState.currentProject = null;
	});

	test('shows visual merge actions for a valid consecutive Quran selection', async () => {
		const first = createSubtitle(0, 999, 1);
		const second = createSubtitle(1000, 1999, 2);
		const subtitleTrack = new SubtitleTrack();
		subtitleTrack.clips = [first, second];

		const projectEditorState = new ProjectEditorState();
		projectEditorState.stylesEditor.selectedSubtitles = [first, second];

		globalState.currentProject = {
			projectEditorState,
			content: {
				timeline: new Timeline([subtitleTrack]),
				projectTranslation: {
					addedTranslationEditions: []
				},
				videoStyle: createMockVideoStyle()
			}
		} as never;

		const component = render(StyleEditorSettings);

		await expect.element(component.getByText('Visual merge')).toBeVisible();
		await expect.element(component.getByTestId('Merge Arabic')).toBeVisible();
		await expect.element(component.getByTestId('Merge Translation')).toBeVisible();
		await expect.element(component.getByTestId('Merge Both')).toBeVisible();

		await expect.element(component.getByTestId('Merge Arabic')).toHaveClass(/(^|\s)btn(\s|$)/);
		await expect
			.element(component.getByText('Merge Arabic'))
			.not.toHaveClass(/(^|\s)btn-accent(\s|$)/);
		await expect.element(component.getByTestId('Merge Translation')).toHaveClass(/(^|\s)btn(\s|$)/);
		await expect
			.element(component.getByTestId('Merge Translation'))
			.not.toHaveClass(/(^|\s)btn-accent(\s|$)/);
		await expect.element(component.getByTestId('Merge Both')).toHaveClass(/(^|\s)btn(\s|$)/);
		await expect
			.element(component.getByTestId('Merge Both'))
			.not.toHaveClass(/(^|\s)btn-accent(\s|$)/);
	});

	test('highlights only the active visual merge mode in blue', async () => {
		const first = createSubtitle(0, 999, 1);
		const second = createSubtitle(1000, 1999, 2);
		first.setVisualMerge('group-1', 'translation');
		second.setVisualMerge('group-1', 'translation');
		const subtitleTrack = new SubtitleTrack();
		subtitleTrack.clips = [first, second];

		const projectEditorState = new ProjectEditorState();
		projectEditorState.stylesEditor.selectedSubtitles = [first, second];

		globalState.currentProject = {
			projectEditorState,
			content: {
				timeline: new Timeline([subtitleTrack]),
				projectTranslation: {
					addedTranslationEditions: []
				},
				videoStyle: createMockVideoStyle()
			}
		} as never;

		const component = render(StyleEditorSettings);

		await expect
			.element(component.getByText('Merge Arabic'))
			.not.toHaveClass(/(^|\s)btn-accent(\s|$)/);
		await expect
			.element(component.getByText('Merge Translation'))
			.toHaveClass(/(^|\s)btn-accent(\s|$)/);
		await expect
			.element(component.getByText('Merge Both'))
			.not.toHaveClass(/(^|\s)btn-accent(\s|$)/);
		await expect.element(component.getByText('Unmerge Group')).toBeVisible();
	});

	test('hides visual merge actions for an invalid selection', async () => {
		const first = createSubtitle(0, 999, 1);
		const second = createSubtitle(1000, 1999, 2);
		const predefined = new PredefinedSubtitleClip(2000, 2999, 'Basmala');
		const subtitleTrack = new SubtitleTrack();
		subtitleTrack.clips = [first, second, predefined];

		const projectEditorState = new ProjectEditorState();
		projectEditorState.stylesEditor.selectedSubtitles = [first, predefined];

		globalState.currentProject = {
			projectEditorState,
			content: {
				timeline: new Timeline([subtitleTrack]),
				projectTranslation: {
					addedTranslationEditions: []
				},
				videoStyle: createMockVideoStyle()
			}
		} as never;

		const component = render(StyleEditorSettings);

		expect(component.container.textContent).not.toContain('Visual merge');
	});
});
