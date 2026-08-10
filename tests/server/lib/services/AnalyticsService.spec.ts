import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	AnalyticsService,
	isMainAnalyticsSurface,
	reconcileBatchStageTerminalCounts,
	sanitizeAnalyticsProperties,
	type AnalyticsWorkflow
} from '$lib/services/AnalyticsService';
import { setLocale } from '$lib/i18n/i18n-svelte';

type AnalyticsInternals = {
	state: 'idle' | 'initializing' | 'ready' | 'disabled' | 'failed';
	eventQueue: Array<{ eventName: string; properties?: Record<string, unknown> }>;
	appInstallationTracked: boolean;
	appUpdateTracked: boolean;
};

const internals = AnalyticsService as unknown as AnalyticsInternals;

beforeEach(() => {
	internals.state = 'idle';
	internals.eventQueue = [];
	internals.appInstallationTracked = false;
	internals.appUpdateTracked = false;
});

afterEach(() => {
	vi.restoreAllMocks();
	setLocale('en');
	internals.state = 'idle';
	internals.eventQueue = [];
	internals.appInstallationTracked = false;
	internals.appUpdateTracked = false;
});

describe('analytics privacy sanitizer', () => {
	it('removes names, free text, credentials, URLs, paths, email addresses, and raw errors', () => {
		const sanitized = sanitizeAnalyticsProperties({
			project_name: 'Private project',
			ai_selects_content: true,
			context: 'post_export',
			model: 'my private custom model',
			edition_key: 'txt-manual-123456',
			has_custom_reciter: true,
			subtitles_count: 12,
			url_source_count: 2,
			workflow_id: 'workflow-1',
			failure_stage: 'segmentation',
			error_code: 'dependency_install_failed',
			error_message: 'C:\\Users\\private\\audio.mp3 failed',
			comment: 'private review',
			contact: 'reach private@example.com now',
			website: 'prefix https://example.com/private',
			android_file: '/storage/emulated/0/private.mp4',
			content_uri: 'content://media/external/video/1',
			unc_file: '\\\\server\\share\\private.mp4',
			auth_value: 'Bearer secret-secret-secret',
			nested: { count: 2, prompt: 'private prompt' }
		});

		expect(sanitized).toEqual({
			ai_selects_content: true,
			context: 'post_export',
			model: 'custom',
			edition_source: 'manual_txt',
			has_custom_reciter: true,
			subtitles_count: 12,
			url_source_count: 2,
			workflow_id: 'workflow-1',
			failure_stage: 'segmentation',
			error_code: 'dependency_install_failed',
			nested: { count: 2 }
		});
	});

	it('preserves only known model identifiers and redacts custom values', () => {
		expect(sanitizeAnalyticsProperties({ model: 'gpt-5.4' })).toEqual({ model: 'gpt-5.4' });
		expect(sanitizeAnalyticsProperties({ model: ' GPT-5.4 ' })).toEqual({ model: 'gpt-5.4' });
		expect(sanitizeAnalyticsProperties({ model: 'SurahSplitter-Base-Quran' })).toEqual({
			model: 'SurahSplitter-Base-Quran'
		});
		expect(sanitizeAnalyticsProperties({ model: 'private-fine-tune-name' })).toEqual({
			model: 'custom'
		});
		expect(sanitizeAnalyticsProperties({ model: '   ' })).toEqual({ model: 'unknown' });
	});

	it('tracks stable translation sources without generated manual edition keys', () => {
		const track = vi.spyOn(AnalyticsService, 'track').mockImplementation(() => undefined);

		AnalyticsService.trackTranslationAdded('quran_api', 'English');
		AnalyticsService.trackTranslationAdded('qdc', 'French');
		AnalyticsService.trackTranslationAdded('manual_txt', 'English');

		expect(track).toHaveBeenNthCalledWith(1, 'translation_added', {
			edition_source: 'quran_api',
			edition_language: 'en'
		});
		expect(track).toHaveBeenNthCalledWith(2, 'translation_added', {
			edition_source: 'qdc',
			edition_language: 'fr'
		});
		expect(track).toHaveBeenNthCalledWith(3, 'translation_added', {
			edition_source: 'manual_txt',
			edition_language: 'en'
		});
	});

	it('classifies legacy edition keys without retaining the raw identifier', () => {
		expect(sanitizeAnalyticsProperties({ edition_key: 'en_sahih' })).toEqual({
			edition_source: 'quran_api'
		});
		expect(sanitizeAnalyticsProperties({ edition_key: 'qdc-translation-131' })).toEqual({
			edition_source: 'qdc'
		});
		expect(sanitizeAnalyticsProperties({ edition_key: 'private-import-name' })).toEqual({
			edition_source: 'custom'
		});
		expect(sanitizeAnalyticsProperties({ edition_key: 123 })).toBeUndefined();
		expect(sanitizeAnalyticsProperties({ edition_language: 'en' })).toEqual({
			edition_language: 'en'
		});
	});
});

