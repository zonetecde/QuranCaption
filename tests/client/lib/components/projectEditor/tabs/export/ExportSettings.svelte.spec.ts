import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, expect, test, vi } from 'vitest';
import { get } from 'svelte/store';

import ExportSettings from '$lib/components/projectEditor/tabs/export/ExportSettings.svelte';
import { ProjectEditorState } from '$lib/classes/ProjectEditorState.svelte';
import { globalState } from '$lib/runes/main.svelte';
import LL, { setLocale } from '$lib/i18n/i18n-svelte';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { openUrl } from '@tauri-apps/plugin-opener';
import { invoke } from '@tauri-apps/api/core';
import '../../../../../../../src/app.css';

vi.mock('@tauri-apps/api/core', async () => ({
	...(await vi.importActual<typeof import('@tauri-apps/api/core')>('@tauri-apps/api/core')),
	invoke: vi.fn()
}));

vi.mock('@tauri-apps/plugin-opener', async () => ({
	...(await vi.importActual<typeof import('@tauri-apps/plugin-opener')>(
		'@tauri-apps/plugin-opener'
	)),
	openUrl: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('$lib/components/projectEditor/tabs/export/ExportVideo.svelte', async () => ({
	default: (await import('../../../../../stubs/EmptyComponent.svelte')).default
}));
vi.mock('$lib/components/projectEditor/tabs/export/ExportSubtitles.svelte', async () => ({
	default: (await import('../../../../../stubs/EmptyComponent.svelte')).default
}));
vi.mock('$lib/components/projectEditor/tabs/export/ExportYtbChapters.svelte', async () => ({
	default: (await import('../../../../../stubs/EmptyComponent.svelte')).default
}));
vi.mock('$lib/components/projectEditor/tabs/export/ExportProjectData.svelte', async () => ({
	default: (await import('../../../../../stubs/EmptyComponent.svelte')).default
}));

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.clearAllMocks();
	globalState.currentProject = null;
});

test('opens the thumbnail editor with project details from a full-width fifth choice', async () => {
	loadLocale('en');
	setLocale('en');
	const preview =
		'data:image/svg+xml,' +
		encodeURIComponent(
			'<svg xmlns="http://www.w3.org/2000/svg" width="128" height="72"><rect width="128" height="72" fill="green"/></svg>'
		);
	vi.mocked(invoke).mockResolvedValue([
		{ hash: '#quran-caption', name: 'Quran Caption style', preview },
		{ hash: '#haramain', name: 'Haramain style', preview },
		{ hash: '#future-template', name: 'New style', preview }
	]);
	globalState.currentProject = {
		projectEditorState: new ProjectEditorState(),
		detail: { reciter: 'Yasser Al Dosari', getProminentSurah: () => 18 },
		content: { projectTranslation: { addedTranslationEditions: [{ language: 'French' }] } }
	} as never;
	const component = render(ExportSettings);
	const choices = component.container.querySelectorAll('[role="radio"]');
	expect(choices).toHaveLength(5);
	const thumbnailChoice = choices[4] as HTMLElement;
	expect(thumbnailChoice.dataset.choice).toBe('thumbnail');
	expect(thumbnailChoice.classList.contains('col-span-2')).toBe(true);
	thumbnailChoice.click();
	await expect.element(component.getByText('@sadaalayat', { exact: false })).toBeVisible();
	await expect.element(component.getByText('Yasser Al Dosari')).toBeVisible();
	await expect.element(component.getByText('French')).toBeVisible();
	const copy = get(LL).export as unknown as { thumbnailOpen: () => string };
	await expect
		.element(component.getByRole('button', { name: copy.thumbnailOpen() }))
		.toBeDisabled();
	await expect.element(component.getByRole('button', { name: 'New style' })).toBeVisible();
	const haramainPreview = component
		.getByRole('button', { name: 'Haramain style' })
		.element()
		.querySelector('img');
	expect(haramainPreview?.getAttribute('src')).toBe(preview);
	await vi.waitFor(() => expect(haramainPreview?.naturalWidth).toBeGreaterThan(0));
	const haramainChoice = component.getByRole('button', { name: 'Haramain style' });
	const futureChoice = component.getByRole('button', { name: 'New style' });
	await haramainChoice.click();
	await expect.element(haramainChoice).toHaveAttribute('aria-pressed', 'true');
	await expect.element(haramainChoice.getByText('check_circle')).toBeVisible();
	await vi.waitFor(() => {
		expect(getComputedStyle(haramainChoice.element()).backgroundColor).not.toBe(
			getComputedStyle(futureChoice.element()).backgroundColor
		);
		expect(getComputedStyle(haramainChoice.element()).borderColor).not.toBe(
			getComputedStyle(futureChoice.element()).borderColor
		);
	});
	await component.getByRole('button', { name: copy.thumbnailOpen() }).click();
	expect(openUrl).toHaveBeenCalledOnce();
	const url = new URL(vi.mocked(openUrl).mock.calls[0][0]);
	expect(url.origin + url.pathname).toBe('https://quranthumbnails.com/editor');
	expect(url.searchParams.get('surah')).toBe('18');
	expect(url.searchParams.get('reciter')).toBe('Yasser Al Dosari');
	expect(url.searchParams.get('translationLanguage')).toBe('French');
	expect(url.hash).toBe('#haramain');
	await futureChoice.click();
	await expect.element(futureChoice).toHaveAttribute('aria-pressed', 'true');
	await expect.element(futureChoice.getByText('check_circle')).toBeVisible();
	await expect.element(haramainChoice).toHaveAttribute('aria-pressed', 'false');
	expect(haramainChoice.element().querySelector('[aria-hidden="true"]')).toBeNull();
	await component.getByRole('button', { name: copy.thumbnailOpen() }).click();
	expect(new URL(vi.mocked(openUrl).mock.calls[1][0]).hash).toBe('#future-template');
	expect(component.container.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(1);
	expect(invoke).toHaveBeenCalledWith('get_thumbnail_templates');
});

test.each([null, []])(
	'lets the user retry when the template gallery cannot be loaded (%s)',
	async (templates) => {
		loadLocale('en');
		setLocale('en');
		if (templates === null) vi.mocked(invoke).mockRejectedValueOnce(new Error('Offline'));
		else vi.mocked(invoke).mockResolvedValueOnce(templates);
		vi.mocked(invoke).mockResolvedValueOnce([
			{ hash: '#haramain', name: 'Haramain style', preview: '' }
		]);
		globalState.currentProject = {
			projectEditorState: new ProjectEditorState(),
			detail: { reciter: '', getProminentSurah: () => null },
			content: { projectTranslation: { addedTranslationEditions: [] } }
		} as never;
		const component = render(ExportSettings);
		(component.container.querySelector('[data-choice="thumbnail"]') as HTMLElement).click();
		const copy = get(LL).export as unknown as {
			thumbnailOpen: () => string;
			thumbnailTemplatesError: () => string;
		};
		await expect.element(component.getByText(copy.thumbnailTemplatesError())).toBeVisible();
		await expect
			.element(component.getByRole('button', { name: copy.thumbnailOpen() }))
			.toBeDisabled();
		await component.getByRole('button', { name: get(LL).common.retry() }).click();
		await component.getByRole('button', { name: 'Haramain style' }).click();
		await component.getByRole('button', { name: copy.thumbnailOpen() }).click();
		expect(new URL(vi.mocked(openUrl).mock.calls[0][0]).hash).toBe('#haramain');
	}
);
