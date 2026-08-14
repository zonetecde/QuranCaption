import posthog from 'posthog-js';
import { env } from '$env/dynamic/public';
import { browser } from '$app/environment';
import { VersionService } from './VersionService.svelte';
import type { UnknownRecord } from '$lib/types/common';
import { locale } from '$lib/i18n/i18n-svelte';
import { get } from 'svelte/store';

type AnalyticsState = 'idle' | 'initializing' | 'ready' | 'disabled' | 'failed';

export type AnalyticsOutcome = 'completed' | 'partial' | 'failed' | 'canceled';
export type AiAnalyticsFeature = 'translation_trim' | 'bold' | 'wbw_translation';
export type EditorAnalyticsSection = 'video' | 'subtitles' | 'translations' | 'style' | 'export';
export type AnalyticsEditionSource = 'quran_api' | 'qdc' | 'manual_txt' | 'custom';
export type ReflectionAnalyticsEvent =
	| 'reflection_prompt_shown'
	| 'reflection_prompt_dismissed'
	| 'reflection_range_changed'
	| 'reflection_example_opened'
	| 'reflection_auth_requested'
	| 'reflection_private_saved'
	| 'reflection_public_published'
	| 'reflection_submit_failed';

export interface AnalyticsWorkflow {
	id: string;
	startedAt: number;
}

export interface AiAnalyticsStart {
	feature: AiAnalyticsFeature;
	mode: string;
	model?: string;
	reasoningEffort?: string;
	totalItems?: number;
	totalBatches?: number;
}

export interface AiAnalyticsFinish {
	outcome: AnalyticsOutcome;
	completedItems?: number;
	failedItems?: number;
	completedBatches?: number;
	failedBatches?: number;
	hadErrors?: boolean;
}

export interface SegmentationAnalyticsStart {
	method: 'cloud' | 'native';
	provider?: 'mp3quran' | 'qdc';
	model?: string;
	device?: string;
	applicationMode?: string;
	includeWbwTimestamps?: boolean;
}

export interface SegmentationAnalyticsFinish {
	outcome: 'completed' | 'failed' | 'canceled';
	segmentsApplied?: number;
	lowConfidenceSegments?: number;
	coverageGapSegments?: number;
	cloudGpuFallbackToCpu?: boolean;
}

export interface VideoExportAnalytics {
	videoDurationSeconds?: number;
	videoDimensions?: string;
	videoWidth?: number;
	videoHeight?: number;
	fps?: number;
	format?: string;
	queued?: boolean;
	skippedRangeCount?: number;
	backgroundIncluded?: boolean;
	fileSizeBytes?: number;
	failureStage?: VideoExportFailureStage;
	cancelSource?: 'user' | 'app_close' | 'native';
}

export type VideoExportFailureStage =
	| 'preparing'
	| 'audio'
	| 'frames'
	| 'rendering'
	| 'encoding'
	| 'writing'
	| 'finalizing';

export interface ReflectionAnalyticsProperties {
	surah: number;
	selected_verse_count: number;
	whole_surah: boolean;
	multi_surah_export: boolean;
	mode?: 'private' | 'public';
	authenticated_before_action?: boolean;
}

