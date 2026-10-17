import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { tick } from 'svelte';

import DownloadFromQuranicUniversalAudioSection from '$lib/components/projectEditor/tabs/videoEditor/assetsManager/DownloadFromQuranicUniversalAudioSection.svelte';
import { Quran, Surah } from '$lib/classes/Quran';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';
import {
	QuranicUniversalAudioService,
	type QuaRecitation
} from '$lib/services/QuranicUniversalAudioService';

// Hoisted mock state (vi.mock factories run before module-level vars are initialized).
const { invoke, openUrl } = vi.hoisted(() => {
	const RECITATIONS = [
		{
			slug: 'abdul_basit_hafs_mujawwad',
			label: 'Abdul Basit · Hafs · Mujawwad',
			speaker: { speaker_id: 'abdul_basit', name_en: 'Abdul Basit', name_ar: 'عبد الباسط' },
			riwayah: 'Hafs',
			style: 'Mujawwad',
			channel: '',
			source: 'mp3quran',
			chapters: [1, 2]
		}
	];
	// Audio-only catalog — distinct (non-published) speaker, mutually exclusive
	// with the published RECITATIONS above.
	const AUDIO_RECITATIONS = [
		{
			slug: 'unpublished_speaker_yt',
			label: 'Unpublished Speaker · Hafs · Murattal',
			speaker: { speaker_id: 'unpublished', name_en: 'Unpublished Speaker', name_ar: '' },
			riwayah: 'Hafs',
			style: 'Murattal',
			channel: 'YouTube',
			source: 'youtube',
			chapters: [1, 2]
		}
	];
	return {
		invoke: vi.fn(async (cmd: string) => {
			if (cmd === 'preload_recitations') return { recitations: RECITATIONS };
			if (cmd === 'preload_audio_recitations') return { recitations: AUDIO_RECITATIONS };
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
		// Initialise l'i18n en anglais pour que get(LL).editor.* résolve le texte.
		loadLocale('en');
		setLocale('en');
		// Isole l'interface du cache disque et du catalogue embarqué.
		vi.spyOn(QuranicUniversalAudioService, 'getRecitations').mockImplementation(
			async () =>
				((await invoke('preload_recitations')) as { recitations: QuaRecitation[] }).recitations
		);
		vi.spyOn(QuranicUniversalAudioService, 'getAudioRecitations').mockImplementation(
			async () =>
				((await invoke('preload_audio_recitations')) as { recitations: QuaRecitation[] })
					.recitations
		);
		// Pré-charge le Quran pour que Quran.load() soit un no-op déterministe.
		Quran.surahs = [
			new Surah(1, 'الفاتحة', 'Al-Fatihah', 'The Opener', 7, 'سورة الفاتحة', 'Mecca'),
			new Surah(2, 'البقرة', 'Al-Baqarah', 'The Cow', 286, 'سورة البقرة', 'Medina')
		];
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
		vi.restoreAllMocks();
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
		await expect.element(component.getByText('Help contribute more speakers')).toBeVisible();

		await component.getByRole('textbox', { name: 'Recitation' }).click();
		await expect
			.element(component.getByRole('button', { name: 'Abdul Basit · Hafs · Mujawwad' }))
			.toBeVisible();
		expect(invoke).toHaveBeenCalledWith('preload_recitations');
	});

	test('enabling a recitation + surah defaults the Ayah range to 1 → last verse', async () => {
		const component = render(DownloadFromQuranicUniversalAudioSection);

		const surahSelect = component.container.querySelector('#qua-surah-select') as HTMLInputElement;
		const ayahFrom = component.container.querySelector('#qua-ayah-from') as HTMLInputElement;
		const ayahTo = component.container.querySelector('#qua-ayah-to') as HTMLInputElement;
		expect(surahSelect.disabled).toBe(true);
		expect(ayahFrom.disabled).toBe(true);
		await component.getByRole('textbox', { name: 'Recitation' }).click();
		await component.getByRole('button', { name: 'Abdul Basit · Hafs · Mujawwad' }).click();
		expect(surahSelect.disabled).toBe(false);
		await component.getByRole('textbox', { name: 'Surah', exact: true }).click();
		await component.getByRole('button', { name: /^2\. / }).click();
		await tick();

		expect(ayahFrom.disabled).toBe(false);
		expect(ayahFrom.value).toBe('1');
		expect(ayahTo.value).toBe('286'); // Al-Baqarah has 286 verses.
	});

	test('switching to Audio only loads the audio catalog and hides the Ayah range', async () => {
		const component = render(DownloadFromQuranicUniversalAudioSection);

		expect(component.container.querySelector('#qua-ayah-from')).not.toBeNull();
		await component.getByRole('textbox', { name: 'Recitation' }).click();
		await expect
			.element(component.getByRole('button', { name: 'Abdul Basit · Hafs · Mujawwad' }))
			.toBeVisible();
		await component.getByRole('button', { name: 'Audio only' }).click();
		await component.getByRole('textbox', { name: 'Recitation' }).click();
		await expect
			.element(component.getByRole('button', { name: 'Unpublished Speaker · Hafs · Murattal' }))
			.toBeVisible();
		expect(component.container.textContent).not.toContain('Abdul Basit');
		expect(invoke).toHaveBeenCalledWith('preload_audio_recitations');

		// Ayah range + segments callout are hidden; audio-only callout shows.
		expect(component.container.querySelector('#qua-ayah-from')).toBeNull();
		expect(component.container.querySelector('#qua-ayah-to')).toBeNull();
		await expect
			.element(component.getByText('Download audio for 1000+ speakers', { exact: false }))
			.toBeVisible();
	});
});
