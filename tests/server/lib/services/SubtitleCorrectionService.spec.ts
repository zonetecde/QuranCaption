import { afterEach, beforeEach, expect, test, vi } from 'vitest';
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
import { initializeClassRegistry } from '$lib/classes/ClassRegistry';
import Settings from '$lib/classes/Settings.svelte';
import { VerseTranslation } from '$lib/classes/Translation.svelte';
import { globalState } from '$lib/runes/main.svelte';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import { ManualAiSession } from '$lib/services/ManualAiSession.svelte';
import { markClipAsVerified } from '$lib/classes/Clip.svelte';
import {
	applySubtitleCorrections,
	correctSubtitleCorrectionWarning,
	detectSubtitleCorrections
} from '$lib/services/SubtitleCorrectionService';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const originalSettings = globalState.settings;
let track: SubtitleTrack;
let project: Project;

/**
 * Produit une correction complète pour tester les réponses du fournisseur.
 * @param {Record<string, unknown>} values Champs à remplacer.
 * @returns {Record<string, unknown>} Proposition IA.
 */
function correction(values: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: 1,
		before: 'He read a massage.',
		after: 'He read a message.',
		reason: 'Likely word confusion in context.',
		confidence: 0.99,
		...values
	};
}

beforeEach(() => {
	loadLocale('en');
	setLocale('en');
	initializeClassRegistry();
	track = new SubtitleTrack();
	track.clips = [new SubtitleClip(1000, 3000, 'He read a massage.')];
	project = new Project(
		new ProjectDetail('Corrections', 'speaker'),
		new ProjectContent(new Timeline([track]))
	);
	globalState.currentProject = project;
	globalState.settings = new Settings();
	globalState.settings.aiTranslationSettings.openAiApiKey = 'personal-key';
	vi.spyOn(project.detail, 'updateVideoDetailAttributes').mockImplementation(() => {});
	vi.spyOn(globalState, 'updateVideoPreviewUI').mockImplementation(() => {});
	vi.mocked(invoke).mockResolvedValue({ corrections: [correction()] });
	ProjectHistoryManager.resetForCurrentProject();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.mocked(invoke).mockReset();
	ProjectHistoryManager.clear();
	globalState.currentProject = null;
	globalState.settings = originalSettings;
});

test('rejects stale and invalid manual corrections before retrying without a key', async () => {
	globalState.settings!.aiTranslationSettings.openAiApiKey = '';
	vi.mocked(invoke).mockResolvedValue('Correction instructions');
	const session = new ManualAiSession();
	session.start();
	const result = detectSubtitleCorrections(project, new AbortController().signal, vi.fn(), session);
	await vi.waitFor(() => expect(session.steps).toHaveLength(1));
	const step = session.steps[0];
	const requestId = step.prompt.match(/"requestId":"([^"]+)"/)![1];
	track.clips.push(new SubtitleClip(4000, 6000, 'A new subtitle'));
	step.response = JSON.stringify({ requestId, result: { corrections: [correction()] } });
	session.submit();
	expect(step.error).toContain('changed');
	track.clips.pop();
	step.response = JSON.stringify({
		requestId,
		result: { corrections: [correction({ before: 'Wrong source' })] }
	});
	session.submit();
	expect(step.status).toBe('waiting');
	step.response = JSON.stringify({ requestId, result: { corrections: [correction()] } });
	session.submit();
	const plan = await result;
	expect(plan.proposals).toHaveLength(1);
	expect((track.clips[0] as SubtitleClip).text).toBe('He read a massage.');
	expect(invoke).toHaveBeenCalledTimes(1);
	expect(invoke).toHaveBeenCalledWith(
		'prepare_manual_ai_prompt',
		expect.objectContaining({ request: expect.not.objectContaining({ apiKey: expect.anything() }) })
	);
	applySubtitleCorrections(project, plan, [1]);
	expect((track.clips[0] as SubtitleClip).text).toBe('He read a message.');
	ProjectHistoryManager.undo();
	expect((globalState.getSubtitleTrack.clips[0] as SubtitleClip).text).toBe('He read a massage.');
});

