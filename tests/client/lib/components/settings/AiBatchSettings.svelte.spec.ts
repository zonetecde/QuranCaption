import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import Settings from '$lib/classes/Settings.svelte';
import AiBatchSettings from '$lib/components/settings/AiBatchSettings.svelte';
import AiBatchSummary from '$lib/components/ai/AiBatchSummary.svelte';
import { globalState } from '$lib/runes/main.svelte';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';

const originalSettings = globalState.settings;

beforeEach(() => {
	loadLocale('en');
	setLocale('en');
	globalState.settings = new Settings();
	vi.spyOn(Settings, 'save').mockResolvedValue();
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	globalState.settings = originalSettings;
});

test('saves larger batches on the left and smaller batches on the right independently', async () => {
	const component = render(AiBatchSettings);
	const analysis = component
		.getByRole('slider', { name: 'Correction, references and rearrangement' })
		.element() as HTMLInputElement;
	const translation = component
		.getByRole('slider', { name: 'Translation', exact: true })
		.element() as HTMLInputElement;
	const settings = globalState.settings!.aiTranslationSettings;
	expect([analysis.value, translation.value]).toEqual(['3', '3']);
	analysis.value = '0';
	analysis.dispatchEvent(new Event('input', { bubbles: true }));
	analysis.dispatchEvent(new Event('change', { bubbles: true }));
	await expect.poll(() => settings.analysisBatchSize).toBe(2000);
	expect(settings.projectTranslationBatchWords).toBe(650);
	translation.value = '5';
	translation.dispatchEvent(new Event('input', { bubbles: true }));
	translation.dispatchEvent(new Event('change', { bubbles: true }));
	await expect.poll(() => settings.projectTranslationBatchWords).toBe(150);
	expect(settings.analysisBatchSize).toBe(2000);
	expect(Settings.save).toHaveBeenCalledTimes(2);
	await expect
		.element(component.getByRole('slider', { name: 'Translation', exact: true }))
		.toHaveAttribute('aria-valuetext', '150 words per request');
});

test.each(['en', 'fr', 'de', 'es', 'ar'] as const)(
	'localizes batch settings and reacts to changed sizes in %s',
	async (language) => {
		loadLocale(language);
		setLocale(language);
		const component = render(AiBatchSettings);
		expect(component.getByRole('slider').elements()).toHaveLength(2);
		expect(component.container.textContent).not.toContain('undefined');
		const summary = render(AiBatchSummary, {
			subtitles: Array.from({ length: 1090 }, () => ({ text: 'short subtitle' })),
			feature: 'correction'
		});
		await expect.element(summary.getByText('≈ 11', { exact: true })).toBeVisible();
		globalState.settings!.aiTranslationSettings.analysisBatchSize = 2000;
		await expect.element(summary.getByText('≈ 1', { exact: true })).toBeVisible();
	}
);

test('keeps the actual run total when batch preferences change during a session', async () => {
	const summary = render(AiBatchSummary, {
		subtitles: Array.from({ length: 1090 }, () => ({ text: 'short subtitle' })),
		feature: 'correction',
		total: 11
	});
	await expect
		.element(summary.getByText('Requests for this run : 11', { exact: true }))
		.toBeVisible();
	globalState.settings!.aiTranslationSettings.analysisBatchSize = 250;
	await expect
		.element(summary.getByText('Requests for this run : 11', { exact: true }))
		.toBeVisible();
	expect(summary.container.textContent).not.toContain('≈');
});