export class AnalyticsService {
	private static state: AnalyticsState = 'idle';
	private static readonly maxQueuedEvents = 100;
	private static readonly maxTerminalExports = 200;
	private static eventQueue: Array<{ eventName: string; properties?: UnknownRecord }> = [];
	private static terminalVideoExports = new Set<string>();
	private static editorSection: EditorAnalyticsSection | null = null;
	private static editorSectionStartedAt = 0;
	private static onboardingWorkflow: AnalyticsWorkflow | null = null;
	private static quranAuthWorkflow: AnalyticsWorkflow | null = null;
	private static appInstallationTracked = false;
	private static appUpdateTracked = false;
	private static readonly knownAnalyticsModels = new Set([
		'gpt-5.4',
		'gpt-5.4-mini',
		'gpt-5.4-nano',
		'gpt-4o-mini',
		'gemini-3.1-flash-lite',
		'gemini-2.5-flash',
		'z-ai/glm-4.5-air:free',
		'llama-3.3-70b-versatile',
		'deepseek-v4-flash',
		'base',
		'large'
	]);
	private static readonly analyticsLanguages = new Map([
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
	private static readonly forbiddenPropertyParts = [
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
	private static readonly allowedPropertyNames = new Set([
		'ai_selects_content',
		'context',
		'error_type',
		'has_custom_reciter',
		'has_reciter',
		'subtitle_count',
		'subtitles_count',
		'url_source_count'
	]);
	private static readonly blockedPropertyNames = new Set([
		'comment',
		'comments',
		'message',
		'error_message',
		'error_log',
		'log',
		'logs',
		'stack',
		'path',
		'file_path',
		'final_file_path',
		'destination_uri',
		'url',
		'source_url',
		'file_name',
		'project_name',
		'edition_name',
		'edition_author',
		'edition_key',
		'reciter',
		'reciter_id',
		'email',
		'user_id',
		'access_token',
		'refresh_token',
		'token',
		'verifier',
		'client_id',
		'name'
	]);

	/**
	 * Initialise PostHog only for the main mobile application surface.
	 * @returns {Promise<void>} A promise resolved when analytics is ready or disabled.
	 */
	static async init(): Promise<void> {
		if (!browser || this.state !== 'idle') return;
		this.state = 'initializing';

		if (!this.isMainSurface() || !env.PUBLIC_POSTHOG_KEY || !env.PUBLIC_POSTHOG_HOST) {
			this.disable();
			return;
		}

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
				disable_session_recording: true,
				person_profiles: 'identified_only',
				persistence: 'localStorage',
				autocapture: false
			});

			const versionPromise = VersionService.getAppVersion().catch(() => '0.0.0');
			const timeoutPromise = new Promise<string>((resolve) =>
				setTimeout(() => resolve('0.0.0'), 2000)
			);
			const appVersion = await Promise.race([versionPromise, timeoutPromise]);

			posthog.register({
				platform: 'android',
				app_platform: 'mobile',
				analytics_schema_version: 2,
				app_locale: get(locale),
				app_version: appVersion
			});

			this.state = 'ready';
			document.addEventListener('visibilitychange', this.handleVisibilityChange);
			this.flushQueue();
			this.capture('app_opened');
		} catch {
			this.state = 'failed';
			this.eventQueue = [];
			console.warn('Analytics initialization failed');
		}
	}

	/**
	 * Returns whether analytics is running in the top-level application rather than an exporter.
	 * @returns {boolean} Whether the current window is the main application surface.
	 */
	private static isMainSurface(): boolean {
		try {
			return window.top === window && !window.location.pathname.startsWith('/exporter');
		} catch {
			return false;
		}
	}

	/**
	 * Permanently disables analytics for the current application surface.
	 * @returns {void}
	 */
	private static disable(): void {
		this.state = 'disabled';
		this.eventQueue = [];
	}

	/**
	 * Sends queued events after initialization completes.
	 * @returns {void}
	 */
	private static flushQueue(): void {
		if (this.state !== 'ready') return;
		for (const item of this.eventQueue) posthog.capture(item.eventName, item.properties);
		this.eventQueue = [];
	}

	/**
	 * Captures an event or keeps it in the bounded initialization queue.
	 * @param {string} eventName Stable analytics event name.
	 * @param {UnknownRecord | undefined} properties Privacy-safe event properties.
	 * @returns {void}
	 */
	private static capture(eventName: string, properties?: UnknownRecord): void {
		if (!browser || this.state === 'disabled' || this.state === 'failed') return;
		const sanitizedProperties = this.sanitizeProperties({
			...properties,
			app_locale: get(locale)
		});
		if (this.state === 'ready') {
			posthog.capture(eventName, sanitizedProperties);
			return;
		}

		if (this.eventQueue.length >= this.maxQueuedEvents) this.eventQueue.shift();
		this.eventQueue.push({ eventName, properties: sanitizedProperties });
	}

	/**
	 * Removes property names that could carry user content or filesystem details.
	 * @param {UnknownRecord | undefined} properties Candidate analytics properties.
	 * @returns {UnknownRecord | undefined} Sanitized properties, when provided.
	 */
	private static sanitizeProperties(properties?: UnknownRecord): UnknownRecord | undefined {
		if (!properties) return undefined;
		const sanitized = Object.entries(properties).reduce<UnknownRecord>((result, [key, value]) => {
			const normalizedKey = key.toLowerCase();
			if (normalizedKey === 'model') {
				result.model = this.normalizeAnalyticsModel(typeof value === 'string' ? value : undefined);
				return result;
			}
			if (normalizedKey === 'edition_key' && typeof value === 'string') {
				const editionKey = value.trim().toLowerCase();
				const editionSource = this.classifyAnalyticsEdition(editionKey);
				result.edition_source = editionSource;
				if (editionSource === 'quran_api' || editionSource === 'qdc') {
					result.edition_key = editionKey;
				}
				return result;
			}
			if (normalizedKey === 'edition_language') {
				result.edition_language = this.normalizeAnalyticsLanguage(value);
				return result;
			}
			const sanitizedValue = this.sanitizeValue(key, value);
			if (sanitizedValue !== undefined) result[key] = sanitizedValue;
			return result;
		}, {});

		return Object.keys(sanitized).length > 0 ? sanitized : undefined;
	}

