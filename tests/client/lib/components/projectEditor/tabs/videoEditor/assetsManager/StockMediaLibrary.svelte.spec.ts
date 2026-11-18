import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import StockMediaLibrary from '$lib/components/projectEditor/tabs/videoEditor/assetsManager/StockMediaLibrary.svelte';
import type { StockMediaSource } from '$lib/components/projectEditor/tabs/videoEditor/assetsManager/stockMediaTypes';
import Settings from '$lib/classes/Settings.svelte';
import { globalState } from '$lib/runes/main.svelte';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';

vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tauri-apps/api/core')>()),
	invoke: vi.fn()
}));

const originalSettings = globalState.settings;
const originalLibrary = globalState.stockMediaLibrary;

afterEach(() => {
	cleanup();
	globalState.settings = originalSettings;
	globalState.stockMediaLibrary = originalLibrary;
	vi.resetAllMocks();
});

it.each<StockMediaSource>(['pinterest', 'pixabay', 'pexels'])(
	'fills consecutive batches and reuses cached %s pages after changing filters',
	async (source) => {
		loadLocale('en');
		setLocale('en');
		const settings = new Settings();
		settings.stockMediaSettings = { pexelsApiKey: 'test', pixabayApiKey: 'test' };
		globalState.settings = settings;
		globalState.stockMediaLibrary = {
			...originalLibrary,
			source,
			mediaType: 'video',
			libraryOpen: true,
			searchQuery: ''
		};
		let releaseSecondPage!: () => void;
		const secondPage = new Promise<void>((resolve) => {
			releaseSecondPage = resolve;
		});
		vi.mocked(invoke).mockImplementation(async (_command, args) => {
			const page = Number(args && 'page' in args ? args.page : 0);
			if (page === 2) await secondPage;
			return {
				results: Array.from({ length: page === 3 ? 5 : 30 }, (_, index) => ({
					id: `${page}-${index}`,
					source,
					type: 'video',
					width: page === 1 && index >= 23 ? 640 : 1080,
					height: page === 1 && index >= 10 && index < 16 ? 720 : 1920,
					duration: page === 1 && index >= 16 && index < 23 ? 10 : 20
				})),
				hasMore: page < 3,
				pinterestBookmarks: source === 'pinterest' && page < 3 ? [null, `after-${page}`] : undefined
			};
		});

		const component = render(StockMediaLibrary, { onBack: vi.fn() });
		const library = globalState.stockMediaLibrary;
		await expect.poll(() => library.results.length).toBe(30);
		await component.getByRole('combobox', { name: 'Orientation' }).selectOptions('portrait');
		await expect.poll(() => library.results.length).toBe(24);
		expect(library.isLoading).toBe(true);
		releaseSecondPage();
		await expect.poll(() => library.results.at(-1)?.id).toBe('2-5');
		await component.getByRole('combobox', { name: 'Duration' }).selectOptions('medium');
		await expect.poll(() => library.results.at(-1)?.id).toBe('2-12');
		await component.getByRole('combobox', { name: 'Resolution' }).selectOptions('1080');
		await expect.poll(() => library.results.at(-1)?.id).toBe('2-19');
		expect(invoke).toHaveBeenCalledTimes(2);

		const list = component
			.getByRole('searchbox')
			.element()
			.closest<HTMLElement>('.overflow-y-auto')!;
		list.style.maxHeight = '240px';
		list.style.overflowY = 'auto';
		list.scrollTop = list.scrollHeight;
		list.dispatchEvent(new Event('scroll'));
		await expect.poll(() => library.results.length).toBe(45);
		expect(library.results[30].id).toBe('2-20');
		expect(library.hasMore).toBe(false);
		await expect
			.element(component.getByText("You've reached the end of the results."))
			.toBeVisible();
		expect(invoke).toHaveBeenLastCalledWith(
			'search_stock_media',
			expect.objectContaining({
				source,
				page: 3,
				pinterestBookmarks: source === 'pinterest' ? [null, 'after-2'] : undefined
			})
		);
	}
);
