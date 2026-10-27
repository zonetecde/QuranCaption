import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createRawSnippet, tick } from 'svelte';
import { get } from 'svelte/store';
import '../../../../src/app.css';
import Settings from '$lib/classes/Settings.svelte';
import { globalState } from '$lib/runes/main.svelte';
import { locale, setLocale } from '$lib/i18n/i18n-svelte';
import { loadAllLocales } from '$lib/i18n/i18n-util.sync';
import LanguageSwitcher from '$lib/components/misc/LanguageSwitcher.svelte';
import Divider from '$lib/components/projectEditor/tabs/DiviseurRedimensionnable.svelte';
import ReasoningControls from '$lib/components/ai/AIReasoningControls.svelte';
import { i18nObject } from '$lib/i18n/i18n-util';
import Layout from '../../../../src/routes/+layout.svelte';

vi.mock('$app/navigation', () => ({ afterNavigate: vi.fn() }));

const originalSettings = globalState.settings;

beforeEach(() => {
	loadAllLocales();
	setLocale('en');
	globalState.settings = new Settings();
	vi.spyOn(Settings, 'save').mockResolvedValue(undefined);
	render(Layout, {
		children: createRawSnippet(() => ({ render: () => '<span></span>' }))
	});
});

afterEach(() => {
	cleanup();
	setLocale('en');
	globalState.settings = originalSettings;
	document.documentElement.lang = 'en';
	document.documentElement.dir = 'ltr';
	vi.restoreAllMocks();
});

test('switches, saves and applies the direction of all five interface languages', async () => {
	const component = render(LanguageSwitcher);
	const reasoning = render(ReasoningControls, {
		id: 'locale-reasoning',
		endpoint: 'https://api.openai.com/v1/chat/completions',
		model: 'gpt-5.4-mini',
		mode: 'auto'
	});
	const select = component.container.querySelector('select')!;
	expect([...select.options].map((option) => option.value).sort()).toEqual([
		'ar',
		'de',
		'en',
		'es',
		'fr'
	]);
	for (const language of ['ar', 'fr', 'de', 'es', 'en'] as const) {
		select.value = language;
		select.dispatchEvent(new Event('change', { bubbles: true }));
		await tick();
		expect(get(locale)).toBe(language);
		expect(globalState.settings!.persistentUiState.language).toBe(language);
		expect(document.documentElement.lang).toBe(language);
		expect(document.documentElement.dir).toBe(language === 'ar' ? 'rtl' : 'ltr');
		expect(getComputedStyle(select).direction).toBe(language === 'ar' ? 'rtl' : 'ltr');
		expect(reasoning.container.querySelector('label')!.textContent).toBe(
			i18nObject(language).aiVideo.reasoningMode()
		);
	}
	expect(Settings.save).toHaveBeenCalledTimes(5);
});

test('restores a saved Arabic locale and returns to LTR when changed', async () => {
	globalState.settings!.persistentUiState.language = 'ar';
	await tick();
	const component = render(LanguageSwitcher);
	await tick();
	expect(component.container.querySelector('select')!.value).toBe('ar');
	expect(document.documentElement.dir).toBe('rtl');
	globalState.settings!.persistentUiState.language = 'de';
	await tick();
	expect(component.container.querySelector('select')!.value).toBe('de');
	expect(document.documentElement.dir).toBe('ltr');
});

test.each([
	{ language: 'en' as const, reverse: false, key: 'ArrowRight', delta: 40 },
	{ language: 'ar' as const, reverse: false, key: 'ArrowLeft', delta: -40 },
	{ language: 'ar' as const, reverse: true, key: 'ArrowRight', delta: 40 }
])(
	'resizes panels toward their content in $language (reverse: $reverse)',
	async ({ language, reverse, key, delta }) => {
		globalState.settings!.persistentUiState.language = language;
		await tick();
		const component = render(Divider, {
			orientation: 'vertical',
			value: 200,
			min: 100,
			max: 500,
			reverse
		});
		const divider = component.container.querySelector<HTMLElement>('[role="separator"]')!;
		divider.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
		await tick();
		expect(divider.getAttribute('aria-valuenow')).toBe('220');
		divider.dispatchEvent(
			new PointerEvent('pointerdown', { button: 0, clientX: 100, bubbles: true })
		);
		document.dispatchEvent(new PointerEvent('pointermove', { clientX: 100 + delta }));
		document.dispatchEvent(new PointerEvent('pointerup'));
		await tick();
		expect(divider.getAttribute('aria-valuenow')).toBe('260');
	}
);
