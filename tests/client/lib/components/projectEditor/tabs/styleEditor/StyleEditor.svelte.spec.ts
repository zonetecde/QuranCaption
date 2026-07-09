import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';

import StyleEditor from '$lib/components/projectEditor/tabs/styleEditor/StyleEditor.svelte';
import { ProjectEditorState } from '$lib/classes/ProjectEditorState.svelte';
import { DEFAULT_STYLE_PANEL_WIDTH } from '$lib/constants/projectEditor';
import { globalState } from '$lib/runes/main.svelte';

vi.mock('$lib/components/projectEditor/timeline/Timeline.svelte', async () => ({
	default: (await import('../../../../../stubs/EmptyComponent.svelte')).default
}));

vi.mock('$lib/components/projectEditor/videoPreview/VideoPreview.svelte', async () => ({
	default: (await import('../../../../../stubs/EmptyComponent.svelte')).default
}));

vi.mock('$lib/components/projectEditor/tabs/DiviseurRedimensionnable.svelte', async () => ({
	default: (await import('../../../../../stubs/EmptyComponent.svelte')).default
}));

vi.mock('$lib/components/projectEditor/tabs/styleEditor/StyleEditorSettings.svelte', async () => ({
	default: (await import('../../../../../stubs/EmptyComponent.svelte')).default
}));

describe('style editor panel resizer', () => {
	afterEach(() => {
		cleanup();
		globalState.currentProject = null;
		globalState.presetLibrary.libraryOpen = false;
	});

	test('uses a larger default width and bounds it while dragging', () => {
		const projectEditorState = new ProjectEditorState();
		globalState.currentProject = { projectEditorState } as never;
		expect(Reflect.get(projectEditorState, 'stylePanelWidth')).toBe(DEFAULT_STYLE_PANEL_WIDTH);

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
		expect(Reflect.get(projectEditorState, 'stylePanelWidth')).toBe(
			DEFAULT_STYLE_PANEL_WIDTH + 120
		);

		document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: -200 }));
		expect(Reflect.get(projectEditorState, 'stylePanelWidth')).toBe(280);

		document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 1000 }));
		expect(Reflect.get(projectEditorState, 'stylePanelWidth')).toBe(720);

		document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
	});
});
