import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { tick } from 'svelte';
import { Project, ProjectContent, ProjectDetail, Timeline } from '$lib/classes';
import { SubtitleClip } from '$lib/classes/Clip.svelte';
import { SubtitleTrack } from '$lib/classes/Track.svelte';
import { globalState } from '$lib/runes/main.svelte';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';
import ProjectSearchOverlay from '$lib/components/projectEditor/ProjectSearchOverlay.svelte';

beforeEach(() => {
	loadLocale('en');
	setLocale('en');
	const track = new SubtitleTrack();
	track.clips = [
		new SubtitleClip(0, 5000, 'First'),
		new SubtitleClip(10000, 20000, 'Second'),
		new SubtitleClip(50000, 60000, 'Third')
	];
	globalState.currentProject = new Project(
		new ProjectDetail('Lecture', 'Speaker'),
		new ProjectContent(new Timeline([track]))
	);
	globalState.getTimelineState.cursorPosition = 15000;
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	globalState.currentProject = null;
});

test('shows current and total time and snaps time-based seeking to subtitle starts', async () => {
	const scroll = vi.spyOn(globalState.getVideoPreviewState, 'scrollTimelineToCursor');
	const component = render(ProjectSearchOverlay, { onClose: vi.fn() });
	const slider = component.container.querySelector<HTMLInputElement>('input[type="range"]')!;
	expect(slider.max).toBe('60000');
	expect(slider.value).toBe('15000');
	expect(component.container.textContent).toMatch(/00:15\s*\/\s*01:00/);

	for (const [time, start] of [
		[26000, 10000],
		[45000, 50000],
		[60000, 50000],
		[0, 0]
	]) {
		slider.value = String(time);
		slider.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();
		expect(globalState.getTimelineState.cursorPosition).toBe(start);
		expect(globalState.getTimelineState.movePreviewTo).toBe(start);
		expect(slider.value).toBe(String(start));
	}
	expect(scroll).toHaveBeenCalledTimes(4);
	expect(component.container.textContent).toMatch(/00:00\s*\/\s*01:00/);
	for (const [key, start] of [
		['ArrowRight', 10000],
		['ArrowRight', 50000],
		['ArrowLeft', 10000]
	] as const) {
		slider.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
		await tick();
		expect(globalState.getTimelineState.cursorPosition).toBe(start);
	}
});
