import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, expect, test, vi } from 'vitest';
import { get } from 'svelte/store';
import { tick } from 'svelte';
import VideoPreviewControlsBar from '$lib/components/projectEditor/videoPreview/VideoPreviewControlsBar.svelte';
import { Duration, ProjectEditorState, ProjectEditorTabs, Style } from '$lib/classes';
import { globalState } from '$lib/runes/main.svelte';
import LL, { setLocale } from '$lib/i18n/i18n-svelte';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import '../../../../../../src/app.css';
import 'material-icons/iconfont/material-icons.css';

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	globalState.currentProject = null;
});

test('seeks and clamps ten-second skips within the project on a narrow mobile preview', async () => {
	loadLocale('en');
	setLocale('en');
	const projectEditorState = new ProjectEditorState();
	projectEditorState.currentTab = ProjectEditorTabs.Style;
	projectEditorState.timeline.cursorPosition = 5000;
	globalState.currentProject = {
		projectEditorState,
		content: { timeline: { getLongestTrackDuration: () => new Duration(30000) } }
	} as never;
	vi.spyOn(globalState, 'getStyle').mockReturnValue(
		new Style({ id: 'video-dimension', value: { width: 1080, height: 1920 } })
	);
	const scroll = vi
		.spyOn(projectEditorState.videoPreview, 'scrollTimelineToCursor')
		.mockImplementation(() => {});
	const togglePlayPause = vi.fn();
	const component = render(VideoPreviewControlsBar, { togglePlayPause });
	component.container.style.width = '320px';
	await document.fonts.ready;
	const copy = get(LL).editor;

	await component.getByRole('button', { name: copy.skipBackwardTenSeconds() }).click();
	expect(projectEditorState.timeline.cursorPosition).toBe(1);
	expect(projectEditorState.timeline.movePreviewTo).toBe(1);
	await component.getByRole('button', { name: copy.skipForwardTenSeconds() }).click();
	expect(projectEditorState.timeline.cursorPosition).toBe(10001);
	projectEditorState.timeline.cursorPosition = 29000;
	await tick();
	await component.getByRole('button', { name: copy.skipForwardTenSeconds() }).click();
	expect(projectEditorState.timeline.cursorPosition).toBe(30000);

	const slider = component
		.getByRole('slider', { name: copy.seekVideo() })
		.element() as HTMLInputElement;
	slider.value = '17500';
	slider.dispatchEvent(new Event('input', { bubbles: true }));
	expect(projectEditorState.timeline.cursorPosition).toBe(17500);
	expect(projectEditorState.timeline.movePreviewTo).toBe(17500);
	expect(scroll).toHaveBeenCalledTimes(4);
	await component
		.getByRole('button', { name: get(LL).settings.shortcutAction.PLAY_PAUSE() })
		.click();
	expect(togglePlayPause).toHaveBeenCalledOnce();

	const bounds = component.container.getBoundingClientRect();
	for (const control of component.container.querySelectorAll('button, input')) {
		const rect = control.getBoundingClientRect();
		expect(rect.left).toBeGreaterThanOrEqual(bounds.left);
		expect(rect.right).toBeLessThanOrEqual(bounds.right);
	}
});