test.each([
	{ mode: 'api', enabled: undefined },
	{ mode: 'api', enabled: true },
	{ mode: 'api', enabled: false },
	{ mode: 'manual', enabled: undefined },
	{ mode: 'manual', enabled: true },
	{ mode: 'manual', enabled: false }
])(
	'passes phonetic Arabic conversion preference via $mode with enabled=$enabled',
	async ({ mode, enabled }) => {
		const session = mode === 'manual' ? new ManualAiSession() : undefined;
		if (session) {
			globalState.settings!.aiTranslationSettings.openAiApiKey = '';
			vi.mocked(invoke).mockResolvedValue('Correction instructions');
			session.start();
		} else vi.mocked(invoke).mockResolvedValue({ corrections: [] });
		const detecting = detectSubtitleCorrections(
			project,
			new AbortController().signal,
			vi.fn(),
			session,
			enabled
		);
		if (session) {
			await vi.waitFor(() => expect(session.steps).toHaveLength(1));
			const step = session.steps[0];
			const requestId = step.prompt.match(/"requestId":"([^"]+)"/)![1];
			step.response = JSON.stringify({ requestId, result: { corrections: [] } });
			session.submit();
		}
		await detecting;
		expect(invoke).toHaveBeenCalledWith(
			session ? 'prepare_manual_ai_prompt' : 'detect_subtitle_corrections',
			expect.objectContaining({
				request: expect.objectContaining({
					batch: expect.objectContaining({ convertArabicPhonetics: enabled ?? true })
				})
			})
		);
	}
);

test('previews Arabic script conversion and applies it with undo while resetting changed word alignment', async () => {
	const clip = track.clips[0] as SubtitleClip;
	clip.text = 'alhamdoulilah rabbi alameen';
	clip.alignmentMetadata = {
		source: 'api',
		matchedText: clip.text,
		timeFrom: 1,
		timeTo: 3,
		words: clip.text
			.split(' ')
			.map((word, index) => ({ word, start: index * 0.5, end: (index + 1) * 0.5 }))
	};
	vi.mocked(invoke).mockResolvedValue({
		corrections: [correction({ before: clip.text, after: 'الحمد لله رب العالمين' })]
	});
	const plan = await detectSubtitleCorrections(project, new AbortController().signal, vi.fn());
	expect(clip.text).toBe('alhamdoulilah rabbi alameen');
	applySubtitleCorrections(project, plan, [1]);
	expect(clip.text).toBe('الحمد لله رب العالمين');
	expect(clip.startTime).toBe(1000);
	expect(clip.endTime).toBe(3000);
	expect(clip.alignmentMetadata.words).toEqual([]);
	ProjectHistoryManager.undo();
	expect((globalState.getSubtitleTrack.clips[0] as SubtitleClip).text).toBe(
		'alhamdoulilah rabbi alameen'
	);
	expect(
		(globalState.getSubtitleTrack.clips[0] as SubtitleClip).alignmentMetadata?.words
	).toHaveLength(3);
	ProjectHistoryManager.redo();
	expect((globalState.getSubtitleTrack.clips[0] as SubtitleClip).text).toBe(
		'الحمد لله رب العالمين'
	);
});

