import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
	Project,
	ProjectContent,
	ProjectDetail,
	SilenceClip,
	SubtitleClip,
	Timeline,
	TrackType
} from '$lib/classes';
import { SubtitleTrack } from '$lib/classes/Track.svelte';
import Settings from '$lib/classes/Settings.svelte';
import { initializeClassRegistry } from '$lib/classes/ClassRegistry';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';
import { globalState } from '$lib/runes/main.svelte';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import { VerseTranslation } from '$lib/classes/Translation.svelte';
import {
	rearrangeProjectSubtitles as previewProjectSubtitles,
	type RearrangementPreferences
} from '$lib/services/SubtitleRearrangementService';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const originalSettings = globalState.settings;
let project: Project;
let track: SubtitleTrack;
const options = {
	maxWords: 8,
	maxDuration: 6,
	additionalPreferences: 'Keep poetic lines together.'
};

/**
 * Exécute la préparation et l'approbation pour les tests du découpage existant.
 * @param {Project} project Projet de test.
 * @param {RearrangementPreferences} preferences Limites et préférences de découpage.
 * @param {AbortSignal} signal Annulation du traitement.
 * @param {(progress: number) => void} onProgress Suivi de progression.
 * @returns {Promise<{count: number; skipped: number}>} Résultat appliqué.
 */
async function rearrangeProjectSubtitles(
	project: Project,
	preferences: RearrangementPreferences,
	signal: AbortSignal,
	onProgress: (progress: number) => void
): Promise<{ count: number; skipped: number }> {
	const plan = await previewProjectSubtitles(project, preferences, signal, onProgress);
	return plan.apply();
}

/**
 * Construit un sous-titre avec des durées vocales mesurées.
 * @param {number} start Début en millisecondes.
 * @param {string} text Texte source.
 * @returns {SubtitleClip} Clip aligné.
 */
function subtitle(start: number, text: string): SubtitleClip {
	const words = text
		.split(' ')
		.map((word, i) => ({ word, start: i * 0.5, end: i * 0.5 + 0.3, spokenDuration: 0.3 }));
	return new SubtitleClip(start, start + words.length * 500, text, 'speaker', {}, true, null, {
		source: 'api',
		timeFrom: start / 1000,
		timeTo: start / 1000 + words.length * 0.5,
		words
	});
}

beforeEach(() => {
	loadLocale('en');
	setLocale('en');
	initializeClassRegistry();
	track = new SubtitleTrack();
	project = new Project(
		new ProjectDetail('Rearrangement', 'speaker'),
		new ProjectContent(new Timeline([track]))
	);
	globalState.currentProject = project;
	globalState.settings = new Settings();
	globalState.settings.aiTranslationSettings.openAiApiKey = 'personal-key';
	vi.spyOn(project.detail, 'updateVideoDetailAttributes').mockImplementation(() => {});
	vi.spyOn(globalState, 'updateVideoPreviewUI').mockImplementation(() => {});
	ProjectHistoryManager.resetForCurrentProject();
	vi.mocked(invoke).mockImplementation(async (_command, args) => {
		const request = (
			args as {
				request: { batch: { timeline: { type: string; id: number; words?: unknown[] }[] } };
			}
		).request;
		return {
			blocks: request.batch.timeline
				.filter((entry) => entry.type === 'speech')
				.map((entry) => ({ id: entry.id, ends: [entry.words!.length] }))
		};
	});
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.mocked(invoke).mockReset();
	ProjectHistoryManager.clear();
	globalState.currentProject = null;
	globalState.settings = originalSettings;
});

test('previews only changed subtitles without mutating the track until approval', async () => {
	const first = subtitle(0, 'one two');
	const second = subtitle(1000, 'three four');
	const untouched = new SubtitleClip(4000, 5000, 'untimed and unchanged');
	track.clips = [first, second, untouched];
	const plan = await previewProjectSubtitles(
		project,
		options,
		new AbortController().signal,
		vi.fn()
	);
	expect(track.clips).toEqual([first, second, untouched]);
	expect(project.projectEditorState.subtitlesEditor.completedAiSteps.rearrangement).toBe(false);
	expect(plan.before).toEqual([first, second]);
	expect(plan.after.map((clip) => clip.text)).toEqual(['one two three four']);
	expect(plan.skipped).toBe(1);
	plan.apply();
	expect(project.projectEditorState.subtitlesEditor.completedAiSteps.rearrangement).toBe(true);
	expect(track.clips).toContain(untouched);
	expect(() => plan.apply()).toThrow();
	ProjectHistoryManager.undo();
	expect(globalState.getSubtitleClips.map((clip) => clip.text)).toEqual([
		'one two',
		'three four',
		'untimed and unchanged'
	]);
});

