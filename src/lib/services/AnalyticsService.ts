import posthog from 'posthog-js';
import { env } from '$env/dynamic/public';
import { browser } from '$app/environment';
import { VersionService } from './VersionService.svelte';

export class AnalyticsService {
	private static isInitialized = false;
	private static eventQueue: Array<{
		eventName: string;
		properties?: Record<string, any>;
		type: 'capture' | 'identify';
		userId?: string;
	}> = [];

	static async init() {
		if (!browser || this.isInitialized) return;

		if (!env.PUBLIC_POSTHOG_KEY || !env.PUBLIC_POSTHOG_HOST) {
			console.warn('Analytics skipped: Missing PUBLIC_POSTHOG_KEY or PUBLIC_POSTHOG_HOST');
			return;
		}

		try {
			posthog.init(env.PUBLIC_POSTHOG_KEY, {
				api_host: env.PUBLIC_POSTHOG_HOST,
				capture_pageview: false, // We handle this manually in +layout.svelte
				capture_pageleave: false,
				capture_exceptions: false, // Disable auto-capture of console errors (too noisy)
				persistence: 'localStorage',
				autocapture: false // Disable autocapture to keep data clean and focused
			});

			// Register super properties that become part of every event
			// Race strict timeout to prevent blocking init if Tauri IPC hangs
			const versionPromise = VersionService.getAppVersion();
			const timeoutPromise = new Promise<string>((resolve) =>
				setTimeout(() => resolve('0.0.0'), 2000)
			);
			const appVersion = await Promise.race([versionPromise, timeoutPromise]);

			posthog.register({
				app_version: appVersion
			});

			this.isInitialized = true;

			// Flush the event queue
			this.flushQueue();
		} catch (error) {
			console.warn('Analytics initialization failed:', error);
		}
	}

	private static flushQueue() {
		if (!this.isInitialized) return;

		while (this.eventQueue.length > 0) {
			const item = this.eventQueue.shift();
			if (item) {
				if (item.type === 'identify' && item.userId) {
					posthog.identify(item.userId);
				} else if (item.type === 'capture') {
					posthog.capture(item.eventName, item.properties);
				}
			}
		}
	}

	static identify(userId: string) {
		if (!this.isInitialized) {
			this.eventQueue.push({ eventName: '', type: 'identify', userId });
			return;
		}
		posthog.identify(userId);
	}

	static track(eventName: string, properties?: Record<string, any>) {
		if (!this.isInitialized) {
			this.eventQueue.push({ eventName, properties, type: 'capture' });
			return;
		}
		posthog.capture(eventName, properties);
	}

	private static sanitizeStack(stack?: string): string | undefined {
		if (!stack) return undefined;
		// Replace absolute paths (e.g., C:/Users/User or /home/user) with [REDACTED_PATH]
		// This regex looks for typical windows drive paths or unix home paths involved in stack traces
		return stack.replace(
			/(?:[a-zA-Z]:\\|[\\/])(?:Users|home)[\\/][^\\/]+[\\/]/gi,
			'[REDACTED_PATH]/'
		);
	}

	// Specific typed events

	static trackProjectCreated(name: string, reciterId: string) {
		this.track('project_created', {
			project_name: name,
			reciter_id: reciterId
		});
	}

	/**
	 * Track when a video is exported
	 * @param videoDurationSeconds Duration of the exported video
	 * @param verseRange Optional verse range string
	 */
	static trackExport(
		videoDurationSeconds?: number,
		verseRange?: string,
		videoDimensions?: string,
		fps?: number
	) {
		this.track('video_exported', {
			video_duration_seconds: videoDurationSeconds,
			verse_range: verseRange,
			video_dimensions: videoDimensions,
			fps: fps
		});
	}

	/**
	 * Track AI usage (translation, segmentation).
	 * Supports either a simple range string or a full properties object.
	 * @param feature 'translation' | 'segmentation'
	 * @param rangeOrProperties The verse range (e.g. "2:1-5") or full properties
	 * @param provider Optional provider when using a range string
	 */
	static trackAIUsage(
		feature: 'translation' | 'segmentation',
		rangeOrProperties?: string | Record<string, any>,
		provider?: string
	) {
		if (typeof rangeOrProperties === 'string' || rangeOrProperties === undefined) {
			this.track('ai_feature_used', {
				feature,
				range: rangeOrProperties,
				provider
			});
			return;
		}

		this.track('ai_feature_used', {
			feature,
			...rangeOrProperties
		});
	}

	static trackSubtitleAdded(surah?: string | number) {
		this.track('subtitle_added', {
			surah
		});
	}

	static trackTranslationAdded(
		editionName: string,
		author: string,
		editionKey?: string,
		language?: string
	) {
		this.track('translation_added', {
			edition_name: editionName,
			edition_author: author,
			edition_key: editionKey,
			edition_language: language
		});
	}

	static trackAppUpdated(fromVersion: string, toVersion: string) {
		this.track('app_updated', {
			from_version: fromVersion,
			to_version: toVersion
		});
	}

	static trackAppInstalled(version: string) {
		this.track('app_installed', {
			app_version: version
		});
	}

	static trackSubtitlesExport(
		format: string,
		includedTargets: string[],
		exportVerseNumbers: Record<string, boolean>,
		subtitlesCount?: number
	) {
		this.track('subtitles_exported', {
			format,
			included_targets: includedTargets,
			export_verse_numbers: exportVerseNumbers,
			subtitles_count: subtitlesCount
		});
	}

	static trackYtbChaptersExport(
		choice: string,
		chaptersCount: number,
		exportStartMs?: number,
		exportEndMs?: number
	) {
		this.track('ytb_chapters_exported', {
			choice,
			chapters_count: chaptersCount,
			export_start_ms: exportStartMs,
			export_end_ms: exportEndMs
		});
	}

	static trackError(error: Error) {
		this.track('error', {
			name: error.name,
			message: error.message,
			stack: this.sanitizeStack(error.stack)
		});
	}

	static trackExportError(data: string, errorLog: string) {
		this.track('export_error', {
			export_id: data,
			error_log: errorLog
		});
	}

	static downloadFromMP3Quran(reciter: string, surah: string, fileName: string) {
		this.track('download_from_mp3quran', {
			reciter,
			surah,
			file_name: fileName
		});
	}

	static downloadFromYouTube(url: string, type: string) {
		this.track('download_from_youtube', {
			url,
			type
		});
	}
}