test('previews changes without mutation and applies only approved subtitles in one undoable action', async () => {
	const first = track.clips[0] as SubtitleClip;
	first.alignmentMetadata = {
		source: 'api',
		matchedText: first.text,
		timeFrom: 1,
		timeTo: 3,
		words: [{ word: 'massage.', start: 0, end: 2 }]
	};
	first.translations.english = new VerseTranslation('Il a lu un message.', 'reviewed');
	const second = new SubtitleClip(4000, 6000, 'He rote it.');
	const silence = new SilenceClip(3001, 3999);
	track.clips.push(silence, second);
	vi.mocked(invoke).mockResolvedValue({
		corrections: [correction(), correction({ id: 2, before: second.text, after: 'He wrote it.' })]
	});
	const plan = await detectSubtitleCorrections(project, new AbortController().signal, vi.fn());
	expect(first.text).toBe('He read a massage.');
	expect(first.alignmentMetadata.words).toHaveLength(1);
	expect(applySubtitleCorrections(project, plan, [1])).toBe(1);
	expect(first.text).toBe('He read a message.');
	expect(second.text).toBe('He rote it.');
	expect(first.alignmentMetadata.words).toEqual([]);
	expect(first.alignmentMetadata.matchedText).toBe(first.text);
	expect(first.translations.english.text).toBe('Il a lu un message.');
	expect([first.startTime, first.endTime, silence.startTime, silence.endTime]).toEqual([
		1000, 3000, 3001, 3999
	]);
	ProjectHistoryManager.undo();
	const restored = globalState.getSubtitleTrack.clips[0] as SubtitleClip;
	expect(restored.text).toBe('He read a massage.');
	expect(restored.alignmentMetadata?.words).toHaveLength(1);
	ProjectHistoryManager.redo();
	expect((globalState.getSubtitleTrack.clips[0] as SubtitleClip).text).toBe('He read a message.');
});

test('routes uncertain corrections to editable warnings and omits unchanged proposals', async () => {
	vi.mocked(invoke).mockResolvedValue({ corrections: [correction({ confidence: 0.97 })] });
	const plan = await detectSubtitleCorrections(project, new AbortController().signal, vi.fn());
	expect(plan.proposals).toEqual([]);
	expect(plan.warnings).toMatchObject([{ id: 1, suggestion: 'He read a message.' }]);
	expect((track.clips[0] as SubtitleClip).needsReview).toBe(true);
	vi.mocked(invoke).mockResolvedValue({
		corrections: [correction({ after: 'He read a massage.' })]
	});
	expect(
		(await detectSubtitleCorrections(project, new AbortController().signal, vi.fn())).proposals
	).toEqual([]);
	expect(project.projectEditorState.subtitlesEditor.completedAiSteps.correction).toBe(true);
	ProjectHistoryManager.undo();
	expect(globalState.getSubtitlesEditorState.completedAiSteps.correction).toBe(false);
	ProjectHistoryManager.redo();
	expect(globalState.getSubtitlesEditorState.completedAiSteps.correction).toBe(true);
});

test.each(['api', 'manual'])(
	'persists suspected transcription warnings without applying a correction via %s',
	async (mode) => {
		loadLocale('fr');
		setLocale('fr');
		const clip = track.clips[0] as SubtitleClip;
		clip.hasBeenVerified = true;
		const response = {
			corrections: [],
			warnings: [
				{
					id: 1,
					text: clip.text,
					suggestion: 'He read a message.',
					reason: 'Wording is garbled; listen to the recording.'
				}
			]
		};
		const session = mode === 'manual' ? new ManualAiSession() : undefined;
		if (session) {
			globalState.settings!.aiTranslationSettings.openAiApiKey = '';
			vi.mocked(invoke).mockResolvedValue('Correction instructions');
			session.start();
		} else vi.mocked(invoke).mockResolvedValue(response);
		const detecting = detectSubtitleCorrections(
			project,
			new AbortController().signal,
			vi.fn(),
			session
		);
		if (session) {
			await vi.waitFor(() => expect(session.steps).toHaveLength(1));
			const step = session.steps[0];
			const requestId = step.prompt.match(/"requestId":"([^"]+)"/)![1];
			step.response = JSON.stringify({
				requestId,
				result: { corrections: [], warnings: [{ ...response.warnings[0], suggestion: '' }] }
			});
			session.submit();
			expect(step.status).toBe('waiting');
			expect(step.error).not.toBe('');
			expect(clip.needsReview).toBe(false);
			step.response = JSON.stringify({ requestId, result: response });
			session.submit();
		}
		const plan = await detecting;
		expect(invoke).toHaveBeenCalledWith(
			session ? 'prepare_manual_ai_prompt' : 'detect_subtitle_corrections',
			expect.objectContaining({
				request: expect.objectContaining({ batch: expect.objectContaining({ language: 'fr' }) })
			})
		);
		expect(plan.proposals).toEqual([]);
		expect(plan.warnings).toHaveLength(1);
		expect(plan.warnings[0].suggestion).toBe('He read a message.');
		expect(clip.text).toBe('He read a massage.');
		expect(clip.needsReview).toBe(true);
		expect(clip.hasBeenVerified).toBe(false);
		const restored = Project.fromJSON(project.toJSON()) as Project;
		expect(
			(restored.content.timeline.getFirstTrack(track.type).clips[0] as SubtitleClip).needsReview
		).toBe(true);
		expect(ProjectHistoryManager.undo()).toBe(true);
		expect((globalState.getSubtitleTrack.clips[0] as SubtitleClip).needsReview).toBe(false);
		ProjectHistoryManager.redo();
		expect((globalState.getSubtitleTrack.clips[0] as SubtitleClip).needsReview).toBe(true);
	}
);

