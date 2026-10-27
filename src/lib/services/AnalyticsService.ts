import posthog from 'posthog-js';
import { env } from '$env/dynamic/public';
import { browser } from '$app/environment';
import { VersionService } from './VersionService.svelte';
import type { UnknownRecord } from '$lib/types/common';

type SubtitleAiAction =
	| 'transcription'
	| 'transcription_correction'
	| 'subtitle_rearrangement'
	| 'reference_detection';

export class AnalyticsService {
	private static isInitialized = false;
	private static eventQueue: Array<{
		eventName: string;
		properties?: UnknownRecord;
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
				app_name: 'Minbar Caption',
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

	static track(eventName: string, properties?: UnknownRecord) {
		properties = { ...properties, app_name: 'Minbar Caption' };
		if (!this.isInitialized) {
			this.eventQueue.push({ eventName, properties, type: 'capture' });
			return;
		}
		posthog.capture(eventName, properties);
	}

	/**
	 * Tracks a subtitle AI request without sending its text, prompts or API keys.
	 * @template T
	 * @param {SubtitleAiAction} action Subtitle tool being used.
	 * @param {AbortSignal} signal Cancellation signal owned by the modal.
	 * @param {() => Promise<T>} request Existing operation to run.
	 * @param {UnknownRecord} properties Non-sensitive provider and option metadata.
	 * @returns {Promise<T>} Original result, preserving failures and cancellation.
	 */
	static async trackSubtitleAiRequest<T>(
		action: SubtitleAiAction,
		signal: AbortSignal,
		request: () => Promise<T>,
		properties: UnknownRecord = {}
	): Promise<T> {
		signal.throwIfAborted();
		const startedAt = Date.now();
		const metadata = { ...properties, workflow_id: crypto.randomUUID() };
		let finished = false;
		/**
		 * Records exactly one terminal event, including immediate modal cancellation.
		 * @param {'completed' | 'failed' | 'canceled'} outcome Request outcome.
		 * @returns {void}
		 */
		const finish = (outcome: 'completed' | 'failed' | 'canceled'): void => {
			if (finished) return;
			finished = true;
			this.track(`ai_${action}_${outcome}`, {
				...metadata,
				duration_ms: Date.now() - startedAt
			});
		};
		const onAbort = finish.bind(null, 'canceled');
		this.track(`ai_${action}_started`, metadata);
		signal.addEventListener('abort', onAbort, { once: true });
		try {
			const result = await request();
			signal.throwIfAborted();
			finish('completed');
			return result;
		} catch (error) {
			finish(signal.aborted ? 'canceled' : 'failed');
			throw error;
		} finally {
			signal.removeEventListener('abort', onAbort);
		}
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

	static trackProjectCreated(name: string, speaker: string, projectType?: string) {
		this.track('project_created', {
			project_name: name,
			speaker,
			project_type: projectType
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

	/** Track AI translation usage (legacy or advanced). */
	static trackTranslationUsage(rangeOrProperties?: string | UnknownRecord, provider?: string) {
		if (typeof rangeOrProperties === 'string' || rangeOrProperties === undefined) {
			this.track('ai_translation_used', {
				range: rangeOrProperties,
				provider
			});
			return;
		}

		this.track('ai_translation_used', {
			...rangeOrProperties
		});
	}

	/** Track AI bold usage. */
	static trackAiBoldUsage(rangeOrProperties?: string | UnknownRecord, provider?: string) {
		if (typeof rangeOrProperties === 'string' || rangeOrProperties === undefined) {
			this.track('ai_bold_used', {
				range: rangeOrProperties,
				provider
			});
			return;
		}

		this.track('ai_bold_used', {
			...rangeOrProperties
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

	static trackReview(
		rating: number,
		comment: string,
		source: 'support_prompt' | 'settings_support' | 'donation_post_export'
	) {
		this.track('review', {
			rating,
			comment,
			source,
			created_at_iso: new Date().toISOString()
		});
	}

	static trackSupportPanelImpression(context: 'post_export', quoteIndex: number) {
		this.track('support_panel_impression', {
			context,
			quote_index: quoteIndex,
			created_at_iso: new Date().toISOString()
		});
	}

	static trackSupportPanelDismissed(context: 'post_export', action: 'close' | 'remind_later') {
		this.track('support_panel_dismissed', {
			context,
			action,
			created_at_iso: new Date().toISOString()
		});
	}

	static trackSupportPanelCtaClicked(
		context: 'post_export',
		cta: 'donate' | 'feedback' | 'discord'
	) {
		this.track('support_panel_cta_clicked', {
			context,
			cta,
			created_at_iso: new Date().toISOString()
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

	static downloadFromMP3Quran(speaker: string, surah: string, fileName: string) {
		this.track('download_from_mp3quran', {
			speaker,
			surah,
			file_name: fileName
		});
	}

	static downloadRecitationAudio(source: string, speaker: string, surah: string, fileName: string) {
		this.track('download_recitation_audio', {
			source,
			speaker,
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
