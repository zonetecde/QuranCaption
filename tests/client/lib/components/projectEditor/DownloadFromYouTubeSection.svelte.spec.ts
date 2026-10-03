import { cleanup, render } from 'vitest-browser-svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	listen: vi.fn(),
	getAssetFolderForProject: vi.fn(),
	addAsset: vi.fn(),
	sections: {}
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));
vi.mock('$lib/classes', () => ({ SourceType: { YouTube: 'youtube' } }));
vi.mock('$lib/services/ProjectService', () => ({
	ProjectService: { getAssetFolderForProject: mocks.getAssetFolderForProject }
}));
vi.mock('$lib/runes/main.svelte', () => ({
	globalState: {
		currentProject: { detail: { id: 7 }, content: { addAsset: mocks.addAsset } },
		getSectionsState: mocks.sections
	}
}));

import DownloadFromYouTubeSection from '$lib/components/projectEditor/tabs/videoEditor/assetsManager/DownloadFromYouTubeSection.svelte';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';

describe('DownloadFromYouTubeSection', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		loadLocale('en');
		setLocale('en');
		mocks.listen.mockResolvedValue(() => {});
		mocks.getAssetFolderForProject.mockResolvedValue('C:/project/assets');
		mocks.invoke.mockResolvedValue('C:/project/assets/clip.mp3');
	});

	afterEach(cleanup);

	test('starts collapsed and keeps the default audio settings and project folder', async () => {
		const component = render(DownloadFromYouTubeSection);
		expect(component.container.querySelector('details')?.open).toBe(false);
		await component.getByPlaceholder('Paste a public media URL').fill('https://example.com/video');
		await component.getByRole('button', { name: 'Download from Link' }).click();
		await vi.waitFor(() => expect(mocks.addAsset).toHaveBeenCalledOnce());
		expect(mocks.getAssetFolderForProject).toHaveBeenCalledWith(7);
		expect(mocks.invoke).toHaveBeenCalledWith(
			'download_from_youtube',
			expect.objectContaining({
				type: 'audio',
				downloadPath: 'C:/project/assets',
				options: {
					startTime: undefined,
					endTime: undefined,
					audioBitrate: undefined,
					maxHeight: undefined,
					preciseCuts: false
				}
			})
		);
	});

	test('converts timestamps and preserves the selected audio bitrate for redownloading', async () => {
		const component = render(DownloadFromYouTubeSection);
		await component.getByPlaceholder('Paste a public media URL').fill('https://example.com/video');
		await component.getByText('Advanced options', { exact: true }).click();
		await component.getByRole('textbox', { name: 'Start Time' }).fill('01:02.5');
		await component.getByRole('textbox', { name: 'End Time' }).fill('01:05');
		await component.getByRole('combobox', { name: 'Quality' }).selectOptions('128');
		await component.getByRole('button', { name: 'Download from Link' }).click();
		await vi.waitFor(() => expect(mocks.addAsset).toHaveBeenCalledOnce());
		const options = {
			startTime: 62.5,
			endTime: 65,
			audioBitrate: 128,
			maxHeight: undefined,
			preciseCuts: false
		};
		expect(mocks.invoke).toHaveBeenCalledWith(
			'download_from_youtube',
			expect.objectContaining({ options })
		);
		expect(mocks.addAsset).toHaveBeenCalledWith(
			'C:/project/assets/clip.mp3',
			'https://example.com/video',
			'youtube',
			{
				youtubeDownloadType: 'audio',
				youtubeDownloadOptions: options
			}
		);
	});

	test('supports an open-ended video excerpt, a resolution cap, no audio and cleaner cuts', async () => {
		const component = render(DownloadFromYouTubeSection);
		await component.getByPlaceholder('Paste a public media URL').fill('https://example.com/video');
		await component.getByRole('radio', { name: 'Video & Audio' }).click();
		await component.getByText('Advanced options', { exact: true }).click();
		await component.getByRole('textbox', { name: 'Start Time' }).fill('1:00:00.25');
		await component.getByRole('combobox', { name: 'Quality' }).selectOptions('720');
		await component.getByRole('checkbox', { name: 'Video Only' }).click();
		await component.getByRole('checkbox', { name: /Cleaner video cuts/ }).click();
		await component.getByRole('button', { name: 'Download from Link' }).click();
		await vi.waitFor(() => expect(mocks.addAsset).toHaveBeenCalledOnce());
		expect(mocks.invoke).toHaveBeenCalledWith(
			'download_from_youtube',
			expect.objectContaining({
				type: 'video_no_audio',
				options: {
					startTime: 3600.25,
					endTime: undefined,
					audioBitrate: undefined,
					maxHeight: 720,
					preciseCuts: true
				}
			})
		);
	});

	test.each([
		['-1', '10'],
		['abc', '10'],
		['1:60', '120'],
		['1:60:00', '8000'],
		['10', '10'],
		['11', '10'],
		['', '0']
	])('rejects an invalid range %s–%s before starting a download', async (start, end) => {
		const component = render(DownloadFromYouTubeSection);
		await component.getByPlaceholder('Paste a public media URL').fill('https://example.com/video');
		await component.getByText('Advanced options', { exact: true }).click();
		await component.getByRole('textbox', { name: 'Start Time' }).fill(start);
		await component.getByRole('textbox', { name: 'End Time' }).fill(end);
		await component.getByRole('button', { name: 'Download from Link' }).click();
		await expect.element(component.getByText(/Check the download settings/)).toBeVisible();
		expect(mocks.invoke).not.toHaveBeenCalled();
		expect(mocks.getAssetFolderForProject).not.toHaveBeenCalled();
	});

	test('allows only an end time and ignores video options when switched back to audio', async () => {
		const component = render(DownloadFromYouTubeSection);
		await component.getByPlaceholder('Paste a public media URL').fill('https://example.com/video');
		await component.getByRole('radio', { name: 'Video & Audio' }).click();
		await component.getByText('Advanced options', { exact: true }).click();
		await component.getByRole('textbox', { name: 'End Time' }).fill('15.25');
		await component.getByRole('combobox', { name: 'Quality' }).selectOptions('480');
		await component.getByRole('checkbox', { name: /Cleaner video cuts/ }).click();
		await component.getByRole('radio', { name: 'Audio Only' }).click();
		await component.getByRole('button', { name: 'Download from Link' }).click();
		await vi.waitFor(() => expect(mocks.addAsset).toHaveBeenCalledOnce());
		expect(mocks.invoke).toHaveBeenCalledWith(
			'download_from_youtube',
			expect.objectContaining({
				type: 'audio',
				options: {
					startTime: undefined,
					endTime: 15.25,
					audioBitrate: undefined,
					maxHeight: undefined,
					preciseCuts: false
				}
			})
		);
	});
});