test('can correct a warning and still apply another correction without losing pending warnings', async () => {
	const second = new SubtitleClip(4000, 6000, 'Garbled wording');
	const third = new SubtitleClip(7000, 9000, 'Other garbled wording');
	track.clips.push(second, third);
	vi.mocked(invoke).mockResolvedValue({
		corrections: [correction()],
		warnings: [second, third].map((clip, index) => ({
			id: index + 2,
			text: clip.text,
			suggestion: 'He read a message.',
			reason: 'Listen to confirm these words.'
		}))
	});
	const plan = await detectSubtitleCorrections(project, new AbortController().signal, vi.fn());
	correctSubtitleCorrectionWarning(plan, 2, 'Corrected wording');
	expect(second.text).toBe('Corrected wording');
	expect(second.needsReview).toBe(true);
	expect(third.hasBeenVerified).toBe(false);
	applySubtitleCorrections(project, plan, [1]);
	expect((track.clips[0] as SubtitleClip).text).toBe('He read a message.');
	expect(third.needsReview).toBe(true);
	expect(third.hasBeenVerified).toBe(false);
});

test('allows confirming warning edits and existing suggestions after the timeline automatically verifies a clip', async () => {
	const suspect = new SubtitleClip(4000, 6000, 'Garbled wording');
	track.clips.push(suspect);
	vi.mocked(invoke).mockResolvedValue({
		corrections: [correction()],
		warnings: [
			{ id: 2, text: suspect.text, suggestion: 'He read a message.', reason: 'Listen to confirm.' }
		]
	});
	const plan = await detectSubtitleCorrections(project, new AbortController().signal, vi.fn());
	markClipAsVerified(suspect);
	expect(suspect.hasBeenVerified).toBe(true);
	correctSubtitleCorrectionWarning(plan, 2, 'Corrected wording');
	expect(suspect.text).toBe('Corrected wording');
	markClipAsVerified(track.clips[0] as SubtitleClip);
	expect(applySubtitleCorrections(project, plan, [1])).toBe(1);
	expect((track.clips[0] as SubtitleClip).text).toBe('He read a message.');
});

test('allows applying suggestions directly after automatic verification without confirming a warning first', async () => {
	const suspect = new SubtitleClip(4000, 6000, 'Garbled wording');
	track.clips.push(suspect);
	vi.mocked(invoke).mockResolvedValue({
		corrections: [correction()],
		warnings: [
			{ id: 2, text: suspect.text, suggestion: 'He read a message.', reason: 'Listen to confirm.' }
		]
	});
	const plan = await detectSubtitleCorrections(project, new AbortController().signal, vi.fn());
	markClipAsVerified(suspect);
	expect(applySubtitleCorrections(project, plan, [1])).toBe(1);
	expect(suspect.text).toBe('Garbled wording');
});

