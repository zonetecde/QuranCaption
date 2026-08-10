import posthog from 'posthog-js';
import { env } from '$env/dynamic/public';
import { browser } from '$app/environment';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { VersionService } from './VersionService.svelte';
import type { UnknownRecord } from '$lib/types/common';
import { locale } from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';

export type AnalyticsWorkflow = {
	workflowId: string;
	startedAt: number;
};

export type AnalyticsWorkflowStatus = 'completed' | 'partial' | 'failed' | 'canceled' | 'skipped';

export type BatchAnalyticsStage =
	| 'media_import'
	| 'cbr_conversion'
	| 'segmentation'
	| 'translation_add'
	| 'translation_fetch'
	| 'style_apply'
	| 'video_export'
	| 'youtube_chapters_export'
	| 'subtitle_json_export';

export type AnalyticsEditionSource = 'quran_api' | 'qdc' | 'manual_txt' | 'custom';

export type BatchStageTerminalCounts = {
	total: number;
	completed: number;
	failed: number;
	skipped: number;
	needsReview: number;
	threw: boolean;
};

/**
 * Reconciles a batch stage without overwriting work already resolved before an exception.
 * @param {BatchStageTerminalCounts} counts Observed terminal counters and stage size.
 * @returns {{ failed: number; outcome: 'completed' | 'partial' | 'failed' }} Reconciled failures and outcome.
 */
export function reconcileBatchStageTerminalCounts(counts: BatchStageTerminalCounts): {
	failed: number;
	outcome: 'completed' | 'partial' | 'failed';
} {
	const unresolved = Math.max(
		counts.total - counts.completed - counts.failed - counts.skipped - counts.needsReview,
		0
	);
	const failed = counts.failed + (counts.threw ? unresolved : 0);
	const resolvedWithoutFailure = counts.completed + counts.skipped + counts.needsReview;
	const isCleanCompletion =
		failed === 0 &&
		counts.skipped === 0 &&
		counts.needsReview === 0 &&
		counts.completed >= counts.total;

	return {
		failed,
		outcome: isCleanCompletion ? 'completed' : resolvedWithoutFailure > 0 ? 'partial' : 'failed'
	};
}

type AnalyticsState = 'idle' | 'initializing' | 'ready' | 'disabled' | 'failed';

const MAX_QUEUED_EVENTS = 100;
const FORBIDDEN_PROPERTY_PARTS = [
	'account',
	'authorization',
	'body',
	'comment',
	'content',
	'cookie',
	'credential',
	'description',
	'draft',
	'email',
	'filename',
	'file_name',
	'log',
	'message',
	'path',
	'password',
	'prompt',
	'reciter',
	'stack',
	'secret',
	'text',
	'title',
	'token',
	'url'
];
const ALLOWED_PROPERTY_KEYS = new Set([
	'ai_selects_content',
	'context',
	'has_custom_reciter',
	'subtitles_count',
	'url_source_count'
]);
const ALLOWED_ANALYTICS_MODELS = new Map(
	[
		'gpt-5.4',
		'gpt-5.4-mini',
		'gpt-5.4-nano',
		'gpt-4o-mini',
		'gemini-3.1-flash-lite',
		'gemini-2.5-flash',
		'z-ai/glm-4.5-air:free',
		'llama-3.3-70b-versatile',
		'deepseek-v4-flash',
		'tiny',
		'base',
		'medium',
		'large',
		'SurahSplitter-Base-Quran',
		'tarteel-ai/whisper-tiny-ar-quran',
		'tarteel-ai/whisper-base-ar-quran',
		'openai/whisper-medium',
		'IJyad/whisper-large-v3-Tarteel',
		'hetchyy/r15_95m',
		'hetchyy/r7',
		'OdyAsh/faster-whisper-base-ar-quran',
		'quran_word_timing',
		'imported_json',
		'not_applicable',
		'Pika Labs / High Quality',
		'Pika Labs / Fast',
		'Pika Labs / Best Quality/Price Ratio'
	].map((model) => [model.toLowerCase(), model] as const)
);
const ANALYTICS_LANGUAGES = new Map([
	['arabic', 'ar'],
	['bengali', 'bn'],
	['chinese', 'zh'],
	['english', 'en'],
	['french', 'fr'],
	['german', 'de'],
	['hindi', 'hi'],
	['indonesian', 'id'],
	['italian', 'it'],
	['malay', 'ms'],
	['persian', 'fa'],
	['portuguese', 'pt'],
	['russian', 'ru'],
	['spanish', 'es'],
	['turkish', 'tr'],
	['urdu', 'ur']
]);