describe('analytics surface and queue', () => {
	it('accepts only a top-level main surface outside the exporter route', () => {
		expect(isMainAnalyticsSurface('/', true, 'main')).toBe(true);
		expect(isMainAnalyticsSurface('/projects', true, undefined)).toBe(true);
		expect(isMainAnalyticsSurface('/exporter', true, 'main')).toBe(false);
		expect(isMainAnalyticsSurface('/', false, 'main')).toBe(false);
		expect(isMainAnalyticsSurface('/', true, 'export-42')).toBe(false);
	});

	it('bounds queued events and drops them after analytics is disabled or failed', () => {
		for (let index = 0; index < 105; index++) {
			AnalyticsService.track(`queued_${index}`, { index });
		}

		expect(internals.eventQueue).toHaveLength(100);
		expect(internals.eventQueue[0]).toMatchObject({ eventName: 'queued_5' });

		internals.state = 'disabled';
		AnalyticsService.track('disabled_event');
		internals.state = 'failed';
		AnalyticsService.track('failed_event');
		expect(internals.eventQueue).toHaveLength(100);
	});

	it('captures the current locale on every event', () => {
		setLocale('fr');
		AnalyticsService.track('first_event');
		setLocale('de');
		AnalyticsService.track('second_event');

		expect(internals.eventQueue.map((event) => event.properties?.app_locale)).toEqual(['fr', 'de']);
	});
});

describe('batch terminal count reconciliation', () => {
	it('preserves resolved counts and assigns only thrown unresolved items to failures', () => {
		expect(
			reconcileBatchStageTerminalCounts({
				total: 6,
				completed: 2,
				failed: 1,
				skipped: 1,
				needsReview: 1,
				threw: true
			})
		).toEqual({ failed: 2, outcome: 'partial' });
	});

	it('treats review-only segmentation as partial and clean completion as completed', () => {
		expect(
			reconcileBatchStageTerminalCounts({
				total: 2,
				completed: 0,
				failed: 0,
				skipped: 0,
				needsReview: 2,
				threw: false
			})
		).toEqual({ failed: 0, outcome: 'partial' });
		expect(
			reconcileBatchStageTerminalCounts({
				total: 2,
				completed: 2,
				failed: 0,
				skipped: 0,
				needsReview: 0,
				threw: false
			})
		).toEqual({ failed: 0, outcome: 'completed' });
	});
});