test('confirms a manual warning correction with word alignment and undo/redo', async () => {
	const clip = track.clips[0] as SubtitleClip;
	clip.translations.french = new VerseTranslation('Existing translation', 'reviewed');
	clip.alignmentMetadata = {
		source: 'api',
		timeFrom: 1,
		timeTo: 3,
		matchedText: clip.text,
		words: clip.text
			.split(' ')
			.map((word, index) => ({ word, start: index / 2, end: (index + 1) / 2 }))
	};
	vi.mocked(invoke).mockResolvedValue({
		corrections: [],
		warnings: [
			{ id: 1, text: clip.text, suggestion: 'He read a message.', reason: 'Check this wording.' }
		]
	});
	const plan = await detectSubtitleCorrections(project, new AbortController().signal, vi.fn());
	correctSubtitleCorrectionWarning(plan, 1, 'He read a message.');
	expect(clip.text).toBe('He read a message.');
	expect(plan.warnings[0].text).toBe('He read a message.');
	expect(clip.needsReview).toBe(true);
	expect(clip.startTime).toBe(1000);
	expect(clip.endTime).toBe(3000);
	expect(clip.alignmentMetadata.words[3]).toEqual({ word: 'message.', start: 1.5, end: 2 });
	expect(clip.translations.french.text).toBe('Existing translation');
	expect(() => correctSubtitleCorrectionWarning(plan, 1, 'He read a message.')).toThrow();
	ProjectHistoryManager.undo();
	const restored = globalState.getSubtitleTrack.clips[0] as SubtitleClip;
	expect(restored.text).toBe('He read a massage.');
	expect(restored.needsReview).toBe(true);
	ProjectHistoryManager.redo();
	expect((globalState.getSubtitleTrack.clips[0] as SubtitleClip).text).toBe('He read a message.');
	expect((globalState.getSubtitleTrack.clips[0] as SubtitleClip).needsReview).toBe(true);
	expect((globalState.getSubtitleTrack.clips[0] as SubtitleClip).hasBeenVerified).toBe(false);
});

test.each([undefined, null, '', '   ', 'He read a massage.', '{{1:1}}', 'x'.repeat(501)])(
	'rejects a warning without a usable contextual proposal: %j',
	async (suggestion) => {
		vi.mocked(invoke).mockResolvedValue({
			corrections: [],
			warnings: [{ id: 1, text: 'He read a massage.', suggestion, reason: 'Garbled wording.' }]
		});
		await expect(
			detectSubtitleCorrections(project, new AbortController().signal, vi.fn())
		).rejects.toThrow();
		expect((track.clips[0] as SubtitleClip).text).toBe('He read a massage.');
		expect((track.clips[0] as SubtitleClip).needsReview).toBe(false);
	}
);

test.each(['', '   ', '{{1:1}}', 'He read a massage.'])(
	'rejects invalid manual warning corrections: %j',
	async (text) => {
		vi.mocked(invoke).mockResolvedValue({
			corrections: [],
			warnings: [
				{
					id: 1,
					text: 'He read a massage.',
					suggestion: 'He read a message.',
					reason: 'Check this wording.'
				}
			]
		});
		const plan = await detectSubtitleCorrections(project, new AbortController().signal, vi.fn());
		expect(() => correctSubtitleCorrectionWarning(plan, 1, text)).toThrow();
		expect((track.clips[0] as SubtitleClip).text).toBe('He read a massage.');
		expect((track.clips[0] as SubtitleClip).needsReview).toBe(true);
	}
);

test.each(
	[
		[{ id: 99, text: 'He read a massage.', suggestion: 'He read a message.', reason: 'Suspect' }],
		[{ id: 1, text: 'Wrong text', suggestion: 'He read a message.', reason: 'Suspect' }],
		[{ id: 1, text: 'He read a massage.', suggestion: 'He read a message.', reason: '' }],
		[
			{ id: 1, text: 'He read a massage.', suggestion: 'He read a message.', reason: 'Suspect' },
			{ id: 1, text: 'He read a massage.', suggestion: 'He read a message.', reason: 'Duplicate' }
		]
	].map((warnings) => ({ warnings }))
)('rejects invalid warnings without persisting any flag: %j', async ({ warnings }) => {
	vi.mocked(invoke).mockResolvedValue({ corrections: [], warnings });
	await expect(
		detectSubtitleCorrections(project, new AbortController().signal, vi.fn())
	).rejects.toThrow();
	expect((track.clips[0] as SubtitleClip).needsReview).toBe(false);
});