	/**
	 * Checks whether a property key can carry identity, secrets, or user-authored content.
	 * @param {string} key Candidate property key.
	 * @returns {boolean} Whether the property must be removed.
	 */
	private static isBlockedPropertyName(key: string): boolean {
		const normalized = key.toLowerCase();
		if (this.allowedPropertyNames.has(normalized)) return false;
		if (
			this.blockedPropertyNames.has(normalized) ||
			normalized === 'name' ||
			normalized.endsWith('_name')
		) {
			return true;
		}
		if (
			normalized.includes('error') &&
			!normalized.endsWith('_code') &&
			!normalized.endsWith('_kind') &&
			!normalized.endsWith('_count')
		) {
			return true;
		}

		return this.forbiddenPropertyParts.some((part) => normalized.includes(part));
	}

	/**
	 * Removes sensitive string values and recursively sanitizes nested containers.
	 * @param {string} key Property key associated with the value.
	 * @param {unknown} value Candidate analytics value.
	 * @returns {unknown} Sanitized value, or undefined when it must be removed.
	 */
	private static sanitizeValue(key: string, value: unknown): unknown {
		if (this.isBlockedPropertyName(key) || value === null || value === undefined) return undefined;
		if (typeof value === 'string') {
			const containsSensitiveValue =
				value.length > 160 ||
				/[\r\n]/.test(value) ||
				/(?:https?:\/\/|content:\/\/|file:\/\/)/i.test(value) ||
				/\bwww\./i.test(value) ||
				/(?:^|\s)[a-z]:[\\/]/i.test(value) ||
				/(?:^|\s)(?:\/[^/\s]+){2,}/.test(value) ||
				/\\\\[^\\/\s]+[\\/][^\\/\s]+/.test(value) ||
				/\.(?:aac|avi|csv|flac|jpeg|jpg|json|m4a|mkv|mov|mp3|mp4|ogg|opus|png|srt|vtt|wav|webm)\b/i.test(
					value
				) ||
				/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/.test(value) ||
				/(?:Bearer\s+|\bAKIA[A-Z0-9]{12,}|\bsk-[A-Za-z0-9_-]{12,}|\bghp_[A-Za-z0-9]{12,}|\beyJ[A-Za-z0-9_-]+\.)/i.test(
					value
				) ||
				/^[A-Za-z0-9_-]{48,}$/.test(value);
			return containsSensitiveValue ? undefined : value;
		}
		if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
		if (typeof value === 'boolean') return value;
		if (Array.isArray(value)) {
			return value
				.map((item) => this.sanitizeValue(key, item))
				.filter((item) => item !== undefined);
		}
		if (value && typeof value === 'object') {
			return this.sanitizeProperties(value as UnknownRecord);
		}
		return undefined;
	}

	/**
	 * Pauses editor timing while the application is hidden and resumes it when visible.
	 * @returns {void}
	 */
	private static readonly handleVisibilityChange = (): void => {
		if (!this.editorSection) return;
		if (document.hidden) {
			if (this.editorSectionStartedAt === 0) return;
			this.capture('editor_section_viewed', {
				section: this.editorSection,
				duration_ms: Math.max(0, Date.now() - this.editorSectionStartedAt),
				timing_segment: 'foreground',
				segment_end: 'backgrounded'
			});
			this.editorSectionStartedAt = 0;
		} else if (this.editorSectionStartedAt === 0) {
			this.editorSectionStartedAt = Date.now();
		}
	};

	/**
	 * Maps editable model input to a bounded analytics dimension.
	 * @param {string | undefined} model Configured model value.
	 * @returns {string} Known model identifier, `custom`, or `unknown`.
	 */
	private static normalizeAnalyticsModel(model?: string): string {
		if (!model?.trim()) return 'unknown';
		const normalized = model.trim().toLowerCase();
		return this.knownAnalyticsModels.has(normalized) ? normalized : 'custom';
	}

