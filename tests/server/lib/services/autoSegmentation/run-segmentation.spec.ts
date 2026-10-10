import { describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import toast from 'svelte-5-french-toast';
import type { Project } from '$lib/classes/Project';
import LL, { setLocale } from '$lib/i18n/i18n-svelte';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { get } from 'svelte/store';
import { applySegmentationResponseToProject } from '$lib/services/autoSegmentation/apply-segmentation';

import {
	resolveIncludeWbwTimestamps,
	runAutoSegmentation,
	runAutoSegmentationForProject
} from '$lib/services/autoSegmentation/run-segmentation';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('svelte-5-french-toast', () => ({ default: vi.fn() }));
vi.mock('$lib/services/autoSegmentation/audio', () => ({
	getAutoSegmentationAudioInfo: () => ({
		filePath: 'audio.mp3',
		fileName: 'audio.mp3',
		clipCount: 1
	}),
	getAutoSegmentationAudioClips: () => [
		{ filePath: 'audio.mp3', startMs: 0, endMs: 1000, sourceStartMs: 0 }
	]
}));
vi.mock('$lib/services/autoSegmentation/audio-normalize.svelte', () => ({
	normalizeAudioForProject: vi.fn()
}));
vi.mock('$lib/services/autoSegmentation/apply-segmentation', () => ({
	applySegmentationResponseToProject: vi.fn()
}));

/**
 * `shouldRetryCloudOnCpu` et `resolveContextModelName` sont des fonctions privées
 * dans run-segmentation.ts. Leurs comportements sont validés via le flow
 * d'intégration et les tests manuels.
 */
describe('runAutoSegmentation exports', () => {
	it.each(['en', 'fr', 'ar', 'de', 'es', 'id', 'zh'] as const)(
		'provides the invalid cloud token warning in %s',
		(locale) => {
			loadLocale(locale);
			setLocale(locale);
			const warning = Reflect.get(
				get(LL).settings,
				'huggingFaceInvalidTokenFallback'
			) as () => string;
			expect(warning()).toContain('Hugging');
			setLocale('en');
		}
	);

	it.each([
		{ configured: true, valid: false, warns: true },
		{ configured: true, valid: true, warns: false },
		{ configured: false, valid: false, warns: false },
		{ error: true, warns: false }
	])('checks the cloud token before segmentation: %j', async (status) => {
		vi.resetAllMocks();
		loadLocale('en');
		setLocale('en');
		const project = {
			content: { timeline: { getFirstTrack: () => ({ clips: [] }) } }
		} as unknown as Project;
		if ('error' in status)
			vi.mocked(invoke).mockRejectedValueOnce(new Error('Network unavailable'));
		else vi.mocked(invoke).mockResolvedValueOnce(status);
		vi.mocked(invoke).mockResolvedValueOnce({ segments: [] });
		vi.mocked(applySegmentationResponseToProject).mockResolvedValueOnce({ status: 'cancelled' });
		await runAutoSegmentationForProject(project, { includeWbwTimestamps: true }, 'api', {
			headless: true
		});
		expect(invoke).toHaveBeenNthCalledWith(1, 'hugging_face_account_status');
		expect(invoke).toHaveBeenNthCalledWith(2, 'segment_quran_audio', expect.any(Object));
		expect(toast).toHaveBeenCalledTimes(status.warns ? 1 : 0);
		if (status.warns) {
			expect(toast).toHaveBeenCalledWith(
				expect.stringContaining('Regenerate'),
				expect.objectContaining({ icon: '⚠️' })
			);
		}
	});

	it('is a function', () => {
		expect(typeof runAutoSegmentation).toBe('function');
	});

	it('forces WBW timestamps when existing subtitles are aligned', () => {
		expect(resolveIncludeWbwTimestamps(false, 'align')).toBe(true);
		expect(resolveIncludeWbwTimestamps(false, 'replace')).toBe(false);
	});

	it.each(['quran_word_timing', 'quran_word_timing_old'] as const)(
		'routes %s to its own local command and keeps native word timings',
		async (localAsrMode) => {
			vi.clearAllMocks();
			const project = {
				content: { timeline: { getFirstTrack: () => ({ clips: [] }) } }
			} as unknown as Project;
			const response = {
				device: 'CPU',
				segments: [
					{
						time_from: 0,
						time_to: 1,
						ref_from: '1:2:1',
						ref_to: '1:2:1',
						words: [{ location: '1:2:1', start: 0, end: 1 }]
					}
				]
			};
			vi.mocked(invoke).mockResolvedValueOnce(response);
			vi.mocked(applySegmentationResponseToProject).mockResolvedValueOnce({ status: 'cancelled' });
			await runAutoSegmentationForProject(
				project,
				{ localAsrMode, includeWbwTimestamps: true },
				'local',
				{ headless: true }
			);
			expect(invoke).toHaveBeenCalledExactlyOnceWith(
				localAsrMode === 'quran_word_timing_old'
					? 'segment_quran_audio_local_word_timing_old'
					: 'segment_quran_audio_local_word_timing',
				expect.objectContaining({
					audioClips: [{ path: 'audio.mp3', startMs: 0, endMs: 1000, sourceStartMs: 0 }]
				})
			);
			expect(applySegmentationResponseToProject).toHaveBeenCalledWith(
				expect.objectContaining({ response, device: 'CPU', includeWbwTimestamps: true })
			);
		}
	);

	it.each(['en', 'fr', 'ar', 'de', 'es', 'id', 'zh'] as const)(
		'provides translated old aligner labels and setup information in %s',
		(locale) => {
			loadLocale(locale);
			setLocale(locale);
			expect(get(LL).editor.quranwordtimingOldLabel()).not.toBe(
				get(LL).editor.quranwordtimingLabel()
			);
			expect(get(LL).editor.quranwordtimingOldDetail()).toContain('QC-3.7.60');
			expect(get(LL).editor.quranwordtimingOldDownloadSizeHint()).toContain('87');
			setLocale('en');
		}
	);

	it.each(['en', 'ar'] as const)('localizes native crash diagnostics in %s', async (locale) => {
		loadLocale(locale);
		setLocale(locale);
		const project = {
			content: { timeline: { getFirstTrack: () => ({ clips: [] }) } }
		} as unknown as Project;
		for (const details of ['', 'Windows fatal exception: access violation']) {
			vi.mocked(invoke).mockRejectedValueOnce(
				JSON.stringify({ localSegmentationExitStatus: '-1073741819 (0xC0000005)', details })
			);
			const result = await runAutoSegmentationForProject(
				project,
				{ localAsrMode: 'quran_word_timing' },
				'local',
				{ headless: true }
			);
			expect(result).toEqual({
				status: 'failed',
				message: `${get(LL).editor.segmentationFailed()} [-1073741819 (0xC0000005)]${details ? `\n${details}` : ''}`
			});
		}
		setLocale('en');
	});
});