test('preserves measured word timings for one-to-one substitutions and resets them when word counts change', async () => {
	const clip = track.clips[0] as SubtitleClip;
	clip.wbwTimestampsManuallyEdited = true;
	clip.alignmentMetadata = {
		source: 'api',
		matchedText: clip.text,
		timeFrom: 1,
		timeTo: 3,
		words: ['He', 'read', 'a', 'massage.'].map((word, i) => ({
			word,
			start: i / 2,
			end: (i + 1) / 2
		}))
	};
	const timings = clip.alignmentMetadata.words.map(({ start, end }) => ({ start, end }));
	const plan = await detectSubtitleCorrections(project, new AbortController().signal, vi.fn());
	applySubtitleCorrections(project, plan, [1]);
	expect(clip.alignmentMetadata.words.map(({ start, end }) => ({ start, end }))).toEqual(timings);
	expect(clip.alignmentMetadata.words[3].word).toBe('message.');
	expect(clip.wbwTimestampsManuallyEdited).toBe(true);
	vi.mocked(invoke).mockResolvedValue({
		corrections: [correction({ before: clip.text, after: 'He read one short message.' })]
	});
	const next = await detectSubtitleCorrections(project, new AbortController().signal, vi.fn());
	applySubtitleCorrections(project, next, [1]);
	expect(clip.alignmentMetadata.words).toEqual([]);
	expect(clip.wbwTimestampsManuallyEdited).toBe(false);
});

test.each([
	{ id: 99 },
	{ id: 1.5 },
	{ before: 'Invented source' },
	{ after: '' },
	{ after: '{{1:1}}' },
	{ reason: '' },
	{ confidence: 98 },
	{ confidence: '0.99' }
])('rejects invalid or ungrounded corrections: %j', async (values) => {
	vi.mocked(invoke).mockResolvedValue({ corrections: [correction(values)] });
	await expect(
		detectSubtitleCorrections(project, new AbortController().signal, vi.fn())
	).rejects.toThrow();
	expect((track.clips[0] as SubtitleClip).text).toBe('He read a massage.');
});

test('keeps annotations, styling and mapped translations protected while supplying their context', async () => {
	const marked = new SubtitleClip(3001, 4000, '{{1:1}}');
	const styled = new SubtitleClip(4001, 5000, 'Styled words');
	styled.toggleArabicInlineStyles(0, 0, { bold: true, italic: false, underline: false });
	const mapped = new SubtitleClip(5001, 6000, 'Mapped words');
	const translation = new VerseTranslation('Mapped translation.', 'reviewed');
	translation.wbwRanges = [{ arabicWordIndex: 0, startUnitIndex: 0, endUnitIndex: 0 }];
	mapped.translations.english = translation;
	track.clips.push(marked, styled, mapped);
	const plan = await detectSubtitleCorrections(project, new AbortController().signal, vi.fn());
	expect(plan.skipped).toBe(3);
	const request = vi.mocked(invoke).mock.calls[0][1] as {
		request: { batch: { subtitles: { editable: boolean }[] } };
	};
	expect(request.request.batch.subtitles.map(({ editable }) => editable)).toEqual([
		true,
		false,
		false,
		false
	]);
	vi.mocked(invoke).mockResolvedValue({
		corrections: [correction({ id: 2, before: marked.text, after: 'Rewritten words' })]
	});
	await expect(
		detectSubtitleCorrections(project, new AbortController().signal, vi.fn())
	).rejects.toThrow();
});

