import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AutoSegmentationResult } from '$lib/services/AutoSegmentation';
import { AnalyticsService, type AnalyticsWorkflow } from '$lib/services/AnalyticsService';
import {
	buildSegmentationAnalyticsProperties,
	getSegmentationAnalyticsModel,
	trackSegmentationRun,
	type SegmentationAnalyticsParams
} from '$lib/components/projectEditor/tabs/subtitlesEditor/modal/autoSegmentation/helpers/analytics';

const params: SegmentationAnalyticsParams = {
	requestedMode: 'api',
	runtime: 'cloud',
	version: 'multi_v2',
	model: 'stable-model',
	device: 'cpu',
	minSilenceMs: 200,
	minSpeechMs: 1000,
	padMs: 100,
	includeWordByWord: true,
	fillBySilence: true,
	extendBeforeSilence: false,
	extendBeforeSilenceMs: 50
};

afterEach(() => vi.restoreAllMocks());

describe('segmentation analytics', () => {
	it('uses stable identifiers for Surah Splitter and Quran word timing', () => {
		expect(
			getSegmentationAnalyticsModel('surah_splitter', 'Base Quran', 'SurahSplitter-Base-Quran')
		).toBe('SurahSplitter-Base-Quran');
		expect(getSegmentationAnalyticsModel('quran_word_timing', 'Quran Word Timing', 'Base')).toBe(
			'quran_word_timing'
		);
	});

	it('builds structural properties without audio, filename, token, or free-text fields', () => {
		const properties = buildSegmentationAnalyticsProperties(params);
		const serialized = JSON.stringify(properties);

		expect(properties).toMatchObject({
			provider: 'cloud_v2',
			input_source: 'cloud',
			requested_mode: 'api',
			include_word_by_word: true
		});
		expect(serialized).not.toMatch(/audio|filename|token|message|error/i);
	});

	it('maps failures to a safe terminal status without forwarding the raw error message', () => {
		const workflow: AnalyticsWorkflow = { workflowId: 'segmentation-1', startedAt: 1 };
		const usage = vi
			.spyOn(AnalyticsService, 'trackSegmentationUsage')
			.mockImplementation(() => undefined);
		const response = {
			status: 'failed',
			message: 'Private file C:\\Users\\person\\recording.mp3 failed'
		} as AutoSegmentationResult;

		trackSegmentationRun(workflow, response, params);

		expect(usage).toHaveBeenCalledWith(
			workflow,
			'failed',
			expect.objectContaining({ provider: 'cloud_v2' })
		);
		expect(JSON.stringify(usage.mock.calls[0][2])).not.toContain('Private file');
	});

	it('does not include the detected verse range in a completed terminal event', () => {
		const workflow: AnalyticsWorkflow = { workflowId: 'segmentation-1', startedAt: 1 };
		const usage = vi
			.spyOn(AnalyticsService, 'trackSegmentationUsage')
			.mockImplementation(() => undefined);
		const response = {
			status: 'completed',
			verseRange: { parts: [{ surah: 1, verseStart: 1, verseEnd: 7 }] }
		} as AutoSegmentationResult;

		trackSegmentationRun(workflow, response, params);

		expect(usage.mock.calls[0][2]).not.toHaveProperty('range');
	});
});
