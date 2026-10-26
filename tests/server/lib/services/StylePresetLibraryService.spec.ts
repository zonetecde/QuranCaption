import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	getCommunityPresetStyle,
	getPopularTags,
	likeCommunityPreset,
	listCommunityPresets,
	publishCommunityPreset
} from '$lib/services/StylePresetLibraryService';

vi.mock('$env/dynamic/public', () => ({
	env: { PUBLIC_STYLE_LIBRARY_API_BASE_URL: 'https://styles.example.test/' }
}));
vi.mock('$lib/classes/Settings.svelte', () => ({ default: class {} }));
vi.mock('$lib/runes/main.svelte', () => ({ globalState: {} }));

const fetchMock = vi.fn();
const baseUrl = 'https://styles.example.test/products/minbar-studio';

beforeEach(() => {
	fetchMock.mockReset();
	fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('Minbar community style library', () => {
	it('lists and filters only the Minbar library and tags', async () => {
		await listCommunityPresets({ search: ' sermon ', tag: ' clean ', orientation: 'portrait' });
		const url = fetchMock.mock.calls[0][0] as URL;
		expect(url.origin + url.pathname).toBe(`${baseUrl}/presets`);
		expect(Object.fromEntries(url.searchParams)).toEqual({
			search: 'sermon',
			tag: 'clean',
			orientation: 'portrait',
			limit: '100',
			offset: '0'
		});
		await getPopularTags();
		expect(String(fetchMock.mock.calls[1][0])).toBe(`${baseUrl}/tags/popular?limit=24`);
	});

	it('downloads styles and sends likes through the Minbar endpoints', async () => {
		await getCommunityPresetStyle('preset/id');
		expect(String(fetchMock.mock.calls[0][0])).toBe(`${baseUrl}/presets/preset%2Fid/style`);
		await likeCommunityPreset('preset/id', 'device');
		expect(String(fetchMock.mock.calls[1][0])).toBe(`${baseUrl}/presets/preset%2Fid/like`);
		expect(fetchMock.mock.calls[1][1]).toEqual({
			method: 'POST',
			headers: { 'X-Style-Library-Device-Id': 'device' }
		});
	});

	it('publishes a marked Minbar payload without mutating the exported style', async () => {
		const style = {
			videoStyle: {
				styles: ['global', 'arabic', 'arabic-quran', 'arabic-citation'].map((target) => ({
					target,
					categories: []
				}))
			},
			customClips: []
		};
		await publishCommunityPreset({
			name: 'Sermon',
			authorName: 'Author',
			resolution: { width: 1920, height: 1080 },
			style,
			preview: new Blob(['preview'], { type: 'image/jpeg' })
		});
		expect(String(fetchMock.mock.calls[0][0])).toBe(`${baseUrl}/presets`);
		const request = fetchMock.mock.calls[0][1] as RequestInit;
		expect(request.method).toBe('POST');
		const form = request.body as FormData;
		expect(JSON.parse(await (form.get('style') as Blob).text())).toEqual({
			...style,
			product: 'minbar-studio',
			schemaVersion: 1
		});
		expect(style).not.toHaveProperty('product');
		expect(form.get('name')).toBe('Sermon');
	});
});