/**
 * Normalizes a model without retaining arbitrary user-entered identifiers.
 * @param {unknown} value Raw model setting.
 * @returns {string} Known stable model identifier, custom, or unknown.
 */
function normalizeAnalyticsModel(value: unknown): string {
	if (typeof value !== 'string' || value.trim().length === 0) return 'unknown';
	const model = value.trim();
	return ALLOWED_ANALYTICS_MODELS.get(model.toLowerCase()) ?? 'custom';
}

/**
 * Classifies a translation edition key without retaining catalog or imported identifiers.
 * @param {string} value Raw edition key.
 * @returns {AnalyticsEditionSource} Stable edition source.
 */
function classifyAnalyticsEdition(value: string): AnalyticsEditionSource {
	const editionKey = value.trim().toLowerCase();
	if (editionKey.startsWith('txt-manual-')) return 'manual_txt';
	if (/^qdc-translation-\d+$/.test(editionKey)) return 'qdc';
	if (/^[a-z]{2,3}_[a-z0-9_]+$/.test(editionKey)) return 'quran_api';
	return 'custom';
}

/**
 * Normalizes an edition language without retaining imported project text.
 * @param {unknown} value Raw edition language.
 * @returns {string} Stable language code, other, or unknown.
 */
function normalizeAnalyticsLanguage(value: unknown): string {
	if (typeof value !== 'string' || value.trim().length === 0) return 'unknown';
	const language = value.trim().toLowerCase();
	return (
		ANALYTICS_LANGUAGES.get(language) ??
		([...ANALYTICS_LANGUAGES.values()].includes(language) ? language : 'other')
	);
}

/**
 * Checks whether an analytics property key can carry sensitive data.
 * @param {string} key Property key to inspect.
 * @returns {boolean} Whether the property must be removed.
 */
function isForbiddenPropertyKey(key: string): boolean {
	const normalizedKey = key.toLowerCase();
	if (ALLOWED_PROPERTY_KEYS.has(normalizedKey)) return false;
	if (normalizedKey === 'name' || normalizedKey.endsWith('_name')) return true;
	if (
		normalizedKey.includes('error') &&
		!normalizedKey.endsWith('_code') &&
		!normalizedKey.endsWith('_kind') &&
		!normalizedKey.endsWith('_count')
	) {
		return true;
	}

	return FORBIDDEN_PROPERTY_PARTS.some((part) => normalizedKey.includes(part));
}

/**
 * Checks whether a string resembles free-form or personal data.
 * @param {string} value String to inspect.
 * @returns {boolean} Whether the string must be removed.
 */
function isSensitiveString(value: string): boolean {
	return (
		value.length > 160 ||
		/[\r\n]/.test(value) ||
		/(?:https?|file|content):\/\//i.test(value) ||
		/\bwww\./i.test(value) ||
		/(?:^|\s)[a-z]:[\\/]/i.test(value) ||
		/\\\\[^\\/\s]+[\\/][^\\/\s]+/.test(value) ||
		/(?:^|\s)\/(?:[^\s/]+\/)+[^\s]*/i.test(value) ||
		/\.(?:aac|avi|csv|flac|jpeg|jpg|json|m4a|mkv|mov|mp3|mp4|ogg|opus|png|srt|vtt|wav|webm)\b/i.test(
			value
		) ||
		/[^\s@]+@[^\s@]+\.[^\s@]+/.test(value) ||
		/(?:Bearer\s+|\bAKIA[A-Z0-9]{12,}|\bsk-[A-Za-z0-9_-]{12,}|\bghp_[A-Za-z0-9]{12,}|\beyJ[A-Za-z0-9_-]+\.)/i.test(
			value
		)
	);
}

/**
 * Recursively sanitizes an analytics value.
 * @param {string} key Property key associated with the value.
 * @param {unknown} value Value to sanitize.
 * @returns {unknown} Safe value, or undefined when it must be removed.
 */
function sanitizeAnalyticsValue(key: string, value: unknown): unknown {
	if (isForbiddenPropertyKey(key) || value === null || value === undefined) return undefined;
	if (typeof value === 'string') return isSensitiveString(value) ? undefined : value;
	if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
	if (typeof value === 'boolean') return value;
	if (Array.isArray(value)) {
		return value
			.map((item) => sanitizeAnalyticsValue(key, item))
			.filter((item) => item !== undefined);
	}
	if (typeof value === 'object') {
		return sanitizeAnalyticsProperties(value as UnknownRecord);
	}

	return undefined;
}

/**
 * Removes personal data and free-form text from analytics properties.
 * @param {UnknownRecord | undefined} properties Candidate properties.
 * @returns {UnknownRecord | undefined} Sanitized properties, or undefined when empty.
 */
