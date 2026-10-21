import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
	Edition,
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
import { MinimalQuranProvider } from '$lib/services/MinimalQuranProvider';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';
import {
	detectProjectReferences,
	previewReferenceAnnotations,
	applyReferenceAnnotations
} from '$lib/services/ReferenceDetectionService';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('$lib/services/MinimalQuranProvider', () => ({
	MinimalQuranProvider: { getVerses: vi.fn() }
}));
const originalSettings = globalState.settings;
const options = { detectQuran: true, detectCitations: true, additionalPreferences: '' };
let track: SubtitleTrack;
let project: Project;

/**
 * Construit une réponse structurée du fournisseur pour les tests de validation.
 * @param {Record<string, unknown>} values Champs propres à la proposition.
 * @returns {Record<string, unknown>} Proposition complète.
 */
function finding(values: Record<string, unknown>): Record<string, unknown> {
	return {
		candidateId: null,
		kind: 'citation',
		status: 'confirmed',
		from: 1,
		to: 1,
		reference: null,
		reason: 'Reported speech.',
		...values
	};
}

beforeEach(() => {
	loadLocale('en');
	setLocale('en');
	initializeClassRegistry();
	track = new SubtitleTrack();
	project = new Project(
		new ProjectDetail('References', 'speaker'),
		new ProjectContent(new Timeline([track]))
	);
	globalState.currentProject = project;
	globalState.settings = new Settings();
	globalState.settings.aiTranslationSettings.openAiApiKey = 'personal-key';
	vi.spyOn(project.detail, 'updateVideoDetailAttributes').mockImplementation(() => {});
	vi.spyOn(globalState, 'updateVideoPreviewUI').mockImplementation(() => {});
	vi.mocked(MinimalQuranProvider.getVerses).mockResolvedValue({
		'1:1': ['بسم', 'الله', 'الرحمن', 'الرحيم'],
		'99:1': ['قول', 'محدد', 'للتحقق', 'هنا']
	});
	vi.mocked(invoke).mockResolvedValue({ findings: [] });
	ProjectHistoryManager.resetForCurrentProject();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.mocked(invoke).mockReset();
	vi.mocked(MinimalQuranProvider.getVerses).mockReset();
	ProjectHistoryManager.clear();
	globalState.currentProject = null;
	globalState.settings = originalSettings;
});

test('annotates reported speech across subtitles without changing words, silence, translations or timings', async () => {
	const first = new SubtitleClip(1000, 2000, 'Il dit : voici les');
	const silence = new SilenceClip(2001, 2499);
	const second = new SubtitleClip(2500, 4000, 'paroles citées puis commente.');
	first.translations = { english: new VerseTranslation('He says these words.', 'reviewed') };
	track.clips = [first, silence, second];
	vi.mocked(invoke).mockResolvedValue({ findings: [finding({ from: 4, to: 7 })] });
	const plan = await detectProjectReferences(
		project,
		options,
		new AbortController().signal,
		vi.fn()
	);
	expect(first.text).toBe('Il dit : voici les');
	expect(previewReferenceAnnotations(plan, [0]).map((change) => change.after)).toEqual([
		'Il dit : {{voici les}}',
		'{{paroles citées}} puis commente.'
	]);
	expect(applyReferenceAnnotations(project, plan, [0])).toBe(2);
	expect(track.clips).toEqual([first, silence, second]);
	expect([first.startTime, first.endTime, second.startTime, second.endTime]).toEqual([
		1000, 2000, 2500, 4000
	]);
	expect(first.translations.english.text).toBe('He says these words.');
	ProjectHistoryManager.undo();
	expect((globalState.getSubtitleTrack.clips[0] as SubtitleClip).text).toBe('Il dit : voici les');
	ProjectHistoryManager.redo();
	expect((globalState.getSubtitleTrack.clips[0] as SubtitleClip).text).toBe(
		'Il dit : {{voici les}}'
	);
});

test('lets AI reject a locally matched basmala as ordinary speech', async () => {
	track.clips = [new SubtitleClip(0, 3000, 'بسم الله الرحمن الرحيم نبدأ درسنا')];
	vi.mocked(invoke).mockResolvedValue({
		findings: [
			finding({
				candidateId: 0,
				kind: 'none',
				status: 'rejected',
				from: 1,
				to: 4,
				reason: 'An ordinary opening, not a Quran quotation.'
			})
		]
	});
	const plan = await detectProjectReferences(
		project,
		options,
		new AbortController().signal,
		vi.fn()
	);
	const batch = (
		vi.mocked(invoke).mock.calls[0][1] as { request: { batch: { candidates: unknown[] } } }
	).request.batch;
	expect(batch.candidates).toHaveLength(1);
	expect(plan.proposals[0].status).toBe('rejected');
	expect(previewReferenceAnnotations(plan, [])).toEqual([]);
	expect(() => applyReferenceAnnotations(project, plan, [0])).toThrow();
});

