import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
	Category,
	Edition,
	Project,
	ProjectContent,
	ProjectDetail,
	Style,
	StylesData,
	SubtitleClip,
	Timeline,
	TrackType,
	VideoStyle
} from '$lib/classes';
import { SubtitleTrack } from '$lib/classes/Track.svelte';
import { VerseTranslation } from '$lib/classes/Translation.svelte';
import { globalState } from '$lib/runes/main.svelte';
import {
	applyAIProjectTranslationResults,
	buildAIProjectTranslationBatches,
	getEligibleAIProjectTranslationSubtitles,
	resolveAIProjectTranslationSuccessContext,
	validateAIProjectTranslationBatch,
	type AIProjectTranslationBatch,
	type AIProjectTranslationCandidate
} from '$lib/services/AIProjectTranslationService';
import { getStructuredTranslationDraft } from '$lib/services/StructuredTranslationService';
import { loadLocale } from '$lib/i18n/i18n-util.sync';
import { setLocale } from '$lib/i18n/i18n-svelte';
import { initializeClassRegistry } from '$lib/classes/ClassRegistry';
import { ProjectHistoryManager } from '$lib/services/undoRedo/ProjectHistoryManager';

/**
 * Construit un batch de test avec un passage Quran partiel et une citation.
 * @returns {AIProjectTranslationBatch} Batch structuré minimal.
 */
function createBatch(): AIProjectTranslationBatch {
	const subtitle = new SubtitleClip(0, 1000, 'قال {{2:255:1-2}} ثم {{إنما الأعمال بالنيات}}');
	const translation = new VerseTranslation('{{2:255:1-2}}{{}}', 'to translate');
	translation.isStructuredTranslation = true;
	subtitle.translations.test = translation;
	const draft = getStructuredTranslationDraft(subtitle.text, translation.text);
	const quranAnchor = draft.anchors[0];
	const citationAnchor = draft.anchors[1];
	const candidate: AIProjectTranslationCandidate = {
		subtitle,
		translation,
		snapshot: JSON.stringify([subtitle.text, subtitle.startTime, subtitle.endTime, translation]),
		payload: {
			i: subtitle.id,
			f: draft.sourceFreeTexts,
			a: [
				{
					i: quranAnchor.id,
					k: 'q',
					s: quranAnchor.sourceValue,
					r: '2:255',
					f: false,
					l: false,
					a: 'اللَّهُ لَا',
					u: ['God', 'there', 'is', 'no', 'deity'],
					w: ['Allah', 'not']
				},
				{
					i: citationAnchor.id,
					k: 'c',
					s: citationAnchor.sourceValue
				}
			]
		},
		citationIds: [citationAnchor.id],
		quranExpectations: [
			{
				anchor: quranAnchor,
				unitCount: 5,
				locked: false,
				fullVerse: false,
				resetToFullVerse: false
			}
		],
		wordCount: 8
	};

	return {
		batchId: 'test-batch',
		candidates: [candidate],
		beforeSubtitleIds: [],
		afterSubtitleIds: [],
		request: {
			timeline: [{ i: subtitle.id, editable: true, durationMs: 1000, pauseBeforeMs: 0, parts: [] }]
		},
		wordCount: 8
	};
}

/**
 * Crée un projet minimal capable de sauvegarder une opération d'historique.
 * @returns {Project} Projet de test.
 */
function createProject(): Project {
	const videoStyle = new VideoStyle();
	videoStyle.styles = [
		new StylesData('arabic', [
			new Category({
				id: 'text',
				styles: [new Style({ id: 'font-size', value: 90, valueType: 'number' })]
			})
		])
	];
	return new Project(
		new ProjectDetail('AI translation test', 'speaker'),
		new ProjectContent(new Timeline([new SubtitleTrack()]), [], undefined, videoStyle)
	);
}