export function sanitizeAnalyticsProperties(properties?: UnknownRecord): UnknownRecord | undefined {
	if (!properties) return undefined;

	const sanitized = Object.entries(properties).reduce<UnknownRecord>((result, [key, value]) => {
		if (key.toLowerCase() === 'model') {
			result.model = normalizeAnalyticsModel(value);
			return result;
		}
		if (key.toLowerCase() === 'edition_key') {
			if (typeof value === 'string') {
				result.edition_source = classifyAnalyticsEdition(value);
			}
			return result;
		}
		if (key.toLowerCase() === 'edition_language') {
			result.edition_language = normalizeAnalyticsLanguage(value);
			return result;
		}
		const sanitizedValue = sanitizeAnalyticsValue(key, value);
		if (sanitizedValue !== undefined) result[key] = sanitizedValue;
		return result;
	}, {});

	return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

/**
 * Checks whether analytics is running on the main application surface.
 * @param {string} pathname Current pathname.
 * @param {boolean} isTopLevel Whether the page is the top-level window.
 * @param {string | undefined} webviewLabel Tauri label when available.
 * @returns {boolean} Whether the surface is the main application window.
 */
export function isMainAnalyticsSurface(
	pathname: string,
	isTopLevel: boolean,
	webviewLabel?: string
): boolean {
	return (
		isTopLevel &&
		!pathname.startsWith('/exporter') &&
		(webviewLabel === undefined || webviewLabel === 'main')
	);
}

export class AnalyticsService {
	private static state: AnalyticsState = 'idle';
	private static eventQueue: Array<{ eventName: string; properties?: UnknownRecord }> = [];
	private static appInstallationTracked = false;
	private static appUpdateTracked = false;

	/**
	 * Initializes PostHog only on the main application surface.
	 * @returns {Promise<void>} Resolves after initialization or a disabled/failed outcome.
	 */
	static async init(): Promise<void> {
		if (!browser || this.state !== 'idle') return;

		let webviewLabel: string | undefined;
		try {
			webviewLabel = getCurrentWebviewWindow().label;
		} catch {
			// The label is unavailable in the development browser.
		}

		if (!isMainAnalyticsSurface(window.location.pathname, window.top === window, webviewLabel)) {
			this.disable();
			return;
		}

		if (!env.PUBLIC_POSTHOG_KEY || !env.PUBLIC_POSTHOG_HOST) {
			console.warn('Analytics skipped: Missing PUBLIC_POSTHOG_KEY or PUBLIC_POSTHOG_HOST');
			this.disable();
			return;
		}

		this.state = 'initializing';
		try {
			posthog.init(env.PUBLIC_POSTHOG_KEY, {
				api_host: env.PUBLIC_POSTHOG_HOST,
				capture_pageview: false,
				capture_pageleave: false,
				capture_exceptions: false,
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
				],
				persistence: 'localStorage',
				autocapture: false,
				disable_session_recording: true,
				person_profiles: 'identified_only'
			});

			const versionPromise = VersionService.getAppVersion();
			const timeoutPromise = new Promise<string>((resolve) =>
				setTimeout(() => resolve('0.0.0'), 2000)
			);
			const appVersion = await Promise.race([versionPromise, timeoutPromise]);

			posthog.register({
				platform: 'desktop',
				app_platform: 'desktop',
				analytics_schema_version: 2,
				app_version: appVersion,
				app_locale: get(locale)
			});

			this.state = 'ready';
			this.flushQueue();
		} catch {
			console.warn('Analytics initialization failed');
			this.state = 'failed';
			this.eventQueue = [];
		}
	}

	/**
	 * Disables analytics and clears queued events.
	 * @returns {void}
	 */
	private static disable(): void {
		this.state = 'disabled';
		this.eventQueue = [];
	}

	/**
	 * Flushes events accumulated during initialization.
	 * @returns {void}
	 */
	private static flushQueue(): void {
		if (this.state !== 'ready') return;

		while (this.eventQueue.length > 0) {
			const item = this.eventQueue.shift();
			if (item) posthog.capture(item.eventName, item.properties);
		}
	}

	/**
	 * Sends an event after defensively sanitizing its properties.
	 * @param {string} eventName Stable event name.
	 * @param {UnknownRecord | undefined} properties Structural properties.
	 * @returns {void}
	 */
	static track(eventName: string, properties?: UnknownRecord): void {
		if (this.state === 'disabled' || this.state === 'failed') return;

		const sanitizedProperties = sanitizeAnalyticsProperties({
			...properties,
			app_locale: get(locale)
		});
		if (this.state !== 'ready') {
			if (this.eventQueue.length >= MAX_QUEUED_EVENTS) this.eventQueue.shift();
			this.eventQueue.push({ eventName, properties: sanitizedProperties });
			return;
		}

		posthog.capture(eventName, sanitizedProperties);
	}

	/**
	 * Creates a local workflow identifier and emits its start event.
	 * @param {string} eventName Start event name.
	 * @param {UnknownRecord | undefined} properties Structural properties.
	 * @returns {AnalyticsWorkflow} Correlation data for the terminal event.
	 */
	private static startWorkflow(eventName: string, properties?: UnknownRecord): AnalyticsWorkflow {
		const workflow = {
			workflowId: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
			startedAt: Date.now()
		};
		this.track(eventName, { ...properties, workflow_id: workflow.workflowId });
		return workflow;
	}

	/**
	 * Emits a correlated workflow terminal event.
	 * @param {string} eventName Terminal event name.
	 * @param {AnalyticsWorkflow} workflow Previously started workflow.
	 * @param {AnalyticsWorkflowStatus} status Terminal status.
	 * @param {UnknownRecord | undefined} properties Structural properties.
	 * @returns {void}
	 */
	private static completeWorkflow(
		eventName: string,
		workflow: AnalyticsWorkflow,
		status: AnalyticsWorkflowStatus,
		properties?: UnknownRecord
	): void {
		this.track(eventName, {
			...properties,
			workflow_id: workflow.workflowId,
			outcome: status,
			duration_ms: Math.max(0, Date.now() - workflow.startedAt)
		});
	}

	/**
	 * Tracks an application open.
	 * @returns {void}
	 */
	static trackAppOpened(): void {
		this.track('app_opened');
	}

	/**
	 * Tracks a successfully created project.
	 * @param {string | undefined} projectType Stable project type.
	 * @param {boolean} hasCustomReciter Whether a custom reciter was entered.
	 * @returns {void}
	 */
	static trackProjectCreated(projectType?: string, hasCustomReciter = false): void {
		this.track('project_created', {
			project_type: projectType,
			has_custom_reciter: hasCustomReciter
		});
	}

	/**
	 * Tracks a project opened in the editor.
	 * @param {string | undefined} projectType Stable project type.
	 * @param {boolean} isBatchProject Whether the project belongs to a batch.
	 * @returns {void}
	 */
	static trackProjectOpened(projectType?: string, isBatchProject = false): void {
		this.track('project_opened', {
			project_type: projectType,
			is_batch_project: isBatchProject
		});
	}

	/**
	 * Tracks a successfully imported project.
	 * @returns {void}
	 */
	static trackProjectImported(): void {
		this.track('project_imported', { source: 'project_file' });
	}

	/**
	 * Tracks a successfully duplicated project.
	 * @returns {void}
	 */
	static trackProjectDuplicated(): void {
		this.track('project_duplicated');
	}

	/**
	 * Tracks a completed project editing session.
	 * @param {number} durationMs Session duration in milliseconds.
	 * @param {UnknownRecord | undefined} properties Structural project properties.
	 * @returns {void}
	 */
	static trackProjectEditingSessionCompleted(durationMs: number, properties?: UnknownRecord): void {
		this.track('project_editing_session_completed', {
			...properties,
			duration_ms: Math.max(0, Math.round(durationMs))
		});
	}

	/**
	 * Tracks active time spent in an editor section.
	 * @param {string} section Stable section identifier.
	 * @param {number} durationMs Active duration in milliseconds.
	 * @returns {void}
	 */
	static trackEditorSectionViewed(section: string, durationMs: number): void {
		this.track('editor_section_viewed', {
			section,
			duration_ms: Math.max(0, Math.round(durationMs))
		});
	}

	/**
	 * Starts the onboarding workflow.
	 * @param {string | undefined} appLocale Stable application locale.
	 * @returns {AnalyticsWorkflow} Correlation data for the terminal event.
	 */
	static trackOnboardingStarted(appLocale?: string): AnalyticsWorkflow {
		return this.startWorkflow('onboarding_started', { locale: appLocale });
	}

	/**
	 * Finishes the onboarding workflow.
	 * @param {AnalyticsWorkflow} workflow Correlation data from workflow start.
	 * @param {'completed' | 'skipped'} outcome Terminal onboarding outcome.
	 * @param {string | undefined} appLocale Stable application locale.
	 * @param {number} lastStep Last displayed one-based step.
	 * @returns {void}
	 */
	static trackOnboardingFinished(
		workflow: AnalyticsWorkflow,
		outcome: 'completed' | 'skipped',
		appLocale: string | undefined,
		lastStep: number
	): void {
		this.completeWorkflow('onboarding_finished', workflow, outcome, {
			locale: appLocale,
			last_step: Math.max(0, Math.round(lastStep))
		});
	}

	/**
	 * Tracks a quick timeline editor session opening.
	 * @param {'translation' | 'wbw' | 'subtitle' | 'wbwTimestamp'} mode Stable editor mode.
	 * @returns {void}
	 */
	static trackQuickTimelineEditorUsed(
		mode: 'translation' | 'wbw' | 'subtitle' | 'wbwTimestamp'
	): void {
		this.track('quick_timeline_editor_used', { mode });
	}

	/**
	 * Tracks media successfully added to a project.
	 * @param {string} source Stable media source.
	 * @param {string} mediaType Stable media type.
	 * @returns {void}
	 */
	static trackMediaImported(source: string, mediaType: string): void {
		this.track('media_imported', { source, media_type: mediaType });
	}

	/**
	 * Starts an automatic segmentation workflow.
	 * @param {UnknownRecord | undefined} properties Structural workflow properties.
	 * @returns {AnalyticsWorkflow} Correlation data for the terminal event.
	 */
	static trackSegmentationStarted(properties?: UnknownRecord): AnalyticsWorkflow {
		return this.startWorkflow('ai_segmentation_started', properties);
	}

	/**
	 * Finishes an automatic segmentation workflow.
	 * @param {AnalyticsWorkflow} workflow Correlation data from workflow start.
	 * @param {AnalyticsWorkflowStatus} status Terminal workflow status.
	 * @param {UnknownRecord | undefined} properties Structural result properties.
	 * @returns {void}
	 */
	static trackSegmentationUsage(
		workflow: AnalyticsWorkflow,
		status: AnalyticsWorkflowStatus,
		properties?: UnknownRecord
	): void {
		this.completeWorkflow('ai_segmentation_finished', workflow, status, properties);
		if (status === 'completed') {
			this.completeWorkflow('ai_segmentation_used', workflow, status, properties);
		}
	}

	/**
	 * Starts an AI translation workflow.
	 * @param {UnknownRecord | undefined} properties Structural workflow properties.
	 * @returns {AnalyticsWorkflow} Correlation data for the terminal event.
	 */
	static trackTranslationStarted(properties?: UnknownRecord): AnalyticsWorkflow {
		return this.startWorkflow('ai_translation_started', properties);
	}

	/**
	 * Finishes an AI translation workflow.
	 * @param {AnalyticsWorkflow} workflow Correlation data from workflow start.
	 * @param {AnalyticsWorkflowStatus} status Terminal workflow status.
	 * @param {UnknownRecord | undefined} properties Structural result properties.
	 * @returns {void}
	 */
	static trackTranslationUsage(
		workflow: AnalyticsWorkflow,
		status: AnalyticsWorkflowStatus,
		properties?: UnknownRecord
	): void {
		this.completeWorkflow('ai_translation_finished', workflow, status, properties);
		if (status === 'completed') {
			this.completeWorkflow('ai_translation_used', workflow, status, properties);
		}
	}

	/**
	 * Starts an AI bolding workflow.
	 * @param {UnknownRecord | undefined} properties Structural workflow properties.
	 * @returns {AnalyticsWorkflow} Correlation data for the terminal event.
	 */
	static trackAiBoldStarted(properties?: UnknownRecord): AnalyticsWorkflow {
		return this.startWorkflow('ai_bold_started', properties);
	}

	/**
	 * Finishes an AI bolding workflow.
	 * @param {AnalyticsWorkflow} workflow Correlation data from workflow start.
	 * @param {AnalyticsWorkflowStatus} status Terminal workflow status.
	 * @param {UnknownRecord | undefined} properties Structural result properties.
	 * @returns {void}
	 */
	static trackAiBoldUsage(
		workflow: AnalyticsWorkflow,
		status: AnalyticsWorkflowStatus,
		properties?: UnknownRecord
	): void {
		this.completeWorkflow('ai_bold_finished', workflow, status, properties);
		if (status === 'completed') {
			this.completeWorkflow('ai_bold_used', workflow, status, properties);
		}
	}

	/**
	 * Starts an AI word-by-word translation workflow.
	 * @param {UnknownRecord | undefined} properties Structural workflow properties.
	 * @returns {AnalyticsWorkflow} Correlation data for the terminal event.
	 */
	static trackAiWbwTranslationStarted(properties?: UnknownRecord): AnalyticsWorkflow {
		return this.startWorkflow('ai_wbw_translation_started', properties);
	}

	/**
	 * Finishes an AI word-by-word translation workflow.
	 * @param {AnalyticsWorkflow} workflow Correlation data from workflow start.
	 * @param {AnalyticsWorkflowStatus} status Terminal workflow status.
	 * @param {UnknownRecord | undefined} properties Structural result properties.
	 * @returns {void}
	 */
	static trackAiWbwTranslationUsage(
		workflow: AnalyticsWorkflow,
		status: AnalyticsWorkflowStatus,
		properties?: UnknownRecord
	): void {
		this.completeWorkflow('ai_wbw_translation_finished', workflow, status, properties);
		if (status === 'completed') {
			this.completeWorkflow('ai_wbw_translation_used', workflow, status, properties);
		}
	}

	/**
	 * Tracks a translation edition successfully added to a project.
	 * @param {AnalyticsEditionSource} source Stable translation source.
	 * @param {string | undefined} language Stable edition language.
	 * @returns {void}
	 */
	static trackTranslationAdded(source: AnalyticsEditionSource, language?: string): void {
		this.track('translation_added', {
			edition_source: source,
			edition_language: normalizeAnalyticsLanguage(language)
		});
	}

	/**
	 * Starts a Quran.com authentication workflow.
	 * @param {number} scopeCount Number of requested scopes.
	 * @returns {AnalyticsWorkflow} Correlation data for the terminal event.
	 */
	static trackQuranAuthStarted(scopeCount: number): AnalyticsWorkflow {
		return this.startWorkflow('quran_auth_started', {
			scope_count: Math.max(0, Math.round(scopeCount))
		});
	}

	/**
	 * Finishes a Quran.com authentication workflow.
	 * @param {AnalyticsWorkflow} workflow Correlation data from workflow start.
	 * @param {'completed' | 'failed'} outcome Terminal authentication outcome.
	 * @param {number} scopeCount Number of requested scopes.
	 * @returns {void}
	 */
	static trackQuranAuthFinished(
		workflow: AnalyticsWorkflow,
		outcome: 'completed' | 'failed',
		scopeCount: number
	): void {
		this.completeWorkflow('quran_auth_finished', workflow, outcome, {
			scope_count: Math.max(0, Math.round(scopeCount))
		});
	}

	/**
	 * Tracks a Quran.com session disconnection.
	 * @param {number} scopeCount Number of granted scopes before disconnection.
	 * @param {'user' | 'session_expired'} reason Stable disconnection reason.
	 * @returns {void}
	 */
	static trackQuranAuthDisconnected(scopeCount: number, reason: 'user' | 'session_expired'): void {
		this.track('quran_auth_disconnected', {
			scope_count: Math.max(0, Math.round(scopeCount)),
			reason
		});
	}

	/**
	 * Tracks aggregate Quran.com bookmark mutations.
	 * @param {'add' | 'remove'} action Stable mutation action.
	 * @param {'completed' | 'partial' | 'failed'} outcome Aggregate mutation outcome.
	 * @param {number} changeCount Successful collection operations.
	 * @param {number} failedCount Failed collection operations.
	 * @returns {void}
	 */
	static trackQuranBookmarkChanged(
		action: 'add' | 'remove',
		outcome: 'completed' | 'partial' | 'failed',
		changeCount: number,
		failedCount: number
	): void {
		this.track('quran_bookmark_changed', {
			action,
			outcome,
			change_count: Math.max(0, Math.round(changeCount)),
			failed_count: Math.max(0, Math.round(failedCount))
		});
	}

	/**
	 * Tracks a successfully saved style preset.
	 * @param {UnknownRecord | undefined} properties Structural preset properties.
	 * @returns {void}
	 */
	static trackStylePresetSaved(properties?: UnknownRecord): void {
		this.track('style_preset_saved', properties);
	}

	/**
	 * Tracks a successfully applied style preset.
	 * @param {UnknownRecord | undefined} properties Structural preset properties.
	 * @returns {void}
	 */
	static trackStylePresetApplied(properties?: UnknownRecord): void {
		this.track('style_preset_applied', properties);
	}

	/**
	 * Tracks a successfully published style preset.
	 * @param {UnknownRecord | undefined} properties Structural preset properties.
	 * @returns {void}
	 */
	static trackStylePresetPublished(properties?: UnknownRecord): void {
		this.track('style_preset_published', properties);
	}

	/**
	 * Starts an AI video project creation workflow.
	 * @param {UnknownRecord | undefined} properties Structural workflow properties.
	 * @returns {AnalyticsWorkflow} Correlation data for the terminal event.
	 */
	static trackAiVideoProjectStarted(properties?: UnknownRecord): AnalyticsWorkflow {
		return this.startWorkflow('ai_video_project_started', properties);
	}

	/**
	 * Finishes an AI video project creation workflow.
	 * @param {AnalyticsWorkflow} workflow Correlation data from workflow start.
	 * @param {AnalyticsWorkflowStatus} status Terminal workflow status.
	 * @param {UnknownRecord | undefined} properties Structural result properties.
	 * @returns {void}
	 */
	static trackAiVideoProjectFinished(
		workflow: AnalyticsWorkflow,
		status: AnalyticsWorkflowStatus,
		properties?: UnknownRecord
	): void {
		this.completeWorkflow('ai_video_project_finished', workflow, status, properties);
	}

	/**
	 * Starts a native YouTube upload workflow.
	 * @param {UnknownRecord | undefined} properties Structural upload properties.
	 * @returns {AnalyticsWorkflow} Correlation data for the terminal event.
	 */
	static trackYouTubeUploadStarted(properties?: UnknownRecord): AnalyticsWorkflow {
		return this.startWorkflow('youtube_upload_started', properties);
	}

	/**
	 * Finishes a native YouTube upload workflow.
	 * @param {AnalyticsWorkflow} workflow Correlation data from workflow start.
	 * @param {AnalyticsWorkflowStatus} status Terminal workflow status.
	 * @param {UnknownRecord | undefined} properties Structural result properties.
	 * @returns {void}
	 */
	static trackYouTubeUploadFinished(
		workflow: AnalyticsWorkflow,
		status: AnalyticsWorkflowStatus,
		properties?: UnknownRecord
	): void {
		this.completeWorkflow('youtube_upload_finished', workflow, status, properties);
	}

	/**
	 * Starts a video export workflow.
	 * @param {UnknownRecord | undefined} properties Structural export properties.
	 * @returns {AnalyticsWorkflow} Correlation data for the terminal event.
	 */
	static trackVideoExportStarted(properties?: UnknownRecord): AnalyticsWorkflow {
		return this.startWorkflow('video_export_started', properties);
	}

	/**
	 * Finishes a successful video export workflow.
	 * @param {AnalyticsWorkflow} workflow Correlation data from workflow start.
	 * @param {UnknownRecord | undefined} properties Structural export properties.
	 * @returns {void}
	 */
	static trackVideoExported(workflow: AnalyticsWorkflow, properties?: UnknownRecord): void {
		this.completeWorkflow('video_exported', workflow, 'completed', properties);
	}

	/**
	 * Finishes a failed video export workflow.
	 * @param {AnalyticsWorkflow} workflow Correlation data from workflow start.
	 * @param {UnknownRecord | undefined} properties Structural export properties.
	 * @returns {void}
	 */
	static trackVideoExportFailed(workflow: AnalyticsWorkflow, properties?: UnknownRecord): void {
		this.completeWorkflow('video_export_failed', workflow, 'failed', properties);
	}

	/**
	 * Finishes a canceled video export workflow.
	 * @param {AnalyticsWorkflow} workflow Correlation data from workflow start.
	 * @param {UnknownRecord | undefined} properties Structural export properties.
	 * @returns {void}
	 */
	static trackVideoExportCanceled(workflow: AnalyticsWorkflow, properties?: UnknownRecord): void {
		this.completeWorkflow('video_export_canceled', workflow, 'canceled', properties);
	}

	/**
	 * Tracks a successfully created batch.
	 * @param {UnknownRecord} properties Structural batch counts.
	 * @returns {void}
	 */
	static trackBatchCreated(properties: UnknownRecord): void {
		this.track('batch_created', properties);
	}

	/**
	 * Starts an aggregate batch stage.
	 * @param {BatchAnalyticsStage} stage Stable batch stage.
	 * @param {number} itemCount Number of items selected for the stage.
	 * @returns {AnalyticsWorkflow} Correlation data for the terminal event.
	 */
	static trackBatchStageStarted(stage: BatchAnalyticsStage, itemCount: number): AnalyticsWorkflow {
		return this.startWorkflow('batch_stage_started', {
			stage,
			item_count: itemCount
		});
	}

	/**
	 * Finishes an aggregate batch stage.
	 * @param {AnalyticsWorkflow} workflow Correlation data from stage start.
	 * @param {BatchAnalyticsStage} stage Stable batch stage.
	 * @param {AnalyticsWorkflowStatus} status Terminal stage status.
	 * @param {UnknownRecord} properties Aggregate stage counts.
	 * @returns {void}
	 */
	static trackBatchStageCompleted(
		workflow: AnalyticsWorkflow,
		stage: BatchAnalyticsStage,
		status: AnalyticsWorkflowStatus,
		properties: UnknownRecord
	): void {
		this.completeWorkflow('batch_stage_completed', workflow, status, {
			stage,
			...properties
		});
	}

	/**
	 * Tracks an application update.
	 * @param {string} fromVersion Previous application version.
	 * @param {string} toVersion New application version.
	 * @returns {void}
	 */
	static trackAppUpdated(fromVersion: string, toVersion: string): void {
		if (this.appUpdateTracked) return;
		this.appUpdateTracked = true;
		this.track('app_updated', { from_version: fromVersion, to_version: toVersion });
	}

	/**
	 * Tracks a new application installation.
	 * @param {string} version Installed application version.
	 * @returns {void}
	 */
	static trackAppInstalled(version: string): void {
		if (this.appInstallationTracked) return;
		this.appInstallationTracked = true;
		this.track('app_installed', { app_version: version });
	}

	/**
	 * Tracks a review only after successful delivery.
	 * @param {number} rating Review rating.
	 * @param {'support_prompt' | 'settings_support' | 'donation_post_export'} source Stable review source.
	 * @returns {void}
	 */
	static trackReview(
		rating: number,
		source: 'support_prompt' | 'settings_support' | 'donation_post_export'
	): void {
		this.track('review', { rating, source });
	}

	/**
	 * Tracks support feedback only after successful delivery.
	 * @param {'feature' | 'bug'} type Stable feedback type.
	 * @param {'support_prompt' | 'settings_support' | 'donation_post_export'} source Stable feedback source.
	 * @returns {void}
	 */
	static trackSupportFeedback(
		type: 'feature' | 'bug',
		source: 'support_prompt' | 'settings_support' | 'donation_post_export'
	): void {
		this.track('support_feedback', { type, source });
	}

	/**
	 * Tracks a support panel impression.
	 * @param {'post_export'} context Stable display context.
	 * @param {number} quoteIndex Structural quote index.
	 * @returns {void}
	 */
	static trackSupportPanelImpression(context: 'post_export', quoteIndex: number): void {
		this.track('support_panel_impression', { context, quote_index: quoteIndex });
	}

	/**
	 * Tracks a dismissed support panel.
	 * @param {'post_export'} context Stable display context.
	 * @param {'close' | 'remind_later'} action Stable dismissal action.
	 * @returns {void}
	 */
	static trackSupportPanelDismissed(
		context: 'post_export',
		action: 'close' | 'remind_later'
	): void {
		this.track('support_panel_dismissed', { context, action });
	}

	/**
	 * Tracks a support panel call-to-action.
	 * @param {'post_export'} context Stable display context.
	 * @param {'donate' | 'feedback' | 'discord'} cta Stable call-to-action.
	 * @returns {void}
	 */
	static trackSupportPanelCtaClicked(
		context: 'post_export',
		cta: 'donate' | 'feedback' | 'discord'
	): void {
		this.track('support_panel_cta_clicked', { context, cta });
	}

	/**
	 * Tracks a subtitle file successfully written to disk.
	 * @param {string} format Stable subtitle format.
	 * @param {string[]} includedTargets Target identifiers used only to derive safe counts.
	 * @param {Record<string, boolean>} exportVerseNumbers Per-target flags used only in aggregates.
	 * @param {number | undefined} subtitlesCount Exported subtitle count.
	 * @returns {void}
	 */
	static trackSubtitlesExport(
		format: string,
		includedTargets: string[],
		exportVerseNumbers: Record<string, boolean>,
		subtitlesCount?: number
	): void {
		const translationTargets = includedTargets.filter((target) => target !== 'arabic');
		this.track('subtitles_exported', {
			format,
			included_target_count: includedTargets.length,
			translation_target_count: translationTargets.length,
			includes_arabic: includedTargets.includes('arabic'),
			arabic_verse_numbers: Boolean(exportVerseNumbers.arabic),
			translation_verse_numbers_count: translationTargets.filter(
				(target) => exportVerseNumbers[target]
			).length,
			subtitles_count: subtitlesCount
		});
	}

	/**
	 * Tracks a YouTube chapters file successfully written to disk.
	 * @param {string} choice Stable chapter grouping choice.
	 * @param {number} chaptersCount Exported chapter count.
	 * @param {number | undefined} exportStartMs Structural export start time.
	 * @param {number | undefined} exportEndMs Structural export end time.
	 * @returns {void}
	 */
	static trackYtbChaptersExport(
		choice: string,
		chaptersCount: number,
		exportStartMs?: number,
		exportEndMs?: number
	): void {
		this.track('ytb_chapters_exported', {
			choice,
			chapters_count: chaptersCount,
			export_start_ms: exportStartMs,
			export_end_ms: exportEndMs
		});
	}

	/**
	 * Tracks an application error without messages, stacks, logs, or paths.
	 * @param {Error} error Application error used only for its stable kind.
	 * @returns {void}
	 */
	static trackError(error: Error): void {
		this.track('error', {
			error_code: 'uncaught_exception',
			error_kind: error.name
		});
	}
}