test.each(['edit', 'switch', 'cancel', 'translations', 'undo'])(
	'refuses applying an outdated preview after %s',
	async (action) => {
		track.clips = [subtitle(0, 'one two')];
		const controller = new AbortController();
		const plan = await previewProjectSubtitles(project, options, controller.signal, vi.fn());
		if (action === 'edit') (track.clips[0] as SubtitleClip).text = 'Manual edit';
		if (action === 'switch') globalState.currentProject = null;
		if (action === 'cancel') controller.abort();
		if (action === 'translations')
			project.content.projectTranslation.versesTranslations.english = {
				'1:1': 'Updated translation'
			};
		if (action === 'undo') {
			ProjectHistoryManager.track(
				'edit',
				() => {
					(track.clips[0] as SubtitleClip).text = 'Manual edit';
				},
				project
			);
			ProjectHistoryManager.undo();
		}
		expect(() => plan.apply()).toThrow();
	}
);

test('sends chronological words and immutable silence without old subtitle boundaries, and supports undo', async () => {
	const silence = new SilenceClip(1001, 1999);
	track.clips = [
		subtitle(0, 'one two'),
		silence,
		subtitle(2000, 'three four'),
		subtitle(3000, 'five six')
	];
	const before = track.clips.map((clip) => [
		clip.id,
		clip.startTime,
		clip.endTime,
		clip instanceof SubtitleClip ? clip.text : ''
	]);
	await rearrangeProjectSubtitles(project, options, new AbortController().signal, vi.fn());
	expect(project.projectEditorState.subtitlesEditor.completedAiSteps.rearrangement).toBe(true);
	const request = vi.mocked(invoke).mock.calls[0][1] as { request: { batch: unknown } };
	expect(request.request.batch).toMatchObject({
		preferences: options,
		timeline: [
			{ type: 'speech', words: [{ text: 'one' }, { text: 'two' }] },
			{ type: 'silence', start: 1.001, end: 1.999 },
			{
				type: 'speech',
				words: [{ text: 'three' }, { text: 'four' }, { text: 'five' }, { text: 'six' }]
			}
		]
	});
	expect(JSON.stringify(request.request.batch)).not.toMatch(/clipId|subtitleId/);
	expect(track.clips).toContain(silence);
	const subs = track.clips.filter((clip): clip is SubtitleClip => clip instanceof SubtitleClip);
	expect(subs.map((clip) => clip.text)).toEqual(['one two', 'three four five six']);
	expect(subs.every((clip) => clip.endTime <= 1001 || clip.startTime >= 1999)).toBe(true);
	await ProjectHistoryManager.undo();
	expect(globalState.getSubtitlesEditorState.completedAiSteps.rearrangement).toBe(false);
	expect(
		globalState
			.currentProject!.content.timeline.getFirstTrack(TrackType.Subtitle)
			.clips.map((clip) => [
				clip.id,
				clip.startTime,
				clip.endTime,
				clip instanceof SubtitleClip ? clip.text : ''
			])
	).toEqual(before);
	await ProjectHistoryManager.redo();
	expect(globalState.getSubtitlesEditorState.completedAiSteps.rearrangement).toBe(true);
	expect(
		globalState.getSubtitleTrack.clips.filter((clip) => clip instanceof SubtitleClip)
	).toHaveLength(2);
});

test('turns measured one-second pauses into hard boundaries and never displays text over them', async () => {
	const clip = new SubtitleClip(0, 1600, 'before after', 'speaker', {}, true, null, {
		source: 'api',
		timeFrom: 0,
		timeTo: 1.6,
		words: [
			{ word: 'before', start: 0, end: 0.3, spokenDuration: 0.3 },
			{ word: 'after', start: 1.3, end: 1.6, spokenDuration: 0.3 }
		]
	});
	track.clips = [SubtitleClip.fromJSON<SubtitleClip>(clip.toJSON())];
	await rearrangeProjectSubtitles(project, options, new AbortController().signal, vi.fn());
	expect(
		track.clips
			.filter((item) => item instanceof SubtitleClip)
			.map((item) => [item.startTime, item.endTime])
	).toEqual([
		[0, 300],
		[1300, 1600]
	]);
	expect(
		track.clips.some(
			(item) => item instanceof SilenceClip && item.startTime === 301 && item.endTime === 1299
		)
	).toBe(true);
});

