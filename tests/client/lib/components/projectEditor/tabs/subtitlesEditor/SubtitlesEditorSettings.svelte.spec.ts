import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { tick } from 'svelte';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';

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
		loadLocale('en');
		setLocale('en');
		seedSubtitlesEditorQuranFixture();
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
		resetSubtitlesEditorProjectFixture();
	});

	test('navigates between pending low-confidence segments and removes reviewed segments from the count', async () => {
		const fixture = setupSubtitlesEditorProjectFixture();
		fixture.clips[0].needsReview = true;
		fixture.clips[2].needsReview = true;
		const component = render(SubtitlesEditorSettings);
		await tick();
		await expect.element(component.getByText('Low confidence', { exact: true })).toBeVisible();
		await component.getByRole('button', { name: /Next/i }).click();
		expect(globalState.getTimelineState.cursorPosition).toBe(fixture.clips[2].startTime);
		expect(globalState.getVideoPreviewState.scrollTimelineToCursor).toHaveBeenCalled();
		await component.getByRole('button', { name: /Next/i }).click();
		expect(globalState.getTimelineState.cursorPosition).toBe(fixture.clips[0].startTime);
		fixture.clips[0].hasBeenVerified = true;
		await tick();
		await component.getByRole('button', { name: /Next/i }).click();
		expect(globalState.getTimelineState.cursorPosition).toBe(fixture.clips[2].startTime);
		fixture.clips[2].hasBeenVerified = true;
		await tick();
		expect(component.container.textContent).not.toContain('Low confidence');
	});
});
