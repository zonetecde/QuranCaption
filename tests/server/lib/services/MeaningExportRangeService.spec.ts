import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
	Project,
	ProjectContent,
	ProjectDetail,
	SilenceClip,
	SubtitleClip,
	Timeline
} from '$lib/classes';
import { SubtitleTrack } from '$lib/classes/Track.svelte';
import Settings from '$lib/classes/Settings.svelte';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';
import { globalState } from '$lib/runes/main.svelte';
import { ManualAiSession } from '$lib/services/ManualAiSession.svelte';
import {
	generateMeaningExportRanges,
	validateMeaningExportRanges
} from '$lib/services/MeaningExportRangeService';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const originalSettings = globalState.settings;
const segments = [
	{ id: 1, start: 1000, end: 11000, text: 'The question.' },
	{ id: 2, start: 21000, end: 91000, text: 'Its explanation and conclusion.' },
	{ id: 3, start: 100000, end: 120000, text: 'Another complete idea.' }
];
const proposal = {
	from: 1,
	to: 2,
	title: 'The question and its answer',
	context: 'Includes the question, explanation and conclusion.'
};
let project: Project;
let track: SubtitleTrack;

beforeEach(() => {
	loadLocale('en');
	setLocale('en');
	globalState.settings = new Settings();
	globalState.settings.aiTranslationSettings.openAiApiKey = 'test-key';
	track = new SubtitleTrack();
	track.clips = segments.map(
		(segment) => new SubtitleClip(segment.start, segment.end, segment.text)
	);
	track.clips.splice(1, 0, new SilenceClip(11000, 21000));
	project = new Project(
		new ProjectDetail('Talk', 'Speaker'),
		new ProjectContent(new Timeline([track]))
	);
	globalState.currentProject = project;
	vi.mocked(invoke).mockResolvedValue({ ranges: [proposal] });
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.mocked(invoke).mockReset();
	globalState.settings = originalSettings;
	globalState.currentProject = null;
});

describe('meaning excerpt validation', () => {
	test('keeps a complete 90-second range including the intervening silence', () => {
		expect(validateMeaningExportRanges({ ranges: [proposal] }, segments, 90)).toEqual([
			{
				id: '1-2',
				startTime: 1000,
				endTime: 91000,
				title: proposal.title,
				context: proposal.context
			}
		]);
		expect(() => validateMeaningExportRanges({ ranges: [proposal] }, segments, 89)).toThrow();
	});

	test.each([
		{ from: 0 },
		{ to: 4 },
		{ from: 2, to: 1 },
		{ from: 1.5 },
		{ to: '2' },
		{ title: ' ' },
		{ context: '' }
	])('rejects invented or malformed boundaries and missing context: %j', (change) => {
		expect(() =>
			validateMeaningExportRanges({ ranges: [{ ...proposal, ...change }] }, segments, 90)
		).toThrow();
	});

	test('rejects overlapping, duplicated and reordered excerpts', () => {
		for (const ranges of [
			[proposal, proposal],
			[proposal, { ...proposal, from: 2, to: 3 }],
			[{ ...proposal, from: 3, to: 3 }, proposal]
		])
			expect(() => validateMeaningExportRanges({ ranges }, segments, 200)).toThrow();
	});

	test('allows skipped material and an empty result when no complete idea fits', () => {
		expect(validateMeaningExportRanges({ ranges: [] }, segments, 90)).toEqual([]);
		expect(
			validateMeaningExportRanges({ ranges: [{ ...proposal, from: 3, to: 3 }] }, segments, 90)
		).toHaveLength(1);
	});
});

test('sends the entire chronological transcript and never mutates the project', async () => {
	const snapshot = JSON.stringify(project.toJSON());
	const result = await generateMeaningExportRanges(
		project,
		90,
		new AbortController().signal,
		undefined,
		' Focus on patience. '
	);
	expect(result.ranges).toHaveLength(1);
	expect(invoke).toHaveBeenCalledWith('suggest_meaning_export_ranges', {
		request: expect.objectContaining({
			batch: {
				language: 'en',
				maxDurationSeconds: 90,
				additionalPreferences: 'Focus on patience.',
				segments
			}
		})
	});
	expect(JSON.stringify(project.toJSON())).toBe(snapshot);
	(track.clips[0] as SubtitleClip).text = 'Changed question';
	expect(result.assertCurrent).toThrow('changed');
});

test('rejects a late API response after cancellation or a transcript edit', async () => {
	const controller = new AbortController();
	vi.mocked(invoke).mockImplementation(async () => {
		controller.abort();
		return { ranges: [proposal] };
	});
	await expect(generateMeaningExportRanges(project, 90, controller.signal)).rejects.toThrow();
	vi.mocked(invoke).mockImplementation(async () => {
		track.clips.push(new SubtitleClip(130000, 140000, 'New context'));
		return { ranges: [proposal] };
	});
	await expect(
		generateMeaningExportRanges(project, 90, new AbortController().signal)
	).rejects.toThrow('changed');
});

test('validates and retries a manual reply without making an API request', async () => {
	globalState.settings!.aiTranslationSettings.openAiApiKey = '';
	vi.mocked(invoke).mockResolvedValue('Instructions for complete excerpts');
	const session = new ManualAiSession();
	session.start();
	const result = generateMeaningExportRanges(
		project,
		90,
		new AbortController().signal,
		session,
		'Focus on practical advice.'
	);
	await vi.waitFor(() => expect(session.steps).toHaveLength(1));
	const step = session.steps[0];
	const requestId = step.prompt.match(/"requestId":"([^"]+)"/)![1];
	step.response = JSON.stringify({ requestId, result: { ranges: [{ ...proposal, to: 3 }] } });
	session.submit();
	expect(step.status).toBe('waiting');
	expect(step.error).toContain('overlong');
	step.response = JSON.stringify({ requestId, result: { ranges: [proposal] } });
	session.submit();
	await expect(result).resolves.toMatchObject({ ranges: [{ startTime: 1000, endTime: 91000 }] });
	expect(invoke).toHaveBeenCalledTimes(1);
	expect(invoke).toHaveBeenCalledWith('prepare_manual_ai_prompt', {
		kind: 'suggest_meaning_export_ranges',
		request: {
			batch: {
				language: 'en',
				maxDurationSeconds: 90,
				additionalPreferences: 'Focus on practical advice.',
				segments
			}
		}
	});
});
