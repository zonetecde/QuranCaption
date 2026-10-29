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
import {
	applySubtitleCorrections,
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

test('omits uncertain and unchanged proposals', async () => {
	vi.mocked(invoke).mockResolvedValue({ corrections: [correction({ confidence: 0.97 })] });
	expect(
		(await detectSubtitleCorrections(project, new AbortController().signal, vi.fn())).proposals
	).toEqual([]);
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
		{ length: 28 },
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
	expect(batches[0]).toHaveLength(26);
	expect(batches[0][24]).toEqual({ id: 25, text: 'Subtitle 25', editable: false });
	expect(batches[1][0]).toEqual({ id: 23, text: 'Subtitle 23', editable: false });
	vi.mocked(invoke).mockResolvedValueOnce({
		corrections: [correction({ id: 25, before: 'Subtitle 25' })]
	});
	await expect(
		detectSubtitleCorrections(project, new AbortController().signal, vi.fn())
	).rejects.toThrow();
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