test('adds missing silence from zero to the first subtitle and restores the gap with undo', async () => {
	track.clips = [subtitle(1000, 'first words')];
	await rearrangeProjectSubtitles(project, options, new AbortController().signal, vi.fn());
	expect(track.clips[0]).toBeInstanceOf(SilenceClip);
	expect([track.clips[0].startTime, track.clips[0].endTime]).toEqual([0, 999]);
	ProjectHistoryManager.undo();
	expect(globalState.getSubtitleTrack.clips).toHaveLength(1);
	expect(globalState.getSubtitleTrack.clips[0].startTime).toBe(1000);
});

test('keeps an existing initial silence without duplicating or replacing it', async () => {
	const silence = new SilenceClip(0, 999);
	track.clips = [silence, subtitle(1000, 'first words')];
	await rearrangeProjectSubtitles(project, options, new AbortController().signal, vi.fn());
	expect(track.clips[0]).toBe(silence);
	expect(track.clips.filter((clip) => clip instanceof SilenceClip)).toEqual([silence]);
});

test('preserves quotations and Quran ranges when splitting and merging', async () => {
	track.clips = [subtitle(0, 'one {{two three}}'), subtitle(1500, '{{1:1:1-2}}')];
	track.clips[1] = new SubtitleClip(1500, 2500, '{{1:1:1-2}}', 'speaker', {}, true, null, {
		source: 'api',
		timeFrom: 1.5,
		timeTo: 2.5,
		words: [
			{ word: 'بسم', start: 0, end: 0.5 },
			{ word: 'الله', start: 0.5, end: 1 }
		]
	});
	vi.mocked(invoke).mockResolvedValue({ blocks: [{ id: 0, ends: [2, 4, 5] }] });
	await rearrangeProjectSubtitles(project, options, new AbortController().signal, vi.fn());
	expect(
		track.clips
			.filter((item): item is SubtitleClip => item instanceof SubtitleClip)
			.map((item) => item.text)
	).toEqual(['one {{two}}', '{{three}} {{1:1:1-1}}', '{{1:1:2-2}}']);
});

test.each([
	{ blocks: [{ id: 0, ends: [1] }] },
	{ blocks: [] },
	{ blocks: [{ id: 0, ends: [2, 2] }] },
	{
		blocks: [
			{ id: 0, ends: [2] },
			{ id: 0, ends: [2] }
		]
	}
])('rejects invalid AI boundaries atomically: %j', async (response) => {
	track.clips = [subtitle(0, 'one two')];
	const before = JSON.stringify(track.toJSON());
	vi.mocked(invoke).mockResolvedValue(response);
	await expect(
		rearrangeProjectSubtitles(project, options, new AbortController().signal, vi.fn())
	).rejects.toThrow();
	expect(JSON.stringify(track.toJSON())).toBe(before);
});

test('enforces local limits even if AI requests one long subtitle', async () => {
	track.clips = [subtitle(0, 'one two three four five six')];
	await rearrangeProjectSubtitles(
		project,
		{ ...options, maxWords: 2, maxDuration: 1 },
		new AbortController().signal,
		vi.fn()
	);
	const clips = track.clips.filter((item): item is SubtitleClip => item instanceof SubtitleClip);
	expect(clips.flatMap((item) => item.text.split(' '))).toEqual([
		'one',
		'two',
		'three',
		'four',
		'five',
		'six'
	]);
	expect(
		clips.every((item) => item.alignmentMetadata!.words.length <= 2 && item.duration <= 1000)
	).toBe(true);
});

test('keeps unchanged translations, resets changed ones and restores them with undo', async () => {
	const first = subtitle(0, 'one two');
	const second = subtitle(2000, 'three four');
	const third = subtitle(3000, 'five six');
	for (const clip of [first, second, third]) {
		clip.alignmentMetadata!.words.forEach((word) => {
			delete word.spokenDuration;
		});
		clip.translations = {
			french: new VerseTranslation(`Translation: ${clip.text}`, 'ai translated')
		};
	}
	const silence = new SilenceClip(1001, 1999);
	track.clips = [first, silence, second, third];
	await rearrangeProjectSubtitles(project, options, new AbortController().signal, vi.fn());
	expect(track.clips).toContain(first);
	expect(first.translations.french.text).toBe('Translation: one two');
	const changed = track.clips.find(
		(clip): clip is SubtitleClip =>
			clip instanceof SubtitleClip && clip.text === 'three four five six'
	)!;
	expect(changed.translations.french).toBeUndefined();
	ProjectHistoryManager.undo();
	const restored = globalState.getSubtitleTrack.clips.find(
		(clip) => clip.id === second.id
	) as SubtitleClip;
	expect(restored.translations.french.text).toBe('Translation: three four');
});