test('accepts an AI Quran discovery absent from local candidates and splits canonical word ranges per clip', async () => {
	track.clips = [new SubtitleClip(0, 1000, 'قال قول'), new SubtitleClip(1001, 2000, 'محدد!')];
	vi.mocked(invoke).mockResolvedValue({
		findings: [
			finding({
				kind: 'quran',
				from: 2,
				to: 3,
				reference: { surah: 99, verse: 1, startWord: 1, endWord: 2 }
			})
		]
	});
	const plan = await detectProjectReferences(
		project,
		options,
		new AbortController().signal,
		vi.fn()
	);
	expect(
		(vi.mocked(invoke).mock.calls[0][1] as { request: { batch: { candidates: unknown[] } } })
			.request.batch.candidates
	).toEqual([]);
	expect(plan.proposals[0].status).toBe('confirmed');
	expect(previewReferenceAnnotations(plan, [0]).map((change) => change.after)).toEqual([
		'قال {{99:1:1-1}}',
		'{{99:1:2-2}}!'
	]);
});

test('demotes invented Quran references and mismatched canonical text to uncertain proposals', async () => {
	track.clips = [new SubtitleClip(0, 2000, 'كلام آخر هنا')];
	vi.mocked(invoke).mockResolvedValue({
		findings: [
			finding({
				kind: 'quran',
				from: 1,
				to: 2,
				reference: { surah: 99, verse: 1, startWord: 1, endWord: 2 }
			})
		]
	});
	const plan = await detectProjectReferences(
		project,
		options,
		new AbortController().signal,
		vi.fn()
	);
	expect(plan.proposals[0].status).toBe('uncertain');
	expect(() => applyReferenceAnnotations(project, plan, [0])).toThrow();
});

test('protects existing markers and preserves spacing around new annotations', async () => {
	track.clips = [
		new SubtitleClip(0, 3000, 'Avant {{citation existante}} puis :  nouvelle\n citation !')
	];
	vi.mocked(invoke).mockResolvedValue({ findings: [finding({ from: 5, to: 6 })] });
	const plan = await detectProjectReferences(
		project,
		options,
		new AbortController().signal,
		vi.fn()
	);
	expect(previewReferenceAnnotations(plan, [0])[0].after).toBe(
		'Avant {{citation existante}} puis :  {{nouvelle\n citation}} !'
	);
});

test.each([
	{ from: 0, to: 2 },
	{ from: 2, to: 1 },
	{ from: 1, to: 99 },
	{ from: 1, to: 2 },
	{ candidateId: 42 }
])('rejects invalid IDs, protected markers and unknown candidates: %j', async (values) => {
	track.clips = [new SubtitleClip(0, 2000, 'before {{protected words}} after')];
	vi.mocked(invoke).mockResolvedValue({ findings: [finding(values)] });
	await expect(
		detectProjectReferences(project, options, new AbortController().signal, vi.fn())
	).rejects.toThrow();
	expect((track.clips[0] as SubtitleClip).text).toBe('before {{protected words}} after');
});

test('requires an explicit AI verdict for every locally suggested candidate', async () => {
	track.clips = [new SubtitleClip(0, 2000, 'بسم الله الرحمن الرحيم')];
	await expect(
		detectProjectReferences(project, options, new AbortController().signal, vi.fn())
	).rejects.toThrow();
});

test.each(['cancel', 'edit', 'switch', 'network'])(
	'does not produce an applicable plan after %s',
	async (action) => {
		track.clips = [new SubtitleClip(0, 2000, 'reported words')];
		const controller = new AbortController();
		vi.mocked(invoke).mockImplementation(async () => {
			if (action === 'cancel') controller.abort();
			if (action === 'edit') (track.clips[0] as SubtitleClip).text = 'edited words';
			if (action === 'switch') globalState.currentProject = null;
			if (action === 'network') throw new Error('private provider failure');
			return { findings: [finding({ from: 1, to: 2 })] };
		});
		await expect(
			detectProjectReferences(project, options, controller.signal, vi.fn())
		).rejects.toThrow();
	}
);

test('refuses applying a preview after subtitles have changed', async () => {
	const clip = new SubtitleClip(0, 2000, 'reported words');
	track.clips = [clip];
	vi.mocked(invoke).mockResolvedValue({ findings: [finding({ from: 1, to: 2 })] });
	const plan = await detectProjectReferences(
		project,
		options,
		new AbortController().signal,
		vi.fn()
	);
	clip.text = 'edited words';
	expect(() => applyReferenceAnnotations(project, plan, [0])).toThrow();
	expect(clip.text).toBe('edited words');
});

