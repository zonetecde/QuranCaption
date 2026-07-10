import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';

import StyleEditor from '$lib/components/projectEditor/tabs/styleEditor/StyleEditor.svelte';
import Settings from '$lib/classes/Settings.svelte';
import {
	DEFAULT_STYLE_PANEL_WIDTH,
	PROJECT_EDITOR_PANEL_WIDTHS
} from '$lib/constants/projectEditor';
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

describe('style editor panel resizer', () => {
	const stylePanelWidths = PROJECT_EDITOR_PANEL_WIDTHS.style;

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		globalState.currentProject = null;
		globalState.settings = undefined;
		globalState.presetLibrary.libraryOpen = false;
	});

	test('uses a larger default width and bounds it while dragging', () => {
		const settings = new Settings();
		globalState.settings = settings;
		vi.spyOn(Settings, 'save').mockResolvedValue();
		expect(settings.persistentUiState.projectEditorLayout.stylePanelWidth).toBe(
			DEFAULT_STYLE_PANEL_WIDTH
		);

		const component = render(StyleEditor);
		const resizer = component.getByTestId('style-panel-resizer').element();

		resizer.dispatchEvent(
			new PointerEvent('pointerdown', {
				bubbles: true,
				button: 0,
				clientX: DEFAULT_STYLE_PANEL_WIDTH
			})
		);
		document.dispatchEvent(
			new PointerEvent('pointermove', {
				bubbles: true,
				clientX: DEFAULT_STYLE_PANEL_WIDTH + 120
			})
		);
		expect(settings.persistentUiState.projectEditorLayout.stylePanelWidth).toBe(
			DEFAULT_STYLE_PANEL_WIDTH + 120
		);

		document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: -200 }));
		expect(settings.persistentUiState.projectEditorLayout.stylePanelWidth).toBe(
			stylePanelWidths.min
		);

		document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 1000 }));
		expect(settings.persistentUiState.projectEditorLayout.stylePanelWidth).toBe(
			stylePanelWidths.max
		);

		document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

		resizer.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Home' }));
		expect(settings.persistentUiState.projectEditorLayout.stylePanelWidth).toBe(
			stylePanelWidths.min
		);

		resizer.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
		expect(settings.persistentUiState.projectEditorLayout.stylePanelWidth).toBe(
			stylePanelWidths.min + 20
		);
	});
});
