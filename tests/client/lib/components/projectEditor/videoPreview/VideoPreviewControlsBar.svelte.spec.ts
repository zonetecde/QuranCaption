import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Project, ProjectContent, ProjectDetail, Timeline } from '$lib/classes';
import { SubtitleClip } from '$lib/classes/Clip.svelte';
import { SubtitleTrack } from '$lib/classes/Track.svelte';
import { globalState } from '$lib/runes/main.svelte';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';
import VideoPreviewControlsBar from '$lib/components/projectEditor/videoPreview/VideoPreviewControlsBar.svelte';

beforeEach(() => {
	loadLocale('en');
	setLocale('en');
	const track = new SubtitleTrack();
	track.clips = [new SubtitleClip(0, 40000, 'Lecture', 'Speaker')];
	globalState.currentProject = new Project(
		new ProjectDetail('Lecture', 'Speaker'),
		new ProjectContent(new Timeline([track]))
	);
	globalState.getTimelineState.cursorPosition = 20000;
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	globalState.currentProject = null;
});

test('seeks and skips within the project bounds while synchronizing preview and timeline', async () => {
	const scroll = vi.spyOn(globalState.getVideoPreviewState, 'scrollTimelineToCursor');
	const component = render(VideoPreviewControlsBar, { togglePlayPause: vi.fn() });
	await component.getByRole('button', { name: 'Back 10 seconds' }).click();
	expect(globalState.getTimelineState.cursorPosition).toBe(10000);
	await component.getByRole('button', { name: 'Back 10 seconds' }).click();
	expect(globalState.getTimelineState.movePreviewTo).toBe(1);
	const slider = component.container.querySelector<HTMLInputElement>('input[type="range"]')!;
	slider.value = '35000';
	slider.dispatchEvent(new Event('input', { bubbles: true }));
	expect(globalState.getTimelineState.cursorPosition).toBe(35000);
	await component.getByRole('button', { name: 'Forward 10 seconds' }).click();
	expect(globalState.getTimelineState.movePreviewTo).toBe(40000);
	expect(scroll).toHaveBeenCalledTimes(4);
});

test('handles Space on the seek bar once and exposes the fullscreen exit action', async () => {
	globalState.getVideoPreviewState.isFullscreen = true;
	const togglePlayPause = vi.fn();
	const component = render(VideoPreviewControlsBar, { togglePlayPause });
	const slider = component.container.querySelector<HTMLInputElement>('input[type="range"]')!;
	slider.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
	expect(togglePlayPause).toHaveBeenCalledOnce();
	await expect.element(component.getByRole('button', { name: 'Exit Fullscreen' })).toBeVisible();
});
