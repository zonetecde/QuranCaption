import { beforeEach, describe, expect, test, vi } from 'vitest';
import posthog from 'posthog-js';

vi.mock('posthog-js', () => ({
	default: { init: vi.fn(), register: vi.fn(), capture: vi.fn() }
}));
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$env/dynamic/public', () => ({
	env: { PUBLIC_POSTHOG_KEY: 'phc_test', PUBLIC_POSTHOG_HOST: 'https://eu.i.posthog.com' }
}));
vi.mock('$lib/services/VersionService.svelte', () => ({
	VersionService: { getAppVersion: vi.fn().mockResolvedValue('1.1.30') }
}));

let AnalyticsService: typeof import('$lib/services/AnalyticsService').AnalyticsService;

beforeEach(async () => {
	vi.resetModules();
	vi.clearAllMocks();
	({ AnalyticsService } = await import('$lib/services/AnalyticsService'));
	await AnalyticsService.init();
});

describe('Minbar Studio analytics', () => {
	test('marks global and queued events as Minbar Studio even if callers override the name', async () => {
		expect(posthog.register).toHaveBeenCalledWith({
			app_name: 'Minbar Studio',
			app_version: '1.1.30'
		});
		vi.resetModules();
		({ AnalyticsService } = await import('$lib/services/AnalyticsService'));
		AnalyticsService.track('project_created', { app_name: 'Quran Caption' });
		await AnalyticsService.init();
		expect(posthog.capture).toHaveBeenCalledWith('project_created', { app_name: 'Minbar Studio' });
	});

	test.each([
		'transcription',
		'transcription_correction',
		'subtitle_rearrangement',
		'reference_detection'
	] as const)(
		'correlates the start and completion of %s without changing its result',
		async (action) => {
			const result = { count: 3 };
			await expect(
				AnalyticsService.trackSubtitleAiRequest(
					action,
					new AbortController().signal,
					async () => result
				)
			).resolves.toBe(result);
			const calls = vi.mocked(posthog.capture).mock.calls;
			expect(calls.map(([event]) => event)).toEqual([
				`ai_${action}_started`,
				`ai_${action}_completed`
			]);
			expect(calls[1][1]).toMatchObject({
				workflow_id: calls[0][1]?.workflow_id,
				app_name: 'Minbar Studio',
				duration_ms: expect.any(Number)
			});
		}
	);

	test('preserves errors without sending their contents', async () => {
		const error = new Error('private transcript');
		await expect(
			AnalyticsService.trackSubtitleAiRequest(
				'transcription',
				new AbortController().signal,
				async () => {
					throw error;
				}
			)
		).rejects.toBe(error);
		expect(vi.mocked(posthog.capture).mock.calls.map(([event]) => event)).toEqual([
			'ai_transcription_started',
			'ai_transcription_failed'
		]);
		expect(JSON.stringify(vi.mocked(posthog.capture).mock.calls)).not.toContain(error.message);
	});

	test('records cancellation immediately and ignores late completion', async () => {
		const controller = new AbortController();
		let resolve!: (value: number) => void;
		const response = new Promise<number>((done) => {
			resolve = done;
		});
		const request = AnalyticsService.trackSubtitleAiRequest(
			'reference_detection',
			controller.signal,
			() => response
		);
		controller.abort();
		expect(vi.mocked(posthog.capture).mock.calls.map(([event]) => event)).toEqual([
			'ai_reference_detection_started',
			'ai_reference_detection_canceled'
		]);
		resolve(2);
		await expect(request).rejects.toMatchObject({ name: 'AbortError' });
		expect(posthog.capture).toHaveBeenCalledTimes(2);
	});

	test('does not start an already canceled request', async () => {
		const controller = new AbortController();
		controller.abort();
		const request = vi.fn();
		await expect(
			AnalyticsService.trackSubtitleAiRequest('transcription', controller.signal, request)
		).rejects.toMatchObject({ name: 'AbortError' });
		expect(request).not.toHaveBeenCalled();
		expect(posthog.capture).not.toHaveBeenCalled();
	});
});