describe('typed analytics workflow construction', () => {
	it('emits finished for failures and reserves historical used events for completions', () => {
		const track = vi.spyOn(AnalyticsService, 'track').mockImplementation(() => undefined);
		const workflow: AnalyticsWorkflow = { workflowId: 'segmentation-1', startedAt: Date.now() };

		AnalyticsService.trackSegmentationUsage(workflow, 'failed', { provider: 'cloud_v2' });
		expect(track.mock.calls.map(([eventName]) => eventName)).toEqual(['ai_segmentation_finished']);

		track.mockClear();
		AnalyticsService.trackSegmentationUsage(workflow, 'completed', { provider: 'cloud_v2' });
		expect(track.mock.calls.map(([eventName]) => eventName)).toEqual([
			'ai_segmentation_finished',
			'ai_segmentation_used'
		]);
	});

	it('classifies word-by-word translation separately from AI bolding', () => {
		const track = vi.spyOn(AnalyticsService, 'track').mockImplementation(() => undefined);
		const workflow = AnalyticsService.trackAiWbwTranslationStarted({ mode: 'advanced' });
		AnalyticsService.trackAiWbwTranslationUsage(workflow, 'completed', {
			successful_segments: 3
		});

		const names = track.mock.calls.map(([eventName]) => eventName);
		expect(names).toEqual([
			'ai_wbw_translation_started',
			'ai_wbw_translation_finished',
			'ai_wbw_translation_used'
		]);
		expect(names.some((eventName) => eventName.startsWith('ai_bold'))).toBe(false);
	});

	it('constructs aggregate batch stage events with correlation and counts', () => {
		const track = vi.spyOn(AnalyticsService, 'track').mockImplementation(() => undefined);
		const workflow = AnalyticsService.trackBatchStageStarted('media_import', 4);
		AnalyticsService.trackBatchStageCompleted(workflow, 'media_import', 'partial', {
			item_count: 4,
			completed_count: 3,
			failed_count: 1
		});

		expect(track).toHaveBeenNthCalledWith(
			1,
			'batch_stage_started',
			expect.objectContaining({
				stage: 'media_import',
				item_count: 4,
				workflow_id: workflow.workflowId
			})
		);
		expect(track).toHaveBeenNthCalledWith(
			2,
			'batch_stage_completed',
			expect.objectContaining({
				stage: 'media_import',
				outcome: 'partial',
				completed_count: 3,
				failed_count: 1,
				workflow_id: workflow.workflowId,
				duration_ms: expect.any(Number)
			})
		);
	});

	it('constructs shared onboarding and Quran lifecycle events without identity data', () => {
		const track = vi.spyOn(AnalyticsService, 'track').mockImplementation(() => undefined);
		const onboarding = AnalyticsService.trackOnboardingStarted('fr');
		AnalyticsService.trackOnboardingFinished(onboarding, 'skipped', 'fr', 4);
		const auth = AnalyticsService.trackQuranAuthStarted(2);
		AnalyticsService.trackQuranAuthFinished(auth, 'completed', 2);
		AnalyticsService.trackQuranAuthDisconnected(3, 'user');
		AnalyticsService.trackQuranBookmarkChanged('add', 'partial', 2, 1);
		AnalyticsService.trackQuickTimelineEditorUsed('wbwTimestamp');

		expect(track).toHaveBeenNthCalledWith(
			2,
			'onboarding_finished',
			expect.objectContaining({
				workflow_id: onboarding.workflowId,
				outcome: 'skipped',
				locale: 'fr',
				last_step: 4,
				duration_ms: expect.any(Number)
			})
		);
		expect(track).toHaveBeenNthCalledWith(
			4,
			'quran_auth_finished',
			expect.objectContaining({
				workflow_id: auth.workflowId,
				outcome: 'completed',
				scope_count: 2,
				duration_ms: expect.any(Number)
			})
		);
		expect(track).toHaveBeenNthCalledWith(5, 'quran_auth_disconnected', {
			scope_count: 3,
			reason: 'user'
		});
		expect(track).toHaveBeenNthCalledWith(6, 'quran_bookmark_changed', {
			action: 'add',
			outcome: 'partial',
			change_count: 2,
			failed_count: 1
		});
		expect(track).toHaveBeenNthCalledWith(7, 'quick_timeline_editor_used', {
			mode: 'wbwTimestamp'
		});
	});

	it('aggregates subtitle targets without sending edition names', () => {
		const track = vi.spyOn(AnalyticsService, 'track').mockImplementation(() => undefined);

		AnalyticsService.trackSubtitlesExport(
			'srt',
			['arabic', 'Private edition', 'Another edition'],
			{ arabic: true, 'Private edition': false, 'Another edition': true },
			12
		);

		expect(track).toHaveBeenCalledWith('subtitles_exported', {
			format: 'srt',
			included_target_count: 3,
			translation_target_count: 2,
			includes_arabic: true,
			arabic_verse_numbers: true,
			translation_verse_numbers_count: 1,
			subtitles_count: 12
		});
	});

	it('emits installation and update transitions only once per process', () => {
		const track = vi.spyOn(AnalyticsService, 'track').mockImplementation(() => undefined);

		AnalyticsService.trackAppInstalled('3.6.61');
		AnalyticsService.trackAppInstalled('3.6.61');
		AnalyticsService.trackAppUpdated('3.6.60', '3.6.61');
		AnalyticsService.trackAppUpdated('3.6.60', '3.6.61');

		expect(track.mock.calls).toEqual([
			['app_installed', { app_version: '3.6.61' }],
			['app_updated', { from_version: '3.6.60', to_version: '3.6.61' }]
		]);
	});
});
