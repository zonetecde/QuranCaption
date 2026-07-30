import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';

import StyleEditor from '$lib/components/projectEditor/tabs/styleEditor/StyleEditor.svelte';
import Settings from '$lib/classes/Settings.svelte';
import { PROJECT_EDITOR_STYLE_SECTION_HEIGHTS } from '$lib/constants/projectEditor';
import { globalState } from '$lib/runes/main.svelte';

vi.mock('$lib/components/projectEditor/timeline/Timeline.svelte', async () => ({
	default: (await import('../../../../../stubs/EmptyComponent.svelte')).default
}));

vi.mock('$lib/components/projectEditor/videoPreview/VideoPreview.svelte', async () => ({
	default: (await import('../../../../../stubs/EmptyComponent.svelte')).default
}));

vi.mock('$lib/components/projectEditor/tabs/styleEditor/StyleEditorSettings.svelte', async () => ({
	default: (await import('../../../../../stubs/EmptyComponent.svelte')).default
}));

describe('style editor section resizers', () => {
	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		globalState.currentProject = null;
		globalState.settings = undefined;
		globalState.presetLibrary.libraryOpen = false;
	});

	test('resizes the preview and timeline within their mobile bounds', () => {
		const settings = new Settings();
		globalState.settings = settings;
		vi.spyOn(Settings, 'save').mockResolvedValue();

		const component = render(StyleEditor);
		const previewResizer = component.getByTestId('style-preview-resizer').element();
		const timelineResizer = component.getByTestId('style-timeline-resizer').element();

		previewResizer.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Home' }));
		expect(settings.persistentUiState.projectEditorLayout.stylePreviewHeight).toBe(
			PROJECT_EDITOR_STYLE_SECTION_HEIGHTS.preview.min
		);
		previewResizer.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'End' }));
		expect(settings.persistentUiState.projectEditorLayout.stylePreviewHeight).toBe(
			PROJECT_EDITOR_STYLE_SECTION_HEIGHTS.preview.max
		);

		timelineResizer.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Home' }));
		expect(settings.persistentUiState.projectEditorLayout.styleTimelineHeight).toBe(
			PROJECT_EDITOR_STYLE_SECTION_HEIGHTS.timeline.min
		);
		timelineResizer.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'End' }));
		expect(settings.persistentUiState.projectEditorLayout.styleTimelineHeight).toBe(
			PROJECT_EDITOR_STYLE_SECTION_HEIGHTS.timeline.max
		);
	});
});
