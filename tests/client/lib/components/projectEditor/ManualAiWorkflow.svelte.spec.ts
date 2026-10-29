import { cleanup, render } from 'vitest-browser-svelte';
import { page } from '@vitest/browser/context';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import '../../../../../src/app.css';
import 'material-icons/iconfont/material-icons.css';
import { invoke } from '@tauri-apps/api/core';
import { Project, ProjectContent, ProjectDetail, SubtitleClip, Timeline } from '$lib/classes';
import { SubtitleTrack } from '$lib/classes/Track.svelte';
import Settings from '$lib/classes/Settings.svelte';
import { globalState } from '$lib/runes/main.svelte';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';
import CorrectTranscriptionModal from '$lib/components/modals/tools/CorrectTranscriptionModal.svelte';
import DetectReferencesModal from '$lib/components/modals/tools/DetectReferencesModal.svelte';
import RearrangeSubtitlesModal from '$lib/components/modals/tools/RearrangeSubtitlesModal.svelte';
import { initializeClassRegistry } from '$lib/classes/ClassRegistry';

vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tauri-apps/api/core')>()),
	invoke: vi.fn()
}));
const originalSettings = globalState.settings;

beforeEach(() => {
	loadLocale('en');
	setLocale('en');
	initializeClassRegistry();
	globalState.settings = new Settings();
	globalState.settings.aiTranslationSettings.openAiApiKey = '';
	const track = new SubtitleTrack();
	track.clips = [
		new SubtitleClip(0, 2000, 'He read a massage.', {}, true, null, {
			source: 'api',
			timeFrom: 0,
			timeTo: 2,
			matchedText: 'He read a massage.',
			words: ['He', 'read', 'a', 'massage.'].map((word, index) => ({
				word,
				start: index * 0.5,
				end: index * 0.5 + 0.4
			}))
		})
	];
	globalState.currentProject = new Project(
		new ProjectDetail('Manual AI', 'speaker'),
		new ProjectContent(new Timeline([track]))
	);
	vi.mocked(invoke).mockResolvedValue('Original hidden instructions');
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.mocked(invoke).mockReset();
	globalState.currentProject = null;
	globalState.settings = originalSettings;
});

test.each([
	['correction', CorrectTranscriptionModal],
	['rearrangement', RearrangeSubtitlesModal],
	['references', DetectReferencesModal]
] as const)(
	'opens the %s manual workflow without a key and cancels without changing subtitles',
	async (kind, Modal) => {
		await page.viewport(1280, 900);
		const component = render(Modal, { close: vi.fn() });
		await component.getByRole('tab', { name: 'Without API key' }).click();
		if (kind === 'references')
			await component.getByRole('checkbox', { name: 'Quran quotations', exact: true }).click();
		await component.getByRole('button', { name: 'Prepare prompts', exact: true }).click();
		await expect
			.element(component.getByRole('textbox', { name: '2. Paste the full reply here' }))
			.toBeVisible();
		await expect
			.element(component.getByRole('button', { name: 'Check reply and continue' }))
			.toBeDisabled();
		expect(component.container.textContent).not.toContain('Original hidden instructions');
		expect(invoke).toHaveBeenCalledWith(
			'prepare_manual_ai_prompt',
			expect.objectContaining({ kind: expect.any(String) })
		);
		await component.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect
			.element(component.getByRole('button', { name: 'Prepare prompts', exact: true }))
			.not.toBeDisabled();
		expect((globalState.getSubtitleTrack.clips[0] as SubtitleClip).text).toBe('He read a massage.');
	}
);

test('keeps retry controls and response input reachable on a narrow window', async () => {
	await page.viewport(540, 900);
	const component = render(CorrectTranscriptionModal, { close: vi.fn() });
	await component.getByRole('tab', { name: 'Without API key' }).click();
	await component.getByRole('button', { name: 'Prepare prompts', exact: true }).click();
	await component
		.getByRole('textbox', { name: '2. Paste the full reply here' })
		.fill('{incomplete');
	await component.getByRole('button', { name: 'Check reply and continue' }).click();
	await expect.element(component.getByRole('button', { name: 'Copy retry prompt' })).toBeVisible();
	const dialog = component.getByRole('dialog').element();
	expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
});

test('switches connection tabs from the keyboard', async () => {
	const component = render(CorrectTranscriptionModal, { close: vi.fn() });
	const apiTab = component
		.getByRole('tab', { name: 'With API', exact: true })
		.element() as HTMLButtonElement;
	apiTab.focus();
	apiTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
	await expect
		.element(component.getByRole('tab', { name: 'Without API key' }))
		.toHaveAttribute('aria-selected', 'true');
	await expect
		.element(component.getByRole('button', { name: 'Prepare prompts', exact: true }))
		.not.toBeDisabled();
	expect(document.activeElement?.textContent).toContain('Without API key');
});
