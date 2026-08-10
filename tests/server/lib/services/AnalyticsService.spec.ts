import { describe, expect, it, vi } from 'vitest';
import { AnalyticsService } from '$lib/services/AnalyticsService';
import type { UnknownRecord } from '$lib/types/common';
import { setLocale } from '$lib/i18n/i18n-svelte';

const posthogMock = vi.hoisted(() => ({
	init: vi.fn(),
	register: vi.fn(),
	capture: vi.fn()
}));

vi.mock('posthog-js', () => ({ default: posthogMock }));
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$env/dynamic/public', () => ({
	env: {
		PUBLIC_POSTHOG_HOST: 'https://analytics.example.test',
		PUBLIC_POSTHOG_KEY: 'phc_test'
	}
}));
vi.mock('$lib/services/VersionService.svelte', () => ({
	VersionService: { getAppVersion: vi.fn().mockResolvedValue('1.2.3') }
}));

type AnalyticsServiceInternals = {
	sanitizeProperties(properties?: UnknownRecord): UnknownRecord | undefined;
	normalizeAnalyticsModel(model?: string): string;
	handleVisibilityChange: () => void;
	editorSection: 'video' | 'subtitles' | 'translations' | 'style' | 'export' | null;
	editorSectionStartedAt: number;
	capture(eventName: string, properties?: UnknownRecord): void;
	state: 'idle' | 'initializing' | 'ready' | 'disabled' | 'failed';
	terminalVideoExports: Set<string>;
	appInstallationTracked: boolean;
	appUpdateTracked: boolean;
};