	/**
	 * Normalizes an edition language without retaining imported project text.
	 * @param {unknown} value Raw edition language.
	 * @returns {string} Stable language code, other, or unknown.
	 */
	private static normalizeAnalyticsLanguage(value: unknown): string {
		if (typeof value !== 'string' || value.trim().length === 0) return 'unknown';
		return this.analyticsLanguages.get(value.trim().toLowerCase()) ?? 'other';
	}

	/**
	 * Classifies a translation key while allowing stable catalog identifiers.
	 * @param {string | undefined} editionKey Raw translation edition key.
	 * @returns {AnalyticsEditionSource} Stable translation source.
	 */
	private static classifyAnalyticsEdition(editionKey?: string): AnalyticsEditionSource {
		const normalized = editionKey?.trim().toLowerCase() ?? '';
		if (normalized.startsWith('txt-manual-')) return 'manual_txt';
		if (/^qdc-translation-\d+$/.test(normalized)) return 'qdc';
		if (/^[a-z]{2,3}_[a-z0-9_]+$/.test(normalized)) return 'quran_api';
		return 'custom';
	}

	/**
	 * Creates an opaque identifier and start time for a telemetry workflow.
	 * @returns {AnalyticsWorkflow} Opaque workflow metadata.
	 */
	private static createWorkflow(): AnalyticsWorkflow {
		return {
			id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
			startedAt: Date.now()
		};
	}

	/**
	 * Tracks a successfully created project without its name or reciter value.
	 * @param {string | undefined} projectType Stable project type.
	 * @param {boolean} hasReciter Whether a reciter was selected.
	 * @returns {void}
	 */
	static trackProjectCreated(projectType?: string, hasReciter = false): void {
		this.capture('project_created', { project_type: projectType, has_reciter: hasReciter });
	}

	/**
	 * Tracks a successfully opened project using structural counts only.
	 * @param {string | undefined} projectType Stable project type.
	 * @param {number | undefined} assetCount Number of project assets.
	 * @param {number | undefined} subtitleCount Number of subtitle clips.
	 * @param {number | undefined} translationCount Number of translation editions.
	 * @returns {void}
	 */
	static trackProjectOpened(
		projectType?: string,
		assetCount?: number,
		subtitleCount?: number,
		translationCount?: number
	): void {
		this.capture('project_opened', {
			project_type: projectType,
			asset_count: assetCount,
			subtitle_count: subtitleCount,
			translation_count: translationCount
		});
	}

	/**
	 * Tracks a successfully imported project without file or project identifiers.
	 * @param {string | undefined} projectType Stable project type.
	 * @returns {void}
	 */
	static trackProjectImported(projectType?: string): void {
		this.capture('project_imported', { project_type: projectType });
	}

	/**
	 * Tracks a successfully duplicated project without names or identifiers.
	 * @param {string | undefined} projectType Stable project type.
	 * @returns {void}
	 */
	static trackProjectDuplicated(projectType?: string): void {
		this.capture('project_duplicated', { project_type: projectType });
	}

	/**
	 * Tracks a successfully added media asset without filenames, paths, or URLs.
	 * @param {string} source Stable media source.
	 * @param {string} mediaType Stable media type.
	 * @param {boolean} hasNativeTimings Whether native recitation timings are available.
	 * @returns {void}
	 */
	static trackMediaImported(source: string, mediaType: string, hasNativeTimings: boolean): void {
		this.capture('media_imported', {
			source,
			media_type: mediaType,
			has_native_timings: hasNativeTimings
		});
	}

	/**
	 * Starts timing the active editor section and closes the previous section if needed.
	 * @param {EditorAnalyticsSection} section Stable editor section.
	 * @returns {void}
	 */
	static enterEditorSection(section: EditorAnalyticsSection): void {
		if (this.editorSection === section) {
			if (this.editorSectionStartedAt === 0 && !document.hidden) {
				this.editorSectionStartedAt = Date.now();
			}
			return;
		}
		this.leaveEditorSection();
		this.editorSection = section;
		this.editorSectionStartedAt = document.hidden ? 0 : Date.now();
	}

	/**
	 * Finishes timing the current editor section.
	 * @returns {void}
	 */
	static leaveEditorSection(): void {
		if (!this.editorSection) return;
		if (this.editorSectionStartedAt > 0) {
			this.capture('editor_section_viewed', {
				section: this.editorSection,
				duration_ms: Math.max(0, Date.now() - this.editorSectionStartedAt),
				timing_segment: 'foreground',
				segment_end: 'section_exit'
			});
		}
		this.editorSection = null;
		this.editorSectionStartedAt = 0;
	}