test('processes long speech with overlapping context and no missing or duplicated words', async () => {
	const tokens = Array.from({ length: 900 }, (_, i) => `word${i}`);
	track.clips = [subtitle(0, tokens.join(' '))];
	await rearrangeProjectSubtitles(project, options, new AbortController().signal, vi.fn());
	expect(invoke).toHaveBeenCalledTimes(3);
	expect(
		track.clips
			.filter((clip): clip is SubtitleClip => clip instanceof SubtitleClip)
			.flatMap((clip) => clip.text.split(' '))
	).toEqual(tokens);
	for (const call of vi.mocked(invoke).mock.calls) {
		const batch = (call[1] as { request: { batch: { timeline: { words?: unknown[] }[] } } }).request
			.batch;
		expect(
			batch.timeline.reduce((sum, entry) => sum + (entry.words?.length ?? 0), 0)
		).toBeLessThanOrEqual(400);
	}
	const secondBatch = (
		vi.mocked(invoke).mock.calls[1][1] as { request: { batch: { contextBefore: string } } }
	).request.batch;
	expect(secondBatch.contextBefore.split(' ')).toHaveLength(25);
});

test('does not apply earlier batches when a later request fails', async () => {
	track.clips = [subtitle(0, Array.from({ length: 500 }, (_, i) => `word${i}`).join(' '))];
	const original = track.clips[0];
	vi.mocked(invoke)
		.mockResolvedValueOnce({ blocks: [{ id: 0, ends: [400] }] })
		.mockRejectedValueOnce(new Error('failed'));
	await expect(
		rearrangeProjectSubtitles(project, options, new AbortController().signal, vi.fn())
	).rejects.toThrow();
	expect(track.clips).toEqual([original]);
});

test('protects subtitles whose displayed text no longer matches its alignment', async () => {
	const edited = subtitle(0, 'one two');
	edited.text = 'changed text';
	track.clips = [edited];
	await expect(
		rearrangeProjectSubtitles(project, options, new AbortController().signal, vi.fn())
	).rejects.toThrow('No editable subtitles');
	expect(invoke).not.toHaveBeenCalled();
	expect(track.clips).toEqual([edited]);
});

test('clears editor selections that refer to replaced subtitles', async () => {
	const first = subtitle(0, 'one two');
	const second = subtitle(1000, 'three four');
	track.clips = [first, second];
	project.projectEditorState.subtitlesEditor.editSubtitle = first;
	project.projectEditorState.subtitlesEditor.pendingSplitEditNextId = second.id;
	project.projectEditorState.stylesEditor.selectedSubtitles = [first, second];
	await rearrangeProjectSubtitles(project, options, new AbortController().signal, vi.fn());
	expect(project.projectEditorState.subtitlesEditor.editSubtitle).toBeNull();
	expect(project.projectEditorState.subtitlesEditor.pendingSplitEditNextId).toBeNull();
	expect(project.projectEditorState.stylesEditor.selectedSubtitles).toEqual([]);
});

test('retains untimed and decorated clips unchanged and reports them', async () => {
	const untimed = new SubtitleClip(2000, 3000, 'untimed');
	const decorated = subtitle(4000, 'image caption');
	decorated.associatedImagePath = '/image.png';
	track.clips = [subtitle(0, 'one two'), untimed, decorated];
	const result = await rearrangeProjectSubtitles(
		project,
		options,
		new AbortController().signal,
		vi.fn()
	);
	expect(result.skipped).toBe(2);
	expect(track.clips).toContain(untimed);
	expect(track.clips).toContain(decorated);
});

test.each(['cancel', 'edit', 'switch', 'network'])(
	'does not apply a stale or failed result: %s',
	async (action) => {
		track.clips = [subtitle(0, 'one two')];
		const controller = new AbortController();
		vi.mocked(invoke).mockImplementation(async () => {
			if (action === 'cancel') controller.abort();
			if (action === 'edit') (track.clips[0] as SubtitleClip).text = 'edited text';
			if (action === 'switch') globalState.currentProject = null;
			if (action === 'network') throw new Error('secret provider detail');
			return { blocks: [{ id: 0, ends: [2] }] };
		});
		await expect(
			rearrangeProjectSubtitles(project, options, controller.signal, vi.fn())
		).rejects.toThrow();
		expect(track.clips).toHaveLength(1);
		if (action === 'edit') expect((track.clips[0] as SubtitleClip).text).toBe('edited text');
	}
);