describe('AIProjectTranslationService', () => {
	beforeEach(() => {
		loadLocale('en');
		setLocale('en');
	});

	afterEach(() => {
		ProjectHistoryManager.clear();
		globalState.currentProject = null;
		vi.unstubAllGlobals();
	});

	test('keeps an uncertain translation intact, saves its review reason and focuses only review items with undo/redo', () => {
		initializeClassRegistry();
		const project = createProject();
		const edition = new Edition('test', 'test', 'English', 'English', 'ltr', 'test', '', '', '');
		const batch = createBatch();
		const { subtitle, translation } = batch.candidates[0];
		translation.text = 'Existing safe translation';
		translation.inlineStyleRuns = [
			{ startWordIndex: 0, endWordIndex: 1, bold: true, italic: false, underline: false }
		];
		const before = JSON.stringify(translation.toJSON());
		batch.candidates[0].snapshot = JSON.stringify([
			subtitle.text,
			subtitle.startTime,
			subtitle.endTime,
			translation
		]);
		project.content.timeline.getFirstTrack(TrackType.Subtitle).clips.push(subtitle);
		project.content.projectTranslation.addedTranslationEditions = [edition];
		edition.showInTranslationsEditor = false;
		globalState.currentProject = project;
		project.projectEditorState.translationsEditor.searchQuery = 'previous search';
		project.projectEditorState.translationsEditor.filters = { 'to translate': true };
		ProjectHistoryManager.resetForCurrentProject();
		const report = validateAIProjectTranslationBatch(batch, {
			i: [
				{
					i: subtitle.id,
					f: [],
					c: [],
					q: [],
					issue: 'The source phrase is garbled. Listen and correct it first.'
				}
			]
		});
		expect(report.errors).toEqual([]);
		expect(report.validItems).toHaveLength(1);
		expect(translation.status).toBe('to translate');
		expect(resolveAIProjectTranslationSuccessContext(edition, report.validItems[0])).toBe('');
		const applied = applyAIProjectTranslationResults(edition, report.validItems);
		expect(applied).toEqual({ appliedSubtitles: 0, reviewSubtitles: 1 });
		expect(translation.text).toBe('Existing safe translation');
		expect(translation.inlineStyleRuns).toHaveLength(1);
		expect(translation.status).toBe('to review');
		expect(translation.getFilterStatus()).toBe('to review');
		expect(translation.reviewReason).toContain('garbled');
		expect(globalState.getTranslationsState.filters).toEqual({
			'to translate': false,
			'to review': true,
			'ai translated': false,
			reviewed: false
		});
		expect(globalState.getTranslationsState.searchQuery).toBe('');
		expect(edition.showInTranslationsEditor).toBe(true);
		const restored = Project.fromJSON(project.toJSON()) as Project;
		expect(
			(
				restored.content.timeline.getFirstTrack(TrackType.Subtitle).clips[0] as SubtitleClip
			).getTranslation('test').reviewReason
		).toContain('garbled');
		expect(ProjectHistoryManager.undo()).toBe(true);
		expect(JSON.stringify(globalState.getSubtitleClips[0].getTranslation('test').toJSON())).toBe(
			before
		);
		expect(globalState.getTranslationsState.searchQuery).toBe('previous search');
		expect(globalState.getTranslationsState.filters).toEqual({ 'to translate': true });
		ProjectHistoryManager.redo();
		expect(globalState.getSubtitleClips[0].getTranslation('test').status).toBe('to review');
		expect(
			getEligibleAIProjectTranslationSubtitles(
				globalState.getProjectTranslation.addedTranslationEditions[0],
				{
					retryErrors: true,
					overwriteAiTranslated: false,
					overwriteReviewed: false,
					overwriteManualQuran: false
				}
			)
		).toHaveLength(1);
	});

	test('focuses remaining review translations after another subtitle is translated successfully', () => {
		const project = createProject();
		const edition = new Edition('test', 'test', 'English', 'English', 'ltr', 'test', '', '', '');
		const batch = createBatch();
		const pending = new SubtitleClip(2000, 3000, 'Source to verify');
		pending.translations.test = new VerseTranslation('Existing translation', 'to review');
		project.content.timeline
			.getFirstTrack(TrackType.Subtitle)
			.clips.push(batch.candidates[0].subtitle, pending);
		project.content.projectTranslation.addedTranslationEditions = [edition];
		globalState.currentProject = project;
		const report = validateAIProjectTranslationBatch(batch, {
			i: [
				{
					i: batch.candidates[0].subtitle.id,
					f: ['He said ', ' then ', ''],
					c: [{ i: 'citation-1', t: 'Quoted words' }],
					q: [{ i: 'quran-0', s: 0, e: 1 }],
					issue: ''
				}
			]
		});
		const applied = applyAIProjectTranslationResults(edition, report.validItems);
		expect(applied).toEqual({ appliedSubtitles: 1, reviewSubtitles: 1 });
		expect(globalState.getTranslationsState.filters['to review']).toBe(true);
		expect(globalState.getTranslationsState.filters['ai translated']).toBe(false);
		expect(globalState.shared.translationScrollTargetClipId).toBe(pending.id);
	});

	test.each(['free text', 'citation'])(
		'converts an uncertainty placeholder in %s into a review notice without using it as subtitle text',
		(location) => {
			const batch = createBatch();
			const report = validateAIProjectTranslationBatch(batch, {
				i: [
					{
						i: batch.candidates[0].subtitle.id,
						f: [location === 'free text' ? 'O Allah, [unclear phrase].' : '', ' then ', ''],
						c: [{ i: 'citation-1', t: location === 'citation' ? '[inaudible]' : 'Quoted words' }],
						q: [{ i: 'quran-0', s: 0, e: 1 }],
						issue: ''
					}
				]
			});
			expect(report.errors).toEqual([]);
			expect(report.validItems[0].reviewReason).toContain('uncertainty');
			expect(report.validItems[0].freeTexts).toEqual([]);
			expect(report.validItems[0].citations).toEqual({});
		}
	);

	test('preserves manual Quran text on a review item even when full-verse reset is enabled', () => {
		const project = createProject();
		const edition = new Edition('test', 'test', 'English', 'English', 'ltr', 'test', '', '', '');
		const batch = createBatch();
		const candidate = batch.candidates[0];
		candidate.subtitle.text = 'Speech {{2:255}}';
		candidate.translation.text = 'Existing {{2:255}}';
		const segment = candidate.translation.getOrCreateQuranSegment('quran-0', '2:255', 4);
		segment.isBruteForce = true;
		segment.manualText = 'My manual verse translation';
		const originalSegments = JSON.stringify(candidate.translation.quranSegments);
		candidate.snapshot = JSON.stringify([
			candidate.subtitle.text,
			candidate.subtitle.startTime,
			candidate.subtitle.endTime,
			candidate.translation
		]);
		project.content.timeline.getFirstTrack(TrackType.Subtitle).clips.push(candidate.subtitle);
		project.content.projectTranslation.addedTranslationEditions = [edition];
		globalState.currentProject = project;
		const report = validateAIProjectTranslationBatch(batch, {
			i: [
				{ i: candidate.subtitle.id, f: [], c: [], q: [], issue: 'Source wording needs checking.' }
			]
		});
		applyAIProjectTranslationResults(edition, report.validItems, {
			retryErrors: true,
			overwriteAiTranslated: true,
			overwriteReviewed: true,
			overwriteManualQuran: true
		});
		expect(candidate.translation.text).toBe('Existing {{2:255}}');
		expect(JSON.stringify(candidate.translation.quranSegments)).toBe(originalSegments);
	});

	test.each([
		{ issue: null, f: [], c: [], q: [] },
		{ issue: 12, f: [], c: [], q: [] },
		{ issue: 'Unclear source', f: ['Partial translation'], c: [], q: [] },
		{ issue: 'Unclear source', f: [], c: [{ i: 'citation-1', t: 'Partial' }], q: [] }
	])('rejects malformed or mixed review responses: %j', (item) => {
		const batch = createBatch();
		const report = validateAIProjectTranslationBatch(batch, {
			i: [{ i: batch.candidates[0].subtitle.id, ...item }]
		});
		expect(report.validItems).toEqual([]);
		expect(report.errors).not.toEqual([]);
	});

	test('builds contextual batches with Quran edition units and English WBW helpers', async () => {
		loadLocale('fr');
		setLocale('fr');
		const project = createProject();
		const quranEdition = new Edition(
			'quran-en',
			'quran-en',
			'Test edition',
			'English',
			'ltr',
			'test',
			'',
			'',
			''
		);
		const edition = new Edition(
			'language-english',
			'language-english',
			'English',
			'English',
			'ltr',
			'project-language',
			'',
			'',
			'',
			true,
			quranEdition
		);
		project.content.projectTranslation.addedTranslationEditions = [edition];
		project.content.projectTranslation.versesTranslations[edition.name] = {
			'2:255': 'God there is no deity except Him'
		};
		const before = new SubtitleClip(0, 1000, 'مقدمة');
		const target = new SubtitleClip(1000, 2000, 'قال {{2:255:1-2}} ثم {{حديث}}');
		const after = new SubtitleClip(2000, 3000, 'خاتمة');
		before.translations[edition.name] = new VerseTranslation('Introduction', 'reviewed');
		target.translations[edition.name] = new VerseTranslation('{{2:255:1-2}}{{}}', 'to translate');
		after.translations[edition.name] = new VerseTranslation('Conclusion', 'reviewed');
		for (const translation of Object.values(target.translations)) {
			(translation as VerseTranslation).isStructuredTranslation = true;
		}
		project.content.timeline.getFirstTrack(TrackType.Subtitle)!.clips.push(before, target, after);
		globalState.currentProject = project;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input);
				return {
					ok: true,
					json: async () =>
						url.includes('minimal-quran')
							? { verses: { '2:255': ['اللَّهُ', 'لَا'] } }
							: { '2': { '255': [['Allah', 'not']] } }
				} as Response;
			})
		);

		const batches = await buildAIProjectTranslationBatches(edition, {
			retryErrors: true,
			overwriteAiTranslated: false,
			overwriteReviewed: false,
			overwriteManualQuran: false
		});

		expect(batches).toHaveLength(1);
		expect(batches[0].request.language).toBe('fr');
		expect(batches[0].beforeSubtitleIds).toEqual([before.id]);
		expect(batches[0].afterSubtitleIds).toEqual([after.id]);
		expect(batches[0].request.timeline.map((item) => item.i)).toEqual([0, 1, 2]);
		expect(batches[0].request.timeline.map((item) => item.editable)).toEqual([false, true, false]);
		expect(batches[0].request.timeline[1]).toMatchObject({ durationMs: 1000, pauseBeforeMs: 0 });
		expect(batches[0].request.timeline[1].parts).toEqual([
			{ k: 't', i: 0, s: 'قال ' },
			expect.objectContaining({
				i: 'quran-0',
				k: 'q',
				a: 'اللَّهُ لَا',
				u: ['God', 'there', 'is', 'no', 'deity', 'except', 'Him'],
				w: ['Allah', 'not']
			}),
			{ k: 't', i: 1, s: ' ثم ' },
			expect.objectContaining({ i: 'citation-1', k: 'c', s: 'حديث' }),
			{ k: 't', i: 2, s: '' }
		]);
	});
	test('maps compact batch indexes back to the persistent subtitle', () => {
		const batch = createBatch();
		batch.request.timeline[0].i = 0;
		const report = validateAIProjectTranslationBatch(batch, {
			i: [
				{
					i: 0,
					f: ['', ' then ', ''],
					c: [{ i: 'citation-1', t: 'Actions are judged by intentions.' }],
					q: [{ i: 'quran-0', s: 1, e: 3 }]
				}
			]
		});

		expect(report.errors).toEqual([]);
		expect(report.validItems[0].candidate.subtitle.id).toBe(batch.candidates[0].subtitle.id);
	});

	test('keeps reviewed subtitles between editable items in the chronological context', async () => {
		const project = createProject();
		const edition = new Edition('test', 'test', 'French', 'French', 'ltr', 'test', '', '', '');
		const first = new SubtitleClip(0, 1000, '{{بداية الحديث}}');
		const middle = new SubtitleClip(2000, 3000, 'تفسير المتكلم');
		const last = new SubtitleClip(4000, 5000, '{{نهاية الحديث}}');
		first.translations.test = new VerseTranslation('', 'to translate');
		middle.translations.test = new VerseTranslation('Speaker explanation', 'reviewed');
		last.translations.test = new VerseTranslation('', 'to translate');
		project.content.timeline.getFirstTrack(TrackType.Subtitle)!.clips.push(first, middle, last);
		globalState.currentProject = project;
		const [batch] = await buildAIProjectTranslationBatches(edition, {
			retryErrors: true,
			overwriteAiTranslated: false,
			overwriteReviewed: false,
			overwriteManualQuran: false
		});
		expect(batch.request.timeline.map((item) => item.editable)).toEqual([true, false, true]);
		expect(batch.request.timeline[1]).toMatchObject({
			t: 'Speaker explanation',
			pauseBeforeMs: 1000
		});
		const report = validateAIProjectTranslationBatch(batch, {
			i: [
				{ i: 0, f: ['« ', ''], c: [{ i: 'citation-0', t: 'Beginning' }] },
				{ i: 2, f: ['', ' »'], c: [{ i: 'citation-0', t: 'End' }] }
			]
		});
		expect(report.errors).toEqual([]);
		expect(report.validItems.map((item) => item.candidate.subtitle)).toEqual([first, last]);
	});

	test('protects existing text by default and includes legacy statuses in the all scope', () => {
		const project = createProject();
		const edition = new Edition('test', 'test', 'French', 'French', 'ltr', 'test', '', '', '');
		const missing = new SubtitleClip(0, 1000, 'Missing');
		const failed = new SubtitleClip(1000, 2000, 'Failed');
		const existing = new SubtitleClip(2000, 3000, 'Existing');
		missing.translations.test = new VerseTranslation('', 'to translate');
		failed.translations.test = new VerseTranslation('', 'ai error');
		existing.translations.test = new VerseTranslation('Edited translation', 'to review');
		project.content.timeline
			.getFirstTrack(TrackType.Subtitle)!
			.clips.push(missing, failed, existing);
		globalState.currentProject = project;
		const options = {
			retryErrors: true,
			overwriteAiTranslated: false,
			overwriteReviewed: false,
			overwriteManualQuran: false
		};
		expect(getEligibleAIProjectTranslationSubtitles(edition, options)).toEqual([missing, failed]);
		expect(
			getEligibleAIProjectTranslationSubtitles(edition, { ...options, overwriteReviewed: true })
		).toEqual([missing, failed, existing]);
	});

	test('prefers sentence boundaries once a batch is large enough', async () => {
		const project = createProject();
		const edition = new Edition('test', 'test', 'French', 'French', 'ltr', 'test', '', '', '');
		const clips = [
			new SubtitleClip(0, 1000, 'word '.repeat(310) + '.'),
			new SubtitleClip(1000, 2000, 'word '.repeat(100))
		];
		for (const clip of clips) clip.translations.test = new VerseTranslation('', 'to translate');
		project.content.timeline.getFirstTrack(TrackType.Subtitle)!.clips.push(...clips);
		globalState.currentProject = project;
		const batches = await buildAIProjectTranslationBatches(edition, {
			retryErrors: true,
			overwriteAiTranslated: false,
			overwriteReviewed: false,
			overwriteManualQuran: false
		});
		expect(batches.map((batch) => batch.candidates.length)).toEqual([1, 1]);
	});

	test('bounds requests with long unspaced text and trims distant context', async () => {
		const project = createProject();
		const edition = new Edition('test', 'test', 'French', 'French', 'ltr', 'test', '', '', '');
		const before = new SubtitleClip(0, 1000, 'x'.repeat(10000));
		const first = new SubtitleClip(1000, 2000, '字'.repeat(13000));
		const last = new SubtitleClip(2000, 3000, '字'.repeat(13000));
		before.translations.test = new VerseTranslation('Reviewed', 'reviewed');
		first.translations.test = new VerseTranslation('', 'to translate');
		last.translations.test = new VerseTranslation('', 'to translate');
		project.content.timeline.getFirstTrack(TrackType.Subtitle)!.clips.push(before, first, last);
		globalState.currentProject = project;
		const batches = await buildAIProjectTranslationBatches(edition, {
			retryErrors: true,
			overwriteAiTranslated: false,
			overwriteReviewed: false,
			overwriteManualQuran: false
		});
		expect(batches).toHaveLength(2);
		expect(batches[0].beforeSubtitleIds).toEqual([]);
		expect(batches[0].afterSubtitleIds).toEqual([]);
		expect(batches[1].beforeSubtitleIds).toEqual([]);
		expect(batches.every((batch) => JSON.stringify(batch.request).length < 24000)).toBe(true);
	});

	test('accepts structured free text, citation translations and Quran ranges', () => {
		const batch = createBatch();
		const subtitleId = batch.candidates[0].subtitle.id;

		const report = validateAIProjectTranslationBatch(batch, {
			i: [
				{
					i: subtitleId,
					f: ['', ' then he recalled ', ''],
					c: [{ i: 'citation-1', t: 'Actions are judged by intentions.' }],
					q: [{ i: 'quran-0', s: 1, e: 3 }]
				}
			]
		});

		expect(report.errors).toEqual([]);
		expect(report.validItems).toHaveLength(1);
		expect(report.validItems[0].quranRanges['quran-0']).toEqual({
			startUnitIndex: 1,
			endUnitIndex: 3
		});
		expect(report.validItems[0].citations['citation-1']).toBe('Actions are judged by intentions.');
	});

	test('rejects missing anchors and generated marker braces', () => {
		const batch = createBatch();
		const subtitleId = batch.candidates[0].subtitle.id;

		const report = validateAIProjectTranslationBatch(batch, {
			i: [
				{
					i: subtitleId,
					f: ['{{unsafe}}', '', ''],
					c: [],
					q: [{ i: 'quran-0', s: 1, e: 3 }]
				}
			]
		});

		expect(report.validItems).toEqual([]);
		expect(report.errors).toContain(`Subtitle ${subtitleId}: invalid free text slots.`);
	});

	test('accepts omitted empty anchor arrays when the source has no editable anchors', () => {
		const batch = createBatch();
		const candidate = batch.candidates[0];
		candidate.payload.a = [];
		candidate.citationIds = [];
		candidate.quranExpectations = [];
		const subtitleId = candidate.subtitle.id;

		const report = validateAIProjectTranslationBatch(batch, {
			i: [{ i: subtitleId, f: ['Plain translation'] }]
		});

		expect(report.errors).toEqual([]);
		expect(report.validItems).toHaveLength(1);
	});

	test('rejects Quran ranges outside the associated edition translation', () => {
		const batch = createBatch();
		const subtitleId = batch.candidates[0].subtitle.id;

		const report = validateAIProjectTranslationBatch(batch, {
			i: [
				{
					i: subtitleId,
					f: ['', '', ''],
					c: [{ i: 'citation-1', t: 'Actions are judged by intentions.' }],
					q: [{ i: 'quran-0', s: 2, e: 12 }]
				}
			]
		});

		expect(report.validItems).toEqual([]);
		expect(report.errors).toContain(
			`Subtitle ${subtitleId}: Quran ranges do not match the editable partial passages.`
		);
	});

	test('applies validated values without changing Quran markers', () => {
		const batch = createBatch();
		const subtitleId = batch.candidates[0].subtitle.id;
		const report = validateAIProjectTranslationBatch(batch, {
			i: [
				{
					i: subtitleId,
					f: ['', ' then he recalled ', ''],
					c: [{ i: 'citation-1', t: 'Actions are judged by intentions.' }],
					q: [{ i: 'quran-0', s: 1, e: 3 }]
				}
			]
		});
		const project = createProject();
		const quranEdition = new Edition(
			'quran-en',
			'quran-en',
			'Test edition',
			'English',
			'ltr',
			'test',
			'',
			'',
			''
		);
		const edition = new Edition(
			'language-english',
			'language-english',
			'English',
			'English',
			'ltr',
			'project-language',
			'',
			'',
			'',
			true,
			quranEdition
		);
		globalState.currentProject = project;
		project.content.projectTranslation.addedTranslationEditions = [edition];
		batch.candidates[0].subtitle.translations[edition.name] = batch.candidates[0].translation;
		project.content.timeline
			.getFirstTrack(TrackType.Subtitle)!
			.clips.push(batch.candidates[0].subtitle);

		project.content.projectTranslation.versesTranslations[edition.name] = {
			'2:255': 'God there is no deity except Him'
		};
		expect(resolveAIProjectTranslationSuccessContext(edition, report.validItems[0])).toBe(
			'there is no then he recalled Actions are judged by intentions.'
		);

		const applied = applyAIProjectTranslationResults(edition, report.validItems);
		const translation = batch.candidates[0].translation;

		expect(applied.appliedSubtitles).toBe(1);
		expect(translation.text).toBe(
			'{{2:255:1-2}} then he recalled {{Actions are judged by intentions.}}'
		);
		expect(translation.quranSegments['quran-0']).toMatchObject({
			reference: '2:255:1-2',
			startUnitIndex: 1,
			endUnitIndex: 3,
			isBruteForce: false
		});
		expect(translation.status).toBe('ai translated');
		expect(translation.isStatusComplete()).toBe(false);
	});

	test('resets manual full-verse translations while preserving AI trims for partial verses', () => {
		const batch = createBatch();
		const partialId = batch.candidates[0].subtitle.id;
		const partialReport = validateAIProjectTranslationBatch(batch, {
			i: [
				{
					i: partialId,
					f: ['', ' then ', ''],
					c: [{ i: 'citation-1', t: 'the narration' }],
					q: [{ i: 'quran-0', s: 1, e: 3 }]
				}
			]
		});
		const project = createProject();
		const quranEdition = new Edition(
			'quran-en',
			'quran-en',
			'Test edition',
			'English',
			'ltr',
			'test',
			'',
			'',
			''
		);
		const edition = new Edition(
			'language-english',
			'language-english',
			'English',
			'English',
			'ltr',
			'project-language',
			'',
			'',
			'',
			true,
			quranEdition
		);
		project.content.projectTranslation.addedTranslationEditions = [edition];
		project.content.projectTranslation.versesTranslations[edition.name] = {
			'2:255': 'God there is no deity except Him'
		};
		batch.candidates[0].subtitle.translations[edition.name] = batch.candidates[0].translation;

		const fullOnly = new SubtitleClip(1000, 2000, '{{2:255}}');
		const fullOnlyTranslation = new VerseTranslation('{{2:255}}', 'reviewed');
		fullOnlyTranslation.isStructuredTranslation = true;
		fullOnlyTranslation.quranSegments['quran-0'] = {
			reference: '2:255',
			startUnitIndex: 2,
			endUnitIndex: 3,
			isBruteForce: true,
			manualText: 'Custom verse'
		};
		fullOnly.translations[edition.name] = fullOnlyTranslation;
		project.content.timeline
			.getFirstTrack(TrackType.Subtitle)!
			.clips.push(batch.candidates[0].subtitle, fullOnly);
		globalState.currentProject = project;

		applyAIProjectTranslationResults(edition, partialReport.validItems, {
			retryErrors: true,
			overwriteAiTranslated: true,
			overwriteReviewed: true,
			overwriteManualQuran: true
		});

		expect(fullOnlyTranslation.quranSegments).toEqual({});
		expect(fullOnlyTranslation.status).toBe('completed by default');
		expect(
			project.content.projectTranslation.resolveStructuredTranslationText(
				edition,
				fullOnly,
				fullOnlyTranslation
			)
		).toBe('God there is no deity except Him');
		expect(batch.candidates[0].translation.quranSegments['quran-0']).toMatchObject({
			startUnitIndex: 1,
			endUnitIndex: 3,
			isBruteForce: false
		});
	});

	test('does not accept a Quran range for a locked passage', () => {
		const batch = createBatch();
		batch.candidates[0].quranExpectations[0].locked = true;
		batch.candidates[0].payload.a[0].l = true;
		const subtitleId = batch.candidates[0].subtitle.id;

		const report = validateAIProjectTranslationBatch(batch, {
			i: [
				{
					i: subtitleId,
					f: ['', '', ''],
					c: [{ i: 'citation-1', t: 'Actions are judged by intentions.' }],
					q: [{ i: 'quran-0', s: 0, e: 1 }]
				}
			]
		});

		expect(report.validItems).toEqual([]);
		expect(report.errors).toContain(
			`Subtitle ${subtitleId}: Quran ranges do not match the editable partial passages.`
		);
	});

	test('rejects late results after a source edit without overwriting the translation', () => {
		loadLocale('en');
		setLocale('en');
		const batch = createBatch();
		const project = createProject();
		globalState.currentProject = project;
		const candidate = batch.candidates[0];
		project.content.timeline.getFirstTrack(TrackType.Subtitle)!.clips.push(candidate.subtitle);
		const edition = new Edition('test', 'test', 'French', 'French', 'ltr', 'test', '', '', '');
		candidate.subtitle.text += ' edited';
		expect(() =>
			applyAIProjectTranslationResults(edition, [
				{ candidate, freeTexts: ['', '', ''], citations: {}, quranRanges: {} }
			])
		).toThrow('changed during translation');
		expect(candidate.translation.text).toBe('{{2:255:1-2}}{{}}');
	});
});