	/**
	 * Starts an automatic segmentation workflow.
	 * @param {SegmentationAnalyticsStart} properties Safe segmentation configuration.
	 * @returns {AnalyticsWorkflow} Opaque workflow metadata.
	 */
	static trackSegmentationStarted(properties: SegmentationAnalyticsStart): AnalyticsWorkflow {
		const workflow = this.createWorkflow();
		this.capture('ai_segmentation_started', {
			workflow_id: workflow.id,
			method: properties.method,
			provider: properties.provider,
			model: this.normalizeAnalyticsModel(properties.model),
			device: properties.device,
			application_mode: properties.applicationMode,
			include_wbw_timestamps: properties.includeWbwTimestamps
		});
		return workflow;
	}

	/**
	 * Finishes an automatic segmentation workflow and preserves the successful legacy event.
	 * @param {AnalyticsWorkflow} workflow Opaque workflow metadata.
	 * @param {SegmentationAnalyticsFinish} properties Safe terminal metrics.
	 * @returns {void}
	 */
	static trackSegmentationFinished(
		workflow: AnalyticsWorkflow,
		properties: SegmentationAnalyticsFinish
	): void {
		const payload = {
			workflow_id: workflow.id,
			outcome: properties.outcome,
			duration_ms: Math.max(0, Date.now() - workflow.startedAt),
			segments_applied: properties.segmentsApplied,
			low_confidence_segments: properties.lowConfidenceSegments,
			coverage_gap_segments: properties.coverageGapSegments,
			cloud_gpu_fallback_to_cpu: properties.cloudGpuFallbackToCpu
		};
		this.capture('ai_segmentation_finished', payload);
		if (properties.outcome === 'completed') this.capture('ai_segmentation_used', payload);
	}

	/**
	 * Starts a typed AI editing workflow.
	 * @param {AiAnalyticsStart} properties Safe AI configuration and counts.
	 * @returns {AnalyticsWorkflow} Opaque workflow metadata.
	 */
	static trackAiStarted(properties: AiAnalyticsStart): AnalyticsWorkflow {
		const workflow = this.createWorkflow();
		const eventPrefix =
			properties.feature === 'bold'
				? 'ai_bold'
				: properties.feature === 'wbw_translation'
					? 'ai_wbw_translation'
					: 'ai_translation';
		this.capture(`${eventPrefix}_started`, {
			workflow_id: workflow.id,
			feature: properties.feature,
			mode: properties.mode,
			model: this.normalizeAnalyticsModel(properties.model),
			reasoning_effort: properties.reasoningEffort,
			total_items: properties.totalItems,
			total_batches: properties.totalBatches
		});
		return workflow;
	}

	/**
	 * Finishes a typed AI editing workflow and emits its successful legacy event.
	 * @param {AnalyticsWorkflow} workflow Opaque workflow metadata.
	 * @param {AiAnalyticsStart} start Safe start configuration.
	 * @param {AiAnalyticsFinish} result Safe terminal metrics.
	 * @returns {void}
	 */
	static trackAiFinished(
		workflow: AnalyticsWorkflow,
		start: AiAnalyticsStart,
		result: AiAnalyticsFinish
	): void {
		const eventPrefix =
			start.feature === 'bold'
				? 'ai_bold'
				: start.feature === 'wbw_translation'
					? 'ai_wbw_translation'
					: 'ai_translation';
		const payload = {
			workflow_id: workflow.id,
			feature: start.feature,
			mode: start.mode,
			model: this.normalizeAnalyticsModel(start.model),
			reasoning_effort: start.reasoningEffort,
			outcome: result.outcome,
			duration_ms: Math.max(0, Date.now() - workflow.startedAt),
			total_items: start.totalItems,
			completed_items: result.completedItems,
			failed_items: result.failedItems,
			total_batches: start.totalBatches,
			completed_batches: result.completedBatches,
			failed_batches: result.failedBatches,
			had_errors: result.hadErrors
		};
		this.capture(`${eventPrefix}_finished`, payload);
		if (result.outcome === 'completed') this.capture(`${eventPrefix}_used`, payload);
	}