test('supplies read-only context across batches and never accepts a correction to a context-only subtitle', async () => {
	track.clips = Array.from(
		{ length: 104 },
		(_, i) => new SubtitleClip(i * 1000, (i + 1) * 1000, `Subtitle ${i + 1}`)
	);
	vi.mocked(invoke).mockResolvedValue({ corrections: [] });
	await detectSubtitleCorrections(project, new AbortController().signal, vi.fn());
	const batches = vi
		.mocked(invoke)
		.mock.calls.map(
			(call) =>
				(call[1] as { request: { batch: { subtitles: { id: number; editable: boolean }[] } } })
					.request.batch.subtitles
		);
	expect(batches[0]).toHaveLength(102);
	expect(batches[0][100]).toEqual({ id: 101, text: 'Subtitle 101', editable: false });
	expect(batches[1][0]).toEqual({ id: 99, text: 'Subtitle 99', editable: false });
	vi.mocked(invoke).mockResolvedValueOnce({
		corrections: [correction({ id: 101, before: 'Subtitle 101' })]
	});
	await expect(
		detectSubtitleCorrections(project, new AbortController().signal, vi.fn())
	).rejects.toThrow();
});

test.each([
	{ texts: Array.from({ length: 205 }, (_, i) => `Subtitle ${i + 1}`), sizes: [100, 100, 5] },
	{
		texts: Array.from({ length: 1090 }, (_, i) => `Subtitle ${i + 1}`),
		sizes: [250, 250, 250, 250, 90],
		batchSize: 250
	},
	{
		texts: Array.from({ length: 55 }, (_, i) => `Subtitle ${i + 1}`),
		sizes: [25, 25, 5],
		batchSize: 25
	},
	{
		texts: Array.from({ length: 205 }, (_, i) => `Subtitle ${i + 1}`),
		sizes: [205],
		batchSize: 2000
	},
	{ texts: ['a'.repeat(3500), 'b'.repeat(3500), 'short', 'last'], sizes: [1, 3] },
	{ texts: ['a'.repeat(6500), 'short', 'last'], sizes: [1, 2] }
])(
	'limits manual batches by subtitle count and text length: $sizes',
	async ({ texts, sizes, batchSize }) => {
		track.clips = texts.map((text, i) => new SubtitleClip(i * 1000, (i + 1) * 1000, text));
		globalState.settings!.aiTranslationSettings.analysisBatchSize = batchSize ?? 100;
		globalState.settings!.aiTranslationSettings.openAiApiKey = '';
		vi.mocked(invoke).mockResolvedValue('Correction instructions');
		const session = new ManualAiSession();
		session.start();
		const progress = vi.fn();
		const detecting = detectSubtitleCorrections(
			project,
			new AbortController().signal,
			progress,
			session
		);
		let offset = 0;
		for (const [index, size] of sizes.entries()) {
			await vi.waitFor(() => expect(session.steps).toHaveLength(index + 1));
			const { request } = vi.mocked(invoke).mock.calls[index][1] as {
				request: { batch: { subtitles: { id: number; text: string; editable: boolean }[] } };
			};
			const input = request.batch.subtitles;
			expect(input.filter((entry) => entry.editable).map((entry) => entry.id)).toEqual(
				Array.from({ length: size }, (_, i) => offset + i + 1)
			);
			expect(input.map((entry) => entry.text)).toEqual(
				texts.slice(Math.max(0, offset - 2), offset + size + 2)
			);
			expect(progress).toHaveBeenLastCalledWith(index / sizes.length, sizes.length);
			// Modifier les préférences ne doit pas changer les lots d'une session en cours.
			globalState.settings!.aiTranslationSettings.analysisBatchSize = 2000;
			const step = session.steps[index];
			const requestId = step.prompt.match(/"requestId":"([^"]+)"/)![1];
			const context = input.find((entry) => !entry.editable);
			if (context) {
				step.response = JSON.stringify({
					requestId,
					result: { corrections: [], warnings: [{ ...context, reason: 'Read-only context' }] }
				});
				session.submit();
				expect(step.status).toBe('waiting');
				expect(step.error).not.toBe('');
			}
			step.response = JSON.stringify({ requestId, result: { corrections: [], warnings: [] } });
			session.submit();
			expect(step.status).toBe('valid');
			offset += size;
		}
		await detecting;
		expect(invoke).toHaveBeenCalledTimes(sizes.length);
		expect(progress).toHaveBeenLastCalledWith(1, sizes.length);
		expect((track.clips as SubtitleClip[]).map((clip) => clip.text)).toEqual(texts);
	}
);

