import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { tick } from 'svelte';

import DownloadFromQuranicUniversalAudioSection from '$lib/components/projectEditor/tabs/videoEditor/assetsManager/DownloadFromQuranicUniversalAudioSection.svelte';
import { Quran, Surah } from '$lib/classes/Quran';

// Hoisted mock state (vi.mock factories run before module-level vars are initialized).
const { invoke, openUrl } = vi.hoisted(() => {
	const RECITATIONS = [
		{
			slug: 'abdul_basit_hafs_mujawwad',
			label: 'Abdul Basit · Hafs · Mujawwad',
			reciter: { reciter_id: 'abdul_basit', name_en: 'Abdul Basit', name_ar: 'عبد الباسط' },
			riwayah: 'Hafs',
			style: 'Mujawwad',
			channel: '',
			source: 'mp3quran',
			chapters: [1, 2]
		}
	];
	return {
		invoke: vi.fn(async (cmd: string) => {
			if (cmd === 'preload_recitations') return { recitations: RECITATIONS };
			return {};
		}),
		openUrl: vi.fn()
	};
});

// Toasts are side effects; stub them out.
vi.mock('svelte-5-french-toast', () => ({
	default: { error: vi.fn(), loading: vi.fn(), success: vi.fn() }
}));
// External-link opener (only fires on click); keep the rest of the module intact.
vi.mock('@tauri-apps/plugin-opener', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@tauri-apps/plugin-opener')>();
	return { ...actual, openUrl };
});
// Tauri command bridge: override only `invoke` (keep convertFileSrc & co. for the module graph).
vi.mock('@tauri-apps/api/core', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@tauri-apps/api/core')>();
	return { ...actual, invoke };
});

describe('DownloadFromQuranicUniversalAudioSection', () => {
	beforeEach(() => {
		// Pré-charge le Quran pour que Quran.load() soit un no-op déterministe.
		Quran.surahs = [
			new Surah(1, 'الفاتحة', 'Al-Fatihah', 'The Opener', 7, 'سورة الفاتحة', 'Mecca'),
			new Surah(2, 'البقرة', 'Al-Baqarah', 'The Cow', 286, 'سورة البقرة', 'Medina')
		];
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
		Quran.surahs = [];
	});

	test('renders the callout, contribute link and recitation catalog', async () => {
		const component = render(DownloadFromQuranicUniversalAudioSection);

		await expect
			.element(
				component.getByText('Human reviewed pre-computed segments with wbw timestamps.', {
					exact: false
				})
			)
			.toBeVisible();
		await expect.element(component.getByText('Help contribute more reciters')).toBeVisible();

		// The recitation option renders the same label as the aligner UI.
		const recitationSelect = component.container.querySelector(
			'#qua-recitation-select'
		) as HTMLSelectElement;
		await vi.waitFor(() => {
			expect(recitationSelect.querySelectorAll('option').length).toBeGreaterThan(1);
		});
		expect(recitationSelect.textContent).toContain('Abdul Basit · Hafs · Mujawwad');
		expect(invoke).toHaveBeenCalledWith('preload_recitations');
	});

	test('enabling a recitation + surah defaults the Ayah range to 1 → last verse', async () => {
		const component = render(DownloadFromQuranicUniversalAudioSection);

		const recitationSelect = component.container.querySelector(
			'#qua-recitation-select'
		) as HTMLSelectElement;
		const surahSelect = component.container.querySelector('#qua-surah-select') as HTMLSelectElement;
		const ayahFrom = component.container.querySelector('#qua-ayah-from') as HTMLInputElement;
		const ayahTo = component.container.querySelector('#qua-ayah-to') as HTMLInputElement;

		// Surah + Ayah controls start disabled until a recitation is picked.
		expect(surahSelect.disabled).toBe(true);
		expect(ayahFrom.disabled).toBe(true);

		await vi.waitFor(() => {
			expect(recitationSelect.querySelectorAll('option').length).toBeGreaterThan(1);
		});

		recitationSelect.value = 'abdul_basit_hafs_mujawwad';
		recitationSelect.dispatchEvent(new Event('change', { bubbles: true }));
		await tick();

		expect(surahSelect.disabled).toBe(false);
		// Only the recitation's available chapters (1, 2) are offered + the placeholder.
		expect(surahSelect.querySelectorAll('option').length).toBe(3);

		surahSelect.value = '2';
		surahSelect.dispatchEvent(new Event('change', { bubbles: true }));
		await tick();

		expect(ayahFrom.disabled).toBe(false);
		expect(ayahFrom.value).toBe('1');
		expect(ayahTo.value).toBe('286'); // Al-Baqarah has 286 verses.
	});
});