	/**
	 * Tracks a translation added from a known provider while retaining only a stable catalog key.
	 * @param {AnalyticsEditionSource} source Stable translation source.
	 * @param {string | undefined} language Stable language code.
	 * @param {string | undefined} editionKey Stable catalog edition key.
	 * @returns {void}
	 */
	static trackTranslationAdded(
		source: AnalyticsEditionSource,
		language?: string,
		editionKey?: string
	): void {
		this.capture('translation_added', {
			edition_source: source,
			edition_language: this.normalizeAnalyticsLanguage(language),
			edition_key: editionKey
		});
	}

	/**
	 * Tracks a locally saved style preset without its name.
	 * @param {number} includedStyleCount Number of included custom styles.
	 * @returns {void}
	 */
	static trackStylePresetSaved(includedStyleCount: number): void {
		this.capture('style_preset_saved', {
			source: 'local',
			included_style_count: includedStyleCount
		});
	}

	/**
	 * Tracks an applied style preset without its name or author.
	 * @param {'local' | 'community'} source Stable preset source.
	 * @returns {void}
	 */
	static trackStylePresetApplied(source: 'local' | 'community'): void {
		this.capture('style_preset_applied', { source });
	}

	/**
	 * Tracks a published style preset without its name or description.
	 * @param {number} includedStyleCount Number of included custom styles.
	 * @returns {void}
	 */
	static trackStylePresetPublished(includedStyleCount: number): void {
		this.capture('style_preset_published', {
			included_style_count: includedStyleCount
		});
	}

	/**
	 * Tracks the start of an Android video export.
	 * @param {string} workflowId Persisted opaque workflow identifier.
	 * @param {VideoExportAnalytics} properties Safe export configuration.
	 * @returns {void}
	 */
	static trackVideoExportStarted(workflowId: string, properties: VideoExportAnalytics): void {
		this.terminalVideoExports.delete(workflowId);
		this.capture('video_export_started', {
			workflow_id: workflowId,
			$insert_id: `video-export:${workflowId}:started`,
			video_duration_seconds: properties.videoDurationSeconds,
			video_dimensions: properties.videoDimensions,
			video_width: properties.videoWidth,
			video_height: properties.videoHeight,
			fps: properties.fps,
			format: properties.format,
			queued: properties.queued,
			skipped_range_count: properties.skippedRangeCount,
			background_included: properties.backgroundIncluded
		});
	}

	/**
	 * Tracks one deduplicated terminal transition for an Android video export.
	 * @param {string} workflowId Persisted opaque workflow identifier.
	 * @param {'completed' | 'failed' | 'canceled'} outcome Stable terminal outcome.
	 * @param {number} durationMs Export workflow duration in milliseconds.
	 * @param {VideoExportAnalytics} properties Safe terminal metrics.
	 * @returns {void}
	 */
	static trackVideoExportFinished(
		workflowId: string,
		outcome: 'completed' | 'failed' | 'canceled',
		durationMs: number,
		properties: VideoExportAnalytics
	): void {
		if (this.terminalVideoExports.has(workflowId)) return;
		if (this.terminalVideoExports.size >= this.maxTerminalExports) {
			const oldestWorkflowId = this.terminalVideoExports.values().next().value;
			if (oldestWorkflowId) this.terminalVideoExports.delete(oldestWorkflowId);
		}
		this.terminalVideoExports.add(workflowId);

		const eventName =
			outcome === 'completed'
				? 'video_exported'
				: outcome === 'canceled'
					? 'video_export_canceled'
					: 'video_export_failed';
		this.capture(eventName, {
			workflow_id: workflowId,
			$insert_id: `video-export:${workflowId}:${outcome}`,
			outcome,
			duration_ms: Math.max(0, durationMs),
			video_duration_seconds: properties.videoDurationSeconds,
			video_dimensions: properties.videoDimensions,
			video_width: properties.videoWidth,
			video_height: properties.videoHeight,
			fps: properties.fps,
			format: properties.format,
			file_size_bytes: properties.fileSizeBytes,
			failure_stage: properties.failureStage,
			cancel_source: properties.cancelSource
		});
	}

	/**
	 * Tracks opening the Android share sheet for an exported video without its path.
	 * @returns {void}
	 */
	static trackVideoExportShareOpened(): void {
		this.capture('video_export_share_opened');
	}

	/**
	 * Tracks a detected application update.
	 * @param {string} fromVersion Previous application version.
	 * @param {string} toVersion Current application version.
	 * @returns {void}
	 */
	static trackAppUpdated(fromVersion: string, toVersion: string): void {
		if (this.appUpdateTracked) return;
		this.appUpdateTracked = true;
		this.capture('app_updated', { from_version: fromVersion, to_version: toVersion });
	}