test('does not load Quran data when only ordinary quotations are requested', async () => {
	track.clips = [new SubtitleClip(0, 2000, 'reported words')];
	await detectProjectReferences(
		project,
		{ ...options, detectQuran: false },
		new AbortController().signal,
		vi.fn()
	);
	expect(MinimalQuranProvider.getVerses).not.toHaveBeenCalled();
});

test('provides context on both sides of long batches and supports a quotation crossing the batch boundary', async () => {
	const text = Array.from({ length: 620 }, (_, i) => `word${i}`).join(' ');
	track.clips = [new SubtitleClip(0, 60000, text)];
	vi.mocked(invoke)
		.mockResolvedValueOnce({ findings: [finding({ from: 394, to: 410 })] })
		.mockResolvedValueOnce({ findings: [] });
	const plan = await detectProjectReferences(
		project,
		options,
		new AbortController().signal,
		vi.fn()
	);
	expect(invoke).toHaveBeenCalledTimes(2);
	const batches = vi.mocked(invoke).mock.calls.map(
		(call) =>
			(
				call[1] as {
					request: {
						batch: { editableFrom: number; editableTo: number; words: { id: number }[] };
					};
				}
			).request.batch
	);
	expect([batches[0].editableFrom, batches[0].editableTo, batches[0].words.length]).toEqual([
		1, 400, 550
	]);
	expect([batches[1].editableFrom, batches[1].editableTo, batches[1].words[0].id]).toEqual([
		401, 620, 251
	]);
	const after = previewReferenceAnnotations(plan, [0])[0].after;
	expect(after).toContain(`{{${Array.from({ length: 17 }, (_, i) => `word${i + 393}`).join(' ')}}`);
	expect(after.replace('{{', '').replace('}}', '')).toBe(text);
});

test('keeps overlapping alternatives uncertain instead of nesting Quran and quotation markers', async () => {
	track.clips = [new SubtitleClip(0, 2000, 'قال قول محدد')];
	vi.mocked(invoke).mockResolvedValue({
		findings: [
			finding({ from: 1, to: 3 }),
			finding({
				kind: 'quran',
				from: 2,
				to: 3,
				reference: { surah: 99, verse: 1, startWord: 1, endWord: 2 }
			})
		]
	});
	const plan = await detectProjectReferences(
		project,
		options,
		new AbortController().signal,
		vi.fn()
	);
	expect(plan.proposals.map((proposal) => proposal.status)).toEqual(['uncertain', 'confirmed']);
	expect(previewReferenceAnnotations(plan, [1])[0].after).toBe('قال {{99:1:1-2}}');
});

test('protects a marker even when it touches adjacent unmarked text', async () => {
	track.clips = [new SubtitleClip(0, 2000, 'before{{protected words}}after')];
	vi.mocked(invoke).mockResolvedValue({ findings: [finding({ from: 2, to: 2 })] });
	await expect(
		detectProjectReferences(project, options, new AbortController().signal, vi.fn())
	).rejects.toThrow();
});

test('does not apply earlier batches if a later detection request fails', async () => {
	const clip = new SubtitleClip(
		0,
		60000,
		Array.from({ length: 500 }, (_, i) => `word${i}`).join(' ')
	);
	track.clips = [clip];
	const before = clip.text;
	vi.mocked(invoke)
		.mockResolvedValueOnce({ findings: [finding({ from: 1, to: 2 })] })
		.mockRejectedValueOnce(new Error('network failure'));
	await expect(
		detectProjectReferences(project, options, new AbortController().signal, vi.fn())
	).rejects.toThrow();
	expect(clip.text).toBe(before);
});

test('preserves the displayed translation when adding Quran anchors to previously translated text', async () => {
	const clip = new SubtitleClip(0, 2000, 'قول محدد');
	track.clips = [clip];
	const language = new Edition(
		'en',
		'english',
		'English',
		'English',
		'ltr',
		'project-language',
		'',
		'',
		''
	);
	project.content.projectTranslation.addedTranslationEditions = [language];
	project.content.projectTranslation.versesTranslations.english = {
		'99:1': 'A complete canonical translation.'
	};
	const translation = new VerseTranslation('Specific words.', 'reviewed');
	translation.isStructuredTranslation = true;
	clip.translations.english = translation;
	vi.mocked(invoke).mockResolvedValue({
		findings: [
			finding({
				kind: 'quran',
				from: 1,
				to: 2,
				reference: { surah: 99, verse: 1, startWord: 1, endWord: 2 }
			})
		]
	});
	const plan = await detectProjectReferences(
		project,
		options,
		new AbortController().signal,
		vi.fn()
	);
	applyReferenceAnnotations(project, plan, [0]);
	expect(translation.getText('english', clip)).toBe('Specific words.');
	ProjectHistoryManager.undo();
	expect((globalState.getSubtitleTrack.clips[0] as SubtitleClip).translations.english.text).toBe(
		'Specific words.'
	);
});