describe('AnalyticsService privacy guard', () => {
	it('removes sensitive keys and values while preserving approved structural properties', () => {
		const service = AnalyticsService as unknown as AnalyticsServiceInternals;
		const sanitized = service.sanitizeProperties({
			project_name: 'Private project',
			comment: 'Private comment',
			access_token: 'secret',
			body: 'Private body',
			content_value: 'Private content',
			description: 'Private description',
			prompt: 'Private prompt',
			text: 'Private text',
			title: 'Private title',
			mode: 'advanced_trim',
			choice: 'Each Surah',
			workflow_id: 'f9792602-a5f7-4f02-9a2c-7f07a16d976e',
			long_value: 'x'.repeat(161),
			multiline_value: 'Private first line\nPrivate second line',
			windows_value: 'C:\\Users\\Private\\video.mp4',
			unix_value: '/home/private/video.mp4',
			contact_value: 'person@example.com',
			ai_selects_content: true,
			has_reciter: true,
			subtitle_count: 4,
			subtitles_count: 12,
			url_source_count: 2,
			error_type: 'unexpected',
			nested: {
				url: 'https://example.com/private',
				outcome: 'completed'
			}
		});

		expect(sanitized).toEqual({
			mode: 'advanced_trim',
			choice: 'Each Surah',
			workflow_id: 'f9792602-a5f7-4f02-9a2c-7f07a16d976e',
			ai_selects_content: true,
			has_reciter: true,
			subtitle_count: 4,
			subtitles_count: 12,
			url_source_count: 2,
			error_type: 'unexpected',
			nested: {
				outcome: 'completed'
			}
		});
	});

	it('classifies translation sources without retaining raw edition keys', () => {
		const service = AnalyticsService as unknown as AnalyticsServiceInternals;
		const originalCapture = service.capture;
		const capture = vi.fn();
		service.capture = capture;

		try {
			AnalyticsService.trackTranslationAdded('qdc-translation-123', 'English');
			AnalyticsService.trackTranslationAdded('txt-manual-private-id', 'French');
			AnalyticsService.trackTranslationAdded('private-edition-for-alice', 'English');

			expect(capture).toHaveBeenNthCalledWith(1, 'translation_added', {
				source: 'catalog',
				edition_language: 'en'
			});
			expect(capture).toHaveBeenNthCalledWith(2, 'translation_added', {
				source: 'manual_txt',
				edition_language: 'fr'
			});
			expect(capture).toHaveBeenNthCalledWith(3, 'translation_added', {
				source: 'custom',
				edition_language: 'en'
			});
			expect(service.sanitizeProperties({ edition_key: 'en_sahih' })).toEqual({
				edition_source: 'catalog'
			});
			expect(JSON.stringify(capture.mock.calls)).not.toContain('private-edition-for-alice');
		} finally {
			service.capture = originalCapture;
		}
	});

	it('initializes PostHog with URL safeguards and the active UI locale', async () => {
		const service = AnalyticsService as unknown as AnalyticsServiceInternals;
		const fakeDocument = new EventTarget() as EventTarget & { hidden: boolean };
		Object.defineProperty(fakeDocument, 'hidden', { configurable: true, value: false });
		const fakeWindow: { location: { pathname: string }; top?: unknown } = {
			location: { pathname: '/' }
		};
		fakeWindow.top = fakeWindow;
		vi.stubGlobal('document', fakeDocument);
		vi.stubGlobal('window', fakeWindow);
		posthogMock.init.mockClear();
		posthogMock.register.mockClear();
		posthogMock.capture.mockClear();
		service.state = 'idle';
		setLocale('fr');

		try {
			await AnalyticsService.init();

			expect(posthogMock.init).toHaveBeenCalledWith(
				'phc_test',
				expect.objectContaining({
					save_campaign_params: false,
					save_referrer: false,
					property_denylist: [
						'$current_url',
						'$host',
						'$pathname',
						'$referrer',
						'$referring_domain',
						'$initial_referrer',
						'$initial_referring_domain'
					]
				})
			);
			expect(posthogMock.register).toHaveBeenCalledWith(
				expect.objectContaining({ app_locale: 'fr' })
			);
			setLocale('en');
			service.capture('locale_changed');
			expect(posthogMock.capture).toHaveBeenCalledWith('locale_changed', {
				app_locale: 'en'
			});
		} finally {
			service.state = 'idle';
			setLocale('en');
			vi.unstubAllGlobals();
		}
	});

	it('keeps editable AI model values bounded before capture', () => {
		const service = AnalyticsService as unknown as AnalyticsServiceInternals;
		const originalCapture = service.capture;
		const capture = vi.fn();
		service.capture = capture;

		try {
			expect(service.normalizeAnalyticsModel('gpt-5.4')).toBe('gpt-5.4');
			expect(service.normalizeAnalyticsModel('Base')).toBe('base');
			expect(service.normalizeAnalyticsModel('private model for Alice')).toBe('custom');
			expect(service.normalizeAnalyticsModel(' ')).toBe('unknown');

			const start = {
				feature: 'translation_trim' as const,
				mode: 'advanced_trim',
				model: 'private model for Alice'
			};
			const workflow = AnalyticsService.trackAiStarted(start);
			AnalyticsService.trackAiFinished(workflow, start, {
				outcome: 'failed',
				hadErrors: true
			});

			expect(capture).toHaveBeenNthCalledWith(
				1,
				'ai_translation_started',
				expect.objectContaining({ model: 'custom' })
			);
			expect(capture).toHaveBeenNthCalledWith(
				2,
				'ai_translation_finished',
				expect.objectContaining({ model: 'custom' })
			);
		} finally {
			service.capture = originalCapture;
		}
	});

	it('handles a dispatched visibility event with the class context intact', () => {
		const service = AnalyticsService as unknown as AnalyticsServiceInternals;
		const originalCapture = service.capture;
		const capture = vi.fn();
		const fakeDocument = new EventTarget() as EventTarget & { hidden: boolean };
		Object.defineProperty(fakeDocument, 'hidden', {
			configurable: true,
			value: true,
			writable: true
		});
		vi.stubGlobal('document', fakeDocument);
		service.capture = capture;
		service.editorSection = 'video';
		service.editorSectionStartedAt = Date.now() - 50;
		fakeDocument.addEventListener('visibilitychange', service.handleVisibilityChange);

		try {
			fakeDocument.dispatchEvent(new Event('visibilitychange'));
			expect(capture).toHaveBeenCalledWith(
				'editor_section_viewed',
				expect.objectContaining({
					section: 'video',
					timing_segment: 'foreground',
					segment_end: 'backgrounded'
				})
			);
			expect(service.editorSectionStartedAt).toBe(0);

			fakeDocument.hidden = false;
			fakeDocument.dispatchEvent(new Event('visibilitychange'));
			expect(service.editorSectionStartedAt).toBeGreaterThan(0);
		} finally {
			fakeDocument.removeEventListener('visibilitychange', service.handleVisibilityChange);
			service.capture = originalCapture;
			service.editorSection = null;
			service.editorSectionStartedAt = 0;
			vi.unstubAllGlobals();
		}
	});

	it('derives subtitle export aggregates without capturing target names', () => {
		const service = AnalyticsService as unknown as AnalyticsServiceInternals;
		const originalCapture = service.capture;
		const capture = vi.fn();
		service.capture = capture;

		try {
			AnalyticsService.trackSubtitlesExport(
				'SRT',
				['arabic', 'Private translation by Alice'],
				{ arabic: true, 'Private translation by Alice': false },
				12
			);

			expect(capture).toHaveBeenCalledWith('subtitles_exported', {
				format: 'SRT',
				included_target_count: 2,
				translation_target_count: 1,
				includes_arabic: true,
				arabic_verse_numbers: true,
				translation_verse_numbers_count: 0,
				subtitles_count: 12
			});
			expect(JSON.stringify(capture.mock.calls)).not.toContain('Alice');
		} finally {
			service.capture = originalCapture;
		}
	});

	it('emits installation and update transitions only once per process', () => {
		const service = AnalyticsService as unknown as AnalyticsServiceInternals;
		const originalCapture = service.capture;
		const capture = vi.fn();
		service.capture = capture;
		service.appInstallationTracked = false;
		service.appUpdateTracked = false;

		try {
			AnalyticsService.trackAppInstalled('1.2.3');
			AnalyticsService.trackAppInstalled('1.2.3');
			AnalyticsService.trackAppUpdated('1.2.2', '1.2.3');
			AnalyticsService.trackAppUpdated('1.2.2', '1.2.3');

			expect(capture.mock.calls).toEqual([
				['app_installed', { app_version: '1.2.3' }],
				['app_updated', { from_version: '1.2.2', to_version: '1.2.3' }]
			]);
		} finally {
			service.capture = originalCapture;
			service.appInstallationTracked = false;
			service.appUpdateTracked = false;
		}
	});

	it('reports bookmark and session-end outcomes with stable dimensions', () => {
		const service = AnalyticsService as unknown as AnalyticsServiceInternals;
		const originalCapture = service.capture;
		const capture = vi.fn();
		service.capture = capture;

		try {
			AnalyticsService.trackQuranBookmarkChanged('add', 1, 2);
			AnalyticsService.trackQuranBookmarkChanged('remove', 0, 1);
			AnalyticsService.trackQuranAuthDisconnected(3, 'session_expired');

			expect(capture).toHaveBeenNthCalledWith(1, 'quran_bookmark_changed', {
				action: 'add',
				outcome: 'partial',
				change_count: 1,
				failed_count: 2
			});
			expect(capture).toHaveBeenNthCalledWith(2, 'quran_bookmark_changed', {
				action: 'remove',
				outcome: 'failed',
				change_count: 0,
				failed_count: 1
			});
			expect(capture).toHaveBeenNthCalledWith(3, 'quran_auth_disconnected', {
				scope_count: 3,
				reason: 'session_expired'
			});
		} finally {
			service.capture = originalCapture;
		}
	});

	it('deduplicates terminal video export outcomes with a deterministic insert id', () => {
		const service = AnalyticsService as unknown as AnalyticsServiceInternals;
		const originalCapture = service.capture;
		const capture = vi.fn();
		service.capture = capture;
		service.terminalVideoExports.clear();

		try {
			AnalyticsService.trackVideoExportFinished('workflow-1', 'completed', 1500, {
				format: 'mp4'
			});
			AnalyticsService.trackVideoExportFinished('workflow-1', 'failed', 1600, {
				failureStage: 'finalizing'
			});

			expect(capture).toHaveBeenCalledTimes(1);
			expect(capture).toHaveBeenCalledWith(
				'video_exported',
				expect.objectContaining({
					workflow_id: 'workflow-1',
					$insert_id: 'video-export:workflow-1:completed',
					outcome: 'completed',
					duration_ms: 1500,
					format: 'mp4'
				})
			);
		} finally {
			service.capture = originalCapture;
			service.terminalVideoExports.clear();
		}
	});
});