	/**
	 * Tracks the first detected application installation.
	 * @param {string} version Installed application version.
	 * @returns {void}
	 */
	static trackAppInstalled(version: string): void {
		if (this.appInstallationTracked) return;
		this.appInstallationTracked = true;
		this.capture('app_installed', { app_version: version });
	}

	/**
	 * Tracks a successfully submitted review without its comment.
	 * @param {number} rating Submitted numeric rating.
	 * @param {'support_prompt' | 'settings_support' | 'donation_post_export'} source Review entry point.
	 * @returns {void}
	 */
	static trackReview(
		rating: number,
		source: 'support_prompt' | 'settings_support' | 'donation_post_export'
	): void {
		this.capture('review', { rating, source });
	}

	/**
	 * Tracks successfully submitted support feedback without its contents.
	 * @param {'feature' | 'bug'} type Feedback category.
	 * @param {'support_prompt' | 'settings_support' | 'donation_post_export'} source Feedback entry point.
	 * @returns {void}
	 */
	static trackSupportFeedback(
		type: 'feature' | 'bug',
		source: 'support_prompt' | 'settings_support' | 'donation_post_export'
	): void {
		this.capture('support_feedback', { type, source });
	}

	/**
	 * Tracks a post-export support panel impression.
	 * @param {'post_export'} context Stable panel context.
	 * @param {number} quoteIndex Displayed quote index.
	 * @returns {void}
	 */
	static trackSupportPanelImpression(context: 'post_export', quoteIndex: number): void {
		this.capture('support_panel_impression', { context, quote_index: quoteIndex });
	}

	/**
	 * Tracks dismissal of the post-export support panel.
	 * @param {'post_export'} context Stable panel context.
	 * @param {'close' | 'remind_later'} action Dismissal action.
	 * @returns {void}
	 */
	static trackSupportPanelDismissed(
		context: 'post_export',
		action: 'close' | 'remind_later'
	): void {
		this.capture('support_panel_dismissed', { context, action });
	}

	/**
	 * Tracks a call-to-action click in the post-export support panel.
	 * @param {'post_export'} context Stable panel context.
	 * @param {'donate' | 'feedback' | 'discord'} cta Selected call to action.
	 * @returns {void}
	 */
	static trackSupportPanelCtaClicked(
		context: 'post_export',
		cta: 'donate' | 'feedback' | 'discord'
	): void {
		this.capture('support_panel_cta_clicked', { context, cta });
	}

	/**
	 * Tracks a completed subtitle file write.
	 * @param {string} format Subtitle file format.
	 * @param {string[]} includedTargets Local target names used only to derive counts.
	 * @param {Record<string, boolean>} exportVerseNumbers Local verse-number display flags.
	 * @param {number | undefined} subtitlesCount Number of exported subtitles.
	 * @returns {void}
	 */
	static trackSubtitlesExport(
		format: string,
		includedTargets: string[],
		exportVerseNumbers: Record<string, boolean>,
		subtitlesCount?: number
	): void {
		const includesArabic = includedTargets.includes('arabic');
		this.capture('subtitles_exported', {
			format,
			included_target_count: includedTargets.length,
			translation_target_count: includedTargets.length - Number(includesArabic),
			includes_arabic: includesArabic,
			arabic_verse_numbers: Boolean(exportVerseNumbers.arabic),
			translation_verse_numbers_count: includedTargets.filter(
				(target) => target !== 'arabic' && exportVerseNumbers[target] === true
			).length,
			subtitles_count: subtitlesCount
		});
	}

	/**
	 * Tracks a completed YouTube chapter file write.
	 * @param {string} choice Stable chapter grouping choice.
	 * @param {number} chaptersCount Number of written chapters.
	 * @param {number | undefined} exportStartMs Export range start in milliseconds.
	 * @param {number | undefined} exportEndMs Export range end in milliseconds.
	 * @returns {void}
	 */
	static trackYtbChaptersExport(
		choice: string,
		chaptersCount: number,
		exportStartMs?: number,
		exportEndMs?: number
	): void {
		this.capture('ytb_chapters_exported', {
			choice,
			chapters_count: chaptersCount,
			export_start_ms: exportStartMs,
			export_end_ms: exportEndMs
		});
	}

	/**
	 * Tracks a runtime failure without messages, stacks, paths, or logs.
	 * @param {Error} _error Runtime error intentionally excluded from the payload.
	 * @returns {void}
	 */
	static trackError(_error: Error): void {
		this.capture('error', { error_type: 'unexpected' });
	}