test('counts only batches containing editable subtitles in the actual request total', async () => {
	globalState.settings!.aiTranslationSettings.analysisBatchSize = 25;
	track.clips = Array.from(
		{ length: 28 },
		(_, i) => new SubtitleClip(i * 1000, (i + 1) * 1000, i < 25 ? '{{1:1}}' : `Subtitle ${i}`)
	);
	const progress = vi.fn();
	vi.mocked(invoke).mockResolvedValue({ corrections: [], warnings: [] });
	await detectSubtitleCorrections(project, new AbortController().signal, progress);
	expect(invoke).toHaveBeenCalledTimes(1);
	expect(progress.mock.calls).toEqual([
		[0, 1],
		[1, 1]
	]);
});

test.each([
	{ size: 25, calls: 3 },
	{ size: 2000, calls: 1 }
])('uses the saved analysis size with an API key: $size', async ({ size, calls }) => {
	globalState.settings!.aiTranslationSettings.analysisBatchSize = size;
	track.clips = Array.from(
		{ length: 55 },
		(_, i) => new SubtitleClip(i * 1000, (i + 1) * 1000, `Subtitle ${i}`)
	);
	vi.mocked(invoke).mockResolvedValue({ corrections: [], warnings: [] });
	await detectSubtitleCorrections(project, new AbortController().signal, vi.fn());
	expect(invoke).toHaveBeenCalledTimes(calls);
});

test.each(['cancel', 'edit', 'switch', 'network'])(
	'prevents applying partial results after %s',
	async (action) => {
		const controller = new AbortController();
		vi.mocked(invoke).mockImplementation(async () => {
			if (action === 'cancel') controller.abort();
			if (action === 'edit') (track.clips[0] as SubtitleClip).text = 'Manual edit';
			if (action === 'switch') globalState.currentProject = null;
			if (action === 'network') throw new Error('Provider failed');
			return { corrections: [correction()] };
		});
		await expect(detectSubtitleCorrections(project, controller.signal, vi.fn())).rejects.toThrow();
		expect(project.projectEditorState.subtitlesEditor.completedAiSteps.correction).toBe(false);
	}
);

test('rejects stale plans after edits or undo/redo and rejects repeated application', async () => {
	const plan = await detectSubtitleCorrections(project, new AbortController().signal, vi.fn());
	ProjectHistoryManager.track(
		'edit',
		() => {
			(track.clips[0] as SubtitleClip).text = 'Manual edit';
		},
		project
	);
	expect(() => applySubtitleCorrections(project, plan, [1])).toThrow();
	ProjectHistoryManager.undo();
	expect(() => applySubtitleCorrections(project, plan, [1])).toThrow();
	project = globalState.currentProject!;
	vi.spyOn(project.detail, 'updateVideoDetailAttributes').mockImplementation(() => {});
	const fresh = await detectSubtitleCorrections(project, new AbortController().signal, vi.fn());
	expect(() => applySubtitleCorrections(project, fresh, [1, 1])).toThrow();
	applySubtitleCorrections(project, fresh, [1]);
	expect(() => applySubtitleCorrections(project, fresh, [1])).toThrow();
});

test('requires a key and editable text before sending subtitles', async () => {
	globalState.settings!.aiTranslationSettings.openAiApiKey = '';
	await expect(
		detectSubtitleCorrections(project, new AbortController().signal, vi.fn())
	).rejects.toThrow();
	globalState.settings!.aiTranslationSettings.openAiApiKey = 'personal-key';
	(track.clips[0] as SubtitleClip).text = '{{protected}}';
	await expect(
		detectSubtitleCorrections(project, new AbortController().signal, vi.fn())
	).rejects.toThrow();
	expect(invoke).not.toHaveBeenCalled();
});
