import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { tick } from 'svelte';

import SubtitlesEditorSettings from '$lib/components/projectEditor/tabs/subtitlesEditor/SubtitlesEditorSettings.svelte';
import { globalState } from '$lib/runes/main.svelte';
import {
	resetSubtitlesEditorProjectFixture,
	setupSubtitlesEditorProjectFixture,
	seedSubtitlesEditorQuranFixture
} from '../../../../../fixtures/subtitlesEditor/projectFixture';

const toastMock = vi.hoisted(() => ({
	error: vi.fn(),
	info: vi.fn(),
	success: vi.fn(),
	warning: vi.fn()
}));

vi.mock('svelte-5-french-toast', () => ({
	default: toastMock
}));

describe('SubtitlesEditorSettings', () => {
	beforeEach(() => {
		seedSubtitlesEditorQuranFixture();
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		resetSubtitlesEditorProjectFixture();
	});

	test('marks and clears long segments with the configured threshold', async () => {
		const fixture = setupSubtitlesEditorProjectFixture();
		globalState.currentProject!.content.timeline.tracks.push({
			type: 'Audio',
			clips: []
		} as never);
		globalState.getSubtitlesEditorState.longSegmentMinWords = 2;

		const component = render(SubtitlesEditorSettings);
		await tick();

		await expect.element(component.getByText('Long segments', { exact: true })).toBeVisible();
		await component.getByRole('button', { name: /Mark/i }).click();

		expect(globalState.getSubtitleClips.map((clip) => clip.needsLongReview)).toEqual([true, false, true]);
		expect(toastMock.success).toHaveBeenCalled();

		await component.getByRole('button', { name: /Next/i }).click();
		expect(globalState.getTimelineState.cursorPosition).toBe(fixture.clips[2].startTime);
		expect(fixture.spies.updateVideoPreviewUI).not.toHaveBeenCalled();
		expect(globalState.getVideoPreviewState.scrollTimelineToCursor).toHaveBeenCalled();

		await component.getByRole('button', { name: /Clear/i }).click();
		expect(globalState.getSubtitleClips.every((clip) => clip.needsLongReview === false)).toBe(true);
	});
});