	/**
	 * Starts the single active onboarding workflow.
	 * @param {string} locale Current application locale.
	 * @returns {void}
	 */
	static trackOnboardingStarted(locale: string): void {
		this.onboardingWorkflow = this.createWorkflow();
		this.capture('onboarding_started', {
			workflow_id: this.onboardingWorkflow.id,
			locale
		});
	}

	/**
	 * Finishes the active onboarding workflow with its last reached step.
	 * @param {'completed' | 'skipped'} outcome Stable onboarding outcome.
	 * @param {string} locale Current application locale.
	 * @param {number} lastStep One-based last reached step.
	 * @returns {void}
	 */
	static trackOnboardingFinished(
		outcome: 'completed' | 'skipped',
		locale: string,
		lastStep: number
	): void {
		if (!this.onboardingWorkflow) return;
		this.capture('onboarding_finished', {
			workflow_id: this.onboardingWorkflow.id,
			outcome,
			locale,
			last_step: lastStep,
			duration_ms: Math.max(0, Date.now() - this.onboardingWorkflow.startedAt)
		});
		this.onboardingWorkflow = null;
	}

	/**
	 * Starts a Quran.com authorization workflow without user or OAuth data.
	 * @param {number} scopeCount Number of requested scopes.
	 * @returns {void}
	 */
	static trackQuranAuthStarted(scopeCount: number): void {
		this.quranAuthWorkflow = this.createWorkflow();
		this.capture('quran_auth_started', {
			workflow_id: this.quranAuthWorkflow.id,
			scope_count: scopeCount
		});
	}

	/**
	 * Finishes the active Quran.com authorization workflow without identifying the user.
	 * @param {'completed' | 'failed'} outcome Stable authorization outcome.
	 * @param {number} scopeCount Number of granted or requested scopes.
	 * @returns {void}
	 */
	static trackQuranAuthFinished(outcome: 'completed' | 'failed', scopeCount: number): void {
		if (!this.quranAuthWorkflow) return;
		this.capture('quran_auth_finished', {
			workflow_id: this.quranAuthWorkflow.id,
			outcome,
			scope_count: scopeCount,
			duration_ms: Math.max(0, Date.now() - this.quranAuthWorkflow.startedAt)
		});
		this.quranAuthWorkflow = null;
	}

	/**
	 * Tracks local Quran.com disconnection without account identifiers.
	 * @param {number} scopeCount Number of scopes held before disconnection.
	 * @param {'user' | 'session_expired'} reason Stable reason for clearing the session.
	 * @returns {void}
	 */
	static trackQuranAuthDisconnected(scopeCount: number, reason: 'user' | 'session_expired'): void {
		this.capture('quran_auth_disconnected', { scope_count: scopeCount, reason });
	}

	/**
	 * Tracks Quran.com bookmark outcomes without verse, bookmark, or collection IDs.
	 * @param {'add' | 'remove'} action Attempted bookmark action.
	 * @param {number} changeCount Number of successful collection changes.
	 * @param {number} failedCount Number of failed collection changes.
	 * @returns {void}
	 */
	static trackQuranBookmarkChanged(
		action: 'add' | 'remove',
		changeCount: number,
		failedCount: number
	): void {
		this.capture('quran_bookmark_changed', {
			action,
			outcome: changeCount === 0 ? 'failed' : failedCount > 0 ? 'partial' : 'completed',
			change_count: changeCount,
			failed_count: failedCount
		});
	}

	/**
	 * Tracks opening the quick timeline editor by its safe mode only.
	 * @param {'translation' | 'wbw' | 'subtitle' | 'wbwTimestamp'} mode Opened editor mode.
	 * @returns {void}
	 */
	static trackQuickTimelineEditorUsed(
		mode: 'translation' | 'wbw' | 'subtitle' | 'wbwTimestamp'
	): void {
		this.capture('quick_timeline_editor_used', { mode });
	}

	/**
	 * Tracks privacy-safe Quran reflection interaction metadata.
	 * @param {ReflectionAnalyticsEvent} eventName Stable reflection event name.
	 * @param {ReflectionAnalyticsProperties} properties Structural reflection metadata.
	 * @returns {void}
	 */
	static trackReflection(
		eventName: ReflectionAnalyticsEvent,
		properties: ReflectionAnalyticsProperties
	): void {
		this.capture(eventName, { ...properties });
	}
}
