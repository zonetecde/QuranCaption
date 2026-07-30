import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getVersionMock } = vi.hoisted(() => ({ getVersionMock: vi.fn() }));

vi.mock('@tauri-apps/api/app', () => ({ getVersion: getVersionMock }));

import { VersionService } from '$lib/services/VersionService.svelte';

describe('VersionService Android updates', () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
		vi.clearAllMocks();
		getVersionMock.mockResolvedValue('1.0.0');
	});

	it('detects the highest QCM release, including GitHub prereleases', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify([
						{ tag_name: 'QC-9.0.0', body: 'Desktop' },
						{
							tag_name: 'QCM-1.0.1',
							prerelease: true,
							body: 'Android changes',
							html_url: 'https://github.com/zonetecde/QuranCaption/releases/tag/QCM-1.0.1'
						}
					])
				)
			)
		);

		await expect(VersionService.checkForUpdates()).resolves.toEqual({
			hasUpdate: true,
			changelog: '## QCM-1.0.1\n\nAndroid changes',
			latestVersion: '1.0.1',
			releaseUrl: 'https://github.com/zonetecde/QuranCaption/releases/tag/QCM-1.0.1'
		});
	});

	it('ignores desktop and draft Android releases', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify([
						{ tag_name: 'QC-2.0.0', body: 'Desktop' },
						{ tag_name: 'QCM-1.0.1', draft: true, body: 'Draft' }
					])
				)
			)
		);

		await expect(VersionService.checkForUpdates()).resolves.toMatchObject({
			hasUpdate: false
		});
	});
});
