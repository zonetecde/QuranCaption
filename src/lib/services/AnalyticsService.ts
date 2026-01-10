import posthog from 'posthog-js';
import { PUBLIC_POSTHOG_KEY, PUBLIC_POSTHOG_HOST } from '$env/static/public';
import { browser } from '$app/environment';
import { VersionService } from './VersionService.svelte';

export class AnalyticsService {
    private static isInitialized = false;

    static async init() {
        if (!browser || this.isInitialized) return;

        try {
            posthog.init(PUBLIC_POSTHOG_KEY, {
                api_host: PUBLIC_POSTHOG_HOST,
                capture_pageview: false, // We handle this manually in +layout.svelte
                capture_pageleave: false,
                capture_exceptions: true, // Error tracking matches user preference
                persistence: 'localStorage',
                autocapture: false // Disable autocapture to keep data clean and focused
            });

            // Register super properties that become part of every event
            const appVersion = await VersionService.getAppVersion();
            posthog.register({
                app_version: appVersion
            });

            this.isInitialized = true;
        } catch (error) {
            console.warn('Analytics initialization failed:', error);
        }
    }

    static identify(userId: string) {
        if (!this.isInitialized) return;
        posthog.identify(userId);
    }

    static track(eventName: string, properties?: Record<string, any>) {
        if (!this.isInitialized) return;
        posthog.capture(eventName, properties);
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
    static trackExport(videoDurationSeconds?: number, verseRange?: string, videoDimensions?: string, fps?: number) {
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

    static trackTranslationAdded(editionName: string, author: string, editionKey?: string, language?: string) {
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
            stack: error.stack
        });
    }
}
